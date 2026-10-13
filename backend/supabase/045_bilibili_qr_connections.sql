-- Built-in Bilibili QR-code login for co-watch.
-- Encrypted login cookie per tenant; used to read the user's own profile
-- and favorite folders. Passwords never pass through DengTa.

create table if not exists public.bilibili_qr_connections (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    bilibili_uid text not null default '' check (char_length(bilibili_uid) <= 40),
    nickname text not null default '' check (char_length(nickname) <= 80),
    face_url text not null default '' check (char_length(face_url) <= 4096),
    cookie_ciphertext text not null check (char_length(cookie_ciphertext) between 1 and 8192),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (user_id, companion_id)
);

create index if not exists bilibili_qr_connections_tenant_idx
    on public.bilibili_qr_connections (user_id, companion_id);

alter table public.bilibili_qr_connections enable row level security;
revoke all on table public.bilibili_qr_connections from anon, authenticated;
grant all on table public.bilibili_qr_connections to service_role;
