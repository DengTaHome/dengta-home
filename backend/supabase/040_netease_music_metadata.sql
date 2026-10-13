-- Tenant-scoped NetEase Cloud Music metadata imported through a user-owned MCP.
-- No upstream audio URL, cookie, webpage content, or playback token is stored.

alter table public.music_playlists
    add column if not exists provider text not null default 'local',
    add column if not exists provider_playlist_id text,
    add column if not exists external_url text;

alter table public.music_playlists
    drop constraint if exists music_playlists_source_format_check,
    drop constraint if exists music_playlists_provider_check,
    drop constraint if exists music_playlists_provider_identity_check,
    drop constraint if exists music_playlists_external_url_check;

alter table public.music_playlists
    add constraint music_playlists_source_format_check
        check (source_format in ('json', 'm3u', 'text', 'netease_mcp')),
    add constraint music_playlists_provider_check
        check (provider in ('local', 'netease')),
    add constraint music_playlists_provider_identity_check
        check (
            (provider = 'local' and provider_playlist_id is null)
            or
            (provider = 'netease' and provider_playlist_id ~ '^[0-9]{1,20}$')
        ),
    add constraint music_playlists_external_url_check
        check (external_url is null or char_length(external_url) between 1 and 4096);

create unique index if not exists music_playlists_tenant_provider_id_uidx
    on public.music_playlists (user_id, companion_id, provider, provider_playlist_id)
    where provider_playlist_id is not null;

alter table public.music_playlist_items
    add column if not exists provider_track_id text,
    add column if not exists external_url text,
    add column if not exists playback_mode text not null default 'direct_https';

alter table public.music_playlist_items
    alter column url drop not null;

alter table public.music_playlist_items
    drop constraint if exists music_playlist_items_url_check,
    drop constraint if exists music_playlist_items_provider_track_id_check,
    drop constraint if exists music_playlist_items_external_url_check,
    drop constraint if exists music_playlist_items_playback_mode_check,
    drop constraint if exists music_playlist_items_playback_resource_check;

alter table public.music_playlist_items
    add constraint music_playlist_items_url_check
        check (url is null or char_length(url) between 1 and 4096),
    add constraint music_playlist_items_provider_track_id_check
        check (provider_track_id is null or provider_track_id ~ '^[0-9]{1,20}$'),
    add constraint music_playlist_items_external_url_check
        check (external_url is null or char_length(external_url) between 1 and 4096),
    add constraint music_playlist_items_playback_mode_check
        check (playback_mode in ('direct_https', 'external_netease')),
    add constraint music_playlist_items_playback_resource_check
        check (
            (playback_mode = 'direct_https' and url is not null and provider_track_id is null)
            or
            (
                playback_mode = 'external_netease'
                and url is null
                and provider_track_id ~ '^[0-9]{1,20}$'
                and external_url is not null
            )
        );

create unique index if not exists music_playlist_items_tenant_provider_track_uidx
    on public.music_playlist_items (
        user_id, companion_id, playlist_id, provider_track_id
    ) where provider_track_id is not null;

-- Preserve the 039 implementation and place a provider guard in front of it.
do $$
begin
    if to_regprocedure(
        'public.apply_music_queue_operation_core(uuid,uuid,uuid,uuid,bigint,jsonb)'
    ) is null then
        alter function public.apply_music_queue_operation(
            uuid, uuid, uuid, uuid, bigint, jsonb
        ) rename to apply_music_queue_operation_core;
    end if;
end
$$;

create or replace function public.apply_music_queue_operation(
    p_user_id uuid,
    p_companion_id uuid,
    p_session_id uuid,
    p_request_id uuid,
    p_expected_revision bigint,
    p_operation jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_type text := lower(coalesce(p_operation->>'type', ''));
begin
    if exists (
        select 1
        from public.co_watch_sessions session
        join public.music_playlist_items item
          on item.user_id = session.user_id
         and item.companion_id = session.companion_id
         and item.id = session.playlist_item_id
        where session.user_id = p_user_id
          and session.companion_id = p_companion_id
          and session.id = p_session_id
          and item.playback_mode = 'external_netease'
    ) then
        return jsonb_build_object('error', jsonb_build_object(
            'code', 'music_external_track_not_queueable',
            'message', '外部网易云曲目不能加入一起听播放队列。'
        ));
    end if;

    if v_type = 'add' and exists (
        select 1
        from public.music_playlist_items item
        where item.user_id = p_user_id
          and item.companion_id = p_companion_id
          and item.id::text = p_operation->>'item_id'
          and item.playback_mode = 'external_netease'
    ) then
        return jsonb_build_object('error', jsonb_build_object(
            'code', 'music_external_track_not_queueable',
            'message', '外部网易云曲目不能加入一起听播放队列。'
        ));
    end if;

    if v_type = 'replace'
       and jsonb_typeof(p_operation->'item_ids') = 'array'
       and exists (
           select 1
           from jsonb_array_elements_text(p_operation->'item_ids') requested(id)
           join public.music_playlist_items item on item.id::text = requested.id
           where item.user_id = p_user_id
             and item.companion_id = p_companion_id
             and item.playback_mode = 'external_netease'
       ) then
        return jsonb_build_object('error', jsonb_build_object(
            'code', 'music_external_track_not_queueable',
            'message', '外部网易云曲目不能加入一起听播放队列。'
        ));
    end if;

    return public.apply_music_queue_operation_core(
        p_user_id,
        p_companion_id,
        p_session_id,
        p_request_id,
        p_expected_revision,
        p_operation
    );
end
$$;

revoke all on function public.apply_music_queue_operation_core(
    uuid, uuid, uuid, uuid, bigint, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.apply_music_queue_operation(
    uuid, uuid, uuid, uuid, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_music_queue_operation(
    uuid, uuid, uuid, uuid, bigint, jsonb
) to service_role;

comment on column public.music_playlists.provider is
    'Metadata provider; netease rows come only from the tenant-owned MCP connection.';
comment on column public.music_playlist_items.playback_mode is
    'direct_https is queueable; external_netease requires an explicit client gesture.';
comment on function public.apply_music_queue_operation(
    uuid, uuid, uuid, uuid, bigint, jsonb
) is 'Rejects external metadata tracks before applying the tenant-scoped queue operation.';

notify pgrst, 'reload schema';
