import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE_SELECTOR = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], summary, audio[controls], video[controls], [tabindex]';

export default function MusicImportDialog({ children, onClose, busy = false }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    const focusable = () => [...(panel?.querySelectorAll(FOCUSABLE_SELECTOR) || [])]
      .filter(node => node.tabIndex >= 0 && !node.disabled && node.getClientRects().length);
    (focusable()[0] || panel)?.focus();
    const keydown = event => {
      if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) closeRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const buttons = focusable();
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown, true); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return createPortal(<div className="music-import-backdrop"><section className="music-import-dialog" role="dialog" aria-modal="true" aria-labelledby="music-import-heading" tabIndex={-1} ref={panelRef}><header><div><small>一起听歌</small><h2 id="music-import-heading">导入想听的歌</h2>{busy && <small role="status">正在保存，请稍候…</small>}</div><button type="button" aria-label="关闭歌曲导入" disabled={busy} onClick={onClose}><X aria-hidden="true" /></button></header><div className="music-import-dialog-body">{children}</div></section></div>, document.body);
}
