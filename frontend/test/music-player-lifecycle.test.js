import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { setTimeout, clearTimeout, setInterval, clearInterval, localStorage: { getItem: () => null, setItem() {} } };
const tracks = ["a", "b", "c"].map(letter => ({ id: `fictional-track-${letter}`, title: `虚构歌曲${letter}`, artist: "虚构作者", url: `https://media.example.test/${letter}.mp3`, duration_seconds: 120 }));
const playlist = { id: "fictional-playlist", name: "虚构歌单", items: tracks };
const initialSession = { id: "fictional-session", status: "active", sessionMode: "listening", musicPlaylistId: playlist.id, musicPlaylistItemId: tracks[0].id, revision: 1 };
let identity, session, serverQueue, audio, tree, failAdvance, calls, reports, positions, playCalls, pendingAdvance, pendingPlay, platform;
Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => ({ mediaSession: platform }) });
globalThis.MediaMetadata = class { constructor(value) { Object.assign(this, value); } };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
globalThis.__playerLifecycle = {
  auth: { getSnapshot: () => ({ user: { id: identity.accountScope }, activeCompanionId: identity.companionScope }), getRequestContext: async () => ({ accessToken: "fictional-placeholder", companionId: identity.companionScope }) },
  async request(path, options = {}) {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || "GET", operation: body?.operation?.type });
    if (path.endsWith("/queue/operations")) {
      if (pendingAdvance) await pendingAdvance.promise;
      if (failAdvance) throw Object.assign(Error("虚构超时"), { code: "request_timeout" });
      const operation = body.operation;
      let items = [...serverQueue.items], current = serverQueue.current_queue_item_id;
      const index = serverQueue.items.findIndex(entry => entry.id === serverQueue.current_queue_item_id);
      if (operation.type === "advance") current = serverQueue.repeat_mode === "one" ? current : items[index + 1]?.id || null;
      else if (operation.type === "remove") {
        const removedIndex = items.findIndex(entry => entry.id === operation.queue_item_id); assert.ok(removedIndex >= 0);
        if (current === operation.queue_item_id) current = items[removedIndex + 1]?.id || items.find(entry => entry.id !== current)?.id || null;
        items.splice(removedIndex, 1);
      } else if (operation.type === "add") {
        const track = tracks.find(entry => entry.id === operation.item_id); assert.ok(track);
        const entry = { id: `fictional-added-${serverQueue.revision}`, playlist_id: playlist.id, item_id: track.id, title: track.title };
        items.splice(operation.position ?? items.length, 0, entry); current ||= entry.id;
      } else if (operation.type === "move") {
        const from = items.findIndex(entry => entry.id === operation.queue_item_id); assert.ok(from >= 0);
        const [entry] = items.splice(from, 1); items.splice(operation.position, 0, entry);
      } else assert.equal(operation.type, "set_mode");
      serverQueue = { ...serverQueue, revision: serverQueue.revision + 1, current_queue_item_id: current, items,
        ...(operation.shuffle_enabled === undefined ? {} : { shuffle_enabled: operation.shuffle_enabled }),
        ...(operation.repeat_mode === undefined ? {} : { repeat_mode: operation.repeat_mode }),
      };
      return { queue: structuredClone(serverQueue) };
    }
    if (path.endsWith("/queue")) return structuredClone(serverQueue);
    if (path.endsWith("/music/playlists")) return { playlists: [playlist] };
    if (path.endsWith(`/music/playlists/${playlist.id}`)) return { playlist };
    if (path.endsWith("/favorites")) return { favorites: [] };
    if (path.endsWith("/connections/manage")) return { connections: [] };
    if (path.endsWith("/cookie-session")) return { session: { connected: false } };
    throw Error("Unexpected fictional route " + path);
  },
};
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, envFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{ name: "player-lifecycle-no-network", enforce: "pre", load(id) {
  const path = id.replaceAll("\\", "/");
  if (path.endsWith("/src/api.js")) return "export const apiRequest=(...args)=>globalThis.__playerLifecycle.request(...args);export const apiFetch=apiRequest;";
  if (path.endsWith("/src/auth-session.js")) return "export const authSession=globalThis.__playerLifecycle.auth;";
} }] });
const { default: Music } = await vite.ssrLoadModule("/src/TogetherMusic.jsx");
after(() => vite.close());
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const button = label => tree.root.findAllByType("button").find(node => text(node) === label);
const next = () => tree.root.findAllByType("button").find(node => node.props["aria-label"] === "下一首");
const media = () => tree.root.findByType("audio");
const output = () => JSON.stringify(tree.toJSON());
const props = () => ({ ...identity, session, onPlaybackChange: value => reports.push(value), onPositionChange: value => positions.push(value) });
async function mount(count = 3) {
  identity = { accountScope: "fictional-account-a", companionScope: "fictional-companion-a" }; session = { ...initialSession };
  failAdvance = false; calls = []; reports = []; positions = []; playCalls = 0; pendingAdvance = null; pendingPlay = null;
  platform = { metadata: null, playbackState: "none", position: null, actions: {},
    setActionHandler(action, handler) { this.actions[action] = handler; },
    setPositionState(value) { this.position = value || null; },
  };
  const order = Array.isArray(count) ? count : Array.from({ length: count }, (_, index) => index);
  serverQueue = { session_id: session.id, revision: 1, current_queue_item_id: "fictional-entry-a", items: order.map((trackIndex, index) => ({ id: `fictional-entry-${"abc"[index]}`, playlist_id: playlist.id, item_id: tracks[trackIndex].id, title: tracks[trackIndex].title })) };
  audio = { currentSrc: tracks[0].url, currentTime: 0, duration: 120, readyState: 1, paused: true, ended: false,
    getAttribute(name) { if (name !== "src" || !tree) return null; try { return media().props.src || null; } catch { return null; } },
    removeAttribute() {}, pause() { this.paused = true; },
    play() { playCalls++; this.paused = false; const pending = pendingPlay; pendingPlay = null; return pending?.promise || Promise.resolve(); },
    load() { this.paused = true; this.ended = false; this.currentTime = 0; this.currentSrc = this.getAttribute("src") || ""; },
  };
  await act(async () => { tree = TestRenderer.create(React.createElement(Music, props()), { createNodeMock: element => element.type === "audio" ? audio : null }); });
  assert.equal(media().props.src, tracks[0].url); assert.ok(calls.some(call => call.path.endsWith("/queue")));
}
async function emit(name) { await act(async () => media().props[name]({ currentTarget: audio })); }
async function playing() { audio.paused = false; audio.currentTime = 35; await emit("onPlay"); assert.ok(button("暂停")); }

test("failed advance retains the audible song, queue and pause button", async () => {
  await mount(); await playing(); failAdvance = true; await act(async () => next().props.onClick());
  assert.equal(audio.paused, false); assert.ok(button("暂停")); assert.equal(serverQueue.current_queue_item_id, "fictional-entry-a"); assert.match(output(), /request_timeout/);
  assert.doesNotMatch(text(tree.toJSON()), /聊天已保存/); failAdvance = false; await act(async () => next().props.onClick()); assert.doesNotMatch(text(tree.toJSON()), /request_timeout/);
});
test("native play before metadata updates the button and playing confirms the new source", async () => {
  await mount(); await act(async () => next().props.onClick()); audio.readyState = 0; audio.paused = false; reports = [];
  await emit("onPlay"); assert.ok(button("暂停")); assert.equal(reports.length, 0);
  audio.readyState = 3; audio.currentTime = 0.1; await emit("onPlaying"); assert.equal(reports.at(-1).musicPlaylistItemId, tracks[1].id); assert.equal(reports.at(-1).playbackState, "playing");
});
test("confirmed queue completion stops and clears the old session fallback", async () => {
  await mount(1); await playing(); await act(async () => next().props.onClick());
  assert.equal(serverQueue.current_queue_item_id, null); assert.match(output(), /队列已经播放完了/);
  assert.equal(media().props.src, undefined); assert.equal(audio.currentSrc, ""); assert.equal(audio.paused, true);
  assert.equal(button("播放").props.disabled, true); assert.equal(tree.root.findByProps({ className: "music-progress-range" }).props.value, 0);
});
test("two ended events in the same turn advance once and resume the confirmed next track", async () => {
  await mount(); audio.ended = true; audio.paused = true; const ended = media().props.onEnded;
  await act(async () => { ended({ currentTarget: audio }); ended({ currentTarget: audio }); });
  assert.equal(calls.filter(call => call.operation === "advance").length, 1); assert.equal(serverQueue.current_queue_item_id, "fictional-entry-b"); assert.equal(media().props.src, tracks[1].url); assert.equal(playCalls, 1);
});
test("two next clicks before React renders do not skip a song", async () => {
  await mount(); const click = next().props.onClick;
  await act(async () => { click(); click(); });
  assert.equal(calls.filter(call => call.operation === "advance").length, 1); assert.equal(serverQueue.current_queue_item_id, "fictional-entry-b"); assert.equal(playCalls, 0);
});
test("new source callbacks reject old audio metadata and preserve current progress", async () => {
  await mount(); await act(async () => next().props.onClick()); audio.currentSrc = tracks[0].url; audio.currentTime = 77;
  reports = []; positions = []; await emit("onSeeked");
  assert.equal(reports.length, 0); assert.equal(positions.length, 0); assert.equal(tree.root.findByProps({ className: "music-progress-range" }).props.value, 0);
  audio.currentSrc = tracks[1].url; audio.currentTime = 19; await emit("onSeeked");
  assert.equal(reports.at(-1).musicPlaylistItemId, tracks[1].id); assert.equal(reports.at(-1).mediaPositionSeconds, 19);
});
test("old media handlers cannot change or advance the new track", async () => {
  await mount(); const old = media().props; await act(async () => next().props.onClick());
  reports = []; positions = []; audio.ended = true;
  await act(async () => { old.onPlay({ currentTarget: audio }); old.onPause({ currentTarget: audio }); old.onSeeked({ currentTarget: audio }); old.onEnded({ currentTarget: audio }); old.onError({ currentTarget: audio }); });
  assert.equal(reports.length, 0); assert.equal(positions.length, 0); assert.equal(calls.filter(call => call.operation === "advance").length, 1); assert.doesNotMatch(output(), /音频无法播放/); assert.ok(button("播放"));
});
test("scope change and unmount reject retained callbacks", async () => {
  await mount(); const old = media().props;
  identity = { accountScope: "fictional-account-b", companionScope: "fictional-companion-b" };
  await act(async () => tree.update(React.createElement(Music, props()))); reports = []; positions = []; audio.currentTime = 65;
  await act(async () => old.onSeeked({ currentTarget: audio })); assert.equal(reports.length, 0); assert.equal(positions.length, 0);
  await act(async () => tree.unmount()); tree = null;
  await act(async () => old.onSeeked({ currentTarget: audio })); assert.equal(reports.length, 0); assert.equal(positions.length, 0);
});
test("live callbacks use the latest session revision without reloading the song", async () => {
  await mount(); audio.currentTime = 27; session = { ...session, revision: 8 }; await act(async () => tree.update(React.createElement(Music, props())));
  await emit("onSeeked"); assert.equal(audio.currentTime, 27); assert.equal(reports.at(-1).revision, 8);
});
test("non-finite media values cannot enter the progress slider or a playback report", async () => {
  await mount(); audio.currentTime = Infinity; audio.duration = Infinity; reports = []; await emit("onTimeUpdate");
  assert.equal(reports.length, 0); assert.ok(Number.isFinite(tree.root.findByProps({ className: "music-progress-range" }).props.value));
});
test("repeat-one restarts once after an ended event", async () => {
  await mount(); serverQueue.repeat_mode = "one"; audio.currentTime = 120; audio.ended = true; audio.paused = true; await emit("onEnded");
  assert.equal(calls.filter(call => call.operation === "advance").length, 1); assert.equal(media().props.src, tracks[0].url); assert.equal(audio.currentTime, 0); assert.equal(playCalls, 1);
});
test("a rejected play promise from the old track cannot add a new-track error", async () => {
  await mount(); const oldPlay = deferred(); pendingPlay = oldPlay; await act(async () => button("播放").props.onClick());
  await act(async () => next().props.onClick());
  await act(async () => oldPlay.reject(Error("fictional obsolete autoplay failure"))); assert.doesNotMatch(output(), /浏览器阻止|下一首已准备/);
});
test("pending advance cannot autoplay or report after the component is gone", async () => {
  await mount(); await playing(); pendingAdvance = deferred(); let advance;
  await act(async () => { advance = next().props.onClick(); });
  await act(async () => tree.unmount()); tree = null; assert.equal(audio.paused, true); assert.equal(audio.currentSrc, ""); const before = playCalls; reports = [];
  await act(async () => { pendingAdvance.resolve(); await advance; }); assert.equal(playCalls, before); assert.equal(reports.length, 0);
});

test("a completed queue releases platform metadata, position and controls", async () => {
  await mount(1); await playing(); assert.equal(platform.metadata.title, tracks[0].title); assert.equal(platform.playbackState, "playing"); assert.ok(platform.position);
  await act(async () => next().props.onClick());
  assert.equal(platform.metadata, null); assert.equal(platform.playbackState, "none"); assert.equal(platform.position, null);
  assert.ok(Object.values(platform.actions).every(handler => handler === null));
});

test("unmount releases platform ownership and retained controls cannot change a later player", async () => {
  await mount(); await playing(); const oldNext = platform.actions.nexttrack, oldPlay = platform.actions.play;
  await act(async () => tree.unmount()); tree = null;
  assert.equal(platform.metadata, null); assert.equal(platform.playbackState, "none"); assert.equal(platform.position, null);
  await mount(); const before = calls.length, beforePlay = playCalls;
  await act(async () => { oldNext(); oldPlay(); });
  assert.equal(calls.length, before); assert.equal(playCalls, beforePlay);
});

test("a retained platform next handler cannot advance a replacement song", async () => {
  await mount(); const oldNext = platform.actions.nexttrack; await act(async () => next().props.onClick());
  const count = calls.filter(call => call.operation === "advance").length;
  await act(async () => oldNext()); assert.equal(calls.filter(call => call.operation === "advance").length, count);
  await act(async () => platform.actions.nexttrack()); assert.equal(serverQueue.current_queue_item_id, "fictional-entry-c");
});

test("platform pause works before metadata without reporting stale progress", async () => {
  await mount(); audio.readyState = 0; audio.paused = false; await emit("onPlay"); reports = [];
  await act(async () => platform.actions.pause());
  assert.equal(audio.paused, true); assert.equal(reports.length, 0);
});

test("platform seek clamps to the actual duration and ignores invalid times", async () => {
  await mount(); const seek = platform.actions.seekto;
  await act(async () => seek({ seekTime: 999 })); assert.equal(audio.currentTime, 120);
  await act(async () => { seek({ seekTime: -2 }); seek({ seekTime: Infinity }); seek({ seekTime: NaN }); }); assert.equal(audio.currentTime, 120);
  await act(async () => seek({ seekTime: 0 })); assert.equal(audio.currentTime, 0);
});

test("unknown duration does not authorize seek or publish a fake platform position", async () => {
  await mount(); audio.duration = Infinity; audio.currentTime = 15;
  await emit("onTimeUpdate"); assert.equal(platform.position, null);
  await act(async () => platform.actions.seekto({ seekTime: 100 })); assert.equal(audio.currentTime, 15);
});

test("scope replacement rejects old platform controls even with an active new queue", async () => {
  await mount(); const oldNext = platform.actions.nexttrack, oldSeek = platform.actions.seekto;
  identity = { accountScope: "fictional-account-b", companionScope: "fictional-companion-b" };
  await act(async () => tree.update(React.createElement(Music, props()))); const before = calls.length; audio.currentTime = 11;
  await act(async () => { oldNext(); oldSeek({ seekTime: 62 }); }); assert.equal(calls.length, before); assert.equal(audio.currentTime, 11);
});

const queueAction = label => tree.root.findAllByType("button").find(node => node.props["aria-label"] === label);
const selectSource = async () => act(async () => tree.root.findAllByType("select").find(node => node.findAllByType("option").some(option => option.props.value === playlist.id)).props.onChange({ target: { value: playlist.id } }));

test("successive queue entries for one song restart and reject the first entry's events", async () => {
  await mount([0, 0, 1]); await playing(); const oldMedia = media().props, oldNext = platform.actions.nexttrack;
  await act(async () => next().props.onClick()); assert.equal(serverQueue.current_queue_item_id, "fictional-entry-b"); assert.equal(audio.currentTime, 0); assert.equal(audio.paused, false);
  reports = []; await act(async () => { oldMedia.onSeeked({ currentTarget: audio }); oldNext(); });
  assert.equal(reports.length, 0); assert.equal(calls.filter(call => call.operation === "advance").length, 1);
});

test("removing the playing current entry resumes its confirmed successor", async () => {
  await mount(); await playing(); await act(async () => queueAction("移除 虚构歌曲a").props.onClick());
  assert.equal(serverQueue.current_queue_item_id, "fictional-entry-b"); assert.equal(audio.currentSrc, tracks[1].url); assert.equal(audio.paused, false); assert.equal(audio.currentTime, 0); assert.equal(playCalls, 1);
});

test("removing a paused current entry prepares the successor without autoplay", async () => {
  await mount(); await act(async () => queueAction("移除 虚构歌曲a").props.onClick());
  assert.equal(audio.currentSrc, tracks[1].url); assert.equal(audio.paused, true); assert.equal(playCalls, 0);
});

test("a successful mode retry clears only the previous queue error", async () => {
  await mount(); failAdvance = true; await act(async () => button("顺序").props.onClick()); assert.match(output(), /request_timeout/);
  failAdvance = false; await act(async () => button("顺序").props.onClick()); assert.equal(serverQueue.shuffle_enabled, true); assert.doesNotMatch(output(), /request_timeout/); assert.match(output(), /已开启随机播放/);
  await emit("onError"); assert.match(output(), /音频无法播放/);
  await act(async () => button("随机中").props.onClick()); assert.match(output(), /音频无法播放/);
});

test("retained queue controls cannot change a replacement session", async () => {
  await mount(); const oldShuffle = button("顺序").props.onClick, oldRemove = queueAction("移除 虚构歌曲a").props.onClick;
  session = { ...session, id: "fictional-session-b" }; serverQueue = { ...serverQueue, session_id: session.id };
  await act(async () => tree.update(React.createElement(Music, props()))); const before = calls.length;
  await act(async () => { oldShuffle(); oldRemove(); }); assert.equal(calls.length, before); assert.equal(serverQueue.shuffle_enabled, undefined); assert.equal(serverQueue.items.length, 3);
  await act(async () => button("顺序").props.onClick()); assert.equal(serverQueue.shuffle_enabled, true);
});

test("a pause event cannot contradict the current audio's actual playing state", async () => {
  await mount(); await playing(); await act(async () => next().props.onClick()); await emit("onPlay"); await emit("onPause");
  assert.equal(audio.paused, false); assert.ok(button("暂停"));
});

test("adding after completion clears the completion message without autoplay", async () => {
  await mount(1); await selectSource(); await act(async () => next().props.onClick()); assert.match(output(), /队列已经播放完了/);
  await act(async () => button("加入队尾").props.onClick()); assert.ok(serverQueue.current_queue_item_id); assert.equal(media().props.src, tracks[0].url); assert.equal(audio.paused, true); assert.doesNotMatch(output(), /队列已经播放完了/);
});

test("moving the current entry and setting playback modes retain native playback", async () => {
  await mount(); await playing(); await act(async () => queueAction("下移 虚构歌曲a").props.onClick());
  assert.equal(audio.currentTime, 35); assert.equal(audio.paused, false);
  await act(async () => button("不循环").props.onClick()); assert.equal(serverQueue.repeat_mode, "all"); assert.equal(audio.currentTime, 35); assert.equal(audio.paused, false);
});

test("failed removal retains the currently audible entry", async () => {
  await mount(); await playing(); failAdvance = true; await act(async () => queueAction("移除 虚构歌曲a").props.onClick());
  assert.equal(audio.currentSrc, tracks[0].url); assert.equal(audio.paused, false); assert.equal(audio.currentTime, 35); assert.ok(button("暂停")); assert.equal(serverQueue.items.length, 3); assert.match(output(), /request_timeout/);
});

test("removing the final entry clears the native source and platform controls", async () => {
  await mount(1); await playing(); await act(async () => queueAction("移除 虚构歌曲a").props.onClick());
  assert.equal(serverQueue.items.length, 0); assert.equal(media().props.src, undefined); assert.equal(audio.paused, true); assert.equal(playCalls, 0); assert.equal(platform.metadata, null); assert.equal(platform.playbackState, "none");
});

test("a platform pause during a pending removal prevents the successor autoplay", async () => {
  await mount(); await playing(); const operation = deferred(); pendingAdvance = operation;
  await act(async () => queueAction("移除 虚构歌曲a").props.onClick());
  await act(async () => platform.actions.pause()); await emit("onPause");
  await act(async () => operation.resolve()); assert.equal(serverQueue.current_queue_item_id, "fictional-entry-b"); assert.equal(audio.paused, true); assert.equal(playCalls, 0);
});

test("a pause during pending advance supersedes the earlier continue-playing intent", async () => {
  await mount(); await playing(); const operation = deferred(); pendingAdvance = operation;
  await act(async () => next().props.onClick()); await act(async () => platform.actions.pause()); await emit("onPause");
  await act(async () => operation.resolve()); assert.equal(serverQueue.current_queue_item_id, "fictional-entry-b"); assert.equal(audio.paused, true); assert.equal(playCalls, 0);
});

test("a play promise cancelled by explicit pause cannot display an autoplay denial", async () => {
  await mount(); const attempt = deferred(); pendingPlay = attempt;
  await act(async () => platform.actions.play()); await act(async () => platform.actions.pause());
  await act(async () => attempt.reject(Object.assign(Error("fictional play interrupted"), { name: "AbortError" })));
  assert.equal(audio.paused, true); assert.doesNotMatch(output(), /浏览器阻止/);
});

test("a current play denial remains actionable when no later pause cancelled it", async () => {
  await mount(); const attempt = deferred(); pendingPlay = attempt;
  await act(async () => platform.actions.play());
  await act(async () => attempt.reject(Object.assign(Error("fictional policy denial"), { name: "NotAllowedError" })));
  assert.match(output(), /浏览器阻止.*再次点击播放/);
});
