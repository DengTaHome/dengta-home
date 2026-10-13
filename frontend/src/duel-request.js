import { describeOperationError } from "./operation-error-help.js";

function receiptError(code) {
  return Object.assign(new Error("互动挑战没有收到可确认的回合结果。"), { code });
}

export function assertDuelNarration(data, turn) {
  if (data?.refused === true) throw receiptError(data.refusal_code === "provider_error_document" ? "provider_error_document" : "provider_boundary_residue");
  const valid = data !== null && typeof data === "object" && !Array.isArray(data) &&
    data.ok === true && typeof data.narration === "string" && typeof data.reaction === "string" &&
    (turn.winner ? data.companion_skill === null : turn.availableCompanionSkills.includes(data.companion_skill));
  if (!valid) throw receiptError("duel_response_invalid");
  if (!data.narration.trim()) throw receiptError("duel_narration_missing");
  return data;
}

export function awaitDuelResponse(request, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  // apiRequest's header deadline does not cover an unresponsive response.json().
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => finish(reject, signal.reason || new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(request).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

export function duelFailureFeedback(error) {
  const { code, reason, action } = describeOperationError(error);
  const local = {
    duel_response_invalid: "模型接口返回的回合信息不完整或招式不匹配。请核对接口兼容性后，重试这一招。",
    duel_narration_missing: "模型接口没有返回本回合正文。请检查当前接口和模型是否已配置，再重试这一招。",
    duel_request_timeout: "本回合等待模型超过 90 秒。请检查网络或模型接口状态，再重试这一招。",
  };
  const status = Number(error?.status);
  const logId = String(error?.error_log_id || "");
  return {
    code,
    message: local[code] || `${reason}${action}`,
    status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : null,
    logId: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(logId) ? logId : null,
  };
}
