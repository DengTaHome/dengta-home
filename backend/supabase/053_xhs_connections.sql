-- 053 小红书接入：连接状态
create table if not exists public.xhs_connections (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    status text not null default 'active' check (status in ('active', 'expired')),
    cookie_present boolean not null default false,
    logged_in_at timestamptz,
    updated_at timestamptz not null default now(),
    unique (user_id, companion_id)
);
