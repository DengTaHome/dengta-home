import { useState } from "react";
import { createRoot } from "react-dom/client";
import FeatureNavigation from "../src/FeatureNavigation.jsx";
import WorkspaceManager from "../src/WorkspaceManager.jsx";
import { FEATURE_LABELS } from "../src/feature-navigation.js";
import "../src/index.css";
import "../src/native-feel.css";
import "../src/settings-media-polish.css";

const items = Object.entries(FEATURE_LABELS).map(([id, label]) => ({ id, label, icon: "✧" }));
export default function Preview() {
  const [activeView, setActiveView] = useState("workspace");
  return <main className="audit-fixture">
    <header><p>灯塔 · 功能体验预览</p><h1>想做什么，轻松找到</h1><p>虚构文件与账号，只验证界面和操作，不调用真实模型。</p></header>
    <div className="audit-fixture-grid"><aside><FeatureNavigation items={items} activeView={activeView} onNavigate={setActiveView} /><p role="status">当前入口：{FEATURE_LABELS[activeView]}</p></aside><WorkspaceManager accountScope="browser-fixture-a" /></div>
  </main>;
}
const style = document.createElement("style");
style.textContent = `body { margin:0; background:#f5f2ed; color:#332b29; } .audit-fixture { max-width:1100px; margin:auto; padding:24px; } .audit-fixture>header { margin-bottom:24px; } .audit-fixture h1 { font-size:28px; margin:8px 0; } .audit-fixture-grid { display:grid; grid-template-columns:260px minmax(0,1fr); gap:28px; } .audit-fixture aside { background:#ffffffb8; padding:12px; border-radius:20px; min-width:0; } .audit-fixture .workspace-view { min-width:0; } .audit-fixture textarea { box-sizing:border-box; max-width:100%; } @media(max-width:680px) { .audit-fixture { padding:16px; } .audit-fixture-grid { grid-template-columns:minmax(0,1fr); gap:20px; } .audit-fixture .feature-navigation { max-height:290px; } }`;
style.textContent += "html,body,#root { height:auto!important; min-height:100%; overflow:visible!important; } .audit-fixture aside { background:#332b2f; color:#f7f2ed; }";
document.head.append(style);
createRoot(document.getElementById("root")).render(<Preview />);
