import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import CelestialBackdrop from "../src/CelestialBackdrop.jsx";
import { getCelestialSnapshot } from "../src/dengta-theme.js";
import "../src/index.css";
import "../src/cozy-theme.css";
import "../src/auth.css";
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

const BASE_DATE = new Date("2026-10-15T00:00:00+08:00");
const SAMPLE_POINT = { latitude: 31.23, longitude: 121.48 };
const solar = getCelestialSnapshot(new Date(BASE_DATE.valueOf() + 720 * 60000), "auto", SAMPLE_POINT);
const at = iso => Math.round((Date.parse(iso) - BASE_DATE.valueOf()) / 60000);
const scenes = { 白天: 720, 清晨: at(solar.sunrise) + 20, 黄昏: at(solar.sunset) - 20, 夜晚: 60 };

export default function Preview() {
  const [minute, setMinute] = useState(720);
  const [weather, setWeather] = useState("clear");
  const [reduced, setReduced] = useState(false);
  const [custom, setCustom] = useState(false);
  const [settings, setSettings] = useState(false);
  const [probe, setProbe] = useState("");
  const snapshot = useMemo(() => getCelestialSnapshot(new Date(BASE_DATE.valueOf() + minute * 60000), "auto", SAMPLE_POINT), [minute]);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.dengtaReducedMotion;
    root.dataset.dengtaReducedMotion = reduced ? "true" : "false";
    return () => { if (previous === undefined) delete root.dataset.dengtaReducedMotion; else root.dataset.dengtaReducedMotion = previous; };
  }, [reduced]);
  useEffect(() => {
    document.documentElement.dataset.dengtaAppearance = snapshot.resolvedAppearance;
  }, [snapshot.resolvedAppearance]);
  useEffect(() => {
    const update = () => {
      const video = document.querySelector(".coast-video-loop");
      const layer = document.querySelector(".coast-video-backdrop");
      setProbe(`${layer?.dataset.scene || "—"} · ${layer?.dataset.playback || "—"} · ${(video?.currentTime || 0).toFixed(2)}s · paused=${video?.paused} · ready=${video?.readyState} · src=${video?.getAttribute("src") ? "有" : "无"}`);
    };
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, []);

  return <>
    <div className={`app-shell coast-preview-shell${settings ? " is-settings-open" : ""}`}>
      <CelestialBackdrop snapshot={snapshot} weatherModeOverride={weather} />
      <main className="coast-preview-chat">
        {custom && <div className="private-chat-background"><img src="/assets/journal-coast.webp" alt="" /></div>}
        <div className="coast-preview-message"><strong>灯塔海岸</strong><p>潮水轻轻漫过沙滩，灯塔陪你等下一句话。</p></div>
        <div className="coast-preview-message is-user"><p>日落后，换成月亮和轻轻扫过的灯光。</p></div>
      </main>
    </div>
    <section className="coast-preview-controls" aria-label="本地视频预览控制">
      <strong>原创海岸 · 实际播放验看</strong>
      <small>固定虚构样例；仅本地素材与太阳位置计算，没有账号或天气 API 请求。</small>
      <div>{Object.entries(scenes).map(([label, value]) => <button key={label} onClick={() => setMinute(value)}>{label}</button>)}</div>
      <label>时间 {String(Math.floor(minute / 60)).padStart(2, "0")}:{String(minute % 60).padStart(2, "0")}<input aria-label="预览时间" type="range" min="0" max="1439" value={minute} onChange={event => setMinute(Number(event.target.value))} /></label>
      <label>天气<select aria-label="预览天气" value={weather} onChange={event => setWeather(event.target.value)}><option value="clear">晴朗</option><option value="cloudy">阴天</option><option value="rain">下雨</option><option value="storm">暴雨雷电</option></select></label>
      <div><label><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)} />减少动态</label><label><input type="checkbox" checked={custom} onChange={event => setCustom(event.target.checked)} />自定义壁纸</label><label><input type="checkbox" checked={settings} onChange={event => setSettings(event.target.checked)} />设置暂停</label></div>
      <output aria-live="polite" data-testid="coast-playback-probe">{probe}</output>
      <small>日出 {snapshot.sunriseLabel} · 日落 {snapshot.sunsetLabel}；色调和月亮为艺术近似。</small>
    </section>
    <style>{`
      .coast-preview-shell { min-height:100dvh; display:block; }
      .coast-preview-chat { position:relative; z-index:6; min-height:100dvh; padding:310px 24px 90px; pointer-events:none; }
      .coast-preview-message { position:relative; z-index:1; width:min(340px,80%); padding:16px 20px; margin:18px 0; color:#283641; background:rgb(255 255 255/.55); border:1px solid rgb(255 255 255/.75); border-radius:22px; backdrop-filter:blur(8px); }
      .coast-preview-message p { margin:8px 0 0; }
      .coast-preview-message.is-user { margin-left:auto; background:rgb(255 222 232/.55); }
      .coast-preview-controls { position:fixed; z-index:99; inset:12px auto auto 12px; width:min(420px,calc(100vw - 24px)); display:grid; gap:8px; padding:12px; border-radius:18px; background:rgb(250 252 255/.92); color:#233a47; box-shadow:0 8px 30px rgb(0 0 0/.13); font:13px/1.4 system-ui; }
      .coast-preview-controls strong { font-size:15px; }
      .coast-preview-controls>div { display:flex; gap:8px; flex-wrap:wrap; }
      .coast-preview-controls button { padding:5px 12px; border:1px solid #b8d7db; border-radius:12px; background:white; color:#245265; font:inherit; cursor:pointer; }
      .coast-preview-controls label { display:flex; gap:6px; align-items:center; font-size:12px; }
      .coast-preview-controls input[type=range] { flex:1; min-width:0; }
      .coast-preview-controls output { font:11px/1.4 monospace; overflow-wrap:anywhere; }
      @media (min-width:900px) { .coast-preview-chat { padding:330px 15vw 90px; } }
    `}</style>
  </>;
}

createRoot(document.getElementById("root")).render(<Preview />);
