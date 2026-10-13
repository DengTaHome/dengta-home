-- Keep the existing bucket size and access policy; add raw AAC to its audio formats.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'audio/aac')
where id = 'music-uploads'
  and allowed_mime_types is not null
  and not ('audio/aac' = any(allowed_mime_types));
