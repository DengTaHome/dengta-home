-- Persistent tenant-scoped metadata for screen co-watch sessions.
-- Captured screen images remain transient request bodies and are never stored here.

create table if not exists public.co_watch_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    conversation_id uuid not null
        references public.conversations(id) on delete cascade,
    status text not null default 'active'
        check (status in ('active', 'ended')),
    title text not null default '' check (char_length(title) <= 180),
    source_app text not null default ''
        check (char_length(source_app) <= 100),
    cadence_seconds integer not null default 90
        check (cadence_seconds between 60 and 10800),
    media_position_seconds integer not null default 0
        check (media_position_seconds between 0 and 604800),
    media_duration_seconds integer not null default 0
        check (media_duration_seconds between 0 and 604800),
    frame_count integer not null default 0 check (frame_count >= 0),
    reaction_count integer not null default 0 check (reaction_count >= 0),
    last_frame_at timestamptz,
    last_reaction_at timestamptz,
    last_reaction_message_id bigint
        references public.messages(id) on delete set null,
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade
);

create index if not exists co_watch_sessions_active_idx
    on public.co_watch_sessions (
        user_id,
        companion_id,
        status,
        started_at desc
    );

create unique index if not exists co_watch_sessions_one_active_uidx
    on public.co_watch_sessions (user_id, companion_id)
    where status = 'active';

create index if not exists co_watch_sessions_conversation_idx
    on public.co_watch_sessions (
        user_id,
        companion_id,
        conversation_id,
        started_at desc
    );

alter table public.co_watch_sessions enable row level security;

revoke all on table public.co_watch_sessions from anon, authenticated;
grant all on table public.co_watch_sessions to service_role;

comment on table public.co_watch_sessions is
    'Persistent co-watch lifecycle and reaction counters; captured screen frames are not stored.';

notify pgrst, 'reload schema';
