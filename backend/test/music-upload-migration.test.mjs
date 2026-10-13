import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
try {
  await db.exec("create schema storage; create table storage.buckets(id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]);");
  await db.exec("insert into storage.buckets values ('music-uploads',true,20971520,array['audio/mpeg','audio/ogg']),('private-attachments',false,1073741824,array['application/pdf']);");
  const sql = await fs.readFile(new URL("../supabase/061_music_upload_aac.sql", import.meta.url), "utf8");
  const before = (await db.query("select * from storage.buckets order by id")).rows;
  await db.exec(sql); await db.exec(sql);
  const after = (await db.query("select * from storage.buckets order by id")).rows;
  assert.deepEqual(after[0], { ...before[0], allowed_mime_types: [...before[0].allowed_mime_types, "audio/aac"] });
  assert.deepEqual(after[1], before[1]);
  await db.exec("update storage.buckets set allowed_mime_types=null where id='music-uploads';");
  await db.exec(sql); assert.equal((await db.query("select allowed_mime_types from storage.buckets where id='music-uploads'")).rows[0].allowed_mime_types, null);
  console.log("AAC storage migration: repeated execution, existing format order, capacity, public policy, other buckets and unrestricted MIME configuration preserved");
} finally { await db.close(); }
