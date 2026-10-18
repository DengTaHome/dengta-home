const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const express = require("express");
const sharp = require("sharp");
const { PGlite } = require("@electric-sql/pglite");
const { normalizeImage, STICKER_ANIMATION_LIMITS } = require("../services/private-media");
const { createRequestScope } = require("../services/request-scope");
const { createPrivateMediaRouter } = require("../routes/v2/private-media");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333", D = "44444444-4444-4444-8444-444444444444";

async function animation({ frames = 3, width = 24, height = 16, format = "gif" } = {}) {
    const pixels = Buffer.alloc(width * height * frames * 4);
    for (let frame = 0; frame < frames; frame++) {
        for (let index = 0; index < width * height; index++) {
            const at = (frame * width * height + index) * 4;
            pixels[at + frame % 3] = 255;
            pixels[at + 3] = index % 4 === 0 ? 0 : 255;
        }
    }
    return sharp(pixels, { raw: { width, height: height * frames, channels: 4, pageHeight: height } })
        .toFormat(format, { delay: Array.from({ length: frames }, (_, index) => 80 + index * 10), loop: 2, keepDuplicateFrames: true })
        .toBuffer();
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

test("GIF and animated WebP keep all distinct frames, timing, loops and transparency", async () => {
    for (const format of ["gif", "webp"]) {
        const buffer = await animation({ format });
        const original = await sharp(buffer).metadata();
        const result = await normalizeImage({ buffer, mimetype: `image/${format}` }, "custom_sticker");
        const metadata = await sharp(result.buffer).metadata();
        assert.equal(metadata.format, "webp"); assert.equal(metadata.pages, 3);
        assert.deepEqual(metadata.delay, original.delay); assert.equal(metadata.loop, 2);
        assert.equal(result.width, 24); assert.equal(result.height, 16);
        assert.equal(metadata.hasAlpha, true); assert.equal(metadata.exif, undefined);
        const frames = await sharp(result.buffer, { animated: true }).ensureAlpha().raw().toBuffer();
        const frameBytes = 24 * 16 * 4;
        assert.notDeepEqual(frames.subarray(0, frameBytes), frames.subarray(frameBytes, frameBytes * 2));
        assert.equal(frames[3], 0, "transparent pixels survive normalization");
    }
});

test("resize keeps per-frame aspect ratio and never enlarges small stickers", async () => {
    const buffer = await animation({ width: 900, height: 300 });
    const result = await normalizeImage({ buffer, mimetype: "image/gif" }, "custom_sticker");
    assert.equal(result.width, 768); assert.equal(result.height, 256);
    const output = await sharp(result.buffer, { animated: true }).metadata();
    assert.equal(output.pageHeight, 256); assert.equal(output.height, 768);
    assert.equal(output.pages, 3);
});

test("animated formats stay scoped to stickers; disguises and broken data have precise errors", async () => {
    const buffer = await animation();
    for (const purpose of ["user_avatar", "companion_avatar", "chat_background"]) {
        await rejects(normalizeImage({ buffer, mimetype: "image/gif" }, purpose), "private_media_not_static");
    }
    await rejects(normalizeImage({ buffer, mimetype: "image/png" }, "custom_sticker"), "private_media_type_mismatch");
    await rejects(normalizeImage({ buffer: buffer.subarray(0, 30), mimetype: "image/gif" }, "custom_sticker"), "private_media_decode_failed");
    await rejects(normalizeImage({ buffer: Buffer.from("<svg/>"), mimetype: "image/svg+xml" }, "custom_sticker"), "private_media_type_unsupported");
});

test("frame-count and total decoded pixel budgets reject complex animations before storage", async () => {
    const tooMany = await animation({ frames: STICKER_ANIMATION_LIMITS.frames + 1, width: 2, height: 2 });
    await rejects(normalizeImage({ buffer: tooMany, mimetype: "image/gif" }, "custom_sticker"), "private_media_animation_too_complex");
    const cumulative = await animation({ frames: 5, width: 3000, height: 2800 });
    await rejects(normalizeImage({ buffer: cumulative, mimetype: "image/gif" }, "custom_sticker"), "private_media_animation_too_complex");
});

function database(db) {
    const identifier = value => { assert.match(value, /^[a-z_][a-z_0-9]*$/); return `"${value}"`; };
    return { from(table) {
        let action = "select", payload, columns = "*", single = false; const filters = [];
        const q = {
            select(value = "*") { columns = value; return q; }, insert(value) { action = "insert"; payload = value; return q; },
            eq(key, value) { filters.push([key, value]); return q; }, order() { return q; },
            single() { single = true; return q; }, maybeSingle() { single = true; return q; },
            then(resolve, reject) { return (async () => {
                try {
                    const values = [], bind = value => { values.push(value); return `$${values.length}`; };
                    const projection = columns === "*" ? "*" : columns.split(",").map(value => identifier(value.trim())).join(",");
                    const sql = action === "insert"
                        ? `insert into ${identifier(table)} (${Object.keys(payload).map(identifier)}) values (${Object.values(payload).map(bind)}) returning ${projection}`
                        : `select ${projection} from ${identifier(table)}${filters.length ? " where " + filters.map(([key,value]) => `${identifier(key)}=${bind(value)}`).join(" and ") : ""}`;
                    const rows = (await db.query(sql, values)).rows;
                    return { data: single ? rows[0] || null : rows };
                } catch (error) { return { error }; }
            })().then(resolve, reject); }
        }; return q;
    } };
}

test("real multipart → existing SQL schema → private storage → animated/poster reads with tenant isolation", async () => {
    const db = new PGlite(), objects = new Map(); let server;
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
          create schema storage; create table storage.buckets(id text primary key,name text,public bool,file_size_limit bigint,allowed_mime_types text[]);
          create table user_profiles(id uuid primary key); insert into user_profiles values ('${A}'),('${B}');
          create table companions(user_id uuid,id uuid,primary key(user_id,id)); insert into companions values ('${A}','${C}'),('${A}','${D}'),('${B}','${D}');
          create table settings(user_id uuid,unified_system_prompt text,user_details text);
          insert into settings values ('${A}','fictional persona ~ exact','fictional details');`);
        const sql = fs.readFileSync(require.resolve("../supabase/035_private_media.sql"), "utf8");
        await db.exec(sql); await db.exec(sql);
        const admin = database(db);
        const storage = { from() { return {
            async upload(path, buffer, options) { assert.equal(options.contentType, "image/webp"); objects.set(path, Buffer.from(buffer)); return {}; },
            async download(path) { return { data: new Blob([objects.get(path)]) }; },
            async remove(paths) { paths.forEach(path => objects.delete(path)); return {}; }
        }; } };
        const app = express();
        app.use((req, res, next) => {
            const userId = req.headers["x-fixture-user"] || A, companionId = req.headers["x-fixture-companion"] || C;
            const companion = { id: companionId, user_id: userId, status: "active" };
            req.scope = createRequestScope({ adminSupabase: admin, user: { id: userId }, profile: { id: userId, role: "owner", status: "active" }, companion, companions: [companion] }); next();
        });
        app.use("/media", createPrivateMediaRouter({ storage }));
        app.use((error, req, res, next) => res.status(error.status || 500).json({ code: error.code }));
        server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
        const root = `http://127.0.0.1:${server.address().port}/media`;
        const form = new FormData(); form.append("file", new Blob([await animation()], { type: "image/gif" }), "fictional.gif"); form.append("purpose", "custom_sticker");
        const upload = await fetch(`${root}/assets`, { method: "POST", body: form });
        assert.equal(upload.status, 201); const { asset } = await upload.json();
        assert.equal(asset.mime_type, "image/webp"); assert.equal(asset.height, 16); assert.equal(objects.size, 1);
        const content = `${root}/assets/${asset.id}/content`;
        const full = await fetch(content), poster = await fetch(`${content}?poster=1`);
        assert.match(poster.headers.get("cache-control"), /private, no-store/);
        assert.equal(poster.headers.get("content-type"), "image/webp");
        assert.equal((await sharp(Buffer.from(await full.arrayBuffer())).metadata()).pages, 3);
        const still = await sharp(Buffer.from(await poster.arrayBuffer())).metadata();
        assert.equal(still.pages || 1, 1); assert.equal(still.height, 16);
        for (const headers of [{ "x-fixture-companion": D }, { "x-fixture-user": B, "x-fixture-companion": D }]) {
            assert.equal((await fetch(content, { headers })).status, 404);
            assert.equal((await fetch(`${content}?poster=1`, { headers })).status, 404);
        }
        assert.equal(objects.size, 1, "poster reads never write additional storage objects");
        assert.deepEqual((await db.query("select unified_system_prompt,user_details from settings")).rows, [{ unified_system_prompt: "fictional persona ~ exact", user_details: "fictional details" }]);
        const catalog = await (await fetch(`${root}/catalog`)).json(); assert.equal(catalog.assets[0].id, asset.id);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        await db.close();
    }
});
