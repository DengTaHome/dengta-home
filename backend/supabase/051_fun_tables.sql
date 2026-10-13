-- 051 每日一拍（A2）+ 隐藏成就（D1）+ 默契度挑战记录（A3）
create table if not exists public.daily_shots (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    shot_date date not null,
    image_path text not null default '',
    note text not null default '',
    created_at timestamptz not null default now(),
    unique (user_id, companion_id, shot_date)
);
create index if not exists daily_shots_user_idx on public.daily_shots (user_id, companion_id, shot_date);

create table if not exists public.achievements (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    code text not null,
    unlocked_at timestamptz not null default now(),
    unique (user_id, companion_id, code)
);

create table if not exists public.compatibility_records (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    score integer not null check (score between 0 and 100),
    comment text not null default '',
    created_at timestamptz not null default now()
);
create index if not exists compatibility_records_user_idx on public.compatibility_records (user_id, companion_id, created_at desc);
