const {
    isProviderBoundaryResidue
} = require("./persistent-memory-filter");

const DEFAULT_MAX_PROBE_LENGTH = 4096;
const HTML_DOCUMENT_SIGNATURES = ["<!doctype html", "<html", "<head", "<body"];
const HTML_ERROR_EVIDENCE =
    /(?:\b(?:4\d\d|5\d\d)\b|\berror\b|forbidden|denied|unauthori[sz]ed|bad gateway|gateway timeout|service unavailable|internal server error|upstream|rate limit|cloudflare|nginx|stack(?:trace)?)/i;
const ERROR_ENVELOPE_KEYS = new Set([
    "code",
    "detail",
    "details",
    "error",
    "errors",
    "id",
    "message",
    "param",
    "request_id",
    "requestid",
    "status",
    "status_code",
    "statuscode",
    "type"
]);
const ERROR_DETAIL_KEYS = new Set([
    "code",
    "detail",
    "details",
    "message",
    "param",
    "status",
    "status_code",
    "statuscode",
    "type"
]);
const ERROR_CODE_PATTERN =
    /(?:error|denied|forbidden|unauth|invalid|policy|rate|limit|fail|timeout|quota|^4\d\d$|^5\d\d$)/i;

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedKeys(value) {
    return Object.keys(value || {}).map((key) => key.toLowerCase());
}

function keysBelongTo(value, allowed) {
    const keys = normalizedKeys(value);
    return keys.length > 0 && keys.every((key) => allowed.has(key));
}

function statusLooksLikeError(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric >= 400;
    return ERROR_CODE_PATTERN.test(String(value || ""));
}

function isProviderErrorEnvelope(value) {
    if (!isPlainObject(value) || !keysBelongTo(value, ERROR_ENVELOPE_KEYS)) {
        return false;
    }

    if (Object.hasOwn(value, "error")) {
        if (typeof value.error === "string") {
            return value.error.trim().length > 0;
        }
        if (
            isPlainObject(value.error) &&
            keysBelongTo(value.error, ERROR_DETAIL_KEYS) &&
            normalizedKeys(value.error).some((key) =>
                ["code", "detail", "details", "message", "status", "type"].includes(
                    key
                )
            )
        ) {
            return true;
        }
    }

    const status = value.status ?? value.status_code ?? value.statusCode;
    if (statusLooksLikeError(status) && (value.message || value.detail)) {
        return true;
    }

    return Boolean(value.message || value.detail) &&
        ERROR_CODE_PATTERN.test(String(value.code || ""));
}

function htmlDocumentVerdict(text, { final, maxProbeLength }) {
    const lower = text.toLowerCase();
    let documentPrefix = false;
    for (const signature of HTML_DOCUMENT_SIGNATURES) {
        if (lower.length < signature.length && signature.startsWith(lower)) {
            return final ? "safe" : "pending";
        }
        if (!lower.startsWith(signature)) continue;
        const boundary = lower[signature.length];
        if (boundary === undefined && !final) return "pending";
        if (
            signature !== "<!doctype html" &&
            boundary !== undefined &&
            !/[\s>]/.test(boundary)
        ) {
            return "safe";
        }
        documentPrefix = true;
        break;
    }
    if (!documentPrefix) return "safe";

    const probe = text.slice(0, maxProbeLength);
    if (HTML_ERROR_EVIDENCE.test(probe)) return "blocked";
    return final || text.length >= maxProbeLength ? "safe" : "pending";
}

function structuralDocumentVerdict(
    value,
    { final = false, maxProbeLength = DEFAULT_MAX_PROBE_LENGTH } = {}
) {
    const source = String(value || "").replace(/^\uFEFF/, "");
    let text = source.trimStart();
    if (!text) return final ? "safe" : "pending";

    const ssePrefix = "data:";
    if (
        text.length < ssePrefix.length &&
        ssePrefix.startsWith(text.toLowerCase())
    ) {
        return final ? "safe" : "pending";
    }
    if (text.toLowerCase().startsWith(ssePrefix)) {
        text = text.slice(ssePrefix.length).trimStart();
        if (!text) return final ? "safe" : "pending";
    }

    if (text.startsWith("<")) {
        return htmlDocumentVerdict(text, { final, maxProbeLength });
    }
    if (!text.startsWith("{")) return "safe";
    if (text.length > maxProbeLength) return "safe";

    try {
        return isProviderErrorEnvelope(JSON.parse(text)) ? "blocked" : "safe";
    } catch {
        return final ? "safe" : "pending";
    }
}

function providerOutputVerdict(value, options = {}) {
    const final = options.final !== false;
    const structural = structuralDocumentVerdict(value, { ...options, final });
    if (structural !== "safe") return structural;
    return final && isProviderBoundaryResidue(value) ? "blocked" : "safe";
}

function isProviderErrorDocument(value) {
    return structuralDocumentVerdict(value, { final: true }) === "blocked";
}

function providerOutputBlockCode(value) {
    if (isProviderErrorDocument(value)) return "provider_error_document";
    if (isProviderBoundaryResidue(value)) return "provider_boundary_residue";
    return null;
}

function createProviderOutputGuard(options = {}) {
    // disabled（排查/产品需求期默认开启）：不过滤、不拦截、逐句立即透传，
    // 让模型输出原样实时显示到聊天页（含可能的拒答残留文本）。
    const disabled = options.disabled === true;
    if (disabled) {
        return {
            push(value) {
                const content = String(value || "");
                return { content, blocked: false, pending: false, code: null };
            },
            finish() {
                return { content: "", blocked: false, pending: false, code: null };
            },
            get blocked() { return false; },
            get code() { return null; }
        };
    }
    const bufferUntilFinish = options.bufferUntilFinish === true;
    let state = "pending";
    let structuralBuffer = "";
    let observed = "";
    let blockCode = null;

    function result(content = "") {
        return {
            content,
            blocked: blockCode !== null,
            pending: state === "pending" && blockCode === null,
            code: blockCode
        };
    }

    return {
        push(value) {
            const content = String(value || "");
            if (!content || blockCode) return result();
            observed += content;
            if (state === "safe") {
                return result(bufferUntilFinish ? "" : content);
            }

            structuralBuffer += content;
            const verdict = structuralDocumentVerdict(structuralBuffer, {
                ...options,
                final: false
            });
            if (verdict === "blocked") {
                blockCode = "provider_error_document";
                structuralBuffer = "";
                return result();
            }
            if (verdict === "pending") return result();

            state = "safe";
            const released = structuralBuffer;
            structuralBuffer = "";
            return result(bufferUntilFinish ? "" : released);
        },
        finish() {
            if (blockCode) return result();
            let released = "";
            if (state === "pending") {
                const verdict = structuralDocumentVerdict(structuralBuffer, {
                    ...options,
                    final: true
                });
                if (verdict === "blocked") {
                    blockCode = "provider_error_document";
                    structuralBuffer = "";
                    return result();
                }
                state = "safe";
                released = structuralBuffer;
                structuralBuffer = "";
            }

            if (isProviderBoundaryResidue(observed)) {
                blockCode = "provider_boundary_residue";
                return result();
            }
            return result(bufferUntilFinish ? observed : released);
        },
        get blocked() {
            return blockCode !== null;
        },
        get code() {
            return blockCode;
        }
    };
}

function providerErrorDocumentError() {
    const error = new Error("模型接口返回了异常错误文档，本轮回复未保存。");
    error.code = "provider_error_document";
    error.status = 502;
    error.errorSource = "upstream_provider_or_gateway";
    error.providerPhase = "output_document";
    return error;
}

function providerBoundaryResidueError() {
    const error = new Error("模型供应商未返回可保存的对话内容。");
    error.code = "provider_boundary_residue";
    error.status = 502;
    error.errorSource = "dengta_output_guard";
    error.providerPhase = "completed_output";
    return error;
}

function providerOutputError(code) {
    return code === "provider_error_document"
        ? providerErrorDocumentError()
        : providerBoundaryResidueError();
}

function assertProviderOutputSafe(value) {
    const code = providerOutputBlockCode(value);
    if (code) throw providerOutputError(code);
    return value;
}

module.exports = {
    assertProviderOutputSafe,
    createProviderOutputGuard,
    isProviderErrorDocument,
    isProviderErrorEnvelope,
    providerBoundaryResidueError,
    providerErrorDocumentError,
    providerOutputBlockCode,
    providerOutputError,
    providerOutputVerdict
};
