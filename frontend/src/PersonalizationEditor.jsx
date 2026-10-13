import { useId, useLayoutEffect, useRef, useState } from "react";
import { Clipboard } from "@capacitor/clipboard";
import { Capacitor } from "@capacitor/core";
import { Copy, FileText, Maximize2, Minimize2 } from "lucide-react";
import {
  appendPersonalizationText,
  PERSONALIZATION_TEXT_FILE_ACCEPT,
  readPersonalizationTextFile,
} from "./personalization-editor.js";
import usePersonalizationCharacterCount from "./use-personalization-character-count.js";
import "./personalization-editor.css";

export default function PersonalizationEditor({
  field,
  label,
  value = "",
  onChange,
  placeholder = "",
  rows = 8,
  disabled = false,
  scopeKey = field,
}) {
  const id = useId();
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const latestRef = useRef({ value, onChange, disabled });
  const operationRef = useRef(0);
  const aliveRef = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [operation, setOperation] = useState({ scopeKey, reading: false, message: "", error: false });
  const characters = usePersonalizationCharacterCount(value);
  const currentOperation = operation.scopeKey === scopeKey ? operation : { reading: false, message: "", error: false };

  useLayoutEffect(() => {
    latestRef.current = { value, onChange, disabled };
  }, [value, onChange, disabled]);

  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      operationRef.current += 1;
    };
  }, [scopeKey]);

  useLayoutEffect(() => {
    if (!disabled) return;
    const requestId = ++operationRef.current;
    queueMicrotask(() => {
      if (!aliveRef.current || requestId !== operationRef.current) return;
      setOperation((previous) => previous.scopeKey === scopeKey && previous.reading
        ? { scopeKey, reading: false, message: "本次导入已取消，当前内容保持原样。", error: false }
        : previous);
    });
  }, [disabled, scopeKey]);

  function updateText(nextValue) {
    latestRef.current.value = nextValue;
    onChange(nextValue);
  }

  function toggleExpanded() {
    setExpanded((previous) => !previous);
    editorRef.current?.focus({ preventScroll: true });
  }

  async function importText(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || disabled) return;
    const requestId = ++operationRef.current;
    setOperation({ scopeKey, reading: true, message: "正在完整读取文本…", error: false });
    try {
      const imported = await readPersonalizationTextFile(file);
      if (!aliveRef.current || requestId !== operationRef.current) return;
      if (latestRef.current.disabled) {
        setOperation({ scopeKey, reading: false, message: "本次导入已取消，当前内容保持原样。", error: false });
        return;
      }
      const latest = latestRef.current;
      if (imported.length > 0) {
        const nextValue = appendPersonalizationText(latest.value, imported);
        latest.value = nextValue;
        latest.onChange(nextValue);
      }
      setOperation({ scopeKey, reading: false, message: imported.length > 0 ? "完整文本已加入，等待页面保存。" : "文件为空，当前内容保持原样。", error: false });
    } catch (error) {
      if (!aliveRef.current || requestId !== operationRef.current) return;
      setOperation({ scopeKey, reading: false, message: error.message || "读取失败，请重新选择纯文本文件。", error: true });
    }
  }

  async function copyText() {
    const requestId = operationRef.current;
    try {
      const text = latestRef.current.value;
      if (Capacitor.isNativePlatform()) {
        await Clipboard.write({ string: text });
      } else if (globalThis.navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("clipboard_unavailable");
      }
      if (!aliveRef.current || requestId !== operationRef.current) return;
      setOperation({ scopeKey, reading: false, message: "完整原文已复制。", error: false });
    } catch {
      if (!aliveRef.current || requestId !== operationRef.current) return;
      setOperation({ scopeKey, reading: false, message: "复制暂不可用，可以在输入框中全选后复制。", error: true });
    }
  }

  return (
    <div className={`personalization-editor${expanded ? " is-expanded" : ""}`}>
      <div className="personalization-editor-toolbar">
        <output className="personalization-editor-count" aria-label={`${label}字符数`}>
          {characters === null ? "正在统计…" : `${characters.toLocaleString("zh-CN")} 个字符`}
        </output>
        <button type="button" className="personalization-editor-expand" aria-expanded={expanded} aria-controls={`${id}-text`} onClick={toggleExpanded}>
          {expanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
          {expanded ? "收起编辑" : "展开编辑"}
        </button>
      </div>
      <textarea
        ref={editorRef}
        id={`${id}-text`}
        aria-label={label}
        aria-describedby={`${id}-hint`}
        data-setting-field={field}
        value={value}
        onChange={(event) => updateText(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        spellCheck={false}
      />
      <div className="personalization-editor-actions">
        <button type="button" disabled={disabled || currentOperation.reading} onClick={() => fileRef.current?.click()}>
          <FileText size={14} aria-hidden="true" />
          {currentOperation.reading ? "读取中…" : "导入文本"}
        </button>
        <button type="button" disabled={disabled || currentOperation.reading || value.length === 0} onClick={() => void copyText()}>
          <Copy size={14} aria-hidden="true" />复制原文
        </button>
        <input ref={fileRef} type="file" accept={PERSONALIZATION_TEXT_FILE_ACCEPT} aria-label={`导入${label}文本`} hidden disabled={disabled} onChange={(event) => void importText(event)} />
      </div>
      <p id={`${id}-hint`} className="personalization-editor-hint">导入文本会接在当前内容之后；空格与换行完整保留。输入不设固定字数上限，保存容量与模型单轮上下文容量不同。</p>
      {currentOperation.message && <p className={`personalization-editor-feedback${currentOperation.error ? " is-error" : ""}`} role={currentOperation.error ? "alert" : "status"}>{currentOperation.message}</p>}
    </div>
  );
}
