/**
 * 「流式中」的回复：把后端 stream_partials 里已经生成的那部分，作为一条
 * 临时消息显示在历史里。
 *
 * 场景：生成到一半时刷新 / 断线重连。正式消息还没落库，但后端已经把
 * 已生成的文字存进了缓冲区，历史接口用顶层的 streaming_partial 字段返回。
 *
 * 约定：
 *   - 这是一条**只读的临时消息**，id 带前缀，永远不和正式消息混淆；
 *   - 如果历史里已经存在同 clientMessageId 的正式消息，就不再追加（避免重影）；
 *   - 内容为空时不追加（没有意义的空气泡）。
 */

export const STREAMING_PARTIAL_PREFIX = "streaming-partial:";

function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * @param {{content?: string, clientMessageId?: string, updatedAt?: string}|null|undefined} partial
 * @returns {object|null} 一条可以直接交给渲染层的消息对象
 */
export function streamingPartialMessage(partial) {
  if (!partial || typeof partial !== "object") return null;
  const content = text(partial.content);
  if (!content.trim()) return null;
  const clientMessageId = text(partial.clientMessageId);
  return {
    id: `${STREAMING_PARTIAL_PREFIX}${clientMessageId || "unknown"}`,
    role: "assistant",
    content,
    created_at: partial.updatedAt || null,
    // 渲染层可以据此显示「仍在生成」的光标，并且不应把它当成完整消息缓存。
    isStreaming: true,
    streamingPartial: true,
    client_message_id: clientMessageId || undefined,
    tool_calls: {}
  };
}

/**
 * 把流式部分合并进已经水合过的历史数组。
 * 返回新数组，不修改入参。
 */
export function mergeStreamingPartial(messages, partial) {
  const list = Array.isArray(messages) ? messages : [];
  const synthetic = streamingPartialMessage(partial);
  if (!synthetic) return list;

  const clientMessageId = synthetic.client_message_id;
  // 正式消息已经落库了：不再显示临时的那条。
  if (
    clientMessageId &&
    list.some(
      (row) =>
        row &&
        row.client_message_id === clientMessageId &&
        String(row.id || "").indexOf(STREAMING_PARTIAL_PREFIX) !== 0
    )
  ) {
    return list;
  }
  // 已经追加过同一条（重复拉取）：用新的内容替换旧的。
  const index = list.findIndex(
    (row) => row && String(row.id || "") === synthetic.id
  );
  if (index >= 0) {
    const next = list.slice();
    next[index] = { ...list[index], ...synthetic };
    return next;
  }
  return [...list, synthetic];
}
