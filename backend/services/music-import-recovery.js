const { createHash } = require("node:crypto");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADER = "id, name, provider, provider_playlist_id, external_url, source_format, item_count, created_at, updated_at";
const ITEMS = "id, position, url, provider_track_id, external_url, playback_mode, title, artist, album, cover_url, duration_seconds, lyrics, created_at";
const fields = ["url", "title", "artist", "album", "duration_seconds", "lyrics"];
function failure(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function stableId(value) {
    const bytes = createHash("sha256").update(JSON.stringify(value)).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 15) | 80;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function recoverPlaylistImport(database, parsed, requestId, identity) {
    if (!UUID.test(String(requestId)) || !UUID.test(String(identity.userId)) || !UUID.test(String(identity.companionId))) {
        throw failure(400, "music_import_request_invalid", "歌单导入请求编号或账号范围无效，请重新打开导入面板。");
    }
    const id = stableId(["dengta-music-import-v1", identity.userId.toLowerCase(), identity.companionId.toLowerCase(), requestId.toLowerCase(), parsed]);
    const header = { id, name: parsed.name, provider: "local", source_format: parsed.source_format, item_count: parsed.items.length };
    // An uncertain write is reconciled by reading the scoped receipt, never by deleting it.
    let inserted;
    try { inserted = await database.from("music_playlists").insert(header).select(HEADER).single(); } catch { inserted = null; }
    let saved = inserted?.data;
    if (!saved) {
        let existing;
        try { existing = await database.from("music_playlists").select(HEADER).eq("id", id).maybeSingle(); } catch { existing = null; }
        if (!existing || existing.error) throw failure(503, "music_import_receipt_read_failed", "无法确认歌单保存结果，请用原内容重试导入。");
        saved = existing.data;
        if (!saved) throw failure(503, "music_import_header_failed", "歌单尚未确认保存，请用原内容重试导入。");
    }
    if (Object.keys(header).some(key => saved[key] !== header[key])) {
        throw failure(409, "music_import_receipt_conflict", "已保存歌单与本次请求不同，请刷新检查后重新导入。");
    }
    const read = async () => {
        let result;
        try { result = await database.from("music_playlist_items").select(ITEMS).eq("playlist_id", id).order("position", { ascending: true }); } catch { result = null; }
        if (!result || result.error) throw failure(503, "music_import_receipt_read_failed", "无法确认曲目保存结果，请用原内容重试导入。");
        const items = result.data || [], positions = new Set();
        for (const item of items) {
            const expected = parsed.items[item.position];
            if (!expected || positions.has(item.position) || fields.some(key => item[key] !== expected[key])) {
                throw failure(409, "music_import_receipt_conflict", "已保存曲目与本次请求不同，请刷新检查后重新导入。");
            }
            positions.add(item.position);
        }
        return items;
    };
    let items = await read();
    const present = new Set(items.map(item => item.position));
    const missing = parsed.items.flatMap((item, position) => present.has(position) ? [] : [{ id: stableId([id, position]), playlist_id: id, position, ...item }]);
    if (missing.length) {
        try { await database.from("music_playlist_items").insert(missing); } catch { /* Read the receipt after an ambiguous or concurrent write. */ }
        items = await read();
    }
    if (items.length !== parsed.items.length) {
        throw failure(503, "music_import_items_incomplete", "歌单曲目尚未全部保存，请用原内容重试补齐，无需重复上传音频。");
    }
    return { ...saved, items };
}

module.exports = { recoverPlaylistImport };
