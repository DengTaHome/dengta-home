-- 伴侣社交记忆与关系追踪。
-- 用于放映厅多人互动：伴侣知道场内有谁、见过几次、关系如何，
-- 并在每次互动后积累记忆，跨放映厅延续（第一次见=陌生人，多次见=渐熟悉）。

-- 1) 伴侣-伴侣认识关系
create table if not exists public.companion_acquaintances (
    id uuid primary key default gen_random_uuid(),
    owner_companion_id uuid not null
        references public.companions(id) on delete cascade,
    target_companion_id uuid not null
        references public.companions(id) on delete cascade,
    target_user_id uuid not null,
    target_display_name text not null default '',
    target_ai_name text not null default '',
    meet_count integer not null default 1,
    last_met_room_id uuid,
    last_met_at timestamptz not null default now(),
    relationship text not null default 'stranger'
        check (relationship in (
            'stranger', 'acquaintance', 'friend', 'close_friend',
            'best_friend', 'partner', 'crush', 'flirt'
        )),
    affinity_score integer not null default 0
        check (affinity_score between -100 and 100),
    -- 认识的来源：同厅观影/聊天等
    meeting_context text not null default '',
    notes text not null default '' check (char_length(notes) <= 2000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (owner_companion_id, target_companion_id)
);

create index if not exists companion_acquaintances_owner_idx
    on public.companion_acquaintances (owner_companion_id, updated_at desc);

create index if not exists companion_acquaintances_target_idx
    on public.companion_acquaintances (target_companion_id);

alter table public.companion_acquaintances enable row level security;
revoke all on table public.companion_acquaintances from anon, authenticated;
grant all on table public.companion_acquaintances to service_role;

-- 2) 房间级记忆库（每个伴侣各自视角）
create table if not exists public.co_watch_room_memories (
    id uuid primary key default gen_random_uuid(),
    room_id uuid not null
        references public.co_watch_rooms(id) on delete cascade,
    owner_companion_id uuid not null
        references public.companions(id) on delete cascade,
    memory_type text not null check (memory_type in (
        'video_watched', 'conversation_summary', 'interaction_note', 'participant_intro'
    )),
    content text not null check (char_length(content) <= 4000),
    media_position_seconds integer not null default 0,
    created_at timestamptz not null default now()
);

create index if not exists co_watch_room_memories_owner_idx
    on public.co_watch_room_memories (owner_companion_id, created_at desc);

create index if not exists co_watch_room_memories_room_idx
    on public.co_watch_room_memories (room_id, owner_companion_id);

alter table public.co_watch_room_memories enable row level security;
revoke all on table public.co_watch_room_memories from anon, authenticated;
grant all on table public.co_watch_room_memories to service_role;

comment on table public.companion_acquaintances is
    'Between-companion acquaintance graph: tracks how many times two companions have met, their relationship tier, affinity, and context. Persists across rooms so AI partners recognize familiar users and their AIs.';
comment on table public.co_watch_room_memories is
    'Per-companion memory of a room: what video was watched, conversation summaries, and interaction notes, stored in real time and reusable in later rooms.';

notify pgrst, 'reload schema';