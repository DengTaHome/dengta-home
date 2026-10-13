import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { controlNowPlaying, normalizeNowPlaying, readNowPlaying } from "../src/device-activity.js";
import { runNowPlayingControl } from "../src/now-playing-controls.js";
import { createMusicRequestScope } from "../src/music-request-scope.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), server: { middlewareMode: true }, appType: "custom" });
const { default: Card } = await vite.ssrLoadModule("/src/NowPlayingCard.jsx");
after(() => vite.close());
const capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true };
const rawSong = { title: "Fictional song", artist: "Fictional artist", packageName: "music.fixture", sessionId: "session-a", isPlaying: true, playbackStateKnown: true };
const raw = (capabilities = {}) => ({ nowPlaying: { ...rawSong, ...capabilities } });
const all = { canControl: true, availableActions: ["play", "pause", "next"] };
const render = async (song, props = {}) => {
  let tree;
  await act(async () => { tree = TestRenderer.create(React.createElement(Card, { song, expanded: false, busy: false, ...props })); });
  return tree;
};
const button = (tree, label) => tree.root.findAllByType("button").find(item => item.props["aria-label"] === label);

test("a real native-read adapter and card disable actions omitted by the session", async () => {
  const song = await readNowPlaying({ capacitor, plugin: { getNowPlaying: async () => raw({ canControl: true, availableActions: ["pause"] }) } });
  const tree = await render(song);
  try {
    assert.equal(button(tree, "暂停").props.disabled, false);
    assert.equal(button(tree, "下一首").props.disabled, true, "package metadata cannot confer skip support");
    assert.match(button(tree, "下一首").props.title, /未提供下一首/);
    assert.ok(button(tree, "下一首").props["aria-describedby"]);
  } finally { await act(async () => tree.unmount()); }
});

test("notification-only metadata remains visible without pretending to control a session", async () => {
  const song = normalizeNowPlaying(raw({ playbackStateKnown: false, canControl: false, availableActions: [] }));
  const tree = await render(song);
  try {
    assert.equal(button(tree, "播放").props.disabled, true);
    assert.equal(button(tree, "下一首").props.disabled, true);
    assert.ok(tree.root.findAllByType("strong").some(item => item.children.includes(rawSong.title)));
    assert.match(tree.root.findByType("small").children.join(""), /识别|音乐 App/);
  } finally { await act(async () => tree.unmount()); }
});

test("capability false overrides offered actions and blocks direct bridge calls", async () => {
  let calls = 0;
  const song = normalizeNowPlaying(raw({ canControl: false, availableActions: ["play", "pause", "next"] }));
  assert.equal(song.canControl, false);
  assert.deepEqual(song.availableActions, []);
  await assert.rejects(controlNowPlaying("pause", { capacitor, expectedSong: song, plugin: { controlNowPlaying: async () => { calls++; return { controlled: true }; } } }), { code: "music_control_unsupported" });
  assert.equal(calls, 0);
});

test("old or malformed native capabilities stay unknown and cannot invent support", async () => {
  for (const capabilities of [{}, { canControl: "true", availableActions: ["next"] }, { canControl: true, availableActions: "next" }]) {
    const song = normalizeNowPlaying(raw(capabilities));
    const tree = await render(song);
    try {
      assert.equal(song.controlCapabilitiesKnown, false);
      assert.equal(button(tree, "暂停").props.disabled, true);
      assert.equal(button(tree, "下一首").props.disabled, true);
      assert.match(tree.root.findByType("small").children.join(""), /控制能力待确认/);
    } finally { await act(async () => tree.unmount()); }
  }
});

test("only fixed actions survive normalization; a missing player target never enables them", async () => {
  const song = normalizeNowPlaying(raw({ canControl: true, availableActions: ["next", "pause", "next", "toggle", "private-fixture", null, {}] }));
  assert.deepEqual(song.availableActions, ["pause", "next"]);
  assert.equal(Object.isFrozen(song.availableActions), true);
  const tree = await render({ ...song, packageName: "" });
  try {
    assert.equal(button(tree, "暂停").props.disabled, true);
    assert.equal(button(tree, "下一首").props.disabled, true);
  } finally { await act(async () => tree.unmount()); }
});

test("play and pause are distinct; a supported next button stays usable", async () => {
  const song = normalizeNowPlaying(raw({ isPlaying: false, canControl: true, availableActions: ["pause", "next"] }));
  const tree = await render(song);
  try {
    assert.equal(button(tree, "播放").props.disabled, true);
    assert.equal(button(tree, "下一首").props.disabled, false);
    await act(async () => tree.update(React.createElement(Card, { song: { ...song, isPlaying: true }, busy: true })));
    assert.equal(button(tree, "暂停").props.disabled, true);
    assert.equal(button(tree, "下一首").props.disabled, true);
    await act(async () => tree.update(React.createElement(Card, { song: { ...song, isPlaying: true, availableActions: ["play"] }, busy: false })));
    assert.match(tree.root.findByType("small").children.join(""), /暂停、下一首/);
  } finally { await act(async () => tree.unmount()); }
});

test("actual card click uses the runner and bridge with the same session; missing actions never dispatch", async () => {
  const identity = { accountScope: "account-a", companionScope: "companion-a" };
  const scope = createMusicRequestScope({ getSnapshot: () => ({ user: { id: identity.accountScope }, activeCompanionId: identity.companionScope }) });
  scope.bind(identity);
  const song = normalizeNowPlaying(raw(all));
  const commands = [], observed = [], feedback = [];
  const plugin = { controlNowPlaying: async request => { commands.push(request); return { controlled: true }; }, getNowPlaying: async () => raw({ ...all, isPlaying: false }) };
  const tree = await render(song, { onPlayPause: () => runNowPlayingControl({ scope, song, action: "pause", control: (action, options) => controlNowPlaying(action, { ...options, capacitor, plugin }), read: () => readNowPlaying({ capacitor, plugin }), onBusy: () => {}, onSong: value => observed.push(value), onFeedback: value => feedback.push(value) }) });
  try {
    await act(async () => button(tree, "暂停").props.onClick());
    assert.equal(commands.length, 1);
    assert.equal(commands[0].expectedSessionId, "session-a");
    assert.equal(observed[0].isPlaying, false);
    assert.match(feedback[0], /确认暂停/);
    await assert.rejects(controlNowPlaying("next", { capacitor, plugin, expectedSong: { ...song, availableActions: ["pause"] } }), { code: "music_control_unsupported" });
    assert.equal(commands.length, 1);
  } finally { await act(async () => tree.unmount()); scope.invalidate(); }
});

test("built-in controls keep playbackId ownership and do not depend on external capabilities", async () => {
  const tree = await render({ title: "Fictional local song", source: "dengta", playbackId: "owned-a", isPlaying: true });
  try {
    assert.equal(button(tree, "暂停").props.disabled, false);
    assert.equal(button(tree, "下一首").props.disabled, false);
    await act(async () => tree.update(React.createElement(Card, { song: { title: "Fictional local song", source: "dengta", isPlaying: false }, busy: false })));
    assert.equal(button(tree, "播放").props.disabled, true);
    assert.equal(button(tree, "下一首").props.disabled, true);
  } finally { await act(async () => tree.unmount()); }
});
