import { CHAT_ERROR_FEEDBACK } from "./chat-error-feedback.js";
import { describeOperationError } from "./operation-error-help.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";

export async function withAchievementDeadline(options, work, timeoutMs = 12_000) {
  const controller = new AbortController();
  const parentSignal = options.signal;
  const forwardAbort = () => controller.abort(parentSignal.reason);
  if (parentSignal?.aborted) forwardAbort();
  else parentSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timeoutError = Object.assign(new Error("Achievement confirmation timed out"), { code: "request_timeout" });
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason || new DOMException("Cancelled", "AbortError")); });
  controller.signal.addEventListener("abort", rejectAbort, { once: true });
  const timer = globalThis.setTimeout(() => controller.abort(timeoutError), timeoutMs);
  const session = options.authSession ? createScopedSettingsSession(options.authSession, settingsSaveScope(options.authSession.getSnapshot()), controller.signal) : undefined;
  try {
    controller.signal.throwIfAborted();
    return await Promise.race([work({ ...options, signal: controller.signal, ...(session ? { authSession: session } : {}) }), aborted]);
  } finally {
    globalThis.clearTimeout(timer);
    parentSignal?.removeEventListener("abort", forwardAbort);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}

export const ACHIEVEMENT_ERROR_FEEDBACK = Object.freeze({
  achievements_receipt_invalid: { reason: "成就接口没有返回匹配的完整回执，操作结果尚未确认。", action: "先刷新成就列表核对，暂勿重复添加、领取或删除。" },
  achievement_missing: { reason: "服务器未找到这份自定义成就，可能已被删除。", action: "先刷新列表核对当前账号和伴侣。" },
  onboarding_first_chat_required: { reason: "服务器尚未记录第一次完成的对话。", action: "完成一次对话后刷新成就，再领取入门纪念。" },
  achievements_input_too_long: { reason: "名称、完成条件或图标超过了成就字段容量。", action: "名称最多 40 字、完成条件最多 120 字、图标最多 4 个字符；原草稿仍保留。" },
  achievements_write_unconfirmed: { reason: "成就操作没有完成确认，现有回执无法指出具体原因。", action: "先刷新列表核对结果，避免重复添加、领取或删除；持续失败时查看脱敏日志。" },
  achievements_refresh_failed: { reason: "成就操作已确认，列表读取没有成功。", action: "只需刷新列表核对，不要再次提交同一操作。" },
});

function unlockedReceipt(value, code) {
  return value?.code === code && (value.unlocked === true || value.already === true);
}

export function validateAchievementReceipt(kind, data, identity) {
  const valid = kind === "create"
    ? typeof data?.achievement?.id === "string" && data.achievement.id.length > 0
      && typeof data.achievement.code === "string" && data.achievement.code.startsWith("custom:")
      && typeof data.achievement.title === "string" && data.achievement.title.length > 0
    : kind === "delete" ? data?.removed === identity
      : kind === "unlock" ? unlockedReceipt(data?.unlocked, identity)
        : kind === "onboarding" && unlockedReceipt(data?.unlocked, "onboarding_1")
          && Array.isArray(data?.achievements) && data.achievements.every(item => item && typeof item.code === "string" && typeof item.title === "string" && typeof item.unlocked === "boolean")
          && ["first_chat", "onboarding_1"].every(code => data.achievements.some(item => item.code === code && item.unlocked === true));
  if (!valid) throw Object.assign(new Error("Achievement receipt is incomplete"), { code: "achievements_receipt_invalid" });
  return data;
}

export function achievementFailure(error, saved = false) {
  const rawCode = error?.code;
  const code = Object.hasOwn(ACHIEVEMENT_ERROR_FEEDBACK, rawCode) || Object.hasOwn(CHAT_ERROR_FEEDBACK, rawCode)
    ? rawCode : saved ? "achievements_refresh_failed" : "achievements_write_unconfirmed";
  const help = ACHIEVEMENT_ERROR_FEEDBACK[code] || describeOperationError({ code, status: error?.status });
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : undefined;
  const authHelp = [401, 403].includes(status) ? describeOperationError({ code, status }) : help;
  const logId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(error?.error_log_id || "") ? error.error_log_id : undefined;
  return {
    message: `${saved ? "成就已保存，列表刷新失败。" : "成就操作结果尚未确认。"}${authHelp.reason} ${authHelp.action} 错误代码：${code}${status ? ` · HTTP ${status}` : ""}`,
    diagnostic: { error_code: code, error_source: "dengta", http_status: status, error_log_id: logId },
  };
}
