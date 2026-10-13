const { providerErrorReason } = require("./provider-error-reason");
const ERROR_FEEDBACK = require("./chat-error-feedback");
function streamSuccess(result) {
    return { ...result, type: "done", ok: true };
}

const PUBLIC_CHAT_ERROR_CODES = new Set([
    ...Object.keys(ERROR_FEEDBACK),
    "reply_body_missing",
    "provider_stream_incomplete",
    "CHAT_GENERATION_IN_PROGRESS",
    "MODEL_NOT_AVAILABLE",
    "data_inspection_failed",
    "provider_error_document",
    "provider_boundary_residue",
    "context_budget_exceeded",
    "companion_gender_schema_required",
    "MODEL_STREAM_CONNECT_TIMEOUT",
    "MODEL_STREAM_IDLE_TIMEOUT",
]);
const PUBLIC_CHAT_ERROR_MESSAGES = Object.freeze({
    reply_body_missing: "本轮未收到可分离的正文，可能只生成了心声或格式未闭合；本轮回复未保存 / No separable reply body was received; this reply was not saved.",
    provider_stream_incomplete: "上游模型流没有正常结束，本轮回复未保存 / The upstream model stream did not complete; this reply was not saved.",
    companion_gender_schema_required: "伴侣性别功能正在等待服务器数据库更新，本次设置未保存 / Companion gender requires a database update; these settings were not saved.",
    context_budget_exceeded: "本轮上下文超过模型的估算容量，请选择更大窗口模型或减少本轮附件；预算检查不会改写人设或记忆 / This turn exceeds the estimated model context capacity. Choose a larger-context model or fewer attachments. Budget checks do not rewrite personalization or memories.",
    CHAT_GENERATION_IN_PROGRESS: "这条消息已经保存，AI 仍在服务器处理中。",
    MODEL_NOT_AVAILABLE:
        "请求的模型不在当前接口可用列表中 / The requested model is not available from the current API.",
    data_inspection_failed:
        "输入内容未通过模型接口的内容检查 / The input did not pass the model provider's content inspection.",
    provider_error_document:
        "模型接口返回了错误文档，本轮回复未保存 / The model API returned an error document; this reply was not saved.",
    provider_boundary_residue:
        "模型回复被识别为拒答残留，拒答正文未保存 / The model response was identified as refusal residue; the refusal text was not saved.",
    MODEL_STREAM_CONNECT_TIMEOUT:
        "模型流式连接等待超时，请稍后重试。若持续出现，可尝试更换模型或接口 / The model stream connection timed out. Retry later, or switch to a different model or API endpoint.",
    MODEL_STREAM_IDLE_TIMEOUT:
        "模型流式回复连续五分钟没有新数据，请稍后重试。/ The model stream has been idle for 5 minutes. Retry later.",
    ...ERROR_FEEDBACK,
});
const CHAT_ERROR_FALLBACK = "模型服务暂时无法完成这次回复，请稍后重试。";
const COMMITTED_CHAT_ERROR_FALLBACK =
    "AI 回复没有完成，但你的消息已经保存，可以稍后重试。";
const MAX_PUBLIC_ERROR_LENGTH = 220;
const MARKUP_OR_DOCUMENT_PATTERN =
    /<!doctype|<\/?(?:html|head|body|script|style|pre|code|div|span|table|iframe|svg)\b|&lt;\/?(?:html|body|pre|code)\b/i;
const STACK_OR_CODE_PATTERN =
    /(?:^|\s)(?:traceback|syntaxerror|typeerror|referenceerror|stack(?:trace)?\s*[:=]|at\s+[\w$.<>]+\s*\([^\n]*:\d+:\d+\)|node_modules[\\/]|webpack:\/\/|```|econnrefused|enotfound|fetch failed|sqlstate|permission denied|relation\s+.+\s+does not exist)/i;
const SECRET_PATTERN =
    /(?:authorization\s*[:=]|bearer\s+[a-z0-9._-]{12,}|api[_ -]?key\s*[:=]|cookie\s*[:=]|sk-[a-z0-9_-]{12,}|sb_secret_[a-z0-9_-]+)/i;
const GENERIC_UPSTREAM_ERROR_PATTERN =
    /^(?:upstream (?:request )?failed|bad gateway|gateway timeout|service unavailable|internal server error)$/i;
const UPSTREAM_PROTOCOL_ERROR_PATTERN =
    /^upstream stream ended (?:without|before) (?:a )?terminal response event$/i;
const CONTENT_INSPECTION_ERROR_PATTERN =
    /(?:data_inspection_failed|input text data may contain inappropriate content)/i;
const SAFE_PROVIDER_CODE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const PUBLIC_ERROR_SOURCES = new Set([
    "dengta_stream_parser",
    "upstream_provider_or_gateway",
    "dengta_output_guard"
]);
const PUBLIC_PROVIDER_PHASES = new Set([
    "output_parse",
    "http",
    "event",
    "output_document",
    "completed_output"
]);

function publicProviderCode(error) {
    const code = String(error?.providerCode || "").trim();
    return SAFE_PROVIDER_CODE_PATTERN.test(code) ? code : "";
}

function publicErrorSource(error) {
    const source = String(error?.errorSource || "").trim();
    return PUBLIC_ERROR_SOURCES.has(source) ? source : "";
}

function withDiagnostic(message, error) {
    if (error?.code === "CHAT_GENERATION_IN_PROGRESS") return message;
    const providerCode = publicProviderCode(error);
    const source = publicErrorSource(error);
    const hasMetadata = Boolean(
        publicChatErrorCode(error) || providerCode ||
            source ||
            error?.providerPhase ||
            error?.upstreamStatus !== undefined
    );
    if (!hasMetadata) return message;
    const visibleCode = publicChatErrorCode(error) || providerCode || "request_failed";
    const providerText = providerCode && providerCode !== visibleCode ? `；上游代码 / Provider code: ${providerCode}` : "";
    const status = Number(error?.upstreamStatus);
    const statusText = Number.isInteger(status) && status >= 100 && status <= 599
        ? `；HTTP / HTTP: ${status}`
        : "";
    return `${message}（错误代码 / Code: ${visibleCode}；来源 / Source: ${source || "dengta"}${providerText}${statusText}）`;
}

function publicChatErrorCode(error) {
    const code = String(error?.code || "");
    if (PUBLIC_CHAT_ERROR_CODES.has(code) && code !== "provider_error_document") return code;
    const reason = providerErrorReason(error);
    if (reason) return reason;
    if (PUBLIC_CHAT_ERROR_CODES.has(code)) return code;
    if (publicProviderCode(error) === "data_inspection_failed") {
        return "data_inspection_failed";
    }
    if (publicErrorSource(error) === "upstream_provider_or_gateway") {
        return "provider_error_document";
    }
    return null;
}

function stripControlCharacters(value) {
    return Array.from(String(value || ""))
        .filter((character) => {
            const code = character.charCodeAt(0);
            return code >= 32 || [9, 10, 13].includes(code);
        })
        .join("");
}

function publicChatErrorMessage(error, fallback = CHAT_ERROR_FALLBACK) {
    const code = publicChatErrorCode(error) || String(error?.code || "");
    const safeFallback = PUBLIC_CHAT_ERROR_MESSAGES[code] || fallback;
    if (
        code &&
        code !== "CHAT_GENERATION_IN_PROGRESS" &&
        PUBLIC_CHAT_ERROR_MESSAGES[code]
    ) {
        return withDiagnostic(safeFallback, error);
    }
    const candidate = stripControlCharacters(error?.message || error?.content)
        .replace(/\s+/g, " ")
        .trim();
    if (!candidate) return safeFallback;
    if (UPSTREAM_PROTOCOL_ERROR_PATTERN.test(candidate)) {
        return withDiagnostic(
            "上游模型流没有正常结束，请重试或检查接口兼容性 / The upstream model stream ended without a terminal response event. Retry or check API compatibility.",
            error
        );
    }
    if (CONTENT_INSPECTION_ERROR_PATTERN.test(candidate)) {
        return withDiagnostic(
            PUBLIC_CHAT_ERROR_MESSAGES.data_inspection_failed,
            error
        );
    }
    if (candidate.length > MAX_PUBLIC_ERROR_LENGTH) {
        return withDiagnostic(safeFallback, error);
    }
    if (/^[{[]/.test(candidate) && /[}\]]$/.test(candidate)) {
        return withDiagnostic(safeFallback, error);
    }
    if (
        MARKUP_OR_DOCUMENT_PATTERN.test(candidate) ||
        STACK_OR_CODE_PATTERN.test(candidate) ||
        SECRET_PATTERN.test(candidate) ||
        GENERIC_UPSTREAM_ERROR_PATTERN.test(candidate)
    ) {
        return withDiagnostic(safeFallback, error);
    }
    return withDiagnostic(candidate, error);
}

function streamFailure(error, { userMessageCommitted = false, logId = null } = {}) {
    const code = publicChatErrorCode(error) || "request_failed";
    const diagnostics = publicChatErrorMetadata(error);
    const fallback = userMessageCommitted
        ? COMMITTED_CHAT_ERROR_FALLBACK
        : CHAT_ERROR_FALLBACK;
    return {
        type: "error",
        ok: false,
        content: publicChatErrorMessage(error, fallback),
        user_message_committed: userMessageCommitted === true,
        ...(code ? { code } : {}),
        ...(logId ? { error_log_id: logId } : {}),
        ...diagnostics
    };
}

function publicErrorLocation(error) {
    // 从堆栈里提取第一个业务代码位置（文件:行:列），供聊天页显示排查位置。
    const stack = String(error?.stack || "");
    if (!stack) return "";
    const lines = stack.split(String.fromCharCode(10)).slice(1);
    for (const line of lines) {
        const end = line.lastIndexOf(")");
        const start = line.lastIndexOf("(", end);
        if (start < 0 || end < 0) continue;
        const raw = line.slice(start + 1, end);
        const parts = raw.split(":");
        if (parts.length < 3) continue;
        const lineCol = parts.slice(-2).join(":");
        if (!/^\d+:\d+$/.test(lineCol)) continue;
        const file = parts.slice(0, -2).join(":").split("\\").join("/");
        if (/node_modules|internal\//.test(file)) continue;
        const name = file.split("/").pop();
        if (name) return name + ":" + lineCol;
    }
    return "";
}

function publicChatErrorMetadata(error) {
    const providerCode = publicProviderCode(error);
    const source = publicErrorSource(error);
    const upstreamStatus = Number(error?.upstreamStatus);
    const rawProviderPhase = String(error?.providerPhase || "").trim();
    const providerPhase = PUBLIC_PROVIDER_PHASES.has(rawProviderPhase)
        ? rawProviderPhase
        : "";
    const location = publicErrorLocation(error);
    return {
        ...(providerCode ? { provider_code: providerCode } : {}),
        ...(source ? { error_source: source } : {}),
        ...(Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599
            ? { upstream_status: upstreamStatus }
            : {}),
        ...(providerPhase ? { provider_phase: providerPhase } : {}),
        ...(location ? { error_location: location } : {})
    };
}

module.exports = {
    publicChatErrorCode,
    publicChatErrorMetadata,
    publicChatErrorMessage,
    streamFailure,
    streamSuccess
};
