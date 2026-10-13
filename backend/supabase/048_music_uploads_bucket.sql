-- 本机音频上传桶：用户导入本机 MP3 到歌单。
-- 公开读（音频直链给 <audio> 播放），路径含 UUID 不可猜测。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('music-uploads', 'music-uploads', true, 20971520,
        array['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/flac','audio/ogg'])
on conflict (id) do update set public = true;

drop policy if exists "music_uploads_public_read" on storage.objects;
create policy "music_uploads_public_read"
    on storage.objects for select
    using (bucket_id = 'music-uploads');
