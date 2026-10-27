-- 063_rls_hardening.sql
--
-- 背景：以下 8 张表在迁移树里从来没有 enable row level security，也没有任何
-- grant / revoke 声明：
--   achievements, user_achievements, special_dates, xhs_connections,
--   daily_shots, interest_profiles, watch_events, compatibility_records
--
-- 它们能否被 anon / authenticated 读到，取决于 Supabase 项目级默认权限，而仓库
-- 既没有设置也没有撤销。也就是说这 8 张表目前没有任何本地声明可以兜底。
--
-- 处理方式与既有设计保持一致：后端用 service_role（bypassrls）访问，浏览器从不
-- 直连 Postgres（前端只用 auth-only 客户端），所以这里不需要读写策略——只需要
-- 「启用 RLS + 显式收权」，让这 8 张表从「未声明」变成「明确拒绝」。
--
-- 幂等：表不存在时跳过；重复执行无副作用。

begin;

do $$
declare
    target text;
begin
    foreach target in array array[
        'achievements',
        'user_achievements',
        'special_dates',
        'xhs_connections',
        'daily_shots',
        'interest_profiles',
        'watch_events',
        'compatibility_records'
    ]
    loop
        if to_regclass('public.' || target) is not null then
            execute format('alter table public.%I enable row level security', target);
            -- 显式撤销：即使项目级默认权限把 select 授给了 anon/authenticated，
            -- 这 8 张表也不跟。没有任何策略，所以 RLS 对它们等于全拒绝。
            execute format('revoke all on public.%I from anon, authenticated', target);
        end if;
    end loop;
end $$;

commit;
