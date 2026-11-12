import { resolveAccountCacheStorage } from "./account-cache-vault.js";

export const MESSAGE_REFERENCE_FIELD = "message_reference";
export const MESSAGE_REFERENCE_TEXT_LIMIT = 600;
export const MESSAGE_REFERENCE_CACHE_KEY = "dengta_message_references_v1";

const MESSAGE_REFERENCE_CACHE_LIMIT = 500;
const MESSAGE_REFERENCE_ID_LIMIT = 19;
const ATTACHMENT_NAME_LIMIT = 120;
const ATTACHMENT_TYPE_LIMIT = 120;
const ATTACHMENT_PREVIEW_LIMIT = 4;
const POSTGRES_BIGINT_MAX = 9223372036854775807n;

function cleanText(value, limit) {
  return Array.from(String(value || "").replace(/\s+/g, " ").trim())
    .slice(0, limit)
    .join("");
}

function normalizeRole(value) {
  return value === "user" || value === "assistant" ? value : "";
}

function normalizeMessageId(value) {
  const source = cleanText(value, MESSAGE_REFERENCE_ID_LIMIT);
  if (!/^[1-9]\d{0,18}$/.test(source)) return "";
  try {
    return BigInt(source) <= POSTGRES_BIGINT_MAX ? source : "";
  } catch {
    return "";
  }
}

function sourceAttachments(message = {}) {
  const attachments = message.attachments || message.files;
  return Array.isArray(attachments) ? attachments : [];
}

function normalizeAttachmentSummary(value) {
  const count = Math.max(0, Number(value?.count) || 0);
  const items = Array.from(value?.items || [])
    .slice(0, ATTACHMENT_PREVIEW_LIMIT)
    .map((item) => {
      const name = cleanText(item?.name, ATTACHMENT_NAME_LIMIT);
      const type = cleanText(item?.type, ATTACHMENT_TYPE_LIMIT);
      return name || type ? { name: name || "附件", type } : null;
    })
    .filter(Boolean);
  const normalizedCount = Math.max(count, items.length);
  return normalizedCount > 0 ? { count: normalizedCount, items } : null;
}

export function createMessageReference(message = {}) {
  const messageId = normalizeMessageId(message.id);
  const role = normalizeRole(message.role);
  const rawText = String(message.content || "").replace(/\s+/g, " ").trim();
  const text = cleanText(rawText, MESSAGE_REFERENCE_TEXT_LIMIT);
  const attachments = sourceAttachments(message);
  const attachmentSummary = normalizeAttachmentSummary({
    count: attachments.length,
    items: attachments.map((item) => {
      const file = item?.file || item || {};
      return {
        name: item?.name || file.name || "附件",
        type:
          item?.media_type ||
          item?.mime_type ||
          item?.type ||
          file.type ||
          "",
      };
    }),
  });

  if (!messageId || !role || (!text && !attachmentSummary)) return null;
  return {
    message_id: messageId,
    role,
    text,
    text_truncated:
      Array.from(rawText).length > MESSAGE_REFERENCE_TEXT_LIMIT,
    attachment_summary: attachmentSummary,
  };
}

export function normalizeMessageReference(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const messageId = normalizeMessageId(value.message_id);
  const role = normalizeRole(value.role);
  const text = cleanText(value.text, MESSAGE_REFERENCE_TEXT_LIMIT);
  const attachmentSummary = normalizeAttachmentSummary(
    value.attachment_summary,
  );
  if (!messageId || !role || (!text && !attachmentSummary)) return null;
  return {
    message_id: messageId,
    role,
    text,
    text_truncated:
      value.text_truncated === true ||
      Array.from(String(value.text || "")).length >
        MESSAGE_REFERENCE_TEXT_LIMIT,
    attachment_summary: attachmentSummary,
  };
}

export function messageCanBeReferenced(message = {}) {
  return message.isStreaming !== true && Boolean(createMessageReference(message));
}

export function longPressMovementExceeded(
  startX,
  startY,
  endX,
  endY,
  threshold = 12,
) {
  return (
    Math.hypot(
      Number(endX) - Number(startX),
      Number(endY) - Number(startY),
    ) > threshold
  );
}

export function messageReferenceFromMessage(message = {}) {
  return normalizeMessageReference(
    message?.tool_calls?.[MESSAGE_REFERENCE_FIELD],
  );
}

export function attachMessageReference(message, reference) {
  const normalized = normalizeMessageReference(reference);
  if (!normalized) return message;
  return {
    ...message,
    tool_calls: {
      ...(message?.tool_calls || {}),
      [MESSAGE_REFERENCE_FIELD]: normalized,
    },
  };
}

function cacheEntryKey(sessionId, messageId) {
  const session = cleanText(sessionId, MESSAGE_REFERENCE_ID_LIMIT);
  const message = cleanText(messageId, MESSAGE_REFERENCE_ID_LIMIT);
  return session && message ? `${session}\u001f${message}` : "";
}

function readReferenceCache(storage) {
  try {
    storage = resolveAccountCacheStorage(storage);
    const parsed = JSON.parse(
      storage?.getItem(MESSAGE_REFERENCE_CACHE_KEY) || "{}",
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function writeReferenceCache(cache, storage) {
  try {
    storage = resolveAccountCacheStorage(storage);
    const entries = Object.entries(cache)
      .filter(([, item]) => normalizeMessageReference(item?.reference))
      .sort(
        ([, left], [, right]) =>
          Number(right?.saved_at || 0) - Number(left?.saved_at || 0),
      )
      .slice(0, MESSAGE_REFERENCE_CACHE_LIMIT);
    if (entries.length > 0) {
      storage?.setItem(
        MESSAGE_REFERENCE_CACHE_KEY,
        JSON.stringify(Object.fromEntries(entries)),
      );
    } else {
      storage?.removeItem(MESSAGE_REFERENCE_CACHE_KEY);
    }
  } catch {
    // The server contract still carries the snapshot when device storage fails.
  }
}

export function storeMessageReferenceForMessage(
  sessionId,
  messageId,
  reference,
  storage,
) {
  const key = cacheEntryKey(sessionId, messageId);
  const normalized = normalizeMessageReference(reference);
  if (!key || !normalized) return normalized;
  const cache = readReferenceCache(storage);
  cache[key] = { reference: normalized, saved_at: Date.now() };
  writeReferenceCache(cache, storage);
  return normalized;
}

export function applyStoredMessageReferences(
  messages,
  sessionId,
  storage,
) {
  const cache = readReferenceCache(storage);
  return Array.from(messages || []).map((message) => {
    if (messageReferenceFromMessage(message)) return message;
    const key = cacheEntryKey(sessionId, message?.id);
    return key && cache[key]?.reference
      ? attachMessageReference(message, cache[key].reference)
      : message;
  });
}

export function clearStoredMessageReferencesForSession(
  sessionId,
  storage,
) {
  const prefix = `${cleanText(sessionId, MESSAGE_REFERENCE_ID_LIMIT)}\u001f`;
  if (prefix === "\u001f") return;
  const cache = readReferenceCache(storage);
  Object.keys(cache).forEach((key) => {
    if (key.startsWith(prefix)) delete cache[key];
  });
  writeReferenceCache(cache, storage);
}
