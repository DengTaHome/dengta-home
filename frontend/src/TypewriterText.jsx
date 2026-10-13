import { useEffect, useState } from "react";

// 通用打字机组件：把文本按字逐字显示（默认 22ms/字）。
// text 变化时自动从头重新打字；onDone 在整段打完时回调。
export default function TypewriterText({ text, stepMs = 22, onDone }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    const full = String(text || "");
    let index = 0;
    if (!full) {
      onDone?.();
      return undefined;
    }
    const timer = setInterval(() => {
      index += 1;
      setShown(full.slice(0, index));
      if (index >= full.length) {
        clearInterval(timer);
        onDone?.();
      }
    }, stepMs);
    return () => clearInterval(timer);
  }, [text, stepMs, onDone]);
  return <>{shown}</>;
}