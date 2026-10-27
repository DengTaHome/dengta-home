import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { authSession } from "./auth-session.js";
import { requestErrorLogs } from "./error-log-request.js";
import LocalDiagnostics from "./LocalDiagnostics.jsx";
import OperationErrorHelp from "./OperationErrorHelp.jsx";
import { describeOperationError } from "./operation-error-help.js";
import {
  diagnosticScopeKey,
  recordOperationFailure
} from "./operation-diagnostics.js";
import {
  createScopedSettingsSession,
  settingsSaveScope
} from "./settings-save-scope.js";
export default function ErrorLogsPanel({
  accountScope,
  companionScope,
  onOpenSettings,
  // 依赖可注入：默认用真实实现，测试可以传假实现来验证行为。
  // 这样做是为了让测试「真的挂载组件」，而不是从 App.jsx 里切源码再塞变量。
  request = apiRequest,
  loadErrorLogs = requestErrorLogs,
  auth = authSession,
  createScopedSession = createScopedSettingsSession,
  readScopeKey = diagnosticScopeKey,
  readSaveScope = settingsSaveScope,
  recordFailure = recordOperationFailure,
  Diagnostics = LocalDiagnostics,
  ErrorHelp = OperationErrorHelp,
  describeError = describeOperationError
}) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const requestRevision = useRef(0);
  const pendingLogRequest = useRef(null);

  const refresh = useCallback(async () => {
    if (pendingLogRequest.current) return;
    const requestId = ++requestRevision.current;
    const controller = new AbortController();
    pendingLogRequest.current = controller;
    const owner = readScopeKey(accountScope, companionScope);
    const isCurrent = () => requestId === requestRevision.current && !controller.signal.aborted && readSaveScope(auth.getSnapshot()) === owner;
    setLoading(true);
    setLoadError("");
    try {
      const scopedSession = createScopedSession(auth, owner, controller.signal);
      const items = await loadErrorLogs(request, 50, 15000, { authSession: scopedSession, signal: controller.signal });
      if (!isCurrent()) return;
      setLogs(items);
    } catch (error) {
      if (isCurrent()) {
        if (["request_timeout", "error_logs_receipt_invalid"].includes(error?.code)) recordFailure(owner, "/api/errors", error);
        setLoadError({ code: error?.code, status: error?.status });
      }
    } finally {
      if (pendingLogRequest.current === controller) pendingLogRequest.current = null;
      if (isCurrent()) setLoading(false);
    }
  }, [accountScope, companionScope, auth, createScopedSession, loadErrorLogs, readSaveScope, readScopeKey, recordFailure, request]);

  useEffect(() => {
    const revision = requestRevision;
    const pending = pendingLogRequest;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => { window.clearTimeout(timer); revision.current++; pending.current?.abort(); pending.current = null; };
  }, [refresh]);

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  return (
    <div>
      <Diagnostics scope={readScopeKey(accountScope, companionScope)} />
    <div className="settings-card error-logs-card">
      <h3>错误日志（最近 {logs.length} 条）</h3>
      <p className="card-hint">
        点击可查看错误代码、业务文件位置和请求阶段。展示技术信息，不展示异常原文；旧记录可能没有可用位置。
      </p>
      <div className="error-logs-actions">
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>
      {loadError && <div className="error-logs-load-error" role="alert"><ErrorHelp diagnostic={loadError} onOpenSettings={onOpenSettings} /><small>读取错误代码：{describeError(loadError).code}</small></div>}
      {!loadError && logs.length === 0 && !loading && (
        <div className="error-logs-empty">暂无错误记录 🎉</div>
      )}
      <ul className="error-logs-list">
        {logs.map((log) => {
          const expanded = expandedId === log.id;
          return (
            <li
              key={log.id}
              className={"error-log-item" + (expanded ? " expanded" : "")}
            >
              <button
                type="button"
                className="error-log-summary"
                onClick={() => setExpandedId(expanded ? null : log.id)}
              >
                <span className="error-log-time">{formatTime(log.created_at)}</span>
                <span className="error-log-code">{log.error_code || "unknown"}</span>
                <span className="error-log-path">{log.method} {log.path}</span>
              </button>
              {expanded && (
                <div className="error-log-detail">
                  <ErrorHelp diagnostic={{ code: log.error_code }} onOpenSettings={onOpenSettings} />
                  <details className="error-log-technical"><summary>错误代码与技术详情</summary>
                  <p className="error-log-message">{log.message || ""}</p>
                  {log.error_location && <p>业务位置：{log.error_location}</p>}
                  <p className="error-log-meta">
                    来源 / Source: {log.error_source || "dengta"} · 阶段 / Phase:{" "}
                    {log.provider_phase || "-"} · 上游 / Upstream:{" "}
                    {log.provider_code || "-"} · HTTP: {log.upstream_status ?? "-"}{" "}
                    · 会话: {log.conversation_id || "-"}
                  </p>
                  {log.stack_trace && (
                    <pre className="error-log-stack">{log.stack_trace}</pre>
                  )}
                  </details>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
    </div>
  );
}
