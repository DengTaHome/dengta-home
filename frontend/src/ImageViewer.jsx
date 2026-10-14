import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useSettingsSheetNavigation } from "./useSettingsSheetNavigation.js";

export default function ImageViewer({ image, scopeKey, onClose }) {
  const panelRef = useRef(null);
  const current = image.scopeKey === scopeKey;
  useSettingsSheetNavigation({ isOpen: current, scopeKey, panelRef, onClose });
  useEffect(() => {
    if (!current) onClose();
  }, [current, onClose]);
  if (!current || typeof document === "undefined") return null;

  return createPortal(
    <div className="image-viewer" role="dialog" aria-modal="true"
      aria-label="图片预览" tabIndex={-1} ref={panelRef}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <button type="button" className="image-viewer-close"
        aria-label="关闭图片预览" onClick={onClose}>×</button>
      <img src={image.url} alt={image.alt || "图片预览"} />
    </div>,
    document.body,
  );
}
