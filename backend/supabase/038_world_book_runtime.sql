alter table public.world_book_entries
    add column if not exists priority integer not null default 100,
    add column if not exists constant boolean not null default false,
    add column if not exists match_mode text not null default 'any',
    add column if not exists case_sensitive boolean not null default false,
    add column if not exists position text not null default 'dynamic_context',
    add column if not exists sort_order integer not null default 0;

alter table public.world_book_entries
    drop constraint if exists world_book_entries_priority_check,
    drop constraint if exists world_book_entries_match_mode_check,
    drop constraint if exists world_book_entries_position_check;

alter table public.world_book_entries
    add constraint world_book_entries_priority_check
        check (priority between -100000 and 100000),
    add constraint world_book_entries_match_mode_check
        check (match_mode in ('any', 'all')),
    add constraint world_book_entries_position_check
        check (position in ('before_memory', 'dynamic_context'));

create index if not exists world_book_entries_tenant_runtime_idx
    on public.world_book_entries (
        user_id,
        companion_id,
        enabled,
        constant desc,
        priority desc,
        sort_order,
        updated_at desc,
        id
    );

comment on column public.world_book_entries.priority is
    'Higher values are considered first by the world-book runtime.';
comment on column public.world_book_entries.constant is
    'Constant entries are always included and must fit in full.';
comment on column public.world_book_entries.position is
    'Prompt placement: before stable memory or in turn dynamic context.';
