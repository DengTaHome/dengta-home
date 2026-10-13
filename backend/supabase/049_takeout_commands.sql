-- 外卖点餐命令通道：云端 AI 下发命令 → 手机 App 执行 → 回传结果。
-- 平台登录 Cookie 只存在于用户手机 App 的 WebView 本地存储，服务器不保存账号凭据。

create table if not exists public.takeout_commands (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    status text not null default 'pending'
        check (status in ('pending','executing','done','failed','cancelled')),
    command jsonb not null default '{}'::jsonb,
    result jsonb,
    progress text not null default '' check (char_length(progress) <= 500),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    ack_at timestamptz,
    done_at timestamptz,
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade
);

create index if not exists takeout_commands_tenant_status_idx
    on public.takeout_commands (user_id, companion_id, status, created_at desc);

alter table public.takeout_commands enable row level security;
revoke all on table public.takeout_commands from anon, authenticated;
grant all on table public.takeout_commands to service_role;
