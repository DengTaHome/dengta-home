const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), express = require("express"), vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { createXhsStickerImportService, coverUrl } = require("../services/xhs-sticker-import");
const { createXhsStickerChatRuntime } = require("../services/xhs-sticker-chat");
const { createBilibiliStickerChatRuntime } = require("../services/bilibili-sticker-chat");
const { createCompanionStickerSelector, createCompanionStickerTool, SELECT_COMPANION_STICKER_TOOL, companionStickerToolCalls } = require("../services/companion-stickers");
const { createPrivateMediaRouter } = require("../routes/v2/private-media");
const {fixture,base,migration,A,B,C,D,E,note,other,image}=require('./helpers/xhs-sticker-fixture');
const request = extra => ({ note_id: note, client_request_id: randomUUID(), ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test("XHS draft repeats without changing Bili preferences, user text or direct-role isolation", async () => {
    const f = await fixture({upgrade:false});
    try {
        await f.bili.savePreferences(f.scope(),{bilibili_enabled:true});
        assert.deepEqual(await f.service.preferences(f.scope()),{xhs_enabled:false,schema_available:false});
        await f.db.exec(migration);await f.db.exec(base);await f.db.exec(migration);
        assert.deepEqual(await f.bili.preferences(f.scope()),{bilibili_enabled:true,schema_available:true});
        assert.deepEqual(await f.service.preferences(f.scope()),{xhs_enabled:false,schema_available:true});
        assert.deepEqual((await f.db.query("select unified_system_prompt,user_details from settings")).rows,[{unified_system_prompt:"fictional exact persona~",user_details:"fictional exact details"}]);
        await assert.rejects(f.db.query("insert into sticker_import_preferences(user_id,companion_id) values($1,$2)",[B,C]),{code:"23503"});
        for(const role of ["anon","authenticated"]){await f.db.exec(`set role ${role}`);await assert.rejects(f.db.exec("select * from sticker_import_receipts"),{code:"42501"});await f.db.exec("reset role");}
        await assert.rejects(f.db.query("insert into sticker_import_receipts(user_id,companion_id,client_request_id,provider,resource_id,request_hash,planned_asset_id) values($1,$2,$3,'bilibili',$4,$5,$6)",[A,C,randomUUID(),note,"a".repeat(64),randomUUID()]),{code:"23514"});
    }finally{await f.db.close();}
});
test("real private-media routes import scoped XHS covers, replay durably and report their exact source",async()=>{
    const f=await fixture();let server;
    try{
        const app=express();app.use(express.json());app.use((req,_res,next)=>{if(!req.headers["x-missing"])req.scope=req.headers["x-other"]?f.scope(B,D):req.headers["x-companion"]?f.scope(A,E):f.scope();next();});
        app.use(createPrivateMediaRouter({storage:f.storage,stickerImports:f.bili,xhsStickerImports:f.service,xhsClient:f.xhsClient}));app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:error.code}));
        server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));const url=`http://127.0.0.1:${server.address().port}`,input=request();
        const post=(headers={},value=input)=>fetch(url+"/sticker-import/xhs",{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(value)});
        assert.equal((await post({"x-missing":"1"})).status,401);
        assert.equal((await fetch(url+"/sticker-import/xhs/search?keyword="+encodeURIComponent("开心~"))).status,200);
        const first=await post();assert.equal(first.status,201);assert.equal(first.headers.get("cache-control"),"private, no-store");const receipt=await first.json();
        assert.equal(receipt.source.provider,"xiaohongshu");assert.equal(receipt.source.note_id,note);assert.equal(receipt.asset.mime_type,"image/webp");assert.ok(receipt.source.title.endsWith("~"));
        assert.doesNotMatch(JSON.stringify(receipt),/xhscdn|storage_path|cookie|user_id/);
        assert.equal((await(await post()).json()).asset.id,receipt.asset.id);assert.equal(f.objects.size,1);assert.equal(f.calls.length,1);
        assert.equal((await(await fetch(url+`/assets/${receipt.asset.id}/source`)).json()).source.provider,"xiaohongshu");
        for(const headers of [{"x-other":"1"},{"x-companion":"1"}])assert.equal((await fetch(url+`/assets/${receipt.asset.id}/content`,{headers})).status,404);
        assert.equal((await post({}, {...input,note_id:other})).status,409);assert.equal((await post({}, {...request(),cover_url:"http://127.0.0.1/private"})).status,400);
        await f.db.query("update account_media_assets set status='archived' where id=$1",[receipt.asset.id]);await assert.rejects(f.service.importXhs(f.scope(),input),{code:"sticker_import_asset_removed"});
    }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.db.close();}
});
test("concurrent instances and uncertain completion keep one image and recover without a live search cache",async()=>{
    const f=await fixture();
    try{
        const input=request(),second=createXhsStickerImportService(f.options);const pair=await Promise.all([f.service.importXhs(f.scope(),input),second.importXhs(f.scope(),input)]);
        assert.equal(pair[0].asset.id,pair[1].asset.id);assert.equal(f.objects.size,1);
        f.faults.complete=true;const retry=request({note_id:other});await assert.rejects(f.service.importXhs(f.scope(),retry),{code:"sticker_import_storage_failed"});const calls=f.calls.length;
        const offline=createXhsStickerImportService({...f.options,xhsClient:{forScope(){throw Error("cache lost");}}});const recovered=await offline.importXhs(f.scope(),retry);assert.equal(recovered.replayed,true);assert.equal(f.calls.length,calls);assert.equal(f.objects.size,2);
    }finally{await f.db.close();}
});
test("autonomous imports require current permission and a revoke during download prevents upload",async()=>{
    const f=await fixture(),downloaded=deferred(),release=deferred();
    try{
        await assert.rejects(f.service.importXhs(f.scope(),request(),{autonomous:true}),{code:"sticker_import_disabled"});assert.equal(f.calls.length,0);
        await f.service.savePreferences(f.scope(),{xhs_enabled:true});
        const service=createXhsStickerImportService({...f.options,fetchImpl:async(...args)=>{downloaded.resolve();await release.promise;return f.options.fetchImpl(...args);}});
        const pending=service.importXhs(f.scope(),request(),{autonomous:true});await downloaded.promise;await f.service.savePreferences(f.scope(),{xhs_enabled:false});release.resolve();await assert.rejects(pending,{code:"sticker_import_disabled"});assert.equal(f.objects.size,0);
        assert.deepEqual(await f.bili.preferences(f.scope()),{bilibili_enabled:false,schema_available:true});
    }finally{release.resolve();await f.db.close();}
});
test("upstream login and provenance failures stay precise; arbitrary image hosts are rejected",async()=>{
    const f=await fixture();
    try{
        const legacy=createXhsStickerImportService({...f.options,xhsClient:{me(){assert.fail("shared client cannot be used");}}});await assert.rejects(legacy.importXhs(f.scope(),request()),{code:"xhs_session_isolation_required"});
        for(const code of ["cookie_expired","verification_required","xhs_note_lookup_required"]){const service=createXhsStickerImportService({...f.options,xhsClient:{forScope:()=>({stickerSource:async()=>{throw Object.assign(Error("safe fixture"),{code,status:409});}})}});await assert.rejects(service.importXhs(f.scope(),request()),{code});}
        for(const url of ["http://127.0.0.1/private","https://xhscdn.com.untrusted.invalid/pic","https://u:p@example.test/pic"])assert.throws(()=>coverUrl(url),{code:"sticker_import_source_invalid"});
    }finally{await f.db.close();}
});
test("the actual dispatcher exposes permission-gated XHS search and selects a saved private UUID",async()=>{
    const f=await fixture();
    try{
        await f.service.savePreferences(f.scope(),{xhs_enabled:true});const scope=f.scope(),code=fs.readFileSync(require.resolve("../server"),"utf8"),start=code.indexOf("function createChatToolExecutor("),end=code.indexOf("function previousReplySuggestionsFromMessages",start);
        const context={supabase:{},stickerImports:f.bili,xhsStickerImports:f.service,createBilibiliStickerChatRuntime,createXhsStickerChatRuntime,createCompanionStickerSelector,createCompanionStickerTool,createCompanionActivities:()=>({getActions:()=>[]}),COMPANION_ACTIVITY_TOOL:{name:"activity"},UPDATE_COMPANION_STATUS_TOOL:{name:"status"},SELECT_COMPANION_STICKER_TOOL,BILI_SEARCH_TOOL:{name:"bili_search"},XHS_SEARCH_TOOL:{name:"xhs_search"},createReplySuggestionSelector:()=>({}),sanitizeCompanionStatusSnapshot:v=>v};
        vm.runInNewContext(code.slice(start,end),context);const runtime=context.createChatToolExecutor("fictional",{},randomUUID(),null,scope.db,"",[],scope,null,null,null,"",null,null,null,null,{xhs_enabled:true,xhs_schema_available:true});
        assert.equal(runtime.getStickerImportTools().map(tool=>tool.name).join(","),"import_xhs_sticker,xhs_search");const result=await runtime.executeTool({name:"import_xhs_sticker",arguments:JSON.stringify({note_id:note})});assert.equal(result.ok,true);assert.deepEqual(companionStickerToolCalls(runtime),{custom_sticker_id:result.custom_sticker_id});
        const second=await runtime.executeTool({name:"import_xhs_sticker",arguments:JSON.stringify({note_id:other})});assert.equal(second.ok,false);assert.equal(f.objects.size,1);
    }finally{await f.db.close();}
});
test("a shared chat gate prevents concurrent selection across Bili and XHS imports",async()=>{
    const hold=deferred(),selector=createCompanionStickerSelector(),scope={userId:A,companionId:C};let calls=0;
    const next={tools:[{name:"import_bilibili_sticker"}],async executeTool(){calls++;await hold.promise;return {ok:true};}};
    const runtime=createXhsStickerChatRuntime({service:{importXhs(){assert.fail("parallel provider must not import");}},scope,turnId:randomUUID(),selector,permission:{xhs_enabled:true,xhs_schema_available:true},next});
    const first=runtime.executeTool({name:"import_bilibili_sticker"});const second=await runtime.executeTool({name:"import_xhs_sticker",arguments:JSON.stringify({note_id:note})});assert.equal(second.code,"sticker_import_busy");hold.resolve();await first;assert.equal(calls,1);
});
test("a source-only failure releases the turn slot for an alternative without touching another tenant",async()=>{
    const f=await fixture();
    try{
        await f.service.savePreferences(f.scope(),{xhs_enabled:true});let sourceCalls=0;
        const service=createXhsStickerImportService({...f.options,xhsClient:{forScope:()=>({stickerSource:async id=>{
            sourceCalls++;
            if(id===note){
                const row=(await f.db.query("select * from sticker_import_receipts where user_id=$1",[A])).rows[0];
                const seeded=await f.scope(B,D).db.from("sticker_import_receipts").insert({client_request_id:row.client_request_id,provider:row.provider,resource_id:row.resource_id,request_hash:row.request_hash,planned_asset_id:randomUUID(),state:"pending"});assert.equal(seeded.error,null);
                throw Object.assign(Error("fixture source missing"),{code:"xhs_note_lookup_required",status:409});
            }
            return {note_id:id,cover:image,title:"fictional alternative",creator:"fictional author"};
        }})}}),selector=createCompanionStickerSelector();
        const runtime=createXhsStickerChatRuntime({service,scope:f.scope(),turnId:randomUUID(),selector,permission:{xhs_enabled:true,xhs_schema_available:true},next:{tools:[],executeTool:call=>selector.executeTool(call)}});
        const run=id=>runtime.executeTool({name:"import_xhs_sticker",arguments:JSON.stringify({note_id:id})});
        assert.equal((await run(note)).code,"xhs_note_lookup_required");
        assert.equal((await f.db.query("select count(*)::int as count from sticker_import_receipts where user_id=$1",[A])).rows[0].count,0);
        assert.equal((await f.db.query("select count(*)::int as count from sticker_import_receipts where user_id=$1",[B])).rows[0].count,1);
        assert.equal((await run(other)).ok,true);assert.equal((await run(note)).ok,false);assert.equal(sourceCalls,2);assert.equal(f.objects.size,1);
    }finally{await f.db.close();}
});
test("an uncertain completed import keeps its turn slot and recovers the same image",async()=>{
    const f=await fixture();
    try{
        await f.service.savePreferences(f.scope(),{xhs_enabled:true});const selector=createCompanionStickerSelector();
        const runtime=createXhsStickerChatRuntime({service:f.service,scope:f.scope(),turnId:randomUUID(),selector,permission:{xhs_enabled:true,xhs_schema_available:true},next:{tools:[],executeTool:call=>selector.executeTool(call)}});
        const run=id=>runtime.executeTool({name:"import_xhs_sticker",arguments:JSON.stringify({note_id:id})});
        f.faults.complete=true;assert.equal((await run(note)).code,"sticker_import_storage_failed");assert.equal(f.objects.size,1);
        assert.equal((await run(other)).code,"sticker_import_request_conflict");assert.equal(f.calls.length,1);
        const recovered=await run(note);assert.equal(recovered.ok,true);assert.equal(f.objects.size,1);assert.equal(f.calls.length,1);
        assert.equal((await f.db.query("select planned_asset_id from sticker_import_receipts where user_id=$1",[A])).rows[0].planned_asset_id,recovered.custom_sticker_id);
    }finally{await f.db.close();}
});
test("a concurrent old source lookup cannot upload after the failed source slot is replaced",async()=>{
    const f=await fixture(),firstStarted=deferred(),secondStarted=deferred(),failFirst=deferred(),finishSecond=deferred();
    let stale;
    try{
        const firstService=createXhsStickerImportService({...f.options,xhsClient:{forScope:()=>({stickerSource:async()=>{firstStarted.resolve();await failFirst.promise;throw Object.assign(Error("fixture missing source"),{code:"xhs_note_lookup_required",status:409});}})}});
        const secondService=createXhsStickerImportService({...f.options,xhsClient:{forScope:()=>({stickerSource:async id=>{secondStarted.resolve();await finishSecond.promise;return {note_id:id,cover:image,title:"fictional stale source",creator:"fictional"};}})}});
        const input=request(),first=firstService.importXhs(f.scope(),input);await firstStarted.promise;
        stale=secondService.importXhs(f.scope(),input).then(value=>({value}),error=>({error}));await secondStarted.promise;
        failFirst.resolve();await assert.rejects(first,{code:"xhs_note_lookup_required"});
        const replacement=await f.service.importXhs(f.scope(),{...input,note_id:other});finishSecond.resolve();
        assert.equal((await stale).error?.code,"sticker_import_storage_failed");assert.equal(f.objects.size,1);
        assert.equal((await f.db.query("select resource_id,planned_asset_id from sticker_import_receipts where user_id=$1",[A])).rows[0].resource_id,other);
        assert.equal(replacement.replayed,false);
    }finally{failFirst.resolve();finishSecond.resolve();if(stale)await stale;await f.db.close();}
});
