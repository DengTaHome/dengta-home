-- Co-watch web-page mode: bilibili / iqiyi / generic HTTPS pages
-- watched together inside the app panel.

alter table public.co_watch_sessions
    drop constraint if exists co_watch_sessions_session_mode_check;

alter table public.co_watch_sessions
    add constraint co_watch_sessions_session_mode_check
        check (session_mode in ('screen', 'direct_media', 'listening', 'web_page'));
