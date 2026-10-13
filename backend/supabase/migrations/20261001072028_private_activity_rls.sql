begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- These records are served by authenticated DengTa routes, never by client SQL.
do $$
declare activity_table text;
begin
  foreach activity_table in array array[
    'special_dates','daily_shots','compatibility_records','achievements',
    'user_achievements','watch_events','interest_profiles','xhs_connections'
  ] loop
    execute format('alter table public.%I enable row level security', activity_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', activity_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', activity_table);
    execute format('drop policy if exists dengta_activity_backend_only on public.%I', activity_table);
    execute format('create policy dengta_activity_backend_only on public.%I for all to service_role using (true) with check (true)', activity_table);
  end loop;
end;
$$;
notify pgrst, 'reload schema';
commit;
