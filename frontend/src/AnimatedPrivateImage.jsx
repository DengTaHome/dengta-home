import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePrivateMediaSource } from "./use-private-media";
import { stickerPosterPath } from "./animated-stickers.js";
import "./animated-stickers.css";

const motionQuery = () => typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") : null;
const reducedMotion = () => Boolean(motionQuery()?.matches);
function subscribeMotion(listener) {
  const query = motionQuery();
  query?.addEventListener?.("change", listener);
  return () => query?.removeEventListener?.("change", listener);
}
const pageVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
function subscribePage(listener) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

export default function AnimatedPrivateImage({ src, alt = "自定义表情", className, buttonClassName, onPreview, scopeKey = "", width, height }) {
  const container = useRef(null);
  const [visibility, setVisibility] = useState(null);
  const [choice, setChoice] = useState(null);
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotion, () => true);
  const foreground = useSyncExternalStore(subscribePage, pageVisible, () => false);
  const observes = typeof IntersectionObserver === "function";
  const visible = !observes || (visibility?.src === src && visibility.visible);
  const seen = !observes || (visibility?.src === src && visibility.seen);
  const media = usePrivateMediaSource(src, { enabled: seen, scopeKey });
  const paused = choice === "pause" || (reduced && choice !== "play");
  const poster = usePrivateMediaSource(stickerPosterPath(src), { enabled: Boolean(seen && media.animated && paused && visible && foreground), scopeKey });
  const displayed = media.animated && paused ? poster : media;
  const ratio = Number(width) > 0 && Number(height) > 0 ? `${Number(width)} / ${Number(height)}` : "1";

  useEffect(() => {
    if (!observes || !container.current) return;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!active) return;
      const entry = entries.find(item => item.target === container.current);
      if (!entry) return;
      setVisibility(current => ({ src, visible: entry.isIntersecting, seen: entry.isIntersecting || (current?.src === src && current.seen) }));
    });
    observer.observe(container.current);
    return () => { active = false; observer.disconnect(); };
  }, [src, observes]);

  const image = visible && foreground && displayed.url ? (
    <img src={displayed.url} alt={alt} className={className} decoding="async" />
  ) : (
    <span className={`private-media-placeholder${className ? ` ${className}` : ""}`} role={displayed.error ? "status" : undefined}>
      {displayed.error ? "图片暂时无法显示" : ""}
    </span>
  );
  return (
    <span ref={container} className="animated-sticker" data-playing={Boolean(visible && foreground && media.animated && !paused && media.url)}>
      {onPreview ? (
        <button type="button" className={`animated-sticker-frame ${buttonClassName || ""}`} style={{ aspectRatio: ratio }}
          disabled={!displayed.url || !visible || !foreground} aria-label={`查看${alt}`} onClick={() => onPreview(displayed.url, alt)}>
          {image}
        </button>
      ) : <span className="animated-sticker-frame" style={{ aspectRatio: ratio }}>{image}</span>}
      {media.animated && <button type="button" className="animated-sticker-toggle" aria-pressed={!paused}
        onClick={() => setChoice(paused ? "play" : "pause")}>
        {paused ? "播放动图" : "暂停动图"}
      </button>}
      {media.animated && paused && poster.error && <small role="status">静态预览暂时无法显示，请重新打开图片重试。</small>}
    </span>
  );
}
