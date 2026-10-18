const { IMPORT_XHS_STICKER_TOOL, xhsImportError, toolRequestId, PRESERVE } = require("./xhs-sticker-import");
function createXhsStickerChatRuntime({ service, scope, turnId, selector, permission, next }) {
    const enabled = Boolean(scope && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(turnId || "") && permission?.xhs_schema_available === true && permission.xhs_enabled === true);
    let pending = false;
    return {
        tools: [...(next.tools || []), ...(enabled ? [IMPORT_XHS_STICKER_TOOL] : [])],
        async executeTool(call) {
            if (pending) return { ok: false, code: "sticker_import_busy", error: "正在搜集本轮表情，请等待结果。" };
            pending = true;
            try {
                if (call?.name !== IMPORT_XHS_STICKER_TOOL.name) return await next.executeTool(call);
                if (!enabled) throw xhsImportError("sticker_import_disabled", 403);
                if (selector.getStickerId() || selector.getCustomStickerId()) return { ok: false, error: "本轮已经选择过一张表情。" };
                const input = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments;
                if (!input || typeof input !== "object" || Array.isArray(input) || Object.hasOwn(input, "client_request_id")) throw xhsImportError("sticker_import_request_invalid");
                const result = await service.importXhs(scope, { ...input, client_request_id: toolRequestId(scope, turnId) }, { autonomous: true });
                return { ...selector.selectImportedAsset(result.asset), source: result.source };
            } catch (error) {
                const known = String(error?.code || "").startsWith("sticker_import_") || PRESERVE.has(error?.code) ? error : xhsImportError("sticker_import_request_invalid");
                return { ok: false, code: known.code, error: known.message };
            } finally { pending = false; }
        }
    };
}
module.exports = { createXhsStickerChatRuntime };
