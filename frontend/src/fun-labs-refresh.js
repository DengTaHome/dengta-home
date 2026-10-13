import { CHAT_ERROR_FEEDBACK } from "./chat-error-feedback.js";

export const FUN_LABS_SECTIONS = Object.freeze(["dates", "achievements", "shots"]);
export const FUN_LABS_ERROR_FEEDBACK = Object.freeze({
  daily_shots_read_failed: { reason: "服务器未能读取每日照片。", action: "先重试读取，持续失败时查看脱敏日志；无需重新上传照片。" },
  daily_shots_recent_failed: { reason: "服务器未能读取近期照片。", action: "重试读取，持续失败时查看脱敏日志。" },
  shots_load_failed: { reason: "照片读取请求失败，具体原因尚未确认。", action: "检查连接并重试读取，再通过日志核对错误。" },
  dates_load_failed: { reason: "纪念日读取请求失败，具体原因尚未确认。", action: "重试读取，持续失败时查看脱敏日志。" },
  achievements_load_failed: { reason: "成就读取请求失败，具体原因尚未确认。", action: "重试成就读取，其他栏目可以继续使用。" },
  shots_receipt_invalid: { reason: "照片接口未返回完整的数据回执。", action: "重试读取并查看日志，无需重复上传。" },
  dates_receipt_invalid: { reason: "纪念日接口未返回完整的数据回执。", action: "重试读取并查看日志，暂勿重复创建记录。" },
  achievements_receipt_invalid: { reason: "成就接口未返回完整的数据回执。", action: "重试读取并查看日志，暂勿重复提交成就。" },
  request_timeout: { reason: "请求在等待时间内没有完成。", action: "检查连接后重试读取；删除超时时先刷新核对结果。" },
  special_dates_missing: { reason: "服务器未找到这条纪念日，可能已被删除。", action: "先刷新核对列表，暂勿重复删除。" },
  special_dates_delete_receipt_invalid: { reason: "删除接口未返回匹配的记录回执。", action: "先刷新核对服务器结果，暂勿重复删除。" },
  special_dates_delete_failed: { reason: "纪念日删除请求失败，结果尚未确认。", action: "先刷新核对列表，再通过日志检查具体原因。" },
});
const REQUESTS = Object.freeze({
  dates: ["/api/v2/special-dates", 12_000],
  achievements: ["/api/v2/fun-labs/achievements", 20_000],
  shots: ["/api/v2/fun-labs/daily-shots", 12_000],
});

export function emptyFunLabsState() {
  return { status: "idle", dates: [], achievements: [], shots: { today: null, recent: [] },
    sections: Object.fromEntries(FUN_LABS_SECTIONS.map(key => [key, { status: "idle", diagnostic: null }])) };
}

export function funLabsDiagnostic(error, fallback = "activity_load_failed", feedbackByCode = {}) {
  const code = Object.hasOwn(FUN_LABS_ERROR_FEEDBACK, error?.code) || Object.hasOwn(CHAT_ERROR_FEEDBACK, error?.code) || Object.hasOwn(feedbackByCode, error?.code) ? error.code : fallback;
  const logId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(error?.error_log_id || "") ? error.error_log_id : undefined;
  const status = value => Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
  return { error_code: code, error_log_id: logId, error_source: "dengta", http_status: status(error?.status), upstream_status: status(error?.upstream_status) };
}

function validRows(rows, identity) {
  return Array.isArray(rows) && rows.every(row => row && typeof row === "object" && typeof (row[identity] || row.id) === "string" && (row[identity] || row.id).length > 0 && typeof row.title === "string");
}

function sectionValue(key, data) {
  if (key === "dates" && validRows(data?.dates, "id") && data.dates.every(row => typeof row.event_date === "string")) return data.dates;
  if (key === "achievements" && Array.isArray(data?.achievements)
    && data.achievements.every(row => row && typeof row === "object" && !Array.isArray(row)
      && typeof row.code === "string" && row.code.trim().length > 0 && typeof row.title === "string" && typeof row.unlocked === "boolean")
    && new Set(data.achievements.map(row => row.code)).size === data.achievements.length) return data.achievements;
  if (key === "shots" && data && Object.hasOwn(data, "today") && Array.isArray(data.recent)
    && (data.today === null || (typeof data.today === "object" && typeof data.today.id === "string"))
    && data.recent.every(row => row && typeof row.id === "string")) return { today: data.today, recent: data.recent };
  throw Object.assign(new Error("Activity response is incomplete"), { code: `${key}_receipt_invalid` });
}

export async function removeFunDate({ id, token, currentToken, isMounted, lock, request, update, feedback, refresh }) {
  if (!isMounted() || currentToken() !== token || lock.current?.scope === token) return;
  const operation = { scope: token, id, status: "busy" };
  lock.current = operation;
  feedback(operation);
  const current = () => isMounted() && currentToken() === token;
  try {
    const result = await request(`/api/v2/special-dates/${encodeURIComponent(id)}`, { method: "DELETE", timeoutMs: 12_000 });
    if (!current()) return;
    if (result?.removed !== id) throw Object.assign(new Error("Missing deletion receipt"), { code: "special_dates_delete_receipt_invalid" });
    update(previous => current() && previous.scope === token ? { ...previous, dates: previous.dates.filter(date => date.id !== id) } : previous);
    feedback(null);
    await refresh(["dates"]);
  } catch (error) {
    if (current()) feedback({ scope: token, id, status: "error", diagnostic: funLabsDiagnostic(error, "special_dates_delete_failed") });
  } finally {
    if (lock.current === operation) lock.current = null;
  }
}

function overallStatus(sections) {
  const states = FUN_LABS_SECTIONS.map(key => sections[key]?.status || "idle");
  if (states.includes("busy")) return "busy";
  if (states.includes("error")) return states.includes("success") ? "partial" : "error";
  return states.includes("success") ? "success" : "idle";
}

export async function refreshFunLabsSections({ token, currentToken, isMounted, request, update, onAchievements, sections = FUN_LABS_SECTIONS }) {
  if (!isMounted() || currentToken() !== token) return;
  const selected = [...new Set(sections)].filter(key => FUN_LABS_SECTIONS.includes(key));
  const requestId = ++token.requestId;
  token.revisions ||= {};
  for (const key of selected) token.revisions[key] = requestId;
  const current = key => isMounted() && currentToken() === token && token.revisions[key] === requestId;
  const change = (keys, transform) => update(previous => {
    if (!isMounted() || currentToken() !== token) return previous;
    const base = previous.scope === token ? previous : emptyFunLabsState();
    let next = { ...base, scope: token, sections: { ...base.sections } };
    for (const key of keys) if (current(key)) next = transform(next, key);
    return { ...next, status: overallStatus(next.sections) };
  });
  change(selected, (state, key) => ({ ...state, sections: { ...state.sections, [key]: { status: "busy", diagnostic: null } } }));
  const results = await Promise.all(selected.map(async key => {
    try {
      const [path, timeoutMs] = REQUESTS[key];
      const value = sectionValue(key, await request(path, { timeoutMs }));
      if (!current(key)) return [key, "stale"];
      change([key], state => ({ ...state, [key]: value, sections: { ...state.sections, [key]: { status: "success", diagnostic: null } } }));
      if (key === "achievements" && current(key)) onAchievements?.(value);
      return [key, "success"];
    } catch (error) {
      if (!current(key)) return [key, "stale"];
      const diagnostic = funLabsDiagnostic(error, `${key}_load_failed`);
      change([key], state => ({ ...state, sections: { ...state.sections, [key]: { status: "error", diagnostic } } }));
      return [key, "error"];
    }
  }));
  return Object.fromEntries(results);
}
