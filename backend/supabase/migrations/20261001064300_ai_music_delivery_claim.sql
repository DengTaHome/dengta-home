begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.ai_music_play_requests
  add column if not exists delivery_token uuid,
  add column if not exists delivery_claimed_at timestamptz,
  add column if not exists delivery_committed_at timestamptz;

-- Only the authenticated backend may grant or complete a delivery lease.
revoke all on public.ai_music_play_requests from public, anon, authenticated;
grant select on public.ai_music_play_requests to authenticated;

create or replace function public.apply_ai_music_delivery(
  p_user_id uuid, p_companion_id uuid, p_request_id uuid,
  p_delivery_token uuid, p_action text, p_status text default null,
  p_error text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item public.ai_music_play_requests%rowtype;
  receipt jsonb;
  at_time timestamptz := clock_timestamp();
begin
  if p_user_id is null or p_companion_id is null or p_delivery_token is null
     or p_action is null or p_action not in ('claim','commit','result') then
    return jsonb_build_object('code','music_ai_delivery_invalid','status',400);
  end if;
  select * into item from public.ai_music_play_requests
    where id=p_request_id and user_id=p_user_id and companion_id=p_companion_id
    for update;
  if not found then
    return jsonb_build_object('code','music_ai_request_not_found','status',404);
  end if;
  at_time := clock_timestamp();
  receipt := jsonb_build_object('id',item.id,'status',item.status);
  if item.status='superseded' then
    return jsonb_build_object('code','music_ai_request_superseded','status',409);
  end if;
  if p_action='claim' then
    if item.status <> 'pending' then
      return jsonb_build_object('claimed',false,'request',receipt);
    end if;
    if item.delivery_committed_at is not null then
      return jsonb_build_object('claimed',item.delivery_token=p_delivery_token,
        'committed',true,'request',receipt);
    end if;
    if item.delivery_token is distinct from p_delivery_token
       and item.delivery_claimed_at > at_time - interval '60 seconds' then
      return jsonb_build_object('claimed',false,'request',receipt);
    end if;
    if item.delivery_token is distinct from p_delivery_token
       or item.delivery_claimed_at is null
       or item.delivery_claimed_at <= at_time - interval '60 seconds' then
      update public.ai_music_play_requests set delivery_token=p_delivery_token,
        delivery_claimed_at=at_time where id=item.id;
    end if;
    return jsonb_build_object('claimed',true,'committed',false,'request',receipt);
  end if;
  if item.delivery_token is distinct from p_delivery_token then
    return jsonb_build_object('code','music_ai_delivery_conflict','status',409);
  end if;
  if p_action='commit' then
    if item.status <> 'pending' then
      return jsonb_build_object('code','music_ai_result_conflict','status',409);
    end if;
    if item.delivery_committed_at is not null then
      return jsonb_build_object('ok',true,'committed',true,'replayed',true,'request',receipt);
    end if;
    if item.delivery_claimed_at is null or item.delivery_claimed_at <= at_time - interval '60 seconds' then
      return jsonb_build_object('code','music_ai_delivery_expired','status',409);
    end if;
    update public.ai_music_play_requests set delivery_committed_at=at_time where id=item.id;
    return jsonb_build_object('ok',true,'committed',true,'replayed',false,'request',receipt);
  end if;
  if p_status is null or p_status not in ('played','failed') then
    return jsonb_build_object('code','ai_play_result_invalid','status',400);
  end if;
  if item.delivery_committed_at is null then
    return jsonb_build_object('code','music_ai_claim_required','status',409);
  end if;
  if item.status=p_status then
    return jsonb_build_object('ok',true,'replayed',true,'request',receipt);
  end if;
  if item.status <> 'pending' then
    return jsonb_build_object('code','music_ai_result_conflict','status',409);
  end if;
  update public.ai_music_play_requests set status=p_status, processed_at=at_time,
    error=case when p_status='played' then '' when p_error='music_ai_open_unconfirmed'
      then 'music_ai_open_unconfirmed' else 'music_ai_open_failed' end where id=item.id;
  return jsonb_build_object('ok',true,'replayed',false,
    'request',jsonb_build_object('id',item.id,'status',p_status));
end;
$$;
revoke all on function public.apply_ai_music_delivery(uuid,uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.apply_ai_music_delivery(uuid,uuid,uuid,uuid,text,text,text) to service_role;
notify pgrst, 'reload schema';
commit;
