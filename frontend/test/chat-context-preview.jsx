import { useState } from "react";
import { createRoot } from "react-dom/client";
import ChatContextSettings from "../src/ChatContextSettings.jsx";
import "../src/index.css";

export default function Preview() {
  const [settings, setSettings] = useState({ context_turns: 50, compression_threshold: 8000 });
  return <main className="settings-card" style={{ padding: 20, maxWidth: 560, margin: "24px auto" }}>
    <h1>聊天记忆范围</h1>
    <p className="card-hint">交互预览使用模拟设置，不读写真实账号。</p>
    <ChatContextSettings settings={settings} onChange={(field, value) => setSettings(current => ({ ...current, [field]: value }))} />
    <p role="status">{Number(settings.compression_threshold) === 0 ? "自动压缩阈值随模型容量调整" : "当前压缩阈值：8,000 token"}</p>
  </main>;
}
const previewRoot = import.meta.hot?.data.root || createRoot(document.getElementById("root"));
if (import.meta.hot) import.meta.hot.data.root = previewRoot;
previewRoot.render(<Preview />);
