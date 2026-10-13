import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { MAX_SESSION_TITLE } from "./session-dialog-feedback.js";

export default function SessionDialog({ dialog, busy = false, feedback = "", onChange, onClose, onConfirm, onInspect }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  const titleId = useId();
  const hintId = useId();
  useLayoutEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => {
    const doc = globalThis.document;
    const panel = panelRef.current;
    if (!doc?.body || !panel) return undefined;
    const previousFocus = doc.activeElement;
    const previousOverflow = doc.body.style.overflow;
    doc.body.style.overflow = "hidden";
    const candidates = () => [...panel.querySelectorAll("button:not([disabled]), input:not([disabled]), [tabindex='0']")];
    (candidates()[0] || panel).focus();
    const keydown = event => {
      if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (!busyRef.current) closeRef.current?.();
      } else if (event.key === "Tab") {
        const entries = candidates(), first = entries[0], last = entries.at(-1);
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (doc.activeElement === first || !panel.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (doc.activeElement === last || !panel.contains(doc.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    doc.addEventListener("keydown", keydown, true);
    return () => {
      doc.body.style.overflow = previousOverflow;
      doc.removeEventListener("keydown", keydown, true);
      if (previousFocus?.isConnected && (doc.activeElement === doc.body || panel.contains(doc.activeElement))) previousFocus.focus();
    };
  }, []);
  const rename = dialog.type === "rename";
  const title = String(dialog.value || "");
  return <div className="dialog-backdrop" onPointerDown={event => { if (event.target === event.currentTarget && !busy) onClose?.(); }}>
    <form className="dialog-card session-dialog-card" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={hintId} aria-busy={busy} onSubmit={onConfirm}>
      <h2 id={titleId}>{rename ? "重命名对话" : "删除这个对话？"}</h2>
      {rename ? <input aria-label="对话名称" value={title} maxLength={MAX_SESSION_TITLE} disabled={busy} onChange={event => onChange?.(event.target.value)} /> : null}
      <p id={hintId} className="session-dialog-hint">{rename ? `最多 ${MAX_SESSION_TITLE} 字 · ${title.length} / ${MAX_SESSION_TITLE}` : `“${dialog.session.title}”及里面的消息会一起删除。`}</p>
      {busy ? <p className="session-dialog-feedback" role="status">{rename ? "正在保存名称…" : "正在删除，请等待服务器确认…"}</p> : null}
      {feedback ? <div className="session-dialog-feedback" role="alert"><p>{feedback}</p>{onInspect ? <button type="button" disabled={busy} onClick={onInspect}>查看操作日志</button> : null}</div> : null}
      <div className="session-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className={rename ? "" : "danger-button"} type="submit" disabled={busy || (rename && (!title.trim() || title.trim().length > MAX_SESSION_TITLE))}>{busy ? "请稍候…" : rename ? "保存" : "删除"}</button></div>
    </form>
  </div>;
}
