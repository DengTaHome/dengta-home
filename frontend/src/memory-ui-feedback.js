import { useCallback, useLayoutEffect, useRef } from "react";
import { apiFetch, apiRequest } from "./api.js";
import { authSession } from "./auth-session.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";
import { describeOperationError } from "./operation-error-help.js";

const HELP = Object.freeze({
  memory_ui_receipt_invalid: "记忆服务返回的确认信息不完整。本次未确认成功，请重新读取连接状态后核对。",
  kiwi_mem_not_configured: "服务器尚未配置 Kiwi。现有灯塔记忆仍可使用。",
  kiwi_mem_tenant_required: "账号或伴侣标识不完整，请重新登录并选择伴侣后检测。",
  kiwi_mem_tenant_unverified: "网关未返回匹配的租户回执。请检查网关及代理是否支持 X-Tenant-Id 回执；本次不会使用未经确认的记忆。",
  kiwi_mem_http_401: "Kiwi 鉴权失败，请检查服务器配置的网关令牌。",
  kiwi_mem_http_403: "Kiwi 拒绝访问，请检查网关权限配置。",
  kiwi_mem_http_404: "Kiwi 接口不存在，请检查网关地址和版本。",
  kiwi_mem_timeout: "Kiwi 响应超时，请检查网关是否休眠或网络是否可达，再点击检测。",
  kiwi_mem_network_error: "无法连接 Kiwi，请检查服务器到网关的网络连接，再点击检测。",
  kiwi_mem_invalid_response: "Kiwi 未返回可用状态，请检查网关日志和记忆功能开关。",
  kiwi_mem_memory_disabled: "Kiwi 的记忆功能已关闭，请在网关管理面板开启后重新检测。",
  EXTERNAL_MEMORY_MIGRATION_REQUIRED: "外部记忆的保存结构尚未准备好。请联系管理员更新服务；现有配置和输入继续保留。",
  EXTERNAL_MEMORY_CREDENTIAL_REQUIRED: "请填写连接凭据，再测试当前填写。",
  EXTERNAL_MEMORY_CREDENTIAL_REENTRY_REQUIRED: "已保存的凭据无法解密，请重新填写并保存，再检测连接。",
  EXTERNAL_MEMORY_PRIVILEGED_CREDENTIAL_REJECTED: "这里仅支持专用记忆表的公开只读密钥。请使用 publishable / anon 公钥，不要填写管理密钥。",
  EXTERNAL_MEMORY_PUBLIC_CREDENTIAL_REQUIRED: "请填写 Supabase publishable / anon 公钥，再测试连接。",
  EXTERNAL_MEMORY_CREDENTIAL_REJECTED: "外部记忆服务拒绝了凭据。请检查密钥、令牌和只读权限，再测试连接。",
  EXTERNAL_MEMORY_TABLE_NOT_ALLOWED: "目前只支持 dengta_memories 专用表。请核对表名和最小 SELECT 权限。",
  EXTERNAL_MEMORY_SUPABASE_HOST_NOT_ALLOWED: "请使用受支持的 Supabase 项目 HTTPS 地址，再测试连接。",
  EXTERNAL_MEMORY_SUPABASE_URL_INVALID: "Supabase 项目地址格式不正确。请核对完整 HTTPS 地址。",
  EXTERNAL_MEMORY_CONNECTION_NOT_FOUND: "当前账号没有这个已保存连接。请重新读取连接列表，再选择操作。",
  EXTERNAL_MEMORY_UPSTREAM_TIMEOUT: "外部记忆服务响应超时。请检查服务状态及网络，再测试连接。",
  EXTERNAL_MEMORY_UPSTREAM_UNAVAILABLE: "无法连接外部记忆服务。请检查公网 HTTPS 地址和服务状态，再测试连接。",
  EXTERNAL_MEMORY_UPSTREAM_ERROR: "外部记忆服务返回 HTTP 错误。请根据上游状态核对地址、接口路径和权限，再测试连接。",
  EXTERNAL_MEMORY_RESPONSE_INVALID: "外部记忆服务返回了不兼容的数据。请核对专用表字段和服务版本。",
  EXTERNAL_MEMORY_RESPONSE_TOO_LARGE: "外部记忆返回的数据超过单次读取容量。请减少单条记录内容或检查服务分页。",
  EXTERNAL_MEMORY_READ_TOOL_MISSING: "MCP 服务已响应，但没有受支持的只读记忆工具。请检查工具清单和服务版本；这不代表聊天召回已通过。",
  OMBRE_MCP_UPSTREAM_ERROR: "MCP 服务返回 HTTP 错误。请检查 HTTPS 地址、/mcp 路径、令牌和上游状态。",
  OMBRE_MCP_TIMEOUT: "MCP 服务响应超时。请检查服务是否启动及网络，再测试连接。",
  OMBRE_MCP_UNAVAILABLE: "无法连接 MCP 服务。请检查公网 HTTPS 地址与服务状态，再测试连接。",
  MCP_PROTOCOL_UNSUPPORTED: "MCP 协议版本不兼容，请核对服务版本。",
  MCP_PAGINATION_INVALID: "MCP 工具列表分页异常或超过上限。请检查服务的工具列表接口，再检测连接。",
  MCP_ENDPOINT_INVALID: "MCP 地址格式不正确。请填写完整 HTTPS 地址，不要在地址中包含用户名、密码或片段。",
  MCP_ENDPOINT_HTTPS_REQUIRED: "云端 MCP 连接需要 HTTPS。请使用公开 HTTPS 服务地址。",
  MCP_ENDPOINT_PRIVATE: "此地址指向私有、局域网或本机资源，云端后端无法通过这个连接读取。请使用公开 HTTPS 服务地址。",
  MCP_ENDPOINT_DNS_FAILED: "无法解析 MCP 服务域名。请核对域名及服务 DNS 状态，再测试连接。",
  MCP_ENCRYPTION_NOT_CONFIGURED: "后端尚未配置凭据加密服务。请联系管理员；当前输入保留，暂时不能加密保存。",
});

function httpStatus(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : null;
}

export function memoryUiFailure(error, { mutation = false, gateway = false } = {}) {
  const detail = describeOperationError(error);
  const message = Object.hasOwn(HELP, detail.code) ? HELP[detail.code] : `${detail.reason}${detail.action}`;
  const statuses = [httpStatus(error?.status) ? `${gateway ? "网关" : "后端"} HTTP ${httpStatus(error.status)}` : "", httpStatus(error?.upstream_status ?? error?.upstreamStatus) ? `上游 HTTP ${httpStatus(error.upstream_status ?? error.upstreamStatus)}` : ""].filter(Boolean);
  return `${message}${mutation ? " 操作结果尚未确认，请先重新读取连接核对，避免重复保存、导入或移除。" : ""}（错误代码：${detail.code}${statuses.length ? ` · ${statuses.join(" · ")}` : ""}）`;
}

export function invalidMemoryReceipt() {
  const error = new Error("记忆服务回执无效。");
  error.code = "memory_ui_receipt_invalid";
  return error;
}

export const memoryCount = value => Number.isSafeInteger(value) && value >= 0;

export function kiwiHealthReceipt(data) {
  if (!data || typeof data.configured !== "boolean" || typeof data.reachable !== "boolean") throw invalidMemoryReceipt();
  if (data.reachable && (data.tenant_verified !== true || typeof data.memory_enabled !== "boolean" || typeof data.embedding_available !== "boolean" || !memoryCount(data.total_memories))) throw invalidMemoryReceipt();
  if (!data.reachable && (typeof data.error !== "string" || !data.error)) throw invalidMemoryReceipt();
  return data;
}

export function useMemoryUiRequest(scopeKey) {
  const lifecycle = useRef(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    const current = { scopeKey, controller };
    lifecycle.current = current;
    return () => { controller.abort(); if (lifecycle.current === current) lifecycle.current = null; };
  }, [scopeKey]);
  const isCurrent = useCallback(() => {
    const snapshot = authSession.getSnapshot();
    return Boolean(lifecycle.current?.scopeKey === scopeKey && !lifecycle.current.controller.signal.aborted && snapshot.user?.id && snapshot.activeCompanionId && settingsSaveScope(snapshot) === scopeKey);
  }, [scopeKey]);
  const request = useCallback(async (path, { body, timeoutMs = 15_000, responseReader, ...options } = {}) => {
    if (!isCurrent()) {
      const error = new Error("账号或伴侣范围已变化。");
      error.code = "settings_scope_changed";
      throw error;
    }
    const current = lifecycle.current;
    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = () => controller.abort();
    current.controller.signal.addEventListener("abort", forwardAbort, { once: true });
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => {
        const error = new Error(timedOut ? "等待记忆服务确认超时。" : "账号或伴侣范围已变化。");
        error.code = timedOut ? "request_timeout" : "settings_scope_changed";
        reject(error);
      };
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    // The shared API deadline ends after headers; this also bounds a stalled JSON body.
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const requestOptions = { timeoutMs, ...options, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, authSession: createScopedSettingsSession(authSession, scopeKey, controller.signal), retry: false };
      const result = responseReader
        ? apiFetch(path, { ...requestOptions, headers: { "Content-Type": "application/json", ...(options.headers || {}) } }).then(responseReader)
        : apiRequest(path, requestOptions);
      return await Promise.race([result, aborted]);
    } finally {
      window.clearTimeout(timer);
      current.controller.signal.removeEventListener("abort", forwardAbort);
      controller.signal.removeEventListener("abort", onAbort);
    }
  }, [isCurrent, scopeKey]);
  return { request, isCurrent };
}
