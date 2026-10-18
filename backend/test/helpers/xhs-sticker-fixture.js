const assert=require('node:assert/strict'),fs=require('node:fs'),sharp=require('sharp');
const {PGlite}=require('@electric-sql/pglite');
const {createRequestScope}=require('../../services/request-scope');
const {createXhsStickerImportService}=require('../../services/xhs-sticker-import');
const {createBilibiliStickerImportService}=require('../../services/bilibili-sticker-import');
const base = fs.readFileSync(require.resolve("../../supabase/drafts/bilibili_sticker_import.sql"), "utf8"), migration = fs.readFileSync(require.resolve("../../supabase/drafts/xhs_sticker_import.sql"), "utf8");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333", D = "44444444-4444-4444-8444-444444444444", E = "55555555-5555-4555-8555-555555555555";
const note = "111111111111111111111111", other = "222222222222222222222222", image = "https://sns-webpic-qc.xhscdn.com/fictional.webp";
function client(db, faults) {
    const quote = name => { assert.match(name, /^[a-z_][a-z_0-9]*$/); return `"${name}"`; };
    return { from(table) {
        let method = "select", values, fields = "*", one = false; const filters = [];
        const q = { select(v = "*") { fields = v; return q; }, insert(v) { values = v; method = "insert"; return q; }, update(v) { values = v; method = "update"; return q; }, delete() { method = "delete"; return q; }, eq(k,v) { filters.push([k,v]); return q; }, single() { one = true; return q; }, maybeSingle() { one = true; return q; },
            then(resolve,reject) { return (async () => { try {
                if (faults.complete && table === "sticker_import_receipts" && values?.state === "complete") { faults.complete = false; return { error: { code: "XX000" } }; }
                const params = [], bind = v => { params.push(v); return `$${params.length}`; }, projection = fields === "*" ? "*" : fields.split(",").map(v => quote(v.trim())).join(",");
                let sql;
                if (method === "insert") { const keys = Object.keys(values); sql = `insert into ${quote(table)} (${keys.map(quote)}) values (${keys.map(k => bind(values[k]))}) returning ${projection}`; }
                else { sql = method === "select" ? `select ${projection} from ${quote(table)}` : method === "delete" ? `delete from ${quote(table)}` : `update ${quote(table)} set ${Object.entries(values).map(([k,v]) => `${quote(k)}=${bind(v)}`).join(",")}`;
                    if (filters.length) sql += ` where ${filters.map(([k,v]) => `${quote(k)}=${bind(v)}`).join(" and ")}`; if (method !== "select") sql += ` returning ${projection}`; }
                const rows = (await db.query(sql,params)).rows; return { data: one ? rows[0] || null : rows, error: null };
            } catch(error) { return {error}; } })().then(resolve,reject); } }; return q;
    } };
}
async function fixture({ upgrade = true } = {}) {
    const db = new PGlite(), objects = new Map(), calls = [], faults = {};
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table companions(user_id uuid,id uuid,primary key(user_id,id));insert into companions values('${A}','${C}'),('${B}','${D}'),('${A}','${E}');
      create table settings(user_id uuid,companion_id uuid,unified_system_prompt text,user_details text);insert into settings values('${A}','${C}','fictional exact persona~','fictional exact details');
      create table account_media_assets(id uuid primary key,user_id uuid,companion_id uuid,purpose text,status text,display_name text,alt_text text,mood_tags text[],storage_bucket text,storage_path text,mime_type text,byte_size bigint,sha256 text,width int,height int,created_at timestamptz default now(),updated_at timestamptz default now(),archived_at timestamptz);`);
    await db.exec(base); if (upgrade) await db.exec(migration);
    const admin = client(db,faults), scope = (userId = A, companionId = C) => { const companion = { id: companionId,user_id:userId,status:"active" }; return createRequestScope({adminSupabase:admin,user:{id:userId},profile:{id:userId,role:"member",status:"active"},companion,companions:[companion]}); };
    const png = await sharp({create:{width:20,height:20,channels:4,background:"cyan"}}).png().toBuffer();
    const storage = {from:()=>({upload:async(path,buffer)=>{objects.set(path,buffer);return {};},remove:async(paths)=>{for(const path of paths)objects.delete(path);return {};},download:async(path)=>({data:{arrayBuffer:async()=>objects.get(path)}})})};
    const xhsClient = {forScope:current=>({stickerSource:async id=>{calls.push([current.userId,current.companionId,id]);return {note_id:id,cover:image,title:"虚构开心表情~",creator:"虚构作者"};},search:async()=>({items:[{note_id:note,title:"虚构结果",author:"虚构作者",cover:image,url:`https://www.xiaohongshu.com/explore/${note}`}],page:1})})};
    const options = {storage,xhsClient,fetchImpl:async(url,init)=>{assert.equal(url,image);assert.equal(init.headers.Cookie,undefined);assert.equal(init.headers["x-api-key"],undefined);assert.equal(init.redirect,"error");return new Response(png,{headers:{"content-type":"image/png"}});}};
    return {db,scope,objects,calls,faults,options,xhsClient,storage,service:createXhsStickerImportService(options),bili:createBilibiliStickerImportService({storage})};
}

module.exports={fixture,base,migration,A,B,C,D,E,note,other,image};
