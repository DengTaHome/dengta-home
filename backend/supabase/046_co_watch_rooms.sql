-- 放映厅：跨租户多人一起看房间（B站式联机放映厅）。
-- 发起人创建房间（附带媒体信息），生成邀请码 → 其他用户输入邀请码加入。
-- 播放控制仅由发起人操作，通过 WebSocket 实时同步到所有参与者。
-- 群聊消息带有归属信息（用户/AI 名称、来源租户），便于识别谁在说话。

-- 1) 放映厅房间
create table if not exists public.co_watch_rooms (
    id uuid primary key default gen_random_uuid(),
    host_user_id uuid not null,
    host_companion_id uuid not null,
    status text not null default 'active'
        check (status in ('active', 'ended')),
    title text not null default '' check (char_length(title) <= 180),
    source_app text not null default '' check (char_length(source_app) <= 100),
    media_url text not null default '' check (char_length(media_url) <= 4096),
    media_duration_seconds integer not null default 0
        check (media_duration_seconds between 0 and 604800),
    media_position_seconds integer not null default 0
        check (media_position_seconds between 0 and 604800),
    playback_state text not null default 'paused'
        check (playback_state in ('playing', 'paused', 'stopped')),
    playback_revision integer not null default 0,
    join_code text not null unique check (char_length(join_code) between 6 and 20),
    max_participants integer not null default 50
        check (max_participants between 1 and 50),
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (host_user_id, host_companion_id)
        references public.companions(user_id, id) on delete cascade,
    -- 对应发起人自己的 co_watch_session（用于 AI 快速回复）
    session_id uuid references public.co_watch_sessions(id) on delete set null
);

create index if not exists co_watch_rooms_join_code_idx
    on public.co_watch_rooms (join_code)
    where status = 'active';

create index if not exists co_watch_rooms_host_idx
    on public.co_watch_rooms (host_user_id, host_companion_id, status);

alter table public.co_watch_rooms enable row level security;
revoke all on table public.co_watch_rooms from anon, authenticated;
grant all on table public.co_watch_rooms to service_role;

comment on table public.co_watch_rooms is
    'Cross-tenant watch-together rooms: host creates with a join code, guests enter by code, max 50 participants.';

-- 2) 放映厅参与者
create table if not exists public.co_watch_room_participants (
    id uuid primary key default gen_random_uuid(),
    room_id uuid not null
        references public.co_watch_rooms(id) on delete cascade,
    user_id uuid not null,
    companion_id uuid not null,
    display_name text not null default '' check (char_length(display_name) <= 100),
    ai_name text not null default '' check (char_length(ai_name) <= 100),
    role text not null default 'member'
        check (role in ('host', 'member')),
    joined_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    left_at timestamptz,
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (room_id, user_id, companion_id)
);

create index if not exists co_watch_room_participants_room_idx
    on public.co_watch_room_participants (room_id, left_at);

alter table public.co_watch_room_participants enable row level security;
revoke all on table public.co_watch_room_participants from anon, authenticated;
grant all on table public.co_watch_room_participants to service_role;

comment on table public.co_watch_room_participants is
    'Room participants: each DengTa user+companion pair can join once per room, display_name and ai_name are their own settings.';

-- 3) 放映厅群聊消息（带归属）
create table if not exists public.co_watch_room_messages (
    id bigint primary key generated always as identity,
    room_id uuid not null
        references public.co_watch_rooms(id) on delete cascade,
    sender_type text not null check (sender_type in ('user', 'ai')),
    sender_name text not null check (char_length(sender_name) <= 100),
    sender_user_id uuid,
    sender_companion_id uuid,
    ai_owner_companion_id uuid,
    content text not null check (char_length(content) <= 2000),
    media_position_seconds integer not null default 0
        check (media_position_seconds between 0 and 604800),
    created_at timestamptz not null default now(),
    foreign key (sender_user_id, sender_companion_id)
        references public.companions(user_id, id) on delete set null
);

create index if not exists co_watch_room_messages_room_idx
    on public.co_watch_room_messages (room_id, created_at desc);

alter table public.co_watch_room_messages enable row level security;
revoke all on table public.co_watch_room_messages from anon, authenticated;
grant all on table public.co_watch_room_messages to service_role;

comment on table public.co_watch_room_messages is
    'Room chat messages with ownership: sender_name shows who spoke, ai_owner_companion_id identifies which AI the message belongs to.';

notify pgrst, 'reload schema';