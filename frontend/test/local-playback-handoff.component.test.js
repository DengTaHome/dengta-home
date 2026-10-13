import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { after, afterEach, test } from "node:test";
import React, { act, useState } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const frontend = fileURLToPath(new URL("..", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
const videoUrl = "https://media.example.test/fictional-video.mp4";
const track = { id: "fictional-track", title: "虚构一起听歌曲", artist: "虚构作者", url: "https://media.example.test/together.mp3", duration_seconds: 120 };
const playlist = { id: "fictional-playlist", name: "虚构歌单", items: [track] };
const session = { id: "fictional-session", status: "active", sessionMode: "listening", musicPlaylistId: playlist.id, musicPlaylistItemId: track.id, revision: 1 };
const queue = { session_id: session.id, revision: 1, current_queue_item_id: "fictional-entry", items: [{ id: "fictional-entry", playlist_id: playlist.id, item_id: track.id, title: track.title }] };
const timers = new Map(); let timerId = 0, tree, audios = [], calls = [], reports = [], feedback = [], identity;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { localStorage: { getItem: key => key === "dengta_random_play_enabled" ? "1" : null, setItem() {} }, setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); }, setInterval: () => 0, clearInterval() {} };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaSession: { setActionHandler() {}, setPositionState() {} } } });
globalThis.MediaMetadata = class { constructor(value) { Object.assign(this, value); } };
globalThis.document = { hidden: false, body: { style: {} } };
const storage = new Map();
globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
class FakeAudio {
  constructor(url, host = false) { this.url = url; this.host = host; this.currentSrc = url; this.currentTime = 0; this.duration = 120; this.readyState = 1; this.paused = true; this.ended = false; this.handlers = {}; audios.push(this); }
  addEventListener(name, fn) { (this.handlers[name] ||= new Set()).add(fn); }
  removeEventListener(name, fn) { this.handlers[name]?.delete(fn); }
  emit(name) { for (const fn of this.handlers[name] || []) fn(); if (this.host && tree) { let audio; try { audio = tree.root.findAllByType(this.host === "video" ? "video" : "audio")[0]; } catch { return; } audio?.props["on" + name[0].toUpperCase() + name.slice(1)]?.({ currentTarget: this }); } }
  async play() { this.paused = false; this.emit("play"); try { await this.playResult; if (!this.released) this.emit("playing"); } catch (error) { this.paused = true; throw error; } }
  pause() { this.paused = true; this.emit("pause"); }
  getAttribute(name) { return name === "src" ? this.url : null; }
  removeAttribute() { this.released = true; this.url = ""; }
  load() { this.paused = true; }
}
globalThis.Audio = FakeAudio;
globalThis.__mediaCompetition = {
  auth: { getSnapshot: () => ({ user: { id: identity.accountScope }, activeCompanionId: identity.companionScope }), getRequestContext: async () => ({ accessToken: "fictional-placeholder", companionId: identity.companionScope }) },
  async request(path, options = {}) {
    calls.push({ path, method: options.method || "GET" }); options.signal?.throwIfAborted();
    if (path.endsWith("/random-playable")) return { playable: true, song: { title: "虚构随机歌曲", url: "https://media.example.test/random.mp3" } };
    if (path.endsWith("/queue")) return structuredClone(queue);
    if (path.endsWith("/music/playlists")) return { playlists: [playlist] };
    if (path.endsWith("/music/playlists/" + playlist.id)) return { playlist };
    if (path.endsWith("/favorites")) return { favorites: [] };
    if (path.endsWith("/connections/manage")) return { connections: [] };
    if (path.endsWith("/cookie-session")) return { session: { connected: false } };
    throw Error("Unexpected fixture route " + path);
  },
};
const vite = await createServer({ root: frontend, configFile: false, envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{ name: "media-competition-no-network", enforce: "pre", load(id) {
  const file = id.replaceAll("\\", "/");
  if (file.endsWith("/src/api.js")) return "export const apiRequest=(...args)=>globalThis.__mediaCompetition.request(...args);export const apiFetch=apiRequest;export const API_BASE_URL='https://fixture.example.test';";
  if (file.endsWith("/src/auth-session.js")) return "export const authSession=globalThis.__mediaCompetition.auth;";
} }] });
const { useMusicScope } = await vite.ssrLoadModule("/src/use-music-scope.js");
const { useBuiltInNowPlaying } = await vite.ssrLoadModule("/src/useBuiltInNowPlaying.js");
const { default: Card } = await vite.ssrLoadModule("/src/NowPlayingCard.jsx");
const { default: Music } = await vite.ssrLoadModule("/src/TogetherMusic.jsx");
const { default: Together } = await vite.ssrLoadModule("/src/Together.jsx");
const { storeDirectMediaSession } = await vite.ssrLoadModule("/src/direct-media.js");
const { createBuiltInNowPlaying } = await vite.ssrLoadModule("/src/built-in-now-playing.js");
const { createMusicRequestScope } = await vite.ssrLoadModule("/src/music-request-scope.js");
const { createMusicPlaybackSync } = await vite.ssrLoadModule("/src/music-playback-sync.js");
const app = fs.readFileSync(frontend + "/src/App.jsx", "utf8");
const functionSource = app.match(/ {2}function updateMusicCoWatchPlayback\(snapshot = \{\}\) \{[\s\S]*?\n {2}\}/)?.[0];
assert.ok(functionSource, "extract the current App callback rather than inventing playback coordination");
const sync = createMusicPlaybackSync({ getIdentity: () => identity, getSession: () => session, capture: () => identity, current: stamp => stamp === identity, patchPlayback: async (_id, snapshot) => { reports.push(snapshot); return { ...session, revision: snapshot.revision + 1 }; }, readSession: async () => session, onApplied() {}, onError() {} });
const updateMusicCoWatchPlayback = new Function("musicPlaybackSyncRef", functionSource + ";return updateMusicCoWatchPlayback;")({ current: sync });
function Fixture({ showTogether = true, showVideo = false }) {
  const [song, onSong] = useState(null), [busy, onBusy] = useState(false);
  const scope = useMusicScope(identity.accountScope, identity.companionScope);
  const { control, onLocalPlaybackChange } = useBuiltInNowPlaying({ scope, ...identity, enabled: true, externalAvailable: () => false, readExternal: async () => null, onSong, onBusy, onFeedback: value => feedback.push(value), onStartupFeedback: value => feedback.push(value) });
  return React.createElement(React.Fragment, null, song && React.createElement(Card, { song, busy, onPlayPause: () => void control(song.isPlaying ? "pause" : "play", song), onNext: () => void control("next", song) }), showTogether && React.createElement(Music, { ...identity, session, onPlaybackChange: updateMusicCoWatchPlayback, onLocalPlaybackChange }), showVideo && React.createElement(Together, { ...identity, screenState: {}, feedback: {}, onLocalPlaybackChange }));
}
async function mount(showTogether, showVideo = false) {
  identity = { accountScope: "fictional-account", companionScope: "fictional-companion" }; audios = []; calls = []; reports = []; feedback = []; timers.clear();
  storage.clear(); storeDirectMediaSession(globalThis.sessionStorage, identity.accountScope, { url: videoUrl }, identity.companionScope);
  await act(async () => { tree = TestRenderer.create(React.createElement(Fixture, { showTogether, showVideo }), { createNodeMock: element => ["audio", "video"].includes(element.type) ? new FakeAudio(element.type === "audio" ? track.url : element.props.src, element.type === "video" ? "video" : true) : null }); });
}
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const playing = () => audios.filter(audio => !audio.paused && !audio.ended && !audio.released).map(audio => audio.host === "video" ? "video" : audio.host ? "together" : "random");
async function startup() { const timer = [...timers.values()].find(item => item.delay === 2500); assert.ok(timer); timers.clear(); await act(async () => timer.fn()); }
async function playTogether() { const button = tree.root.findAllByType("button").find(node => text(node) === "播放"); assert.ok(button); await act(async () => button.props.onClick()); }

afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; sync.invalidate(); });
after(async () => { await vite.close(); delete globalThis.__mediaCompetition; });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const musicButton = label => tree.root.findAllByType("button").find(node => text(node) === label);
test("confirmed Together playback pauses random Audio and restores only a paused card", async () => {
  await mount(false); await startup(); const original = audios[0];
  await act(async () => tree.update(React.createElement(Fixture, { showTogether: true })));
  await playTogether(); assert.deepEqual(playing(), ["together"]); assert.equal(original.paused, true); assert.equal(tree.root.findAllByType(Card).length, 0);
  await act(async () => musicButton("暂停").props.onClick()); assert.deepEqual(playing(), []);
  const card = tree.root.findByType(Card); assert.equal(card.props.song.isPlaying, false);
  await act(async () => card.props.onPlayPause()); assert.deepEqual(playing(), ["random"]);
});
test("Together playback before the delayed random startup prevents another selection", async () => {
  await mount(true); await playTogether(); await startup(); assert.deepEqual(playing(), ["together"]);
  assert.equal(calls.filter(call => call.path.endsWith("/random-playable")).length, 0);
});
test("rejected Together play preserves the audible random song and its card", async () => {
  await mount(false); await startup(); await act(async () => tree.update(React.createElement(Fixture, { showTogether: true })));
  const audio = audios.find(audio => audio.host), pending = deferred(); audio.playResult = pending.promise;
  await act(async () => musicButton("播放").props.onClick()); assert.deepEqual(playing(), ["random", "together"]);
  // The fake pending element is not yet confirmed audible: no playing event was emitted.
  assert.equal(audios[0].paused, false); pending.reject(Error("fictional private autoplay failure"));
  await act(async () => { await Promise.resolve(); }); assert.deepEqual(playing(), ["random"]); assert.equal(tree.root.findByType(Card).props.song.isPlaying, true);
});
test("unmount after confirmed Together playback restores a paused card without autoplay", async () => {
  await mount(false); await startup(); await act(async () => tree.update(React.createElement(Fixture, { showTogether: true })));
  await playTogether(); await act(async () => tree.update(React.createElement(Fixture, { showTogether: false })));
  assert.deepEqual(playing(), []); assert.equal(tree.root.findByType(Card).props.song.isPlaying, false);
});

test("direct video confirms a handoff only at playing, then end restores a paused card", async () => {
  await mount(false); await startup(); await act(async () => tree.update(React.createElement(Fixture, { showTogether: false, showVideo: true })));
  const video = audios.find(audio => audio.host === "video"); assert.ok(video);
  video.paused = false; await act(async () => video.emit("play")); assert.equal(audios[0].paused, false);
  await act(async () => video.emit("playing")); assert.deepEqual(playing(), ["video"]); assert.equal(tree.root.findAllByType(Card).length, 0);
  video.ended = true; video.paused = true; await act(async () => video.emit("ended"));
  assert.deepEqual(playing(), []); assert.equal(tree.root.findByType(Card).props.song.isPlaying, false);
});

test("direct video failure before playing preserves random audio", async () => {
  await mount(false); await startup(); await act(async () => tree.update(React.createElement(Fixture, { showTogether: false, showVideo: true })));
  const video = audios.find(audio => audio.host === "video"); video.paused = false;
  await act(async () => video.emit("play")); video.paused = true; video.error = { code: 3 };
  await act(async () => video.emit("error")); assert.deepEqual(playing(), ["random"]); assert.equal(tree.root.findByType(Card).props.song.isPlaying, true);
});

function controller() {
  identity = { accountScope: "fictional-account", companionScope: "fictional-companion" }; audios = [];
  const scope = createMusicRequestScope(globalThis.__mediaCompetition.auth); scope.bind(identity);
  const songs = [], notices = [];
  const options = { scope, request: async () => ({ playable: true, song: { title: "虚构随机歌曲", url: "https://media.example.test/random.mp3" } }), createAudio: url => new FakeAudio(url), onSong: song => songs.push(song), onBusy() {}, onFeedback: value => notices.push(value), onStartupFeedback() {} };
  return { scope, options, songs, notices, event: (phase, owner) => ({ ...identity, phase, owner }) };
}

test("pending local play prevents candidate commit and a failed handoff preserves the original", async () => {
  const f = controller(), gate = deferred(); let wait = false;
  const request = f.options.request; f.options.request = (...args) => wait ? gate.promise : request(...args);
  const player = createBuiltInNowPlaying(f.options);
  try {
    await player.start(); wait = true; const next = player.control("next", f.songs.at(-1)); const owner = {};
    player.localPlaybackChanged(f.event("pending", owner)); gate.resolve({ playable: true, song: { title: "虚构候选", url: "https://media.example.test/next.mp3" } }); await next;
    assert.equal(audios.length, 1); assert.equal(audios[0].paused, false);
    player.localPlaybackChanged(f.event("error", owner)); assert.equal(f.songs.at(-1).isPlaying, true); assert.equal(f.notices.length, 0);
  } finally { player.dispose(); }
});

test("released declarations and old account callbacks cannot pause the current Audio", async () => {
  const f = controller(), player = createBuiltInNowPlaying(f.options);
  try {
    await player.start(); const owner = {}, old = f.event("playing", owner);
    player.localPlaybackChanged(f.event("pending", owner)); player.localPlaybackChanged(f.event("released", owner));
    player.localPlaybackChanged(old); assert.equal(audios[0].paused, false);
    player.localPlaybackChanged({ ...old, owner: {}, accountScope: "fictional-other-account" }); assert.equal(audios[0].paused, false);
    player.localPlaybackChanged({ ...old, owner: {}, companionScope: "fictional-other-companion" }); assert.equal(audios[0].paused, false);
    identity = { accountScope: "fictional-new-account", companionScope: "fictional-new-companion" };
    const before = f.songs.length; player.localPlaybackChanged({ ...old, owner: {} }); assert.equal(f.songs.length, before);
  } finally { player.dispose(); }
});

test("a cancelled next cannot release the newer candidate after local playback pauses", async () => {
  const f = controller(), oldSelection = deferred(), newPlay = deferred(); let count = 0;
  const request = f.options.request;
  f.options.request = (...args) => ++count === 2 ? oldSelection.promise : request(...args);
  const createAudio = f.options.createAudio; f.options.createAudio = url => { const audio = createAudio(url); if (audios.length === 2) audio.playResult = newPlay.promise; return audio; };
  const player = createBuiltInNowPlaying(f.options);
  try {
    await player.start(); const original = f.songs.at(-1); const old = player.control("next", original), owner = {};
    player.localPlaybackChanged(f.event("playing", owner)); player.localPlaybackChanged(f.event("paused", owner));
    const current = player.control("next", f.songs.at(-1));
    for (let i = 0; i < 12; i++) await Promise.resolve(); assert.equal(audios.length, 2);
    oldSelection.resolve({ playable: true, song: { title: "虚构迟到歌曲", url: "https://media.example.test/old.mp3" } }); await old;
    assert.notEqual(audios[1].released, true); newPlay.resolve(); await current; assert.equal(audios[1].paused, false); assert.equal(f.songs.at(-1).isPlaying, true);
  } finally { player.dispose(); }
});

test("account and companion changes suppress old local playing callbacks", async () => {
  await mount(false); await startup(); await act(async () => tree.update(React.createElement(Fixture, { showTogether: true })));
  const audio = audios.find(audio => audio.host), gate = deferred(); audio.playResult = gate.promise;
  await act(async () => musicButton("播放").props.onClick());
  const oldPlaying = tree.root.findByType("audio").props.onPlaying;
  identity = { accountScope: "fictional-new-account", companionScope: "fictional-new-companion" };
  await act(async () => tree.update(React.createElement(Fixture, { showTogether: true })));
  await startup(); const newRandom = audios.at(-1); assert.equal(newRandom.paused, false);
  await act(async () => { oldPlaying({ currentTarget: audio }); gate.resolve(); await Promise.resolve(); });
  assert.equal(newRandom.paused, false); assert.equal(tree.root.findByType(Card).props.song.isPlaying, true);
});

test("late built-in play completion cannot resume Audio after local takeover", async () => {
  const f = controller(), player = createBuiltInNowPlaying(f.options), gate = deferred();
  try {
    await player.start(); await player.control("pause", f.songs.at(-1)); audios[0].playResult = gate.promise;
    const work = player.control("play", f.songs.at(-1)); player.localPlaybackChanged(f.event("playing", {})); await work;
    gate.resolve(); for (let i = 0; i < 12; i++) await Promise.resolve();
    assert.equal(audios[0].paused, true); assert.equal(f.songs.at(-1), null);
  } finally { player.dispose(); }
});
