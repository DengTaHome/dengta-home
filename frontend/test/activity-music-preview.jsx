import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Together from "../src/Together.jsx";
import ActivityReturnBar from "../src/ActivityReturnBar.jsx";
import { createActivityReturn, resolveActivityReturn } from "../src/activity-return.js";
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

const identity = { accountScope: "preview-fictional-account", companionScope: "preview-fictional-companion" };
const confirmed = { id: "preview-fictional-activity", status: "active", sessionMode: "listening", title: "星光唱片 · 虚构音乐活动与很长的标题用于窄屏检查" };
const pending = [];
let providerConnected = true, providerName = "虚构旧网易账号";
globalThis.__activityMusicFixture = {
  auth: { getSnapshot: () => ({ user: { id: identity.accountScope }, activeCompanionId: identity.companionScope }), getRequestContext: async () => ({ accessToken: "fictional-placeholder", companionId: identity.companionScope }) },
  async request(path, options = {}) {
    if (path === "/api/v2/music/providers/netease/cookie-session") {
      if (options.method === "DELETE") providerConnected = false;
      if (options.method === "POST") { providerConnected = true; providerName = "虚构新网易账号"; }
      return { session: { connected: providerConnected, account_name: providerConnected ? providerName : "" } };
    }
    if (path.endsWith("/cookie/my-playlists")) return new Promise(resolve => pending.push(resolve));
    if (path === "/api/v2/music/playlists") return { playlists: [] };
    if (path === "/api/v2/music/favorites") return { favorites: [] };
    if (path.endsWith("/connections/manage")) return { connections: [] };
    throw Object.assign(new Error("虚构预览未定义此操作"), { code: "fixture_operation_unavailable" });
  },
};

export default function Preview() {
  const [night, setNight] = useState(false), [bookmark, setBookmark] = useState(() => createActivityReturn(confirmed, identity, "music"));
  const [session, setSession] = useState(confirmed), [view, setView] = useState("chat"), [feedback, setFeedback] = useState("本次虚构活动已确认；未播放音频。");
  useEffect(() => {
    applyThemePreferences(DEFAULT_THEME_PREFERENCES, getCelestialSnapshot(new Date("2026-10-08T04:00:00Z"), night ? "night" : "day"), document.documentElement);
  }, [night]);
  return <main className="activity-music-fixture">
    <header><small>灯塔 · 实际组件验收</small><h1>活动轻松接着玩</h1><p>虚构账号和回执；没有真实登录、音频播放或后端写入。</p>
      <nav aria-label="预览控制">
        <button onClick={() => setNight(value => !value)}>{night ? "切换日间" : "切换夜间"}</button>
        <button onClick={() => { setSession(confirmed); setBookmark(createActivityReturn(confirmed, identity, "music")); setView("chat"); }}>恢复虚构入口</button>
        <button onClick={() => { setSession({ ...confirmed, status: "ended" }); }}>结束虚构活动</button>
        <button onClick={() => { for (const deliver of pending.splice(0)) deliver({ owned: [{ playlist_id: "123", name: "虚构旧账号私有歌单", item_count: 1 }], subscribed: [] }); setFeedback("迟到的旧歌单回执已送达组件。"); }}>送回旧歌单</button>
      </nav>
    </header>
    <section className="fixture-chat" aria-label="虚构聊天区">
      <p>虚构伴侣：聊到一半，也能轻松回到刚才的音乐。</p>
      {view === "chat" && <ActivityReturnBar activity={resolveActivityReturn(bookmark, identity, session)} onDismiss={() => setBookmark(null)} onOpen={() => {
        const destination = resolveActivityReturn(bookmark, identity, session);
        if (destination) { setView(destination.view); setFeedback("已返回一起听页面；没有自动播放。"); }
      }} />}
      <p role="status">{feedback}</p>
    </section>
    <Together key="fictional-music-panel" viewKind="music" aiName="虚构伴侣" {...identity} screenState={{}} feedback={{}} />
  </main>;
}

const style = document.createElement("style");
style.textContent = `html,body,#root { height:auto!important; min-height:100%; overflow:visible; } body { margin:0; background:var(--theme-background); color:var(--theme-ink); } #root { background:transparent; } .activity-music-fixture { max-width:800px; margin:auto; padding:16px; } .activity-music-fixture>header { padding:8px; } .activity-music-fixture h1 { font-size:26px; } .activity-music-fixture header p { font-size:13px; line-height:1.7; } .activity-music-fixture nav { display:flex; gap:8px; flex-wrap:wrap; } .activity-music-fixture nav button { min-height:44px; padding:8px 12px; color:inherit; background:rgb(var(--theme-card-rgb) / .8); border:1px solid var(--theme-control-border); border-radius:12px; font:inherit; font-size:13px; } .fixture-chat { margin:16px 0; } .fixture-chat>p { font-size:13px; line-height:1.6; }`;
document.head.append(style);
const root = import.meta.hot?.data.root || createRoot(document.getElementById("root"));
if (import.meta.hot) import.meta.hot.dispose(data => { data.root = root; style.remove(); });
root.render(<Preview />);
