const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const express = require("express");
const sharp = require("sharp");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const { createRequestScope } = require("../services/request-scope");
const { createBilibiliStickerImportService, downloadCover, coverUrl, toolRequestId } = require("../services/bilibili-sticker-import");
const { createBilibiliStickerChatRuntime } = require("../services/bilibili-sticker-chat");
const { createXhsStickerChatRuntime } = require("../services/xhs-sticker-chat");
const { createCompanionStickerSelector, createCompanionStickerTool, SELECT_COMPANION_STICKER_TOOL, companionStickerToolCalls } = require("../services/companion-stickers");
const { createPrivateMediaRouter } = require("../routes/v2/private-media");
const migration = fs.readFileSync(require.resolve("../supabase/drafts/bilibili_sticker_import.sql"), "utf8");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333", D = "44444444-4444-4444-8444-444444444444", E = "55555555-5555-4555-8555-555555555555";
const bvid = "BV1234567890", otherVideo = "BV0987654321";
const input = (extra = {}) => ({ bvid, client_request_id: randomUUID(), ...extra });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function client(db, faults) {
    const safe = name => { assert.match(name, /^[a-z_][a-z_0-9]*$/); return `"${name}"`; };
    return { from(table) {
        let action = "select", values, columns = "*", single = false; const filters = [];
        const q = { select(value = "*") { columns = value; return q; }, insert(value) { action = "insert"; values = value; return q; },
            update(value) { action = "update"; values = value; return q; }, delete() { action = "delete"; return q; }, eq(key, value) { filters.push([key, value]); return q; },
            maybeSingle() { single = true; return q; }, single() { single = true; return q; },
            then(resolve, reject) { return (async () => {
                try {
                    if (faults.complete && table === "sticker_import_receipts" && values?.state === "complete") {
                        faults.complete = false; return { error: { code: "XX000", message: "private db details" } };
                    }
                    const params = [], bind = value => { params.push(value); return `$${params.length}`; };
                    const projection = columns === "*" ? "*" : columns.split(",").map(v => safe(v.trim())).join(",");
                    let sql;
                    if (action === "insert") { const keys = Object.keys(values); sql = `insert into ${safe(table)} (${keys.map(safe)}) values (${keys.map(k => bind(values[k]))}) returning ${projection}`; }
                    else {
                        sql = action === "select" ? `select ${projection} from ${safe(table)}` : action === "delete" ? `delete from ${safe(table)}` : `update ${safe(table)} set ${Object.entries(values).map(([k,v]) => `${safe(k)}=${bind(v)}`).join(",")}`;
                        if (filters.length) sql += ` where ${filters.map(([k,v]) => `${safe(k)}=${bind(v)}`).join(" and ")}`;
                        if (action !== "select") sql += ` returning ${projection}`;
                    }
                    const rows = (await db.query(sql, params)).rows;
                    return { data: single ? rows[0] || null : rows, error: null };
                } catch (error) { return { error }; }
            })().then(resolve, reject); },
        }; return q;
    } };
}

async function fixture({ migrate = true } = {}) {
    const db = new PGlite(), faults = {}, objects = new Map(), removed = [], cookieScopes = [], videoOptions = [];
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table companions(user_id uuid, id uuid, primary key(user_id,id));
      insert into companions values ('${A}','${C}'),('${B}','${D}'),('${A}','${E}');
      create table settings(user_id uuid, companion_id uuid, unified_system_prompt text, user_details text);
      insert into settings values ('${A}','${C}','fictional persona remains exact ~','fictional details');
      create table account_media_assets(id uuid primary key,user_id uuid,companion_id uuid,purpose text,status text,
        display_name text,alt_text text,mood_tags text[],storage_bucket text,storage_path text,mime_type text,byte_size bigint,
        sha256 text,width int,height int,created_at timestamptz default now(),updated_at timestamptz default now(),archived_at timestamptz);`);
    if (migrate) await db.exec(migration);
    const admin = client(db, faults);
    const scope = (userId = A, companionId = C) => {
        const companion = { user_id: userId, id: companionId, status: "active" };
        return createRequestScope({ adminSupabase: admin, user: { id: userId }, profile: { id: userId, status: "active", role: "owner" }, companion, companions: [companion] });
    };
    const png = await sharp({ create: { width: 24, height: 20, channels: 4, background: "pink" } }).png().toBuffer();
    const storage = { from() { return {
        async upload(path, buffer) { objects.set(path, buffer); return {}; },
        async remove(paths) { for (const path of paths) { objects.delete(path); removed.push(path); } return {}; },
        async download(path) { return { data: { arrayBuffer: async () => objects.get(path) } }; },
    }; } };
    const options = { storage, getCookie: async current => { cookieScopes.push([current.userId, current.companionId]); return "fixture-private-cookie"; },
        getVideo: async (_id, cookie, opts) => { assert.equal(cookie, "fixture-private-cookie"); videoOptions.push(opts); return { cover: "https://i0.hdslb.com/fixture.png", title: "虚构猫猫", owner: "虚构作者" }; },
        fetchImpl: async (url, init) => { assert.equal(url, "https://i0.hdslb.com/fixture.png"); assert.equal(init.headers.Cookie, undefined); assert.equal(init.redirect, "error"); return new Response(png, { headers: { "content-type": "image/png" } }); } };
    return { db, faults, objects, removed, scope, storage, options, cookieScopes, videoOptions, service: createBilibiliStickerImportService(options) };
}

test("local SQL repeats safely, restricts direct roles and preserves persona fields", async () => {
    const f = await fixture();
    try {
        await f.db.exec(migration);
        assert.deepEqual((await f.db.query("select unified_system_prompt,user_details from settings")).rows, [{ unified_system_prompt: "fictional persona remains exact ~", user_details: "fictional details" }]);
        assert.equal((await f.db.query("select count(*)::int n from pg_class where relname like 'sticker_import_%' and relrowsecurity")).rows[0].n, 2);
        await assert.rejects(f.db.exec(`insert into sticker_import_preferences(user_id,companion_id) values ('${B}','${C}')`), error => error.code === "23503");
        for (const role of ["anon", "authenticated"]) {
            await f.db.exec(`set role ${role}`);
            await assert.rejects(f.db.exec("select * from sticker_import_receipts"), error => error.code === "42501");
            await f.db.exec("reset role");
        }
    } finally { await f.db.close(); }
});

test("actual routes import a private image with durable replay, attribution and tenant isolation", async () => {
    const f = await fixture(); let server;
    try {
        const app = express(); app.use(express.json());
        app.use((req, _res, next) => { if (!req.headers["x-missing"]) req.scope = req.headers["x-other"] ? f.scope(B,D) : req.headers["x-companion"] ? f.scope(A,E) : f.scope(); next(); });
        app.use(createPrivateMediaRouter({ storage: f.storage, stickerImports: f.service }));
        app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, message: error.message }));
        server = app.listen(0,"127.0.0.1"); await new Promise(resolve => server.once("listening",resolve));
        const url = `http://127.0.0.1:${server.address().port}`;
        const request = input();
        const post = headers => fetch(`${url}/sticker-import/bilibili`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(request) });
        assert.equal((await post({ "x-missing": "1" })).status, 401);
        const first = await post(); assert.equal(first.status,201); assert.equal(first.headers.get("cache-control"), "private, no-store");
        const result = await first.json(); assert.equal(result.asset.purpose,"custom_sticker"); assert.equal(result.asset.mime_type,"image/webp");
        assert.equal(result.source.page_url, `https://www.bilibili.com/video/${bvid}`);
        assert.doesNotMatch(JSON.stringify(result),/fixture-private-cookie|storage_path|hdslb|user_id/);
        const replay = await (await post()).json(); assert.equal(replay.asset.id,result.asset.id); assert.equal(replay.replayed,true); assert.equal(f.objects.size,1);
        assert.deepEqual(f.cookieScopes,[[A,C]]); assert.deepEqual(f.videoOptions,[{ includeSubtitles:false }]);
        const content = await fetch(`${url}/assets/${result.asset.id}/content`); assert.equal(content.status,200); assert.equal((await content.arrayBuffer()).byteLength>0,true);
        assert.equal((await fetch(`${url}/assets/${result.asset.id}/source`)).status,200);
        for (const headers of [{ "x-other":"1" }, { "x-companion":"1" }]) {
            assert.equal((await fetch(`${url}/assets/${result.asset.id}/source`,{headers})).status,404);
            assert.equal((await fetch(`${url}/assets/${result.asset.id}/content`,{headers})).status,404);
        }
        await rejects(f.service.importBilibili(f.scope(),{...request,bvid:otherVideo}),"sticker_import_request_conflict");
        await f.db.query("delete from account_media_assets where id=$1",[result.asset.id]);
        await rejects(f.service.importBilibili(f.scope(),request),"sticker_import_asset_removed");
        assert.equal(f.objects.size,1,"the service must not recreate a deleted asset");
    } finally { if (server) await new Promise(resolve=>server.close(resolve)); await f.db.close(); }
});

test("concurrent service instances keep one asset and clean only the losing storage object", async () => {
    const f = await fixture();
    try {
        const request = input(), s2 = createBilibiliStickerImportService(f.options);
        const results = await Promise.all([f.service.importBilibili(f.scope(),request),s2.importBilibili(f.scope(),request)]);
        assert.equal(results[0].asset.id,results[1].asset.id); assert.equal(f.objects.size,1);
        assert.equal((await f.db.query("select count(*)::int n from account_media_assets")).rows[0].n,1);
        assert.equal((await f.db.query("select count(*)::int n from sticker_import_receipts")).rows[0].n,1);
    } finally { await f.db.close(); }
});

test("a lost completion receipt retries without uploading again; archive prevents resurrection", async () => {
    const f = await fixture();
    try {
        const request = input(); f.faults.complete=true;
        await rejects(f.service.importBilibili(f.scope(),request),"sticker_import_storage_failed");
        const retry=await f.service.importBilibili(f.scope(),request); assert.equal(f.objects.size,1); assert.equal(f.videoOptions.length,1);
        await f.db.query("update account_media_assets set status='archived' where id=$1",[retry.asset.id]);
        await rejects(f.service.importBilibili(f.scope(),request),"sticker_import_asset_removed");
    } finally { await f.db.close(); }
});

test("missing optional schema and revoked autonomous permission fail closed", async () => {
    const missing = await fixture({migrate:false});
    try {
        assert.deepEqual(await missing.service.preferences(missing.scope()),{bilibili_enabled:false,schema_available:false});
        await rejects(missing.service.importBilibili(missing.scope(),input()),"sticker_import_schema_required");
        assert.equal(missing.videoOptions.length,0);
    } finally { await missing.db.close(); }
    const f = await fixture();
    try {
        await rejects(f.service.importBilibili(f.scope(),input(),{autonomous:true}),"sticker_import_disabled");
        await f.service.savePreferences(f.scope(),{bilibili_enabled:true});
        const entered=deferred(), release=deferred();
        const service=createBilibiliStickerImportService({...f.options,fetchImpl:async(...args)=>{entered.resolve();await release.promise;return f.options.fetchImpl(...args);}});
        const pending=service.importBilibili(f.scope(),input(),{autonomous:true});
        const outcome=rejects(pending,"sticker_import_disabled"); await entered.promise;
        await f.service.savePreferences(f.scope(),{bilibili_enabled:false}); release.resolve(); await outcome;
        assert.equal(f.objects.size,0);
        assert.equal((await f.service.preferences(f.scope(A,E))).bilibili_enabled,false);
    } finally { await f.db.close(); }
});

test("cover transport enforces host, type, redirect, byte limit and deadlines even when abort is ignored", async () => {
    for (const url of ["http://i0.hdslb.com/a.png","https://i0.hdslb.com.evil.test/a.png","https://127.0.0.1/a.png","https://x:y@example.test/a.png"]) assert.throws(()=>coverUrl(url),{code:"sticker_import_source_invalid"});
    const url="https://i0.hdslb.com/a.png";
    await rejects(downloadCover(url,{fetchImpl:async()=>new Response("x",{status:302,headers:{location:"http://127.0.0.1"}})}),"sticker_import_download_failed");
    await rejects(downloadCover(url,{fetchImpl:async()=>new Response("<svg/>",{headers:{"content-type":"image/svg+xml"}})}),"sticker_import_source_invalid");
    await rejects(downloadCover(url,{fetchImpl:async()=>new Response("x",{headers:{"content-type":"image/png","content-length":String(13*1024*1024)}})}),"sticker_import_too_large");
    await rejects(downloadCover(url,{timeoutMs:5,fetchImpl:()=>new Promise(()=>{})}),"sticker_import_timeout");
    await rejects(downloadCover(url,{timeoutMs:5,fetchImpl:async()=>({ok:true,status:200,headers:new Headers({"content-type":"image/png"}),body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})})}})}),"sticker_import_timeout");
});

test("AI imports and selects one image, blocks concurrent selection and reuses one request ID per turn", async () => {
    const f=await fixture();
    try {
        const selector=createCompanionStickerSelector(), scope=f.scope(), turnId=randomUUID();
        const disabled=createBilibiliStickerChatRuntime({service:f.service,scope,turnId,selector}); assert.equal(disabled.tools.length,0);
        assert.equal((await disabled.executeTool({name:"import_bilibili_sticker",arguments:JSON.stringify({bvid})})).code,"sticker_import_disabled");
        await f.service.savePreferences(scope,{bilibili_enabled:true});
        const started=deferred(), release=deferred();
        const service={...f.service,async importBilibili(...args){started.resolve();await release.promise;return f.service.importBilibili(...args);}};
        const runtime=createBilibiliStickerChatRuntime({service,scope,turnId,selector,permission:await service.preferences(scope)}); assert.equal(runtime.tools.length,1);
        const pending=runtime.executeTool({name:"import_bilibili_sticker",arguments:JSON.stringify({bvid})}); await started.promise;
        assert.equal((await runtime.executeTool({name:"select_companion_sticker",arguments:'{"sticker_id":"bear-hug"}'})).code,"sticker_import_busy");
        release.resolve(); const result=await pending; assert.equal(result.ok,true); assert.deepEqual(companionStickerToolCalls(selector),{custom_sticker_id:result.custom_sticker_id});
        assert.equal((await runtime.executeTool({name:"import_bilibili_sticker",arguments:JSON.stringify({bvid:otherVideo})})).ok,false);
        assert.equal(toolRequestId(scope,turnId,bvid),toolRequestId(scope,turnId,otherVideo));
        assert.notEqual(toolRequestId(scope,turnId,bvid),toolRequestId(f.scope(B,D),turnId,bvid));
        const fresh=createBilibiliStickerChatRuntime({service:f.service,scope,turnId,selector:createCompanionStickerSelector(),permission:await f.service.preferences(scope)});
        assert.equal((await fresh.executeTool({name:"import_bilibili_sticker",arguments:JSON.stringify({bvid,client_request_id:randomUUID()})})).code,"sticker_import_request_invalid");
    } finally { await f.db.close(); }
});

test("the actual server dispatcher attaches imported UUID metadata to the reply", async () => {
    const f=await fixture();
    try {
        const scope=f.scope(); await f.service.savePreferences(scope,{bilibili_enabled:true});
        const code=fs.readFileSync(require.resolve("../server"),"utf8");
        const start=code.indexOf("function createChatToolExecutor("),end=code.indexOf("function previousReplySuggestionsFromMessages",start);
        const context={supabase:{},stickerImports:f.service,xhsStickerImports:null,createBilibiliStickerChatRuntime,createXhsStickerChatRuntime,createCompanionStickerSelector,createCompanionStickerTool,
            createCompanionActivities:()=>({getActions:()=>[]}),COMPANION_ACTIVITY_TOOL:{name:"activity"},UPDATE_COMPANION_STATUS_TOOL:{name:"status"},
            SELECT_COMPANION_STICKER_TOOL,BILI_SEARCH_TOOL:{name:"bili_search"},createReplySuggestionSelector:()=>({}),sanitizeCompanionStatusSnapshot:v=>v};
        vm.runInNewContext(code.slice(start,end),context);
        const runtime=context.createChatToolExecutor("fictional-conversation",{},randomUUID(),null,scope.db,"",[],scope,null,null,null,"",null,null,null,null,await f.service.preferences(scope));
        assert.equal(runtime.getStickerImportTools().length,2);
        const result=await runtime.executeTool({name:"import_bilibili_sticker",arguments:JSON.stringify({bvid})});
        assert.equal(result.ok,true);assert.deepEqual(companionStickerToolCalls(runtime),{custom_sticker_id:result.custom_sticker_id});
        assert.doesNotMatch(JSON.stringify(result),/cookie|storage_path|hdslb/);
    } finally {await f.db.close();}
});

test("a failed Bili source allows an alternative in the same turn without deleting another tenant receipt", async () => {
    const f=await fixture();
    try {
        const scope=f.scope();await f.service.savePreferences(scope,{bilibili_enabled:true});let sourceCalls=0;
        const service=createBilibiliStickerImportService({...f.options,getVideo:async(id,...args)=>{
            sourceCalls++;
            if(id===bvid){
                const row=(await f.db.query("select * from sticker_import_receipts where user_id=$1",[A])).rows[0];
                const seeded=await f.scope(B,D).db.from("sticker_import_receipts").insert({client_request_id:row.client_request_id,provider:row.provider,resource_id:row.resource_id,request_hash:row.request_hash,planned_asset_id:randomUUID(),state:"pending"});assert.equal(seeded.error,null);
                throw Error("fictional unavailable source");
            }
            return f.options.getVideo(id,...args);
        }});
        const runtime=createBilibiliStickerChatRuntime({service,scope,turnId:randomUUID(),selector:createCompanionStickerSelector(),permission:await service.preferences(scope)});
        const run=id=>runtime.executeTool({name:"import_bilibili_sticker",arguments:JSON.stringify({bvid:id})});
        assert.equal((await run(bvid)).code,"sticker_import_source_unavailable");
        assert.equal((await f.db.query("select count(*)::int n from sticker_import_receipts where user_id=$1",[A])).rows[0].n,0);
        assert.equal((await f.db.query("select count(*)::int n from sticker_import_receipts where user_id=$1",[B])).rows[0].n,1);
        assert.equal((await run(otherVideo)).ok,true);assert.equal((await run(bvid)).ok,false);assert.equal(sourceCalls,2);assert.equal(f.objects.size,1);
    } finally {await f.db.close();}
});

test("an uncertain Bili upload blocks changing the turn resource and recovers its original UUID", async () => {
    const f=await fixture();
    try {
        const scope=f.scope();await f.service.savePreferences(scope,{bilibili_enabled:true});
        const runtime=createBilibiliStickerChatRuntime({service:f.service,scope,turnId:randomUUID(),selector:createCompanionStickerSelector(),permission:await f.service.preferences(scope)});
        const run=id=>runtime.executeTool({name:"import_bilibili_sticker",arguments:JSON.stringify({bvid:id})});
        f.faults.complete=true;assert.equal((await run(bvid)).code,"sticker_import_storage_failed");assert.equal(f.objects.size,1);
        assert.equal((await run(otherVideo)).code,"sticker_import_request_conflict");assert.equal(f.videoOptions.length,1);
        const recovered=await run(bvid);assert.equal(recovered.ok,true);assert.equal(f.objects.size,1);assert.equal(f.videoOptions.length,1);
        assert.equal((await f.db.query("select planned_asset_id from sticker_import_receipts where user_id=$1",[A])).rows[0].planned_asset_id,recovered.custom_sticker_id);
    } finally {await f.db.close();}
});

test("a stale concurrent Bili lookup cannot upload after its empty source receipt is replaced", async () => {
    const f=await fixture(),firstStarted=deferred(),secondStarted=deferred(),failFirst=deferred(),finishSecond=deferred();let stale;
    try {
        const firstService=createBilibiliStickerImportService({...f.options,getVideo:async()=>{firstStarted.resolve();await failFirst.promise;throw Error("fictional missing source");}});
        const secondService=createBilibiliStickerImportService({...f.options,getVideo:async(...args)=>{secondStarted.resolve();await finishSecond.promise;return f.options.getVideo(...args);}});
        const request=input(),first=firstService.importBilibili(f.scope(),request);await firstStarted.promise;
        stale=secondService.importBilibili(f.scope(),request).then(value=>({value}),error=>({error}));await secondStarted.promise;
        failFirst.resolve();await rejects(first,"sticker_import_source_unavailable");
        const replacement=await f.service.importBilibili(f.scope(),{...request,bvid:otherVideo});finishSecond.resolve();
        assert.equal((await stale).error?.code,"sticker_import_storage_failed");assert.equal(f.objects.size,1);
        assert.equal((await f.db.query("select resource_id from sticker_import_receipts where user_id=$1",[A])).rows[0].resource_id,otherVideo);assert.equal(replacement.replayed,false);
    } finally {failFirst.resolve();finishSecond.resolve();if(stale)await stale;await f.db.close();}
});
