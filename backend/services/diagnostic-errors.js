"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { publicChatErrorCode, publicChatErrorMetadata } = require("./chat-stream-contract");
const ERROR_FEEDBACK = require("./chat-error-feedback");
const root = path.resolve(__dirname, "..");
const COMMON_CODES = new Set(["request_timeout", "authentication_required", "invalid_session", "permission_denied", "api_request_failed", "provider_stream_incomplete", "onboarding_first_chat_required", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"]);
for (const code of ["import_file_type_unsupported", "import_csv_invalid", "import_invalid_encoding", "import_json_invalid", "import_json_too_large", "import_pdf_no_text", "private_media_preference_clear_failed", "private_media_remove_failed", "private_media_download_failed", "companion_gender_schema_required"]) COMMON_CODES.add(code);
for (const code of ["style_distill_source_short", "style_distill_source_long", "style_distill_file_required", "style_distill_file_empty", "style_distill_file_too_large", "style_distill_file_invalid", "style_distill_rate_limited", "style_distill_empty", "style_distill_model_unconfigured", "style_distill_unavailable", "style_distill_auth_required"]) COMMON_CODES.add(code);
for (const code of ["import_pdf_invalid", "import_pdf_password_required", "import_document_too_large", "memory_import_gateway_failed", "memory_import_unconfigured", "memory_import_timeout", "memory_import_disabled", "memory_import_auth_failed", "memory_import_endpoint_not_found", "memory_import_file_too_large", "memory_import_file_invalid", "memory_import_rate_limited", "memory_import_unreadable"]) COMMON_CODES.add(code);
const ROUTE_SEGMENTS = new Set("api v2 chat stream sessions messages settings models providers health errors fun-labs achievements onboarding custom special-dates daily-shots memories memory import-file import-history moments diary profile voice speech transcribe music co-watch mcp connections companion companions auth login logout runtime-state status files attachments import imports preview assets catalog preferences external-memory export style-distill parse-file".split(" "));

function safeRoute(value) {
    return String(value || "").split("?")[0].split("/").filter(Boolean).map(segment => ROUTE_SEGMENTS.has(segment) ? segment : ":value").join("/").slice(0, 200);
}

function safeCode(value) {
    const code = String(value || "");
    return COMMON_CODES.has(code) || /^[0-9A-Z]{5}$/.test(code) ? code : "request_failed";
}

function businessFrames(stack) {
    return String(stack || "").split(/\r?\n/).filter(line => /^\s*at\s/.test(line)).flatMap(line => {
        const match = line.match(/(?:\(|\s)((?:[A-Za-z]:[\\/]|\/)[^()\n]+\.(?:js|cjs|mjs)):(\d+):(\d+)\)?$/);
        if (!match) return [];
        const file = path.resolve(match[1]);
        const relative = path.relative(root, file).replaceAll("\\", "/");
        if (relative.startsWith("../") || path.isAbsolute(relative) || relative.includes("node_modules/") || !fs.existsSync(file)) return [];
        return [`${relative}:${match[2]}:${match[3]}`];
    }).slice(0, 8);
}

function publicBudgetUsage(usage, stage) {
    if (!usage || typeof usage !== "object") return undefined;
    const result = {};
    for (const key of ["capacity", "input", "reservedOutput", "system", "latest", "extra", "history", "memory", "calendar"]) {
        const value = usage[key];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e9) result[key] = Math.round(value);
    }
    if (!result.capacity) return undefined;
    if (result.input === undefined) result.input = ["system", "latest", "extra", "history", "memory", "calendar"].reduce((sum, key) => sum + (result[key] || 0), 0);
    if (["planning", "transport"].includes(stage)) result.stage = stage;
    return result;
}

function diagnosticRecord(req, error) {
    const metadata = publicChatErrorMetadata(error);
    const code = publicChatErrorCode(error) || safeCode(error?.code);
    const distillPath = String(req.originalUrl || "").split("?")[0].replace(/\/+$/, "");
    const route = ["/api/v2/style-distill", "/api/v2/style-distill/parse-file"].includes(distillPath)
        ? distillPath : typeof req.route?.path === "string" ? req.route.path : "/unmatched-route";
    const frames = businessFrames(error?.stack);
    const status = Number(error?.status);
    return {
        path: "/" + safeRoute(route),
        method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(req.method) ? req.method : "UNKNOWN",
        error_code: code,
        message: ERROR_FEEDBACK[code] || "请求未完成。请结合错误代码、业务位置和版本定位。",
        error_source: metadata.error_source || (error?.errorSource === "external_memory_gateway" ? "external_memory_gateway" : "dengta"),
        provider_phase: metadata.provider_phase || null,
        provider_code: metadata.provider_code || null,
        upstream_status: Number.isInteger(metadata.upstream_status) ? metadata.upstream_status : null,
        stack_trace: frames.join("\n"),
        request_summary: {
            stream: route === "/chat/stream" || req.body?.stream === true,
            status: status >= 400 && status <= 599 ? status : 500,
            version: require("../package.json").version,
            revision: /^[a-f0-9]{7,40}$/i.test(process.env.RENDER_GIT_COMMIT || "") ? process.env.RENDER_GIT_COMMIT : null,
            context_budget: publicBudgetUsage(error?.budgetUsage, error?.budgetStage),
        },
    };
}

function publicDiagnosticLog(row) {
    const frames = String(row.stack_trace || "").split(/\r?\n/).filter(line => {
        if (!/^(?:services\/|routes\/|server\.)[\w/.-]+:(\d+):(\d+)$/.test(line)) return false;
        const file = path.resolve(root, line.replace(/:\d+:\d+$/, ""));
        return !path.relative(root, file).startsWith("..") && fs.existsSync(file);
    });
    const code = publicChatErrorCode({ code: row.error_code, errorSource: row.error_source, providerCode: row.provider_code, upstreamStatus: row.upstream_status }) || safeCode(row.error_code);
    return {
        id: row.id, created_at: row.created_at, method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(row.method) ? row.method : "UNKNOWN",
        path: "/" + safeRoute(row.path),
        error_code: code, message: ERROR_FEEDBACK[code] || "请求未完成。具体原因尚未确认，请结合错误代码与业务位置检查。",
        ...publicChatErrorMetadata({ code, errorSource: row.error_source, providerPhase: row.provider_phase, providerCode: row.provider_code, upstreamStatus: row.upstream_status }),
        ...(row.error_source === "external_memory_gateway" ? {error_source:"external_memory_gateway",upstream_status:Number.isInteger(row.upstream_status) && row.upstream_status >= 100 && row.upstream_status <= 599 ? row.upstream_status : undefined} : {}),
        stack_trace: frames.join("\n"), error_location: frames[0] || "",
        request_summary: {
            stream: row.request_summary?.stream === true,
            version: /^\d+\.\d+\.\d+$/.test(row.request_summary?.version || "") ? row.request_summary.version : null,
            revision: /^[a-f0-9]{7,40}$/i.test(row.request_summary?.revision || "") ? row.request_summary.revision : null,
            context_budget: publicBudgetUsage(row.request_summary?.context_budget, row.request_summary?.context_budget?.stage),
        },
    };
}

module.exports = { diagnosticRecord, publicDiagnosticLog, businessFrames, safeDiagnosticCode: safeCode };
