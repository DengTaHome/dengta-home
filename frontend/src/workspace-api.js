import { apiRequest } from "./api.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";

export const WORKSPACE_REQUEST_TIMEOUT_MS = 15_000;

async function workspaceRequest(path, options = {}) {
  const { signal, ...requestOptions } = options;
  const controller = new AbortController();
  const session = requestOptions.authSession ? createScopedSettingsSession(requestOptions.authSession, settingsSaveScope(requestOptions.authSession.getSnapshot()), controller.signal) : undefined;
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timeout = window.setTimeout(() => controller.abort(Object.assign(new Error("工作区请求超时。"), { code: "request_timeout" })), WORKSPACE_REQUEST_TIMEOUT_MS);
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason || new DOMException("已取消", "AbortError")); });
  controller.signal.addEventListener("abort", rejectAbort, { once: true });
  try {
    controller.signal.throwIfAborted();
    return await Promise.race([
      apiRequest(path, { ...requestOptions, ...(session ? { authSession: session } : {}), signal: controller.signal, retry: false }),
      aborted,
    ]);
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}

export function workspaceTree(path = "", options = {}) {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return workspaceRequest(`/api/v2/workspace/tree${query}`, options);
}

export function workspaceReadFile(path, options = {}) {
  return workspaceRequest(
    `/api/v2/workspace/file?path=${encodeURIComponent(path)}`,
    options,
  );
}

export function workspaceWriteFile({ path, content, mode = "overwrite", confirm = false }, options = {}) {
  return workspaceRequest("/api/v2/workspace/file", {
    ...options,
    method: "PUT",
    body: JSON.stringify({ path, content, mode, confirm }),
  });
}

export function workspaceDeleteFile({ path, confirm = false }, options = {}) {
  const query = `path=${encodeURIComponent(path)}&confirm=${confirm ? "true" : "false"}`;
  return workspaceRequest(`/api/v2/workspace/file?${query}`, { ...options, method: "DELETE" });
}

export function workspaceStats(options = {}) {
  return workspaceRequest("/api/v2/workspace/stats", options);
}

export function workspaceAgentsMd(options = {}) {
  return workspaceRequest("/api/v2/workspace/agents-md", options);
}
