-- Separate model-context visibility from the user's permanent chat history.
alter table public.messages
    add column if not exists context_visible boolean not null default true;

update public.messages as message
set visible = true,
    context_visible = false
from public.memory_calendar as calendar
where message.visible = false
  and message.user_id = calendar.user_id
  and message.companion_id = calendar.companion_id
  and message.conversation_id = calendar.conversation_id
  and message.id::text = any(calendar.source_ids);

comment on column public.messages.context_visible is
    'Whether this message may be injected into model context. visible remains the user-history visibility flag.';

create index if not exists messages_context_visible_idx
    on public.messages (conversation_id, created_at)
    where visible = true and context_visible = true;
