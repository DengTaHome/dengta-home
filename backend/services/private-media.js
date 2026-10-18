const { createHash, randomUUID } = require("node:crypto");
const sharp = require("sharp");

const PRIVATE_MEDIA_BUCKET = "private-media";
const MAX_PRIVATE_MEDIA_BYTES = 12 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURPOSES = new Set(["user_avatar", "companion_avatar", "chat_background", "custom_sticker", "knowledge_file"]);
const PREFERENCE_PURPOSES = new Set(["user_avatar", "companion_avatar", "chat_background"]);
const INPUT_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const STICKER_ANIMATION_LIMITS = Object.freeze({ frames: 240, pixels: 40_000_000, seconds: 15 });
const KNOWLEDGE_MIME_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown", "application/markdown", "text/octet-stream", "application/octet-stream"]);
const MAX_KNOWLEDGE_FILE_BYTES = 512 * 1024;
const LIMITS = Object.freeze({
    user_avatar: { pixels: 16_000_000, width: 1024, height: 1024, fit: "cover" },
    companion_avatar: { pixels: 16_000_000, width: 1024, height: 1024, fit: "cover" },
    custom_sticker: { pixels: 12_000_000, width: 768, height: 768, fit: "inside" },
    chat_background: { pixels: 40_000_000, width: 2560, height: 2560, fit: "inside" },
    knowledge_file: { pixels: 0, width: 0, height: 0, fit: "inside" }
});
const PUBLIC_FIELDS = "id, purpose, status, display_name, alt_text, mood_tags, mime_type, byte_size, width, height, created_at, updated_at, archived_at";
const INTERNAL_FIELDS = `${PUBLIC_FIELDS}, user_id, companion_id, storage_bucket, storage_path, sha256`;

function mediaError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function cleanText(value, maximum) {
    return Array.from(String(value || "").trim()).slice(0, maximum).join("");
}

function normalizeMoodTags(value) {
    const source = Array.isArray(value) ? value : String(value || "").split(",");
    const tags = source.map((item) => cleanText(item, 32).toLowerCase())
        .filter((item) => /^[\p{L}\p{N}_-]{1,32}$/u.test(item));
    return [...new Set(tags)].slice(0, 12);
}

function publicAsset(row) {
    if (!row) return null;
    return {
        id: row.id,
        purpose: row.purpose,
        status: row.status,
        display_name: row.display_name || "",
        alt_text: row.alt_text || "",
        mood_tags: Array.isArray(row.mood_tags) ? row.mood_tags : [],
        mime_type: row.mime_type,
        byte_size: Number(row.byte_size),
        width: Number(row.width),
        height: Number(row.height),
        created_at: row.created_at,
        updated_at: row.updated_at,
        archived_at: row.archived_at || null,
        content_url: `/api/v2/private-media/assets/${row.id}/content`
    };
}

function assertPurpose(value) {
    const purpose = String(value || "");
    if (!PURPOSES.has(purpose)) throw mediaError(400, "private_media_purpose_invalid", "媒体用途不正确。");
    return purpose;
}

async function normalizeImage(file, purpose) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        throw mediaError(400, "private_media_empty", "图片不能为空。");
    }
    if (file.buffer.length > MAX_PRIVATE_MEDIA_BYTES) {
        throw mediaError(413, "private_media_too_large", "图片不能超过 12MB。");
    }
    const reportedMime = String(file.mimetype || "").split(";", 1)[0].toLowerCase();
    if (!INPUT_MIME_TYPES.has(reportedMime)) {
        throw mediaError(415, "private_media_type_unsupported", "支持 JPEG、PNG、WebP；GIF 仅用于表情包。");
    }
    const limit = LIMITS[purpose];
    try {
        // Inspect a single frame before allocating the complete animation's pixel stack.
        const metadata = await sharp(file.buffer, { limitInputPixels: limit.pixels, failOn: "warning" }).metadata();
        const pages = Number(metadata.pages || 1);
        const animated = pages > 1;
        if (!['jpeg', 'png', 'webp', 'gif'].includes(metadata.format)) {
            throw mediaError(415, "private_media_type_unsupported", "图片真实格式不受支持。");
        }
        if (purpose !== "custom_sticker" && (animated || metadata.format === "gif")) {
            throw mediaError(415, "private_media_not_static", "仅支持 JPEG、PNG 或 WebP 静态图片。");
        }
        const expectedMime = `image/${metadata.format === "jpeg" ? "jpeg" : metadata.format}`;
        if (reportedMime !== expectedMime) {
            throw mediaError(415, "private_media_type_mismatch", "声明类型与真实图片格式不一致。");
        }
        if (animated && (pages > STICKER_ANIMATION_LIMITS.frames ||
            metadata.width * metadata.height * pages > STICKER_ANIMATION_LIMITS.pixels)) {
            throw mediaError(413, "private_media_animation_too_complex", "动图帧数或累计像素过大；请缩小尺寸或精简到 240 帧以内再上传。");
        }
        const input = sharp(file.buffer, {
            animated,
            limitInputPixels: animated ? STICKER_ANIMATION_LIMITS.pixels : limit.pixels,
            failOn: "warning"
        });
        const buffer = await (animated ? input : input.rotate()).resize({
            width: limit.width,
            height: limit.height,
            fit: limit.fit,
            withoutEnlargement: true
        }).webp({ quality: 86, effort: animated ? 3 : 4 })
            .timeout({ seconds: STICKER_ANIMATION_LIMITS.seconds }).toBuffer();
        if (buffer.length > MAX_PRIVATE_MEDIA_BYTES) {
            throw mediaError(413, "private_media_too_large", "转换后的表情超过 12MB，请缩小尺寸或减少帧数。");
        }
        const output = await sharp(buffer).metadata();
        return { buffer, mimeType: "image/webp", width: output.width, height: output.height };
    } catch (error) {
        if (error?.status) throw error;
        if (/timeout|timed out/i.test(error?.message || "")) {
            throw mediaError(422, "private_media_processing_timeout", "图片处理超时，请缩小动图后再上传。");
        }
        throw mediaError(415, "private_media_decode_failed", "图片无法安全解码或像素尺寸过大。");
    }
}

async function normalizeKnowledgeFile(file) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        throw mediaError(400, "private_media_empty", "知识文件不能为空。");
    }
    if (file.buffer.length > MAX_KNOWLEDGE_FILE_BYTES) {
        throw mediaError(413, "private_media_too_large", "知识文件不能超过 512KB。");
    }
    const reportedMime = String(file.mimetype || "").split(";", 1)[0].toLowerCase();
    const text = file.buffer.toString("utf8");
    if (text.trim().length === 0) {
        throw mediaError(415, "private_media_empty_text", "知识文件没有可读文本内容。");
    }
    // 统一按 UTF-8 文本存储；扩展名保留以便模型识别格式。
    const finalMime = reportedMime === "text/markdown" ||
        reportedMime === "text/x-markdown" ||
        reportedMime === "application/markdown"
        ? "text/markdown"
        : "text/plain";
    return { buffer: file.buffer, mimeType: finalMime, width: 0, height: 0 };
}

function assetCompanionId(scope, purpose) {
    return purpose === "user_avatar" ? null : scope.companionId;
}

async function uploadAsset({ scope, storage, file, purpose: rawPurpose, metadata = {}, stableAssetId }) {
    const purpose = assertPurpose(rawPurpose);
    if (stableAssetId !== undefined && !UUID_PATTERN.test(stableAssetId)) {
        throw mediaError(400, "private_media_id_invalid", "媒体编号不正确。");
    }
    const isKnowledge = purpose === "knowledge_file";
    const normalized = isKnowledge
        ? await normalizeKnowledgeFile(file)
        : await normalizeImage(file, purpose);
    const id = stableAssetId || randomUUID();
    const extension = isKnowledge
        ? (normalized.mimeType === "text/markdown" ? "md" : "txt")
        : "webp";
    const storagePath = `${scope.userId}/${purpose}/${randomUUID()}.${extension}`;
    const bucket = storage.from(PRIVATE_MEDIA_BUCKET);
    const upload = await bucket.upload(storagePath, normalized.buffer, {
        contentType: normalized.mimeType,
        cacheControl: "31536000",
        upsert: false
    });
    if (upload.error) throw mediaError(502, "private_media_storage_failed", "文件暂时无法保存。");
    try {
        const row = {
            id,
            companion_id: assetCompanionId(scope, purpose),
            purpose,
            status: "active",
            display_name: cleanText(metadata.display_name, 120),
            alt_text: cleanText(metadata.alt_text, 500),
            mood_tags: purpose === "custom_sticker" ? normalizeMoodTags(metadata.mood_tags) : [],
            storage_bucket: PRIVATE_MEDIA_BUCKET,
            storage_path: storagePath,
            mime_type: normalized.mimeType,
            byte_size: normalized.buffer.length,
            sha256: createHash("sha256").update(normalized.buffer).digest("hex"),
            width: normalized.width,
            height: normalized.height
        };
        const result = await scope.db.from("account_media_assets").insert(row).select(INTERNAL_FIELDS).single();
        if (result.error) throw result.error;
        return publicAsset(result.data);
    } catch (error) {
        await bucket.remove([storagePath]).catch(() => undefined);
        // Concurrent imports share a receipt ID; retain the winner and remove only our object.
        if (stableAssetId && error?.code === "23505") {
            const existing = await findScopedAsset(scope, id, { includeArchived: false });
            if (existing.purpose === purpose) return publicAsset(existing);
        }
        throw error;
    }
}

async function scopedAssets(scope, { status } = {}) {
    let query = scope.db.from("account_media_assets").select(INTERNAL_FIELDS);
    if (status) query = query.eq("status", status);
    const result = await query.order("created_at", { ascending: false });
    if (result.error) throw result.error;
    return (result.data || []).filter((row) =>
        row.purpose === "user_avatar" ? row.companion_id == null : row.companion_id === scope.companionId
    );
}

async function readPreferences(scope) {
    const result = await scope.db.from("private_media_preferences").select("id, companion_id, purpose, asset_id");
    if (result.error) throw result.error;
    const output = {};
    for (const row of result.data || []) {
        if (row.purpose === "user_avatar" ? row.companion_id == null : row.companion_id === scope.companionId) {
            output[row.purpose] = row.asset_id;
        }
    }
    return output;
}

async function catalog(scope) {
    const [assets, preferences] = await Promise.all([scopedAssets(scope), readPreferences(scope)]);
    return { assets: assets.map(publicAsset), preferences };
}

async function findScopedAsset(scope, id, { includeArchived = true } = {}) {
    if (!UUID_PATTERN.test(String(id || ""))) throw mediaError(400, "private_media_id_invalid", "媒体编号不正确。");
    const result = await scope.db.from("account_media_assets").select(INTERNAL_FIELDS).eq("id", id).maybeSingle();
    if (result.error) throw result.error;
    const row = result.data;
    const belongs = row && (row.purpose === "user_avatar" ? row.companion_id == null : row.companion_id === scope.companionId);
    if (!belongs || (!includeArchived && row.status !== "active")) {
        throw mediaError(404, "private_media_not_found", "媒体不存在。");
    }
    return row;
}

async function setPreference(scope, purpose, assetId) {
    if (!PREFERENCE_PURPOSES.has(purpose)) throw mediaError(400, "private_media_preference_invalid", "偏好用途不正确。");
    const companionId = assetCompanionId(scope, purpose);
    if (assetId === null || assetId === "") {
        // Clearing the preference removes the pointer entirely.
        let clearQuery = scope.db.from("private_media_preferences").delete().eq("purpose", purpose);
        clearQuery = companionId ? clearQuery.eq("companion_id", companionId) : clearQuery.is("companion_id", null);
        const cleared = await clearQuery;
        if (cleared.error) throw cleared.error;
        return { purpose, asset_id: null };
    }
    const asset = await findScopedAsset(scope, assetId, { includeArchived: false });
    if (asset.purpose !== purpose) throw mediaError(400, "private_media_preference_mismatch", "媒体用途与偏好不匹配。");
    let existingQuery = scope.db.from("private_media_preferences").select("id").eq("purpose", purpose);
    existingQuery = companionId ? existingQuery.eq("companion_id", companionId) : existingQuery.is("companion_id", null);
    const existing = await existingQuery.maybeSingle();
    if (existing.error) throw existing.error;
    const values = { companion_id: companionId, purpose, asset_id: asset.id, updated_at: new Date().toISOString() };
    const result = existing.data
        ? await scope.db.from("private_media_preferences").update(values).eq("id", existing.data.id).select("asset_id").single()
        : await scope.db.from("private_media_preferences").insert(values).select("asset_id").single();
    if (result.error) throw result.error;
    return { purpose, asset_id: result.data.asset_id };
}

async function updateAsset(scope, id, values = {}) {
    const asset = await findScopedAsset(scope, id);
    const update = { updated_at: new Date().toISOString() };
    if (Object.hasOwn(values, "display_name")) update.display_name = cleanText(values.display_name, 120);
    if (Object.hasOwn(values, "alt_text")) update.alt_text = cleanText(values.alt_text, 500);
    if (Object.hasOwn(values, "mood_tags")) {
        if (asset.purpose !== "custom_sticker") throw mediaError(400, "private_media_tags_not_allowed", "只有自定义表情支持情绪标签。");
        update.mood_tags = normalizeMoodTags(values.mood_tags);
    }
    const result = await scope.db.from("account_media_assets").update(update).eq("id", id).select(INTERNAL_FIELDS).single();
    if (result.error) throw result.error;
    return publicAsset(result.data);
}

async function archiveAsset(scope, id) {
    await findScopedAsset(scope, id);
    const now = new Date().toISOString();
    const result = await scope.db.from("account_media_assets").update({ status: "archived", archived_at: now, updated_at: now })
        .eq("id", id).select(INTERNAL_FIELDS).single();
    if (result.error) throw result.error;
    const preferences = await scope.db.from("private_media_preferences").delete().eq("asset_id", id);
    if (preferences.error) throw preferences.error;
    return publicAsset(result.data);
}

async function downloadAsset(scope, storage, id, { poster = false } = {}) {
    const asset = await findScopedAsset(scope, id, { includeArchived: true });
    const result = await storage.from(asset.storage_bucket).download(asset.storage_path);
    if (result.error) throw mediaError(502, "private_media_download_failed", "媒体暂时无法读取。");
    const buffer = Buffer.isBuffer(result.data) ? result.data : Buffer.from(await result.data.arrayBuffer());
    if (poster && asset.purpose === "custom_sticker") {
        try {
            const still = await sharp(buffer, { pages: 1, limitInputPixels: LIMITS.custom_sticker.pixels, failOn: "warning" })
                .webp({ quality: 86, effort: 2 }).timeout({ seconds: 5 }).toBuffer();
            return { buffer: still, mimeType: "image/webp" };
        } catch {
            throw mediaError(415, "private_media_poster_failed", "动图静态预览暂时无法读取，请重新打开重试。");
        }
    }
    return { buffer, mimeType: asset.mime_type };
}

async function listActiveCustomStickers(scope, limit = 48) {
    const rows = await scopedAssets(scope, { status: "active" });
    return rows.filter((row) => row.purpose === "custom_sticker").slice(0, Math.min(48, limit)).map((row) => ({
        id: row.id,
        display_name: cleanText(row.display_name, 120),
        alt_text: cleanText(row.alt_text, 500),
        mood_tags: normalizeMoodTags(row.mood_tags)
    }));
}

// 知识文件：拉取用户当前启用的全部知识文件文本（用于 agents.md 注入）。
// 返回 [{ id, name, content }]，按创建时间正序；读取失败的文件被跳过并记录。
async function knowledgeFileTexts(scope, storage, { limit = 8 } = {}) {
    const rows = await scopedAssets(scope, { status: "active" });
    const knowledgeRows = rows
        .filter((row) => row.purpose === "knowledge_file")
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .slice(0, Math.min(8, limit));
    const outputs = [];
    for (const row of knowledgeRows) {
        try {
            const result = await storage.from(row.storage_bucket).download(row.storage_path);
            if (result.error) continue;
            const buffer = Buffer.isBuffer(result.data) ? result.data : Buffer.from(await result.data.arrayBuffer());
            const content = buffer.toString("utf8").trim();
            if (!content) continue;
            outputs.push({
                id: row.id,
                name: row.display_name || `${row.id.slice(0, 8)}.md`,
                content: content.slice(0, 6000)
            });
        } catch {
            // 单个文件读取失败不阻断整体注入
        }
    }
    return outputs;
}

async function deleteAssetPermanently(scope, storage, id) {
    const asset = await findScopedAsset(scope, id, { includeArchived: true });
    // 清除关联偏好
    const preferences = await scope.db.from("private_media_preferences").delete().eq("asset_id", id);
    if (preferences.error) throw mediaError(502, "private_media_preference_clear_failed", "未能清除媒体使用设置，文件尚未删除，请重试。");
    // 删除存储对象
    const { error: removeError } = await storage.from(asset.storage_bucket).remove([asset.storage_path]);
    if (removeError) throw mediaError(502, "private_media_remove_failed", "媒体文件暂时无法删除。");
    // 删除数据库记录
    const result = await scope.db.from("account_media_assets").delete().eq("id", id).select(INTERNAL_FIELDS).single();
    if (result.error) throw result.error;
    return publicAsset(result.data);
}

module.exports = {
    MAX_PRIVATE_MEDIA_BYTES,
    STICKER_ANIMATION_LIMITS,
    PRIVATE_MEDIA_BUCKET,
    archiveAsset,
    catalog,
    deleteAssetPermanently,
    downloadAsset,
    findScopedAsset,
    knowledgeFileTexts,
    listActiveCustomStickers,
    normalizeImage,
    normalizeKnowledgeFile,
    normalizeMoodTags,
    publicAsset,
    setPreference,
    updateAsset,
    uploadAsset
};
