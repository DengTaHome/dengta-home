-- Enforce one companion artwork message per tenant, including concurrent
-- route retries and background-worker delivery.

create unique index if not exists messages_tenant_creative_artwork_uidx
    on public.messages (
        user_id,
        companion_id,
        (tool_calls ->> 'artwork_id')
    )
    where role = 'assistant'
      and tool_calls ? 'artwork_id'
      and user_id is not null
      and companion_id is not null;

notify pgrst, 'reload schema';
