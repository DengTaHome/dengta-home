// Older providers sometimes append this UI payload as plain text instead of tool metadata.
export function readChatDisplayContent(message = {}) {
  const content = typeof message.content === "string" ? message.content : "";
  const unchanged = { content, nextActions: [] };
  if (message.role !== "assistant" || message.chatError || message.isStreaming || message.generationInProgress) return unchanged;
  const match = /\n\s*\n(\{\s*"next_best_actions"\s*:[\s\S]+\})\s*$/.exec(content);
  if (!match || content.includes("```") || content.includes("~~~")) return unchanged;
  const body = content.slice(0, match.index).trimEnd();
  if (!body.trim()) return unchanged;
  let payload;
  try { payload = JSON.parse(match[1]); } catch { return unchanged; }
  if (!payload || Object.keys(payload).length !== 1 || !Array.isArray(payload.next_best_actions) || payload.next_best_actions.length < 1 || payload.next_best_actions.length > 6
    || payload.next_best_actions.some(value => typeof value !== "string" || !value.trim() || Array.from(value).length > 240)) return unchanged;
  return { content: body, nextActions: payload.next_best_actions };
}
