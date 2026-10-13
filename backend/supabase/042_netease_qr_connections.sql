-- Built-in NetEase Cloud Music QR-code login.
-- Stores the encrypted login cookie per tenant (never the password).
-- Also adds the 'netease_resolved' playback mode: direct playable URLs
-- resolved through the user's own NetEase login, still carrying the
-- provider track id so they can be refreshed later.

create table if not exists public.netease_qr_connections (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    netease_uid text not null default '' check (char_length(netease_uid) <= 40),
    nickname text not null default '' check (char_length(nickname) <= 80),
    cookie_ciphertext text not null check (char_length(cookie_ciphertext) between 1 and 8192),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (user_id, companion_id)
);

create index if not exists netease_qr_connections_tenant_idx
    on public.netease_qr_connections (user_id, companion_id);

alter table public.netease_qr_connections enable row level security;
revoke all on table public.netease_qr_connections from anon, authenticated;
grant all on table public.netease_qr_connections to service_role;

alter table public.music_playlist_items
    drop constraint if exists music_playlist_items_playback_mode_check,
    drop constraint if exists music_playlist_items_playback_resource_check;

alter table public.music_playlist_items
    add constraint music_playlist_items_playback_mode_check
        check (playback_mode in ('direct_https', 'external_netease', 'netease_resolved')),
    add constraint music_playlist_items_playback_resource_check
        check (
            (playback_mode = 'direct_https'
                and url is not null
                and provider_track_id is null)
            or
            (playback_mode = 'external_netease'
                and url is null
                and provider_track_id ~ '^[0-9]{1,20}$'
                and external_url is not null)
            or
            (playback_mode = 'netease_resolved'
                and url is not null
                and provider_track_id ~ '^[0-9]{1,20}$'
                and external_url is not null)
        );
