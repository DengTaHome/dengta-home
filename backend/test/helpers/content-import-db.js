const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync(require.resolve('../../supabase/migrations/20261001095415_atomic_content_import.sql'),'utf8');
const tables=['content_imports','content_import_candidates','settings','memories','memory_calendar','world_book_entries'];
async function createImportDatabase() {
    const db=new PGlite();
    await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create table public.companions(id uuid primary key,user_id uuid not null,unique(user_id,id));
        create table public.settings(id uuid primary key default gen_random_uuid(),user_id uuid,companion_id uuid,
            user_details text default '',unified_system_prompt text default '',system_prompt text default '',
            additional_prompt text default '',personality text default '',updated_at timestamptz default now(),unique(user_id,companion_id));
        create table public.memories(id uuid primary key default gen_random_uuid(),user_id uuid,companion_id uuid,
            summary text,confirmation_status text,created_at timestamptz default now(),updated_at timestamptz default now());
        create table public.memory_calendar(id uuid primary key default gen_random_uuid(),user_id uuid,companion_id uuid,
            period_type text,period_start timestamptz not null,period_end timestamptz not null,summary text,source_ids text[],
            created_at timestamptz default now(),updated_at timestamptz default now(),check(period_end>period_start));
    `);
    await db.exec(fs.readFileSync(require.resolve('../../supabase/034_content_imports.sql'),'utf8'));
    await db.exec(fs.readFileSync(require.resolve('../../supabase/038_world_book_runtime.sql'),'utf8'));
    await db.exec(migration);
    return db;
}
async function insertRow(db,table,row) {
    const columns=Object.keys(row);
    await db.query(`insert into public.${table} (${columns.join(',')}) values (${columns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row).map(value=>value&&typeof value==='object'&&!Array.isArray(value)?JSON.stringify(value):value));
}
async function commitStoredFixture(tableData,params) {
    const db=await createImportDatabase();
    try {
        const owners=new Map(tableData.settings.map(row=>[row.companion_id,{id:row.companion_id,user_id:row.user_id}]));
        for(const row of owners.values())await insertRow(db,'companions',row);
        for(const name of tables)for(const row of tableData[name]){
            const allowed=(await db.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2',['public',name])).rows.map(r=>r.column_name);
            await insertRow(db,name,Object.fromEntries(Object.entries(row).filter(([key])=>allowed.includes(key))));
        }
        const {rows}=await db.query('select public.commit_content_import_atomic($1,$2,$3,$4::jsonb) as result',
            [params.p_user_id,params.p_companion_id,params.p_import_id,JSON.stringify(params.p_decisions)]);
        for(const name of tables) {
            const stored=(await db.query(`select * from public.${name}`)).rows;
            const byId=new Map(stored.map(row=>[row.id,row]));
            const existing=tableData[name].filter(row=>byId.has(row.id));
            for(const row of existing){Object.assign(row,byId.get(row.id));byId.delete(row.id);}
            tableData[name]=[...existing,...byId.values()];
        }
        return {data:rows[0].result,error:null};
    } catch(error) {return{data:null,error:{code:error.code,message:error.message}};}
    finally{await db.close();}
}
module.exports={createImportDatabase,insertRow,commitStoredFixture,migration};
