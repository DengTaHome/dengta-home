-- 观看记录与票根系统（对应 Lean_In viewing/ticket 概念，独立实现）。
-- 记录一次观看的进度、完成状态与票根，用于「最近观看」与「播放结束界面」。
-- 跨租户表：所有表需用 admin 原始 Supabase 读写。

-- 1) 观看记录表
create table if not exists public.watch_viewings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid,
    watch_session_id uuid,
    media_url text not null default '',
    media_title text not null default '',
    media_duration_seconds integer not null default 0,
    last_position_seconds integer not null default 0,
    watched_seconds integer not null default 0,
    status text not null default 'in_progress'
        check (status in ('in_progress', 'completed', 'interrupted')),
    is_completed boolean not null default false,
    started_at timestamptz not null default now(),
    last_watched_at timestamptz not null default now(),
    completed_at timestamptz,
    extra jsonb not null default '{}'::jsonb
);

create index if not exists watch_viewings_user_idx
    on public.watch_viewings (user_id, last_watched_at desc);

create index if not exists watch_viewings_session_idx
    on public.watch_viewings (watch_session_id);

alter table public.watch_viewings enable row level security;
revoke all on table public.watch_viewings from anon, authenticated;
grant all on table public.watch_viewings to service_role;

-- 2) 票根表（观看完成后的稳定凭证）
create table if not exists public.watch_receipts (
    id uuid primary key default gen_random_uuid(),
    viewing_id uuid not null references public.watch_viewings(id) on delete cascade,
    user_id uuid not null,
    companion_id uuid,
    media_title text not null default '',
    watched_seconds integer not null default 0,
    duration_seconds integer not null default 0,
    completion_ratio numeric not null default 0 check (completion_ratio between 0 and 100),
    ticket_no text not null default '',
    issued_at timestamptz not null default now(),
    unique (viewing_id)
);

create index if not exists watch_receipts_user_idx
    on public.watch_receipts (user_id, issued_at desc);

alter table public.watch_receipts enable row level security;
revoke all on table public.watch_receipts from anon, authenticated;
grant all on table public.watch_receipts to service_role;

comment on table public.watch_viewings is
    'Watch viewing records with progress and completion state, powering Recent Watch and post-playback ticket UI.';
comment on table public.watch_receipts is
    'Stable ticket issued after a viewing completes, shown on the post-playback screen.';

notify pgrst, 'reload schema';