-- DengTa Home: one encrypted voice-output profile per account companion.
-- Apply with the Supabase SQL editor or migration runner after 026.
-- Requires the multitenant companions table and service_role.

create table if not exists public.voice_provider_profiles (
    user_id uuid not null,
    companion_id uuid not null,
    provider text not null default 'server_default'
        check (provider in ('server_default', 'deepgram')),
    enabled boolean not null default false,
    region text not null default 'global'
        check (region in ('global', 'eu', 'au')),
    model text not null default 'aura-2-helena-en',
    speed numeric(3, 2) not null default 1.00
        check (speed between 0.70 and 1.50),
    secret_ciphertext text,
    last_status text not null default 'untested'
        check (last_status in ('untested', 'connected', 'error')),
    last_error text,
    last_checked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, companion_id),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade
);

alter table public.voice_provider_profiles enable row level security;

revoke all on table public.voice_provider_profiles
    from public, anon, authenticated;
grant all on table public.voice_provider_profiles to service_role;

comment on table public.voice_provider_profiles is
    'Tenant-private TTS provider settings. Credentials are AES-256-GCM ciphertext and never returned to clients.';
comment on column public.voice_provider_profiles.secret_ciphertext is
    'Encrypted API credential. Never return this column from a public endpoint.';

notify pgrst, 'reload schema';
