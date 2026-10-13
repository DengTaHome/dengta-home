const assert = require("node:assert/strict");
const fs = require("node:fs");
const express = require("express");
const { PGlite } = require("@electric-sql/pglite");
const { createMusicCookieRouter } = require("../routes/v2/music-cookie");
const { createRequestScope } = require("../services/request-scope");
const userA = "11111111-1111-4111-8111-111111111111", userB = "22222222-2222-4222-8222-222222222222";
const companionA = "33333333-3333-4333-8333-333333333333", companionB = "44444444-4444-4444-8444-444444444444";
const id = "55555555-5555-4555-8555-555555555555", superseded = "66666666-6666-4666-8666-666666666666", other = "77777777-7777-4777-8777-777777777777";
const tokenA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tokenB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function main() {
 const pg = new PGlite(); let server, fail = false;
 try {
  await pg.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';");
  await pg.exec(fs.readFileSync("supabase/055_ai_music_play_requests.sql", "utf8"));
  await pg.exec("grant all on public.ai_music_play_requests to service_role, authenticated;");
  await pg.query("insert into public.ai_music_play_requests(id,user_id,companion_id,song_id,status,title) values ($1,$2,$3,'123','pending','Fictional song'),($4,$2,$3,'234','superseded',''),($5,$6,$7,'345','pending','')", [id,userA,companionA,superseded,other,userB,companionB]);
  const before = (await pg.query("select * from public.ai_music_play_requests order by id")).rows;
  const migration = fs.readFileSync("supabase/migrations/20261001064300_ai_music_delivery_claim.sql", "utf8");
  await pg.exec(migration); await pg.exec(migration);
  const after = (await pg.query("select * from public.ai_music_play_requests order by id")).rows;
  assert.deepEqual(after.map(({delivery_token,delivery_claimed_at,delivery_committed_at,...row})=>row), before, "additive migration preserves rows verbatim");
  const privileges = (await pg.query("select has_table_privilege('authenticated','public.ai_music_play_requests','select') as read, has_table_privilege('authenticated','public.ai_music_play_requests','update') as write, has_table_privilege('authenticated','public.ai_music_play_requests','truncate') as truncate, has_function_privilege('authenticated','public.apply_ai_music_delivery(uuid,uuid,uuid,uuid,text,text,text)','execute') as execute")).rows[0];
  assert.deepEqual(privileges,{read:true,write:false,truncate:false,execute:false});
  await pg.exec("set role authenticated");
  await assert.rejects(pg.query("select public.apply_ai_music_delivery($1,$2,$3,$4,'claim')",[userA,companionA,id,tokenA]), /permission denied/);
  await assert.rejects(pg.query("update public.ai_music_play_requests set status='played'"), /permission denied/);
  await pg.exec("reset role; set role service_role");
  class Query {
   constructor() { this.filters=[]; }
   select() { return this; } eq(key,value) { this.filters.push([key,value]); return this; }
   is(key,value) { assert.equal(value,null); this.filters.push([key,null]); return this; }
   order() { return this; } limit() { return this; }
   async result() {
    if(fail) return {error:Object.assign(Error('fixture database failure'),{code:'fixture_db_failed'})};
    const args=[]; const where=this.filters.map(([key,value])=>{assert.ok(['user_id','companion_id','status','delivery_committed_at'].includes(key)); if(value===null)return key+' is null';args.push(value);return key+'=$'+args.length;}).join(' and ');
    return {data:(await pg.query("select id,song_id,title,artist,cover_url,status,error,created_at from public.ai_music_play_requests where "+where+" order by created_at limit 10",args)).rows};
   }
   then(resolve,reject) { return this.result().then(resolve,reject); }
  }
  const db = { from(table) {assert.equal(table,'ai_music_play_requests');return {select:()=>new Query()};}, async rpc(name,p) {
   assert.equal(name,'apply_ai_music_delivery'); if(fail)return {error:Object.assign(Error('fixture database failure'),{code:'fixture_db_failed'})};
   return {data:(await pg.query('select public.apply_ai_music_delivery($1,$2,$3,$4,$5,$6,$7) as receipt',[p.p_user_id,p.p_companion_id,p.p_request_id,p.p_delivery_token,p.p_action,p.p_status,p.p_error])).rows[0].receipt};
  }};
  function scope(userId,companionId) {const companion={id:companionId,user_id:userId,status:'active'};return createRequestScope({adminSupabase:db,user:{id:userId},profile:{id:userId,role:'owner',status:'active'},companions:[companion],companion});}
  const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.headers.authorization==='Bearer fixture-a')req.scope=scope(userA,companionA);if(req.headers.authorization==='Bearer fixture-b')req.scope=scope(userB,companionB);next();});
  app.use('/music',createMusicCookieRouter({neteaseCookie:{}}));app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:error.code,message:error.message}));
  server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const base=`http://127.0.0.1:${server.address().port}/music/providers/netease/ai-play-requests`;
  const send=(requestId,action='result',body={},account='a')=>fetch(`${base}/${requestId}/${action}`,{method:'POST',headers:{Authorization:`Bearer fixture-${account}`,'Content-Type':'application/json'},body:JSON.stringify({delivery_token:tokenA,...body})});
  assert.equal((await fetch(base)).status,401);
  const legacy=await fetch(base,{headers:{Authorization:'Bearer fixture-a'}});assert.deepEqual(await legacy.json(),{requests:[],update_required:true});
  const pending=await fetch(base+'?delivery=claim-v1',{headers:{Authorization:'Bearer fixture-a'}});assert.match(pending.headers.get('cache-control'),/no-store/);const list=await pending.json();assert.equal(list.delivery_protocol,'claim-v1');assert.deepEqual(list.requests.map(row=>row.id),[id]);assert.ok(!('delivery_token' in list.requests[0]));
  assert.equal((await send('invalid')).status,400);assert.equal((await send(id,'result',{status:'unknown'})).status,400);
  assert.equal((await send(id,'result',{delivery_token:''})).status,409);
  const racers=await Promise.all([send(id,'claim'),send(id,'claim',{delivery_token:tokenB})]);const claims=await Promise.all(racers.map(r=>r.json()));assert.equal(claims.filter(c=>c.claimed).length,1);
  const winner=claims[0].claimed?tokenA:tokenB,loser=winner===tokenA?tokenB:tokenA;
  assert.equal((await send(id,'commit',{delivery_token:loser})).status,409);
  const committed=await send(id,'commit',{delivery_token:winner});assert.equal((await committed.json()).replayed,false);
  assert.equal((await (await send(id,'commit',{delivery_token:winner})).json()).replayed,true,'commit replay cannot authorize another native launch');
  await pg.query("update public.ai_music_play_requests set delivery_claimed_at=now()-interval '2 minutes' where id=$1",[id]);
  assert.equal((await (await send(id,'claim',{delivery_token:loser})).json()).claimed,false,'committed requests never become reclaimable');
  assert.equal((await send(other,'claim')).status,404);assert.equal((await send(superseded,'claim')).status,409);
  const mixed='88888888-8888-4888-8888-888888888888';await pg.query("insert into public.ai_music_play_requests(id,user_id,companion_id,song_id) values($1,$2,$3,'456')",[mixed,userA,companionB]);assert.equal((await send(mixed,'claim')).status,404);
  assert.equal((await send(id,'result',{delivery_token:winner,status:'played'})).status,200);const processed=(await pg.query('select processed_at from public.ai_music_play_requests where id=$1',[id])).rows;
  assert.equal((await (await send(id,'result',{delivery_token:winner,status:'played'})).json()).replayed,true);assert.deepEqual((await pg.query('select processed_at from public.ai_music_play_requests where id=$1',[id])).rows,processed);
  assert.equal((await send(id,'result',{delivery_token:winner,status:'failed'})).status,409);
  await send(other,'claim',{},'b');assert.equal((await send(other,'result',{status:'failed'},'b')).status,409);
  await pg.query("update public.ai_music_play_requests set delivery_claimed_at=now()-interval '2 minutes' where id=$1",[other]);
  assert.equal((await send(other,'commit',{},'b')).status,409);assert.equal((await (await send(other,'claim',{delivery_token:tokenB},'b')).json()).claimed,true);
  await send(other,'commit',{delivery_token:tokenB},'b');await send(other,'result',{delivery_token:tokenB,status:'failed',error:'Authorization: Bearer fictional-private-data'},'b');assert.equal((await pg.query('select error from public.ai_music_play_requests where id=$1',[other])).rows[0].error,'music_ai_open_failed');
  fail=true;assert.equal((await send(id,'claim')).status,500);
  console.log('AI music SQL + routes: repeat migration, row preservation, least privileges, atomic claim/commit, expired leases, no committed takeover, terminal receipts, privacy and tenant isolation passed (PGlite serializes transactions; live lock concurrency is separate)');
 } finally {if(server)await new Promise(resolve=>server.close(resolve));await pg.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
