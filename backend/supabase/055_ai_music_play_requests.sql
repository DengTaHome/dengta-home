-- 055 AI 放歌请求:AI 说"放首歌"时后端落一条待播放请求,App 轮询后静默调起网易云播放
create table if not exists public.ai_music_play_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    song_id text not null,
    title text not null default '',
    artist text not null default '',
    cover_url text not null default '',
    status text not null default 'pending' check (status in ('pending', 'played', 'failed', 'superseded')),
    error text not null default '',
    created_at timestamptz not null default now(),
    processed_at timestamptz
);

create index if not exists ai_music_play_requests_pending_idx
    on public.ai_music_play_requests (user_id, companion_id, created_at desc)
    where status = 'pending';

alter table public.ai_music_play_requests enable row level security;

drop policy if exists ai_music_play_requests_select_own on public.ai_music_play_requests;
create policy ai_music_play_requests_select_own
    on public.ai_music_play_requests
    for select
    using (user_id = auth.uid());

drop policy if exists ai_music_play_requests_update_own on public.ai_music_play_requests;
create policy ai_music_play_requests_update_own
    on public.ai_music_play_requests
    for update
    using (user_id = auth.uid());

-- 只有后端 service_role 能插入
revoke all on table public.ai_music_play_requests from public, anon;
grant select, update on table public.ai_music_play_requests to authenticated;

notify pgrst, 'reload schema';
