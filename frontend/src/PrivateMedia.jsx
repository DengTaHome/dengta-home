import { useEffect, useRef, useState } from "react";
import { usePrivateMediaSource } from "./use-private-media";

export function AuthenticatedImage({
  src,
  alt = "",
  className,
  buttonClassName,
  loading = "lazy",
  onPreview,
  fallback = null,
  scopeKey = "",
}) {
  const placeholderRef = useRef(null);
  const [visibleSource, setVisibleSource] = useState(null);
  const needsObservation = loading !== "eager" && typeof IntersectionObserver === "function";
  const mayLoad = !needsObservation || visibleSource === src;
  const media = usePrivateMediaSource(src, { enabled: mayLoad, scopeKey });

  useEffect(() => {
    if (mayLoad || !placeholderRef.current) return;
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (!active || !entries.some((entry) => entry.isIntersecting)) return;
      setVisibleSource(src);
      observer.disconnect();
    });
    observer.observe(placeholderRef.current);
    return () => { active = false; observer.disconnect(); };
  }, [mayLoad, src]);

  if (!mayLoad || media.loading) {
    return (
      <span
        ref={placeholderRef}
        className={`private-media-placeholder is-loading${className ? ` ${className}` : ""}`}
        aria-label="图片加载中"
      />
    );
  }
  if (!media.url) {
    if (fallback) return fallback;
    return (
      <span
        className="private-media-placeholder is-error"
        role="status"
        title={media.error}
      >
        图片暂时无法显示
      </span>
    );
  }

  const image = (
    <img
      className={className}
      src={media.url}
      alt={alt}
      loading={loading}
      decoding="async"
    />
  );
  if (!onPreview) return image;
  return (
    <button
      type="button"
      className={buttonClassName}
      aria-label={alt ? `查看${alt}` : "查看图片"}
      onClick={() => onPreview(media.url, alt)}
    >
      {image}
    </button>
  );
}
