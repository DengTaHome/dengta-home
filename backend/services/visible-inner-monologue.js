const {
    sanitizeCompanionStatusSnapshot
} = require("./companion-status");
const {
    isProviderBoundaryResidue
} = require("./persistent-memory-filter");
const {
    interactiveGenerationSettings
} = require("./interactive-generation-profile");

const VISIBLE_INNER_MONOLOGUE_PROMPT_ARCHITECTURE =
    "visible-inner-monologue";
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function badRequest(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
}

function cleanText(value, maximum = 160) {
    if (typeof value !== "string") return "";
    return Array.from(value)
        .filter((character) => {
            const code = character.charCodeAt(0);
            return code >= 32 || [9, 10, 13].includes(code);
        })
        .join("")
        .trim()
        .slice(0, maximum);
}

function requiredUuid(value, field) {
    const normalized = cleanText(value, 80);
    if (!UUID_PATTERN.test(normalized)) {
        throw badRequest(`请提供有效的 ${field}。`);
    }
    return normalized;
}

function parseVisibleInnerMonologueRequest(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw badRequest("心声请求必须是对象。");
    }
    const allowed = new Set([
        "session_id",
        "conversation_id",
        "message_id",
        "model",
        "companion_status"
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
        throw badRequest("心声请求包含不支持的字段。");
    }
    if (
        value.session_id !== undefined &&
        value.conversation_id !== undefined &&
        value.session_id !== value.conversation_id
    ) {
        throw badRequest("session_id 和 conversation_id 不能指向不同会话。");
    }
    return {
        conversationId: requiredUuid(
            value.session_id ?? value.conversation_id,
            "session_id"
        ),
        messageId: requiredUuid(value.message_id, "message_id"),
        requestedModel: cleanText(value.model, 160),
        companionStatus: sanitizeCompanionStatusSnapshot(
            value.companion_status || {}
        )
    };
}

function buildRuntimeContext(message, status) {
    return [
        `当前心情：${status.mood || ""}`,
        `当前能量：${status.energyLevel}%`,
        `当前在意：${status.focus || ""}`,
        `当前细微状态：${status.microState || ""}`,
        "请从下面这条刚刚说出口的回复继续向内展开，不要重复正文：",
        cleanText(message.content, 4000)
    ].join("\n");
}

async function runVisibleInnerMonologue({ body, services }) {
    const request = parseVisibleInnerMonologueRequest(body);
    const targetMessage = await services.loadMessage(
        request.conversationId,
        request.messageId
    );
    if (
        !targetMessage ||
        targetMessage.role !== "assistant" ||
        targetMessage.visible === false ||
        isProviderBoundaryResidue(targetMessage.content)
    ) {
        const error = new Error("找不到这条可生成心声的回复。");
        error.status = 404;
        throw error;
    }

    const settings = await services.getSettings();
    const effectiveModel = await services.resolveTurnModel(
        settings,
        request.requestedModel
    );
    const context = await services.loadChatContext(
        request.conversationId,
        settings
    );
    const generated = await services.generateReply({
        settings: interactiveGenerationSettings(
            {
            ...settings,
                model: effectiveModel
            },
            "visible_inner_monologue"
        ),
        messages: [
            ...(Array.isArray(context?.messages)
                ? context.messages.slice(-12)
                : []),
            {
                role: "user",
                content:
                    "只输出这一次可见心声正文。把最后真正想说出口的愿望自然写进正文里。"
            }
        ],
        memories: Array.isArray(context?.memories)
            ? context.memories.slice(0, 5)
            : [],
        runtimeContext: buildRuntimeContext(
            targetMessage,
            request.companionStatus
        ),
        promptArchitecture:
            VISIBLE_INNER_MONOLOGUE_PROMPT_ARCHITECTURE
    });

    if (generated.mode === "placeholder") {
        const error = new Error("当前模型接口尚未配置，暂时不能生成心声。");
        error.status = 503;
        throw error;
    }
    const innerMonologue = cleanText(generated.text, 12000);
    if (!innerMonologue) {
        const error = new Error("模型没有返回可显示的心声。");
        error.status = 502;
        throw error;
    }
    // 拒答残留检测：模型在心声里输出"我不能输出露骨内容"等拒绝语时，
    // 不当作心声展示，转成明确错误码（与主聊天拒答处理一致）。
    if (isProviderBoundaryResidue(innerMonologue)) {
        const error = new Error("模型没有生成有效心声（检测到拒答残留）。");
        error.status = 502;
        error.code = "provider_boundary_residue";
        error.upstreamStatus = 502;
        throw error;
    }

    return {
        inner_monologue: innerMonologue,
        session_id: request.conversationId,
        conversation_id: request.conversationId,
        message_id: request.messageId,
        model: effectiveModel,
        provider: settings.provider,
        response_mode: generated.mode
    };
}

module.exports = {
    VISIBLE_INNER_MONOLOGUE_PROMPT_ARCHITECTURE,
    buildRuntimeContext,
    parseVisibleInnerMonologueRequest,
    runVisibleInnerMonologue
};
