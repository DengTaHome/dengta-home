-- 设备信号 → AI 感知（安卓化）：事件流 + 最新快照 + 注入账本。
-- 事件只存结构化小对象，不含正文敏感内容。

create table if not exists public.device_events (
    id bigint generated always as identity primary key,
    user_id uuid not null,
    companion_id uuid not null,
    ts timestamptz not null default now(),
    event jsonb not null default '{}'::jsonb,
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade
);

create index if not exists device_events_tenant_ts_idx
    on public.device_events (user_id, companion_id, ts desc, id desc);

create table if not exists public.device_latest (
    user_id uuid not null,
    companion_id uuid not null,
    snapshot jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (user_id, companion_id),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade
);

create table if not exists public.device_injects (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    tag text not null check (char_length(tag) between 1 and 40),
    text text not null check (char_length(text) between 1 and 1000),
    delivered boolean not null default false,
    created_at timestamptz not null default now(),
    delivered_at timestamptz,
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade
);

create index if not exists device_injects_tenant_pending_idx
    on public.device_injects (user_id, companion_id, created_at desc)
    where delivered = false;

alter table public.device_events enable row level security;
alter table public.device_latest enable row level security;
alter table public.device_injects enable row level security;
revoke all on table public.device_events from anon, authenticated;
revoke all on table public.device_latest from anon, authenticated;
revoke all on table public.device_injects from anon, authenticated;
grant all on table public.device_events to service_role;
grant all on table public.device_latest to service_role;
grant all on table public.device_injects to service_role;
