-- 069_channel_sync_hardening.sql
-- Run after 068. Aligns an already-created schema with the hardened defaults and RLS:
--   * persona_sections.enabled defaults to false (opt-in only)
--   * memory sync defaults to none/0
--   * channel_bindings defaults to pending; authenticated users can only SELECT
--   * companion ownership is enforced on every policy
-- Idempotent.

begin;

alter table if exists public.persona_sections
    alter column enabled set default false;

alter table if exists public.channel_sync_preferences
    alter column memory_mode set default 'none',
    alter column memory_limit set default 0;

alter table if exists public.channel_bindings
    alter column status set default 'pending';

alter table if exists public.channel_bindings
    add column if not exists bind_token_expires_at timestamptz;

create unique index if not exists channel_bindings_token_unique_idx
    on public.channel_bindings (bind_token_hash)
    where bind_token_hash is not null;

-- Replace permissive 068 policies with companion-scoped ones.
drop policy if exists persona_sections_owner on public.persona_sections;
create policy persona_sections_owner on public.persona_sections
    for all using (
        auth.uid() = user_id
        and exists (select 1 from public.companions c where c.id = companion_id and c.user_id = auth.uid())
    ) with check (
        auth.uid() = user_id
        and exists (select 1 from public.companions c where c.id = companion_id and c.user_id = auth.uid())
    );

drop policy if exists channel_sync_preferences_owner on public.channel_sync_preferences;
create policy channel_sync_preferences_owner on public.channel_sync_preferences
    for all using (
        auth.uid() = user_id
        and exists (select 1 from public.companions c where c.id = companion_id and c.user_id = auth.uid())
    ) with check (
        auth.uid() = user_id
        and exists (select 1 from public.companions c where c.id = companion_id and c.user_id = auth.uid())
    );

-- Bindings: owner can read; writes stay with the service role (bind endpoint).
drop policy if exists channel_bindings_owner on public.channel_bindings;
drop policy if exists channel_bindings_owner_select on public.channel_bindings;
create policy channel_bindings_owner_select on public.channel_bindings
    for select using (
        auth.uid() = user_id
        and exists (select 1 from public.companions c where c.id = companion_id and c.user_id = auth.uid())
    );

commit;

notify pgrst, 'reload schema';
