import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const tables=['special_dates','daily_shots','compatibility_records','achievements','user_achievements','watch_events','interest_profiles','xhs_connections'];
const userA='11111111-1111-4111-8111-111111111111',userB='22222222-2222-4222-8222-222222222222',companionA='33333333-3333-4333-8333-333333333333',companionB='44444444-4444-4444-8444-444444444444';
const db=new PGlite();
try{
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 for(const file of ['050_special_dates.sql','051_fun_tables.sql','052_achievements_upgrade.sql','053_xhs_connections.sql','054_interests.sql','057_xhs_cookie_storage.sql'])await db.exec(await fs.readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 const defaults={special_dates:{title:'Fictional date',event_date:'2026-10-01'},daily_shots:{shot_date:'2026-10-01',note:'Fictional private note'},compatibility_records:{score:83,comment:'Fictional private result'},achievements:{code:'fixture_unlock'},user_achievements:{title:'Fictional custom award'},watch_events:{title:'Fictional watched video'},interest_profiles:{interests:[{term:'fictional',count:1}]},xhs_connections:{cookie_ciphertext:'fictional-encrypted-cookie'}};
 const insert=async(table,user,companion)=>{const values={user_id:user,companion_id:companion,...defaults[table]},columns=Object.keys(values),args=Object.values(values).map(v=>typeof v==='object'?JSON.stringify(v):v);return db.query(`insert into public.${table}(${columns.join(',')}) values(${columns.map((_,i)=>'$'+(i+1)).join(',')}) returning id`,args);};
 for(const table of tables){await insert(table,userA,companionA);await insert(table,userB,companionB);await db.exec(`grant all on public.${table} to anon, authenticated, service_role`);}
 const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query(`select * from public.${table} order by id`)).rows])));
 const before=await snapshot();
 await db.exec('set role anon');assert.equal((await db.query('select count(*)::int as total from public.xhs_connections')).rows[0].total,2,'fixture reproduces unprotected cross-account reads');await db.exec('reset role');
 const sql=await fs.readFile(new URL('../supabase/migrations/20261001072028_private_activity_rls.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 assert.deepEqual(await snapshot(),before,'schema/permission migration cannot rewrite or delete any existing row');
 for(const table of tables){
  const flags=(await db.query('select relrowsecurity as rls from pg_class where oid=$1::regclass',['public.'+table])).rows[0];assert.equal(flags.rls,true);
  const policy=(await db.query('select roles,cmd,qual,with_check from pg_policies where schemaname=\'public\' and tablename=$1',[table])).rows;assert.equal(policy.length,1);assert.deepEqual(policy[0].roles,['service_role']);
  for(const role of ['anon','authenticated']){
   for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',[role,'public.'+table,privilege])).rows[0].allowed,false,`${role} ${table} ${privilege}`);
   await db.exec('set role '+role);
   await assert.rejects(db.query(`select id from public.${table} where user_id=$1`,[userA]),/permission denied/);
   await assert.rejects(db.query(`delete from public.${table} where user_id=$1`,[userB]),/permission denied/);
   await assert.rejects(db.query(`update public.${table} set user_id=$1 where user_id=$2`,[userB,userA]),/permission denied/);
   await assert.rejects(insert(table,userA,companionA),/permission denied/);
   await assert.rejects(db.query(`truncate public.${table}`),/permission denied/);
   await db.exec('reset role');
  }
 }
 // Even if a future accidental grant reopens SQL access, RLS itself still denies clients.
 await db.exec('grant select, update, delete on public.watch_events to authenticated; set role authenticated');
 assert.deepEqual((await db.query('select id from public.watch_events')).rows,[]);
 assert.deepEqual((await db.query('delete from public.watch_events returning id')).rows,[]);await db.exec('reset role');await db.exec(sql);
 // The backend's scoped CRUD remains available after tightening client access.
 await db.exec('set role service_role');
 for(const table of tables){
  const own=(await db.query(`select id from public.${table} where user_id=$1 and companion_id=$2`,[userA,companionA])).rows;assert.equal(own.length,1);
  assert.equal((await db.query(`select id from public.${table} where user_id=$1 and companion_id=$2`,[userA,companionB])).rows.length,0);
  const testUser='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',testCompanion='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await insert(table,testUser,testCompanion);
  assert.equal((await db.query(`update public.${table} set companion_id=$1 where user_id=$2 and companion_id=$3 returning id`,[companionA,testUser,testCompanion])).rows.length,1);
  assert.equal((await db.query(`delete from public.${table} where user_id=$1 and companion_id=$2 returning id`,[testUser,companionA])).rows.length,1);
 }
 await db.exec('reset role');assert.deepEqual(await snapshot(),before);
 console.log('Private activity RLS: eight original schemas, repeated migration, unchanged rows, all client privileges revoked, RLS backstop, scoped backend CRUD and account/companion fixtures passed');
}finally{await db.close();}
