import { useCallback, useState } from "react";
import {
  PARTIAL_REPLY_COPIED,
  PARTIAL_REPLY_COPY,
  PARTIAL_REPLY_NOTE,
} from "./partial-reply.js";

/**
 * 「生成中断 · 已保留当时内容」提示条 + 复制按钮。
 *
 * 结构中线上产物（assets/App-Bnlv_57K.js）里的 partial-reply-note：
 * 提示文字 + 一个复制片段的按钮，复制成功后短暂显示「已复制」。
 */
export default function PartialReplyNote({ content }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    const text = typeof content === "string" ? content : "";
    if (!text) return;
    try {
      await globalThis.navigator?.clipboard?.writeText?.(text);
      setCopied(true);
      globalThis.setTimeout?.(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时保持原状：至少提示条还在，用户能手动选中。
    }
  }, [content]);

  return (
    <div className="partial-reply-note" role="note">
      <span>{PARTIAL_REPLY_NOTE}</span>
      <button type="button" onClick={copy}>
        {copied ? PARTIAL_REPLY_COPIED : PARTIAL_REPLY_COPY}
      </button>
    </div>
  );
}
