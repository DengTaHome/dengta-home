-- 054 兴趣画像:观看行为采集 + 兴趣画像
create table if not exists public.watch_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    kind text not null default 'video' check (kind in ('video', 'music')),
    title text not null default '',
    source_url text not null default '',
    watched_seconds integer not null default 0 check (watched_seconds between 0 and 86400),
    created_at timestamptz not null default now()
);
create index if not exists watch_events_user_idx on public.watch_events (user_id, companion_id, created_at desc);

create table if not exists public.interest_profiles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    interests jsonb not null default '[]',
    updated_at timestamptz not null default now(),
    unique (user_id, companion_id)
);
