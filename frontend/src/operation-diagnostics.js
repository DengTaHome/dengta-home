const rows = new Map();
const listeners = new Set();
let sequence = 0;
export const DIAGNOSTIC_OPERATIONS = [
  { prefix: "/api/errors", code: "DT-LOGS", label: "错误日志", source: "App.jsx / ChatErrorLog.jsx · 日志读取与回执" },
  { prefix: "/companion/inner-monologue", code: "DT-MONOLOGUE", label: "心声补充", source: "App.jsx · 心声补充与回执" },
  { prefix: "/api/v2/intimate-duel", code: "DT-DUEL", label: "互动挑战", source: "IntimateDuel.jsx · 回合生成与回执" },
  { prefix: "/api/v2/workspace", code: "DT-WORKSPACE", label: "工作区", source: "WorkspaceManager.jsx · 文件读写与回执" },
  { prefix: "/api/v2/memory/health", code: "DT-MEMORY", label: "Kiwi 连接", source: "MemoryGatewayStatus.jsx · 连接与租户回执" },
  { prefix: "/api/v2/memories", code: "DT-SUMMARIES", label: "对话摘要", source: "LocalMemorySummaries.jsx · 摘要读写与回执" },
  { prefix: "/api/v2/takeout", code: "DT-TAKEOUT", label: "外卖", source: "takeout-executor.js · 原生执行 / 回执同步" },
  { prefix: "/api/v2/fun-labs/achievements", code: "DT-ACHIEVEMENTS", label: "成就", source: "App.jsx · refreshFunLabs / 成就操作" },
  { prefix: "/api/v2/fun-labs/onboarding", code: "DT-GUIDE", label: "入门纪念", source: "App.jsx · completeOnboarding" },
  { prefix: "/api/v2/fun-labs/interests", code: "DT-DISCOVERY", label: "兴趣档案", source: "discovery-feed.js · 兴趣读取与回执" },
  { prefix: "/api/v2/fun-labs/recommend", code: "DT-DISCOVERY", label: "视频推荐", source: "discovery-feed.js · 推荐读取与回执" },
  { prefix: "/api/v2/sessions", code: "DT-SESSIONS", label: "聊天记录", source: "App.jsx · 会话加载与重命名/删除回执" },
  { prefix: "/api/v2/settings", code: "DT-SETTINGS", label: "设置", source: "App.jsx · 设置读写" },
  { prefix: "/api/v2/moments", code: "DT-MOMENTS", label: "动态", source: "App.jsx · 动态操作" },
  { prefix: "/api/mcp", code: "DT-MCP", label: "外部连接", source: "McpDeviceCenter.jsx / ExternalMemoryConnections.jsx" },
  { prefix: "/api/v2/co-watch", code: "DT-WATCH", label: "一起看", source: "co-watch.js" },
  { prefix: "/api/external-memory", code: "DT-MCP", label: "外部记忆", source: "ExternalMemoryConnections.jsx" },
  { prefix: "/api/v2/music", code: "DT-MUSIC", label: "音乐", source: "music-listening.js" },
];
const FALLBACK = { code: "DT-API", label: "接口请求", source: "api.js · apiRequest" };
const EMPTY = Object.freeze([]);
const TAKEOUT_CODES = new Set(["takeout_login_expired", "takeout_verification_required", "takeout_shop_not_found", "takeout_budget_exceeded", "takeout_page_execution_failed", "takeout_search_incomplete", "takeout_native_result_invalid", "takeout_command_invalid", "takeout_native_execution_failed", "takeout_result_sync_failed", "takeout_previous_attempt_unknown", "takeout_page_init_failed", "takeout_page_renderer_failed", "takeout_page_interrupted"]);
const RECEIPT_CODES = new Set(["duel_response_invalid", "duel_narration_missing", "duel_request_timeout", "achievements_receipt_invalid", "inner_monologue_receipt_invalid", "error_logs_receipt_invalid", "error_log_receipt_invalid"]);
const SUMMARY_CODES = new Set(["memory_summary_receipt_invalid", "memory_summary_required", "invalid_memory_id", "memory_not_found"]);
const SESSION_CODES = new Set(["session_receipt_invalid", "session_request_failed"]);
const DISCOVERY_CODES = new Set(["discover_interests_invalid", "discover_recommend_invalid", "interest_profile_empty", "interest_profile_read_failed", "interest_history_read_failed", "interest_unavailable"]);
export const diagnosticScopeKey = (account, companion) => account && companion ? JSON.stringify([account, companion]) : "";
export function recordOperationFailure(scope, endpoint, error, now = Date.now()) {
  if (!scope || error?.name === "AbortError") return null;
  const route = String(endpoint).split("?")[0];
  const operation = DIAGNOSTIC_OPERATIONS.find(item => route === item.prefix || route.startsWith(item.prefix + "/")) || FALLBACK;
  const status = Number(error?.status);
  const record = {
    id: ++sequence, code: operation.code, label: operation.label, source: operation.source, at: now,
    status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : null,
    kind: error?.code === "request_timeout" ? "等待超时" : status >= 400 ? "接口返回错误" : "网络或请求异常",
    logId: /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(error?.error_log_id || "") ? error.error_log_id : null,
    ...(TAKEOUT_CODES.has(error?.code) || RECEIPT_CODES.has(error?.code) || (operation.code === "DT-SUMMARIES" && SUMMARY_CODES.has(error?.code)) || (operation.code === "DT-SESSIONS" && SESSION_CODES.has(error?.code)) || (operation.code === "DT-DISCOVERY" && DISCOVERY_CODES.has(error?.code)) ? { reasonCode: error.code } : {}),
  };
  rows.set(scope, Object.freeze([record, ...(rows.get(scope) || [])].slice(0, 50)));
  if (rows.size > 4) rows.delete(rows.keys().next().value);
  listeners.forEach(listener => listener());
  return record;
}
export function readOperationFailures(scope) { return rows.get(scope) || EMPTY; }
export function clearOperationFailures(scope) { rows.delete(scope); listeners.forEach(listener => listener()); }
export function subscribeOperationFailures(listener) { listeners.add(listener); return () => listeners.delete(listener); }
