-- Tenant-scoped local playlists and listening session state.
-- Audio URLs are stored only on playlist items and are never copied to sessions.

create table if not exists public.music_playlists (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    name text not null check (char_length(name) between 1 and 180),
    source_format text not null check (source_format in ('json', 'm3u', 'text')),
    item_count integer not null default 0 check (item_count between 0 and 500),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (user_id, companion_id, id)
);

create table if not exists public.music_playlist_items (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    playlist_id uuid not null,
    position integer not null check (position between 0 and 499),
    url text not null check (char_length(url) between 1 and 4096),
    title text not null default '' check (char_length(title) <= 300),
    artist text not null default '' check (char_length(artist) <= 300),
    album text not null default '' check (char_length(album) <= 300),
    duration_seconds integer check (duration_seconds between 0 and 604800),
    lyrics text not null default '' check (char_length(lyrics) <= 20000),
    created_at timestamptz not null default now(),
    foreign key (user_id, companion_id, playlist_id)
        references public.music_playlists(user_id, companion_id, id)
        on delete cascade,
    unique (user_id, companion_id, playlist_id, id),
    unique (user_id, companion_id, playlist_id, position)
);

create index if not exists music_playlists_tenant_updated_idx
    on public.music_playlists (user_id, companion_id, updated_at desc, id);
create index if not exists music_playlist_items_tenant_playlist_idx
    on public.music_playlist_items (user_id, companion_id, playlist_id, position);

alter table public.music_playlists enable row level security;
alter table public.music_playlist_items enable row level security;

revoke all on table public.music_playlists from anon, authenticated;
revoke all on table public.music_playlist_items from anon, authenticated;
grant all on table public.music_playlists to service_role;
grant all on table public.music_playlist_items to service_role;

alter table public.co_watch_sessions
    add column if not exists session_mode text,
    add column if not exists playlist_id uuid,
    add column if not exists playlist_item_id uuid,
    add column if not exists playback_state text,
    add column if not exists playback_revision bigint;

update public.co_watch_sessions
set session_mode = coalesce(session_mode, 'screen'),
    playback_state = coalesce(playback_state, 'stopped'),
    playback_revision = coalesce(playback_revision, 0)
where session_mode is null
   or playback_state is null
   or playback_revision is null;

alter table public.co_watch_sessions
    alter column session_mode set default 'screen',
    alter column session_mode set not null,
    alter column playback_state set default 'stopped',
    alter column playback_state set not null,
    alter column playback_revision set default 0,
    alter column playback_revision set not null;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'co_watch_sessions_session_mode_check'
          and conrelid = 'public.co_watch_sessions'::regclass
    ) then
        alter table public.co_watch_sessions
            add constraint co_watch_sessions_session_mode_check
            check (session_mode in ('screen', 'direct_media', 'listening'));
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'co_watch_sessions_playback_state_check'
          and conrelid = 'public.co_watch_sessions'::regclass
    ) then
        alter table public.co_watch_sessions
            add constraint co_watch_sessions_playback_state_check
            check (playback_state in ('playing', 'paused', 'stopped'));
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'co_watch_sessions_playback_revision_check'
          and conrelid = 'public.co_watch_sessions'::regclass
    ) then
        alter table public.co_watch_sessions
            add constraint co_watch_sessions_playback_revision_check
            check (playback_revision >= 0);
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'co_watch_sessions_playlist_fk'
          and conrelid = 'public.co_watch_sessions'::regclass
    ) then
        alter table public.co_watch_sessions
            add constraint co_watch_sessions_playlist_fk
            foreign key (user_id, companion_id, playlist_id)
            references public.music_playlists(user_id, companion_id, id)
            on delete restrict;
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'co_watch_sessions_playlist_item_fk'
          and conrelid = 'public.co_watch_sessions'::regclass
    ) then
        alter table public.co_watch_sessions
            add constraint co_watch_sessions_playlist_item_fk
            foreign key (user_id, companion_id, playlist_id, playlist_item_id)
            references public.music_playlist_items(user_id, companion_id, playlist_id, id)
            on delete restrict;
    end if;
end
$$;

create index if not exists co_watch_sessions_tenant_listening_idx
    on public.co_watch_sessions (
        user_id, companion_id, session_mode, status, started_at desc
    );

comment on table public.music_playlists is
    'Tenant-local playlists imported from user-provided text; the server does not fetch media.';
comment on table public.music_playlist_items is
    'Normalized metadata and public HTTPS playback URLs; URLs never enter AI runtime context.';

notify pgrst, 'reload schema';
