-- 用户/伴侣显示 ID 系统。
-- 每个用户分配一个 8 位数字显示 ID（不可更改），
-- 每个伴侣分配一个显示 ID = 用户显示 ID + "-" + 8 位字母数字后缀。
-- 用于放映厅深链邀请和多人互动时的身份标识。

-- 1) 用户显示 ID 表
create table if not exists public.user_display_ids (
    user_id uuid primary key references auth.users(id) on delete cascade,
    display_id text not null unique check (display_id ~ '^\d{8}$'),
    created_at timestamptz not null default now()
);

-- 生成 8 位数字显示 ID（重试直到唯一，最多 10 次）
create or replace function public.generate_user_display_id(p_user_id uuid)
returns text
language plpgsql
security definer
as $$
declare
    new_id text;
    attempts int := 0;
begin
    -- 最多尝试 10 次生成唯一 8 位数字 ID
    loop
        new_id := lpad(floor(random() * 100000000)::text, 8, '0');
        -- ON CONFLICT 静默吞掉 display_id 冲突 → FOUND=false → 重试新 ID
        insert into public.user_display_ids (user_id, display_id)
        values (p_user_id, new_id)
        on conflict (display_id) do nothing;
        if found then
            return new_id;
        end if;
        attempts := attempts + 1;
        if attempts >= 10 then
            raise exception 'generate_user_display_id: 无法生成唯一显示 ID（用户 %）', p_user_id;
        end if;
    end loop;
end;
$$;

-- 2) 伴侣显示 ID：companions 表新增 display_id 列
alter table public.companions
    add column if not exists display_id text
    check (display_id is null or display_id ~ '^\d{8}-[A-Z0-9]{8}$');

create unique index if not exists companions_display_id_idx
    on public.companions (display_id)
    where display_id is not null;

-- 3) 生成伴侣显示 ID 的函数
-- 格式：用户显示ID + 8位大写字母数字（如 38294756-A7K3B2C9）
create or replace function public.generate_companion_display_id(user_display_id text)
returns text
language plpgsql
as $$
declare
    suffix text;
    result text;
    chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    i int;
begin
    suffix := '';
    for i in 1..8 loop
        suffix := suffix || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    end loop;
    result := user_display_id || '-' || suffix;
    return result;
end;
$$;

-- 4) 为已有用户生成显示 ID 的辅助函数（管理员调用）
-- 用法：select public.backfill_user_display_ids();
create or replace function public.backfill_user_display_ids()
returns table(user_id uuid, display_id text)
language plpgsql
security definer
as $$
declare
    u record;
    new_id text;
    attempts int := 0;
begin
    -- 扫描所有有伴侣的用户（避免扫描无伴侣的用户）
    for u in select distinct user_id from public.companions where user_id is not null loop
        -- 检查是否已有显示 ID
        continue when exists (select 1 from public.user_display_ids where user_id = u.user_id);
        -- 生成
        begin
            new_id := public.generate_user_display_id(u.user_id);
            user_id := u.user_id;
            display_id := new_id;
            return next;
        exception when others then
            raise warning 'backfill_user_display_ids: 无法为用户 % 生成 ID', u.user_id;
        end;
        attempts := 0;
    end loop;
end;
$$;

-- 5) 为已有伴侣生成显示 ID 的辅助函数
create or replace function public.backfill_companion_display_ids()
returns table(companion_id uuid, display_id text)
language plpgsql
as $$
declare
    c record;
    ud record;
begin
    for c in select * from public.companions where display_id is null loop
        select * into ud from public.user_display_ids where user_id = c.user_id;
        continue when ud is null;
        update public.companions
        set display_id = ud.display_id || '-' || (
            select string_agg(substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', floor(random() * 36 + 1)::int, 1), '')
            from generate_series(1, 8)
        )
        where id = c.id;
    end loop;
    return query select c2.id as companion_id, c2.display_id
        from public.companions c2
        where c2.display_id is not null;
end;
$$;

alter table public.user_display_ids enable row level security;
revoke all on table public.user_display_ids from anon, authenticated;
grant all on table public.user_display_ids to service_role;

comment on table public.user_display_ids is
    '8-digit display IDs for users, used in sharing invitations and multi-room identity.';

comment on column public.companions.display_id is
    'Display ID for companions: user_display_id-8charSuffix (e.g. 38294756-A7K3B2C9). Auto-generated, immutable.';

notify pgrst, 'reload schema';