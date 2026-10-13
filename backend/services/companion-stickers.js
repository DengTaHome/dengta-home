const COMPANION_STICKER_IDS = Object.freeze([
    "bear-sleepy",
    "bear-hug",
    "bear-miss-you",
    "bear-cheer",
    "bear-shy",
    "bear-goodnight"
]);
const COMPANION_STICKER_ID_SET = new Set(COMPANION_STICKER_IDS);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SELECT_COMPANION_STICKER_TOOL = Object.freeze({
    name: "select_companion_sticker",
    description: [
        "可选地给当前文字回复配一张伴侣原创表情。",
        "这些是应用里已经存在的静态表情，不是本轮新生成、现画或刚做好的图片。",
        "不得声称自己现画、刚生成或新做了它；用户明确要求新做表情时，不要用此工具冒充新作品。",
        "只有表情确实能让当下语气更自然时才调用；每轮最多一张。",
        "只能选择给定 sticker_id，不得输出 URL、文件路径或自定义表情名。",
        "表情不能代替文字回复，调用后仍要完成自然的文字回答。"
    ].join(""),
    input_schema: {
        type: "object",
        properties: {
            sticker_id: {
                type: "string",
                enum: COMPANION_STICKER_IDS,
                description:
                    "sleepy=困倦，hug=拥抱，miss-you=想念，cheer=打气，shy=害羞，goodnight=晚安。"
            }
        },
        required: ["sticker_id"],
        additionalProperties: false
    }
});

function normalizeCustomStickers(value) {
    const output = [];
    const seen = new Set();
    for (const item of Array.isArray(value) ? value : []) {
        const id = String(item?.id || "").toLowerCase();
        if (!UUID_PATTERN.test(id) || seen.has(id)) continue;
        seen.add(id);
        output.push(Object.freeze({
            id,
            mood_tags: Object.freeze((Array.isArray(item.mood_tags) ? item.mood_tags : [])
                .map((tag) => String(tag).toLowerCase())
                .filter((tag) => /^[\p{L}\p{N}_-]{1,32}$/u.test(tag))
                .slice(0, 12))
        }));
        if (output.length === 48) break;
    }
    return Object.freeze(output);
}

function createCompanionStickerTool(customStickers = []) {
    const stickers = normalizeCustomStickers(customStickers);
    if (!stickers.length) return SELECT_COMPANION_STICKER_TOOL;
    const tagSummary = stickers.map((item) =>
        `${item.id}:${item.mood_tags.length ? item.mood_tags.join("|") : "neutral"}`
    ).join(",");
    return Object.freeze({
        ...SELECT_COMPANION_STICKER_TOOL,
        description: `${SELECT_COMPANION_STICKER_TOOL.description} 自定义表情候选仅含服务端校验后的 UUID 与情绪标签：${tagSummary}`,
        input_schema: {
            type: "object",
            properties: {
                sticker_id: SELECT_COMPANION_STICKER_TOOL.input_schema.properties.sticker_id,
                custom_sticker_id: {
                    type: "string",
                    enum: stickers.map((item) => item.id),
                    description: "选择一个当前租户、当前伴侣的有效自定义表情 UUID。"
                }
            },
            oneOf: [
                { required: ["sticker_id"] },
                { required: ["custom_sticker_id"] }
            ],
            additionalProperties: false
        }
    });
}

function isAllowedCompanionStickerId(value) {
    return (
        typeof value === "string" && COMPANION_STICKER_ID_SET.has(value)
    );
}

function parseCompanionStickerToolArguments(value, customStickers = []) {
    let parsed;
    try {
        parsed =
            typeof value === "string" ? JSON.parse(value) : value;
    } catch {
        return { ok: false, error: "表情参数不是有效的 JSON。" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "表情参数格式不正确。" };
    }
    const keys = Object.keys(parsed);
    if (keys.length !== 1) {
        return { ok: false, error: "表情只能从内置白名单中选择。" };
    }
    if (keys[0] === "sticker_id" && isAllowedCompanionStickerId(parsed.sticker_id)) {
        return { ok: true, value: parsed.sticker_id };
    }
    const customIds = new Set(normalizeCustomStickers(customStickers).map((item) => item.id));
    const customId = String(parsed.custom_sticker_id || "").toLowerCase();
    if (keys[0] === "custom_sticker_id" && customIds.has(customId)) {
        return { ok: true, value: customId, kind: "custom" };
    }
    return { ok: false, error: "表情只能从当前有效白名单中选择。" };
}

function createCompanionStickerSelector(customStickers = []) {
    let selectedStickerId = "";
    let selectedCustomStickerId = "";

    async function executeTool(toolCall) {
        if (toolCall?.name !== SELECT_COMPANION_STICKER_TOOL.name) {
            return { ok: false, error: "未知表情工具。" };
        }
        if (selectedStickerId || selectedCustomStickerId) {
            return { ok: false, error: "本轮已经选择过一张表情。" };
        }
        const parsed = parseCompanionStickerToolArguments(
            toolCall.arguments ?? "",
            customStickers
        );
        if (!parsed.ok) return parsed;
        if (parsed.kind === "custom") selectedCustomStickerId = parsed.value;
        else selectedStickerId = parsed.value;
        return {
            ok: true,
            ...(selectedStickerId ? { sticker_id: selectedStickerId } : {}),
            ...(selectedCustomStickerId ? { custom_sticker_id: selectedCustomStickerId } : {}),
            message: "表情已附加，请继续完成文字回复。"
        };
    }

    return {
        executeTool,
        getStickerId() {
            return selectedStickerId;
        },
        getCustomStickerId() {
            return selectedCustomStickerId;
        }
    };
}

function companionStickerToolCalls(value) {
    const stickerId =
        typeof value === "string" ? value : value?.getStickerId?.();
    if (isAllowedCompanionStickerId(stickerId)) return { sticker_id: stickerId };
    const customId = typeof value === "object" ? value?.getCustomStickerId?.() : "";
    return UUID_PATTERN.test(String(customId || "")) ? { custom_sticker_id: customId } : {};
}

module.exports = {
    COMPANION_STICKER_IDS,
    SELECT_COMPANION_STICKER_TOOL,
    companionStickerToolCalls,
    createCompanionStickerTool,
    createCompanionStickerSelector,
    isAllowedCompanionStickerId,
    parseCompanionStickerToolArguments
};
