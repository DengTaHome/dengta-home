/**
 * 聊天历史的本地缓存：让「上次的对话」在首屏立刻出现，再让网络结果覆盖它。
 *
 * 背景（实测）：首屏要 6.5–9.5 秒才画出第一条消息，因为必须等
 * bootstrap → sessions → messages 三波网络请求。用户看到的是长时间空白。
 * 把上一次的消息存下来，启动时先画出来，空白就变成「1 秒出上次的样子」。
 *
 * 设计约束：
 * - **按账号 + 伴侣隔离**，绝不跨账号串数据。
 * - 只存有限条数与有限体积，避免撑爆 localStorage 配额。
 * - 带版本号：结构一变就整体失效，而不是读出半截脏数据。
 * - 超过 7 天不用就丢弃，避免展示极旧内容。
 */

// v4：开始保留 visible_monologue 与 music_card 等「决定行高」的字段，旧缓存结构作废。
export const CHAT_CACHE_VERSION = 4;
// 上限提高过常见历史条数（实测这段历史 43 条）。
// 注意：把它从 40 提到 60 并没有降低 CLS（仍是 0.116），
// 所以「闪」另有原因，这条只当容量余量，别再当成位移修复。
export const CHAT_CACHE_LIMIT = 60;
export const CHAT_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 160 * 1024;

function storageKey(accountScope, companionScope) {
  const account = String(accountScope || "").trim();
  const companion = String(companionScope || "").trim();
  if (!account) return "";
  return `dengta.chat-cache.v${CHAT_CACHE_VERSION}:${account}:${companion || "-"}`;
}

function safeStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * 决定「这一行有多高」的字段必须保留，否则预览行比真实行矮，
 * 替换瞬间整个列表被撑高、可见内容位移——实测 CLS 0.1159 就是这么来的。
 *
 * 实测真实消息里影响行高的有：
 *   - visible_monologue（心声卡片）
 *   - tool_calls.music_card（一起听歌的歌曲卡片）
 *   - tool_calls 里 co_watch_* / notification_kind（一起看提示）
 * 而 processing_stages / resolved_model / response_mode 这类只影响内部逻辑，
 * 不产生可见高度，可以丢。
 */
const KEPT_TOOL_CALL_KEYS = Object.freeze([
  "music_card",
  "is_co_watch",
  "co_watch_session_id",
  "co_watch_quick_reply",
  "notification_kind",
  "message_kind",
  "partial_reply",
  "refusal_detected",
  "art_alt",
  "artwork_id",
]);

/** 只保留展示真正需要的字段，避免把整段工具结果塞进缓存。 */
function trimMessage(message) {
  if (!message || typeof message !== "object") return null;
  // 注意：后端返回的 id 是**数字**（4572），不是 UUID 字符串。
  // 早先这里只接受字符串，导致真机上 43 条消息全部被丢弃、缓存永远写不进去。
  const rawId = message.id;
  const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() : "";
  const role = message.role === "user" ? "user" : "assistant";
  const content = typeof message.content === "string" ? message.content : "";
  if (!id || (!content && !message.tool_calls)) return null;
  const trimmed = { id, role, content };
  if (message.created_at) trimmed.created_at = message.created_at;
  // 心声卡片会显著改变行高，必须留着，否则预览和真实行高对不上。
  if (typeof message.visible_monologue === "string" && message.visible_monologue) {
    trimmed.visible_monologue = message.visible_monologue;
  }
  if (message.tool_calls && typeof message.tool_calls === "object") {
    const light = {};
    for (const key of KEPT_TOOL_CALL_KEYS) {
      const value = message.tool_calls[key];
      if (value !== undefined) light[key] = value;
    }
    if (Object.keys(light).length) trimmed.tool_calls = light;
  }
  return trimmed;
}

/**
 * 诊断信息：写失败时记录原因。
 * 真机排查用——缓存静默失败过一次，靠它才定位到「消息里带了不可序列化的东西」。
 */
export const lastCacheWriteDiagnostic = { reason: "", stage: "", at: 0 };

function markFailure(stage, reason) {
  lastCacheWriteDiagnostic.stage = stage;
  lastCacheWriteDiagnostic.reason = String(reason || "").slice(0, 160);
  lastCacheWriteDiagnostic.at = Date.now();
  // 便于真机排查：写失败时把原因挂到 window 上（只读诊断，不含消息内容）。
  try {
    globalThis.__chatCacheDiagnostic = { stage, reason: lastCacheWriteDiagnostic.reason };
  } catch {
    // 某些环境下 globalThis 不可写，诊断信息跳过即可，不影响缓存逻辑。
  }
  return false;
}

export function writeChatHistoryCache({ accountScope, companionScope, sessionId, messages, storage, now = Date.now() }) {
  try {
    const target = safeStorage(storage);
    const key = storageKey(accountScope, companionScope);
    if (!target || !key) return markFailure("scope", "no storage or scope");
    if (!sessionId || !Array.isArray(messages)) return markFailure("input", `sessionId=${Boolean(sessionId)} isArray=${Array.isArray(messages)}`);

    const trimmed = messages.map(trimMessage).filter(Boolean).slice(-CHAT_CACHE_LIMIT);
    if (!trimmed.length) return markFailure("trim", `all ${messages.length} messages were dropped`);

    let payload = { version: CHAT_CACHE_VERSION, sessionId, savedAt: now, messages: trimmed };
    let serialized;
    try {
      serialized = JSON.stringify(payload);
    } catch (error) {
      return markFailure("stringify", error?.message || error);
    }
    // 超体积就从最早的消息开始丢，直到塞得下。
    while (serialized.length > MAX_BYTES && payload.messages.length > 1) {
      payload = { ...payload, messages: payload.messages.slice(Math.ceil(payload.messages.length / 4)) };
      serialized = JSON.stringify(payload);
    }
    if (serialized.length > MAX_BYTES) return markFailure("size", `${serialized.length} bytes`);

    target.setItem(key, serialized);
    lastCacheWriteDiagnostic.stage = "ok";
    lastCacheWriteDiagnostic.reason = "";
    lastCacheWriteDiagnostic.at = Date.now();
    return true;
  } catch (error) {
    return markFailure("unexpected", error?.message || error);
  }
}

export function readChatHistoryCache({ accountScope, companionScope, storage, now = Date.now() }) {
  const target = safeStorage(storage);
  const key = storageKey(accountScope, companionScope);
  if (!target || !key) return null;
  let raw;
  try {
    raw = target.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || parsed.version !== CHAT_CACHE_VERSION) return null;
  if (typeof parsed.sessionId !== "string" || !parsed.sessionId) return null;
  if (!Array.isArray(parsed.messages) || !parsed.messages.length) return null;
  if (!Number.isFinite(parsed.savedAt) || now - parsed.savedAt > CHAT_CACHE_MAX_AGE_MS) return null;
  const messages = parsed.messages.map(trimMessage).filter(Boolean);
  if (!messages.length) return null;
  return { sessionId: parsed.sessionId, savedAt: parsed.savedAt, messages };
}

export function clearChatHistoryCache({ accountScope, companionScope, storage }) {
  const target = safeStorage(storage);
  const key = storageKey(accountScope, companionScope);
  if (!target || !key) return false;
  try {
    target.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
