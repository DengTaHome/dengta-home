const assert = require("node:assert/strict");
const { playlistSaveState, requireCompletePlaylist } = require("../services/music-playlist-integrity");
const { listPlaylists, readPlaylist } = require("../services/music-listening");
const { startCoWatchSession } = require("../services/co-watch-sessions");
const { applyMusicQueueOperation } = require("../services/music-queue");
const { createTenantDatabase } = require("../services/request-scope");
const userId = "11111111-1111-4111-8111-111111111111", companionId = "22222222-2222-4222-8222-222222222222", playlistId = "33333333-3333-4333-8333-333333333333", itemId = "44444444-4444-4444-8444-444444444444", sessionId = "55555555-5555-4555-8555-555555555555";
let header = { id: playlistId, item_count: 3, provider: "local" }, positions = [{ position: 0 }], queryLog = [], rpcCalls = 0;
const database = createTenantDatabase({ tenant: { userId, companionId }, adminSupabase: {
  from(table) {
    const log = { table, filters: [] }; queryLog.push(log);
    const result = () => {
      const parent = { ...header, music_playlist_items: positions };
      if (table === "music_playlists") return { data: log.single ? header : [{ ...header, music_playlist_items: log.select.includes("(count)") ? [{ count: positions.length }] : positions }], error: null };
      if (log.select === "id,playlist_id") return { data: [{ id: itemId, playlist_id: playlistId }], error: null };
      if (log.select.includes("music_playlists(")) return { data: log.single ? { id: itemId, playlist_id: playlistId, music_playlists: parent } : [{ id: itemId, music_playlists: parent }], error: null };
      return { data: positions, error: null };
    };
    const builder = { select(value) { log.select = value; return builder; }, eq(key, value) { log.filters.push([key, value]); return builder; }, in(key, value) { log.filters.push([key, value]); return builder; }, order() { return builder; }, maybeSingle() { log.single = true; return Promise.resolve(result()); }, then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); } };
    return builder;
  }, async rpc(_name, params) { rpcCalls++; assert.equal(params.p_user_id, userId); assert.equal(params.p_companion_id, companionId); return { data: { ok: true }, error: null }; }
} });
async function main() {
  assert.deepEqual(playlistSaveState(header, 1), { saved_item_count: 1, save_state: "incomplete" });
  const listed = await listPlaylists(database); assert.equal(listed[0].saved_item_count, 1); assert.equal(listed[0].save_state, "incomplete"); assert.equal("music_playlist_items" in listed[0], false);
  await assert.rejects(readPlaylist(database, playlistId), { code: "music_playlist_incomplete", status: 409 });
  let updates = 0, inserts = 0;
  const start = () => startCoWatchSession({ database, input: { session_id: sessionId, session_mode: "listening", playlist_id: playlistId, item_id: itemId }, findSession: async () => null, findConversation: async () => ({ id: "fictional-conversation" }), findActiveSession: async () => ({ id: "old-session" }), updateSession: async () => updates++, insertSession: async (_db, value) => { inserts++; return value; } });
  await assert.rejects(start(), { code: "music_playlist_incomplete" }); assert.equal(updates, 0); assert.equal(inserts, 0);
  const queue = operation => applyMusicQueueOperation({ database, sessionId, input: { request_id: itemId, expected_revision: 0, operation } });
  for (const operation of [{ type: "add", item_id: itemId }, { type: "replace", item_ids: [itemId] }]) await assert.rejects(queue(operation), { code: "music_playlist_incomplete" });
  assert.equal(rpcCalls, 0, "incomplete imports cannot mutate a queue");
  positions = [{ position: 0 }, { position: 1 }, { position: 3 }]; await assert.rejects(readPlaylist(database, playlistId), { code: "music_playlist_positions_invalid" });
  positions = [{ position: 0 }, { position: 1 }, { position: 2 }];
  assert.equal((await readPlaylist(database, playlistId)).save_state, "ready"); assert.equal((await start()).status, "created");
  await queue({ type: "add", item_id: itemId }); assert.equal(rpcCalls, 1);
  for (const log of queryLog) { assert.ok(log.filters.some(([k,v]) => k === "user_id" && v === userId)); assert.ok(log.filters.some(([k,v]) => k === "companion_id" && v === companionId)); }
  header = { ...header, item_count: 0, provider: "netease", external_url: "https://music.163.com/#/playlist?id=1" }; positions = [];
  assert.equal((await readPlaylist(database, playlistId)).save_state, "external_metadata");
  assert.throws(() => requireCompletePlaylist({ item_count: 1 }, [{ position: 1 }]), { code: "music_playlist_positions_invalid" });
  assert.throws(() => playlistSaveState(null, 0), { code: "music_playlist_receipt_invalid" });
  console.log("Playlist integrity: real scoped list/read/start/queue paths, incomplete saves, positions and external metadata passed; no user data fixtures");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
