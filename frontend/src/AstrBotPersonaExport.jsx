import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { settingsServiceErrorMessage } from "./settings-service-errors";

export default function AstrBotPersonaExport({ disabled }) {
  const [includeDetails, setIncludeDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(null);
  useEffect(() => () => active.current?.abort(), []);

  async function download() {
    if (active.current) return;
    const operation = new AbortController();
    active.current = operation;
    setBusy(true);
    setMessage("");
    try {
      const payload = await apiRequest(
        `/settings/astrbot-persona?include_user_details=${includeDetails}`,
        { signal: operation.signal },
      );
      if (operation.signal.aborted) return;
      const filename = "DengTa-AstrBot-persona.json";
      const content = JSON.stringify(payload, null, 2);
      if (typeof window.DengTaFileBridge?.saveExport === "function") {
        const bytes = new TextEncoder().encode(content);
        const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
        window.DengTaFileBridge.saveExport("data:text/plain;charset=utf-8;base64," + btoa(binary), filename);
      } else {
        const blob = new Blob([content], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      setMessage("已生成文件，可导入你自己的 AstrBot。");
    } catch (error) {
      if (!operation.signal.aborted) {
        setMessage(settingsServiceErrorMessage(error, "人格导出失败，请稍后重试。"));
      }
    } finally {
      active.current = null;
      if (!operation.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="prompt-layer">
      <strong>导出给 AstrBot</strong>
      <p>下载当前伴侣已保存的人格，用在自己的大肥鱼或 QQ 机器人。导出范围仅包括人格，下面可选附上你的详情。</p>
      <label>
        <input type="checkbox" checked={includeDetails} disabled={busy || disabled}
          onChange={(event) => setIncludeDetails(event.target.checked)} />
        同时导出「你的详情」
      </label>
      <button type="button" disabled={busy || disabled} onClick={() => void download()}>
        {busy ? "正在导出…" : "下载人格文件"}
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
