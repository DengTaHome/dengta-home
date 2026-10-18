-- DRAFT only. Apply after bilibili_sticker_import.sql, with separate authorization.
begin;
alter table public.sticker_import_preferences add column if not exists xhs_enabled boolean not null default false;
alter table public.sticker_import_receipts drop constraint if exists sticker_import_receipts_provider_check;
alter table public.sticker_import_receipts drop constraint if exists sticker_import_receipts_resource_id_check;
do $$ begin
    if not exists (select 1 from pg_constraint where conrelid = 'public.sticker_import_receipts'::regclass and conname = 'sticker_import_receipts_provider_resource_check') then
        alter table public.sticker_import_receipts add constraint sticker_import_receipts_provider_resource_check check (
            (provider = 'bilibili' and resource_id ~ '^BV[0-9A-Za-z]{10}$') or
            (provider = 'xiaohongshu' and resource_id ~ '^[a-f0-9]{24}$')
        );
    end if;
end $$;
-- Existing composite ownership keys, uniqueness, RLS and service-only grants remain.
notify pgrst, 'reload schema';
commit;
