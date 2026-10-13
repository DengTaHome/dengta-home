import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testDir, "..");
const migrationDir = path.join(backendRoot, "supabase");
const migrationNames = (await fs.readdir(migrationDir))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort();

assert.deepEqual(migrationNames.slice(0, 3), [
    "000_base_schema.sql",
    "001_tutorial_alignment.sql",
    "002_moments_complete.sql"
]);
assert.equal(
    migrationNames.at(-1),
    "061_music_upload_aac.sql"
);

const db = new PGlite();

async function rows(sql, params = []) {
    const result = await db.query(sql, params);
    return result.rows;
}

async function applyMigrations(names) {
    for (const name of names) {
        const sql = await fs.readFile(path.join(migrationDir, name), "utf8");
        await db.exec(sql);
    }
}

await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;

    create schema auth;
    create schema storage;

    create table auth.users (
        id uuid primary key,
        email text,
        email_confirmed_at timestamptz,
        confirmed_at timestamptz,
        raw_user_meta_data jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
    );

    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
        select nullif(
            current_setting('request.jwt.claim.sub', true),
            ''
        )::uuid
    $$;

    create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null default false,
        file_size_limit bigint,
        allowed_mime_types text[]
    );
    create table storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text references storage.buckets(id),
        name text
    );
`);

await applyMigrations(migrationNames.slice(0, 12));

const ownerId = "11111111-1111-4111-8111-111111111111";
const memberAId = "22222222-2222-4222-8222-222222222222";
const memberBId = "33333333-3333-4333-8333-333333333333";
const stagedClientMessageId = "44444444-4444-4444-8444-444444444444";
const stagedLeaseId = "55555555-5555-4555-8555-555555555555";
const tenantClientMessageId = "66666666-6666-4666-8666-666666666666";
const memberALeaseId = "77777777-7777-4777-8777-777777777777";
const memberBLeaseId = "88888888-8888-4888-8888-888888888888";
const memberAConversationId = "99999999-9999-4999-8999-999999999991";
const memberBConversationId = "99999999-9999-4999-8999-999999999992";
const stagedTenantUserId = "aaaaaaaa-1111-4111-8111-111111111111";
const stagedTenantClientMessageId = "bbbbbbbb-1111-4111-8111-111111111111";
const stagedTenantLeaseId = "cccccccc-1111-4111-8111-111111111111";

await db.query(
    `insert into auth.users (id, email, email_confirmed_at)
     values ($1, 'owner@example.test', now())`,
    [ownerId]
);
await db.exec(`
    insert into public.settings default values;

    insert into public.conversations (id, title)
    select
        ('aaaaaaaa-aaaa-4aaa-8aaa-' || lpad(value::text, 12, '0'))::uuid,
        'fixture conversation ' || value
    from generate_series(1, 5) as value;

    insert into public.messages (conversation_id, role, content)
    select
        (
            'aaaaaaaa-aaaa-4aaa-8aaa-' ||
            lpad((((value - 1) % 5) + 1)::text, 12, '0')
        )::uuid,
        case when value % 2 = 0 then 'assistant' else 'user' end,
        'fixture message ' || value
    from generate_series(1, 112) as value;

    insert into public.memories (conversation_id, summary)
    values (
        'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
        'fixture stable memory'
    );

    insert into public.moments (id, author, content)
    select
        ('bbbbbbbb-bbbb-4bbb-8bbb-' || lpad(value::text, 12, '0'))::uuid,
        case when value % 2 = 0 then 'assistant' else 'user' end,
        'fixture moment ' || value
    from generate_series(1, 5) as value;

    insert into public.moment_comments (moment_id, author, content)
    select
        (
            'bbbbbbbb-bbbb-4bbb-8bbb-' ||
            lpad((((value - 1) % 5) + 1)::text, 12, '0')
        )::uuid,
        case when value % 2 = 0 then 'assistant' else 'user' end,
        'fixture comment ' || value
    from generate_series(1, 6) as value;

    insert into public.companion_diary_entries (
        title,
        content,
        source_window_start,
        source_window_end
    )
    select
        'fixture diary ' || value,
        'fixture diary content ' || value,
        now() - make_interval(days => value + 1),
        now() - make_interval(days => value)
    from generate_series(1, 8) as value;
`);

await applyMigrations(["012_multitenant_foundation.sql"]);

await db.query(
    `insert into public.messages (
        conversation_id,
        role,
        content,
        client_message_id
     ) values (
        'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
        'user',
        'staged legacy idempotent message',
        $1
     )`,
    [stagedClientMessageId]
);
const stagedClaim = await rows(
    `select public.claim_chat_generation(
        $1::uuid,
        $2::uuid,
        600
     ) as result`,
    [stagedClientMessageId, stagedLeaseId]
);
assert.equal(stagedClaim[0].result.claimed, true);
const stagedCommit = await rows(
    `select public.commit_chat_generation_reply(
        $1::uuid,
        $2::uuid,
        'staged legacy assistant reply',
        jsonb_build_object(
            'reply_to_client_message_id',
            ($1::uuid)::text
        ),
        true
     ) as result`,
    [stagedClientMessageId, stagedLeaseId]
);
assert.equal(stagedCommit[0].result.committed, true);
assert.equal(stagedCommit[0].result.assistant_message.user_id, null);
assert.equal(stagedCommit[0].result.assistant_message.companion_id, null);

await db.exec("begin");
try {
    await db.query(
        `insert into auth.users (id, email, email_confirmed_at)
         values ($1, 'staged-member@example.test', now())`,
        [stagedTenantUserId]
    );
    const stagedTenantCompanion = await rows(
        `select id
         from public.companions
         where user_id = $1 and is_default = true`,
        [stagedTenantUserId]
    );
    assert.equal(stagedTenantCompanion.length, 1);
    const stagedTenantConversation = await rows(
        `insert into public.conversations (
            title,
            user_id,
            companion_id
         ) values ('staged tenant conversation', $1, $2)
         returning id`,
        [stagedTenantUserId, stagedTenantCompanion[0].id]
    );
    await db.query(
        `insert into public.messages (
            user_id,
            companion_id,
            conversation_id,
            role,
            content,
            client_message_id
         ) values ($1, $2, $3, 'user', 'assigned during staging', $4)`,
        [
            stagedTenantUserId,
            stagedTenantCompanion[0].id,
            stagedTenantConversation[0].id,
            stagedTenantClientMessageId
        ]
    );

    const legacyCannotClaimTenant = await rows(
        `select public.claim_chat_generation(
            $1::uuid,
            $2::uuid,
            600
         ) as result`,
        [stagedTenantClientMessageId, stagedTenantLeaseId]
    );
    assert.equal(legacyCannotClaimTenant[0].result.claimed, false);
    assert.equal(legacyCannotClaimTenant[0].result.message, null);

    const tenantCanClaimItself = await rows(
        `select public.claim_chat_generation(
            $1::uuid,
            $2::uuid,
            $3::uuid,
            $4::uuid,
            600
         ) as result`,
        [
            stagedTenantUserId,
            stagedTenantCompanion[0].id,
            stagedTenantClientMessageId,
            stagedTenantLeaseId
        ]
    );
    assert.equal(tenantCanClaimItself[0].result.claimed, true);
    assert.equal(
        tenantCanClaimItself[0].result.message.user_id,
        stagedTenantUserId
    );
} finally {
    await db.exec("rollback");
}

await db.exec("begin");
try {
    await db.query(
        `insert into public.user_profiles (id, email)
         values ($1, 'owner@example.test')`,
        [ownerId]
    );
    await db.query(
        `update public.messages
         set user_id = $1
         where id = (select min(id) from public.messages)`,
        [ownerId]
    );
    let partialOwnershipError = null;
    try {
        await rows(
            "select public.finalize_legacy_owner_migration($1) as result",
            [ownerId]
        );
    } catch (error) {
        partialOwnershipError = error;
    }
    assert.match(
        String(partialOwnershipError?.message || ""),
        /legacy_owner_migration_blocked/
    );
} finally {
    await db.exec("rollback");
}

const migrationResult = await rows(
    "select public.finalize_legacy_owner_migration($1) as result",
    [ownerId]
);
assert.equal(migrationResult[0].result.messages, 114);
assert.equal(migrationResult[0].result.conversations, 5);
assert.equal(migrationResult[0].result.moments, 5);
assert.equal(migrationResult[0].result.moment_comments, 6);
assert.equal(migrationResult[0].result.diary_entries, 8);

await applyMigrations(["013_multitenant_finalize.sql"]);

const rpcSignatures = await rows(`
    select
        to_regprocedure(
            'public.claim_chat_generation(uuid,uuid,integer)'
        )::text as legacy_claim,
        to_regprocedure(
            'public.claim_chat_generation(uuid,uuid,uuid,uuid,integer)'
        )::text as tenant_claim,
        to_regprocedure(
            'public.commit_chat_generation_reply(uuid,uuid,text,jsonb,boolean)'
        )::text as legacy_commit,
        to_regprocedure(
            'public.commit_chat_generation_reply(uuid,uuid,uuid,uuid,text,jsonb,boolean)'
        )::text as tenant_commit,
        to_regprocedure(
            'public.renew_chat_generation_lease(uuid,uuid,integer)'
        )::text as legacy_renew,
        to_regprocedure(
            'public.fail_chat_generation_lease(uuid,uuid)'
        )::text as legacy_fail,
        to_regprocedure(
            'public.renew_chat_generation_lease(uuid,uuid,uuid,uuid,integer)'
        )::text as tenant_renew,
        to_regprocedure(
            'public.fail_chat_generation_lease(uuid,uuid,uuid,uuid)'
        )::text as tenant_fail
`);
assert.equal(rpcSignatures[0].legacy_claim, null);
assert.equal(rpcSignatures[0].legacy_commit, null);
assert.equal(rpcSignatures[0].legacy_renew, null);
assert.equal(rpcSignatures[0].legacy_fail, null);
assert.ok(rpcSignatures[0].tenant_claim);
assert.ok(rpcSignatures[0].tenant_commit);
assert.ok(rpcSignatures[0].tenant_renew);
assert.ok(rpcSignatures[0].tenant_fail);
const stagedIndexes = await rows(`
    select
        to_regclass(
            'public.messages_staged_client_message_uidx'
        )::text as user_message_index,
        to_regclass(
            'public.messages_staged_chat_reply_client_uidx'
        )::text as assistant_message_index
`);
assert.equal(stagedIndexes[0].user_message_index, null);
assert.equal(stagedIndexes[0].assistant_message_index, null);
const rpcPrivileges = await rows(`
    select
        has_function_privilege(
            'anon',
            'public.claim_chat_generation(uuid,uuid,uuid,uuid,integer)',
            'execute'
        ) as anon_execute,
        has_function_privilege(
            'authenticated',
            'public.claim_chat_generation(uuid,uuid,uuid,uuid,integer)',
            'execute'
        ) as authenticated_execute,
        has_function_privilege(
            'service_role',
            'public.claim_chat_generation(uuid,uuid,uuid,uuid,integer)',
            'execute'
        ) as service_execute
`);
assert.equal(rpcPrivileges[0].anon_execute, false);
assert.equal(rpcPrivileges[0].authenticated_execute, false);
assert.equal(rpcPrivileges[0].service_execute, true);

const foreignKeyColumns = await rows(`
    select
        source_table.relname as source_table,
        source_attribute.attname as source_column,
        format_type(
            source_attribute.atttypid,
            source_attribute.atttypmod
        ) as source_type,
        target_table.relname as target_table,
        target_attribute.attname as target_column,
        format_type(
            target_attribute.atttypid,
            target_attribute.atttypmod
        ) as target_type
    from pg_constraint as constraint_row
    join pg_class as source_table
      on source_table.oid = constraint_row.conrelid
    join pg_namespace as source_namespace
      on source_namespace.oid = source_table.relnamespace
    join pg_class as target_table
      on target_table.oid = constraint_row.confrelid
    cross join lateral unnest(constraint_row.conkey)
      with ordinality as source_key(attnum, position)
    join lateral unnest(constraint_row.confkey)
      with ordinality as target_key(attnum, position)
      on target_key.position = source_key.position
    join pg_attribute as source_attribute
      on source_attribute.attrelid = source_table.oid
     and source_attribute.attnum = source_key.attnum
    join pg_attribute as target_attribute
      on target_attribute.attrelid = target_table.oid
     and target_attribute.attnum = target_key.attnum
    where constraint_row.contype = 'f'
      and source_namespace.nspname = 'public'
    order by
        source_table.relname,
        source_attribute.attname,
        target_table.relname,
        target_attribute.attname
`);

assert.deepEqual(
    foreignKeyColumns
        .filter((item) => item.source_type !== item.target_type)
        .map((item) => ({
            source: `${item.source_table}.${item.source_column}`,
            source_type: item.source_type,
            target: `${item.target_table}.${item.target_column}`,
            target_type: item.target_type
        })),
    [],
    "every public foreign key must use the same PostgreSQL type on both sides"
);

for (const expected of [
    {
        source_table: "messages",
        source_column: "reply_to_message_id",
        target_table: "messages",
        target_column: "id"
    },
    {
        source_table: "media_assets",
        source_column: "message_id",
        target_table: "messages",
        target_column: "id"
    },
    {
        source_table: "delivery_events",
        source_column: "message_id",
        target_table: "messages",
        target_column: "id"
    }
]) {
    const constraint = foreignKeyColumns.find(
        (item) =>
            item.source_table === expected.source_table &&
            item.source_column === expected.source_column &&
            item.target_table === expected.target_table &&
            item.target_column === expected.target_column
    );
    assert.ok(
        constraint,
        `${expected.source_table}.${expected.source_column} foreign key is missing`
    );
    assert.equal(constraint.source_type, "bigint");
    assert.equal(constraint.target_type, "bigint");
}

// These files are also used for controlled SQL-editor recovery. Reapplying
// the complete chain must preserve the finalized schema and existing rows.
await applyMigrations(migrationNames.slice(0, -1));
const personaSnapshotSql = `select id, system_prompt, additional_prompt, personality,
    unified_system_prompt, user_details from public.settings order by id`;
const personasBeforeGenderMigration = await rows(personaSnapshotSql);
await applyMigrations(migrationNames.slice(-1));
assert.deepEqual(await rows(personaSnapshotSql), personasBeforeGenderMigration,
    "gender migration must preserve every existing personalization field");
assert.equal((await rows("select count(*)::integer as count from public.settings where ai_gender <> 'unspecified' or ai_pronouns <> '' or ai_gender_label <> ''"))[0].count, 0);
await assert.rejects(db.query("update public.settings set ai_gender = 'invalid'"), /settings_ai_gender_check/);
await db.query("update public.settings set ai_gender = 'non_binary', ai_pronouns = 'they'");
const genderBeforeReplay = await rows("select id, ai_gender, ai_pronouns from public.settings order by id");
await applyMigrations(migrationNames.slice(-1));
assert.deepEqual(await rows("select id, ai_gender, ai_pronouns from public.settings order by id"), genderBeforeReplay);
assert.deepEqual(await rows(personaSnapshotSql), personasBeforeGenderMigration);

const contentImportSchema = (
    await rows(`
        select
            to_regclass('public.content_imports')::text as imports_table,
            to_regclass('public.content_import_candidates')::text
                as candidates_table,
            to_regclass('public.world_book_entries')::text
                as entries_table,
            exists (
                select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'content_import_candidates'
                  and column_name = 'title'
                  and is_nullable = 'NO'
            ) as candidate_title,
            (
                select count(*)::integer
                from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'content_import_candidates'
                  and column_name in (
                      'candidate_type', 'title', 'content',
                      'metadata', 'status', 'target'
                  )
            ) as candidate_contract_columns,
            (select relrowsecurity from pg_class
             where oid = 'public.content_imports'::regclass) as imports_rls,
            has_table_privilege(
                'authenticated', 'public.content_imports', 'select'
            ) as authenticated_select,
            has_table_privilege(
                'service_role', 'public.content_imports', 'select'
            ) as service_select
    `)
)[0];
assert.deepEqual(contentImportSchema, {
    imports_table: "content_imports",
    candidates_table: "content_import_candidates",
    entries_table: "world_book_entries",
    candidate_title: true,
    candidate_contract_columns: 6,
    imports_rls: true,
    authenticated_select: false,
    service_select: true
});

const contentImportContracts = await rows(`
    select c.conname, pg_get_constraintdef(c.oid) as definition
    from pg_constraint c
    where c.conrelid in (
        'public.content_imports'::regclass,
        'public.content_import_candidates'::regclass,
        'public.world_book_entries'::regclass
    ) and c.contype in ('c', 'f')
`);
const importConstraintText = contentImportContracts
    .map((item) => `${item.conname}: ${item.definition}`)
    .join("\n");
assert.match(importConstraintText, /content_imports_tenant_companion_fk[\s\S]*FOREIGN KEY \(user_id, companion_id\)/i);
assert.match(importConstraintText, /content_import_candidates_type_target_check/i);
assert.match(importConstraintText, /candidate_type.*memory.*style.*world_book.*calendar/i);
assert.match(importConstraintText, /world_book_entries_tenant_companion_fk[\s\S]*FOREIGN KEY \(user_id, companion_id\)/i);

const contentImportIndexes = await rows(`
    select indexname, indexdef
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
          'content_imports_tenant_recent_idx',
          'content_import_candidates_tenant_import_idx',
          'world_book_entries_tenant_recent_idx'
      )
`);
assert.equal(contentImportIndexes.length, 3);
for (const item of contentImportIndexes) {
    assert.match(item.indexdef, /\(user_id, companion_id,/i);
}

const worldBookRuntimeSchema = (
    await rows(`
        select
            count(*) filter (where column_name in (
                'priority', 'constant', 'match_mode', 'case_sensitive',
                'position', 'sort_order'
            ))::integer as runtime_columns,
            max(column_default) filter (where column_name = 'priority') as priority_default,
            max(column_default) filter (where column_name = 'constant') as constant_default,
            max(column_default) filter (where column_name = 'match_mode') as match_mode_default,
            max(column_default) filter (where column_name = 'case_sensitive') as case_sensitive_default,
            max(column_default) filter (where column_name = 'position') as position_default
        from information_schema.columns
        where table_schema = 'public' and table_name = 'world_book_entries'
    `)
)[0];
assert.equal(worldBookRuntimeSchema.runtime_columns, 6);
assert.equal(worldBookRuntimeSchema.priority_default, "100");
assert.equal(worldBookRuntimeSchema.constant_default, "false");
assert.match(worldBookRuntimeSchema.match_mode_default, /any/);
assert.equal(worldBookRuntimeSchema.case_sensitive_default, "false");
assert.match(worldBookRuntimeSchema.position_default, /dynamic_context/);
assert.equal(
    (await rows(`select to_regclass('public.world_book_entries_tenant_runtime_idx')::text as index_name`))[0].index_name,
    "world_book_entries_tenant_runtime_idx"
);
assert.match(importConstraintText, /world_book_entries_priority_check[\s\S]*100000/i);
assert.match(importConstraintText, /world_book_entries_match_mode_check[\s\S]*any[\s\S]*all/i);
assert.match(importConstraintText, /world_book_entries_position_check[\s\S]*before_memory[\s\S]*dynamic_context/i);

const creativeSchema = (
    await rows(`
        select
            to_regclass('public.companion_creative_settings')::text
                as settings_table,
            to_regclass('public.image_provider_profiles')::text
                as provider_table,
            to_regclass('public.companion_artworks')::text
                as artworks_table,
            to_regclass('public.image_generation_calls')::text
                as calls_table,
            (
                select relrowsecurity
                from pg_class
                where oid = 'public.companion_artworks'::regclass
            ) as artworks_rls,
            (
                select public = false
                from storage.buckets
                where id = 'companion-artworks'
            ) as bucket_private
    `)
)[0];
assert.equal(
    creativeSchema.settings_table,
    "companion_creative_settings"
);
assert.equal(creativeSchema.provider_table, "image_provider_profiles");
assert.equal(creativeSchema.artworks_table, "companion_artworks");
assert.equal(creativeSchema.calls_table, "image_generation_calls");
assert.equal(creativeSchema.artworks_rls, true);
assert.equal(creativeSchema.bucket_private, true);

const accountRuntimeSchema = (
    await rows(`
        select
            to_regclass('public.companion_runtime_states')::text
                as runtime_table,
            (
                select relrowsecurity
                from pg_class
                where oid = 'public.companion_runtime_states'::regclass
            ) as runtime_rls
    `)
)[0];
assert.equal(accountRuntimeSchema.runtime_table, "companion_runtime_states");
assert.equal(accountRuntimeSchema.runtime_rls, true);

const chatSkinSchema = (
    await rows(`
        select
            to_regclass('public.companion_chat_preferences')::text
                as preferences_table,
            to_regclass('public.conversation_composer_hints')::text
                as hints_table,
            (
                select relrowsecurity
                from pg_class
                where oid = 'public.companion_chat_preferences'::regclass
            ) as preferences_rls,
            (
                select relrowsecurity
                from pg_class
                where oid = 'public.conversation_composer_hints'::regclass
            ) as hints_rls,
            has_table_privilege(
                'authenticated',
                'public.companion_chat_preferences',
                'select'
            ) as authenticated_preferences_select,
            has_table_privilege(
                'authenticated',
                'public.conversation_composer_hints',
                'select'
            ) as authenticated_hints_select
    `)
)[0];
assert.equal(chatSkinSchema.preferences_table, "companion_chat_preferences");
assert.equal(chatSkinSchema.hints_table, "conversation_composer_hints");
assert.equal(chatSkinSchema.preferences_rls, true);
assert.equal(chatSkinSchema.hints_rls, true);
assert.equal(chatSkinSchema.authenticated_preferences_select, false);
assert.equal(chatSkinSchema.authenticated_hints_select, false);

const backgroundJobRpcContracts = [
    "claim_background_jobs(uuid,uuid,text,integer,integer,integer)",
    "renew_background_job_lease(uuid,uuid,uuid,uuid,text,integer)",
    "complete_background_job(uuid,uuid,uuid,uuid,text)",
    "fail_background_job(uuid,uuid,uuid,uuid,text,text,integer,integer,integer)"
];
for (const signature of backgroundJobRpcContracts) {
    const contract = (
        await rows(
            `select
                to_regprocedure($1)::text as signature,
                has_function_privilege('anon', $1, 'execute') as anon_execute,
                has_function_privilege(
                    'authenticated',
                    $1,
                    'execute'
                ) as authenticated_execute,
                has_function_privilege(
                    'service_role',
                    $1,
                    'execute'
                ) as service_execute`,
            [signature]
        )
    )[0];
    assert.equal(contract.signature, signature);
    assert.equal(contract.anon_execute, false);
    assert.equal(contract.authenticated_execute, false);
    assert.equal(contract.service_execute, true);
}

for (const [table, expected] of Object.entries({
    settings: 1,
    conversations: 5,
    memories: 1,
    messages: 114,
    moments: 5,
    moment_comments: 6,
    companion_diary_entries: 8
})) {
    const result = await rows(
        `select
            count(*)::integer as total,
            count(*) filter (
                where user_id is null or companion_id is null
            )::integer as unassigned
         from public.${table}`
    );
    assert.equal(result[0].total, expected, `${table} row count changed`);
    assert.equal(result[0].unassigned, 0, `${table} has unassigned rows`);
}

await db.query(
    `insert into auth.users (id, email, email_confirmed_at)
     values
        ($1, 'member-a@example.test', now()),
        ($2, 'member-b@example.test', now())`,
    [memberAId, memberBId]
);

const memberCompanions = await rows(
    `select id, user_id from public.companions
     where user_id in ($1, $2) and is_default = true
     order by user_id`,
    [memberAId, memberBId]
);
assert.equal(memberCompanions.length, 2);
const memberACompanionId = memberCompanions.find(
    (item) => item.user_id === memberAId
)?.id;
const memberBCompanionId = memberCompanions.find(
    (item) => item.user_id === memberBId
)?.id;
assert.ok(memberACompanionId);
assert.ok(memberBCompanionId);

const replayImportId = "10101010-1010-4010-8010-101010101010";
await db.query(
    `insert into public.content_imports (
         id, user_id, companion_id, source_type, source_name,
         media_type, content_digest, candidate_count
     ) values ($1, $2, $3, 'world_book', 'fixture.json',
         'application/json', repeat('a', 64), 4)`,
    [replayImportId, memberAId, memberACompanionId]
);
await db.query(
    `insert into public.content_import_candidates (
         user_id, companion_id, import_id, ordinal,
         candidate_type, target, title, content
     ) values
         ($1, $2, $3, 0, 'world_book', 'world_book_entries',
          'fixture', 'fixture lore'),
         ($1, $2, $3, 1, 'memory', 'memories',
          'memory', 'fixture memory'),
         ($1, $2, $3, 2, 'style', 'unified_system_prompt',
          'style', 'fixture style'),
         ($1, $2, $3, 3, 'calendar', 'memory_calendar',
          'calendar', 'fixture event')`,
    [memberAId, memberACompanionId, replayImportId]
);
await db.query(
    `insert into public.world_book_entries (
         user_id, companion_id, source_import_id, title, content
     ) values ($1, $2, $3, 'fixture', 'fixture lore')`,
    [memberAId, memberACompanionId, replayImportId]
);
let crossTenantImportRejected = false;
try {
    await db.query(
        `insert into public.content_imports (
             user_id, companion_id, source_type, source_name,
             media_type, content_digest
         ) values ($1, $2, 'chat_history', 'invalid.json',
             'application/json', repeat('b', 64))`,
        [memberAId, memberBCompanionId]
    );
} catch (error) {
    crossTenantImportRejected = /foreign key/i.test(String(error.message));
}
assert.equal(crossTenantImportRejected, true);

// The external-memory importer uses this exact composite conflict target.
// It must remain inferable by PostgreSQL (a partial index is not sufficient)
// and repeated/concurrent-style writes must converge to one tenant row.
for (const summary of ["first version", "second version"]) {
    await db.query(
        `insert into public.memories (
             user_id,
             companion_id,
             conversation_id,
             summary,
             external_source_type,
             external_source_id
         ) values ($1, $2, null, $3, 'supabase_memory', 'project:item')
         on conflict (
             user_id,
             companion_id,
             external_source_type,
             external_source_id
         ) do update set
             summary = excluded.summary,
             updated_at = now()`,
        [memberAId, memberACompanionId, summary]
    );
}
const externalMemoryRows = await rows(
    `select summary
     from public.memories
     where user_id = $1
       and companion_id = $2
       and external_source_type = 'supabase_memory'
       and external_source_id = 'project:item'`,
    [memberAId, memberACompanionId]
);
assert.deepEqual(externalMemoryRows, [{ summary: "second version" }]);

const sharedDiaryWindow = "2026-07-27T06:00:00.000Z";
await db.query(
    `insert into public.companion_diary_entries (
        user_id,
        companion_id,
        title,
        content,
        source_window_start,
        source_window_end
     ) values
        ($1, $2, 'member A diary', 'member A diary content', $5, $6),
        ($3, $4, 'member B diary', 'member B diary content', $5, $6)`,
    [
        memberAId,
        memberACompanionId,
        memberBId,
        memberBCompanionId,
        "2026-07-27T05:00:00.000Z",
        sharedDiaryWindow
    ]
);
let sameTenantDiaryWindowRejected = false;
try {
    await db.query(
        `insert into public.companion_diary_entries (
            user_id,
            companion_id,
            title,
            content,
            source_window_start,
            source_window_end
         ) values ($1, $2, 'duplicate', 'duplicate content', $3, $4)`,
        [
            memberAId,
            memberACompanionId,
            "2026-07-27T05:30:00.000Z",
            sharedDiaryWindow
        ]
    );
} catch (error) {
    sameTenantDiaryWindowRejected = /unique|duplicate/i.test(
        String(error.message)
    );
}
assert.equal(sameTenantDiaryWindowRejected, true);

const memberACompletedJobId = "10000000-0000-4000-8000-000000000001";
const memberARetryJobId = "10000000-0000-4000-8000-000000000002";
const memberAExhaustedJobId = "10000000-0000-4000-8000-000000000003";
const memberAFutureJobId = "10000000-0000-4000-8000-000000000004";
const memberBJobId = "10000000-0000-4000-8000-000000000005";
const memberARecoverableJobId = "10000000-0000-4000-8000-000000000006";
const expiredRecoverableLeaseId =
    "20000000-0000-4000-8000-000000000001";

await db.query(
    `insert into public.background_jobs (
        id,
        user_id,
        companion_id,
        job_type,
        due_at,
        dedupe_key,
        status,
        attempt_count,
        locked_at,
        locked_by,
        lease_id,
        lease_expires_at
     ) values
        (
            $1, $7, $8, 'proactive_message',
            now() - interval '4 minutes', 'complete-me', 'pending',
            0, null, null, null, null
        ),
        (
            $2, $7, $8, 'moment_post',
            now() - interval '3 minutes', 'retry-me', 'pending',
            0, null, null, null, null
        ),
        (
            $3, $7, $8, 'diary_update',
            now() - interval '2 minutes', 'already-exhausted', 'running',
            3, now() - interval '2 minutes', 'dead-worker',
            '20000000-0000-4000-8000-000000000002',
            now() - interval '1 minute'
        ),
        (
            $4, $7, $8, 'profile_refresh',
            now() + interval '1 day', 'not-due-yet', 'pending',
            0, null, null, null, null
        ),
        (
            $5, $9, $10, 'proactive_message',
            now() - interval '5 minutes', 'complete-me', 'pending',
            0, null, null, null, null
        ),
        (
            $6, $7, $8, 'moment_interaction',
            now() - interval '1 minute', 'recover-expired', 'running',
            1, now() - interval '2 minutes', 'dead-worker',
            $11, now() - interval '1 minute'
        )`,
    [
        memberACompletedJobId,
        memberARetryJobId,
        memberAExhaustedJobId,
        memberAFutureJobId,
        memberBJobId,
        memberARecoverableJobId,
        memberAId,
        memberACompanionId,
        memberBId,
        memberBCompanionId,
        expiredRecoverableLeaseId
    ]
);

const memberAClaimedJobs = await rows(
    `select *
     from public.claim_background_jobs($1, $2, 'worker-a', 10, 300, 3)`,
    [memberAId, memberACompanionId]
);
assert.deepEqual(
    memberAClaimedJobs.map((job) => job.id).sort(),
    [
        memberACompletedJobId,
        memberARecoverableJobId,
        memberARetryJobId
    ].sort()
);
assert.equal(
    memberAClaimedJobs.every(
        (job) =>
            job.user_id === memberAId &&
            job.companion_id === memberACompanionId &&
            job.status === "running" &&
            job.locked_by === "worker-a" &&
            job.lease_id
    ),
    true
);
assert.equal(
    memberAClaimedJobs.find((job) => job.id === memberACompletedJobId)
        ?.attempt_count,
    1
);
const recoveredJob = memberAClaimedJobs.find(
    (job) => job.id === memberARecoverableJobId
);
assert.equal(recoveredJob?.attempt_count, 2);
assert.notEqual(recoveredJob?.lease_id, expiredRecoverableLeaseId);
const staleRecoveredLeaseComplete = await rows(
    `select public.complete_background_job(
        $1, $2, $3, $4, 'dead-worker'
     ) as completed`,
    [
        memberAId,
        memberACompanionId,
        memberARecoverableJobId,
        expiredRecoverableLeaseId
    ]
);
const wrongRecoveredWorkerComplete = await rows(
    `select public.complete_background_job(
        $1, $2, $3, $4, 'another-worker'
     ) as completed`,
    [
        memberAId,
        memberACompanionId,
        memberARecoverableJobId,
        recoveredJob.lease_id
    ]
);
assert.equal(staleRecoveredLeaseComplete[0].completed, false);
assert.equal(wrongRecoveredWorkerComplete[0].completed, false);

const memberASecondClaim = await rows(
    `select id
     from public.claim_background_jobs($1, $2, 'worker-a-competitor', 10, 300, 3)`,
    [memberAId, memberACompanionId]
);
assert.deepEqual(memberASecondClaim, []);

const memberAUnclaimableJobs = await rows(
    `select id, status, last_error_code
     from public.background_jobs
     where id in ($1, $2)
     order by id`,
    [memberAExhaustedJobId, memberAFutureJobId]
);
assert.deepEqual(memberAUnclaimableJobs, [
    {
        id: memberAExhaustedJobId,
        status: "failed",
        last_error_code: "max_attempts_exhausted"
    },
    {
        id: memberAFutureJobId,
        status: "pending",
        last_error_code: null
    }
]);

const completedLease = memberAClaimedJobs.find(
    (job) => job.id === memberACompletedJobId
);
assert.ok(completedLease);
const wrongBackgroundTenantRenew = await rows(
    `select public.renew_background_job_lease(
        $1, $2, $3, $4, 'worker-a', 600
     ) as renewed`,
    [
        memberBId,
        memberBCompanionId,
        memberACompletedJobId,
        completedLease.lease_id
    ]
);
const wrongBackgroundTenantComplete = await rows(
    `select public.complete_background_job(
        $1, $2, $3, $4, 'worker-a'
     ) as completed`,
    [
        memberBId,
        memberBCompanionId,
        memberACompletedJobId,
        completedLease.lease_id
    ]
);
const wrongBackgroundTenantFail = await rows(
    `select public.fail_background_job(
        $1, $2, $3, $4, 'worker-a', 'wrong_tenant', 3, 10, 30
     ) as result`,
    [
        memberBId,
        memberBCompanionId,
        memberACompletedJobId,
        completedLease.lease_id
    ]
);
assert.equal(wrongBackgroundTenantRenew[0].renewed, false);
assert.equal(wrongBackgroundTenantComplete[0].completed, false);
assert.deepEqual(wrongBackgroundTenantFail[0].result, { updated: false });

const validRenew = await rows(
    `select public.renew_background_job_lease(
        $1, $2, $3, $4, 'worker-a', 600
     ) as renewed`,
    [
        memberAId,
        memberACompanionId,
        memberACompletedJobId,
        completedLease.lease_id
    ]
);
assert.equal(validRenew[0].renewed, true);
const renewedLease = (
    await rows(
        `select
            lease_id,
            lease_expires_at > $2::timestamptz as expiry_extended
         from public.background_jobs
         where id = $1`,
        [memberACompletedJobId, completedLease.lease_expires_at]
    )
)[0];
assert.equal(renewedLease.lease_id, completedLease.lease_id);
assert.equal(renewedLease.expiry_extended, true);

const validComplete = await rows(
    `select public.complete_background_job(
        $1, $2, $3, $4, 'worker-a'
     ) as completed`,
    [
        memberAId,
        memberACompanionId,
        memberACompletedJobId,
        completedLease.lease_id
    ]
);
const duplicateComplete = await rows(
    `select public.complete_background_job(
        $1, $2, $3, $4, 'worker-a'
     ) as completed`,
    [
        memberAId,
        memberACompanionId,
        memberACompletedJobId,
        completedLease.lease_id
    ]
);
assert.equal(validComplete[0].completed, true);
assert.equal(duplicateComplete[0].completed, false);
assert.deepEqual(
    (
        await rows(
            `select
                status,
                completed_at is not null as has_completed_at,
                lease_id,
                locked_by
             from public.background_jobs
             where id = $1`,
            [memberACompletedJobId]
        )
    )[0],
    {
        status: "completed",
        has_completed_at: true,
        lease_id: null,
        locked_by: null
    }
);

const queuedProactiveJobId =
    "10000000-0000-4000-8000-000000000101";
await db.query(
    `insert into public.background_jobs (
        id, user_id, companion_id, job_type, due_at, dedupe_key
     ) values ($1, $2, $3, 'proactive_message', now(), 'queued-once')`,
    [
        queuedProactiveJobId,
        memberAId,
        memberACompanionId
    ]
);
await assert.rejects(
    db.query(
        `insert into public.background_jobs (
            id, user_id, companion_id, job_type, due_at, dedupe_key
         ) values (
            '10000000-0000-4000-8000-000000000102',
            $1, $2, 'proactive_message', now(), 'queued-twice'
         )`,
        [memberAId, memberACompanionId]
    ),
    /duplicate key|unique constraint/i
);
await db.query(
    `update public.background_jobs
     set status = 'completed', completed_at = now()
     where id = $1`,
    [queuedProactiveJobId]
);

const retryLease = memberAClaimedJobs.find(
    (job) => job.id === memberARetryJobId
);
assert.ok(retryLease);
const firstFailure = await rows(
    `select public.fail_background_job(
        $1, $2, $3, $4, 'worker-a', 'temporary_error', 3, 10, 15
     ) as result`,
    [
        memberAId,
        memberACompanionId,
        memberARetryJobId,
        retryLease.lease_id
    ]
);
assert.equal(firstFailure[0].result.updated, true);
assert.equal(firstFailure[0].result.status, "pending");
assert.equal(firstFailure[0].result.attempt_count, 1);
assert.ok(firstFailure[0].result.retry_at);
assert.deepEqual(
    await rows(
        `select id
         from public.claim_background_jobs($1, $2, 'too-early', 10, 300, 3)`,
        [memberAId, memberACompanionId]
    ),
    []
);

await db.query(
    `update public.background_jobs
     set due_at = now() - interval '1 second'
     where id = $1`,
    [memberARetryJobId]
);
const secondRetryLease = (
    await rows(
        `select *
         from public.claim_background_jobs($1, $2, 'worker-a', 1, 300, 3)`,
        [memberAId, memberACompanionId]
    )
)[0];
assert.equal(secondRetryLease.id, memberARetryJobId);
assert.equal(secondRetryLease.attempt_count, 2);
const secondFailure = await rows(
    `select public.fail_background_job(
        $1, $2, $3, $4, 'worker-a', 'temporary_error', 3, 10, 15
     ) as result`,
    [
        memberAId,
        memberACompanionId,
        memberARetryJobId,
        secondRetryLease.lease_id
    ]
);
assert.equal(secondFailure[0].result.status, "pending");
const cappedRetry = (
    await rows(
        `select extract(epoch from (due_at - clock_timestamp())) as seconds
         from public.background_jobs
         where id = $1`,
        [memberARetryJobId]
    )
)[0];
assert.ok(Number(cappedRetry.seconds) > 14);
assert.ok(Number(cappedRetry.seconds) <= 15);

await db.query(
    `update public.background_jobs
     set due_at = now() - interval '1 second'
     where id = $1`,
    [memberARetryJobId]
);
const finalRetryLease = (
    await rows(
        `select *
         from public.claim_background_jobs($1, $2, 'worker-a', 1, 300, 3)`,
        [memberAId, memberACompanionId]
    )
)[0];
assert.equal(finalRetryLease.attempt_count, 3);
const finalFailure = await rows(
    `select public.fail_background_job(
        $1, $2, $3, $4, 'worker-a', 'permanent_error', 3, 10, 15
     ) as result`,
    [
        memberAId,
        memberACompanionId,
        memberARetryJobId,
        finalRetryLease.lease_id
    ]
);
assert.deepEqual(finalFailure[0].result, {
    updated: true,
    status: "failed",
    attempt_count: 3,
    retry_at: null
});

const memberBClaimedJobs = await rows(
    `select *
     from public.claim_background_jobs($1, $2, 'worker-b', 10, 300, 3)`,
    [memberBId, memberBCompanionId]
);
assert.equal(memberBClaimedJobs.length, 1);
assert.equal(memberBClaimedJobs[0].id, memberBJobId);
assert.equal(memberBClaimedJobs[0].user_id, memberBId);

await db.query(
    `insert into public.conversations (
        id,
        title,
        user_id,
        companion_id
     ) values
        ($1, 'member private conversation', $2, $3),
        ($4, 'other member conversation', $5, $6)`,
    [
        memberAConversationId,
        memberAId,
        memberACompanionId,
        memberBConversationId,
        memberBId,
        memberBCompanionId
    ]
);

await db.query(
    `insert into public.messages (
        user_id,
        companion_id,
        conversation_id,
        role,
        content,
        client_message_id
     ) values
        ($1, $2, $3, 'user', 'member A shared UUID', $7),
        ($4, $5, $6, 'user', 'member B shared UUID', $7)`,
    [
        memberAId,
        memberACompanionId,
        memberAConversationId,
        memberBId,
        memberBCompanionId,
        memberBConversationId,
        tenantClientMessageId
    ]
);

const memberAClaim = await rows(
    `select public.claim_chat_generation(
        $1, $2, $3, $4, 600
     ) as result`,
    [
        memberAId,
        memberACompanionId,
        tenantClientMessageId,
        memberALeaseId
    ]
);
const memberBClaim = await rows(
    `select public.claim_chat_generation(
        $1, $2, $3, $4, 600
     ) as result`,
    [
        memberBId,
        memberBCompanionId,
        tenantClientMessageId,
        memberBLeaseId
    ]
);
assert.equal(memberAClaim[0].result.claimed, true);
assert.equal(memberAClaim[0].result.message.user_id, memberAId);
assert.equal(memberBClaim[0].result.claimed, true);
assert.equal(memberBClaim[0].result.message.user_id, memberBId);
const wrongTenantClaim = await rows(
    `select public.claim_chat_generation(
        $1, $2, $3, $4, 600
     ) as result`,
    [
        memberAId,
        memberBCompanionId,
        tenantClientMessageId,
        memberALeaseId
    ]
);
assert.equal(wrongTenantClaim[0].result.claimed, false);
assert.equal(wrongTenantClaim[0].result.message, null);
const wrongTenantRenew = await rows(
    `select public.renew_chat_generation_lease(
        $1, $2, $3, $4, 600
     ) as result`,
    [
        memberAId,
        memberBCompanionId,
        tenantClientMessageId,
        memberALeaseId
    ]
);
const wrongTenantFail = await rows(
    `select public.fail_chat_generation_lease(
        $1, $2, $3, $4
     ) as result`,
    [
        memberAId,
        memberBCompanionId,
        tenantClientMessageId,
        memberALeaseId
    ]
);
const wrongTenantCommit = await rows(
    `select public.commit_chat_generation_reply(
        $1, $2, $3, $4, 'wrong tenant reply', '{}'::jsonb, true
     ) as result`,
    [
        memberAId,
        memberBCompanionId,
        tenantClientMessageId,
        memberALeaseId
    ]
);
assert.equal(wrongTenantRenew[0].result, false);
assert.equal(wrongTenantFail[0].result, false);
assert.equal(wrongTenantCommit[0].result.committed, false);
assert.equal(
    wrongTenantCommit[0].result.reason,
    "user_message_not_found"
);
const unchangedTenantLeases = await rows(
    `select user_id, chat_generation_state, chat_generation_lease_id
     from public.messages
     where role = 'user' and client_message_id = $1
     order by user_id`,
    [tenantClientMessageId]
);
assert.deepEqual(
    unchangedTenantLeases.map((item) => ({
        user_id: item.user_id,
        state: item.chat_generation_state,
        lease_id: item.chat_generation_lease_id
    })),
    [
        {
            user_id: memberAId,
            state: "in_progress",
            lease_id: memberALeaseId
        },
        {
            user_id: memberBId,
            state: "in_progress",
            lease_id: memberBLeaseId
        }
    ]
);

const memberACommit = await rows(
    `select public.commit_chat_generation_reply(
        $1, $2, $3, $4, 'member A assistant reply', '{}'::jsonb, true
     ) as result`,
    [
        memberAId,
        memberACompanionId,
        tenantClientMessageId,
        memberALeaseId
    ]
);
const memberBCommit = await rows(
    `select public.commit_chat_generation_reply(
        $1, $2, $3, $4, 'member B assistant reply', '{}'::jsonb, true
     ) as result`,
    [
        memberBId,
        memberBCompanionId,
        tenantClientMessageId,
        memberBLeaseId
    ]
);
assert.equal(memberACommit[0].result.committed, true);
assert.equal(memberACommit[0].result.assistant_message.user_id, memberAId);
assert.equal(
    memberACommit[0].result.assistant_message.companion_id,
    memberACompanionId
);
assert.equal(memberBCommit[0].result.committed, true);
assert.equal(memberBCommit[0].result.assistant_message.user_id, memberBId);
assert.equal(
    memberBCommit[0].result.assistant_message.companion_id,
    memberBCompanionId
);
const memberADeduplicatedCommit = await rows(
    `select public.commit_chat_generation_reply(
        $1, $2, $3, $4, 'must not replace reply', '{}'::jsonb, true
     ) as result`,
    [
        memberAId,
        memberACompanionId,
        tenantClientMessageId,
        memberALeaseId
    ]
);
assert.equal(memberADeduplicatedCommit[0].result.committed, true);
assert.equal(memberADeduplicatedCommit[0].result.deduplicated, true);
assert.equal(
    memberADeduplicatedCommit[0].result.assistant_message.id,
    memberACommit[0].result.assistant_message.id
);

const tenantReplies = await rows(
    `select user_id, companion_id
     from public.messages
     where role = 'assistant'
       and tool_calls @> jsonb_build_object(
           'reply_to_client_message_id',
           $1::text
       )
     order by user_id`,
    [tenantClientMessageId]
);
assert.deepEqual(
    tenantReplies.map((item) => item.user_id),
    [memberAId, memberBId]
);

// A full recovery-chain replay must not recreate migration 006's global
// indexes now that two tenants legitimately share the same client UUID.
// Simulate a database that briefly received the earlier MVP vocabulary. The
// corrective section in 034 must migrate that row before restoring checks.
await db.exec(`
    alter table public.content_import_candidates
        drop constraint content_import_candidates_candidate_type_check;
    alter table public.content_import_candidates
        drop constraint content_import_candidates_type_target_check;
    alter table public.content_import_candidates
        drop constraint content_import_candidates_edited_target_check;
    alter table public.content_import_candidates
        add constraint content_import_candidates_candidate_type_check
        check (candidate_type in (
            'memory', 'style', 'world_book', 'calendar',
            'world_book_entry', 'chat_message', 'user_request',
            'profile_fact', 'instruction'
        ));
    alter table public.content_import_candidates
        add constraint content_import_candidates_type_target_check
        check (true);
    alter table public.content_import_candidates
        add constraint content_import_candidates_edited_target_check
        check (true);
    update public.content_import_candidates
    set candidate_type = 'world_book_entry'
    where import_id = '${replayImportId}'::uuid and ordinal = 0;
`);
await applyMigrations(migrationNames);
const deliverySql = await fs.readFile(new URL('../supabase/migrations/20261001064300_ai_music_delivery_claim.sql', import.meta.url), 'utf8');
const personaBeforeDelivery = await rows(personaSnapshotSql);
await db.exec(deliverySql); await db.exec(deliverySql);
const activitySql = await fs.readFile(new URL('../supabase/migrations/20261001072028_private_activity_rls.sql', import.meta.url), 'utf8');
await db.exec(activitySql); await db.exec(activitySql);
assert.deepEqual(await rows(personaSnapshotSql), personaBeforeDelivery, 'delivery migration must preserve personalization');
const atomicImportSql = await fs.readFile(new URL('../supabase/migrations/20261001095415_atomic_content_import.sql', import.meta.url), 'utf8');
await db.exec(atomicImportSql); await db.exec(atomicImportSql);
assert.deepEqual(await rows(personaSnapshotSql), personaBeforeDelivery, 'atomic import migration must preserve personalization');
assert.equal((await rows("select commit_protocol from public.content_imports where id=$1", [replayImportId]))[0].commit_protocol, null);

assert.deepEqual(
    await rows(
        `select candidate_type, target, title
         from public.content_import_candidates
         where import_id = $1 and ordinal = 0`,
        [replayImportId]
    ),
    [{ candidate_type: "world_book", target: "world_book_entries", title: "fixture" }]
);
const replayedContentImportRows = (
    await rows(
        `select
            (select count(*) from public.content_imports where id = $1)::integer
                as imports,
            (select count(*) from public.content_import_candidates
             where import_id = $1)::integer as candidates,
            (select count(*) from public.world_book_entries
             where source_import_id = $1)::integer as entries`,
        [replayImportId]
    )
)[0];
assert.deepEqual(replayedContentImportRows, {
    imports: 1,
    candidates: 4,
    entries: 1
});
assert.equal(
    (
        await rows(
            `select count(*)::integer as total
             from public.messages
             where client_message_id = $1`,
            [tenantClientMessageId]
        )
    )[0].total,
    2
);
const replayedLegacyContracts = await rows(`
    select
        to_regprocedure(
            'public.claim_chat_generation(uuid,uuid,integer)'
        )::text as claim,
        to_regprocedure(
            'public.renew_chat_generation_lease(uuid,uuid,integer)'
        )::text as renew,
        to_regprocedure(
            'public.commit_chat_generation_reply(uuid,uuid,text,jsonb,boolean)'
        )::text as commit,
        to_regprocedure(
            'public.fail_chat_generation_lease(uuid,uuid)'
        )::text as fail,
        to_regclass(
            'public.messages_staged_client_message_uidx'
        )::text as staged_user_index,
        to_regclass(
            'public.messages_staged_chat_reply_client_uidx'
        )::text as staged_assistant_index
`);
assert.deepEqual(replayedLegacyContracts[0], {
    claim: null,
    renew: null,
    commit: null,
    fail: null,
    staged_user_index: null,
    staged_assistant_index: null
});

await db.exec(`
    set role authenticated;
    select set_config(
        'request.jwt.claim.sub',
        '${memberAId}',
        false
    );
`);
const visibleToMember = await rows(
    "select title from public.conversations order by created_at"
);
assert.deepEqual(
    visibleToMember.map((item) => item.title),
    ["member private conversation"]
);

let sensitiveTableDenied = false;
try {
    await rows("select id from public.ai_provider_profiles");
} catch (error) {
    sensitiveTableDenied = /permission denied/i.test(String(error.message));
}
assert.equal(sensitiveTableDenied, true);

let backgroundJobRpcDenied = false;
try {
    await rows(
        `select id
         from public.claim_background_jobs(
            $1, $2, 'browser-role', 1, 300, 3
         )`,
        [memberAId, memberACompanionId]
    );
} catch (error) {
    backgroundJobRpcDenied = /permission denied.*claim_background_jobs/i.test(
        String(error.message)
    );
}
assert.equal(backgroundJobRpcDenied, true);

await db.exec("reset role");

const providerReasoningColumns = await rows(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_provider_profiles'
      and column_name = 'reasoning_effort'
`);
assert.equal(providerReasoningColumns.length, 1);

const settingsReasoningColumns = await rows(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'settings'
      and column_name = 'reasoning_effort'
`);
assert.equal(settingsReasoningColumns.length, 1);

const settingsContextResetColumns = await rows(`
    select column_name, is_nullable, data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'settings'
      and column_name = 'context_reset_at'
`);
assert.deepEqual(settingsContextResetColumns, [
    {
        column_name: "context_reset_at",
        is_nullable: "YES",
        data_type: "timestamp with time zone"
    }
]);

const personaResetContract = (
    await rows(`
        select
            to_regprocedure(
                'public.reset_dengta_persona_memory(uuid,uuid)'
            )::text as signature,
            (
                select prosecdef
                from pg_proc
                where oid = to_regprocedure(
                    'public.reset_dengta_persona_memory(uuid,uuid)'
                )
            ) as security_definer,
            has_function_privilege(
                'anon',
                'public.reset_dengta_persona_memory(uuid,uuid)',
                'execute'
            ) as anon_execute,
            has_function_privilege(
                'authenticated',
                'public.reset_dengta_persona_memory(uuid,uuid)',
                'execute'
            ) as authenticated_execute,
            has_function_privilege(
                'service_role',
                'public.reset_dengta_persona_memory(uuid,uuid)',
                'execute'
            ) as service_execute
    `)
)[0];
assert.deepEqual(personaResetContract, {
    signature: "reset_dengta_persona_memory(uuid,uuid)",
    security_definer: false,
    anon_execute: false,
    authenticated_execute: false,
    service_execute: true
});

for (const table of [
    "stable_memory_candidates",
    "companion_profile_versions",
    "memories",
    "conversation_composer_hints"
]) {
    await db.query(
        `delete from public.${table}
         where user_id in ($1, $2)`,
        [memberAId, memberBId]
    );
}
await db.query(
    `delete from public.background_jobs
     where user_id in ($1, $2)
       and status in ('pending', 'running')
       and job_type in (
           'proactive_message',
           'profile_refresh',
           'diary_update',
           'moment_post',
           'creative_check',
           'moment_interaction',
           'surprise_reveal'
       )`,
    [memberAId, memberBId]
);
await db.query(
    `insert into public.settings (user_id, companion_id)
     select $1, $2
     where not exists (
         select 1
         from public.settings
         where user_id = $1 and companion_id = $2
     )`,
    [memberAId, memberACompanionId]
);
await db.query(
    `insert into public.settings (user_id, companion_id)
     select $1, $2
     where not exists (
         select 1
         from public.settings
         where user_id = $1 and companion_id = $2
     )`,
    [memberBId, memberBCompanionId]
);
await db.query(
    `update public.settings
     set system_prompt = 'member A legacy system',
         additional_prompt = 'member A legacy additional',
         personality = 'member A legacy personality',
         unified_system_prompt = 'member A persistent instructions',
         user_details = 'member A persistent details',
         context_reset_at = null
     where user_id = $1 and companion_id = $2`,
    [memberAId, memberACompanionId]
);
await db.query(
    `update public.settings
     set system_prompt = 'member B legacy system',
         additional_prompt = 'member B legacy additional',
         personality = 'member B legacy personality',
         unified_system_prompt = 'member B persistent instructions',
         user_details = 'member B persistent details',
         context_reset_at = null
     where user_id = $1 and companion_id = $2`,
    [memberBId, memberBCompanionId]
);

await db.query(
    `insert into public.stable_memory_candidates (
        user_id, companion_id, summary
     ) values
        ($1, $2, 'member A candidate'),
        ($3, $4, 'member B candidate')`,
    [memberAId, memberACompanionId, memberBId, memberBCompanionId]
);
await db.query(
    `insert into public.companion_profile_versions (
        user_id, companion_id, version, profile
     ) values
        ($1, $2, 900, '{"owner":"member-a"}'::jsonb),
        ($3, $4, 900, '{"owner":"member-b"}'::jsonb)`,
    [memberAId, memberACompanionId, memberBId, memberBCompanionId]
);
await db.query(
    `insert into public.memories (
        user_id, companion_id, conversation_id, summary
     ) values
        ($1, $2, $3, 'member A memory'),
        ($4, $5, $6, 'member B memory')`,
    [
        memberAId,
        memberACompanionId,
        memberAConversationId,
        memberBId,
        memberBCompanionId,
        memberBConversationId
    ]
);
await db.query(
    `insert into public.conversation_composer_hints (
        user_id, companion_id, conversation_id, hint
     ) values
        ($1, $2, $3, 'member A hint'),
        ($4, $5, $6, 'member B hint')`,
    [
        memberAId,
        memberACompanionId,
        memberAConversationId,
        memberBId,
        memberBCompanionId,
        memberBConversationId
    ]
);

const resetContextJobTypes = [
    "proactive_message",
    "profile_refresh",
    "diary_update",
    "moment_post",
    "creative_check",
    "moment_interaction",
    "surprise_reveal"
];
for (const [tenant, userId, companionId] of [
    ["member-a", memberAId, memberACompanionId],
    ["member-b", memberBId, memberBCompanionId]
]) {
    for (const jobType of resetContextJobTypes) {
        await db.query(
            `insert into public.background_jobs (
                user_id,
                companion_id,
                job_type,
                due_at,
                dedupe_key,
                status
             ) values ($1, $2, $3, now(), $4, 'pending')`,
            [
                userId,
                companionId,
                jobType,
                `persona-reset-${tenant}-${jobType}`
            ]
        );
    }
}
await db.query(
    `insert into public.background_jobs (
        user_id,
        companion_id,
        job_type,
        due_at,
        dedupe_key,
        status
     ) values
        ($1, $2, 'proactive_message', now(), 'persona-reset-keep-completed', 'completed')`,
    [memberAId, memberACompanionId]
);

const preservedMemberAMessages = await rows(
    `select *
     from public.messages
     where user_id = $1 and companion_id = $2
     order by id`,
    [memberAId, memberACompanionId]
);

async function personaResetCounts(userId, companionId) {
    return (
        await rows(
            `select
                (
                    select count(*)::integer
                    from public.stable_memory_candidates
                    where user_id = $1 and companion_id = $2
                ) as candidates,
                (
                    select count(*)::integer
                    from public.companion_profile_versions
                    where user_id = $1 and companion_id = $2
                ) as profiles,
                (
                    select count(*)::integer
                    from public.memories
                    where user_id = $1 and companion_id = $2
                ) as memories,
                (
                    select count(*)::integer
                    from public.conversation_composer_hints
                    where user_id = $1 and companion_id = $2
                ) as hints,
                (
                    select count(*)::integer
                    from public.background_jobs
                    where user_id = $1
                      and companion_id = $2
                      and status in ('pending', 'running')
                      and job_type = any($3::text[])
                ) as context_jobs`,
            [userId, companionId, resetContextJobTypes]
        )
    )[0];
}

await db.exec(`
    create or replace function public.test_block_persona_memory_delete()
    returns trigger
    language plpgsql
    as $$
    begin
        if old.user_id = '${memberAId}'::uuid then
            raise exception 'test_persona_reset_rollback';
        end if;
        return old;
    end;
    $$;

    create trigger test_block_persona_memory_delete
    before delete on public.memories
    for each row execute function public.test_block_persona_memory_delete();
`);

await db.exec("set role service_role");
let personaResetRollbackError = "";
try {
    await rows(
        "select public.reset_dengta_persona_memory($1, $2) as result",
        [memberAId, memberACompanionId]
    );
} catch (error) {
    personaResetRollbackError = String(error.message);
}
await db.exec("reset role");
assert.match(personaResetRollbackError, /test_persona_reset_rollback/i);
assert.deepEqual(
    await personaResetCounts(memberAId, memberACompanionId),
    {
        candidates: 1,
        profiles: 1,
        memories: 1,
        hints: 1,
        context_jobs: 7
    },
    "a failed RPC must roll back every earlier delete"
);
const memberASettingsAfterRollback = (
    await rows(
        `select
            system_prompt,
            additional_prompt,
            personality,
            context_reset_at
         from public.settings
         where user_id = $1 and companion_id = $2`,
        [memberAId, memberACompanionId]
    )
)[0];
assert.deepEqual(memberASettingsAfterRollback, {
    system_prompt: "member A legacy system",
    additional_prompt: "member A legacy additional",
    personality: "member A legacy personality",
    context_reset_at: null
});
await db.exec(`
    drop trigger test_block_persona_memory_delete on public.memories;
    drop function public.test_block_persona_memory_delete();
`);

await db.exec("set role authenticated");
let personaResetDeniedToAuthenticated = false;
try {
    await rows(
        "select public.reset_dengta_persona_memory($1, $2) as result",
        [memberAId, memberACompanionId]
    );
} catch (error) {
    personaResetDeniedToAuthenticated =
        /permission denied.*reset_dengta_persona_memory/i.test(
            String(error.message)
        );
}
await db.exec("reset role");
assert.equal(personaResetDeniedToAuthenticated, true);

await db.exec("set role service_role");
const personaResetResult = (
    await rows(
        "select public.reset_dengta_persona_memory($1, $2) as result",
        [memberAId, memberACompanionId]
    )
)[0].result;
await db.exec("reset role");

assert.equal(personaResetResult.already_reset, false);
assert.equal(personaResetResult.settings_rows_updated, 1);
assert.equal(personaResetResult.deleted_rows.stable_memory_candidates, 1);
assert.equal(personaResetResult.deleted_rows.companion_profile_versions, 1);
assert.equal(personaResetResult.deleted_rows.memories, 1);
assert.equal(personaResetResult.deleted_rows.conversation_composer_hints, 1);
assert.equal(personaResetResult.deleted_rows.context_jobs, 7);
assert.deepEqual(personaResetResult.deleted_rows.context_jobs_by_type, {
    creative_check: 1,
    diary_update: 1,
    moment_interaction: 1,
    moment_post: 1,
    proactive_message: 1,
    profile_refresh: 1,
    surprise_reveal: 1
});
assert.equal(Number.isFinite(Date.parse(personaResetResult.cutoff)), true);
assert.deepEqual(
    await personaResetCounts(memberAId, memberACompanionId),
    {
        candidates: 0,
        profiles: 0,
        memories: 0,
        hints: 0,
        context_jobs: 0
    }
);
assert.deepEqual(
    await personaResetCounts(memberBId, memberBCompanionId),
    {
        candidates: 1,
        profiles: 1,
        memories: 1,
        hints: 1,
        context_jobs: 7
    },
    "the RPC must not clear another auth uid or companion"
);
const preservedMemberAJobs = await rows(
    `select job_type, status
     from public.background_jobs
     where user_id = $1
       and companion_id = $2
       and dedupe_key like 'persona-reset-keep-%'
     order by dedupe_key`,
    [memberAId, memberACompanionId]
);
assert.deepEqual(preservedMemberAJobs, [
    { job_type: "proactive_message", status: "completed" }
]);
const memberASettingsAfterReset = (
    await rows(
        `select
            system_prompt,
            additional_prompt,
            personality,
            unified_system_prompt,
            user_details,
            context_reset_at
         from public.settings
         where user_id = $1 and companion_id = $2`,
        [memberAId, memberACompanionId]
    )
)[0];
assert.equal(memberASettingsAfterReset.system_prompt, "");
assert.equal(memberASettingsAfterReset.additional_prompt, "");
assert.equal(memberASettingsAfterReset.personality, "");
assert.equal(
    memberASettingsAfterReset.unified_system_prompt,
    "member A persistent instructions"
);
assert.equal(memberASettingsAfterReset.user_details, "member A persistent details");
assert.ok(
    Math.abs(
        Date.parse(memberASettingsAfterReset.context_reset_at) -
            Date.parse(personaResetResult.cutoff)
    ) < 1000,
    "PGlite may truncate sub-second timestamptz precision when decoding rows"
);
assert.deepEqual(
    await rows(
        `select *
         from public.messages
         where user_id = $1 and companion_id = $2
         order by id`,
        [memberAId, memberACompanionId]
    ),
    preservedMemberAMessages,
    "chat history must remain byte-for-byte unchanged"
);

await new Promise((resolve) => setTimeout(resolve, 10));
await db.exec("set role service_role");
const repeatedPersonaReset = (
    await rows(
        "select public.reset_dengta_persona_memory($1, $2) as result",
        [memberAId, memberACompanionId]
    )
)[0].result;
await db.exec("reset role");
assert.equal(repeatedPersonaReset.already_reset, true);
assert.equal(repeatedPersonaReset.settings_rows_updated, 0);
assert.equal(repeatedPersonaReset.deleted_rows.context_jobs, 0);
assert.deepEqual(repeatedPersonaReset.deleted_rows.context_jobs_by_type, {});
assert.equal(
    Date.parse(repeatedPersonaReset.cutoff),
    Date.parse(personaResetResult.cutoff),
    "idempotent reset must preserve the first database cutoff"
);

await db.exec("set role authenticated");
let fullResetDeniedToAuthenticated = false;
try {
    await rows(
        "select public.reset_dengta_companion_state($1, $2) as result",
        [memberAId, memberACompanionId]
    );
} catch (error) {
    fullResetDeniedToAuthenticated =
        /permission denied.*reset_dengta_companion_state/i.test(
            String(error.message)
        );
}
await db.exec("reset role");
assert.equal(fullResetDeniedToAuthenticated, true);

await db.exec("set role service_role");
const fullResetResult = (
    await rows(
        "select public.reset_dengta_companion_state($1, $2) as result",
        [memberAId, memberACompanionId]
    )
)[0].result;
await db.exec("reset role");
assert.equal(fullResetResult.deleted_rows.messages > 0, true);
assert.equal(fullResetResult.deleted_rows.conversations > 0, true);

for (const table of [
    "background_jobs",
    "delivery_events",
    "stable_memory_candidates",
    "companion_profile_versions",
    "memories",
    "conversation_composer_hints",
    "moment_comments",
    "moments",
    "companion_diary_entries",
    "messages",
    "conversations"
]) {
    const [{ count }] = await rows(
        `select count(*)::integer as count
         from public.${table}
         where user_id = $1 and companion_id = $2`,
        [memberAId, memberACompanionId]
    );
    assert.equal(count, 0, `${table} must be empty after full reset`);
}

const memberASettingsAfterFullReset = (
    await rows(
        `select system_prompt, additional_prompt, personality,
                prompt_mode, unified_system_prompt, user_details
         from public.settings
         where user_id = $1 and companion_id = $2`,
        [memberAId, memberACompanionId]
    )
)[0];
assert.deepEqual(memberASettingsAfterFullReset, {
    system_prompt: "",
    additional_prompt: "",
    personality: "",
    prompt_mode: "unified",
    unified_system_prompt: "",
    user_details: ""
});
assert.equal(
    (
        await rows(
            `select count(*)::integer as count
             from public.messages
             where user_id = $1 and companion_id = $2`,
            [memberBId, memberBCompanionId]
        )
    )[0].count > 0,
    true,
    "full reset must not clear another tenant"
);

await db.close();

console.log(
    `PGlite applied and reapplied 000-${migrationNames.at(-1).slice(0, 3)}, verified atomic tenant persona and full companion resets, account runtime state, voice provider profiles, co-watch sessions, context cutoff, provider reasoning effort, tenant chat skin, creative and nursery storage, diary windows, notification installations, leases, recurring guards, FK types, backfill, and RLS isolation`
);
