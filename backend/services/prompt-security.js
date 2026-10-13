const PROMPT_SECRET_PATTERNS = [
    /\bsk-[A-Za-z0-9_-]{8,}\b/i,
    /\bAIza[0-9A-Za-z_-]{20,}\b/,
    /\b(?:ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{12,}\b/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/i,
    /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\b\s*[:=]\s*[^\s,;]{6,}/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i
];

function promptContainsLikelySecret(value) {
    const text = String(value || "");
    return PROMPT_SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function assertPromptFieldsDoNotContainSecrets(fields = {}) {
    for (const field of [
        "system_prompt",
        "additional_prompt",
        "personality",
        "unified_system_prompt",
        "user_details"
    ]) {
        if (promptContainsLikelySecret(fields[field])) {
            const error = new Error(
                "提示词中疑似包含 API Key、令牌、密码或私钥。请删除密钥后再保存；模型密钥只能通过多供应商 API 控制台加密保存，不能写入提示词。 / The prompt appears to contain a secret. Save model credentials through the encrypted provider console instead of putting them in a prompt."
            );
            error.status = 400;
            throw error;
        }
    }
}

module.exports = {
    assertPromptFieldsDoNotContainSecrets,
    promptContainsLikelySecret
};
