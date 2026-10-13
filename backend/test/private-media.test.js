const assert = require("node:assert/strict");
const sharp = require("sharp");
const media = require("../services/private-media");
const stickers = require("../services/companion-stickers");
const { publicMessage } = require("../services/chat-attachments");

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const companionA = "33333333-3333-4333-8333-333333333333";
const companionB = "44444444-4444-4444-8444-444444444444";

function database(state, userId, failInsert = false) {
    return { from(table) {
        let action = "select", payload;
        const filters = [["user_id", userId]];
        const builder = {
            select() { return builder; },
            insert(value) { action = "insert"; payload = { ...value, user_id: userId }; return builder; },
            update(value) { action = "update"; payload = { ...value, user_id: userId }; return builder; },
            delete() { action = "delete"; return builder; },
            eq(key, value) { filters.push([key, value]); return builder; },
            is(key, value) { filters.push([key, value]); return builder; },
            order() { return builder.run(); },
            maybeSingle() { return builder.run(true); },
            single() { return builder.run(true); },
            then(resolve, reject) { return builder.run().then(resolve, reject); },
            async run(single = false) {
                const rows = state[table];
                const matches = (row) => filters.every(([key, value]) => row[key] === value);
                if (action === "insert") {
                    if (failInsert && table === "account_media_assets") return { data: null, error: new Error("db insert failed") };
                    const row = { created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z", archived_at: null, ...payload };
                    rows.push(row); return { data: single ? row : [row], error: null };
                }
                if (action === "update") {
                    const row = rows.find(matches);
                    if (!row) return { data: null, error: new Error("missing") };
                    Object.assign(row, payload); return { data: single ? row : [row], error: null };
                }
                if (action === "delete") {
                    const deleted = rows.filter(matches);
                    const retained = rows.filter((row) => !matches(row));
                    state[table].splice(0, rows.length, ...retained);
                    return { data: single ? deleted[0] : deleted, error: null };
                }
                const found = rows.filter(matches);
                return { data: single ? (found[0] || null) : found, error: null };
            }
        };
        return builder;
    }};
}

function storage() {
    const objects = new Map(), removed = [];
    return { objects, removed, from(bucket) {
        assert.equal(bucket, "private-media");
        return {
            async upload(path, buffer, options) {
                assert.match(path, /^[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}\.(webp|md|txt)$/);
                assert.ok(options.contentType === "image/webp" || options.contentType === "text/plain" || options.contentType === "text/markdown");
                objects.set(path, Buffer.from(buffer)); return { error: null };
            },
            async remove(paths) { removed.push(...paths); paths.forEach((path) => objects.delete(path)); return { error: null }; },
            async download(path) { return objects.has(path) ? { data: new Blob([objects.get(path)]), error: null } : { error: new Error("missing") }; }
        };
    }};
}

async function image(width = 40, height = 30) {
    return sharp({ create: { width, height, channels: 4, background: "#ff4081" } })
        .png().withMetadata({ comment: "adult erotic metadata is permitted" }).toBuffer();
}
async function rejects(promise, code) { await assert.rejects(promise, (error) => error.code === code); }

async function main() {
    const png = await image();
    assert.deepEqual(media.normalizeMoodTags(undefined), []);
    assert.equal(media.publicAsset(null), null);
    await rejects(media.normalizeImage(null, "custom_sticker"), "private_media_empty");
    await rejects(media.uploadAsset({ scope: {}, storage: storage(), file: {}, purpose: "invalid" }), "private_media_purpose_invalid");
    const normalized = await media.normalizeImage({ buffer: png, mimetype: "image/png" }, "custom_sticker");
    assert.equal((await sharp(normalized.buffer).metadata()).format, "webp");
    assert.equal(normalized.buffer.includes(Buffer.from("adult erotic")), false);
    await rejects(media.normalizeImage({ buffer: Buffer.from("fake"), mimetype: "image/png" }, "custom_sticker"), "private_media_decode_failed");
    await rejects(media.normalizeImage({ buffer: png, mimetype: "image/jpeg" }, "custom_sticker"), "private_media_type_mismatch");
    await rejects(media.normalizeImage({ buffer: Buffer.from("<svg/>") , mimetype: "image/svg+xml" }, "custom_sticker"), "private_media_type_unsupported");
    await rejects(media.normalizeImage({ buffer: Buffer.alloc(media.MAX_PRIVATE_MEDIA_BYTES + 1), mimetype: "image/png" }, "custom_sticker"), "private_media_too_large");
    await rejects(media.normalizeImage({ buffer: await image(4000, 4000), mimetype: "image/png" }, "custom_sticker"), "private_media_decode_failed");

    const state = { account_media_assets: [], private_media_preferences: [] };
    const bucket = storage();
    const scopeA = { userId: userA, companionId: companionA, db: database(state, userA) };
    const scopeB = { userId: userB, companionId: companionB, db: database(state, userB) };
    const sticker = await media.uploadAsset({ scope: scopeA, storage: bucket, file: { buffer: png, mimetype: "image/png", originalname: "original.png" }, purpose: "custom_sticker", metadata: { display_name: "私密名称", alt_text: "成人/情色图片", mood_tags: "HAPPY,hug,bad tag,happy" } });
    assert.deepEqual(sticker.mood_tags, ["happy", "hug"]);
    assert.doesNotMatch(JSON.stringify(sticker), /storage_|sha256|user_id|companion_id/);
    const avatar = await media.uploadAsset({ scope: scopeA, storage: bucket, file: { buffer: png, mimetype: "image/png" }, purpose: "user_avatar" });
    assert.equal(state.account_media_assets.find((row) => row.id === avatar.id).companion_id, null);
    assert.deepEqual(await media.setPreference(scopeA, "user_avatar", avatar.id), { purpose: "user_avatar", asset_id: avatar.id });
    assert.deepEqual(await media.setPreference(scopeA, "user_avatar", avatar.id), { purpose: "user_avatar", asset_id: avatar.id }, "已存在指针应走更新分支");
    assert.deepEqual(await media.setPreference(scopeA, "user_avatar", null), { purpose: "user_avatar", asset_id: null }, "null 必须清除偏好指针");
    assert.deepEqual((await media.catalog(scopeA)).preferences, {}, "清除后目录不得残留指针");
    assert.deepEqual(await media.setPreference(scopeA, "user_avatar", ""), { purpose: "user_avatar", asset_id: null }, "空字符串同样视为清除");
    assert.deepEqual(await media.setPreference(scopeA, "user_avatar", avatar.id), { purpose: "user_avatar", asset_id: avatar.id }, "清除后应可重新设置");
    await rejects(media.setPreference(scopeA, "custom_sticker", sticker.id), "private_media_preference_invalid");
    await rejects(media.setPreference(scopeA, "chat_background", avatar.id), "private_media_preference_mismatch");
    await rejects(media.setPreference(scopeA, "user_avatar", "not-a-uuid"), "private_media_id_invalid");
    assert.equal((await media.catalog(scopeA)).assets.length, 2);
    assert.deepEqual((await media.catalog(scopeA)).preferences, { user_avatar: avatar.id });
    assert.equal((await media.catalog(scopeB)).assets.length, 0);
    const wallpaper = await media.uploadAsset({scope:scopeA,storage:bucket,file:{buffer:png,mimetype:'image/png'},purpose:'chat_background'});
    await media.setPreference(scopeA,'chat_background',wallpaper.id);
    await assert.rejects(media.deleteAssetPermanently(scopeB,bucket,wallpaper.id),error=>error.status===404);
    await media.deleteAssetPermanently(scopeA,bucket,wallpaper.id);
    assert.equal((await media.catalog(scopeA)).assets.some(asset=>asset.id===wallpaper.id),false);
    assert.equal((await media.catalog(scopeA)).preferences.chat_background,undefined);
    await assert.rejects(() => media.downloadAsset(scopeB, bucket, sticker.id), (error) => error.status === 404);

    assert.deepEqual((await media.updateAsset(scopeA, sticker.id, { display_name: "新名称", mood_tags: ["shy"] })).mood_tags, ["shy"]);
    await rejects(media.updateAsset(scopeA, avatar.id, { mood_tags: ["invalid"] }), "private_media_tags_not_allowed");
    assert.equal((await media.archiveAsset(scopeA, sticker.id)).status, "archived");
    assert.equal((await media.listActiveCustomStickers(scopeA)).length, 0);
    assert.equal((await media.downloadAsset(scopeA, bucket, sticker.id)).buffer.length > 0, true, "归档内容仍可读取");

    const active = await media.uploadAsset({ scope: scopeA, storage: bucket, file: { buffer: png, mimetype: "image/png" }, purpose: "custom_sticker", metadata: { mood_tags: ["cheer"] } });
    const candidates = await media.listActiveCustomStickers(scopeA);
    const tool = stickers.createCompanionStickerTool(candidates);
    assert.deepEqual(tool.input_schema.properties.custom_sticker_id.enum, [active.id]);
    assert.match(tool.description, /cheer/);
    assert.doesNotMatch(tool.description, /新名称|私密名称|path|url/);
    assert.equal(stickers.parseCompanionStickerToolArguments({ custom_sticker_id: sticker.id }, candidates).ok, false);
    const selector = stickers.createCompanionStickerSelector(candidates);
    assert.equal((await selector.executeTool({ name: tool.name, arguments: JSON.stringify({ custom_sticker_id: active.id }) })).ok, true);
    assert.deepEqual(stickers.companionStickerToolCalls(selector), { custom_sticker_id: active.id });
    assert.deepEqual(publicMessage({ id: "m", role: "assistant", content: "ok", created_at: "now", tool_calls: { custom_sticker_id: active.id, path: "secret" } }).tool_calls, { custom_sticker_id: active.id });
    assert.deepEqual(stickers.companionStickerToolCalls("bear-hug"), { sticker_id: "bear-hug" });

    const failingDownloadStorage = { from() { return { async download() { return { error: new Error("offline") }; } }; } };
    await rejects(media.downloadAsset(scopeA, failingDownloadStorage, active.id), "private_media_download_failed");

    const failedStorage = storage();
    await assert.rejects(() => media.uploadAsset({ scope: { ...scopeA, db: database(state, userA, true) }, storage: failedStorage, file: { buffer: png, mimetype: "image/png" }, purpose: "custom_sticker" }), /db insert failed/);
    assert.equal(failedStorage.objects.size, 0);
    assert.equal(failedStorage.removed.length, 1);

    // 知识文件上传测试
    const knowledgeText = Buffer.from("# 我的知识\n\n这是用户上传的知识文件内容。", "utf8");
    const knowledge = await media.uploadAsset({ scope: scopeA, storage: bucket, file: { buffer: knowledgeText, mimetype: "text/markdown", originalname: "note.md" }, purpose: "knowledge_file", metadata: { display_name: "我的笔记" } });
    assert.equal(knowledge.purpose, "knowledge_file");
    assert.equal(knowledge.mime_type, "text/markdown");
    assert.equal(knowledge.width, 0);
    assert.equal(knowledge.height, 0);
    assert.equal(state.account_media_assets.find((row) => row.id === knowledge.id).purpose, "knowledge_file");

    // 知识文件文本读取
    const texts = await media.knowledgeFileTexts(scopeA, bucket);
    assert.ok(texts.length >= 1);
    const found = texts.find((t) => t.id === knowledge.id);
    assert.ok(found, "knowledge file should be in texts");
    assert.equal(found.content, "# 我的知识\n\n这是用户上传的知识文件内容。");

    console.log("private media security, tenant, catalog, sticker and knowledge file tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
