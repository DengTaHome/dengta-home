import { useEffect, useState } from "react";
import WorkspaceManager from "../src/WorkspaceManager.jsx";
import { applyThemePreferences, DEFAULT_THEME_PREFERENCES, getCelestialSnapshot } from "../src/dengta-theme.js";
import "../src/index.css";
import "../src/App.css";
import "../src/cozy-theme.css";
import "../src/native-feel.css";
import "../src/apple-ui.css";
import "../src/sun-glass-ui.css";
import "../src/typography.css";
import "../src/apple-high.css";
import "../src/interface-polish.css";

export default function Preview() {
  const [night, setNight] = useState(false), [generation, setGeneration] = useState(0);
  useEffect(() => {
    applyThemePreferences(DEFAULT_THEME_PREFERENCES, getCelestialSnapshot(new Date("2026-10-08T04:00:00Z"), night ? "night" : "day"), document.documentElement);
  }, [night]);
  async function malformedWrite() {
    await fetch("/_fixture/control", { method: "POST", body: JSON.stringify({ workspaceMalformed: true }) });
  }
  return <main className="app-shell workspace-flow-preview">
    <h1>工作区操作验收</h1>
    <p>真实组件、本地虚构文件和回执；不登录真实账号，不改用户资料。</p>
    <nav aria-label="验收操作">
      <button onClick={() => setNight(value => !value)}>切换{night ? "日间" : "夜间"}</button>
      <button onClick={malformedWrite}>下一次保存返回异常回执</button>
      <button onClick={() => setGeneration(value => value + 1)}>重新打开工作区</button>
    </nav>
    <WorkspaceManager key={generation} accountScope="round14-fictional-account" />
  </main>;
}
