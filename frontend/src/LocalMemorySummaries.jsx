import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMemoryUiRequest } from "./memory-ui-feedback.js";
import { formatMemorySummaryDate, memorySummaryFailure, memorySummaryListReceipt, memorySummaryPatchReceipt, readMemorySummaryDelete, readMemorySummaryJson } from "./memory-summary-feedback.js";
import { recordOperationFailure } from "./operation-diagnostics.js";
import "./memory-summary-list.css";

const PATH = "/api/v2/memories";

export default function LocalMemorySummaries({ scopeKey, items = [], drafts = {}, onItemsChange, onDraftsChange, onNotice }) {
  const { request, isCurrent } = useMemoryUiRequest(scopeKey);
  const [reading, setReading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState(null);
  const readVersion = useRef(0);
  const writeLock = useRef(null);
  const pendingRefresh = useRef(false);
  const draftVersions = useRef({});
  const draftsRef = useRef(drafts);
  useLayoutEffect(() => { draftsRef.current = drafts; }, [drafts]);

  const showFailure = useCallback((error, endpoint, mutation = false) => {
    const detail = memorySummaryFailure(error, mutation);
    recordOperationFailure(scopeKey, endpoint, error);
    setFeedback({ ...detail, error: true });
    onNotice?.(detail.message);
  }, [scopeKey, onNotice]);

  const refresh = useCallback(async () => {
    if (!isCurrent()) return;
    if (writeLock.current) { pendingRefresh.current = true; return; }
    pendingRefresh.current = false;
    const version = ++readVersion.current;
    setReading(true);
    try {
      const data = await request(PATH, { responseReader: readMemorySummaryJson });
      if (!isCurrent() || readVersion.current !== version) return;
      const memories = memorySummaryListReceipt(data);
      onItemsChange(memories);
      setConfirmed(true);
      setFeedback(null);
    } catch (error) {
      if (isCurrent() && readVersion.current === version) showFailure(error, PATH);
    } finally {
      if (isCurrent() && readVersion.current === version) setReading(false);
    }
  }, [isCurrent, request, onItemsChange, showFailure]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) void refresh(); });
    const imported = () => { void refresh(); };
    window.addEventListener("dengta:memories-imported", imported);
    return () => { cancelled = true; pendingRefresh.current = false; readVersion.current += 1; window.removeEventListener("dengta:memories-imported", imported); };
  }, [refresh]);

  function edit(id, value) {
    draftVersions.current[id] = (draftVersions.current[id] || 0) + 1;
    draftsRef.current = { ...draftsRef.current, [id]: value };
    onDraftsChange(current => ({ ...current, [id]: value }));
  }

  function cancelEdit(id) {
    draftVersions.current[id] = (draftVersions.current[id] || 0) + 1;
    const next = { ...draftsRef.current }; delete next[id]; draftsRef.current = next;
    onDraftsChange(current => { const next = { ...current }; delete next[id]; return next; });
  }

  async function mutate(item, deleting = false) {
    if (!isCurrent() || writeLock.current) return;
    const draft = draftsRef.current[item.id];
    const summary = String(draft || "").trim();
    if (!deleting && (!summary || summary.length > 4000)) {
      onNotice?.(!summary ? "记忆内容不能为空。" : "记忆编辑最多 4000 字符，请保留原文后调整此次修改。");
      return;
    }
    const action = { id: item.id, version: draftVersions.current[item.id] || 0, draft };
    writeLock.current = action;
    if (deleting && !window.confirm("确定删除这条长期记忆吗？删除后不会再注入对话。")) {
      writeLock.current = null;
      return;
    }
    readVersion.current += 1;
    setReading(false);
    setBusyId(item.id);
    setFeedback(null);
    const endpoint = `${PATH}/${item.id}`;
    try {
      const data = await request(endpoint, deleting
        ? { method: "DELETE", responseReader: readMemorySummaryDelete }
        : { method: "PATCH", body: { summary }, responseReader: readMemorySummaryJson });
      if (!isCurrent() || writeLock.current !== action) return;
      const receipt = deleting ? data : memorySummaryPatchReceipt(data, item.id, summary);
      readVersion.current += 1;
      onItemsChange(current => receipt.deleted ? current.filter(memory => memory.id !== item.id) : current.map(memory => memory.id === item.id ? receipt.memory : memory));
      const unchanged = draftVersions.current[item.id] === action.version || (action.version === 0 && draftVersions.current[item.id] === undefined);
      const hasNewerDraft = !unchanged || draftsRef.current[item.id] !== action.draft;
      if (!hasNewerDraft) onDraftsChange(current => { if (current[item.id] !== action.draft) return current; const next = { ...current }; delete next[item.id]; return next; });
      const message = `${receipt.deleted ? deleting ? "记忆已经删除。" : "服务端已确认删除这条残留内容。" : "记忆已经保存。"}${hasNewerDraft ? " 新输入已保留，尚未保存。" : ""}`;
      setFeedback({ error: false, message });
      onNotice?.(message);
    } catch (error) {
      if (isCurrent() && writeLock.current === action) showFailure(error, endpoint, true);
    } finally {
      if (writeLock.current === action) {
        writeLock.current = null;
        if (isCurrent()) {
          setBusyId("");
          if (pendingRefresh.current) void refresh();
        }
      }
    }
  }

  const itemIds = new Set(items.map(item => item.id));
  const orphanDrafts = Object.entries(drafts).filter(([id]) => !itemIds.has(id));

  return (
    <section className="local-memory-summaries" aria-label="对话摘要">
      <div className="memory-source-heading local-memory-heading">
        <div><span className="eyebrow">SUPABASE</span><h3>对话摘要</h3></div>
        <span className="local-memory-count">{confirmed || items.length ? `${items.length} 条${!confirmed ? " · 上次读取" : ""}` : "尚未确认"}</span>
      </div>
      <div className="memory-summary-toolbar">
        <p role="status">{reading ? "正在读取对话摘要…" : feedback?.error && (confirmed || items.length) ? "保留上次确认的摘要，本次结果尚未确认。" : confirmed ? "已读取当前账号与伴侣的摘要。" : items.length ? "保留上次读取的摘要，本次尚未确认。" : "尚未成功读取对话摘要。"}</p>
        <button type="button" onClick={() => void refresh()} disabled={reading || Boolean(busyId)}>{reading ? "读取中…" : "重新读取摘要"}</button>
      </div>
      {feedback && <div className={`memory-summary-feedback${feedback.error ? " is-error" : ""}`} role={feedback.error ? "alert" : "status"}>
        <p>{feedback.message}</p>
        {feedback.error && <details><summary>技术详情</summary><dl><dt>错误代码</dt><dd>{feedback.code}</dd>{feedback.status && <><dt>后端 HTTP</dt><dd>{feedback.status}</dd></>}{feedback.logId && <><dt>日志编号</dt><dd>{feedback.logId}</dd></>}</dl></details>}
      </div>}
      <div className="memory-grid">
        {confirmed && items.length === 0 ? <div className="empty-card">暂时没有长期记忆。达到设置中的 token 阈值后会自动整理。</div> : items.map(item => (
          <article className="memory-card" key={item.id}>
            <span>{formatMemorySummaryDate(item.updated_at || item.created_at)}</span>
            {Object.hasOwn(drafts, item.id) ? <textarea className="memory-editor" value={drafts[item.id]} onChange={event => edit(item.id, event.target.value)} maxLength={4000} rows={5} aria-label="修改长期记忆" /> : <p>{item.summary}</p>}
            <div className="memory-card-actions">
              {Object.hasOwn(drafts, item.id) ? <>
                <button type="button" onClick={() => void mutate(item)} disabled={Boolean(busyId)}>{busyId === item.id ? "保存中…" : "保存"}</button>
                <button type="button" onClick={() => cancelEdit(item.id)} disabled={busyId === item.id}>取消</button>
              </> : <>
                <button type="button" onClick={() => edit(item.id, item.summary)} disabled={busyId === item.id}>修改</button>
                <button type="button" className="danger" onClick={() => void mutate(item, true)} disabled={Boolean(busyId)}>{busyId === item.id ? "删除中…" : "删除"}</button>
              </>}
            </div>
          </article>
        ))}
      </div>
      {orphanDrafts.length > 0 && <div className="memory-summary-orphan-drafts" aria-label="未保存的记忆草稿">
        <h4>仍然保留的输入</h4>
        <p>当前摘要列表未找到对应记录。这些输入尚未保存，可以选中全文复制，或手动丢弃。</p>
        {orphanDrafts.map(([id, draft]) => <div key={id}>
          <textarea readOnly value={draft} rows={4} aria-label="选择并复制未保存的记忆草稿" onFocus={event => event.currentTarget.select()} />
          <button type="button" disabled={Boolean(busyId)} onClick={() => {
            if (writeLock.current) return;
            if (window.confirm("确定丢弃这段未保存的输入吗？这只移除此草稿，不会修改服务器记忆。")) cancelEdit(id);
          }}>丢弃这段草稿</button>
        </div>)}
      </div>}
    </section>
  );
}
