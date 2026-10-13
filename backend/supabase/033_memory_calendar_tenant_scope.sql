drop policy if exists memory_calendar_own_rows on public.memory_calendar;
create policy memory_calendar_own_rows on public.memory_calendar
    for select to authenticated
    using (
        user_id = auth.uid()
        and exists (
            select 1 from public.companions
            where companions.id = memory_calendar.companion_id
              and companions.user_id = auth.uid()
        )
    );

drop policy if exists memory_calendar_insert_own on public.memory_calendar;
create policy memory_calendar_insert_own on public.memory_calendar
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and exists (
            select 1 from public.companions
            where companions.id = memory_calendar.companion_id
              and companions.user_id = auth.uid()
        )
    );

drop policy if exists memory_calendar_update_own on public.memory_calendar;
create policy memory_calendar_update_own on public.memory_calendar
    for update to authenticated
    using (
        user_id = auth.uid()
        and exists (
            select 1 from public.companions
            where companions.id = memory_calendar.companion_id
              and companions.user_id = auth.uid()
        )
    )
    with check (
        user_id = auth.uid()
        and exists (
            select 1 from public.companions
            where companions.id = memory_calendar.companion_id
              and companions.user_id = auth.uid()
        )
    );

drop policy if exists memory_calendar_delete_own on public.memory_calendar;
create policy memory_calendar_delete_own on public.memory_calendar
    for delete to authenticated
    using (
        user_id = auth.uid()
        and exists (
            select 1 from public.companions
            where companions.id = memory_calendar.companion_id
              and companions.user_id = auth.uid()
        )
    );

create index if not exists memory_calendar_conversation_period_idx
    on public.memory_calendar (
        user_id,
        companion_id,
        conversation_id,
        period_type,
        period_start desc
    );
