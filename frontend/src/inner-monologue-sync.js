import { apiRequest } from "./api.js";
import { hydrateChatHistory } from "./chat-history.js";
import { applyStoredMessageReferences } from "./message-reference.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_RECOVERY_ATTEMPTS = 3;
const DEFAULT_RECOVERY_DELAY_MS = 160;

function wait(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function normalizedText(value) {
  return String(value || "").trim();
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isSynchronizedChatMessage(message = {}) {
  return UUID_PATTERN.test(String(message?.id || ""));
}

export function findSynchronizedAssistantMessage(
  localMessage = {},
  synchronizedMessages = [],
) {
  if (isSynchronizedChatMessage(localMessage)) return localMessage;

  const localText = normalizedText(localMessage?.content);
  const localTime = timestamp(localMessage?.created_at);
  const candidates = (Array.isArray(synchronizedMessages)
    ? synchronizedMessages
    : []
  ).filter(
    (message) =>
      message?.role === "assistant" && isSynchronizedChatMessage(message),
  );
  const exactText = localText
    ? candidates.filter(
        (message) => normalizedText(message?.content) === localText,
      )
    : [];
  const pool = exactText;
  if (pool.length === 0) return null;

  const closest = [...pool].sort((left, right) => {
    if (!localTime) {
      return timestamp(right?.created_at) - timestamp(left?.created_at);
    }
    return (
      Math.abs(timestamp(left?.created_at) - localTime) -
      Math.abs(timestamp(right?.created_at) - localTime)
    );
  })[0];
  if (!closest) return null;

  const maximumDistanceMs = 10 * 60_000;
  if (
    localTime &&
    Math.abs(timestamp(closest?.created_at) - localTime) > maximumDistanceMs
  ) {
    return null;
  }
  return closest;
}

export async function recoverSynchronizedAssistantMessage({
  message,
  sessionId,
  loadMessages = async () => {
    const history = await apiRequest(`/api/v2/sessions/${sessionId}/messages`);
    return applyStoredMessageReferences(
      hydrateChatHistory(history.messages),
      sessionId,
    );
  },
  attempts = DEFAULT_RECOVERY_ATTEMPTS,
  retryDelayMs = DEFAULT_RECOVERY_DELAY_MS,
  waitForRetry = wait,
} = {}) {
  const pending = "回复同步中，请稍后再试。";
  if (!sessionId) return { message: null, messages: null, error: pending };
  if (isSynchronizedChatMessage(message)) {
    return { message, messages: null };
  }
  try {
    let messages = [];
    const maximumAttempts = Math.max(1, Number(attempts) || 1);
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      if (attempt > 1 && retryDelayMs > 0) {
        await waitForRetry(retryDelayMs);
      }
      messages = await loadMessages(sessionId);
      const recovered = findSynchronizedAssistantMessage(message, messages);
      if (recovered) {
        return { message: recovered, messages, error: "" };
      }
    }
    return { message: null, messages, error: pending };
  } catch (cause) {
    return { message: null, messages: null, error: pending, cause };
  }
}
