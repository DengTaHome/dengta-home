const assert = require("node:assert/strict");
const express = require("express");
const { createRequestScope } = require("../services/request-scope");
const { importPlaylist } = require("../services/music-listening");
const { createMusicRouter } = require("../routes/v2/music");

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
const rows = { music_playlists: [], music_playlist_items: [] };
let uncertainHeader = false, partialItems = false, readsFail = false, writes = 0;
const admin = { from(table) {
    let operation = "read", values, conditions = [], single = false;
    const query = {
        select() { return query; }, eq(key, value) { conditions.push([key, value]); return query; }, order() { return query; },
        single() { single = true; return query; }, maybeSingle() { single = true; return query; },
        insert(value) { operation = "insert"; values = Array.isArray(value) ? value : [value]; return query; },
        delete() { throw Error("recovery must never delete a saved playlist"); },
        then(resolve, reject) { return Promise.resolve().then(() => {
            if (operation === "read") {
                if (readsFail) return { error: { code: "fixture_private_error" } };
                const result = rows[table].filter(row => conditions.every(([key, value]) => row[key] === value)).map(row => ({ ...row }));
                return { data: single ? result[0] || null : result };
            }
            writes++;
            if (values.some(value => rows[table].some(row => row.id === value.id || (table === "music_playlist_items" && row.playlist_id === value.playlist_id && row.position === value.position)))) return { error: { code: "23505" } };
            if (table === "music_playlists") {
                rows[table].push(...values.map(value => ({ ...value })));
                if (uncertainHeader) { uncertainHeader = false; return { error: { code: "fixture_lost_response" } }; }
            } else {
                rows[table].push(...(partialItems ? values.slice(0, 1) : values).map(value => ({ ...value })));
                if (partialItems) { partialItems = false; return { error: { code: "fixture_partial" } }; }
            }
            return { data: single ? { ...values[0] } : values };
        }).then(resolve, reject); }
    };
    return query;
} };
function scope(userId = ids[0], companionId = ids[1]) {
    const companion = { id: companionId, user_id: userId, status: "active" };
    return createRequestScope({ adminSupabase: admin, user: { id: userId }, profile: { id: userId, role: "owner", status: "active" }, companions: [companion], companion });
}
const input = { request_id: ids[2], format: "text", name: "Fictional import", content: "https://media.example.test/one.mp3\nhttps://media.example.test/two.mp3" };
async function main() {
    const a = scope(), b = scope(ids[3], ids[1]), c = scope(ids[0], ids[3]);
    uncertainHeader = true; partialItems = true;
    await assert.rejects(importPlaylist(a.db, input, a), error => error.code === "music_import_items_incomplete" && !error.message.includes("fixture_partial"));
    assert.equal(rows.music_playlists.length, 1); assert.equal(rows.music_playlist_items.length, 1);
    const recovered = await importPlaylist(a.db, input, a);
    assert.equal(recovered.items.length, 2); assert.ok(recovered.items.every(item => item.id));
    const repeated = await Promise.all([importPlaylist(a.db, input, a), importPlaylist(a.db, input, a)]);
    assert.ok(repeated.every(item => item.id === recovered.id)); assert.equal(rows.music_playlist_items.length, 2);
    const fresh = await importPlaylist(a.db, { ...input, request_id: ids[3] }, a);
    assert.notEqual(fresh.id, recovered.id, "a separate intentional import is retained");
    const otherUser = await importPlaylist(b.db, input, b), otherCompanion = await importPlaylist(c.db, input, c);
    assert.notEqual(otherUser.id, recovered.id); assert.notEqual(otherCompanion.id, recovered.id);
    assert.ok(otherUser.items.every(item => rows.music_playlist_items.find(row => row.id === item.id).user_id === ids[3]));
    const before = writes;
    await assert.rejects(importPlaylist(a.db, { ...input, request_id: "invalid" }, a), error => error.code === "music_import_request_invalid");
    assert.equal(writes, before);
    rows.music_playlist_items.find(item => item.playlist_id === recovered.id).title = "User edited title";
    await assert.rejects(importPlaylist(a.db, input, a), error => error.code === "music_import_receipt_conflict");
    assert.equal(rows.music_playlist_items.find(item => item.playlist_id === recovered.id).title, "User edited title");
    readsFail = true;
    await assert.rejects(importPlaylist(a.db, input, a), error => error.code === "music_import_receipt_read_failed"); readsFail = false;

    const objects = new Map(), uploads = [], originalUrl = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = "https://fixture3example.supabase.co";
    let mode = "normal";
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { if (req.headers.authorization === "Bearer fixture") req.scope = req.headers["x-other-user"] ? b : a; next(); });
    app.use("/music", createMusicRouter({ storage: { from(bucket) { assert.equal(bucket, "music-uploads"); return { async upload(key, bytes, options) {
        uploads.push({ key, bytes, options });
        if (mode === "denied") return { error: { statusCode: "400", message: "private diagnostic", code: "AccessDenied" } };
        if (mode === "format") return { error: { statusCode: "415", message: "private diagnostic", code: "InvalidMimeType" } };
        if (mode === "limit") return { error: { statusCode: "413", message: "private diagnostic", code: "EntityTooLarge" } };
        if (mode === "rate") return { error: { statusCode: "429", message: "private diagnostic" } };
        if (mode === "throw") throw Error("private connection diagnostic");
        if (objects.has(key)) return { error: { statusCode: "409", code: "KeyAlreadyExists" } };
        objects.set(key, Buffer.from(bytes)); return {};
    } }; } } }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, message: error.message }));
    const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}/music/upload-audio`;
    async function upload(name, bytes = "fictional codec fixture", headers = {}) {
        const form = new FormData(); form.append("file", new Blob([bytes], { type: "application/octet-stream" }), name);
        const response = await fetch(endpoint, { method: "POST", headers: { authorization: "Bearer fixture", ...headers }, body: form });
        return { status: response.status, body: await response.json() };
    }
    try {
        const first = await upload("fixture.aac"), again = await upload("renamed.aac");
        assert.equal(first.status, 201); assert.equal(again.status, 201); assert.equal(first.body.audio.url, again.body.audio.url); assert.equal(first.body.audio.mime_type, "audio/aac");
        assert.equal(objects.size, 1); assert.ok(uploads.every(entry => entry.options.upsert === false));
        const different = await upload("fixture.aac", "other bytes"), another = await upload("fixture.aac", undefined, { "x-other-user": "yes" });
        assert.notEqual(first.body.audio.url, different.body.audio.url); assert.notEqual(first.body.audio.url, another.body.audio.url);
        assert.equal((await upload("fixture.opus")).body.audio.mime_type, "audio/ogg");
        assert.equal((await upload("fixture.exe")).body.code, "music_audio_type_invalid");
        assert.equal((await upload("fixture.mp3", new Uint8Array(20 * 1024 * 1024 + 1))).body.code, "music_audio_too_large");
        mode = "denied"; const denied = await upload("fixture.mp3"); assert.equal(denied.status, 403); assert.equal(denied.body.code, "music_audio_storage_permission"); assert.ok(!denied.body.message.includes("private diagnostic"));
        for (const [setting, code] of [["format", "music_audio_mime_rejected"], ["limit", "music_audio_too_large"], ["rate", "music_audio_storage_rate_limited"], ["throw", "music_audio_storage_failed"]]) {
            mode = setting; const failure = await upload("fixture.mp3"); assert.equal(failure.body.code, code); assert.ok(!failure.body.message.includes("private"));
        }
        const count = uploads.length; delete process.env.SUPABASE_URL;
        assert.equal((await upload("fixture.mp3")).body.code, "music_supabase_url_missing"); assert.equal(uploads.length, count);
        const unauthorized = await upload("fixture.mp3", undefined, { authorization: "invalid" }); assert.equal(unauthorized.status, 401);
    } finally { if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl; await new Promise(resolve => server.close(resolve)); }
    console.log("Music recovery: ambiguous writes, incomplete items, concurrent retries, scoped accounts/companions, preserved edits; HTTP upload deduplication, formats, size, auth and safe errors passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
