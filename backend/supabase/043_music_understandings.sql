-- Tenant-scoped cached music understanding results.
-- Stores the condensed structured analysis per NetEase track so the AI can
-- narrate at the casual or expert tier without re-analysing the audio.

create table if not exists public.music_understandings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    provider_track_id text not null check (provider_track_id ~ '^[0-9]{1,20}$'),
    title text not null default '' check (char_length(title) <= 300),
    artist text not null default '' check (char_length(artist) <= 300),
    analysis jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (user_id, companion_id, provider_track_id)
);

create index if not exists music_understandings_tenant_track_idx
    on public.music_understandings (user_id, companion_id, provider_track_id);

alter table public.music_understandings enable row level security;
revoke all on table public.music_understandings from anon, authenticated;
grant all on table public.music_understandings to service_role;
