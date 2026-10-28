-- 068_channel_persona_sync.sql
-- Persona sections + per-channel sync preferences for WeChat/QQ bridges.
-- Idempotent. Apply in the Supabase SQL editor (service role) before enabling
-- the channel-sync endpoints. RLS keeps every row scoped to auth.uid().

create extension if not exists pgcrypto;

create table if not exists public.persona_sections (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    companion_id uuid not null references public.companions(id) on delete cascade,
    section_key text not null,
    title text not null default '',
    content text not null default '',
    category text not null default 'normal'
        check (category in ('normal', 'private', 'nsfw', 'style')),
    enabled boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, companion_id, section_key)
);

create table if not exists public.channel_sync_preferences (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    companion_id uuid not null references public.companions(id) on delete cascade,
    channel text not null check (channel in ('wechat', 'qq')),
    persona_mode text not null default 'selected'
        check (persona_mode in ('normal_only', 'selected', 'all')),
    persona_section_ids uuid[] not null default '{}',
    style_enabled boolean not null default true,
    style_text text not null default '',
    memory_mode text not null default 'recent'
        check (memory_mode in ('none', 'recent', 'selected', 'all')),
    memory_ids uuid[] not null default '{}',
    memory_keywords text[] not null default '{}',
    memory_limit integer not null default 10 check (memory_limit between 0 and 50),
    media_enabled boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, companion_id, channel)
);

create table if not exists public.channel_bindings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    companion_id uuid not null references public.companions(id) on delete cascade,
    channel text not null check (channel in ('wechat', 'qq')),
    external_id text not null,
    status text not null default 'active' check (status in ('pending', 'active', 'revoked')),
    bind_token_hash text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (channel, external_id)
);

create index if not exists persona_sections_owner_idx
    on public.persona_sections (user_id, companion_id, sort_order);
create index if not exists channel_sync_preferences_owner_idx
    on public.channel_sync_preferences (user_id, companion_id);
create index if not exists channel_bindings_owner_idx
    on public.channel_bindings (user_id, companion_id);

alter table public.persona_sections enable row level security;
alter table public.channel_sync_preferences enable row level security;
alter table public.channel_bindings enable row level security;

do $$
begin
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'persona_sections' and policyname = 'persona_sections_owner') then
        create policy persona_sections_owner on public.persona_sections
            for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'channel_sync_preferences' and policyname = 'channel_sync_preferences_owner') then
        create policy channel_sync_preferences_owner on public.channel_sync_preferences
            for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'channel_bindings' and policyname = 'channel_bindings_owner') then
        create policy channel_bindings_owner on public.channel_bindings
            for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
    end if;
end $$;

notify pgrst, 'reload schema';
