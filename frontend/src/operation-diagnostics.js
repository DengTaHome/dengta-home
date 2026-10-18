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
  { prefix: "/api/v2/private-media/sticker-import", code: "DT-STICKER-IMPORT", label: "表情搜集", source: "StickerImportSettings.jsx / XhsStickerImportSettings.jsx · 导入与授权回执" },
  { prefix: "/api/v2/surprise-map", code: "DT-MAP", label: "藏宝来信", source: "SurpriseMap.jsx · 定位 / 留信 / 领取回执" },
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
DIAGNOSTIC_OPERATIONS.push({ prefix: "/api/v2/xhs", code: "DT-XHS", label: "小红书连接", source: "XhsLoginPanel.jsx · 独立会话连接与状态检测" });
const XHS_CODES = new Set(["xhs_service_unconfigured", "xhs_session_isolation_required", "xhs_service_access_denied", "xhs_profile_busy", "xhs_browser_unavailable", "xhs_profile_storage_failed", "xhs_storage_read_failed", "xhs_storage_write_failed", "xhs_storage_receipt_invalid", "xhs_encryption_unconfigured", "xhs_credentials_unavailable", "xhs_cookie_invalid", "xhs_cookie_missing", "xhs_browser_required", "xhs_login_open_failed", "cookie_expired", "verification_required", "xhs_page_changed", "xhs_qr_expired", "xhs_response_invalid", "xhs_timeout", "request_timeout", "xhs_unreachable", "xhs_upstream_error"]);
const EMPTY = Object.freeze([]);
const STICKER_IMPORT_CODES = new Set([...XHS_CODES, "xhs_action_not_supported", "xhs_note_lookup_required", "sticker_import_schema_required", "sticker_import_storage_failed", "sticker_import_disabled", "sticker_import_request_invalid", "sticker_import_request_conflict", "sticker_import_source_invalid", "sticker_import_source_unavailable", "sticker_import_download_failed", "sticker_import_timeout", "sticker_import_too_large", "sticker_import_asset_removed", "sticker_import_source_not_found", "sticker_import_receipt_invalid"]);
STICKER_IMPORT_CODES.add("xhs_search_request_invalid");
const TAKEOUT_CODES = new Set(["takeout_login_expired", "takeout_verification_required", "takeout_shop_not_found", "takeout_budget_exceeded", "takeout_page_execution_failed", "takeout_search_incomplete", "takeout_native_result_invalid", "takeout_command_invalid", "takeout_native_execution_failed", "takeout_result_sync_failed", "takeout_previous_attempt_unknown", "takeout_page_init_failed", "takeout_page_renderer_failed", "takeout_page_interrupted"]);
TAKEOUT_CODES.add("takeout_product_not_found");
TAKEOUT_CODES.add("takeout_page_not_ready");
TAKEOUT_CODES.add("takeout_page_touch_unavailable");
TAKEOUT_CODES.add("takeout_page_load_failed");
for (const code of ["takeout_login_check_failed", "takeout_login_check_timeout", "takeout_login_state_invalid", "takeout_login_open_failed"]) TAKEOUT_CODES.add(code);
for (const code of ["browser_page_init_failed", "browser_page_renderer_failed", "browser_page_load_failed"]) TAKEOUT_CODES.add(code);
for (const code of ["browser_account_required", "browser_account_changed", "browser_account_restore_required", "browser_account_isolation_unavailable", "browser_account_binding_failed"]) TAKEOUT_CODES.add(code);
const RECEIPT_CODES = new Set(["duel_response_invalid", "duel_narration_missing", "duel_request_timeout", "achievements_receipt_invalid", "inner_monologue_receipt_invalid", "error_logs_receipt_invalid", "error_log_receipt_invalid"]);
const SUMMARY_CODES = new Set(["memory_summary_receipt_invalid", "memory_summary_required", "invalid_memory_id", "memory_not_found"]);
const SESSION_CODES = new Set(["session_receipt_invalid", "session_request_failed"]);
const DISCOVERY_CODES = new Set(["discover_interests_invalid", "discover_recommend_invalid", "interest_profile_empty", "interest_profile_read_failed", "interest_history_read_failed", "interest_unavailable"]);
const MAP_CODES = new Set(["surprise_map_schema_required", "surprise_map_receipt_invalid", "surprise_map_request_conflict", "surprise_map_location_required", "surprise_map_location_invalid", "surprise_map_location_stale", "surprise_map_not_nearby", "surprise_map_draft_invalid", "surprise_map_not_found", "surprise_map_request_failed", "location_permission_denied", "location_unavailable", "location_timeout"]);
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
    ...(TAKEOUT_CODES.has(error?.code) || RECEIPT_CODES.has(error?.code) || (operation.code === "DT-XHS" && XHS_CODES.has(error?.code)) || (operation.code === "DT-STICKER-IMPORT" && STICKER_IMPORT_CODES.has(error?.code)) || (operation.code === "DT-SUMMARIES" && SUMMARY_CODES.has(error?.code)) || (operation.code === "DT-SESSIONS" && SESSION_CODES.has(error?.code)) || (operation.code === "DT-DISCOVERY" && DISCOVERY_CODES.has(error?.code)) || (operation.code === "DT-MAP" && MAP_CODES.has(error?.code)) ? { reasonCode: error.code } : {}),
  };
  rows.set(scope, Object.freeze([record, ...(rows.get(scope) || [])].slice(0, 50)));
  if (rows.size > 4) rows.delete(rows.keys().next().value);
  listeners.forEach(listener => listener());
  return record;
}
export function readOperationFailures(scope) { return rows.get(scope) || EMPTY; }
export function clearOperationFailures(scope) { rows.delete(scope); listeners.forEach(listener => listener()); }
export function subscribeOperationFailures(listener) { listeners.add(listener); return () => listeners.delete(listener); }
