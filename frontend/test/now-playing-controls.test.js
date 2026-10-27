import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { createMusicRequestScope } from "../src/music-request-scope.js";
import { runNowPlayingControl } from "../src/now-playing-controls.js";
import { controlNowPlaying, normalizeNowPlaying } from "../src/device-activity.js";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let identity = { accountScope: "account-a", companionScope: "companion-a" };
const scope = createMusicRequestScope({ getSnapshot: () => ({ user: { id: identity.accountScope }, activeCompanionId: identity.companionScope }) });
scope.bind(identity);
const song = { packageName: "music.fixture", title: "Fictional song", artist: "Artist", sessionId: "fixture-session", isPlaying: true, canControl: true, availableActions: ["play", "pause", "next"] };
const messages = [], observations = [], busy = [];
const options = { scope, song, action: "pause", onBusy: value => busy.push(value), onSong: value => observations.push(value), onFeedback: value => messages.push(value) };
let calls = 0;
const pending = deferred();
const first = runNowPlayingControl({ ...options, control: () => { calls++; return pending.promise; }, read: async () => ({ ...song, isPlaying: false }) });
await runNowPlayingControl({ ...options, control: () => calls++, read: async () => song });
assert.equal(calls, 1, "synchronous lock prevents rapid duplicate native commands");
assert.equal(observations.length, 0, "no optimistic state change while command is pending");
pending.resolve({ submitted: true }); await first;
assert.equal(observations.at(-1).isPlaying, false); assert.match(messages.at(-1), /确认暂停/); assert.deepEqual(busy, [true, false]);

await runNowPlayingControl({ ...options, control: async () => { throw Object.assign(Error("Authorization: Bearer fictional-secret"), { code: "music_control_permission" }); }, read: async () => { throw Error("must not read on failure"); } });
assert.equal(observations.length, 1); assert.match(messages.at(-1), /music_control_permission/); assert.doesNotMatch(messages.at(-1), /fictional-secret/);
await runNowPlayingControl({ ...options, control: async () => ({ submitted: true }), read: async () => song });
assert.match(messages.at(-1), /等待播放器更新/); assert.equal(observations.at(-1).isPlaying, true);
await runNowPlayingControl({ ...options, action: "next", control: async () => ({ submitted: true }), read: async () => null });
assert.ok(observations.at(-1), "next must not clear the existing card before a new song is observed"); assert.match(messages.at(-1), /等待播放器更新/);
await runNowPlayingControl({ ...options, action: "next", control: async () => ({ submitted: true }), read: async () => ({ ...song, title: "Next song" }) });
assert.match(messages.at(-1), /切歌后的/);
await runNowPlayingControl({ ...options, action: "next", control: async () => ({ submitted: true }), read: async () => ({ ...song, packageName: "other.player", title: "Other song" }) });
assert.match(messages.at(-1), /等待播放器更新/, "a different player cannot confirm this player's next command");

const late = deferred(), messageCount = messages.length, observedCount = observations.length;
const old = runNowPlayingControl({ ...options, control: () => late.promise, read: async () => { throw Error("old identity must not read"); } });
identity = { accountScope: "account-b", companionScope: "companion-b" }; scope.bind(identity); late.resolve({ submitted: true }); await old;
assert.equal(messages.length, messageCount); assert.equal(observations.length, observedCount);
assert.equal(scope.busy("now-playing-control"), false);

const capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true };
for (const code of ["music_control_permission", "music_control_session_changed", "music_control_unsupported"]) {
  await assert.rejects(controlNowPlaying("pause", { capacitor, expectedSong: song, plugin: { controlNowPlaying: async () => ({ controlled: false, code }) } }), { code });
}
await assert.rejects(controlNowPlaying("pause", { capacitor, expectedSong: song, plugin: { controlNowPlaying: async () => { throw Error("private native failure"); } } }), { code: "music_control_failed", message: "系统播放器指令发送失败，请在音乐 App 中重试。" });
await assert.rejects(controlNowPlaying("toggle", { capacitor, expectedSong: song }), { code: "music_control_invalid" });
await assert.rejects(controlNowPlaying("pause", { capacitor: { isNativePlatform: () => false } }), { code: "music_control_unavailable" });
assert.deepEqual(await controlNowPlaying("pause", { capacitor, expectedSong: song, plugin: { controlNowPlaying: async request => { assert.equal(request.expectedPackage, song.packageName); assert.equal(request.expectedSessionId, song.sessionId); return { controlled: true }; } } }), { submitted: true });
assert.equal(normalizeNowPlaying({ nowPlaying: song }).sessionId, "fixture-session");
assert.equal(normalizeNowPlaying({ nowPlaying: { ...song, playbackStateKnown: false } }).isPlaying, false, "a notification is not evidence of playing");
await runNowPlayingControl({ ...options, action: "play", control: async () => ({ submitted: true }), read: async () => ({ ...song, playbackStateKnown: false }) });
assert.match(messages.at(-1), /等待播放器更新/, "unknown state cannot confirm playback");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), server: { middlewareMode: true }, appType: "custom" });
let tree;
try {
  const { default: Card } = await vite.ssrLoadModule("/src/NowPlayingCard.jsx");
  let clicked = 0;
  await act(async () => { tree = TestRenderer.create(React.createElement(Card, { song, busy: true, expanded: false, onNext: () => clicked++ })); });
  const buttons = tree.root.findAllByType("button");
  assert.equal(buttons.length, 4);
  for (const button of buttons) {
    let parent = button.parent;
    while (parent) { assert.notEqual(parent.type, "button", "no nested buttons"); assert.notEqual(parent.props["aria-hidden"], "true", "controls must be visible to screen readers"); parent = parent.parent; }
  }
  assert.equal(buttons.find(b => b.props["aria-label"] === "下一首").props.disabled, true);
  await act(async () => tree.update(React.createElement(Card, { song, busy: false, expanded: true, onNext: () => clicked++ })));
  const next = tree.root.findAllByType("button").find(b => b.props["aria-label"] === "下一首");
  assert.equal(next.props.disabled, false); await act(async () => next.props.onClick()); assert.equal(clicked, 1);
} finally { if (tree) await act(async () => tree.unmount()); await vite.close(); }
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
assert.doesNotMatch(app, /void controlNowPlaying/);
assert.match(app, /runNowPlayingControl/); assert.match(app, /nowPlayingBusy=\{nowPlayingBusy\}/);
console.log("Now playing: real controller/adapter and React card passed; scoped cancellation, serial commands, truthful observation, private error redaction and accessible busy controls");
