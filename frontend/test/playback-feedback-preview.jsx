import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Together from "../src/Together.jsx";
import BilibiliQrLogin from "../src/BilibiliQrLogin.jsx";
import { applyThemePreferences, DEFAULT_THEME_PREFERENCES, getCelestialSnapshot } from "../src/dengta-theme.js";
import "../src/index.css";
import "../src/App.css";
import "../src/cozy-theme.css";
import "../src/native-feel.css";
import "../src/apple-ui.css";
import "../src/sun-glass-ui.css";
import "../src/jelly-motion.css";
import "../src/sun-glass-chat.css";
import "../src/typography.css";
import "../src/apple-high.css";
import "../src/room-invite.css";
import "../src/settings-media-polish.css";
import "../src/interaction-polish.css";
import "../src/interface-polish.css";

export default function Preview() {
  const [web, setWeb] = useState(false), [night, setNight] = useState(false), [busy, setBusy] = useState(false), [qrPanel, setQrPanel] = useState(false);
  const [active, setActive] = useState(true), [incoming, setIncoming] = useState(null);
  const [feedback, setFeedback] = useState({ status: "idle", message: "虚构会话已读取" });
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    applyThemePreferences(DEFAULT_THEME_PREFERENCES, getCelestialSnapshot(new Date("2026-10-08T04:00:00Z"), night ? "night" : "day"), document.documentElement);
  }, [night]);
  return <main className="playback-fixture">
    <header><small>灯塔 · 共看反馈验收</small><h1>推荐与共看交接</h1><p>实际共看组件，虚构回执。没有音视频源、真实账号或模型请求。</p>
      <nav aria-label="预览控制"><button disabled={busy} onClick={() => { setWeb(value => !value); setFeedback({ status: "idle", message: "虚构会话已读取" }); }}>{web ? "查看直链模式" : "查看网页模式"}</button><button onClick={() => setNight(value => !value)}>{night ? "切换日间" : "切换夜间"}</button><button onClick={() => setQrPanel(value => !value)}>{qrPanel ? "收起扫码登录面板" : "查看扫码登录面板"}</button></nav>
      <nav aria-label="推荐验收控制"><button onClick={() => setIncoming({ id: "fictional-selection", query: "虚构待选影片：月光航线", pageUrl: "https://www.bilibili.com/video/BV1234567890" })}>传入虚构推荐</button><button onClick={() => setActive(false)}>结束虚构活动</button></nav>
    </header>
    {qrPanel && <aside className="together-page" aria-label="虚构扫码面板"><BilibiliQrLogin /></aside>}
    <Together key={String(web)} aiName="虚构伴侣" accountScope="preview-fictional-account" companionScope="preview-fictional-companion" watchRequest={incoming} externalPageUrl={incoming?.pageUrl || ""} session={{ id: "fictional-session", status: active ? "active" : "ended", title: "虚构的夜航片段", sourceApp: web ? "dengta-web-page" : "dengta-direct-media", mediaPositionSeconds: 0, frameCount: 0, reactionCount: 0 }} screenState={{}} feedback={feedback} busy={busy} onRefresh={() => setFeedback({ status: "idle", message: "虚构状态已核对，没有写入" })} onReply={() => {
      setBusy(true);
      return new Promise(resolve => { timer.current = setTimeout(() => {
        setBusy(false); setFeedback({ status: "error", message: "共看服务返回的回复格式不完整，本次未确认成功，输入仍保留。请先刷新当前对话核对，再决定重试。（错误代码：co_watch_reply_receipt_invalid）" }); resolve(false);
      }, 1200); });
    }} />
  </main>;
}
const style = document.createElement("style");
style.textContent = `html,body,#root { height:auto!important; min-height:100%; overflow:visible; } body { margin:0; background:var(--theme-background); color:var(--theme-ink); } #root { background:transparent; } .playback-fixture { max-width:1060px; margin:auto; padding:16px; } .playback-fixture>header { padding:8px; } .playback-fixture nav { display:flex; gap:8px; flex-wrap:wrap; } .playback-fixture nav button { min-height:44px; padding:8px 12px; color:inherit; background:rgb(var(--theme-card-rgb) / .8); border:1px solid var(--theme-control-border); border-radius:12px; font:inherit; }`;
document.head.append(style);
const root = import.meta.hot?.data.root || createRoot(document.getElementById("root"));
if (import.meta.hot) import.meta.hot.dispose(data => { data.root = root; style.remove(); });
root.render(<Preview />);
