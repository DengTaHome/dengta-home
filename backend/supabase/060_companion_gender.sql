-- Additive only: existing prompts, memories and identities are not rewritten.
begin;
alter table public.settings
    add column if not exists ai_gender text not null default 'unspecified',
    add column if not exists ai_pronouns text not null default '',
    add column if not exists ai_gender_label text not null default '';

do $$ begin
    if not exists (select 1 from pg_constraint where conrelid = 'public.settings'::regclass and conname = 'settings_ai_gender_check') then
        alter table public.settings add constraint settings_ai_gender_check
            check (ai_gender in ('unspecified', 'male', 'female', 'transgender', 'mtf', 'ftm', 'non_binary', 'other'));
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.settings'::regclass and conname = 'settings_ai_pronouns_check') then
        alter table public.settings add constraint settings_ai_pronouns_check
            check (char_length(ai_pronouns) <= 20 and char_length(ai_gender_label) <= 60);
    end if;
end $$;
commit;
