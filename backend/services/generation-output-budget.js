const { normalizeReasoningEffort } = require("./provider-reasoning-effort");

const OPENAI_RESPONSES_REASONING_TOKEN_FLOORS = Object.freeze({
    none: 0,
    minimal: 800,
    low: 1200,
    medium: 4000,
    high: 8000,
    xhigh: 25000,
    max: 25000
});

function openAiResponsesMaxOutputTokens(settings = {}) {
    const configured = Number(settings.max_tokens);
    // 0 / 空 = 不限制输出：给一个远大于日常回复的大预算（受 reasoning 下限约束）
    const configuredBudget =
        Number.isFinite(configured) && configured > 0
            ? Math.round(configured)
            : 32000;
    const effort =
        normalizeReasoningEffort(
            settings.reasoning_effort,
            "openai-responses"
        ) || "none";
    return Math.max(
        configuredBudget,
        OPENAI_RESPONSES_REASONING_TOKEN_FLOORS[effort] || 0
    );
}

module.exports = { openAiResponsesMaxOutputTokens };
