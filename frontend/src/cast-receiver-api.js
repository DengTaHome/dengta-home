const API_BASE_URL = (
  import.meta.env?.VITE_API_URL || "http://localhost:3000"
).replace(/\/$/, "");

export const RECEIVER_TOKEN_KEY = "dengta.cast.receiver-token.v1";
export const RECEIVER_REQUEST_TIMEOUT_MS = 15_000;

function cleanText(value, maximum = 180) {
  return Array.from(String(value || "").trim()).slice(0, maximum).join("");
}

async function receiverRequest(path, { method = "GET", body, token = "", signal } = {}) {
  const headers = new Headers({ Accept: "application/json" });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(Object.assign(new Error("接收端请求超时。"), { code: "cast_receiver_request_timeout" })), RECEIVER_REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason || new DOMException("已取消", "AbortError")); });
  controller.signal.addEventListener("abort", rejectAbort, { once: true });
  try {
    controller.signal.throwIfAborted();
    const operation = async () => {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = response.status === 204 ? null : await response.json().catch(() => ({}));
      controller.signal.throwIfAborted();
      if (!response.ok) {
        const error = new Error(cleanText(data?.message, 300) || "接收端暂时无法连接服务。");
        error.status = response.status;
        error.code = cleanText(data?.code, 80) || "cast_receiver_request_failed";
        throw error;
      }
      return data;
    };
    return await Promise.race([operation(), aborted]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}

export function storeReceiverToken(storage, token) {
  const value = cleanText(token, 2048);
  try { if (value) storage?.setItem(RECEIVER_TOKEN_KEY, value); } catch { /* 当前页面仍可使用内存中的凭据。 */ }
  return value;
}

export function readReceiverToken(storage) {
  try { return cleanText(storage?.getItem(RECEIVER_TOKEN_KEY), 2048); } catch { return ""; }
}

export function clearReceiverToken(storage) {
  try { storage?.removeItem(RECEIVER_TOKEN_KEY); } catch { /* 浏览器禁止存储时仍可结束本页会话。 */ }
}

export async function pairCastReceiver(sessionId, pairingCode, receiverName, { signal } = {}) {
  return receiverRequest("/api/v2/cast/pair", {
    method: "POST",
    signal,
    body: {
      session_id: cleanText(sessionId, 80),
      pairing_code: cleanText(pairingCode, 20),
      receiver_name: cleanText(receiverName, 100),
    },
  });
}

export function readCastReceiverSession(token, { signal } = {}) {
  return receiverRequest("/api/v2/cast/session", { token, signal });
}

export function acknowledgeCastReceiver(token, input = {}, { signal } = {}) {
  return receiverRequest("/api/v2/cast/ack", {
    method: "POST",
    token,
    signal,
    body: {
      revision: Number(input.revision) || 0,
      sequence: Math.max(0, Number(input.sequence) || 0),
      state: input.playbackState === "playing" ? "playing" : "paused",
      position_seconds: Math.max(0, Number(input.mediaPositionSeconds) || 0),
      event: cleanText(input.event, 40) || "heartbeat",
    },
  });
}
