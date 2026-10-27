-- 064_stream_partials.sql
--
-- 流式回复的「边生成边落库」缓冲。
--
-- 产品要求（owner 决定，见 docs/designs/dengta-home-architecture.md §8.1）：
--   生成出来的每个字立刻显示、已显示的绝不撤回、已生成的立刻落库。
--
-- 现状是「生成结束 → 一次性写 messages」，中途断线就整条丢。这里加一张独立小表，
-- 在生成过程中持续写入已生成的内容，结束时由正式消息取代并删除这一行。
--
-- 为什么单独建表、而不是提前插 messages 再反复 update：
--   messages 行一旦存在就参与历史、分页、未读、记忆等所有既有逻辑，
--   提前插入一个空行会在十几个既有路径上产生「半成品消息」语义。
--   分离出来，失败路径只影响这张表，既有行为完全不变。
--
-- 幂等：重复执行无副作用。

begin;

create table if not exists public.stream_partials (
    user_id uuid not null references auth.users(id) on delete cascade,
    companion_id uuid not null references public.companions(id) on delete cascade,
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    client_message_id text not null,
    content text not null default '',
    revisions integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, companion_id, conversation_id, client_message_id)
);

create index if not exists stream_partials_conversation_idx
    on public.stream_partials (conversation_id, updated_at desc);

alter table public.stream_partials enable row level security;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'stream_partials'
          and policyname = 'stream_partials_select_own'
    ) then
        create policy stream_partials_select_own
            on public.stream_partials
            for select
            using (user_id = auth.uid());
    end if;
end $$;

commit;
