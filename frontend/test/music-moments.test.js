import assert from "node:assert/strict";
import { test } from "node:test";
import { createMusicMoment, createMusicMomentsStore, MAX_MUSIC_MOMENTS, musicMomentFeedback, parseMusicMomentTime } from "../src/music-moments.js";

const scope = { accountScope: "fictional-account", companionScope: "fictional-companion" };
const capture = { playlistId: "fictional-playlist", itemId: "fictional-track", title: "虚构歌曲", artist: "虚构作者", positionSeconds: 31.25, positionSource: "device", url: "https://example.test/private-placeholder", lyrics: "fictional-placeholder", cookie: "fictional-placeholder" };
const stamp = { id: "fictional-moment", createdAt: "2026-10-08T03:00:00Z" };
function memory() { const entries = new Map(); return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }; }
const failCode = code => error => error.code === code;

test("stores only the user-selected point and exact note, no audio URLs, lyrics or credentials", () => {
  const storage = memory(), store = createMusicMomentsStore(scope, storage), note = "  虚构感受\n保留原输入  ";
  const card = createMusicMoment(capture, note, stamp);
  assert.equal(card.note, note); assert.equal(card.positionSeconds, 31.25);
  assert.equal(Object.hasOwn(card, "url"), false);
  store.add(card); const saved = [...storage.entries.values()][0];
  for (const forbidden of ["https:", "cookie", "lyrics", "private-placeholder"]) assert.equal(saved.includes(forbidden), false);
  assert.deepEqual(store.read(), [card]);
});
test("same card retry is idempotent and two legitimate points of the same track are retained", () => {
  const store = createMusicMomentsStore(scope, memory()), card = createMusicMoment(capture, "", stamp);
  store.add(card); store.add(card); assert.equal(store.read().length, 1);
  store.add(createMusicMoment({ ...capture, positionSeconds: 44 }, "", { ...stamp, id: "second" }));
  assert.deepEqual(store.read().map(row => row.positionSeconds), [44, 31.25]);
});
test("account and companion namespaces stay separate with no legacy migration", () => {
  const storage = memory(); storage.entries.set("dengta_music_moments_v1", "fictional-legacy");
  createMusicMomentsStore(scope, storage).add(createMusicMoment(capture, "", stamp));
  assert.deepEqual(createMusicMomentsStore({ ...scope, accountScope: "fictional-other-account" }, storage).read(), []);
  assert.deepEqual(createMusicMomentsStore({ ...scope, companionScope: "fictional-other-companion" }, storage).read(), []);
  assert.equal(storage.entries.get("dengta_music_moments_v1"), "fictional-legacy");
  assert.throws(() => createMusicMomentsStore({ accountScope: "" }, storage), failCode("music_moment_scope_missing"));
});
test("reads live storage before a new save, preserving other local additions", () => {
  const storage = memory(), first = createMusicMomentsStore(scope, storage), second = createMusicMomentsStore(scope, storage);
  first.add(createMusicMoment(capture, "first", stamp));
  second.add(createMusicMoment(capture, "second", { ...stamp, id: "second" }));
  assert.deepEqual(first.read().map(row => row.note), ["second", "first"]);
});
test("invalid or foreign stored envelopes cannot be overwritten by save or deletion", () => {
  for (const corrupt of ["{fictional-corrupt", JSON.stringify({ version: 1, ...scope, companionScope: "other", moments: [] })]) {
    const storage = memory(), store = createMusicMomentsStore(scope, storage); store.add(createMusicMoment(capture, "", stamp));
    const key = [...storage.entries.keys()][0]; storage.entries.set(key, corrupt);
    assert.throws(() => store.read(), failCode("music_moment_storage_invalid"));
    assert.throws(() => store.add(createMusicMoment(capture, "", { ...stamp, id: "new" })), failCode("music_moment_storage_invalid"));
    assert.throws(() => store.remove(stamp.id), failCode("music_moment_storage_invalid"));
    assert.equal(storage.entries.get(key), corrupt);
  }
});
test("unavailable storage never returns a false saved or deleted result", () => {
  const storage = memory(), store = createMusicMomentsStore(scope, storage); store.add(createMusicMoment(capture, "", stamp));
  const before = [...storage.entries.values()][0]; storage.setItem = () => { throw Error("fictional-private-storage-detail"); };
  assert.throws(() => store.remove(stamp.id), failCode("music_moment_storage_unavailable"));
  assert.equal([...storage.entries.values()][0], before);
  assert.throws(() => createMusicMomentsStore(scope, { getItem() { throw Error("private"); }, setItem() {} }).read(), failCode("music_moment_storage_unavailable"));
  assert.equal(musicMomentFeedback({ code: "fictional-code", message: "private" }).includes("private"), false);
});
test("full capacity keeps every old card and rejects a new card without eviction", () => {
  const storage = memory(), store = createMusicMomentsStore(scope, storage);
  for (let n = 0; n < MAX_MUSIC_MOMENTS; n++) store.add(createMusicMoment(capture, "", { ...stamp, id: `card-${n}` }));
  const before = [...storage.entries.values()][0];
  assert.throws(() => store.add(createMusicMoment(capture, "", { ...stamp, id: "overflow" })), failCode("music_moment_limit"));
  assert.equal([...storage.entries.values()][0], before); assert.equal(store.read().length, MAX_MUSIC_MOMENTS);
});
test("deletion and explicit undo preserve exact original card and other records", () => {
  const store = createMusicMomentsStore(scope, memory()), original = createMusicMoment(capture, "原文", stamp);
  store.add(original); store.add(createMusicMoment(capture, "另一张", { ...stamp, id: "other" }));
  assert.equal(store.remove(original.id).length, 1);
  assert.deepEqual(store.add(original)[0], original); assert.equal(store.read().length, 2);
});
test("rejects missing durable identities, invalid time and oversized note without coercion", () => {
  for (const patch of [{ itemId: "local-0" }, { playlistId: "" }, { positionSeconds: "31" }, { positionSeconds: null }, { positionSeconds: NaN }, { positionSeconds: -1 }, { positionSeconds: 86401 }, { positionSource: "provider-observed" }]) {
    assert.throws(() => createMusicMoment({ ...capture, ...patch }, "", stamp), failCode("music_moment_invalid"));
  }
  assert.throws(() => createMusicMoment(capture, "字".repeat(241), stamp), failCode("music_moment_invalid"));
});
test("manual time accepts minutes:seconds or bounded numeric seconds", () => {
  assert.equal(parseMusicMomentTime("1:02"), 62); assert.equal(parseMusicMomentTime("31.25"), 31.25); assert.equal(parseMusicMomentTime("0:00"), 0);
  for (const invalid of ["", "1:60", "-1", "Infinity", "86401", "1441:00", "1e3", "private"]) assert.equal(parseMusicMomentTime(invalid), null);
});
