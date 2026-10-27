/**
 * 拒答诊断记录。
 *
 * 产品要求：模型拒绝回答时，聊天里那条记录下面要能给出
 *   —— 明确的原因、拒答原文、日志，以及对应的错误码。
 *
 * 之前的实现只写了一条固定文案（"供应商回复未保存，诊断不保留回复正文。"），
 * 明明手上就有原文却故意丢掉。这里把「怎么记录」抽成纯函数：
 *   buildRefusalLogRecord() 产出真正写进 chat_error_logs 的行，以及返回给前端的信息，
 *   两边出自同一份数据，不会出现「日志里有、界面没有」的不一致。
 *
 * 保留原文是有意的产品决定：拒答是用户自己的对话产生的，不是秘密。
 * 但长度要截断，避免一整段超长回复把日志表撑爆。
 */

const REFUSAL_TEXT_LIMIT = 1000;
const REFUSAL_EXCERPT_LIMIT = 120;

function truncate(value, limit) {
    const text = typeof value === "string" ? value : "";
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}…`;
}

/**
 * @returns {{
 *   row: object,      // 直接 insert 进 chat_error_logs 的对象
 *   info: object      // 随消息返回前端、用于在气泡下渲染诊断的对象
 * }}
 */
function buildRefusalLogRecord({
    userId = null,
    companionId = null,
    conversationId = null,
    text = "",
    model = "",
    provider = "",
    path = "/chat",
    method = "POST"
} = {}) {
    const excerpt = truncate(String(text || "").trim(), REFUSAL_EXCERPT_LIMIT);
    const fullText = truncate(String(text || ""), REFUSAL_TEXT_LIMIT);

    const reason = excerpt
        ? `模型拒绝回答（错误码 provider_boundary_residue）：${excerpt}`
        : "模型拒绝回答（错误码 provider_boundary_residue）";

    const row = {
        user_id: userId || null,
        companion_id: companionId || null,
        conversation_id: conversationId || null,
        path,
        method,
        error_code: "provider_boundary_residue",
        message: reason,
        error_source: "upstream_provider_or_gateway",
        provider_phase: "response",
        request_summary: {
            stream: true,
            refusal: true,
            model: model || "",
            provider: provider || "",
            refusal_text: fullText
        }
    };

    const info = {
        code: "provider_boundary_residue",
        source: "upstream",
        reason,
        excerpt,
        model: model || "",
        provider: provider || "",
        // error_log_id 由调用方在插入成功后补上，这里先留空位，保证形状稳定。
        error_log_id: null
    };

    return { row, info };
}

module.exports = {
    buildRefusalLogRecord,
    REFUSAL_TEXT_LIMIT,
    REFUSAL_EXCERPT_LIMIT
};
