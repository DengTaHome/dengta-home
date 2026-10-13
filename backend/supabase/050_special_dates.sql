-- 050 特殊日子日历：纪念日（A1）+ 追番/追剧日历（B1）
create table if not exists public.special_dates (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    kind text not null default 'anniversary' check (kind in ('anniversary', 'show')),
    title text not null,
    event_date date not null,
    description text not null default '',
    recur_yearly boolean not null default true,
    next_episode text not null default '',
    reminder_days integer not null default 0 check (reminder_days between 0 and 30),
    created_at timestamptz not null default now()
);
create index if not exists special_dates_user_idx on public.special_dates (user_id, companion_id, event_date);
