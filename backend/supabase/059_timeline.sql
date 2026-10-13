-- timeline-for-agent 多租户集成：生活时间轴（分类/事件/提案）
-- 每个用户（user_id+companion_id）独立存储：taxonomy（分类+事件节点+提案）、按天的事件

create table if not exists public.timeline_taxonomy (
  user_id uuid not null,
  companion_id uuid not null,
  taxonomy jsonb not null default '{}'::jsonb,
  proposals jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, companion_id)
);

create table if not exists public.timeline_days (
  user_id uuid not null,
  companion_id uuid not null,
  date text not null,
  status text not null default 'draft',
  updated_at timestamptz not null default now(),
  events jsonb not null default '[]'::jsonb,
  primary key (user_id, companion_id, date)
);

create index if not exists timeline_days_tenant_date_idx
  on public.timeline_days (user_id, companion_id, date desc);

alter table public.timeline_taxonomy enable row level security;
alter table public.timeline_days enable row level security;

drop policy if exists "timeline_taxonomy_owner_all" on public.timeline_taxonomy;
create policy "timeline_taxonomy_owner_all"
  on public.timeline_taxonomy
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "timeline_days_owner_all" on public.timeline_days;
create policy "timeline_days_owner_all"
  on public.timeline_days
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
