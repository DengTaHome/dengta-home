-- DRAFT only. Supabase CLI is unavailable locally; generate a named migration
-- before approval/application. This adds feature tables without editing persona
-- fields, memories, existing account media or any production data.
create table if not exists public.sticker_import_preferences (
    user_id uuid not null,
    companion_id uuid not null,
    bilibili_enabled boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (user_id, companion_id),
    foreign key (user_id, companion_id) references public.companions(user_id, id) on delete cascade
);
create table if not exists public.sticker_import_receipts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    client_request_id uuid not null,
    provider text not null check (provider = 'bilibili'),
    resource_id text not null check (resource_id ~ '^BV[0-9A-Za-z]{10}$'),
    request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
    planned_asset_id uuid not null,
    state text not null default 'pending' check (state in ('pending','complete')),
    source_creator text not null default '' check (length(source_creator) <= 120),
    source_title text not null default '' check (length(source_title) <= 300),
    page_url text not null default '' check (length(page_url) <= 200),
    cover_url text not null default '' check (length(cover_url) <= 4096),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, companion_id, client_request_id),
    unique (user_id, companion_id, planned_asset_id),
    foreign key (user_id, companion_id) references public.companions(user_id, id) on delete cascade
);
alter table public.sticker_import_preferences enable row level security;
alter table public.sticker_import_receipts enable row level security;
revoke all on public.sticker_import_preferences, public.sticker_import_receipts from public, anon, authenticated;
grant select, insert, update, delete on public.sticker_import_preferences, public.sticker_import_receipts to service_role;
notify pgrst, 'reload schema';
