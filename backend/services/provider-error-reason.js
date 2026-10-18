"use strict";

// Classify only failed provider requests/events; never inspect generated chat text.
function providerErrorReason(error) {
    if (error?.errorSource !== "upstream_provider_or_gateway") return null;
    if (error.code === "provider_stream_incomplete" || error.code === "provider_boundary_residue") return null;
    const code = String(error.providerCode || error.code || "").toLowerCase();
    const message = String(error.message || "").slice(0, 4096);
    const status = Number(error.upstreamStatus);
    if (code === "openai_responses_no_visible_text") return "provider_empty_response";
    if (code === "data_inspection_failed") return "data_inspection_failed";
    if (["insufficient_balance", "balance_not_enough", "credit_balance_too_low", "insufficient_credits"].includes(code) || /insufficient (?:account )?(?:balance|credits)|credit balance is too low|balance (?:is )?(?:insufficient|too low)|余额不足|欠费/i.test(message)) return "provider_balance_insufficient";
    if (["insufficient_quota", "quota_exceeded", "billing_hard_limit_reached"].includes(code) || /exceeded your current quota|billing hard limit|额度(?:不足|耗尽|超限)/i.test(message)) return "provider_quota_exhausted";
    if (["context_length_exceeded", "context_window_exceeded", "prompt_too_long"].includes(code) || /maximum context length|context (?:window|length).*(?:exceed|too long)|上下文.{0,12}(?:超限|超出)/i.test(message)) return "provider_context_exceeded";
    if (["invalid_api_key", "authentication_error", "unauthorized"].includes(code) || status === 401) return "provider_authentication_failed";
    if (["model_not_found", "model_not_available", "not_found_error"].includes(code) || status === 404) return "provider_model_unavailable";
    if (status === 429 || ["rate_limit_exceeded", "rate_limit_error", "resource_exhausted"].includes(code)) return "provider_rate_limited";
    if (status === 403 || code === "permission_error") return "provider_permission_denied";
    if ([408, 504, 522, 524].includes(status) || ["timeout", "request_timeout"].includes(code)) return "provider_timeout";
    if (status >= 500 && status <= 599 || code === "overloaded_error") return "provider_unavailable";
    if ([400, 413, 422].includes(status)) return "provider_request_invalid";
    return null;
}

module.exports = { providerErrorReason };
