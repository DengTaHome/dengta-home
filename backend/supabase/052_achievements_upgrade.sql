-- 052 成就系统升级：用户自定义成就 + 新手引导成就
create table if not exists public.user_achievements (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    code text not null default '',
    title text not null,
    description text not null default '',
    emoji text not null default '🏆',
    category text not null default 'custom',
    created_by text not null default 'user' check (created_by in ('user', 'ai')),
    unlocked boolean not null default false,
    unlocked_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists user_achievements_user_idx on public.user_achievements (user_id, companion_id);
