-- Tenant-private avatars, chat backgrounds and reusable custom stickers.
-- Additive and repeatable; intentionally separate from conversation media_assets.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'private-media',
    'private-media',
    false,
    12582912,
    array['image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.account_media_assets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.user_profiles(id) on delete cascade,
    companion_id uuid,
    purpose text not null check (purpose in (
        'user_avatar', 'companion_avatar', 'chat_background', 'custom_sticker'
    )),
    status text not null default 'active'
        check (status in ('active', 'archived')),
    display_name text not null default '' check (char_length(display_name) <= 120),
    alt_text text not null default '' check (char_length(alt_text) <= 500),
    mood_tags text[] not null default '{}'::text[],
    storage_bucket text not null default 'private-media'
        check (storage_bucket = 'private-media'),
    storage_path text not null,
    mime_type text not null default 'image/webp'
        check (mime_type = 'image/webp'),
    byte_size bigint not null check (byte_size > 0 and byte_size <= 12582912),
    sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
    width integer not null check (width > 0),
    height integer not null check (height > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    archived_at timestamptz,
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (user_id, id),
    unique (storage_bucket, storage_path),
    check (
        (purpose = 'user_avatar' and companion_id is null)
        or (purpose <> 'user_avatar' and companion_id is not null)
    ),
    check (cardinality(mood_tags) <= 12)
);

create index if not exists account_media_assets_tenant_catalog_idx
    on public.account_media_assets (user_id, companion_id, purpose, status, created_at desc);
create index if not exists account_media_assets_user_avatar_idx
    on public.account_media_assets (user_id, purpose, status, created_at desc)
    where companion_id is null;

create table if not exists public.private_media_preferences (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.user_profiles(id) on delete cascade,
    companion_id uuid,
    purpose text not null check (purpose in (
        'user_avatar', 'companion_avatar', 'chat_background'
    )),
    asset_id uuid not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, asset_id)
        references public.account_media_assets(user_id, id) on delete cascade,
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    check (
        (purpose = 'user_avatar' and companion_id is null)
        or (purpose <> 'user_avatar' and companion_id is not null)
    )
);

create unique index if not exists private_media_preferences_user_purpose_uidx
    on public.private_media_preferences (user_id, purpose)
    where companion_id is null;
create unique index if not exists private_media_preferences_companion_purpose_uidx
    on public.private_media_preferences (user_id, companion_id, purpose)
    where companion_id is not null;
create index if not exists private_media_preferences_tenant_idx
    on public.private_media_preferences (user_id, companion_id, purpose);

create or replace function public.validate_private_media_preference()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if not exists (
        select 1
        from public.account_media_assets as asset
        where asset.user_id = new.user_id
          and asset.id = new.asset_id
          and asset.purpose = new.purpose
          and asset.status = 'active'
          and asset.companion_id is not distinct from new.companion_id
    ) then
        raise exception 'private_media_preference_asset_mismatch'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_private_media_preference_trigger
    on public.private_media_preferences;
create trigger validate_private_media_preference_trigger
before insert or update on public.private_media_preferences
for each row execute function public.validate_private_media_preference();

alter table public.account_media_assets enable row level security;
alter table public.private_media_preferences enable row level security;

revoke all on table public.account_media_assets from anon, authenticated;
revoke all on table public.private_media_preferences from anon, authenticated;
grant all on table public.account_media_assets to service_role;
grant all on table public.private_media_preferences to service_role;
revoke all on function public.validate_private_media_preference()
    from public, anon, authenticated;
grant execute on function public.validate_private_media_preference()
    to service_role;

comment on table public.account_media_assets is
    'Private, server-normalized account and companion images. Storage coordinates and hashes are internal only.';
comment on table public.private_media_preferences is
    'Reliable current pointers for account avatar and companion avatar/background.';
