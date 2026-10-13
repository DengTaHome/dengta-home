const assert=require('node:assert/strict'),fs=require('node:fs'),express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const {createRequestScope}=require('../services/request-scope');
const {createSpecialDatesService}=require('../services/special-dates');
const {createDailyShotsService}=require('../services/daily-shots');
const {createAchievementsService}=require('../services/achievements');
const {createFunLabsService}=require('../services/fun-labs');
const {createInterestEngine}=require('../services/interest-engine');
const {createSpecialDatesRouter}=require('../routes/v2/special-dates');
const {createFunLabsRouter}=require('../routes/v2/fun-labs');
const {createXhsRouter}=require('../routes/v2/xhs');
const tables=new Set(['special_dates','daily_shots','compatibility_records','achievements','user_achievements','watch_events','interest_profiles','xhs_connections']);
const userA='11111111-1111-4111-8111-111111111111',userB='22222222-2222-4222-8222-222222222222',compA='33333333-3333-4333-8333-333333333333',compB='44444444-4444-4444-8444-444444444444';
async function main(){
 const pg=new PGlite();let server,fail='',noReceipt=false,fault='',missingFor='';const calls=[];
 const previousKey=process.env.MCP_ENCRYPTION_KEY;process.env.MCP_ENCRYPTION_KEY='fictional-fixture-encryption-key-000000000000';
 try{
  await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const file of ['050_special_dates.sql','051_fun_tables.sql','052_achievements_upgrade.sql','053_xhs_connections.sql','054_interests.sql','057_xhs_cookie_storage.sql','migrations/20261001072028_private_activity_rls.sql'])await pg.exec(fs.readFileSync('supabase/'+file,'utf8'));
  await pg.exec('set role service_role');
  const identifier=value=>{assert.match(value,/^[a-z_]+$/);return '"'+value+'"';};
  class Query{
   constructor(table){this.table=table;this.action='select';this.columns='*';this.filters=[];this.values=null;this.orders=[];this.maximum=100;}
   select(columns='*',opts={}){this.columns=columns;this.head=opts.head===true;return this;}
   insert(values){this.action='insert';this.values=Array.isArray(values)?values:[values];return this;}
   upsert(values,options={}){this.insert(values);this.conflict=options.onConflict;this.ignoreDuplicates=options.ignoreDuplicates;return this;}
   update(values){this.action='update';this.values=values;return this;}delete(){this.action='delete';return this;}
   eq(key,value){this.filters.push([key,value,'=']);return this;}gte(key,value){this.filters.push([key,value,'>=']);return this;}
   order(key,options={}){this.orders.push(identifier(key)+(options.ascending===true?' asc':' desc'));return this;}limit(value){this.maximum=value;return this;}
   async result(single=false){
    calls.push({table:this.table,action:this.action,filters:[...this.filters]});
    if(!tables.has(this.table))return {data:[],count:0,error:null};
    if(fault===this.table+':'+this.action)return {data:null,error:{code:'fixture_failed',message:'Authorization: Bearer fictional-private-error'}};
    if(this.table==='xhs_connections'&&fail===(this.action==='select'?'read':'write'))return {data:null,error:{code:'fixture_failed',message:'Authorization: Bearer fictional-private-error'}};
    try{
     const args=[],param=value=>{args.push(typeof value==='object'&&value!==null?JSON.stringify(value):value);return '$'+args.length;};
     const columns=this.columns==='*'?'*':this.columns.split(',').map(x=>identifier(x.trim())).join(',');
     let sql;
     if(this.action==='insert'){
      const keys=Object.keys(this.values[0]);sql=`insert into public.${this.table}(${keys.map(identifier).join(',')}) values ${this.values.map(value=>'('+keys.map(key=>param(value[key])).join(',')+')').join(',')} returning ${columns}`;
      if(this.conflict){const target=this.conflict.split(',').map(identifier).join(',');const update=this.ignoreDuplicates?'nothing':'update set '+keys.filter(key=>key!=='id').map(key=>identifier(key)+'=excluded.'+identifier(key)).join(',');sql=sql.replace(' returning ',` on conflict (${target}) do ${update} returning `);}
     }else{
      const prefix=this.action==='update'?`update public.${this.table} set `+Object.entries(this.values).map(([key,value])=>identifier(key)+'='+param(value)).join(','):this.action==='delete'?`delete from public.${this.table}`:`select ${this.head?'count(*)::int as count':columns} from public.${this.table}`;
      const where=this.filters.length?' where '+this.filters.map(([key,value,op])=>identifier(key)+op+param(value)).join(' and '):'';
      sql=prefix+where+(this.action==='select'&&!this.head?(this.orders.length?' order by '+this.orders.join(','):'')+' limit '+Number(this.maximum):this.action==='select'?'':' returning '+columns);
     }
     const rows=(await pg.query(sql,args)).rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?(key==='shot_date'?value.toISOString().slice(0,10):value.toISOString()):value])));
     if(this.table==='xhs_connections'&&noReceipt&&this.action!=='select')return {data:null,error:null};
     if(missingFor===this.table)return {data:null,error:null};
     return {data:single?rows[0]||null:rows,error:null,count:this.head?rows[0].count:undefined};
    }catch(error){return {data:null,error};}
   }
   single(){return this.result(true);}maybeSingle(){return this.result(true);}then(resolve,reject){return this.result().then(resolve,reject);}
  }
  const database={from:table=>new Query(table)};
  const scope=(userId,companionId)=>{const companion={id:companionId,user_id:userId,status:'active'};return createRequestScope({adminSupabase:database,user:{id:userId},profile:{id:userId,role:'owner',status:'active'},companions:[companion],companion});};
  const dates=createSpecialDatesService({database}),dailies=createDailyShotsService({database}),achievements=createAchievementsService({database}),funLabs=createFunLabsService({database}),interestEngine=createInterestEngine({database});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.headers.authorization==='Bearer fixture-a')req.scope=scope(userA,compA);if(req.headers.authorization==='Bearer fixture-b')req.scope=scope(userB,compB);if(req.headers.authorization==='Bearer fixture-c')req.scope=scope(userA,compB);next();});
  app.use('/dates',createSpecialDatesRouter({dates}));app.use('/fun',createFunLabsRouter({dailies,achievements,funLabs,interestEngine}));
  const client={configured:()=>false,me:async()=>{throw Object.assign(new Error('Fictional expired cookie'),{status:401,code:'cookie_expired'});}};app.use('/xhs',createXhsRouter({database,client}));app.use('/xhs-unconfigured',createXhsRouter({client}));
  app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:error.code,message:error.message}));
  server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,method='GET',body,account='a')=>fetch(base+path,{method,headers:{Authorization:`Bearer fixture-${account}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  for(const path of ['/dates','/fun/daily-shots','/fun/achievements','/fun/interests','/fun/compatibility','/xhs/me'])assert.equal((await fetch(base+path)).status,401);
  const saved=await request('/dates','POST',{title:'Fictional anniversary',date:'2026-10-01',user_id:userB,companion_id:compB});assert.equal(saved.status,200);const date=(await saved.json()).date;assert.equal(date.user_id,userA);assert.equal(date.companion_id,compA);
  assert.equal((await request('/dates')).headers.get('cache-control'),'private, no-store');assert.equal((await (await request('/dates')).json()).dates.length,1);
  assert.equal((await (await request('/dates','GET',undefined,'b')).json()).dates.length,0);assert.equal((await (await request('/dates','GET',undefined,'c')).json()).dates.length,0);
  assert.equal((await request('/dates/'+date.id,'DELETE',undefined,'b')).status,404);
  await dailies.add(scope(userA,compA),{note:'Fictional photo note'});await dailies.add(scope(userB,compB),{note:'Other fictional photo'});
  assert.equal((await (await request('/fun/daily-shots')).json()).today.note,'Fictional photo note');assert.equal((await (await request('/fun/daily-shots','GET',undefined,'c')).json()).today,null);
  const custom=await (await request('/fun/achievements/custom','POST',{title:'Fictional award'})).json();const award=custom.achievement;
  assert.equal((await request('/fun/achievements/'+encodeURIComponent(award.code)+'/unlock','POST',{})).status,200);
  assert.equal((await request('/fun/achievements/custom/'+award.id,'DELETE',undefined,'b')).status,404);
  const awards=await (await request('/fun/achievements')).json();assert.ok(awards.achievements.some(x=>x.title==='Fictional award'&&x.unlocked));
  const otherAwards=await (await request('/fun/achievements','GET',undefined,'b')).json();assert.ok(!otherAwards.achievements.some(x=>x.title==='Fictional award'));
  await funLabs.saveCompatibility(scope(userA,compA),{score:87,comment:'Fictional match'});assert.equal((await (await request('/fun/compatibility')).json()).records[0].score,87);assert.equal((await (await request('/fun/compatibility','GET',undefined,'b')).json()).records.length,0);
  assert.equal((await request('/fun/watch','POST',{title:'虚构天文纪录片',watched_seconds:60})).status,200);
  const profile=await (await request('/fun/interests')).json();assert.ok(profile.profile.interests.length>0);assert.equal(profile.profile.recent.length,1);
  assert.equal((await (await request('/fun/interests','GET',undefined,'b')).json()).profile.recent.length,0);
  const firstRequest='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',watchInput={request_id:firstRequest,title:'虚构宇宙纪录片',source_url:'https://example.test/fictional',watched_seconds:90};
  const parallel=await Promise.all([request('/fun/watch','POST',watchInput),request('/fun/watch','POST',watchInput)]);const receipts=await Promise.all(parallel.map(response=>{assert.equal(response.status,200);return response.json();}));
  assert.equal(receipts[0].recorded.event_id,receipts[1].recorded.event_id);assert.ok(receipts.some(value=>value.recorded.replayed));
  assert.equal((await pg.query('select count(*)::int as total from watch_events where id=$1',[receipts[0].recorded.event_id])).rows[0].total,1);
  const replay=await (await request('/fun/watch','POST',watchInput)).json();assert.equal(replay.recorded.replayed,true);
  assert.equal((await request('/fun/watch','POST',{...watchInput,title:'Changed fictional title'})).status,409);
  assert.equal((await request('/fun/watch','POST',{...watchInput,request_id:'invalid'})).status,400);
  assert.equal((await request('/fun/watch','POST',{...watchInput,title:''})).status,400);
  const otherReceipt=await (await request('/fun/watch','POST',watchInput,'b')).json();assert.notEqual(otherReceipt.recorded.event_id,receipts[0].recorded.event_id);
  const otherCompReceipt=await (await request('/fun/watch','POST',watchInput,'c')).json();assert.notEqual(otherCompReceipt.recorded.event_id,receipts[0].recorded.event_id);
  fault='interest_profiles:insert';const partial=await (await request('/fun/watch','POST',{...watchInput,request_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})).json();assert.equal(partial.recorded.recorded,true);assert.equal(partial.recorded.profile_updated,false);assert.equal(partial.recorded.warning.code,'interest_profile_save_failed');assert.doesNotMatch(JSON.stringify(partial),/fictional-private-error|Bearer/);fault='';
  const recovered=await (await request('/fun/watch','POST',{...watchInput,request_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})).json();assert.equal(recovered.recorded.replayed,true);assert.equal(recovered.recorded.profile_updated,true);assert.equal(recovered.recorded.event_id,partial.recorded.event_id);
  const savedCount=async()=>Number((await pg.query('select count(*)::int as total from watch_events')).rows[0].total);const countBefore=await savedCount();
  fault='watch_events:insert';const failedWatch=await request('/fun/watch','POST',{...watchInput,request_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});assert.equal(failedWatch.status,503);assert.equal((await failedWatch.json()).code,'watch_save_failed');assert.equal(await savedCount(),countBefore);fault='';
  missingFor='watch_events';const lost=await request('/fun/watch','POST',{...watchInput,request_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});assert.equal(lost.status,502);assert.equal((await lost.json()).code,'watch_receipt_invalid');missingFor='';
  const found=await (await request('/fun/watch','POST',{...watchInput,request_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'})).json();assert.equal(found.recorded.replayed,true);assert.equal(await savedCount(),countBefore+1);
  fault='watch_events:select';const receiptFailed=await request('/fun/watch','POST',watchInput);assert.equal(receiptFailed.status,503);assert.equal((await receiptFailed.json()).code,'watch_receipt_read_failed');
  const stale=await (await request('/fun/watch','POST',{...watchInput,request_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'})).json();assert.equal(stale.recorded.warning.code,'interest_events_read_failed');fault='';
  missingFor='interest_profiles';const profileMissing=await (await request('/fun/watch','POST',watchInput)).json();assert.equal(profileMissing.recorded.warning.code,'interest_profile_receipt_invalid');missingFor='';
  for(const [table,code]of [['interest_profiles','interest_profile_read_failed'],['watch_events','interest_history_read_failed']]){fault=table+':select';const response=await request('/fun/interests');assert.equal(response.status,503);assert.equal((await response.json()).code,code);fault='';}
  const beforePhoto=(await pg.query('select * from daily_shots where user_id=$1 and companion_id=$2',[userA,compA])).rows;calls.length=0;fault='daily_shots:select';await assert.rejects(dailies.add(scope(userA,compA),{note:'Must not save'}),error=>error.code==='daily_shots_read_failed');assert.ok(!calls.some(call=>call.table==='daily_shots'&&call.action!=='select'));fault='';assert.deepEqual((await pg.query('select * from daily_shots where user_id=$1 and companion_id=$2',[userA,compA])).rows,beforePhoto);
  await dailies.add(scope(userA,compA),{note:'Updated fictional photo'});const updateCall=calls.findLast(call=>call.table==='daily_shots'&&call.action==='update');for(const key of ['id','user_id','companion_id','shot_date'])assert.ok(updateCall.filters.some(([field])=>field===key));
  fault='daily_shots:update';await assert.rejects(dailies.add(scope(userA,compA),{note:'Must not save'}),error=>error.code==='daily_shots_save_failed');fault='';
  missingFor='daily_shots';await assert.rejects(dailies.add(scope(userA,compB),{note:'Fictional missing receipt'}),error=>error.code==='daily_shots_receipt_invalid');missingFor='';
  assert.equal((await request('/fun/daily-shots','GET',undefined,'c')).status,200);
  await pg.query('delete from daily_shots where user_id=$1 and companion_id=$2',[userA,compB]);
  const photoRace=await Promise.allSettled([dailies.add(scope(userA,compB),{note:'Fictional first photo'}),dailies.add(scope(userA,compB),{note:'Fictional second photo'})]);assert.equal(photoRace.filter(result=>result.status==='fulfilled').length,1);assert.equal(photoRace.find(result=>result.status==='rejected').reason.code,'daily_shots_changed');assert.equal((await pg.query('select count(*)::int as total from daily_shots where user_id=$1 and companion_id=$2',[userA,compB])).rows[0].total,1);
  fault='daily_shots:select';await assert.rejects(dailies.recent(scope(userA,compA)),error=>error.code==='daily_shots_history_read_failed');const photoRead=await request('/fun/daily-shots');assert.equal(photoRead.status,503);assert.equal((await photoRead.json()).code,'daily_shots_read_failed');fault='';
  await assert.rejects(interestEngine.recordWatch({},watchInput),error=>error.code==='watch_auth_required');
  assert.equal((await request('/xhs/login/cookie','POST',{cookie:'fictional-cookie-a'})).status,200);assert.equal((await request('/xhs/login/cookie','POST',{cookie:'fictional-cookie-b'},'b')).status,200);
  const before=(await pg.query('select cookie_ciphertext from public.xhs_connections where user_id=$1',[userB])).rows[0];
  await request('/xhs/login/cookie','POST',{cookie:'fictional-cookie-a-updated'});assert.deepEqual((await pg.query('select cookie_ciphertext from public.xhs_connections where user_id=$1',[userB])).rows[0],before);
  assert.equal((await pg.query('select count(*)::int as total from public.xhs_connections')).rows[0].total,2);assert.doesNotMatch(JSON.stringify((await pg.query('select cookie_ciphertext from public.xhs_connections')).rows),/fictional-cookie/);
  for(const mode of ['read','write']){fail=mode;const response=await request('/xhs/login/cookie','POST',{cookie:'fictional-cookie'});assert.equal(response.status,503);const error=await response.json();assert.equal(error.code,'xhs_storage_'+mode+'_failed');assert.doesNotMatch(JSON.stringify(error),/fictional-private-error|Bearer/);}fail='';
  noReceipt=true;const missing=await request('/xhs/login/cookie','POST',{cookie:'fictional-cookie'});assert.equal(missing.status,502);assert.equal((await missing.json()).code,'xhs_storage_receipt_invalid');noReceipt=false;
  fail='write';const expiredWrite=await request('/xhs/me');assert.equal(expiredWrite.status,503);assert.equal((await expiredWrite.json()).code,'xhs_storage_write_failed');fail='';
  const expired=await request('/xhs/me');assert.equal(expired.status,401);assert.equal((await expired.json()).code,'cookie_expired');
  const unavailable=await request('/xhs-unconfigured/login/cookie','POST',{cookie:'fictional-cookie'});assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).code,'xhs_storage_unconfigured');
  assert.equal((await request('/dates/'+date.id,'DELETE')).status,200);assert.equal((await request('/fun/achievements/custom/'+award.id,'DELETE')).status,200);
  console.log('Private activity real SQL/services/routes: dates, photos, achievements, compatibility, interest history and encrypted XHS storage survive RLS; account/companion isolation, exact failure receipts and private error redaction passed (unrelated achievement metrics are fixture-zero)');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(previousKey===undefined)delete process.env.MCP_ENCRYPTION_KEY;else process.env.MCP_ENCRYPTION_KEY=previousKey;await pg.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
