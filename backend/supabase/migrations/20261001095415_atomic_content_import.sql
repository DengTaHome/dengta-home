alter table public.content_imports
    add column if not exists commit_decision_digest text,
    add column if not exists commit_protocol text;

create or replace function public.commit_content_import_atomic(
    p_user_id uuid,
    p_companion_id uuid,
    p_import_id uuid,
    p_decisions jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    task public.content_imports%rowtype;
    candidate public.content_import_candidates%rowtype;
    item jsonb;
    decision_digest text;
    accepted integer := 0;
    rejected integer := 0;
    candidate_total integer;
    affected integer;
begin
    if jsonb_typeof(p_decisions) is distinct from 'array' then
        raise exception using errcode = 'PT400', message = 'import_decisions_incomplete';
    end if;
    decision_digest := encode(sha256(convert_to(p_decisions::text, 'UTF8')), 'hex');
    select * into task from public.content_imports
    where id = p_import_id and user_id = p_user_id and companion_id = p_companion_id
    for update;
    if not found then
        raise exception using errcode = 'PT404', message = 'import_not_found';
    end if;
    if task.status = 'committed' then
        if task.commit_decision_digest is null then
            raise exception using errcode = 'PT409', message = 'import_already_committed';
        end if;
        if task.commit_decision_digest is distinct from decision_digest then
            raise exception using errcode = 'PT409', message = 'import_commit_conflict';
        end if;
        return jsonb_build_object('import', to_jsonb(task),
            'accepted_count', task.accepted_count, 'rejected_count', task.rejected_count,
            'replayed', true, 'atomic', true);
    end if;
    if task.commit_protocol is distinct from 'atomic-v1' then
        raise exception using errcode = 'PT409', message = 'import_legacy_preview';
    end if;
    select count(*) into candidate_total from public.content_import_candidates
    where import_id = task.id and user_id = p_user_id and companion_id = p_companion_id;
    if candidate_total <> task.candidate_count or candidate_total <> jsonb_array_length(p_decisions)
        or (select count(distinct value->>'candidate_id') from jsonb_array_elements(p_decisions)) <> candidate_total then
        raise exception using errcode = 'PT400', message = 'import_decisions_incomplete';
    end if;
    if exists (select 1 from public.content_import_candidates
        where import_id = task.id and user_id = p_user_id and companion_id = p_companion_id
        and status <> 'pending') then
        -- Older non-transactional commits may have written some of these rows already.
        raise exception using errcode = 'PT409', message = 'import_partial_legacy';
    end if;
    for candidate in select * from public.content_import_candidates
        where import_id = task.id and user_id = p_user_id and companion_id = p_companion_id
        order by ordinal for update
    loop
        select value into item from jsonb_array_elements(p_decisions)
        where value->>'candidate_id' = candidate.id::text;
        if not found then
            raise exception using errcode = 'PT400', message = 'import_candidate_invalid';
        end if;
        if item->>'decision' is null or item->>'decision' not in ('accepted', 'rejected') then
            raise exception using errcode = 'PT400', message = 'import_decision_invalid';
        end if;
        if not coalesce(
            (candidate.candidate_type = 'memory' and item->>'target' in ('memories', 'user_details'))
            or (candidate.candidate_type = 'style' and item->>'target' = 'unified_system_prompt')
            or (candidate.candidate_type = 'calendar' and item->>'target' = 'memory_calendar')
            or (candidate.candidate_type = 'world_book' and item->>'target' = 'world_book_entries'), false) then
            raise exception using errcode = 'PT400', message = 'import_target_invalid';
        end if;
        if char_length(coalesce(item->>'title','')) > 240
            or char_length(coalesce(item->>'content','')) > 200000 then
            raise exception using errcode = 'PT400', message = 'import_content_invalid';
        end if;
        if item->>'decision' = 'accepted' then
            if coalesce(item->>'content', '') = '' then
                raise exception using errcode = 'PT400', message = 'import_content_empty';
            end if;
            case item->>'target'
            when 'user_details' then
                update public.settings set
                    user_details = case when coalesce(user_details, '') = '' then item->>'content'
                        else user_details || E'\n\n' || (item->>'content') end,
                    updated_at = now()
                where user_id = p_user_id and companion_id = p_companion_id;
                get diagnostics affected = row_count;
                if affected <> 1 then
                    raise exception using errcode = 'PT409', message = 'import_settings_missing';
                end if;
            when 'unified_system_prompt' then
                update public.settings set
                    unified_system_prompt = case when coalesce(unified_system_prompt, '') = '' then item->>'content'
                        else unified_system_prompt || E'\n\n' || (item->>'content') end,
                    updated_at = now()
                where user_id = p_user_id and companion_id = p_companion_id;
                get diagnostics affected = row_count;
                if affected <> 1 then
                    raise exception using errcode = 'PT409', message = 'import_settings_missing';
                end if;
            when 'memories' then
                insert into public.memories (user_id, companion_id, summary, confirmation_status)
                values (p_user_id, p_companion_id, item->>'content', 'confirmed');
            when 'memory_calendar' then
                if candidate.metadata->'reliable_time' is distinct from 'true'::jsonb then
                    raise exception using errcode = 'PT400', message = 'import_time_unreliable';
                end if;
                insert into public.memory_calendar (user_id, companion_id, period_type,
                    period_start, period_end, summary, source_ids)
                values (p_user_id, p_companion_id, 'day',
                    (candidate.metadata->>'period_start')::timestamptz,
                    (candidate.metadata->>'period_end')::timestamptz,
                    item->>'content', array[candidate.id::text]);
            when 'world_book_entries' then
                insert into public.world_book_entries (user_id, companion_id, source_import_id,
                    title, content, keywords, enabled, priority, constant, match_mode,
                    case_sensitive, position, sort_order, metadata)
                values (p_user_id, p_companion_id, task.id, coalesce(item->>'title',''), item->>'content',
                    array(select jsonb_array_elements_text(item->'keywords')),
                    (item->>'enabled')::boolean, (item->>'priority')::integer,
                    (item->>'constant')::boolean, item->>'match_mode',
                    (item->>'case_sensitive')::boolean, item->>'position', (item->>'sort_order')::integer,
                    jsonb_build_object('candidate_id', candidate.id,
                        'source_fields', coalesce(candidate.metadata->'source_fields', '{}'::jsonb)));
            end case;
            accepted := accepted + 1;
        else
            rejected := rejected + 1;
        end if;
        update public.content_import_candidates set status = item->>'decision',
            edited_title = case when item->>'title' is distinct from candidate.title then item->>'title' end,
            edited_content = case when item->>'content' is distinct from candidate.content then item->>'content' end,
            edited_target = case when item->>'target' is distinct from candidate.target then item->>'target' end,
            updated_at = now()
        where id = candidate.id and user_id = p_user_id and companion_id = p_companion_id;
    end loop;
    update public.content_imports set status = 'committed', accepted_count = accepted,
        rejected_count = rejected, commit_decision_digest = decision_digest,
        committed_at = now(), updated_at = now()
    where id = task.id and user_id = p_user_id and companion_id = p_companion_id
    returning * into task;
    return jsonb_build_object('import', to_jsonb(task), 'accepted_count', accepted,
        'rejected_count', rejected, 'replayed', false, 'atomic', true);
end;
$$;

revoke all on function public.commit_content_import_atomic(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.commit_content_import_atomic(uuid,uuid,uuid,jsonb) to service_role;
comment on function public.commit_content_import_atomic(uuid,uuid,uuid,jsonb) is
    'Server-only tenant-scoped atomic import commit, with matching-decision replay receipts.';
