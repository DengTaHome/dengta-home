import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import React, { act, useState } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const timers = new Map(); let timerId = 0, tree, identity, requests, audios, wait, randomEnabled, external, feedback;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
class AudioStub {
  constructor(url) { this.url = url; this.paused = true; this.ended = false; this.handlers = {}; audios.push(this); }
  addEventListener(name, listener) { (this.handlers[name] ||= new Set()).add(listener); }
  removeEventListener(name, listener) { this.handlers[name]?.delete(listener); }
  emit(name) { this.handlers[name]?.forEach(listener => listener()); }
  async play() { this.paused = false; this.emit("play"); }
  pause() { this.paused = true; this.emit("pause"); }
  removeAttribute(name) { assert.equal(name, "src"); this.released = true; }
  load() {}
}
const originals = { window: globalThis.window, Audio: globalThis.Audio };
globalThis.Audio = AudioStub;
globalThis.window = { localStorage: { getItem: () => randomEnabled ? "1" : "0" },
  setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); } };
globalThis.__localMusicFixture = {
  auth: { getSnapshot: () => ({ user: { id: identity.account }, activeCompanionId: identity.companion }),
    getRequestContext: async () => ({ accessToken: "fictional-placeholder", companionId: identity.companion }) },
  async request(path, options) {
    const before = await options.authSession.getRequestContext();
    requests.push({ path, options, before });
    if (wait) await wait.promise;
    options.signal.throwIfAborted();
    return { playable: true, song: { title: "虚构歌曲" + requests.length, url: "https://media.example.test/fixture.mp3" } };
  },
};
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{ name: "local-music-no-network", enforce: "pre", load(id) {
  const path = id.replaceAll("\\", "/");
  if (path.endsWith("/src/api.js")) return "export const apiRequest=(...args)=>globalThis.__localMusicFixture.request(...args);";
  if (path.endsWith("/src/auth-session.js")) return "export const authSession=globalThis.__localMusicFixture.auth;";
} }] });
const { useMusicScope } = await vite.ssrLoadModule("/src/use-music-scope.js");
const { useBuiltInNowPlaying } = await vite.ssrLoadModule("/src/useBuiltInNowPlaying.js");
const { default: Card } = await vite.ssrLoadModule("/src/NowPlayingCard.jsx");
function Fixture({ account, companion, enabled = true }) {
  const [song, setSong] = useState(null), [busy, setBusy] = useState(false);
  const scope = useMusicScope(account, companion);
  const { control } = useBuiltInNowPlaying({ scope, accountScope: account, companionScope: companion, enabled,
    externalAvailable: () => true, readExternal: async () => external,
    onSong: setSong, onBusy: setBusy, onFeedback: value => feedback.push(value), onStartupFeedback: value => feedback.push(value),
  });
  return song ? React.createElement(Card, { song, busy, onPlayPause: () => void control(song.isPlaying ? "pause" : "play", song), onNext: () => void control("next", song) }) : React.createElement("span", null, "empty");
}
async function mount() {
  identity = { account: "fictional-account-a", companion: "fictional-companion-a" }; requests = []; audios = []; wait = null; feedback = []; randomEnabled = true; external = null; timers.clear();
  await act(async () => { tree = TestRenderer.create(React.createElement(Fixture, identity)); });
}
const runTimer = async () => { const callback = [...timers.values()].at(-1); timers.clear(); await act(async () => { await callback?.(); }); };
const button = label => tree.root.findAllByType("button").find(node => node.props["aria-label"] === label);
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
after(async () => { await vite.close(); globalThis.window = originals.window; globalThis.Audio = originals.Audio; delete globalThis.__localMusicFixture; });

test("real local card buttons control fake Audio and show confirmed state", async () => {
  await mount(); await runTimer();
  assert.equal(button("暂停").props.disabled, false); assert.equal(button("下一首").props.disabled, false);
  await act(async () => button("暂停").props.onClick()); assert.equal(audios[0].paused, true); assert.ok(button("播放"));
  await act(async () => button("播放").props.onClick()); assert.equal(audios[0].paused, false); assert.ok(button("暂停"));
  await act(async () => button("下一首").props.onClick()); assert.equal(audios.length, 2); assert.equal(audios[0].released, true);
  assert.equal(requests.every(call => call.before.companionId === "fictional-companion-a"), true);
});
test("pending next is locked immediately and scope switch aborts old work", async () => {
  await mount(); await runTimer(); wait = deferred();
  await act(async () => { button("下一首").props.onClick(); button("下一首").props.onClick(); });
  assert.equal(requests.length, 2); assert.equal(button("下一首").props.disabled, true);
  const old = requests.at(-1); identity = { account: "fictional-account-b", companion: "fictional-companion-b" };
  await act(async () => { tree.update(React.createElement(Fixture, identity)); });
  assert.equal(old.options.signal.aborted, true); assert.equal(audios[0].released, true);
  const before = feedback.length; await act(async () => { wait.resolve(); });
  assert.equal(audios.length, 1); assert.equal(feedback.length, before);
});
test("external playing music prevents startup overlap and unmount cancels timer", async () => {
  await mount(); external = { title: "虚构系统歌曲", isPlaying: true }; await runTimer(); assert.equal(audios.length, 0); assert.equal(requests.length, 0);
  await act(async () => tree.unmount()); tree = null;
  await mount(); const late = [...timers.values()].at(-1); await act(async () => tree.unmount()); tree = null;
  assert.equal(timers.size, 0); await late(); assert.equal(requests.length, 0);
});
test("package-less external metadata stays disabled, supported system player stays available", async () => {
  for (const [song, disabled] of [[{ title: "虚构卡片" }, true], [{ title: "虚构卡片", packageName: "fictional.music", canControl: true, availableActions: ["play", "pause", "next"] }, false], [{ title: "虚构卡片", source: "dengta", playbackId: "fictional-playback" }, false]]) {
    await act(async () => { tree = TestRenderer.create(React.createElement(Card, { song })); });
    assert.equal(button("下一首").props.disabled, disabled); assert.equal(button("播放").props.disabled, disabled);
    await act(async () => tree.unmount()); tree = null;
  }
});
