/**
 * 生成中断时的「已保留片段」提示。
 *
 * 从线上产物（assets/App-Bnlv_57K.js）reverse 出来的结构：
 *
 *   tool_calls.partial_reply === true
 *     -> <div class="partial-reply-note" role="note">
 *          <span>生成中断 · 已保留当时内容</span>
 *          <button>复制片段</button>
 *        </div>
 *
 * 与仓库原有的 chatError.partialContent 是两套东西，线上两套并存：
 *   - chatError + partialContent：本轮以「错误」结束，片段挂在错误状态里；
 *   - tool_calls.partial_reply   ：本轮中断但不算错误（例如客户端断开），
 *                                  已生成的正文当作正常消息存下来，加个标记。
 *
 * 后者正是「已生成的立刻马上保存下来」在消息层的落点。
 */

export const PARTIAL_REPLY_NOTE = "生成中断 · 已保留当时内容";
export const PARTIAL_REPLY_COPY = "复制片段";
export const PARTIAL_REPLY_COPIED = "已复制";

/** 这条消息是否是「中断但已保留」的回复。 */
export function isPartialReply(toolCalls) {
  if (!toolCalls || typeof toolCalls !== "object") return false;
  return toolCalls.partial_reply === true;
}

/** 有正文才值得提示；空片段不显示提示条。 */
export function shouldShowPartialReplyNote(toolCalls, content) {
  if (!isPartialReply(toolCalls)) return false;
  return typeof content === "string" && content.trim().length > 0;
}
