import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrainCircuit, DatabaseZap, FileDown, Mic2, MonitorSmartphone, Music, Palette, ScrollText, ServerCog, Trophy } from "lucide-react";
import SettingsHome from "../src/SettingsHome.jsx";
import { applyThemePreferences, DEFAULT_THEME_PREFERENCES, getCelestialSnapshot } from "../src/dengta-theme.js";
import "../src/index.css";
import "../src/App.css";
import "../src/sun-glass-ui.css";

applyThemePreferences(DEFAULT_THEME_PREFERENCES, getCelestialSnapshot(new Date("2026-10-06T04:00:00Z"), "day"), document.documentElement);

const categories = [
  { id: "appearance", label: "外观与聊天", Icon: Palette },
  { id: "persona", label: "个性化与记忆", Icon: BrainCircuit },
  { id: "services", label: "模型与服务", Icon: ServerCog },
  { id: "voice", label: "语音与情绪", Icon: Mic2 },
  { id: "devices", label: "设备与共看", Icon: MonitorSmartphone },
  { id: "fun", label: "成就与新玩法", Icon: Trophy },
  { id: "data-import", label: "数据导入", Icon: DatabaseZap },
  { id: "data-export", label: "数据导出", Icon: FileDown },
  { id: "music-import", label: "音乐导入", Icon: Music },
  { id: "logs", label: "错误日志", Icon: ScrollText },
];

export default function SettingsHomePreview() {
  const [selected, setSelected] = useState("");
  return (
    <main className="feature-page settings-page" style={{ width: "min(100%, 820px)", minWidth: 0, margin: "0 auto", padding: "20px" }}>
      <div className="section-intro"><div><span className="eyebrow">控制中心</span><h2>AI 与应用设置</h2><p>选择你现在需要的设置。</p></div></div>
      <SettingsHome categories={categories} onSelectCategory={setSelected} />
      <output aria-live="polite">{selected ? `打开入口：${selected}` : "独立预览：未连接账号或接口"}</output>
    </main>
  );
}

const previewRoot = import.meta.hot?.data.previewRoot || createRoot(document.getElementById("root"));
if (import.meta.hot) import.meta.hot.data.previewRoot = previewRoot;
previewRoot.render(<SettingsHomePreview />);
