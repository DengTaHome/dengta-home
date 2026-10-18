const { createHash, randomUUID } = require("node:crypto");
const dns = require("node:dns/promises");
const { createPinnedMcpFetch } = require("./pinned-mcp-fetch");
const { isPrivateIp } = require("./mcp-device-center");
const { createWebExplorer } = require("./web-explorer");
const { MAX_PRIVATE_MEDIA_BYTES, uploadAsset, findScopedAsset, publicAsset, normalizeMoodTags } = require("./private-media");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BVID = /^BV[0-9A-Za-z]{10}$/;
const IMPORT_BILIBILI_STICKER_TOOL = Object.freeze({
    name: "import_bilibili_sticker",
    description: "用户已允许从B站搜集表情。可先用B站搜索查找，提供真实视频bvid，将其静态封面保存到当前账号与伴侣的私人表情库并配在本轮回复中。每轮最多一张；这是外部视频封面，不能声称原创、现画或动态图。不可提供图片网址。",
    input_schema: { type: "object", properties: {
        bvid: { type: "string", pattern: "^BV[0-9A-Za-z]{10}$" },
        display_name: { type: "string", maxLength: 120 },
        alt_text: { type: "string", maxLength: 500 },
        mood_tags: { type: "array", maxItems: 12, items: { type: "string", maxLength: 32 } }
    }, required: ["bvid"], additionalProperties: false }
});
const MESSAGES = Object.freeze({
    sticker_import_schema_required: "B站表情搜集需要服务器数据库更新；当前功能尚未启用。",
    sticker_import_storage_failed: "无法确认表情搜集记录，请稍后使用同一次请求重试。",
    sticker_import_disabled: "尚未允许AI从B站搜集表情，请在私人表情设置中开启。",
    sticker_import_request_invalid: "表情导入参数不正确，请检查视频编号与请求编号。",
    sticker_import_request_conflict: "这个请求编号已用于不同的表情导入，请刷新后重新操作。",
    sticker_import_source_invalid: "B站没有返回可安全读取的静态封面。",
    sticker_import_source_unavailable: "B站视频信息暂时无法读取，可能已下架、登录失效或受平台访问限制。请确认视频可打开后重试。",
    sticker_import_download_failed: "B站封面暂时无法读取，请使用同一次请求重试。",
    sticker_import_timeout: "B站封面读取超时，请使用同一次请求重试。",
    sticker_import_too_large: "B站封面超过12MB，未保存，请选择其他视频。",
    sticker_import_asset_removed: "这次导入的表情已被删除或归档，不会自动重新创建。",
    sticker_import_source_not_found: "未找到当前账号与伴侣的这张表情来源。"
});
function importError(code, status = 400) {
    return Object.assign(new Error(MESSAGES[code] || MESSAGES.sticker_import_storage_failed), { code, status });
}
function missingSchema(error) { return ["42P01", "42703", "PGRST204", "PGRST205"].includes(error?.code); }
function assertReceipt(result) {
    if (result.error) throw importError(missingSchema(result.error) ? "sticker_import_schema_required" : "sticker_import_storage_failed", 503);
    return result.data;
}
function text(value, limit) { return Array.from(String(value || "").trim()).slice(0, limit).join(""); }
function source(row) {
    return { provider: "bilibili", bvid: row.resource_id, page_url: `https://www.bilibili.com/video/${row.resource_id}`,
        creator: row.source_creator, title: row.source_title, imported_at: row.created_at };
}
function normalizeInput(input = {}) {
    const allowed = new Set(["bvid", "client_request_id", "display_name", "alt_text", "mood_tags"]);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.has(key)) ||
        !BVID.test(input.bvid || "") || !UUID.test(input.client_request_id || "")) throw importError("sticker_import_request_invalid");
    const metadata = { display_name: text(input.display_name, 120), alt_text: text(input.alt_text, 500), mood_tags: normalizeMoodTags(input.mood_tags) };
    return { bvid: input.bvid, requestId: input.client_request_id.toLowerCase(), metadata,
        hash: createHash("sha256").update(JSON.stringify([input.bvid, metadata])).digest("hex") };
}
function coverUrl(value) {
    let url;
    try { url = new URL(String(value || "")); } catch { throw importError("sticker_import_source_invalid", 502); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443" ||
        !/^(?:[a-z0-9-]+\.)*hdslb\.com$/i.test(url.hostname) || url.href.length > 4096) throw importError("sticker_import_source_invalid", 502);
    return url.href;
}
async function downloadCover(url, { fetchImpl, timeoutMs = 15000, validateUrl = coverUrl, referer = "https://www.bilibili.com/" } = {}) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort(); reject(importError("sticker_import_timeout", 504));
        }, timeoutMs);
    });
    const wait = promise => Promise.race([promise, deadline]);
    let response, reader;
    try {
        response = await wait(Promise.resolve().then(() => fetchImpl(validateUrl(url), { headers: { Accept: "image/jpeg,image/png,image/webp", Referer: referer }, redirect: "error", signal: controller.signal })));
        if (!response.ok || response.status >= 300 || response.status < 200) throw importError("sticker_import_download_failed", 502);
        const mime = String(response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
        if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw importError("sticker_import_source_invalid", 415);
        if (Number(response.headers.get("content-length")) > MAX_PRIVATE_MEDIA_BYTES) throw importError("sticker_import_too_large", 413);
        if (!response.body?.getReader) throw importError("sticker_import_download_failed", 502);
        reader = response.body.getReader(); const chunks = []; let length = 0;
        while (true) {
            const next = await wait(reader.read()); if (next.done) break;
            length += next.value.byteLength;
            if (length > MAX_PRIVATE_MEDIA_BYTES) throw importError("sticker_import_too_large", 413);
            chunks.push(Buffer.from(next.value));
        }
        if (!length) throw importError("sticker_import_source_invalid", 415);
        return { buffer: Buffer.concat(chunks, length), mimetype: mime };
    } catch (error) {
        if (error?.code && MESSAGES[error.code]) throw error;
        throw importError(controller.signal.aborted ? "sticker_import_timeout" : "sticker_import_download_failed", controller.signal.aborted ? 504 : 502);
    } finally {
        clearTimeout(timer); controller.abort();
        // Broken transports may ignore abort/cancel; cleanup must not hold the request open.
        void Promise.resolve().then(() => reader ? reader.cancel() : response?.body?.cancel?.()).catch(() => {});
    }
}
function createStickerImportService({ storage, getCookie = async () => "", getVideo = createWebExplorer().biliVideo,
    fetchImpl = createPinnedMcpFetch({ lookup: dns.lookup, isPrivateIp }), upload = uploadAsset, now = () => new Date().toISOString(), timeoutMs, adapter = null } = {}) {
    const config = adapter || { provider: "bilibili", permission: "bilibili_enabled", parse: normalizeInput, source, validateUrl: coverUrl, label: "B站视频封面",
        async getSource(scope, id) { const video = await getVideo(id, await getCookie(scope), { includeSubtitles: false }); return { cover: video?.cover, creator: video?.owner, title: video?.title, page_url: `https://www.bilibili.com/video/${id}` }; } };
    const parse = input => { const value = config.parse(input); return { ...value, resourceId: value.resourceId || value.bvid }; };
    const inflight = new Map();
    async function preferences(scope) {
        const result = await scope.db.from("sticker_import_preferences").select(config.permission).maybeSingle();
        if (result.error && missingSchema(result.error)) return { [config.permission]: false, schema_available: false };
        const row = assertReceipt(result);
        return { [config.permission]: row?.[config.permission] === true, schema_available: true };
    }
    async function savePreferences(scope, input = {}) {
        if (!input || typeof input !== "object" || Array.isArray(input) || typeof input[config.permission] !== "boolean" || Object.keys(input).some(key => key !== config.permission)) throw importError("sticker_import_request_invalid");
        const existing = assertReceipt(await scope.db.from("sticker_import_preferences").select(config.permission).maybeSingle());
        const values = { [config.permission]: input[config.permission], updated_at: now() };
        let result = existing ? await scope.db.from("sticker_import_preferences").update(values).select(config.permission).single()
            : await scope.db.from("sticker_import_preferences").insert(values).select(config.permission).single();
        if (result.error?.code === "23505") result = await scope.db.from("sticker_import_preferences").update(values).select(config.permission).single();
        const row = assertReceipt(result); if (!row) throw importError("sticker_import_storage_failed", 502);
        return { [config.permission]: row[config.permission] === true, schema_available: true };
    }
    async function existingAsset(scope, row) {
        try {
            const asset = await findScopedAsset(scope, row.planned_asset_id);
            if (asset.purpose !== "custom_sticker" || asset.status !== "active") throw importError("sticker_import_asset_removed", 410);
            return publicAsset(asset);
        } catch (error) {
            if (error?.code === "private_media_not_found" && row.state !== "complete") return null;
            if (error?.code === "private_media_not_found") throw importError("sticker_import_asset_removed", 410);
            if (MESSAGES[error?.code]) throw error;
            throw importError("sticker_import_storage_failed", 502);
        }
    }
    async function importOnce(scope, input, { autonomous = false } = {}) {
        const parsed = parse(input);
        const permission = await preferences(scope);
        if (!permission.schema_available) throw importError("sticker_import_schema_required", 503);
        if (autonomous && !permission[config.permission]) throw importError("sticker_import_disabled", 403);
        let row = assertReceipt(await scope.db.from("sticker_import_receipts").select("*").eq("client_request_id", parsed.requestId).maybeSingle());
        let replayed = Boolean(row);
        if (!row) {
            const inserted = await scope.db.from("sticker_import_receipts").insert({ client_request_id: parsed.requestId,
                provider: config.provider, resource_id: parsed.resourceId, request_hash: parsed.hash, planned_asset_id: randomUUID(), state: "pending" }).select("*").single();
            row = inserted.error?.code === "23505" ? assertReceipt(await scope.db.from("sticker_import_receipts").select("*").eq("client_request_id", parsed.requestId).single()) : assertReceipt(inserted);
            replayed = Boolean(inserted.error);
        }
        if (!row || row.provider !== config.provider || row.request_hash !== parsed.hash || row.resource_id !== parsed.resourceId) throw importError("sticker_import_request_conflict", 409);
        let asset = await existingAsset(scope, row);
        if (!asset) {
            if (!row.cover_url) {
                let info;
                try { info = await config.getSource(scope, parsed.resourceId); }
                catch (error) { if (config.preserveErrors?.has(error?.code)) throw error; throw importError("sticker_import_source_unavailable", 502); }
                const values = { cover_url: config.validateUrl(info?.cover), source_creator: text(info?.creator, 120), source_title: text(info?.title, 300),
                    page_url: info?.page_url, updated_at: now() };
                row = assertReceipt(await scope.db.from("sticker_import_receipts").update(values).eq("id", row.id).select("*").single());
                if (!row) throw importError("sticker_import_storage_failed", 502);
            }
            const file = await downloadCover(row.cover_url, { fetchImpl, timeoutMs, validateUrl: config.validateUrl, referer: config.referer });
            if (autonomous && !(await preferences(scope))[config.permission]) throw importError("sticker_import_disabled", 403);
            try { asset = await upload({ scope, storage, file, purpose: "custom_sticker", stableAssetId: row.planned_asset_id,
                metadata: { ...parsed.metadata, display_name: parsed.metadata.display_name || text(row.source_title, 120),
                    alt_text: parsed.metadata.alt_text || text(`${config.label}：${row.source_title}${row.source_creator ? `，创作者：${row.source_creator}` : ""}`, 500) } }); }
            catch (error) {
                if (["private_media_decode_failed", "private_media_type_mismatch", "private_media_not_static", "private_media_type_unsupported", "private_media_empty"].includes(error?.code)) {
                    throw importError("sticker_import_source_invalid", 415);
                }
                throw importError("sticker_import_storage_failed", 502);
            }
        }
        if (row.state !== "complete") {
            const receipt = assertReceipt(await scope.db.from("sticker_import_receipts").update({ state: "complete", updated_at: now() }).eq("id", row.id).select("id").single());
            if (!receipt?.id) throw importError("sticker_import_storage_failed", 502);
        }
        if (autonomous && !(await preferences(scope))[config.permission]) throw importError("sticker_import_disabled", 403);
        return { asset, source: config.source(row), replayed };
    }
    async function importBilibili(scope, input, options) {
        const parsed = parse(input); const key = `${scope.userId}:${scope.companionId}:${parsed.requestId}:${options?.autonomous === true}`;
        const previous = inflight.get(key);
        if (previous) { if (previous.hash !== parsed.hash) throw importError("sticker_import_request_conflict", 409); return previous.promise; }
        const promise = importOnce(scope, input, options); inflight.set(key, { hash: parsed.hash, promise });
        try { return await promise; } finally { if (inflight.get(key)?.promise === promise) inflight.delete(key); }
    }
    async function readSource(scope, assetId) {
        if (!UUID.test(assetId || "")) throw importError("sticker_import_source_not_found", 404);
        const asset = await findScopedAsset(scope, assetId);
        if (asset.purpose !== "custom_sticker") throw importError("sticker_import_source_not_found", 404);
        const row = assertReceipt(await scope.db.from("sticker_import_receipts").select("*").eq("planned_asset_id", assetId).eq("state", "complete").maybeSingle());
        if (!row || row.provider !== config.provider) throw importError("sticker_import_source_not_found", 404);
        return config.source(row);
    }
    return { preferences, savePreferences, importBilibili, importResource: importBilibili, readSource };
}
function createBilibiliStickerImportService(options) {
    const core = createStickerImportService(options);
    async function importBilibili(scope, input, settings) {
        try { return await core.importBilibili(scope, input, settings); }
        catch (error) {
            if (["sticker_import_source_invalid", "sticker_import_source_unavailable"].includes(error?.code)) {
                try {
                    const parsed = normalizeInput(input);
                    // An empty source receipt has not reached upload. Concurrent lookups must
                    // confirm their original receipt ID before proceeding past source lookup.
                    await scope.db.from("sticker_import_receipts").delete()
                        .eq("client_request_id", parsed.requestId).eq("provider", "bilibili")
                        .eq("resource_id", parsed.bvid).eq("request_hash", parsed.hash)
                        .eq("state", "pending").eq("cover_url", "");
                } catch { /* Retain the original error and fail closed if cleanup cannot finish. */ }
            }
            throw error;
        }
    }
    return { ...core, importBilibili, importResource: importBilibili };
}
function toolRequestId(scope, turnId, bvid) {
    if (!UUID.test(turnId || "") || !BVID.test(bvid || "")) throw importError("sticker_import_request_invalid");
    const hash = createHash("sha256").update(JSON.stringify([scope.userId, scope.companionId, turnId, "bilibili-sticker"])).digest("hex");
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
module.exports = { IMPORT_BILIBILI_STICKER_TOOL, createBilibiliStickerImportService, createStickerImportService, downloadCover, coverUrl, importError, toolRequestId };
