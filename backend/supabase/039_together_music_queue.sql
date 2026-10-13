-- Tenant-scoped Together favorites and an atomic persistent playback queue.

create unique index if not exists music_playlist_items_tenant_item_uidx
    on public.music_playlist_items (user_id, companion_id, id);
create unique index if not exists co_watch_sessions_tenant_id_uidx
    on public.co_watch_sessions (user_id, companion_id, id);

create table if not exists public.music_favorites (
    user_id uuid not null,
    companion_id uuid not null,
    item_id uuid not null,
    created_at timestamptz not null default now(),
    primary key (user_id, companion_id, item_id),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    foreign key (user_id, companion_id, item_id)
        references public.music_playlist_items(user_id, companion_id, id)
        on delete cascade
);

create table if not exists public.music_playback_queues (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    session_id uuid not null,
    revision bigint not null default 0 check (revision >= 0),
    repeat_mode text not null default 'off'
        check (repeat_mode in ('off', 'all', 'one')),
    shuffle_enabled boolean not null default false,
    current_queue_item_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    foreign key (user_id, companion_id, session_id)
        references public.co_watch_sessions(user_id, companion_id, id)
        on delete cascade,
    unique (user_id, companion_id, id),
    unique (user_id, companion_id, session_id)
);

create table if not exists public.music_playback_queue_items (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    queue_id uuid not null,
    playlist_id uuid not null,
    item_id uuid not null,
    position integer not null check (position >= 0),
    title text not null default '' check (char_length(title) <= 300),
    artist text not null default '' check (char_length(artist) <= 300),
    album text not null default '' check (char_length(album) <= 300),
    duration_seconds integer check (duration_seconds between 0 and 604800),
    last_played_revision bigint,
    created_at timestamptz not null default now(),
    foreign key (user_id, companion_id, queue_id)
        references public.music_playback_queues(user_id, companion_id, id)
        on delete cascade,
    foreign key (user_id, companion_id, playlist_id, item_id)
        references public.music_playlist_items(user_id, companion_id, playlist_id, id)
        on delete restrict,
    unique (user_id, companion_id, queue_id, id),
    constraint music_playback_queue_items_position_key
        unique (user_id, companion_id, queue_id, position)
        deferrable initially deferred
);

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'music_playback_queues_current_item_fk'
          and conrelid = 'public.music_playback_queues'::regclass
    ) then
        alter table public.music_playback_queues
            add constraint music_playback_queues_current_item_fk
            foreign key (user_id, companion_id, id, current_queue_item_id)
            references public.music_playback_queue_items(
                user_id, companion_id, queue_id, id
            ) deferrable initially deferred;
    end if;
end
$$;

-- Internal receipt storage makes request_id retries durable and response-stable.
create table if not exists public.music_queue_operation_requests (
    user_id uuid not null,
    companion_id uuid not null,
    request_id uuid not null,
    session_id uuid not null,
    response jsonb not null,
    created_at timestamptz not null default now(),
    primary key (user_id, companion_id, session_id, request_id),
    foreign key (user_id, companion_id, session_id)
        references public.co_watch_sessions(user_id, companion_id, id)
        on delete cascade
);

create index if not exists music_favorites_recent_idx
    on public.music_favorites (user_id, companion_id, created_at desc);
create index if not exists music_queue_items_position_idx
    on public.music_playback_queue_items (
        user_id, companion_id, queue_id, position
    );

alter table public.music_favorites enable row level security;
alter table public.music_playback_queues enable row level security;
alter table public.music_playback_queue_items enable row level security;
alter table public.music_queue_operation_requests enable row level security;

revoke all on table public.music_favorites from anon, authenticated;
revoke all on table public.music_playback_queues from anon, authenticated;
revoke all on table public.music_playback_queue_items from anon, authenticated;
revoke all on table public.music_queue_operation_requests from anon, authenticated;
grant all on table public.music_favorites to service_role;
grant all on table public.music_playback_queues to service_role;
grant all on table public.music_playback_queue_items to service_role;
grant all on table public.music_queue_operation_requests to service_role;

create or replace function public.apply_music_queue_operation(
    p_user_id uuid,
    p_companion_id uuid,
    p_session_id uuid,
    p_request_id uuid,
    p_expected_revision bigint,
    p_operation jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_session public.co_watch_sessions%rowtype;
    v_queue public.music_playback_queues%rowtype;
    v_item public.music_playlist_items%rowtype;
    v_queue_item public.music_playback_queue_items%rowtype;
    v_current public.music_playback_queue_items%rowtype;
    v_type text := lower(coalesce(p_operation->>'type', ''));
    v_repeat_mode text;
    v_shuffle_enabled boolean;
    v_position integer;
    v_count integer;
    v_new_revision bigint;
    v_response jsonb;
    v_item_id uuid;
    v_queue_created boolean := false;
begin
    if p_expected_revision is null or p_expected_revision < 0 then
        return jsonb_build_object('error', jsonb_build_object(
            'code', 'music_queue_revision_invalid',
            'message', 'expected_revision 格式不正确。'
        ));
    end if;

    select * into v_session
    from public.co_watch_sessions
    where user_id = p_user_id
      and companion_id = p_companion_id
      and id = p_session_id
    for update;
    if not found then
        return jsonb_build_object('error', jsonb_build_object(
            'code', 'co_watch_session_not_found',
            'message', '找不到这场一起听。'
        ));
    end if;
    if v_session.session_mode <> 'listening' then
        return jsonb_build_object('error', jsonb_build_object(
            'code', 'music_queue_session_invalid',
            'message', '该会话不是一起听会话。'
        ));
    end if;
    if v_session.status <> 'active' then
        return jsonb_build_object('error', jsonb_build_object(
            'code', 'music_queue_session_inactive',
            'message', '只有进行中的一起听会话可以修改队列。'
        ));
    end if;

    insert into public.music_playback_queues (
        user_id, companion_id, session_id
    ) values (p_user_id, p_companion_id, p_session_id)
    on conflict (user_id, companion_id, session_id) do nothing
    returning true into v_queue_created;

    select * into v_queue
    from public.music_playback_queues
    where user_id = p_user_id
      and companion_id = p_companion_id
      and session_id = p_session_id
    for update;

    if v_queue_created and v_session.playlist_item_id is not null then
        select * into v_item
        from public.music_playlist_items
        where user_id = p_user_id and companion_id = p_companion_id
          and id = v_session.playlist_item_id;
        if found then
            insert into public.music_playback_queue_items (
                user_id, companion_id, queue_id, playlist_id, item_id,
                position, title, artist, album, duration_seconds
            ) values (
                p_user_id, p_companion_id, v_queue.id, v_item.playlist_id,
                v_item.id, 0, v_item.title, v_item.artist,
                v_item.album, v_item.duration_seconds
            ) returning * into v_queue_item;
            update public.music_playback_queues
            set current_queue_item_id = v_queue_item.id
            where id = v_queue.id;
            v_queue.current_queue_item_id := v_queue_item.id;
        end if;
    end if;

    select response into v_response
    from public.music_queue_operation_requests
    where user_id = p_user_id
      and companion_id = p_companion_id
      and session_id = p_session_id
      and request_id = p_request_id;
    if found then
        return v_response || jsonb_build_object('replayed', true);
    end if;

    if v_queue.revision <> p_expected_revision then
        return jsonb_build_object('error', jsonb_build_object(
            'code', 'music_queue_revision_conflict',
            'message', '播放队列已被其他客户端更新，请刷新后重试。',
            'current_revision', v_queue.revision
        ));
    end if;
    if v_type not in ('add', 'remove', 'move', 'replace', 'advance', 'set_mode') then
        return jsonb_build_object('error', jsonb_build_object(
            'code', 'music_queue_operation_invalid',
            'message', '队列操作类型不正确。'
        ));
    end if;

    v_new_revision := v_queue.revision + 1;
    if v_type = 'add' then
        begin
            v_item_id := (p_operation->>'item_id')::uuid;
        exception when invalid_text_representation then
            return jsonb_build_object('error', jsonb_build_object(
                'code', 'music_queue_item_invalid', 'message', '歌曲编号格式不正确。'
            ));
        end;
        select * into v_item
        from public.music_playlist_items
        where user_id = p_user_id and companion_id = p_companion_id
          and id = v_item_id;
        if not found then
            return jsonb_build_object('error', jsonb_build_object(
                'code', 'music_queue_item_not_found',
                'message', '歌曲不属于当前租户。'
            ));
        end if;
        select count(*) into v_count from public.music_playback_queue_items
        where user_id = p_user_id and companion_id = p_companion_id
          and queue_id = v_queue.id;
        if v_count >= 500 then
            return jsonb_build_object('error', jsonb_build_object(
                'code', 'music_queue_item_limit', 'message', '播放队列最多包含 500 首歌曲。'
            ));
        end if;
        v_position := coalesce((p_operation->>'position')::integer, v_count);
        if v_position < 0 or v_position > v_count then
            return jsonb_build_object('error', jsonb_build_object(
                'code', 'music_queue_position_invalid', 'message', '队列位置不正确。'
            ));
        end if;
        update public.music_playback_queue_items set position = position + 1
        where user_id = p_user_id and companion_id = p_companion_id
          and queue_id = v_queue.id and position >= v_position;
        insert into public.music_playback_queue_items (
            user_id, companion_id, queue_id, playlist_id, item_id, position,
            title, artist, album, duration_seconds
        ) values (
            p_user_id, p_companion_id, v_queue.id, v_item.playlist_id,
            v_item.id, v_position, v_item.title, v_item.artist,
            v_item.album, v_item.duration_seconds
        ) returning * into v_queue_item;
        if v_queue.current_queue_item_id is null then
            v_queue.current_queue_item_id := v_queue_item.id;
        end if;
    elsif v_type = 'remove' then
        select * into v_queue_item from public.music_playback_queue_items
        where user_id = p_user_id and companion_id = p_companion_id
          and queue_id = v_queue.id
          and id = (p_operation->>'queue_item_id')::uuid;
        if not found then
            return jsonb_build_object('error', jsonb_build_object(
                'code', 'music_queue_item_not_found', 'message', '找不到该队列项。'
            ));
        end if;
        if v_queue.current_queue_item_id = v_queue_item.id then
            select * into v_current from public.music_playback_queue_items
            where user_id = p_user_id and companion_id = p_companion_id
              and queue_id = v_queue.id and id <> v_queue_item.id
            order by case when position > v_queue_item.position then 0 else 1 end,
                     position
            limit 1;
            v_queue.current_queue_item_id := v_current.id;
        end if;
        delete from public.music_playback_queue_items
        where user_id = p_user_id and companion_id = p_companion_id
          and queue_id = v_queue.id and id = v_queue_item.id;
        update public.music_playback_queue_items set position = position - 1
        where user_id = p_user_id and companion_id = p_companion_id
          and queue_id = v_queue.id and position > v_queue_item.position;
    elsif v_type = 'move' then
        select count(*) into v_count from public.music_playback_queue_items
        where user_id = p_user_id and companion_id = p_companion_id
          and queue_id = v_queue.id;
        select * into v_queue_item from public.music_playback_queue_items
        where user_id = p_user_id and companion_id = p_companion_id
          and queue_id = v_queue.id
          and id = (p_operation->>'queue_item_id')::uuid;
        if not found then
            return jsonb_build_object('error', jsonb_build_object(
                'code', 'music_queue_item_not_found', 'message', '找不到该队列项。'
            ));
        end if;
        v_position := (p_operation->>'position')::integer;
        if v_position < 0 or v_position >= v_count then
            return jsonb_build_object('error', jsonb_build_object(
                'code', 'music_queue_position_invalid', 'message', '队列位置不正确。'
            ));
        end if;
        if v_position < v_queue_item.position then
            update public.music_playback_queue_items set position = position + 1
            where user_id = p_user_id and companion_id = p_companion_id
              and queue_id = v_queue.id
              and position >= v_position and position < v_queue_item.position;
        elsif v_position > v_queue_item.position then
            update public.music_playback_queue_items set position = position - 1
            where user_id = p_user_id and companion_id = p_companion_id
              and queue_id = v_queue.id
              and position > v_queue_item.position and position <= v_position;
        end if;
        update public.music_playback_queue_items set position = v_position
        where id = v_queue_item.id;
    elsif v_type = 'replace' then
        if jsonb_typeof(p_operation->'item_ids') <> 'array'
           or jsonb_array_length(p_operation->'item_ids') > 500 then
            return jsonb_build_object('error', jsonb_build_object(
                'code', 'music_queue_items_invalid',
                'message', '替换队列需要不超过 500 首歌曲。'
            ));
        end if;
        v_position := 0;
        for v_item_id in select value::uuid
            from jsonb_array_elements_text(p_operation->'item_ids')
        loop
            select * into v_item from public.music_playlist_items
            where user_id = p_user_id and companion_id = p_companion_id
              and id = v_item_id;
            if not found then
                return jsonb_build_object('error', jsonb_build_object(
                    'code', 'music_queue_item_not_found',
                    'message', '队列包含不属于当前租户的歌曲。'
                ));
            end if;
            v_position := v_position + 1;
        end loop;
        delete from public.music_playback_queue_items
        where user_id = p_user_id and companion_id = p_companion_id
          and queue_id = v_queue.id;
        v_position := 0;
        for v_item_id in select value::uuid
            from jsonb_array_elements_text(p_operation->'item_ids')
        loop
            select * into v_item from public.music_playlist_items
            where user_id = p_user_id and companion_id = p_companion_id
              and id = v_item_id;
            insert into public.music_playback_queue_items (
                user_id, companion_id, queue_id, playlist_id, item_id,
                position, title, artist, album, duration_seconds
            ) values (
                p_user_id, p_companion_id, v_queue.id, v_item.playlist_id,
                v_item.id, v_position, v_item.title, v_item.artist,
                v_item.album, v_item.duration_seconds
            ) returning * into v_queue_item;
            if v_position = 0 then
                v_queue.current_queue_item_id := v_queue_item.id;
            end if;
            v_position := v_position + 1;
        end loop;
        if v_position = 0 then v_queue.current_queue_item_id := null; end if;
    elsif v_type = 'set_mode' then
        v_repeat_mode := coalesce(p_operation->>'repeat_mode', v_queue.repeat_mode);
        if v_repeat_mode not in ('off', 'all', 'one') then
            return jsonb_build_object('error', jsonb_build_object(
                'code', 'music_queue_repeat_mode_invalid', 'message', '循环模式不正确。'
            ));
        end if;
        if p_operation ? 'shuffle_enabled'
           and jsonb_typeof(p_operation->'shuffle_enabled') <> 'boolean' then
            return jsonb_build_object('error', jsonb_build_object(
                'code', 'music_queue_shuffle_invalid', 'message', '随机播放开关不正确。'
            ));
        end if;
        v_queue.repeat_mode := v_repeat_mode;
        v_queue.shuffle_enabled := coalesce(
            (p_operation->>'shuffle_enabled')::boolean,
            v_queue.shuffle_enabled
        );
    elsif v_type = 'advance' and v_queue.current_queue_item_id is not null then
        select * into v_current from public.music_playback_queue_items
        where user_id = p_user_id and companion_id = p_companion_id
          and queue_id = v_queue.id and id = v_queue.current_queue_item_id;
        if v_queue.repeat_mode <> 'one' then
            update public.music_playback_queue_items
            set last_played_revision = v_new_revision
            where id = v_current.id;
            if v_queue.shuffle_enabled then
                select * into v_queue_item from public.music_playback_queue_items
                where user_id = p_user_id and companion_id = p_companion_id
                  and queue_id = v_queue.id and id <> v_current.id
                  and last_played_revision is null
                order by random() limit 1;
                if not found and v_queue.repeat_mode = 'all' then
                    update public.music_playback_queue_items
                    set last_played_revision = null
                    where user_id = p_user_id and companion_id = p_companion_id
                      and queue_id = v_queue.id;
                    select * into v_queue_item from public.music_playback_queue_items
                    where user_id = p_user_id and companion_id = p_companion_id
                      and queue_id = v_queue.id
                    order by random() limit 1;
                end if;
            else
                select * into v_queue_item from public.music_playback_queue_items
                where user_id = p_user_id and companion_id = p_companion_id
                  and queue_id = v_queue.id and position > v_current.position
                order by position limit 1;
                if not found and v_queue.repeat_mode = 'all' then
                    select * into v_queue_item from public.music_playback_queue_items
                    where user_id = p_user_id and companion_id = p_companion_id
                      and queue_id = v_queue.id
                    order by position limit 1;
                end if;
            end if;
            v_queue.current_queue_item_id := v_queue_item.id;
        end if;
    end if;

    select * into v_current from public.music_playback_queue_items
    where user_id = p_user_id and companion_id = p_companion_id
      and queue_id = v_queue.id and id = v_queue.current_queue_item_id;
    update public.music_playback_queues set
        revision = v_new_revision,
        repeat_mode = v_queue.repeat_mode,
        shuffle_enabled = v_queue.shuffle_enabled,
        current_queue_item_id = v_queue.current_queue_item_id,
        updated_at = now()
    where id = v_queue.id;
    update public.co_watch_sessions set
        playlist_id = v_current.playlist_id,
        playlist_item_id = v_current.item_id,
        playback_state = case when v_current.id is null then 'stopped' else playback_state end,
        playback_revision = playback_revision + 1,
        updated_at = now()
    where user_id = p_user_id and companion_id = p_companion_id
      and id = p_session_id;

    select jsonb_build_object(
        'request_id', p_request_id,
        'replayed', false,
        'queue', jsonb_build_object(
            'session_id', p_session_id,
            'revision', v_new_revision,
            'repeat_mode', v_queue.repeat_mode,
            'shuffle_enabled', v_queue.shuffle_enabled,
            'current_queue_item_id', v_queue.current_queue_item_id,
            'items', coalesce(jsonb_agg(jsonb_build_object(
                'id', qi.id,
                'item_id', qi.item_id,
                'playlist_id', qi.playlist_id,
                'position', qi.position,
                'title', qi.title,
                'artist', qi.artist,
                'album', qi.album,
                'duration_seconds', qi.duration_seconds
            ) order by qi.position) filter (where qi.id is not null), '[]'::jsonb)
        )
    ) into v_response
    from public.music_playback_queue_items qi
    where qi.user_id = p_user_id and qi.companion_id = p_companion_id
      and qi.queue_id = v_queue.id;

    insert into public.music_queue_operation_requests (
        user_id, companion_id, request_id, session_id, response
    ) values (p_user_id, p_companion_id, p_request_id, p_session_id, v_response);
    return v_response;
end
$$;

revoke all on function public.apply_music_queue_operation(
    uuid, uuid, uuid, uuid, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_music_queue_operation(
    uuid, uuid, uuid, uuid, bigint, jsonb
) to service_role;

comment on table public.music_favorites is
    'Tenant-scoped favorite references; public APIs resolve metadata without media URLs or lyrics.';
comment on table public.music_playback_queues is
    'One durable CAS-controlled playback queue per Together listening session.';
comment on function public.apply_music_queue_operation(uuid, uuid, uuid, uuid, bigint, jsonb) is
    'Atomically applies an idempotent tenant-scoped queue operation under a row lock.';

notify pgrst, 'reload schema';
