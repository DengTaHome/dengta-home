import { describeOperationError } from "./operation-error-help.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HELP = {
  memory_summary_receipt_invalid: "记忆服务的确认信息不完整，此次结果尚未确认。",
  memory_summary_required: "记忆内容不能为空。",
  invalid_memory_id: "这条记忆的编号无效，请重新读取后核对。",
  memory_not_found: "当前账号和伴侣下找不到这条记忆，请重新读取后核对。",
  request_timeout: "等待记忆服务确认超时。",
};
const object = value => value && typeof value === "object" && !Array.isArray(value);

export function invalidMemorySummaryReceipt() {
  return Object.assign(new Error("记忆摘要回执无效。"), { code: "memory_summary_receipt_invalid" });
}

function memoryRecord(value) {
  return object(value) && typeof value.id === "string" && UUID.test(value.id) && typeof value.summary === "string" && value.confirmation_status === "confirmed";
}

export function memorySummaryListReceipt(data) {
  if (!object(data) || !Array.isArray(data.memories) || data.memories.some(value => !memoryRecord(value)) || new Set(data.memories.map(value => value.id.toLowerCase())).size !== data.memories.length) throw invalidMemorySummaryReceipt();
  return data.memories;
}

export function memorySummaryPatchReceipt(data, id, summary) {
  if (object(data) && data.deleted === true && data.reason === "memory_summary_rejected" && !Object.hasOwn(data, "memory")) return { deleted: true };
  if (!object(data) || Object.hasOwn(data, "deleted") || !memoryRecord(data.memory) || data.memory.id !== id || data.memory.summary !== summary) throw invalidMemorySummaryReceipt();
  return { memory: data.memory };
}

async function readFailure(response) {
  const data = await response.json().catch(() => ({}));
  const code = describeOperationError({ code: data?.code, status: response.status }).code;
  const error = Object.assign(new Error("记忆服务未完成此次请求。"), { code, status: response.status });
  if (UUID.test(data?.error_log_id || "")) error.error_log_id = data.error_log_id;
  throw error;
}

export async function readMemorySummaryJson(response) {
  if (!response.ok) return readFailure(response);
  if (response.status !== 200) throw invalidMemorySummaryReceipt();
  try { return await response.json(); } catch { throw invalidMemorySummaryReceipt(); }
}

export async function readMemorySummaryDelete(response) {
  if (!response.ok) return readFailure(response);
  if (response.status !== 204) throw invalidMemorySummaryReceipt();
  return { deleted: true };
}

export function memorySummaryFailure(error, mutation = false) {
  const detail = describeOperationError(error);
  return {
    code: detail.code,
    message: `${HELP[detail.code] || detail.reason}${mutation ? " 请先重新读取核对结果，避免重复保存或删除；你的输入仍然保留。" : ` ${detail.action}`}`,
    status: Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : null,
    logId: UUID.test(error?.error_log_id || "") ? error.error_log_id : null,
  };
}

export function formatMemorySummaryDate(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
