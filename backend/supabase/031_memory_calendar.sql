-- Memory calendar: hierarchical day/week/month/year summaries.
-- Inspired by kiwi-mem's calendar system: near = vivid, far = fuzzy.
-- Also adds locked/superseded columns to memories for conflict resolution
-- and owner-pinned retention (kiwi-mem's "locked memories never decay").

-- 1. memory_calendar table -------------------------------------------------

create table if not exists public.memory_calendar (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    conversation_id uuid,
    period_type text not null check (period_type in ('day', 'week', 'month', 'year')),
    period_start timestamptz not null,
    period_end timestamptz not null,
    summary text not null default '',
    importance smallint not null default 5 check (importance >= 1 and importance <= 10),
    superseded boolean not null default false,
    source_ids text[] not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists memory_calendar_tenant_idx
    on public.memory_calendar (user_id, companion_id);

create index if not exists memory_calendar_period_idx
    on public.memory_calendar (user_id, companion_id, period_type, period_start desc);

create index if not exists memory_calendar_active_idx
    on public.memory_calendar (user_id, companion_id, period_type)
    where superseded = false;

alter table public.memory_calendar
    enable row level security;

drop policy if exists memory_calendar_own_rows on public.memory_calendar;
create policy memory_calendar_own_rows on public.memory_calendar
    for select to authenticated using (user_id = auth.uid());

drop policy if exists memory_calendar_insert_own on public.memory_calendar;
create policy memory_calendar_insert_own on public.memory_calendar
    for insert to authenticated with check (user_id = auth.uid());

drop policy if exists memory_calendar_update_own on public.memory_calendar;
create policy memory_calendar_update_own on public.memory_calendar
    for update to authenticated using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists memory_calendar_delete_own on public.memory_calendar;
create policy memory_calendar_delete_own on public.memory_calendar
    for delete to authenticated using (user_id = auth.uid());

comment on table public.memory_calendar is
    'Hierarchical conversation summaries: day -> week -> month -> year. Near periods are vivid, far periods are fuzzy. Superseded rows are retained (never deleted) per "information never lost" principle.';

comment on column public.memory_calendar.period_type is
    'day / week / month / year — higher = more compressed.';

comment on column public.memory_calendar.superseded is
    'true when a higher-level summary has incorporated this row. Retained for audit, never deleted.';

comment on column public.memory_calendar.source_ids is
    'IDs of the lower-level rows (or message IDs for day level) that were merged into this summary.';

-- 2. memories table: locked + superseded columns ---------------------------

alter table public.memories
    add column if not exists locked boolean not null default false;

alter table public.memories
    add column if not exists superseded boolean not null default false;

comment on column public.memories.locked is
    'Owner-pinned memory. Never decays, never auto-compressed, always injected first as core memory block.';

comment on column public.memories.superseded is
    'true when a newer memory has replaced this one due to factual conflict (e.g. job change, move). Retained for audit, never deleted.';

-- Locked memories get a partial index for fast core-block retrieval.
create index if not exists memories_locked_idx
    on public.memories (user_id, companion_id, updated_at desc)
    where locked = true and superseded = false;

-- Active (non-superseded) memories get a partial index for fast filtering.
create index if not exists memories_active_idx
    on public.memories (user_id, companion_id, updated_at desc)
    where superseded = false;