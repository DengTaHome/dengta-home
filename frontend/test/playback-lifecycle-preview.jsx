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
const tracks = ["晨间", "午后", "夜晚"].map((title, index) => ({ id: `preview-lifecycle-track-${index}`, title: `无声测试 · ${title}`, artist: "虚构作者", playback_mode: "local_blob", url: URL.createObjectURL(new Blob([wav], { type: "audio/wav" })) }));
const playlist = { id: "preview-lifecycle-playlist", name: "虚构三曲队列", items: tracks };
const session = { id: "preview-lifecycle-session", status: "active", sessionMode: "listening", musicPlaylistId: playlist.id, musicPlaylistItemId: tracks[0].id, revision: 1 };
let identity = { accountScope: "preview-lifecycle-account-a", companionScope: "preview-lifecycle-companion" }, failNext = false, holdNext = false, releaseHeld = null;
const initialQueue = () => ({ session_id: session.id, revision: 1, current_queue_item_id: "preview-lifecycle-entry-0", items: tracks.map((track, index) => ({ id: `preview-lifecycle-entry-${index}`, playlist_id: playlist.id, item_id: track.id, title: track.title, artist: track.artist })) });
let queue = initialQueue();
let addedEntry = 0;
const platformActions = {};
let platformPosition = null;
if (navigator.mediaSession) {
  const nativeSetActionHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
  navigator.mediaSession.setActionHandler = (action, handler) => { nativeSetActionHandler(action, handler); platformActions[action] = handler; };
  const nativeSetPositionState = navigator.mediaSession.setPositionState?.bind(navigator.mediaSession);
  if (nativeSetPositionState) navigator.mediaSession.setPositionState = (value) => { nativeSetPositionState(value); platformPosition = value || null; };
}
globalThis.__playbackLifecycleFixture = {
  platformActions,
  auth: { getSnapshot: () => ({ user: { id: identity.accountScope }, activeCompanionId: identity.companionScope }), getRequestContext: async () => ({ accessToken: "fictional-placeholder", companionId: identity.companionScope }) },
  async request(path, options = {}) {
    if (path.endsWith("/queue/operations")) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (holdNext) { holdNext = false; await new Promise(resolve => { releaseHeld = () => { releaseHeld = null; resolve(); }; }); }
      const operation = JSON.parse(options.body).operation;
      if (failNext) { failNext = false; throw Object.assign(Error("虚构网关请求超时"), { code: "request_timeout" }); }
      const items = [...queue.items]; let current = queue.current_queue_item_id;
      if (operation.type === "advance") {
        const index = items.findIndex(entry => entry.id === current);
        if (queue.repeat_mode !== "one") current = items[index + 1]?.id || (queue.repeat_mode === "all" ? items[0]?.id : null) || null;
      } else if (operation.type === "remove") {
        const index = items.findIndex(entry => entry.id === operation.queue_item_id);
        if (index < 0) throw Object.assign(Error("虚构队列项不存在"), { code: "music_queue_item_not_found" });
        if (current === operation.queue_item_id) current = items[index + 1]?.id || items.find(entry => entry.id !== current)?.id || null;
        items.splice(index, 1);
      } else if (operation.type === "add") {
        const track = tracks.find(entry => entry.id === operation.item_id);
        if (!track) throw Object.assign(Error("虚构曲目不存在"), { code: "music_queue_item_not_found" });
        const entry = { id: `preview-added-entry-${++addedEntry}`, playlist_id: playlist.id, item_id: track.id, title: track.title, artist: track.artist };
        items.splice(operation.position ?? items.length, 0, entry); current ||= entry.id;
      } else if (operation.type === "move") {
        const index = items.findIndex(entry => entry.id === operation.queue_item_id);
        const [entry] = items.splice(index, 1); items.splice(operation.position, 0, entry);
      } else if (operation.type !== "set_mode") throw Object.assign(Error("虚构预览未定义此操作"), { code: "fixture_operation_unavailable" });
      queue = { ...queue, revision: queue.revision + 1, current_queue_item_id: current, items,
        ...(operation.repeat_mode === undefined ? {} : { repeat_mode: operation.repeat_mode }),
        ...(operation.shuffle_enabled === undefined ? {} : { shuffle_enabled: operation.shuffle_enabled }),
      };
      return { queue: structuredClone(queue) };
    }
    if (options.method && options.method !== "GET") throw Object.assign(Error("虚构预览禁止外部写入"), { code: "fixture_write_disabled" });
    if (path.endsWith("/queue")) return structuredClone(queue);
    if (path.endsWith(`/playlists/${playlist.id}`)) return { playlist };
    if (path.endsWith("/playlists")) return { playlists: [playlist] };
    if (path.endsWith("/favorites")) return { favorites: [] };
    if (path.endsWith("/connections/manage")) return { connections: [] };
    if (path.endsWith("/cookie-session")) return { session: { connected: false } };
    throw Object.assign(Error("虚构预览未定义此操作"), { code: "fixture_operation_unavailable" });
  },
};

export default function Preview() {
  const [night, setNight] = useState(false), [visible, setVisible] = useState(true), [scope, setScope] = useState(identity);
  const [platformProof, setPlatformProof] = useState(null);
  useEffect(() => { applyThemePreferences(DEFAULT_THEME_PREFERENCES, getCelestialSnapshot(new Date("2026-10-08T04:00:00Z"), night ? "night" : "day"), document.documentElement); }, [night]);
  return <main className="playback-lifecycle-fixture"><header><small>灯塔 · 实际播放器验收</small><h1>一起听，顺畅地切换</h1><p>虚构账号与接口，三首零采样无声 WAV，无人声、无真实服务写入。</p><nav aria-label="预览控制">
    <button onClick={() => setNight(value => !value)}>{night ? "切换日间" : "切换夜间"}</button>
    <button onClick={() => { failNext = true; }}>测试下一次切歌失败</button>
    <button onClick={() => { holdNext = true; }}>暂停下一次队列回执</button>
    <button onClick={() => releaseHeld?.()}>返回等待中的队列回执</button>
    <button onClick={() => setVisible(false)}>关闭播放器预览</button>
    <button onClick={() => platformActions.play?.()}>模拟锁屏播放</button>
    <button onClick={() => platformActions.pause?.()}>模拟锁屏暂停</button>
    <button onClick={() => platformActions.seekto?.({ seekTime: 45 })}>模拟锁屏跳到45秒</button>
    <button onClick={() => platformActions.seekto?.({ seekTime: 999 })}>模拟锁屏超出时长</button>
    <button onClick={() => platformActions.nexttrack?.()}>模拟锁屏下一首</button>
    <button onClick={() => setPlatformProof({ metadata: navigator.mediaSession?.metadata?.title || null, playbackState: navigator.mediaSession?.playbackState || null, position: platformPosition, actions: Object.entries(platformActions).filter(([, handler]) => handler).map(([action]) => action), audioPaused: document.querySelector("audio")?.paused ?? null })}>读取媒体控制状态</button>
    <button onClick={() => { identity = { ...identity, accountScope: identity.accountScope.endsWith("-a") ? "preview-lifecycle-account-b" : "preview-lifecycle-account-a" }; queue = initialQueue(); setScope(identity); setVisible(true); }}>切换虚构账号并重新开始</button>
  </nav>{platformProof && <output data-platform-proof={JSON.stringify(platformProof)}>媒体控制：{platformProof.metadata || "已清除"} · {platformProof.playbackState} · {platformProof.actions.length} 个可用操作</output>}</header>{visible ? <div className="together-page"><section className="together-control-card"><TogetherMusic key={JSON.stringify(scope)} {...scope} session={session} onEnd={async () => { setVisible(false); return { ok: true }; }} /></section></div> : <p role="status">播放器已卸载；本页无音频元素。</p>}</main>;
}
const style = document.createElement("style");
document.querySelector("style[data-playback-preview-style]")?.remove();
style.dataset.playbackPreviewStyle = "";
style.textContent = "html,body,#root{height:auto!important;min-height:100%;overflow:visible}body{margin:0;background:var(--theme-background);color:var(--theme-ink)}#root{background:transparent}.playback-lifecycle-fixture{max-width:760px;margin:auto;padding:16px}.playback-lifecycle-fixture>header{padding:8px}.playback-lifecycle-fixture h1{font-size:26px}.playback-lifecycle-fixture header p{font-size:13px;line-height:1.6}.playback-lifecycle-fixture nav{display:flex;gap:8px;flex-wrap:wrap}.playback-lifecycle-fixture nav button{min-height:44px;padding:10px 14px;border:1px solid var(--theme-line);border-radius:16px;color:var(--theme-ink);background:var(--theme-panel)}.playback-lifecycle-fixture .together-page{padding:12px 0!important}.playback-lifecycle-fixture .together-control-card{width:100%;padding:16px!important}";
document.head.appendChild(style);
const root = import.meta.hot?.data.root || createRoot(document.getElementById("root"));
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<Preview />);
