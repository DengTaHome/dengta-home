import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Sparkles, X } from "lucide-react";
import { createPortal } from "react-dom";
import { readTextImpactPreference, saveTextImpactPreference, subscribeTextImpactPreference } from "./text-impact-preferences.js";
import "./chat-text-impact.css";

export default function ChatTextImpact({ rowRef, scopeKey = "", messageId, recent = false, generating = false, reducedMotion = false }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [position, setPosition] = useState({ left: 16, top: 16, width: 252 });
  const triggerRef = useRef(null), menuRef = useRef(null);
  const completed = useRef(false);
  const playRequest = useRef(0);
  const activeStop = useRef(null);
  const preference = useSyncExternalStore(subscribeTextImpactPreference,
    () => readTextImpactPreference(scopeKey), () => readTextImpactPreference(""));

  useEffect(() => {
    completed.current = false;
    return () => {
      playRequest.current += 1;
      activeStop.current?.();
    };
  }, [scopeKey, messageId]);

  async function play(mode, target) {
    const source = rowRef.current?.querySelector(".message-content");
    if (!source || reducedMotion) return;
    const request = ++playRequest.current;
    try {
      const { playTextImpact } = await import("./text-impact-player.js");
      if (request !== playRequest.current || !source.isConnected) return;
      const result = await playTextImpact(source, { mode, target, scopeKey });
      if (request !== playRequest.current) { result.stop?.(); return; }
      activeStop.current = result.stop || null;
      return result;
    } catch {
      return request === playRequest.current ? { started: false } : null;
    }
  }

  function playManually(mode) {
    saveTextImpactPreference(scopeKey, { mode });
    setOpen(false);
    const pending = play(mode, preference.target);
    const request = playRequest.current;
    void pending.then(result => {
      if (request !== playRequest.current || !result) return;
      setFeedback(result.started ? "原消息已保留" : "动效暂时没有加载成功，可以再试一次");
    });
  }

  useEffect(() => {
    if (!recent || generating || completed.current) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || completed.current) return;
      completed.current = true;
      if (preference.auto && !reducedMotion) void play(preference.mode, preference.target);
    });
    return () => { cancelled = true; };
    // Only a newly completed reply can start automatic playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, generating, preference, reducedMotion, scopeKey, messageId]);

  useEffect(() => {
    if (!open) return undefined;
    const escape = event => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    const outside = event => { if (!menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false); };
    const close = () => setOpen(false);
    const anchor = triggerRef.current?.getBoundingClientRect();
    const closeWhenAnchorMoves = event => {
      if (menuRef.current?.contains(event.target)) return;
      const next = triggerRef.current?.getBoundingClientRect();
      if (!anchor || !next || Math.abs(next.top - anchor.top) > 1 || Math.abs(next.right - anchor.right) > 1) close();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close, { passive: true });
    window.addEventListener("scroll", closeWhenAnchorMoves, { passive: true, capture: true });
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", closeWhenAnchorMoves, true);
    };
  }, [open]);

  if (generating || reducedMotion) return null;
  return <span className="text-impact-control">
    <button type="button" className="message-reference-button text-impact-trigger"
      ref={triggerRef} aria-expanded={open} aria-label="文字弹弹乐" onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const width = Math.min(252, window.innerWidth - 32);
        setPosition({ width, left: Math.max(16, Math.min(window.innerWidth - width - 16, rect.right - width)),
          top: Math.max(16, Math.min(window.innerHeight - 290, rect.top - 270)) });
        setOpen(value => !value); setFeedback("");
      }}>
      <Sparkles size={12} aria-hidden="true" />弹字
    </button>
    {open && createPortal(<span ref={menuRef} className="text-impact-menu" role="group" aria-label="文字弹弹乐选项"
      style={{ width: position.width, left: position.left, top: position.top }}>
      <span className="text-impact-menu-heading"><strong>文字弹弹乐</strong><button type="button" aria-label="关闭文字弹弹乐" onClick={() => setOpen(false)}><X size={14} /></button></span>
      <span className="text-impact-targets" aria-label="弹字落点">
        <button type="button" aria-label="对方头像" aria-pressed={preference.target === "avatar"} onClick={() => saveTextImpactPreference(scopeKey, { target: "avatar" })}>对方头像</button>
        <button type="button" aria-label="输入框" aria-pressed={preference.target === "composer"} onClick={() => saveTextImpactPreference(scopeKey, { target: "composer" })}>输入框</button>
      </span>
      <span className="text-impact-modes">
        <button type="button" onClick={() => playManually("burst")}>文字弹弹</button>
        <button type="button" onClick={() => playManually("scatter")}>重力散落</button>
      </span>
      <label className="text-impact-auto"><input type="checkbox" checked={preference.auto} disabled={!scopeKey}
        onChange={event => saveTextImpactPreference(scopeKey, { auto: event.target.checked })} />新回复自动播放</label>
      <small>仅播放动效，原消息和输入内容都会保留。</small>
    </span>, document.body)}
    <span className="text-impact-feedback" role="status">{feedback}</span>
  </span>;
}
