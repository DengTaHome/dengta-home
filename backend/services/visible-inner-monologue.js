const {
    sanitizeCompanionStatusSnapshot
} = require("./companion-status");
const {
    isProviderBoundaryResidue
} = require("./persistent-memory-filter");
const {
    interactiveGenerationSettings
} = require("./interactive-generation-profile");
const { VISIBLE_MONOLOGUE_SOURCE } = require("./visible-monologue-stream");

const VISIBLE_INNER_MONOLOGUE_PROMPT_ARCHITECTURE =
    "visible-inner-monologue";
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGE_ID_MAX = 9223372036854775807n;

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
    return normalized.toLowerCase();
}

function requiredMessageId(value, field) {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
        throw badRequest(`请提供有效的 ${field}。`);
    }
    const normalized = String(value ?? "").trim();
    if (UUID_PATTERN.test(normalized)) return normalized.toLowerCase();
    if (/^[1-9]\d{0,18}$/.test(normalized) && BigInt(normalized) <= MESSAGE_ID_MAX) {
        return normalized;
    }
    throw badRequest(`请提供有效的 ${field}。`);
}

function parseVisibleInnerMonologueRequest(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw badRequest("心声请求必须是对象。");
    }
    const allowed = new Set([
        "session_id",
        "conversation_id",
        "message_id",
        "user_message_id",
        "recovery_request_id",
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
    const assistantAnchor = value.message_id !== undefined;
    const userAnchor = value.user_message_id !== undefined;
    if (assistantAnchor === userAnchor) {
        throw badRequest("请只提供 message_id 或 user_message_id 中的一个心声锚点。");
    }
    const anchorField = assistantAnchor ? "message_id" : "user_message_id";
    const anchorId = requiredMessageId(value[anchorField], anchorField);
    return {
        conversationId: requiredUuid(
            value.session_id ?? value.conversation_id,
            "session_id"
        ),
        messageId: assistantAnchor ? anchorId : null,
        userMessageId: userAnchor ? anchorId : null,
        anchorId,
        anchorType: assistantAnchor ? "assistant_message" : "user_message",
        recoveryRequestId: value.recovery_request_id === undefined
            ? null
            : requiredUuid(value.recovery_request_id, "recovery_request_id").toLowerCase(),
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
        message.role === "user"
            ? "针对下面这条已保存的用户消息，新生成一段角色主动公开的心声："
            : "请从下面这条已经说出口的回复继续向内展开，新生成公开心声，不要重复正文：",
        cleanText(message.content, 4000)
    ].join("\n");
}

function messageTimestamp(value) {
    const parsed = Date.parse(value || "");
    if (!Number.isFinite(parsed)) return null;
    const fraction = String(value).match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] || "";
    return BigInt(parsed) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3, 6));
}

function contextThroughAnchor(messages, targetMessage) {
    const rows = Array.isArray(messages) ? messages : [];
    const anchorIndex = rows.findIndex((message) =>
        String(message?.id ?? "") === String(targetMessage.id)
    );
    const targetTime = messageTimestamp(targetMessage.created_at);
    const candidates = anchorIndex >= 0 ? rows.slice(0, anchorIndex + 1) : rows;
    const bounded = candidates.filter((message) => {
        if (!message || message.visible === false || message.context_visible === false ||
            !["user", "assistant"].includes(message.role)) return false;
        if (message.conversation_id && message.conversation_id !== targetMessage.conversation_id) return false;
        if (String(message.id) === String(targetMessage.id)) return true;
        const time = messageTimestamp(message.created_at);
        if (time !== null && targetTime !== null) {
            if (time !== targetTime) return time < targetTime;
            const left = String(message.id || ""), right = String(targetMessage.id);
            if (/^[1-9]\d*$/.test(left) && /^[1-9]\d*$/.test(right)) {
                return BigInt(left) < BigInt(right);
            }
            return UUID_PATTERN.test(left) && UUID_PATTERN.test(right) && left < right;
        }
        return anchorIndex >= 0;
    });
    if (!bounded.some((message) => String(message.id) === String(targetMessage.id))) {
        bounded.push(targetMessage);
    }
    return bounded.slice(-12);
}

function createVisibleMonologueRecoveryCache({ ttlMs = 300000, maxEntries = 128, now = Date.now } = {}) {
    const entries = new Map();
    const ttl = Math.max(1, Math.min(300000, Number(ttlMs) || 300000));
    const maximum = Math.max(1, Math.min(128, Math.trunc(Number(maxEntries) || 128)));
    async function run(key, fingerprint, create) {
        for (const [id, entry] of entries) {
            if (entry.expiresAt !== null && entry.expiresAt <= now()) entries.delete(id);
        }
        const existing = entries.get(key);
        if (existing) {
            if (existing.fingerprint !== fingerprint) {
                const error = new Error("同一心声补充请求编号不能更改请求内容。");
                error.status = 409;
                error.code = "inner_monologue_request_conflict";
                throw error;
            }
            return { ...(await existing.promise) };
        }
        while (entries.size >= maximum) {
            const settled = [...entries].find(([, entry]) => entry.expiresAt !== null);
            if (!settled) {
                const error = new Error("心声补充请求较多，请稍后重试。");
                error.status = 429;
                error.code = "inner_monologue_recovery_busy";
                throw error;
            }
            entries.delete(settled[0]);
        }
        const entry = { fingerprint, expiresAt: null, promise: null };
        entry.promise = Promise.resolve().then(create).then(
            (result) => {
                entry.expiresAt = now() + ttl;
                return Object.freeze({ ...result });
            },
            (error) => {
                if (entries.get(key) === entry) entries.delete(key);
                throw error;
            }
        );
        entries.set(key, entry);
        return { ...(await entry.promise) };
    }
    return { run, get size() { return entries.size; } };
}

const recoveryCache = createVisibleMonologueRecoveryCache();

async function runVisibleInnerMonologue({ body, services, tenant, cache = recoveryCache }) {
    const request = parseVisibleInnerMonologueRequest(body);
    const targetMessage = await services.loadMessage(
        request.conversationId,
        request.anchorId
    );
    if (
        !targetMessage ||
        targetMessage.role !== (request.messageId ? "assistant" : "user") ||
        String(targetMessage.id) !== request.anchorId ||
        String(targetMessage.conversation_id) !== request.conversationId ||
        targetMessage.visible === false ||
        (targetMessage.role === "assistant" && isProviderBoundaryResidue(targetMessage.content))
    ) {
        const error = new Error("找不到这条可生成心声的回复。");
        error.status = 404;
        throw error;
    }

    const generate = () => generateVisibleInnerMonologue({ request, targetMessage, services });
    if (!request.recoveryRequestId || !UUID_PATTERN.test(tenant?.userId || "") ||
        !UUID_PATTERN.test(tenant?.companionId || "")) return generate();
    const key = JSON.stringify([
        tenant.userId, tenant.companionId, request.conversationId,
        request.anchorType, request.anchorId, request.recoveryRequestId
    ]);
    // Only fields used by buildRuntimeContext affect this generation. Countdown
    // normalization changes with wall time even when a retry sends the same body.
    const { mood, energyLevel, focus, microState } = request.companionStatus;
    const fingerprint = JSON.stringify([request.requestedModel, mood, energyLevel, focus, microState]);
    return cache.run(key, fingerprint, generate);
}

async function generateVisibleInnerMonologue({ request, targetMessage, services }) {
    const settings = await services.getSettings();
    const effectiveModel = await services.resolveTurnModel(
        settings,
        request.requestedModel
    );
    const context = await services.loadChatContext(
        request.conversationId,
        settings,
        targetMessage
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
            ...contextThroughAnchor(context?.messages, targetMessage),
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
        ...(request.messageId ? { message_id: request.messageId } : { user_message_id: request.userMessageId }),
        source: VISIBLE_MONOLOGUE_SOURCE,
        generated_with_reply: false,
        anchor_type: request.anchorType,
        anchor_id: request.anchorId,
        recovery_request_id: request.recoveryRequestId,
        model: effectiveModel,
        provider: settings.provider,
        response_mode: generated.mode
    };
}

module.exports = {
    VISIBLE_INNER_MONOLOGUE_PROMPT_ARCHITECTURE,
    buildRuntimeContext,
    contextThroughAnchor,
    createVisibleMonologueRecoveryCache,
    parseVisibleInnerMonologueRequest,
    runVisibleInnerMonologue
};
