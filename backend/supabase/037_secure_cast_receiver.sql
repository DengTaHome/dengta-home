-- Secure, tenant-scoped receiver pairing state. Secrets are never returned by API DTOs.
alter table public.co_watch_sessions
    add column if not exists media_url_ciphertext text,
    add column if not exists media_url_fingerprint text,
    add column if not exists anchor_position_seconds integer not null default 0,
    add column if not exists anchor_at timestamptz,
    add column if not exists receiver_state text not null default 'idle',
    add column if not exists receiver_acknowledged boolean not null default false,
    add column if not exists receiver_position_seconds integer not null default 0,
    add column if not exists receiver_reported_at timestamptz;
alter table public.co_watch_sessions
    add column if not exists receiver_pairing_used boolean not null default false,
    add column if not exists receiver_pairing_failed_attempts integer not null default 0,
    add column if not exists receiver_pairing_locked_until timestamptz;
create unique index if not exists co_watch_sessions_tenant_id_uidx on public.co_watch_sessions(user_id, companion_id, id);

create table if not exists public.co_watch_receiver_grants (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    session_id uuid not null,
    token_hash text unique,
    failed_attempts integer not null default 0 check (failed_attempts between 0 and 10),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    foreign key (user_id, companion_id, session_id) references public.co_watch_sessions(user_id, companion_id, id) on delete cascade
);
create index if not exists co_watch_receiver_grants_session_idx on public.co_watch_receiver_grants(user_id, companion_id, session_id, expires_at);
alter table public.co_watch_receiver_grants enable row level security;
revoke all on table public.co_watch_receiver_grants from anon, authenticated;
grant all on table public.co_watch_receiver_grants to service_role;
notify pgrst, 'reload schema';
