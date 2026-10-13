-- 音乐条目封面：网易云单曲/歌单导入后显示专辑封面。

alter table public.music_playlist_items
    add column if not exists cover_url text;

alter table public.music_playlist_items
    drop constraint if exists music_playlist_items_cover_url_check;

alter table public.music_playlist_items
    add constraint music_playlist_items_cover_url_check
        check (cover_url is null or char_length(cover_url) between 1 and 4096);
