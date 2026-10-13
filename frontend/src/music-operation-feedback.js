import { publicChatErrorMessage } from "./chat-errors.js";

export function musicErrorMessage(error, fallback) {
  const message = publicChatErrorMessage({
    message: error?.message || fallback,
    code: error?.code || "music_operation_failed",
    error_source: error?.error_source,
    provider_code: error?.provider_code,
    provider_phase: error?.provider_phase,
    upstream_status: error?.upstream_status || error?.status,
    error_location: error?.error_location,
    error_log_id: error?.error_log_id,
  }, fallback);
  const visible = error?.error_source === "dengta" ? message : message.replace("；来源 / Source: dengta", "");
  const code = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error?.code || "") ? error.code : "music_operation_failed";
  return visible.includes("（错误代码 / Code:") ? visible : `${visible}（错误代码 / Code: ${code}）`;
}

export async function runMusicTask(scope, key, action, callbacks = {}) {
  const token = scope.begin(key, { replace: callbacks.replace === true });
  if (!token) return { ok: false, cancelled: true };
  try {
    callbacks.onStart?.();
    const value = await action(token);
    if (!scope.current(token)) return { ok: false, cancelled: true };
    await callbacks.onSuccess?.(value, token);
    return { ok: true, value };
  } catch (error) {
    if (scope.current(token)) callbacks.onError?.(error);
    return { ok: false, error };
  } finally {
    scope.finish(token);
    if (scope.current(token)) callbacks.onFinish?.();
  }
}
