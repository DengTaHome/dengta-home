alter table public.music_playback_queue_items
    add column if not exists playback_mode text not null default 'direct_https',
    add column if not exists provider_track_id text,
    add column if not exists external_url text;

update public.music_playback_queue_items queue_item
set playback_mode = source.playback_mode,
    provider_track_id = source.provider_track_id,
    external_url = source.external_url
from public.music_playlist_items source
where source.user_id = queue_item.user_id
  and source.companion_id = queue_item.companion_id
  and source.playlist_id = queue_item.playlist_id
  and source.id = queue_item.item_id
  and (
      queue_item.playback_mode is distinct from source.playback_mode
      or queue_item.provider_track_id is distinct from source.provider_track_id
      or queue_item.external_url is distinct from source.external_url
  );

alter table public.music_playback_queue_items
    drop constraint if exists music_playback_queue_items_playback_mode_check,
    drop constraint if exists music_playback_queue_items_provider_track_id_check,
    drop constraint if exists music_playback_queue_items_external_url_check,
    drop constraint if exists music_playback_queue_items_playback_resource_check;

alter table public.music_playback_queue_items
    add constraint music_playback_queue_items_playback_mode_check
        check (playback_mode in ('direct_https', 'external_netease')),
    add constraint music_playback_queue_items_provider_track_id_check
        check (provider_track_id is null or provider_track_id ~ '^[0-9]{1,20}$'),
    add constraint music_playback_queue_items_external_url_check
        check (external_url is null or char_length(external_url) between 1 and 4096),
    add constraint music_playback_queue_items_playback_resource_check
        check (
            playback_mode <> 'external_netease'
            or (
                provider_track_id ~ '^[0-9]{1,20}$'
                and external_url is not null
            )
        );

create or replace function public.copy_music_queue_item_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_source public.music_playlist_items%rowtype;
begin
    select * into strict v_source
    from public.music_playlist_items
    where user_id = new.user_id
      and companion_id = new.companion_id
      and playlist_id = new.playlist_id
      and id = new.item_id;

    new.title := v_source.title;
    new.artist := v_source.artist;
    new.album := v_source.album;
    new.duration_seconds := v_source.duration_seconds;
    new.playback_mode := v_source.playback_mode;
    new.provider_track_id := v_source.provider_track_id;
    new.external_url := v_source.external_url;
    return new;
end
$$;

drop trigger if exists music_queue_item_metadata_trigger
on public.music_playback_queue_items;
create trigger music_queue_item_metadata_trigger
before insert or update of playlist_id, item_id
on public.music_playback_queue_items
for each row execute function public.copy_music_queue_item_metadata();

do $$
declare
    v_constraint record;
begin
    for v_constraint in
        select constraint_name
        from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'music_playlist_items'
          and constraint_type = 'UNIQUE'
          and constraint_name in (
              select key_column_usage.constraint_name
              from information_schema.key_column_usage
              where key_column_usage.table_schema = 'public'
                and key_column_usage.table_name = 'music_playlist_items'
              group by key_column_usage.constraint_name
              having array_agg(key_column_usage.column_name::text order by key_column_usage.ordinal_position)
                  = array['user_id', 'companion_id', 'playlist_id', 'position']::text[]
          )
    loop
        execute format(
            'alter table public.music_playlist_items drop constraint %I',
            v_constraint.constraint_name
        );
    end loop;
end
$$;
alter table public.music_playlist_items
    add constraint music_playlist_items_position_key
    unique (user_id, companion_id, playlist_id, position)
    deferrable initially deferred;

create or replace function public.refresh_netease_music_playlist_items(
    p_user_id uuid,
    p_companion_id uuid,
    p_playlist_id uuid,
    p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_item jsonb;
    v_position integer := 0;
    v_retained_count integer;
    v_existing_id uuid;
begin
    if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then
        return jsonb_build_object('error', jsonb_build_object(
            'code', 'music_item_limit',
            'message', '每个歌单最多保留 500 首歌曲。'
        ));
    end if;

    perform 1
    from public.music_playlists
    where user_id = p_user_id
      and companion_id = p_companion_id
      and id = p_playlist_id
      and provider = 'netease'
    for update;
    if not found then
        return jsonb_build_object('error', jsonb_build_object(
            'code', 'music_playlist_not_found',
            'message', '找不到该网易云歌单。'
        ));
    end if;

    select count(*) into v_retained_count
    from public.music_playlist_items existing
    where existing.user_id = p_user_id
      and existing.companion_id = p_companion_id
      and existing.playlist_id = p_playlist_id
      and not exists (
          select 1
          from jsonb_array_elements(p_items) requested
          where requested->>'provider_track_id' = existing.provider_track_id
      )
      and (
          exists (
              select 1
              from public.music_playback_queue_items queue_item
              where queue_item.user_id = existing.user_id
                and queue_item.companion_id = existing.companion_id
                and queue_item.playlist_id = existing.playlist_id
                and queue_item.item_id = existing.id
          )
          or exists (
              select 1
              from public.co_watch_sessions session
              where session.user_id = existing.user_id
                and session.companion_id = existing.companion_id
                and session.playlist_id = existing.playlist_id
                and session.playlist_item_id = existing.id
          )
      );

    if jsonb_array_length(p_items) + v_retained_count > 500 then
        return jsonb_build_object('error', jsonb_build_object(
            'code', 'music_playlist_queued_item_limit',
            'message', '歌单刷新后会超过 500 首，请先移除队列中已下架的曲目。'
        ));
    end if;

    delete from public.music_playlist_items existing
    where existing.user_id = p_user_id
      and existing.companion_id = p_companion_id
      and existing.playlist_id = p_playlist_id
      and not exists (
          select 1
          from jsonb_array_elements(p_items) requested
          where requested->>'provider_track_id' = existing.provider_track_id
      )
      and not exists (
          select 1
          from public.music_playback_queue_items queue_item
          where queue_item.user_id = existing.user_id
            and queue_item.companion_id = existing.companion_id
            and queue_item.playlist_id = existing.playlist_id
            and queue_item.item_id = existing.id
      )
      and not exists (
          select 1
          from public.co_watch_sessions session
          where session.user_id = existing.user_id
            and session.companion_id = existing.companion_id
            and session.playlist_id = existing.playlist_id
            and session.playlist_item_id = existing.id
      );

    with requested as (
        select requested.value item, requested.ordinality::integer - 1 position
        from jsonb_array_elements(p_items) with ordinality requested
    ), retained as (
        select existing.id,
               jsonb_array_length(p_items)
                   + row_number() over (order by existing.position, existing.id)::integer - 1 position
        from public.music_playlist_items existing
        where existing.user_id = p_user_id
          and existing.companion_id = p_companion_id
          and existing.playlist_id = p_playlist_id
          and not exists (
              select 1 from requested
              where requested.item->>'provider_track_id' = existing.provider_track_id
          )
    ), mapped as (
        select existing.id, requested.position, requested.item
        from requested
        join public.music_playlist_items existing
          on existing.user_id = p_user_id
         and existing.companion_id = p_companion_id
         and existing.playlist_id = p_playlist_id
         and existing.provider_track_id = requested.item->>'provider_track_id'
        union all
        select retained.id, retained.position, null::jsonb
        from retained
    )
    update public.music_playlist_items existing
    set position = mapped.position,
        external_url = coalesce(mapped.item->>'external_url', existing.external_url),
        playback_mode = 'external_netease',
        url = null,
        title = coalesce(mapped.item->>'title', existing.title),
        artist = coalesce(mapped.item->>'artist', existing.artist),
        album = coalesce(mapped.item->>'album', existing.album),
        duration_seconds = coalesce(
            (mapped.item->>'duration_seconds')::integer,
            existing.duration_seconds
        )
    from mapped
    where existing.id = mapped.id;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
        select id into v_existing_id
        from public.music_playlist_items
        where user_id = p_user_id
          and companion_id = p_companion_id
          and playlist_id = p_playlist_id
          and provider_track_id = v_item->>'provider_track_id';

        if v_existing_id is null then
            insert into public.music_playlist_items (
                user_id, companion_id, playlist_id, position,
                provider_track_id, external_url, playback_mode, url,
                title, artist, album, duration_seconds, lyrics
            ) values (
                p_user_id, p_companion_id, p_playlist_id, v_position,
                v_item->>'provider_track_id', v_item->>'external_url',
                'external_netease', null, v_item->>'title',
                v_item->>'artist', v_item->>'album',
                (v_item->>'duration_seconds')::integer, ''
            );
        end if;
        v_position := v_position + 1;
        v_existing_id := null;
    end loop;

    v_position := jsonb_array_length(p_items) + v_retained_count;

    return jsonb_build_object('item_count', v_position);
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
    v_core_response jsonb;
    v_queue public.music_playback_queues%rowtype;
    v_previous_current_id uuid;
    v_current public.music_playback_queue_items%rowtype;
    v_response jsonb;
begin
    select queue.current_queue_item_id into v_previous_current_id
    from public.music_playback_queues queue
    where queue.user_id = p_user_id
      and queue.companion_id = p_companion_id
      and queue.session_id = p_session_id;

    v_core_response := public.apply_music_queue_operation_core(
        p_user_id,
        p_companion_id,
        p_session_id,
        p_request_id,
        p_expected_revision,
        p_operation
    );

    if v_core_response ? 'error' then
        return v_core_response;
    end if;

    select * into strict v_queue
    from public.music_playback_queues queue
    where queue.user_id = p_user_id
      and queue.companion_id = p_companion_id
      and queue.session_id = p_session_id;

    select * into v_current
    from public.music_playback_queue_items queue_item
    where queue_item.user_id = p_user_id
      and queue_item.companion_id = p_companion_id
      and queue_item.queue_id = v_queue.id
      and queue_item.id = v_queue.current_queue_item_id;

    if v_current.playback_mode = 'external_netease'
       and v_previous_current_id is distinct from v_current.id then
        update public.co_watch_sessions
        set playback_state = 'paused',
            media_position_seconds = 0,
            media_duration_seconds = coalesce(v_current.duration_seconds, 0),
            updated_at = now()
        where user_id = p_user_id
          and companion_id = p_companion_id
          and id = p_session_id;
    end if;

    select jsonb_build_object(
        'request_id', p_request_id,
        'replayed', coalesce((v_core_response->>'replayed')::boolean, false),
        'queue', jsonb_build_object(
            'session_id', p_session_id,
            'revision', v_queue.revision,
            'repeat_mode', v_queue.repeat_mode,
            'shuffle_enabled', v_queue.shuffle_enabled,
            'current_queue_item_id', v_queue.current_queue_item_id,
            'items', coalesce(jsonb_agg(jsonb_build_object(
                'id', queue_item.id,
                'item_id', queue_item.item_id,
                'playlist_id', queue_item.playlist_id,
                'position', queue_item.position,
                'title', queue_item.title,
                'artist', queue_item.artist,
                'album', queue_item.album,
                'duration_seconds', queue_item.duration_seconds,
                'playback_mode', queue_item.playback_mode,
                'provider_track_id', queue_item.provider_track_id,
                'external_url', queue_item.external_url
            ) order by queue_item.position) filter (where queue_item.id is not null), '[]'::jsonb)
        )
    ) into v_response
    from public.music_playback_queue_items queue_item
    where queue_item.user_id = p_user_id
      and queue_item.companion_id = p_companion_id
      and queue_item.queue_id = v_queue.id;

    update public.music_queue_operation_requests
    set response = v_response || jsonb_build_object('replayed', false)
    where user_id = p_user_id
      and companion_id = p_companion_id
      and session_id = p_session_id
      and request_id = p_request_id;

    return v_response;
end
$$;

revoke all on function public.apply_music_queue_operation_core(
    uuid, uuid, uuid, uuid, bigint, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.apply_music_queue_operation(
    uuid, uuid, uuid, uuid, bigint, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.apply_music_queue_operation(
    uuid, uuid, uuid, uuid, bigint, jsonb
) to service_role;
revoke all on function public.refresh_netease_music_playlist_items(
    uuid, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.refresh_netease_music_playlist_items(
    uuid, uuid, uuid, jsonb
) to service_role;

notify pgrst, 'reload schema';
