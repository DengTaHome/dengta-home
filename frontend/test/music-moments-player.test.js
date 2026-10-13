import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const entries = new Map();
globalThis.window = { setTimeout, clearTimeout, setInterval, clearInterval, localStorage: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) } };
const first = { id: "fictional-song-a", title: "虚构歌曲甲", artist: "虚构作者", url: "https://media.example.test/a.mp3" };
const second = { ...first, id: "fictional-song-b", title: "虚构歌曲乙", url: "https://media.example.test/b.mp3" };
const external = { id: "fictional-external", title: "虚构外部曲目", provider_track_id: "1001", playback_mode: "external_netease", duration_seconds: 150 };
const playlist = { id: "fictional-playlist", name: "虚构歌单", items: [first, second, external] };
let identity, calls, audio, tree, playbackChanges, positionChanges, playCalls;
const active = { id: "fictional-session", status: "active", sessionMode: "listening", musicPlaylistId: playlist.id, musicPlaylistItemId: first.id, revision: 1 };
globalThis.__momentPlayer = {
  auth: { getSnapshot: () => ({ user: { id: identity.accountScope }, activeCompanionId: identity.companionScope }), getRequestContext: async () => ({ accessToken: "fictional-placeholder", companionId: identity.companionScope }) },
  async request(path, options = {}) {
    calls.push({ path, method: options.method || "GET" });
    if (path.endsWith("/music/playlists")) return { playlists: [playlist] };
    if (path.endsWith(`/playlists/${playlist.id}`)) return { playlist };
    if (path.endsWith("/favorites")) return { favorites: [] };
    if (path.endsWith("/connections/manage")) return { connections: [] };
    if (path.endsWith("/cookie-session")) return { session: { connected: false } };
    if (path.endsWith("/queue")) return { session_id: active.id, current_queue_item_id: "fictional-queue-instance", revision: 1, items: [{ id: "fictional-queue-instance", playlist_id: playlist.id, item_id: first.id, title: first.title }] };
    throw Error("Unexpected fictional request " + path);
  },
};
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, envFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{ name: "moment-player-no-network", enforce: "pre", load(id) {
  const normalized = id.replaceAll("\\", "/");
  if (normalized.endsWith("/src/api.js")) return "export const apiRequest=(...args)=>globalThis.__momentPlayer.request(...args);export const apiFetch=apiRequest;export const fetchErrorLogById=apiRequest;";
  if (normalized.endsWith("/src/auth-session.js")) return "export const authSession=globalThis.__momentPlayer.auth;";
} }] });
const { default: TogetherMusic } = await vite.ssrLoadModule("/src/TogetherMusic.jsx");
after(() => vite.close());
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const button = label => tree.root.findAllByType("button").find(node => text(node) === label);
const output = () => JSON.stringify(tree.toJSON());
const momentSection = () => tree.root.findByProps({ className: "music-moments" });
const props = session => ({ ...identity, session, onPlaybackChange: value => playbackChanges.push(value), onPositionChange: value => positionChanges.push(value) });
async function mount(session = null) {
  entries.clear(); identity = { accountScope: "fictional-account", companionScope: "fictional-companion" }; calls = []; playbackChanges = []; positionChanges = []; playCalls = 0;
  audio = { currentSrc: first.url, currentTime: 31.25, duration: 120, readyState: 1, paused: true, ended: false, load() {}, pause() {}, removeAttribute() {}, play() { playCalls++; return Promise.resolve(); } };
  await act(async () => { tree = TestRenderer.create(React.createElement(TogetherMusic, props(session)), { createNodeMock: element => element.type === "audio" ? audio : null }); });
  if (!session) await act(async () => tree.root.findAllByType("select").find(node => node.findAllByType("option").some(option => option.props.value === playlist.id)).props.onChange({ target: { value: playlist.id } }));
}
async function click(label) { assert.ok(button(label), "Missing button " + label); await act(async () => button(label).props.onClick()); }
async function save() { await act(async () => momentSection().findByType("textarea").props.onChange({ target: { value: "虚构片段感受" } })); await act(async () => momentSection().findByType("form").props.onSubmit({ preventDefault() {} })); }
const saved = () => JSON.parse([...entries.entries()].find(([key]) => key.includes("music_moments"))[1]).moments;
async function track(index) { await act(async () => tree.root.findAllByType("select").find(node => node.props.value === 0 && node.findAllByType("option").some(option => option.props.value === 2)).props.onChange({ target: { value: index } })); }

test("local metadata updates progress before a together session without syncing it to the server", async () => {
  await mount(); await act(async () => tree.root.findByType("audio").props.onLoadedMetadata({ currentTarget: audio }));
  const slider = tree.root.findByProps({ className: "music-progress-range" });
  assert.equal(slider.props.max, 120); assert.equal(slider.props.value, 31.25); assert.equal(slider.props.disabled, false);
  assert.equal(positionChanges.length, 0); assert.equal(playbackChanges.length, 0);
});
test("player captures actual device time and seeks without starting playback or server writes", async () => {
  await mount(); await click("记住这一刻"); await save();
  assert.equal(saved()[0].positionSeconds, 31.25); assert.equal(saved()[0].itemId, first.id); assert.equal(saved()[0].playlistId, playlist.id);
  audio.currentTime = 80; await click("跳回片段"); assert.equal(audio.currentTime, 31.25); assert.equal(playCalls, 0);
  assert.equal(playbackChanges.length, 0); assert.ok(calls.every(call => call.method === "GET"));
});
test("unready metadata and stale audio source cannot capture a wrong track", async () => {
  await mount(); audio.readyState = 0; await click("记住这一刻"); assert.match(output(), /music_moment_player_unready/); assert.equal(entries.size, 0);
  audio.readyState = 1; audio.currentSrc = second.url; await click("记住这一刻"); assert.match(output(), /music_moment_player_unready/); assert.equal(entries.size, 0);
});
test("frozen draft survives a track change and does not silently relabel the captured position", async () => {
  await mount(); await click("记住这一刻"); await track(1); await save();
  assert.equal(saved()[0].itemId, first.id); assert.equal(saved()[0].title, first.title); assert.equal(button("跳回片段").props.disabled, true);
});
test("late seek handler revalidates the live track and duration", async () => {
  await mount(); await click("记住这一刻"); await save(); const oldSeek = button("跳回片段").props.onClick;
  await track(1); audio.currentSrc = second.url; audio.currentTime = 70; await act(async () => oldSeek()); assert.equal(audio.currentTime, 70); assert.match(output(), /music_moment_player_unready/);
});
test("account switch clears private cards and blocks old callbacks and identity-drift captures", async () => {
  await mount(); await click("记住这一刻"); await save(); const oldSeek = button("跳回片段").props.onClick;
  identity = { accountScope: "fictional-account-b", companionScope: "fictional-companion-b" };
  await click("记住这一刻"); assert.match(output(), /music_moment_scope_changed/);
  await act(async () => tree.update(React.createElement(TogetherMusic, props(null)))); assert.doesNotMatch(output(), /虚构片段感受/);
  audio.currentTime = 70; await act(async () => oldSeek()); assert.equal(audio.currentTime, 70); assert.equal(saved().length, 1);
});
test("external manual card never reads audio time, seeks or synchronizes cloud playback", async () => {
  await mount(); await track(2); audio.readyState = 0; await click("记住这一刻");
  await act(async () => momentSection().findByType("input").props.onChange({ target: { value: "1:02" } })); await save();
  assert.equal(saved()[0].positionSeconds, 62); assert.equal(saved()[0].positionSource, "manual"); assert.equal(saved()[0].itemId, external.id);
  assert.equal(button("跳回片段"), undefined); assert.equal(playCalls, 0); assert.equal(playbackChanges.length, 0); assert.ok(calls.every(call => call.method === "GET"));
});
test("active queue persists stable source IDs and retains normal explicit seek reporting", async () => {
  await mount(active); assert.equal(calls.filter(call => call.path.endsWith("/queue")).length, 1); assert.equal(tree.root.findByProps({ className: "music-queue" }).findAllByType("li").length, 1);
  await click("记住这一刻"); await save(); assert.equal(saved()[0].itemId, first.id); assert.notEqual(saved()[0].itemId, "fictional-queue-instance");
  audio.currentTime = 70; await click("跳回片段"); await act(async () => tree.root.findByType("audio").props.onSeeked({ currentTarget: audio }));
  assert.equal(playbackChanges.at(-1).musicPlaylistItemId, first.id); assert.equal(playbackChanges.at(-1).mediaPositionSeconds, 31.25); assert.equal(playCalls, 0);
});
