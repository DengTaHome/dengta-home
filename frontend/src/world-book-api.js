import { apiRequest } from "./api.js";

const ERROR_MESSAGES = Object.freeze({
  world_book_content_required: "请填写世界书正文。",
  world_book_body_invalid: "世界书内容格式无效，请检查后重试。",
  world_book_id_invalid: "世界书条目标识无效，请刷新后重试。",
  world_book_keywords_invalid: "关键词格式无效，请重新填写。",
  world_book_enabled_invalid: "启用状态无效。",
  world_book_constant_invalid: "常驻状态无效。",
  world_book_case_sensitive_invalid: "大小写匹配状态无效。",
  world_book_priority_invalid: "优先级必须是 -100000 到 100000 之间的整数。",
  world_book_sort_order_invalid: "排序值必须是整数。",
  world_book_match_mode_invalid: "关键词匹配方式无效。",
  world_book_position_invalid: "上下文位置无效。",
  world_book_entry_not_found: "这条世界书已不存在，请刷新后重试。",
  world_book_update_empty: "没有需要保存的修改。",
  world_book_reorder_invalid: "世界书排序请求无效。",
  world_book_limit_invalid: "分页数量无效，请刷新后重试。",
  world_book_offset_invalid: "分页位置无效，请刷新后重试。",
  authentication_required: "登录状态已失效，请重新登录。",
});

const defaultClient = { apiRequest };

function worldBookError(source, fallback) {
  const code = String(source?.code || "").toLowerCase();
  const error = new Error(ERROR_MESSAGES[code] || String(source?.message || source?.detail || "").trim() || fallback, {
    cause: source instanceof Error ? source : undefined,
  });
  error.code = source?.code || "world_book_request_failed";
  error.status = source?.status;
  return error;
}

async function request(path, options, client) {
  try {
    return await client.apiRequest(path, options);
  } catch (error) {
    throw worldBookError(error, "世界书请求失败，请稍后重试。");
  }
}

export function listWorldBookEntries(filters = {}, client = defaultClient) {
  const query = new URLSearchParams();
  if (filters.search) query.set("search", String(filters.search));
  if (typeof filters.enabled === "boolean") query.set("enabled", String(filters.enabled));
  if (typeof filters.constant === "boolean") query.set("constant", String(filters.constant));
  if (filters.position) query.set("position", String(filters.position));
  query.set("limit", String(filters.limit ?? 20));
  query.set("offset", String(filters.offset ?? 0));
  return request(`/api/v2/world-book/?${query.toString()}`, undefined, client);
}

export function createWorldBookEntry(payload, client = defaultClient) {
  return request("/api/v2/world-book/", {
    method: "POST",
    body: JSON.stringify(payload),
  }, client);
}

export function updateWorldBookEntry(entryId, payload, client = defaultClient) {
  return request(`/api/v2/world-book/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }, client);
}

export function deleteWorldBookEntry(entryId, client = defaultClient) {
  return request(`/api/v2/world-book/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
  }, client);
}

export function reorderWorldBookEntries(entries, client = defaultClient) {
  return request("/api/v2/world-book/reorder", {
    method: "POST",
    body: JSON.stringify({ entries }),
  }, client);
}
