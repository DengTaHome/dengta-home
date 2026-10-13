const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createImportDatabase, insertRow, migration } = require('./helpers/content-import-db');
const { commitContentImport, resolveContentImport, parseContentImport } = require('../services/content-import');
const { createTenantDatabase } = require('../services/request-scope');

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const companion = '33333333-3333-4333-8333-333333333333';
const foreignCompanion = '44444444-4444-4444-8444-444444444444';
const taskId = '55555555-5555-4555-8555-555555555555';
const ids = Array.from({ length: 5 }, (_, i) => `66666666-6666-4666-8666-${String(i + 1).padStart(12, '0')}`);
const types = ['memory', 'style', 'memory', 'calendar', 'world_book'];
const targets = ['user_details', 'unified_system_prompt', 'memories', 'memory_calendar', 'world_book_entries'];
const decisions = ids.map((candidate_id, i) => ({ candidate_id, decision: 'accepted', target: targets[i],
    title: `Synthetic ${i}`, content: `Selected ${i}`,
    ...(i === 4 ? { keywords: ['harbor'], enabled: true, priority: 100, constant: false,
        match_mode: 'any', case_sensitive: false, position: 'dynamic_context', sort_order: 0 } : {}) }));

test('world-book previews expose exact truncation metadata without changing source fields',()=>{
    for(const length of [200000,200001,250020]) {
        const original='S'.repeat(length-20)+'SYNTHETIC-END-MARKER';
        assert.equal(original.length,length);
        const parsed=parseContentImport({sourceType:'world_book',mediaType:'application/json',bytes:Buffer.from(JSON.stringify({entries:[{title:'Synthetic',content:original}]}))});
        const candidate=parsed.candidates[0];
        assert.equal(candidate.metadata.source_fields.content,original);
        assert.equal(candidate.content.length,Math.min(length,200000));
        if(length===200000) {assert.equal(parsed.warnings.length,0);assert.equal(candidate.metadata.content_truncation,undefined);}
        else {
            const warning=parsed.warnings.find(item=>item.code==='import_world_book_content_truncated');
            assert.equal(warning.source_characters,length);assert.equal(warning.retained_characters,200000);assert.equal(warning.omitted_characters,length-200000);
            assert.match(warning.message,/部分正文/);assert.equal(candidate.metadata.content_truncation.omitted_characters,length-200000);
        }
    }
});

async function fixture() {
    const db = await createImportDatabase();
    for (const [id, user_id] of [[companion, owner], [foreignCompanion, other]]) {
        await insertRow(db, 'companions', { id, user_id });
        await insertRow(db, 'settings', { user_id, companion_id: id, user_details: 'Original details',
            unified_system_prompt: 'Original instructions', system_prompt: 'System untouched',
            additional_prompt: 'Additional untouched', personality: 'Personality untouched' });
    }
    await insertRow(db, 'content_imports', { id: taskId, user_id: owner, companion_id: companion,
        source_type: 'chat_history', source_name: 'synthetic.txt', media_type: 'text/plain',
        content_digest: 'a'.repeat(64), candidate_count: ids.length, status: 'preview', commit_protocol: 'atomic-v1' });
    for (let i = 0; i < ids.length; i++) await insertRow(db, 'content_import_candidates', {
        id: ids[i], import_id: taskId, user_id: owner, companion_id: companion, ordinal: i,
        candidate_type: types[i], target: targets[i], title: `Synthetic ${i}`, content: `Original ${i}`,
        metadata: i === 3 ? { reliable_time: true, period_start: '2026-10-01T00:00:00Z', period_end: '2026-10-02T00:00:00Z' } : {}
    });
    return db;
}
async function commit(db, values = decisions, user = owner, selected = companion) {
    return (await db.query('select public.commit_content_import_atomic($1,$2,$3,$4::jsonb) as result',
        [user, selected, taskId, JSON.stringify(values)])).rows[0].result;
}
async function snapshot(db) {
    const data = {};
    for (const table of ['settings', 'content_imports', 'content_import_candidates', 'memories', 'memory_calendar', 'world_book_entries']) {
        data[table] = (await db.query(`select * from public.${table} order by id`)).rows;
    }
    return data;
}

function sqlClient(db, user = owner, selected = companion) {
    const admin = {
        from(table) {
            assert.ok(['content_imports','content_import_candidates'].includes(table));
            const filters=[];let single=false;
            const builder={select(){return builder;},eq(key,value){
                assert.ok(['id','import_id','user_id','companion_id'].includes(key));filters.push([key,value]);return builder;
            },order(){return builder;},maybeSingle(){single=true;return builder;},then(resolve,reject){
                const query=`select * from public.${table} where ${filters.map(([key],i)=>`${key}=$${i+1}`).join(' and ')}`;
                return db.query(query,filters.map(([,value])=>value)).then(({rows})=>({data:single?rows[0]||null:rows,error:null})).then(resolve,reject);
            }};return builder;
        },
        async rpc(name, params) {
            assert.equal(name,'commit_content_import_atomic');
            try {return{data:(await db.query('select public.commit_content_import_atomic($1,$2,$3,$4::jsonb) as result',
                [params.p_user_id,params.p_companion_id,params.p_import_id,JSON.stringify(params.p_decisions)])).rows[0].result,error:null};}
            catch(error){return{data:null,error:{code:error.code,message:error.message}};}
        }
    };
    return createTenantDatabase({tenant:{userId:user,companionId:selected},adminSupabase:admin});
}

test('oversized edits fail before RPC while a full 200000-character world-book candidate saves intact',async()=>{
    const db=await fixture();
    try {
        const client=sqlClient(db),before=await snapshot(db);let rpcs=0;
        const guarded={from:client.from,rpc:async(...args)=>{rpcs++;return client.rpc(...args);}};
        const oversized=decisions.map((item,index)=>index===4?{...item,content:'S'.repeat(200001)}:item);
        await assert.rejects(commitContentImport(guarded,taskId,oversized),{code:'import_content_invalid'});
        assert.equal(rpcs,0);assert.deepEqual(await snapshot(db),before);
        await assert.rejects(commit(db,oversized),error=>error.message==='import_content_invalid');
        assert.deepEqual(await snapshot(db),before);
        const original='S'.repeat(199980)+'SYNTHETIC-END-MARKER';
        const valid=decisions.map((item,index)=>index===4?{...item,content:original}:item);
        await commitContentImport(guarded,taskId,valid);
        assert.equal(rpcs,1);
        assert.equal((await db.query('select content from public.world_book_entries')).rows[0].content,original);
    } finally {await db.close();}
});

test('explicit all-rejected resolution ends an unstarted import without changing user content; late commits cannot write',async()=>{
    const db=await fixture();
    try {
        const before=await snapshot(db),client=sqlClient(db);
        const resolved=await resolveContentImport(client,taskId);
        assert.equal(resolved.resolution,'discarded');assert.equal(resolved.accepted_count,0);assert.equal(resolved.rejected_count,5);
        const after=await snapshot(db);
        for(const table of ['settings','memories','memory_calendar','world_book_entries'])assert.deepEqual(after[table],before[table]);
        assert.ok(after.content_import_candidates.every(row=>row.status==='rejected'));
        for(const row of after.content_import_candidates)assert.equal(row.content,before.content_import_candidates.find(x=>x.id===row.id).content);
        await assert.rejects(commitContentImport(client,taskId,decisions),{code:'import_commit_conflict'});
        assert.equal((await resolveContentImport(client,taskId)).resolution,'discarded');
        assert.deepEqual(await snapshot(db),after,'repeated resolution and late POST cannot change any row');
        await assert.rejects(resolveContentImport(sqlClient(db,other,foreignCompanion),taskId),{code:'import_not_found'});
    } finally {await db.close();}
});

test('resolution preserves a commit that wins between preview read and the transactional decision',async()=>{
    const db=await fixture();
    try {
        const client=sqlClient(db);let originalCompleted=false;
        const racingClient={from:client.from,rpc:async(name,params)=>{
            if(!originalCompleted){originalCompleted=true;await commit(db);}
            return client.rpc(name,params);
        }};
        const resolved=await resolveContentImport(racingClient,taskId);
        assert.equal(resolved.resolution,'committed');assert.equal(resolved.accepted_count,5);
        const after=await snapshot(db);
        assert.equal(after.memories.length,1);assert.equal(after.memory_calendar.length,1);assert.equal(after.world_book_entries.length,1);
        assert.equal((await resolveContentImport(client,taskId)).accepted_count,5);
        assert.deepEqual(await snapshot(db),after);
    } finally {await db.close();}
});

test('unconfirmed resolution and legacy partial candidates never masquerade as a safe reset',async()=>{
    const db=await fixture();
    try {
        const client=sqlClient(db),before=await snapshot(db);
        await assert.rejects(resolveContentImport({from:client.from,rpc:async()=>{throw Error('private synthetic network');}},taskId),{code:'import_commit_unconfirmed'});
        assert.deepEqual(await snapshot(db),before);
        await db.query('update public.content_import_candidates set status=$2 where id=$1',[ids[0],'accepted']);
        const partial=await snapshot(db);
        await assert.rejects(resolveContentImport(client,taskId),{code:'import_partial_legacy'});
        assert.deepEqual(await snapshot(db),partial);
    } finally {await db.close();}
});

test('atomic commit preserves originals and tenant scope; same decisions replay without duplicate writes', async () => {
    const db = await fixture();
    try {
        const before = await snapshot(db);
        const result = await commit(db);
        assert.equal(result.atomic, true); assert.equal(result.replayed, false);
        assert.equal(result.accepted_count, 5);
        const after = await snapshot(db);
        const settings = after.settings.find(row => row.user_id === owner);
        assert.equal(settings.user_details, 'Original details\n\nSelected 0');
        assert.equal(settings.unified_system_prompt, 'Original instructions\n\nSelected 1');
        for (const key of ['system_prompt', 'additional_prompt', 'personality'])
            assert.equal(settings[key], before.settings.find(row => row.user_id === owner)[key]);
        assert.deepEqual(after.settings.find(row => row.user_id === other), before.settings.find(row => row.user_id === other));
        for (const table of ['memories', 'memory_calendar', 'world_book_entries']) {
            assert.equal(after[table].length, 1);
            assert.equal(after[table][0].user_id, owner); assert.equal(after[table][0].companion_id, companion);
        }
        assert.equal((await commit(db)).replayed, true);
        assert.deepEqual(await snapshot(db), after);
        await assert.rejects(commit(db, decisions.map((item, i) => i ? item : { ...item, content: 'Changed selection' })),
            error => error.code === 'PT409' && error.message === 'import_commit_conflict');
        assert.deepEqual(await snapshot(db), after);
    } finally { await db.close(); }
});

test('a late database failure rolls back settings, earlier memories, candidates and task; correction commits once', async () => {
    const db = await fixture();
    try {
        await db.exec(`create function public.synthetic_import_fault() returns trigger language plpgsql as $$
            begin raise exception using errcode='23514', message='synthetic private fault'; end; $$;
            create trigger synthetic_import_fault before insert on public.world_book_entries
            for each row execute function public.synthetic_import_fault();`);
        const before = await snapshot(db);
        await assert.rejects(commit(db), error => error.code === '23514');
        assert.deepEqual(await snapshot(db), before, 'no partial settings, memory or calendar writes may survive');
        await db.exec('drop trigger synthetic_import_fault on public.world_book_entries');
        assert.equal((await commit(db)).accepted_count, 5);
        assert.equal((await commit(db)).replayed, true);
        assert.equal((await snapshot(db)).memories.length, 1);
    } finally { await db.close(); }
});

test('foreign scopes, legacy previews and invalid decisions cannot write; migration is repeatable without backfill', async () => {
    const db = await fixture();
    try {
        const before = await snapshot(db);
        for (const [user, selected] of [[other, companion], [owner, foreignCompanion], [other, foreignCompanion]])
            await assert.rejects(commit(db, decisions, user, selected), error => error.code === 'PT404');
        await assert.rejects(commit(db, [decisions[0]]), error => error.code === 'PT400');
        assert.deepEqual(await snapshot(db), before);
        await db.query('update public.content_imports set commit_protocol=null where id=$1', [taskId]);
        const legacy = await snapshot(db);
        await db.exec(migration); await db.exec(migration);
        assert.deepEqual(await snapshot(db), legacy, 'migration must not change existing prompts or backfill legacy previews');
        await assert.rejects(commit(db), error => error.message === 'import_legacy_preview');
        assert.deepEqual(await snapshot(db), legacy);
        await db.query('update public.content_imports set commit_protocol=$2 where id=$1', [taskId, 'atomic-v1']);
        await db.query('update public.content_import_candidates set status=$2 where id=$1', [ids[0], 'accepted']);
        const partial = await snapshot(db);
        await assert.rejects(commit(db), error => error.message === 'import_partial_legacy');
        assert.deepEqual(await snapshot(db), partial);
        const acl = (await db.query(`select prosecdef, proconfig,
            has_function_privilege('anon',oid,'EXECUTE') as anon,
            has_function_privilege('authenticated',oid,'EXECUTE') as authenticated,
            has_function_privilege('service_role',oid,'EXECUTE') as service
            from pg_proc where proname='commit_content_import_atomic'`)).rows[0];
        assert.equal(acl.prosecdef, false); assert.equal(acl.anon, false);
        assert.equal(acl.authenticated, false); assert.equal(acl.service, true);
        assert.ok(acl.proconfig.some(value => value.startsWith('search_path=')));
        for (const role of ['anon', 'authenticated']) {
            await db.exec(`set role ${role}`);
            await assert.rejects(commit(db), error => error.code === '42501');
            await db.exec('reset role');
        }
    } finally { await db.close(); }
});

test('service maps database failures and missing migration; network exceptions never become retryable rollback receipts', async () => {
    const task = { id: taskId, status: 'preview' };
    const candidate = { id: ids[0], candidate_type: 'memory', target: 'memories', title: 'Synthetic', content: 'Synthetic' };
    const selected = [{ candidate_id: ids[0], decision: 'accepted' }];
    function database(rpc) {
        return { rpc, from(table) { const builder = { select() { return builder; }, eq() { return builder; },
            order() { return Promise.resolve({ data: [candidate], error: null }); },
            maybeSingle() { return Promise.resolve({ data: task, error: null }); } };
            assert.ok(['content_imports', 'content_import_candidates'].includes(table)); return builder; } };
    }
    for (const [rpc, code] of [
        [undefined, 'import_transaction_unavailable'],
        [async () => ({ error: { code: 'PGRST202', message: 'private detail' } }), 'import_transaction_unavailable'],
        [async () => ({ error: { code: '23514', message: 'private detail' } }), 'import_commit_rolled_back'],
        [async () => { throw Error('private network detail'); }, 'import_commit_unconfirmed'],
        [async () => ({ data: { atomic: true, import: { id: taskId, status: 'committed' }, accepted_count: 0, rejected_count: 1 } }), 'import_commit_receipt_invalid']
    ]) await assert.rejects(commitContentImport(database(rpc), taskId, selected), error =>
        error.code === code && !error.message.includes('private'));
    const calls = [];
    const scoped = createTenantDatabase({ tenant: { userId: owner, companionId: companion },
        adminSupabase: { rpc: async (name, values) => { calls.push({ name, values }); return {}; }, from() { throw Error('unexpected'); } } });
    await scoped.rpc('commit_content_import_atomic', { p_user_id: other, p_companion_id: foreignCompanion, p_import_id: taskId });
    assert.equal(calls[0].values.p_user_id, owner); assert.equal(calls[0].values.p_companion_id, companion);
});
