import { useLayoutEffect, useRef, useState } from "react";
import { authSession } from "./auth-session.js";
import { settingsSaveScope } from "./settings-save-scope.js";
import { kiwiHealthReceipt, memoryUiFailure, useMemoryUiRequest } from "./memory-ui-feedback.js";

export default function MemoryGatewayStatus({ scopeKey = settingsSaveScope(authSession.getSnapshot()) }) {
  const [view, setView] = useState({ scopeKey, status: null, error: "", busy: false });
  const { status, error, busy } = view.scopeKey === scopeKey ? view : { status: null, error: "", busy: false };
  const requestRef = useRef(null);
  const { request, isCurrent } = useMemoryUiRequest(scopeKey);
  useLayoutEffect(() => { requestRef.current = null; }, [scopeKey]);
  async function check() {
    if (requestRef.current || !isCurrent()) return;
    const operation = {};
    requestRef.current = operation;
    setView(previous => ({ scopeKey, status: previous.scopeKey === scopeKey ? previous.status : null, error: "", busy: true }));
    try {
      const result = await request("/api/v2/memory/health", { timeoutMs: 10_000 });
      if (!isCurrent() || requestRef.current !== operation) return;
      const health = kiwiHealthReceipt(result);
      setView({ scopeKey, status: health, busy: true, error: health.error ? memoryUiFailure({ code: health.error, status: health.status }, { gateway: true }) : "" });
    } catch (failure) {
      if (isCurrent() && requestRef.current === operation) setView(previous => ({ ...previous, error: memoryUiFailure(failure) }));
    } finally {
      if (isCurrent() && requestRef.current === operation) { requestRef.current = null; setView(previous => ({ ...previous, busy: false })); }
    }
  }
  return <section className="memory-gateway-status" aria-label="Kiwi 记忆连接检查">
    <div><strong>Kiwi 服务器记忆</strong><button type="button" onClick={() => void check()} disabled={busy}>{busy ? "检测中…" : "检测连接与账号范围"}</button></div>
    <p>按当前账号和伴侣检查连接，不读取记忆正文。连接通过后，还需在聊天中验证实际召回。</p>
    {error && <div role="alert"><p>{error}</p><p>点击“检测连接与账号范围”可重新检查，不会导入或修改记忆。</p></div>}
    {status?.tenant_verified && status.reachable && <div role="status">
      <p>{error || busy ? "上次检测：" : ""}服务可达 · 账号与伴侣范围已确认</p>
      <p>{status.memory_enabled ? `${status.total_memories} 条记忆（网关统计）` : "网关未确认记忆功能可用；请检查记忆功能和统计端点。"}</p>
      <p>{status.embedding_available ? "嵌入服务报告可用；实际聊天召回仍待验证。" : "嵌入服务不可用，语义召回未通过；请检查 Kiwi 的嵌入模型配置。"}</p>
    </div>}
  </section>;
}
