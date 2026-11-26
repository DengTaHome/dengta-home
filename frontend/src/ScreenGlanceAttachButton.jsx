import { useEffect, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import { captureBrowserScreenSheet } from "./screen-glance-browser.js";

export default function ScreenGlanceAttachButton({ scope, disabled, onAttachment, onNotice }) {
  const [busy, setBusy] = useState(false);
  const run = useRef(null);
  useEffect(() => () => {
    run.current = null;
  }, [scope]);

  if (!globalThis.navigator?.mediaDevices?.getDisplayMedia) return null;

  async function capture() {
    if (run.current) return;
    const captureId = Symbol();
    run.current = captureId;
    setBusy(true);
    try {
      const file = await captureBrowserScreenSheet(() => run.current === captureId);
      if (file && run.current === captureId) {
        await onAttachment(file, () => run.current === captureId);
      }
    } catch (error) {
      if (run.current === captureId) {
        onNotice(error.name === "NotAllowedError" ? "已取消屏幕选择。" : "未能生成屏幕图片，请重新选择窗口。");
      }
    } finally {
      if (run.current === captureId) {
        run.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <button type="button" disabled={disabled || busy}
      onClick={() => void capture()}>
      <Monitor size={18} aria-hidden="true" />
      <strong>{busy ? "正在选取画面…" : "屏幕画面"}</strong>
      <small>预览后随消息发送</small>
    </button>
  );
}
