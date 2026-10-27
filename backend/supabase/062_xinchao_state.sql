-- 心潮 (xinchao) 状态表：每个 (user, companion) 一行，记录情感驱动项的当前水位。
-- Additive only: 不修改任何既有表、不改写既有数据。
--
-- 与线上契约一致：GET /api/v2/xinchao/state 返回 { configured, state }，
-- state 里的 drives 是 [{ key, label, value }]，value 取值 0..1，
-- 前端自行按 value 降序取前 5 项渲染花瓣。
--
-- 注意：consciousness 允许为空。前端在等于 'awake' 时显示「此刻醒着」，
-- 否则直接显示字段原值，为空才回退到「心潮流动」——所以除 'awake' 外只能存 null。

begin;

create table if not exists public.companion_xinchao_state (
    user_id uuid not null references auth.users(id) on delete cascade,
    companion_id uuid not null references public.companions(id) on delete cascade,
    drives jsonb not null default '{}'::jsonb,
    emotion_label text not null default '平静',
    consciousness text,
    revision bigint not null default 1,
    last_conversation_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, companion_id)
);

do $$ begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.companion_xinchao_state'::regclass
          and conname = 'companion_xinchao_state_consciousness_check'
    ) then
        alter table public.companion_xinchao_state
            add constraint companion_xinchao_state_consciousness_check
            check (consciousness is null or consciousness = 'awake');
    end if;
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.companion_xinchao_state'::regclass
          and conname = 'companion_xinchao_state_drives_object_check'
    ) then
        alter table public.companion_xinchao_state
            add constraint companion_xinchao_state_drives_object_check
            check (jsonb_typeof(drives) = 'object');
    end if;
end $$;

create index if not exists companion_xinchao_state_recent_idx
    on public.companion_xinchao_state (user_id, updated_at desc);

alter table public.companion_xinchao_state enable row level security;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'companion_xinchao_state'
          and policyname = 'companion_xinchao_state_select_own'
    ) then
        -- 与既有 18 张表保持一致：只给 SELECT 策略，写入仍走后端 service_role。
        create policy companion_xinchao_state_select_own
            on public.companion_xinchao_state
            for select
            using (user_id = auth.uid());
    end if;
end $$;

commit;
