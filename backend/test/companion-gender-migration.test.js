const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('gender migration is repeatable and leaves existing personalized data unchanged',async()=>{
  const database = new PGlite();
  try {
    await database.exec('create table public.settings (id int primary key, unified_system_prompt text, user_details text);');
    await database.query('insert into settings values (1,$1,$2)', [' fixture prompt\n',' exact details ']);
    const sql=fs.readFileSync(require.resolve('../supabase/060_companion_gender.sql'),'utf8');
    await database.exec(sql); await database.exec(sql);
    const {rows}=await database.query('select * from settings');
    assert.deepEqual(rows,[{id:1,unified_system_prompt:' fixture prompt\n',user_details:' exact details ',ai_gender:'unspecified',ai_pronouns:'',ai_gender_label:''}]);
    await database.query("update settings set ai_gender='mtf'");
    await assert.rejects(database.query("update settings set ai_gender='invalid'"));
    await assert.rejects(database.query('update settings set ai_pronouns=$1',['x'.repeat(21)]));
  } finally {await database.close();}
});
