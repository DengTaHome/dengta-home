-- DRAFT: Supabase CLI is unavailable locally. Generate a named migration with
-- `supabase migration new surprise_map` before approving/applying this SQL.
-- Only new feature tables; no existing persona, memory or history rows change.
create table if not exists public.surprise_map_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  companion_id uuid not null,
  client_request_id uuid not null,
  title text not null check (length(title) between 1 and 160),
  body text not null check (length(body) between 1 and 16000),
  hint text not null check (length(hint) between 1 and 240),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null check (radius_m between 50 and 5000),
  area_latitude double precision not null check (area_latitude between -90 and 90),
  area_longitude double precision not null check (area_longitude between -180 and 180),
  area_radius_m integer not null check (area_radius_m >= 300),
  created_at timestamptz not null default now(),
  unique (user_id, companion_id, id),
  unique (user_id, companion_id, client_request_id),
  foreign key (user_id, companion_id) references public.companions(user_id, id) on delete cascade
);
create table if not exists public.surprise_map_publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  companion_id uuid not null,
  letter_id uuid not null,
  public_title text not null check (length(public_title) between 1 and 160),
  public_text text not null check (length(public_text) between 1 and 16000),
  public_place text not null check (length(public_place) between 1 and 160),
  public_latitude double precision not null check (public_latitude between -90 and 90),
  public_longitude double precision not null check (public_longitude between -180 and 180),
  claim_latitude double precision not null check (claim_latitude between -90 and 90),
  claim_longitude double precision not null check (claim_longitude between -180 and 180),
  claim_radius_m integer not null check (claim_radius_m between 50 and 5000),
  state text not null default 'published' check (state in ('published', 'withdrawn')),
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  unique (user_id, companion_id, letter_id),
  foreign key (user_id, companion_id, letter_id) references public.surprise_map_letters(user_id, companion_id, id) on delete cascade
);
create table if not exists public.surprise_map_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  companion_id uuid not null,
  letter_id uuid,
  publication_id uuid references public.surprise_map_publications(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  check ((letter_id is null) <> (publication_id is null)),
  unique (user_id, companion_id, letter_id),
  unique (user_id, companion_id, publication_id),
  foreign key (user_id, companion_id) references public.companions(user_id, id) on delete cascade,
  foreign key (user_id, companion_id, letter_id) references public.surprise_map_letters(user_id, companion_id, id) on delete cascade
);
create index if not exists surprise_map_letters_owner_recent_idx on public.surprise_map_letters (user_id, companion_id, created_at desc);
create index if not exists surprise_map_publications_recent_idx on public.surprise_map_publications (state, created_at desc);
create index if not exists surprise_map_claims_owner_idx on public.surprise_map_claims (user_id, companion_id, claimed_at desc);
alter table public.surprise_map_letters enable row level security;
alter table public.surprise_map_publications enable row level security;
alter table public.surprise_map_claims enable row level security;
revoke all on table public.surprise_map_letters, public.surprise_map_publications, public.surprise_map_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.surprise_map_letters, public.surprise_map_publications, public.surprise_map_claims to service_role;
drop policy if exists surprise_map_letters_server on public.surprise_map_letters;
create policy surprise_map_letters_server on public.surprise_map_letters for all to service_role using (true) with check (true);
drop policy if exists surprise_map_publications_server on public.surprise_map_publications;
create policy surprise_map_publications_server on public.surprise_map_publications for all to service_role using (true) with check (true);
drop policy if exists surprise_map_claims_server on public.surprise_map_claims;
create policy surprise_map_claims_server on public.surprise_map_claims for all to service_role using (true) with check (true);
comment on table public.surprise_map_letters is 'Private scoped surprise letters. Receiver coordinates are never stored.';
comment on table public.surprise_map_publications is 'Confirmed independent public snapshots; exact claim anchors and tenant IDs are server-only, never sent in public projections.';
comment on table public.surprise_map_claims is 'One claim per recipient account and companion. No receiver position or trajectory.';
