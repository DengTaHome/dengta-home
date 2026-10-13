import { useEffect, useLayoutEffect, useRef } from "react";

export function useSettingsSheetNavigation({ isOpen, scopeKey, panelRef, onClose }) {
  const liveRef = useRef(null);
  const previousRef = useRef(null);
  const returnFocusRef = useRef(null);

  useLayoutEffect(() => {
    liveRef.current = { isOpen, scopeKey, onClose };
  }, [isOpen, scopeKey, onClose]);

  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { isOpen, scopeKey };
    const panel = panelRef.current;
    const doc = panel?.ownerDocument;
    if (!isOpen || !panel || !doc) return;
    if (!previous?.isOpen) returnFocusRef.current = { scopeKey, target: doc.activeElement };
    else if (previous.scopeKey !== scopeKey) returnFocusRef.current = { scopeKey, target: null };
    if (!panel.contains(doc.activeElement)) {
      (panel.querySelector(".settings-sheet-header button:not(:disabled)") || panel).focus({ preventScroll: true });
    }
  }, [isOpen, scopeKey, panelRef]);

  useEffect(() => {
    const panel = panelRef.current;
    const doc = panel?.ownerDocument;
    if (!isOpen || !panel || !doc) return undefined;
    const returnFocus = returnFocusRef.current;
    const ownsPanel = () => liveRef.current?.isOpen && liveRef.current.scopeKey === scopeKey && panelRef.current === panel;
    const candidates = () => [...panel.querySelectorAll("a[href], button, input, select, textarea, [tabindex], [contenteditable='true']")]
      .filter(node => node.tabIndex >= 0 && !node.matches(":disabled") && !node.closest("[hidden], [inert], [aria-hidden='true']") && node.getClientRects().length > 0 && doc.defaultView?.getComputedStyle(node).visibility !== "hidden");
    const keydown = event => {
      if (!ownsPanel() || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey) return;
      const otherDialog = event.target?.closest?.("[role='dialog'], [role='alertdialog']");
      if (otherDialog && otherDialog !== panel) return;
      if (event.key === "Escape" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        const live = liveRef.current;
        liveRef.current = { ...live, isOpen: false };
        live.onClose?.();
      } else if (event.key === "Tab") {
        const entries = candidates(), first = entries[0], last = entries.at(-1);
        if (!first) { event.preventDefault(); panel.focus({ preventScroll: true }); }
        else if (event.shiftKey && (doc.activeElement === first || !panel.contains(doc.activeElement))) { event.preventDefault(); last.focus({ preventScroll: true }); }
        else if (!event.shiftKey && (doc.activeElement === last || !panel.contains(doc.activeElement))) { event.preventDefault(); first.focus({ preventScroll: true }); }
      }
    };
    // Bubble after a search, optional panel or nested dialog handles its own Escape.
    doc.addEventListener("keydown", keydown);
    return () => {
      doc.removeEventListener("keydown", keydown);
      if (liveRef.current?.scopeKey === scopeKey && returnFocus?.target?.isConnected &&
        (doc.activeElement === doc.body || panel.contains(doc.activeElement))) {
        returnFocus.target.focus({ preventScroll: true });
      }
      if (returnFocusRef.current === returnFocus) returnFocusRef.current = null;
    };
  }, [isOpen, scopeKey, panelRef]);
}
