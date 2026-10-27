const assert = require("node:assert/strict");
const {
    buildRefusalLogRecord,
    REFUSAL_TEXT_LIMIT,
    REFUSAL_EXCERPT_LIMIT
} = require("../services/refusal-diagnostics");

const REAL_REFUSAL = "抱歉，我无法为这类内容提供回复选项。";

(async () => {
    // --- 基本形状：日志行与前端信息出自同一份数据 ---
    {
        const { row, info } = buildRefusalLogRecord({
            userId: "user-1",
            companionId: "companion-1",
            conversationId: "conv-1",
            text: REAL_REFUSAL,
            model: "fixture-model",
            provider: "custom"
        });

        assert.equal(row.error_code, "provider_boundary_residue", "the log row carries the error code");
        assert.equal(row.path, "/chat", "the log row carries the path");
        assert.equal(row.user_id, "user-1", "the log row is tenant-scoped");
        assert.equal(row.companion_id, "companion-1", "the log row keeps the companion");
        assert.equal(row.conversation_id, "conv-1", "the log row keeps the conversation");
        assert.match(row.message, /模型拒绝回答/, "the log message explains the reason in plain words");
        assert.match(row.message, new RegExp(REAL_REFUSAL.slice(0, 10)), "the log message quotes the refusal");
        assert.equal(row.request_summary.refusal_text, REAL_REFUSAL, "the full refusal text is preserved");
        assert.equal(row.request_summary.model, "fixture-model", "the model is recorded");
        assert.equal(row.request_summary.provider, "custom", "the provider is recorded");

        assert.equal(info.code, "provider_boundary_residue", "the client info carries the same code");
        assert.equal(info.reason, row.message, "the client reason and the log message are identical");
        assert.equal(info.excerpt, REAL_REFUSAL, "the client gets the refusal excerpt");
        assert.equal(info.error_log_id, null, "the log id is filled in by the caller");
    }

    // --- 长文本：截断，但日志和前端用同一套截断 ---
    {
        const long = "拒绝".repeat(2000);
        const { row, info } = buildRefusalLogRecord({ text: long });
        assert.equal(row.request_summary.refusal_text.length, REFUSAL_TEXT_LIMIT + 1, "the stored text is capped (plus the ellipsis)");
        assert.equal(info.excerpt.length, REFUSAL_EXCERPT_LIMIT + 1, "the excerpt is capped separately");
        assert.ok(row.message.length < 300, "the human message stays short");
    }

    // --- 空文本：仍要给出明确原因，不能是空白 ---
    {
        const { row, info } = buildRefusalLogRecord({});
        assert.equal(row.request_summary.refusal_text, "", "empty text stays empty");
        assert.equal(row.message, "模型拒绝回答（错误码 provider_boundary_residue）", "the reason still names the code");
        assert.equal(info.excerpt, "", "the excerpt is empty rather than the string 'undefined'");
        assert.equal(row.user_id, null, "missing tenant fields become null, not omitted");
    }

    // --- 只留空白：当作没有原文 ---
    {
        const { row } = buildRefusalLogRecord({ text: "   \n  " });
        assert.equal(row.message, "模型拒绝回答（错误码 provider_boundary_residue）", "whitespace-only text does not become a quote");
        assert.equal(row.request_summary.refusal_text, "   \n  ", "but the raw text is still stored as received");
    }

    // --- 自定义路径 ---
    {
        const { row } = buildRefusalLogRecord({ text: "x", path: "/chat/stream", method: "POST" });
        assert.equal(row.path, "/chat/stream", "the caller can override the path");
    }

    console.log(
        "Refusal diagnostics: shared log row and client info, plain-language reason, full text retention, excerpt cap and empty-input handling passed"
    );
})();
