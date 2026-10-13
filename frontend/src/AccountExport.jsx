import { useCallback, useState } from "react";
import { Download, FileCode, FileJson, FileText, FileType, ShieldCheck } from "lucide-react";
import { apiRequest } from "./api.js";

const EXPORT_FORMATS = [
  { id: "md", label: "Markdown（.md）", hint: "人类可读的总聊天记录：按模块、按时间整理，可直接导入蒸馏", Icon: FileText },
  { id: "json", label: "JSON（.json）", hint: "结构化完整数据，适合程序读取与长期备份", Icon: FileJson },
  { id: "txt", label: "纯文本（.txt）", hint: "去掉格式的纯文字版，兼容性最好", Icon: FileType },
  { id: "html", label: "网页（.html）", hint: "带样式的网页文档，浏览器直接打开", Icon: FileCode },
];

function base64FromUtf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function hasNativeBridge() {
  return typeof window !== "undefined" && window.DengTaFileBridge?.saveExport === "function";
}

export default function AccountExport({ api = apiRequest } = {}) {
  const [format, setFormat] = useState("md");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const runExport = useCallback(async () => {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const data = await api("/api/account/export", {
        method: "POST",
        timeoutMs: 180000,
        body: JSON.stringify({ format }),
      });
      const filename = data?.filename || `dengta-export.${format}`;
      const content = data?.content || "";
      const sizeBytes = Number(data?.size) || 0;
      if (!content) throw new Error("导出内容为空，请稍后重试。");
      if (hasNativeBridge()) {
        const dataUrl = "data:text/plain;charset=utf-8;base64," + base64FromUtf8(content);
        window.DengTaFileBridge.saveExport(dataUrl, filename);
        setFeedback(`已导出 ${filename}（${Math.max(1, Math.round(sizeBytes / 1024))} KB），保存在 App 文件夹 files/export/ 下。`);
      } else {
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
        setFeedback(`已导出 ${filename}（${Math.max(1, Math.round(sizeBytes / 1024))} KB）。`);
      }
    } catch (caught) {
      setError(caught?.message || "导出失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }, [format, api]);

  return (
    <div className="settings-card account-export-card">
      <div className="prompt-settings-heading">
        <div>
          <h3>导出全部数据</h3>
          <p className="card-hint">
            把账号下的所有内容按模块整理成一份总记录：聊天记录、人设提示词、记忆、绘画与创作、视频与音乐记忆、日记、时刻、成就、外部连接等一切内容。文件扩展名可自选，导出的文件也可以再导入用于蒸馏或迁移。
          </p>
        </div>
        <span className="prompt-compatibility-badge">备份 / 迁移 / 蒸馏</span>
      </div>

      <div className="account-export-formats">
        {EXPORT_FORMATS.map((entry) => (
          <label key={entry.id} className={"account-export-format" + (format === entry.id ? " is-active" : "")}>
            <input
              type="radio"
              name="export-format"
              value={entry.id}
              checked={format === entry.id}
              onChange={() => setFormat(entry.id)}
            />
            <entry.Icon aria-hidden="true" />
            <span>
              <strong>{entry.label}</strong>
              <small>{entry.hint}</small>
            </span>
          </label>
        ))}
      </div>

      <div className="account-export-actions">
        <button type="button" className="together-primary" disabled={busy} onClick={() => void runExport()}>
          <Download aria-hidden="true" />
          {busy ? "正在整理导出…" : "导出全部数据"}
        </button>
        <span className="account-export-note">
          <ShieldCheck aria-hidden="true" />
          外部登录凭据（Cookie / Token / 密钥）不会导出。
        </span>
      </div>

      {feedback && <p className="music-provider-feedback" role="status">{feedback}</p>}
      {error && <p className="music-provider-feedback music-provider-error" role="alert">{error}</p>}
    </div>
  );
}
