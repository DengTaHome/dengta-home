const { createHash } = require("node:crypto");
const { createStickerImportService } = require("./bilibili-sticker-import");
const { createXhsClient } = require("./xhs-client");
const { safeImage } = require("./xhs-web-operations");
const { normalizeMoodTags } = require("./private-media");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i, NOTE = /^[a-f0-9]{24}$/i;
const MESSAGES = {
    sticker_import_schema_required: "小红书表情搜集尚待数据库更新，原有表情仍可使用。",
    sticker_import_disabled: "尚未允许AI从小红书搜集表情，请在私人表情设置中开启。",
    sticker_import_request_invalid: "请从当前账号的小红书搜索结果选择笔记后重试。",
    sticker_import_source_invalid: "该笔记没有可安全读取的静态封面，请选择其他笔记。",
    sticker_import_source_unavailable: "当前账号暂时无法读取这篇小红书笔记，请重新搜索或检查登录。",
    sticker_import_download_failed: "小红书封面下载失败，请使用同一次导入重试。",
    sticker_import_timeout: "小红书封面读取超时，请使用同一次导入重试。",
    sticker_import_too_large: "小红书封面超过12MB，请选择其他笔记。",
    sticker_import_storage_failed: "未确认表情保存结果，请使用同一次导入重试。",
    sticker_import_request_conflict: "此导入编号已用于其他图片，请核对表情架后重新操作。",
    sticker_import_asset_removed: "这次导入的表情已删除或归档，不会自动重新创建。",
    sticker_import_source_not_found: "当前空间未找到这张表情的外部来源。"
};
const PRESERVE = new Set(["xhs_scope_required", "xhs_service_unconfigured", "xhs_session_isolation_required", "xhs_service_access_denied", "xhs_action_not_supported", "xhs_profile_busy", "xhs_browser_unavailable", "xhs_profile_storage_failed", "xhs_credentials_unavailable", "xhs_storage_read_failed", "xhs_timeout", "xhs_unreachable", "xhs_response_invalid", "xhs_page_changed", "cookie_expired", "verification_required", "xhs_note_lookup_required"]);
const SOURCE_FAILURES = new Set([...PRESERVE, "sticker_import_source_invalid", "sticker_import_source_unavailable"]);
function xhsImportError(code, status = 400) { return Object.assign(new Error(MESSAGES[code] || MESSAGES.sticker_import_storage_failed), { code: Object.hasOwn(MESSAGES, code) ? code : "sticker_import_storage_failed", status }); }
const text = (value, max) => Array.from(String(value || "").trim()).slice(0, max).join("");
function parse(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["note_id", "client_request_id", "display_name", "alt_text", "mood_tags"].includes(key)) || !NOTE.test(input.note_id || "") || !UUID.test(input.client_request_id || "")) throw xhsImportError("sticker_import_request_invalid");
    const resourceId = input.note_id.toLowerCase(), metadata = { display_name: text(input.display_name, 120), alt_text: text(input.alt_text, 500), mood_tags: normalizeMoodTags(input.mood_tags) };
    return { resourceId, requestId: input.client_request_id.toLowerCase(), metadata, hash: createHash("sha256").update(JSON.stringify(["xiaohongshu", resourceId, metadata])).digest("hex") };
}
function coverUrl(value) { let url; try { url = new URL(value); } catch { throw xhsImportError("sticker_import_source_invalid", 502); } if (url.hash || !safeImage(value)) throw xhsImportError("sticker_import_source_invalid", 502); return url.href; }
function source(row) { return { provider: "xiaohongshu", note_id: row.resource_id, page_url: `https://www.xiaohongshu.com/explore/${row.resource_id}`, creator: row.source_creator, title: row.source_title, imported_at: row.created_at }; }
function createXhsStickerImportService({ xhsClient = createXhsClient(), ...options } = {}) {
    const core = createStickerImportService({ ...options, adapter: { provider: "xiaohongshu", permission: "xhs_enabled", parse, source, validateUrl: coverUrl, referer: "https://www.xiaohongshu.com/", label: "小红书笔记封面", preserveErrors: new Set([...PRESERVE, "sticker_import_source_invalid"]),
        async getSource(scope, id) {
            if (typeof xhsClient?.forScope !== "function") throw Object.assign(new Error("小红书服务需要独立会话支持。"), { status: 503, code: "xhs_session_isolation_required" });
            const value = await xhsClient.forScope(scope).stickerSource(id);
            if (value?.note_id !== id) throw xhsImportError("sticker_import_source_invalid", 502);
            return { cover: coverUrl(value.cover), creator: value.creator, title: value.title, page_url: `https://www.xiaohongshu.com/explore/${id}` };
        } } });
    const safe = action => async (...args) => { try { return await action(...args); } catch (error) { if (error?.code === "cookie_expired") throw Object.assign(new Error("小红书登录已过期，请重新连接小红书；灯塔账号仍保持登录。"), { code: "cookie_expired", status: 409 }); if (PRESERVE.has(error?.code)) throw error; throw xhsImportError(error?.code, error?.status || 502); } };
    async function importXhs(scope, input, options) {
        try { return await core.importResource(scope, input, options); }
        catch (error) {
            if (SOURCE_FAILURES.has(error?.code)) {
                try {
                    const parsed = parse(input);
                    // Empty source receipts cannot have started an upload. A concurrent source lookup
                    // keeps its old receipt ID and must receive an update receipt before uploading.
                    await scope.db.from("sticker_import_receipts").delete()
                        .eq("client_request_id", parsed.requestId).eq("provider", "xiaohongshu")
                        .eq("resource_id", parsed.resourceId).eq("request_hash", parsed.hash)
                        .eq("state", "pending").eq("cover_url", "");
                } catch { /* Failed cleanup retains the original receipt and fails closed. */ }
            }
            throw error;
        }
    }
    return { preferences: safe(core.preferences), savePreferences: safe(core.savePreferences), importXhs: safe(importXhs), readSource: safe(core.readSource) };
}
const IMPORT_XHS_STICKER_TOOL = Object.freeze({ name: "import_xhs_sticker", description: "用户已允许从自己的小红书登录会话搜集表情。先用小红书搜索找到真实笔记，再提供note_id，将其静态封面保存为当前账号与伴侣的私人表情并附在本轮回复中。与其他表情合计每轮最多一张。保留来源，不称为原创或现画，不传图片网址。", input_schema: { type: "object", properties: {
    note_id: { type: "string", pattern: "^[a-fA-F0-9]{24}$" }, display_name: { type: "string", maxLength: 120 }, alt_text: { type: "string", maxLength: 500 }, mood_tags: { type: "array", maxItems: 12, items: { type: "string", maxLength: 32 } }
}, required: ["note_id"], additionalProperties: false } });
function toolRequestId(scope, turnId) {
    if (!UUID.test(turnId || "")) throw xhsImportError("sticker_import_request_invalid");
    const hash = createHash("sha256").update(JSON.stringify([scope.userId, scope.companionId, turnId, "xhs-sticker"])).digest("hex");
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
module.exports = { createXhsStickerImportService, IMPORT_XHS_STICKER_TOOL, xhsImportError, toolRequestId, coverUrl, PRESERVE };
