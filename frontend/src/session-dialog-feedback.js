import { describeOperationError } from "./operation-error-help.js";

export const MAX_SESSION_TITLE = 60;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const invalidReceipt = () => Object.assign(new Error("会话操作回执不完整。"), { code: "session_receipt_invalid" });

async function readFailure(response) {
  const data = await response.json().catch(() => ({}));
  const error = Object.assign(new Error("会话操作未确认。"), { code: "session_request_failed", status: response.status });
  if (UUID.test(data?.error_log_id || "")) error.error_log_id = data.error_log_id;
  throw error;
}

export async function readSessionRename(response, id, title) {
  if (!response.ok) return readFailure(response);
  const data = await response.json().catch(() => null);
  const item = data?.session;
  if (response.status !== 200 || !item || item.id !== id || item.title !== title || !UUID.test(item.id)) throw invalidReceipt();
  return { id: item.id, title: item.title, ...(typeof item.model_id === "string" || item.model_id === null ? { model_id: item.model_id } : {}),
    ...(typeof item.created_at === "string" ? { created_at: item.created_at } : {}), ...(typeof item.updated_at === "string" ? { updated_at: item.updated_at } : {}) };
}

export async function readSessionDelete(response) {
  if (!response.ok) return readFailure(response);
  if (response.status !== 204) throw invalidReceipt();
  return null;
}

export function sessionDialogFailure(error = {}) {
  const detail = describeOperationError(error);
  const reason = error.code === "session_receipt_invalid" ? "服务器没有返回匹配的会话操作确认。"
    : error.code === "request_timeout" ? "会话服务没有及时返回确认。"
    : Number(error.status) === 404 ? "当前账号或伴侣中没有找到这个对话。"
    : `${detail.reason}${detail.action}`;
  const status = Number(error.status);
  return `${reason} 输入和本地记录已保留。请先刷新页面核对结果，再决定是否重试。（错误代码：${detail.code}${Number.isInteger(status) && status >= 400 && status <= 599 ? ` · HTTP ${status}` : ""}${UUID.test(error.error_log_id || "") ? ` · 日志 ${error.error_log_id}` : ""}）`;
}
