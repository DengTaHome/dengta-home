-- 056 B站扫码登录二维码会话:匿名Cookie(buvid3等)按用户+key持久化,
-- 避免 Render 重启/多实例导致 poll 丢失会话关联(扫码后一直 waiting)。
create table if not exists public.bilibili_qr_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    qr_key text not null,
    cookies jsonb not null default '[]',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, companion_id, qr_key)
);
create index if not exists bilibili_qr_sessions_user_idx
    on public.bilibili_qr_sessions (user_id, companion_id, created_at desc);

alter table public.bilibili_qr_sessions enable row level security;
drop policy if exists bilibili_qr_sessions_select_own on public.bilibili_qr_sessions;
drop policy if exists bilibili_qr_sessions_insert_own on public.bilibili_qr_sessions;
drop policy if exists bilibili_qr_sessions_update_own on public.bilibili_qr_sessions;
drop policy if exists bilibili_qr_sessions_delete_own on public.bilibili_qr_sessions;
create policy bilibili_qr_sessions_select_own
    on public.bilibili_qr_sessions for select using (user_id = auth.uid());
create policy bilibili_qr_sessions_insert_own
    on public.bilibili_qr_sessions for insert with check (user_id = auth.uid());
create policy bilibili_qr_sessions_update_own
    on public.bilibili_qr_sessions for update using (user_id = auth.uid());
create policy bilibili_qr_sessions_delete_own
    on public.bilibili_qr_sessions for delete using (user_id = auth.uid());

revoke all on table public.bilibili_qr_sessions from public, anon;
grant select, insert, update, delete on table public.bilibili_qr_sessions to authenticated;

notify pgrst, 'reload schema';
