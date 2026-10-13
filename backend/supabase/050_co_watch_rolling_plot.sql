-- AI视频理解：滚动剧情分析系统。
-- 为 co_watch_sessions 添加剧情总结字段，使 AI 能累积理解视频内容。
-- 每次截帧分析时更新，提供给模型作为上下文。

alter table public.co_watch_sessions
    add column if not exists plot_summary text not null default ''
    check (char_length(plot_summary) <= 10000);

alter table public.co_watch_sessions
    add column if not exists plot_epoch integer not null default 0
    check (plot_epoch >= 0);

alter table public.co_watch_sessions
    add column if not exists last_plot_update_at timestamptz;

comment on column public.co_watch_sessions.plot_summary is
    'Rolling plot summary of the video content, updated after each frame analysis. Resets on seek/media change.';
comment on column public.co_watch_sessions.plot_epoch is
    'Incremented on seek/media change to invalidate old plot summaries.';
comment on column public.co_watch_sessions.last_plot_update_at is
    'Last time the plot summary was updated.';

notify pgrst, 'reload schema';