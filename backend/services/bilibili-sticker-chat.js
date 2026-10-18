const { IMPORT_BILIBILI_STICKER_TOOL, toolRequestId, importError } = require("./bilibili-sticker-import");

function createBilibiliStickerChatRuntime({ service, scope, turnId, selector, permission }) {
    const enabled = Boolean(scope && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(turnId || "") &&
        permission?.schema_available === true && permission.bilibili_enabled === true);
    let pending = false;
    return {
        tools: enabled ? [IMPORT_BILIBILI_STICKER_TOOL] : [],
        async executeTool(call) {
            if (pending) return { ok: false, code: "sticker_import_busy", error: "正在搜集本轮表情，请等待结果。" };
            if (call?.name !== IMPORT_BILIBILI_STICKER_TOOL.name) return selector.executeTool(call);
            if (!enabled) return { ok: false, code: "sticker_import_disabled", error: importError("sticker_import_disabled").message };
            if (selector.getStickerId() || selector.getCustomStickerId()) return { ok: false, error: "本轮已经选择过一张表情。" };
            pending = true;
            try {
                const input = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments;
                if (!input || typeof input !== "object" || Array.isArray(input) || Object.hasOwn(input, "client_request_id")) throw importError("sticker_import_request_invalid");
                const result = await service.importBilibili(scope, {
                    ...input, client_request_id: toolRequestId(scope, turnId, input.bvid),
                }, { autonomous: true });
                return { ...selector.selectImportedAsset(result.asset), source: result.source };
            } catch (error) {
                const known = String(error?.code || "").startsWith("sticker_import_") ? error : importError("sticker_import_request_invalid");
                return { ok: false, code: known.code, error: known.message };
            } finally { pending = false; }
        },
    };
}
module.exports = { createBilibiliStickerChatRuntime };
