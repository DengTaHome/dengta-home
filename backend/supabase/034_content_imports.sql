-- Tenant-scoped previews and commits for world-book and chat-history imports.

create table if not exists public.content_imports (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    source_type text not null
        check (source_type in ('world_book', 'chat_history')),
    source_name text not null default '',
    media_type text not null,
    content_digest text not null
        check (content_digest ~ '^[0-9a-f]{64}$'),
    status text not null default 'preview'
        check (status in ('preview', 'committed')),
    candidate_count integer not null default 0
        check (candidate_count >= 0),
    warning_count integer not null default 0
        check (warning_count >= 0),
    accepted_count integer not null default 0
        check (accepted_count >= 0),
    rejected_count integer not null default 0
        check (rejected_count >= 0),
    committed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint content_imports_tenant_companion_fk
        foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (user_id, companion_id, id)
);

create table if not exists public.content_import_candidates (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    import_id uuid not null,
    ordinal integer not null check (ordinal >= 0),
    candidate_type text not null
        check (candidate_type in (
            'memory',
            'style',
            'world_book',
            'calendar'
        )),
    target text not null
        check (target in (
            'user_details',
            'unified_system_prompt',
            'memories',
            'memory_calendar',
            'world_book_entries'
        )),
    title text not null default '' check (char_length(title) <= 240),
    content text not null check (char_length(content) between 1 and 200000),
    status text not null default 'pending'
        check (status in ('pending', 'accepted', 'rejected')),
    metadata jsonb not null default '{}'::jsonb,
    edited_title text,
    edited_content text,
    edited_target text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint content_import_candidates_import_fk
        foreign key (user_id, companion_id, import_id)
        references public.content_imports(user_id, companion_id, id)
        on delete cascade,
    constraint content_import_candidates_type_target_check check (
        (candidate_type = 'world_book'
            and target = 'world_book_entries')
        or (candidate_type = 'style'
            and target = 'unified_system_prompt')
        or (candidate_type = 'calendar'
            and target = 'memory_calendar')
        or (candidate_type = 'memory'
            and target in ('user_details', 'memories'))
    ),
    constraint content_import_candidates_edited_target_check check (
        edited_target is null
        or edited_target in (
            'user_details',
            'unified_system_prompt',
            'memories',
            'memory_calendar',
            'world_book_entries'
        )
    ),
    unique (user_id, companion_id, import_id, ordinal)
);

-- Keep this migration corrective as well as replayable. This safely upgrades
-- databases that briefly received an earlier MVP candidate vocabulary.
alter table public.content_import_candidates
    add column if not exists title text not null default '';
alter table public.content_import_candidates
    add column if not exists edited_title text;

alter table public.content_import_candidates
    drop constraint if exists content_import_candidates_candidate_type_check;
alter table public.content_import_candidates
    drop constraint if exists content_import_candidates_type_target_check;
alter table public.content_import_candidates
    drop constraint if exists content_import_candidates_edited_target_check;
alter table public.content_import_candidates
    drop constraint if exists content_import_candidates_title_check;

update public.content_import_candidates
set
    candidate_type = case candidate_type
        when 'world_book_entry' then 'world_book'
        when 'instruction' then 'style'
        else 'memory'
    end,
    target = case
        when candidate_type = 'world_book_entry' then 'world_book_entries'
        when candidate_type = 'instruction' then 'unified_system_prompt'
        when target = 'memory_calendar' then 'memories'
        else target
    end,
    edited_target = case
        when edited_target = 'memory_calendar' then 'memories'
        else edited_target
    end,
    title = coalesce(
        nullif(title, ''),
        nullif(metadata ->> 'title', ''),
        '导入候选'
    )
where candidate_type in (
    'world_book_entry',
    'chat_message',
    'user_request',
    'profile_fact',
    'instruction'
);

alter table public.content_import_candidates
    add constraint content_import_candidates_candidate_type_check
    check (candidate_type in ('memory', 'style', 'world_book', 'calendar'));

alter table public.content_import_candidates
    add constraint content_import_candidates_type_target_check check (
        (candidate_type = 'world_book'
            and target = 'world_book_entries')
        or (candidate_type = 'style'
            and target = 'unified_system_prompt')
        or (candidate_type = 'calendar'
            and target = 'memory_calendar')
        or (candidate_type = 'memory'
            and target in ('user_details', 'memories'))
    );

alter table public.content_import_candidates
    add constraint content_import_candidates_edited_target_check check (
        edited_target is null
        or (candidate_type = 'world_book'
            and edited_target = 'world_book_entries')
        or (candidate_type = 'style'
            and edited_target = 'unified_system_prompt')
        or (candidate_type = 'calendar'
            and edited_target = 'memory_calendar')
        or (candidate_type = 'memory'
            and edited_target in ('user_details', 'memories'))
    );

alter table public.content_import_candidates
    add constraint content_import_candidates_title_check
    check (char_length(title) <= 240);

create table if not exists public.world_book_entries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    source_import_id uuid,
    title text not null default '',
    content text not null check (char_length(content) between 1 and 200000),
    keywords text[] not null default '{}',
    enabled boolean not null default true,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint world_book_entries_tenant_companion_fk
        foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    constraint world_book_entries_source_import_fk
        foreign key (user_id, companion_id, source_import_id)
        references public.content_imports(user_id, companion_id, id)
);

create index if not exists content_imports_tenant_recent_idx
    on public.content_imports (user_id, companion_id, created_at desc);

create index if not exists content_import_candidates_tenant_import_idx
    on public.content_import_candidates (
        user_id,
        companion_id,
        import_id,
        ordinal
    );

create index if not exists world_book_entries_tenant_recent_idx
    on public.world_book_entries (user_id, companion_id, created_at desc);

create index if not exists world_book_entries_tenant_import_idx
    on public.world_book_entries (
        user_id,
        companion_id,
        source_import_id
    );

alter table public.content_imports enable row level security;
alter table public.content_import_candidates enable row level security;
alter table public.world_book_entries enable row level security;

revoke all on table public.content_imports from anon, authenticated;
revoke all on table public.content_import_candidates from anon, authenticated;
revoke all on table public.world_book_entries from anon, authenticated;

grant all on table public.content_imports to service_role;
grant all on table public.content_import_candidates to service_role;
grant all on table public.world_book_entries to service_role;

comment on table public.content_imports is
    'Server-only import preview and commit state. Source bytes are not retained.';
comment on table public.content_import_candidates is
    'User-reviewable candidates extracted from an import preview.';
comment on table public.world_book_entries is
    'Tenant-owned world-book knowledge accepted from content imports.';
