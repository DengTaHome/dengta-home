import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TogetherMusic from "../src/TogetherMusic.jsx";
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
import "../src/together.css";

const wav = new ArrayBuffer(44 + 8_000 * 2 * 120), bytes = new DataView(wav);
const ascii = (offset, value) => { for (let i = 0; i < value.length; i++) bytes.setUint8(offset + i, value.charCodeAt(i)); };
ascii(0, "RIFF"); bytes.setUint32(4, wav.byteLength - 8, true); ascii(8, "WAVEfmt "); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true); bytes.setUint32(24, 8_000, true); bytes.setUint32(28, 16_000, true); bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true); ascii(36, "data"); bytes.setUint32(40, wav.byteLength - 44, true);
const silentUrl = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
const playlist = { id: "preview-fictional-playlist", name: "虚构音乐验收歌单", items: [
  { id: "preview-fictional-local", title: "无声片段 · 本机测试曲目", artist: "虚构作者", playback_mode: "local_blob", url: silentUrl },
  { id: "preview-fictional-external", title: "外部曲目 · 手动记录", artist: "虚构作者", playback_mode: "external_netease", provider_track_id: "1001" },
] };
let identity = { accountScope: "preview-moments-account-a", companionScope: "preview-moments-companion" }, failNext = false;
globalThis.__musicMomentsFixture = {
  auth: { getSnapshot: () => ({ user: { id: identity.accountScope }, activeCompanionId: identity.companionScope }), getRequestContext: async () => ({ accessToken: "fictional-placeholder", companionId: identity.companionScope }) },
  async request(path, options = {}) {
    if (options.method && options.method !== "GET") throw Object.assign(new Error("虚构预览不允许外部写入"), { code: "fixture_write_disabled" });
    if (path.endsWith("/cookie-session")) return { session: { connected: true, account_name: "虚构网易云账号" } };
    if (path.endsWith("/cookie/my-playlists")) {
      await new Promise(resolve => setTimeout(resolve, 800));
      if (failNext) { failNext = false; throw Object.assign(new Error("虚构读取失败"), { code: "fixture_read_failed" }); }
      return { owned: [], subscribed: [] };
    }
    if (path.endsWith(`/playlists/${playlist.id}`)) return { playlist };
    if (path.endsWith("/playlists")) return { playlists: [playlist] };
    if (path.endsWith("/favorites")) return { favorites: [] };
    if (path.endsWith("/connections/manage")) return { connections: [] };
    throw Object.assign(new Error("虚构预览未定义此操作"), { code: "fixture_operation_unavailable" });
  },
};

export default function Preview() {
  const [night, setNight] = useState(false), [scope, setScope] = useState(identity);
  useEffect(() => { applyThemePreferences(DEFAULT_THEME_PREFERENCES, getCelestialSnapshot(new Date("2026-10-08T04:00:00Z"), night ? "night" : "day"), document.documentElement); }, [night]);
  return <main className="music-moments-fixture"><header><small>灯塔 · 实际组件验收</small><h1>留住一起听的这一刻</h1><p>虚构账号和接口；只载入零采样无声 WAV，不开始播放，无真实后端写入。</p><nav aria-label="预览控制">
    <button onClick={() => setNight(value => !value)}>{night ? "切换日间" : "切换夜间"}</button>
    <button onClick={() => { const audio = document.querySelector("audio"); if (audio?.readyState >= 1) audio.currentTime = 31; }}>预览：定位到31秒</button>
    <button onClick={() => { failNext = true; }}>预览：下一次歌单读取失败</button>
    <button onClick={() => { identity = { ...identity, accountScope: identity.accountScope.endsWith("-a") ? "preview-moments-account-b" : "preview-moments-account-a" }; setScope(identity); }}>预览：切换虚构账号</button>
  </nav></header><div className="together-page"><section className="together-control-card"><TogetherMusic key={JSON.stringify(scope)} {...scope} /></section></div></main>;
}
const style = document.createElement("style");
style.textContent = `html,body,#root{height:auto!important;min-height:100%;overflow:visible}body{margin:0;background:var(--theme-background);color:var(--theme-ink)}#root{background:transparent}.music-moments-fixture{max-width:760px;margin:auto;padding:16px}.music-moments-fixture>header{padding:8px}.music-moments-fixture h1{font-size:26px}.music-moments-fixture header p{font-size:13px;line-height:1.7}.music-moments-fixture nav{display:flex;gap:8px;flex-wrap:wrap}.music-moments-fixture nav button{min-height:44px;padding:8px 12px;color:inherit;background:rgb(var(--theme-card-rgb)/.8);border:1px solid var(--theme-control-border);border-radius:12px;font:inherit;font-size:13px}`;
document.head.append(style);
const root = import.meta.hot?.data.root || createRoot(document.getElementById("root"));
if (import.meta.hot) import.meta.hot.dispose(data => { data.root = root; style.remove(); URL.revokeObjectURL(silentUrl); });
root.render(<Preview />);
