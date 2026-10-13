import { useLayoutEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { CHAT_ERROR_FEEDBACK } from "./chat-error-feedback";
import { requestErrorLog, validateErrorLog } from "./error-log-request.js";
import "./error-log-ui.css";

const defaultLoadLog = (id, options) => requestErrorLog(id, apiRequest, 15000, options);

function failureLabel(error) {
  if (error?.status === 404) return "服务器暂时找不到这条日志。可重试，或提供下面的本轮诊断。";
  if (error?.status === 401 || error?.status === 403) return "日志访问未获授权，请检查登录状态及当前伴侣。";
  if (error?.code === "request_timeout") return "日志读取超时，请检查网络后重试。";
  if (error?.code === "error_log_receipt_invalid") return "日志回执与本轮编号不匹配或不完整，请重新读取。（error_log_receipt_invalid）";
  return "日志暂时无法读取，可以重试。下面仍保留本轮诊断。";
}

export default function ChatErrorLog({ logId, diagnostic = {}, loadLog = defaultLoadLog, feedbackByCode = CHAT_ERROR_FEEDBACK }) {
  const [expansion, setExpansion] = useState({ logId, expanded: false });
  const [storedResult, setResult] = useState({ logId, loading: false, data: null, error: "" });
  const expanded = expansion.logId === logId && expansion.expanded;
  const result = storedResult.logId === logId ? storedResult : { loading: false, data: null, error: "" };
  const generation = useRef(0);
  const pending = useRef(null);
  useLayoutEffect(() => {
    generation.current += 1;
    return () => { generation.current += 1; pending.current?.abort(); pending.current = null; };
  }, [logId]);

  async function load() {
    if (!logId || pending.current) return;
    const token = ++generation.current;
    const controller = new AbortController();
    pending.current = controller;
    setResult({ logId, loading: true, data: null, error: "" });
    try {
      const data = await loadLog(logId, { signal: controller.signal });
      if (!data) throw Object.assign(new Error(), { status: 404 });
      validateErrorLog(data, logId);
      if (token === generation.current && !controller.signal.aborted) setResult({ logId, loading: false, data, error: "" });
    } catch (error) {
      if (token === generation.current && !controller.signal.aborted) setResult({ logId, loading: false, data: null, error: failureLabel(error) });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }
  function toggle() {
    setExpansion({ logId, expanded: !expanded });
    if (!expanded && !result.data && !result.loading) void load();
  }
  const detail = result.data || diagnostic;
  const feedback = feedbackByCode[detail.error_code] || {
    reason: "具体原因尚未确认，请结合错误码、来源和上游 HTTP 状态检查。",
    action: "检查网络及接口设置后重试；持续失败时提供下面的脱敏诊断。",
  };
  const fields = [
    ["日志编号", logId],
    ["错误码", detail.error_code],
    ["上游错误码", detail.provider_code],
    ["来源", detail.error_source],
    ["阶段", detail.provider_phase],
    ["上游 HTTP", detail.upstream_status],
    ["位置", detail.error_location],
    ["路径", detail.path],
    ["时间", detail.created_at || detail.error_time],
    ["后端版本", detail.request_summary?.version],
    ["提交", detail.request_summary?.revision],
    ["模型窗口（估算 token）", detail.request_summary?.context_budget?.capacity],
    ["输入占用（估算 token）", detail.request_summary?.context_budget?.input],
    ["预留输出 token", detail.request_summary?.context_budget?.reservedOutput],
    ["预算检查阶段", detail.request_summary?.context_budget?.stage],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  return <>
    <button type="button" className="chat-error-log-toggle" aria-expanded={expanded} onClick={toggle}>
      {expanded ? "收起日志" : "查看日志"}
    </button>
    {expanded && <div className="chat-error-log-detail" aria-live="polite">
      {feedback && <><p><strong>原因</strong>: {feedback.reason}</p><p><strong>处理办法</strong>: {feedback.action}</p></>}
      {result.loading && <span role="status">读取中…</span>}
      {!logId && <p>这次没有收到服务器日志编号，以下是本轮诊断。</p>}
      {result.error && <p role="status">{result.error}</p>}
      {result.error && <button type="button" onClick={() => void load()}>重试读取日志</button>}
      {fields.map(([label, value]) => <p className="chat-error-log-line" key={label}><strong>{label}</strong>: {String(value)}</p>)}
      {result.data?.stack_trace && <pre className="chat-error-log-stack">{result.data.stack_trace}</pre>}
    </div>}
  </>;
}
