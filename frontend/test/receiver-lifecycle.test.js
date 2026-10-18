import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const original = Object.fromEntries(["window", "fetch", "sessionStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const key = "dengta.cast.receiver-token.v1";
const values = new Map(), calls = [], timeouts = new Map(), intervals = new Map(), storageWrites = [];
let tree, ReceiverApp, vite, cacheDir, nextTimer = 0, video, playbackFailure;
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const session = (revision = 5, changes = {}) => ({ id: "fictional-session-a", status: "active", title: "虚构影片A", playback_revision: revision, playback_state: "playing", media_position_seconds: 12, media_url: "https://media.example.test/a.mp4", ...changes });
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem(k, v) { values.set(k, v); storageWrites.push(k); }, removeItem: key => values.delete(key) } });
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  setTimeout(fn) { const id = ++nextTimer; timeouts.set(id, fn); return id; }, clearTimeout(id) { timeouts.delete(id); },
  setInterval(fn) { const id = ++nextTimer; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
} });
Object.defineProperty(globalThis, "fetch", { configurable: true, value: (url, options) => {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  const call = { path: new URL(url).pathname, options, resolve, settled: false };
  call.finish = (data, status = 200) => { call.settled = true; resolve(response(data, status)); };
  calls.push(call);
  if (call.path.endsWith("/ack")) call.finish({ receiver: { acknowledged: true } });
  return promise;
} });
before(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "dengta-receiver-lifecycle-"));
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), cacheDir, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ default: ReceiverApp } = await vite.ssrLoadModule("/src/ReceiverApp.jsx"));
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  await act(async () => { for (const call of calls) if (!call.settled) call.finish({ code: "cast_token_invalid" }, 401); await tick(); });
  calls.length = 0; timeouts.clear(); intervals.clear(); values.clear(); storageWrites.length = 0; playbackFailure = null;
});
after(async () => {
  await vite.close();
  assert.equal(dirname(resolve(cacheDir)), resolve(tmpdir())); assert.ok(basename(cacheDir).startsWith("dengta-receiver-lifecycle-"));
  rmSync(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  for (const [name, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});
async function tick() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
async function mount(token = "fictional-token-a") {
  if (token) values.set(key, token);
  video = { currentTime: 0, paused: true, playCalls: 0, readyState: 4, pause() { this.paused = true; }, load() {}, removeAttribute() {}, getAttribute(name) { return name === "src" && tree ? tree.root.findByType("video").props.src : null; }, async play() { this.playCalls++; if (playbackFailure) { const error = playbackFailure; playbackFailure = null; throw error; } this.paused = false; } };
  await act(async () => { tree = TestRenderer.create(React.createElement(ReceiverApp), { createNodeMock: element => element.type === "video" ? video : null }); await tick(); });
}
const button = text => tree.root.findAllByType("button").find(node => node.children.join("") === text);
const message = () => tree.root.findByProps({ className: "receiver-message" }).children.join("");
const reads = () => calls.filter(call => call.path.endsWith("/session"));
const pairs = () => calls.filter(call => call.path.endsWith("/pair"));
async function runInitial() { await act(async () => { const pending = [...timeouts.values()]; timeouts.clear(); pending.forEach(fn => fn()); await tick(); }); }
async function pollInterval() { await act(async () => { for (const fn of intervals.values()) fn(); await tick(); }); }
async function complete(call, data, status = 200) { await act(async () => { call.finish(data, status); await tick(); }); }
async function fillPair(code = "123456", id = "fictional-session-b") { await act(async () => { const inputs = tree.root.findByType("form").findAllByType("input"); inputs[0].props.onChange({ target: { value: id } }); inputs[1].props.onChange({ target: { value: code } }); }); }
async function submit() { await act(async () => { tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); await tick(); }); }

test("a restored receiver without media omits the video source", async () => {
  await mount(); assert.equal(tree.root.findByType("video").props.src, undefined);
});
test("a slow state read does not overlap every polling interval", async () => {
  await mount(); await runInitial(); await pollInterval(); await pollInterval(); assert.equal(reads().length, 1);
});
test("same-tick pairing sends one grant request", async () => {
  await mount(""); await fillPair();
  await act(async () => { const handler = tree.root.findByType("form").props.onSubmit; handler({ preventDefault() {} }); handler({ preventDefault() {} }); await tick(); });
  assert.equal(pairs().length, 1);
});
test("a late pairing result cannot persist a token after unmount", async () => {
  await mount(""); await fillPair(); await submit(); const pending = pairs()[0];
  await act(async () => tree.unmount()); tree = null;
  await complete(pending, { receiver_token: "fictional-late-token" });
  assert.equal(values.has(key), false); assert.equal(storageWrites.length, 0); assert.equal(pending.options.signal?.aborted, true);
});
test("pair success preserves the newer form draft for the next pairing", async () => {
  await mount(""); await fillPair(); await submit(); await fillPair("654321", "fictional-next-draft");
  await complete(pairs()[0], { receiver_token: "fictional-token-b" }); await runInitial();
  await complete(reads().at(-1), { code: "cast_token_invalid" }, 401);
  const inputs = tree.root.findByType("form").findAllByType("input");
  assert.equal(inputs[0].props.value, "fictional-next-draft"); assert.equal(inputs[1].props.value, "654321");
});
test("play failure leaves a usable confirmation button and does not consume the revision", async () => {
  await mount(); await runInitial(); await complete(reads()[0], { session: session() });
  playbackFailure = new Error("FICTIONAL_PRIVATE_MEDIA_ERROR");
  await act(async () => { await button("准备播放").props.onClick(); await tick(); });
  assert.ok(button("准备播放")); assert.doesNotMatch(message(), /FICTIONAL_PRIVATE_MEDIA_ERROR/);
  await act(async () => { await button("准备播放").props.onClick(); await tick(); }); assert.equal(video.playCalls, 2);
});
test("missing session receipt reports a code instead of treating it as a connected session", async () => {
  await mount(); await runInitial(); await complete(reads()[0], {});
  assert.match(message(), /cast_receiver_receipt_invalid/); assert.ok(button("重新读取状态"));
});
test("older revision cannot replace the displayed media after playback was confirmed", async () => {
  await mount(); await runInitial(); await complete(reads()[0], { session: session() });
  await act(async () => { await button("准备播放").props.onClick(); await tick(); });
  await runInitial(); await pollInterval(); await complete(reads().at(-1), { session: session(4, { title: "旧影片", media_url: "https://media.example.test/old.mp4" }) });
  assert.equal(tree.root.findByType("video").props.src, session().media_url);
});
test("an old authorization error cannot remove the newly paired receiver", async () => {
  await mount(); await runInitial(); const old = reads()[0];
  if (button("重新配对")) await act(async () => button("重新配对").props.onClick());
  else { await pollInterval(); await complete(reads().at(-1), { code: "cast_token_invalid" }, 401); }
  await fillPair(); await submit(); await complete(pairs()[0], { receiver_token: "fictional-token-b" });
  await complete(old, { code: "cast_token_invalid" }, 401);
  assert.equal(values.get(key), "fictional-token-b"); assert.equal(tree.root.findAllByType("video").length, 1);
});
test("a current unauthorized read still clears its own receiver", async () => {
  await mount(); await runInitial(); await complete(reads()[0], { code: "cast_token_invalid" }, 401);
  assert.equal(values.has(key), false); assert.equal(tree.root.findAllByType("form").length, 1);
});
test("a temporary read failure exposes a safe reason and GET-only recovery", async () => {
  await mount(); await runInitial(); await complete(reads()[0], { message: "FICTIONAL_PRIVATE_UPSTREAM_BODY", code: "FICTIONAL_PRIVATE_CODE" }, 503);
  assert.match(message(), /cast_receiver_request_failed.*HTTP 503/); assert.doesNotMatch(message(), /FICTIONAL_PRIVATE/);
  await act(async () => { button("重新读取状态").props.onClick(); await tick(); });
  assert.equal(reads().length, 2); assert.equal(pairs().length, 0);
  await complete(reads()[1], { session: session() }); assert.equal(button("重新读取状态"), undefined);
});
test("autoplay denial keeps manual confirmation available", async () => {
  await mount(); await runInitial(); await complete(reads()[0], { session: session() });
  playbackFailure = Object.assign(new Error("blocked"), { name: "NotAllowedError" });
  await act(async () => { await button("准备播放").props.onClick(); }); assert.ok(button("准备播放"));
  await act(async () => { await button("准备播放").props.onClick(); }); assert.equal(video.playCalls, 2);
});
test("a missing pair receipt does not store a token or hide the form", async () => {
  await mount(""); await fillPair(); await submit(); await complete(pairs()[0], {});
  assert.equal(values.has(key), false); assert.ok(tree.root.findByType("form")); assert.match(message(), /cast_receiver_receipt_invalid/);
});
test("media decoding failure has a reload action without another pairing request", async () => {
  await mount(); await runInitial(); await complete(reads()[0], { session: session() });
  await act(async () => tree.root.findByType("video").props.onError({ currentTarget: { error: { code: 3 } } }));
  assert.match(message(), /media_decode/); assert.ok(button("准备播放"));
  await act(async () => button("重新载入视频").props.onClick()); assert.equal(pairs().length, 0); assert.ok(button("准备播放"));
});
test("metadata loading does not consume the playback confirmation", async () => {
  await mount(); await runInitial(); await complete(reads()[0], { session: session() }); video.readyState = 0;
  await act(async () => { await button("准备播放").props.onClick(); }); assert.equal(video.playCalls, 0); assert.ok(button("准备播放"));
  video.readyState = 1; await act(async () => { await button("准备播放").props.onClick(); }); assert.equal(video.playCalls, 1);
});
test("same-tick prepare clicks share one pending playback operation", async () => {
  await mount(); await runInitial(); await complete(reads()[0], { session: session() });
  await act(async () => { const prepare = button("准备播放").props.onClick; prepare(); prepare(); await tick(); }); assert.equal(video.playCalls, 1);
});
test("same-revision reads do not discard a slow manual playback result", async () => {
  await mount(); await runInitial(); await complete(reads()[0], { session: session() });
  let resolvePlay; video.play = () => new Promise(resolve => { resolvePlay = resolve; });
  await act(async () => { button("准备播放").props.onClick(); await tick(); });
  await pollInterval(); await complete(reads().at(-1), { session: session() });
  await act(async () => { video.paused = false; resolvePlay(); await tick(); });
  assert.equal(button("准备播放"), undefined); assert.match(message(), /自动同步/);
});
test("a pending automatic playback never blocks a later pause command read", async () => {
  await mount(); await runInitial(); await complete(reads()[0], { session: session() });
  await act(async () => { await button("准备播放").props.onClick(); });
  let resolvePlay; video.play = () => new Promise(resolve => { resolvePlay = resolve; });
  await pollInterval(); await complete(reads().at(-1), { session: session(6) });
  await pollInterval(); assert.equal(reads().length, 3);
  await complete(reads().at(-1), { session: session(7, { playback_state: "paused" }) }); assert.equal(video.paused, true);
  await act(async () => { resolvePlay(); await tick(); });
  const ack = calls.filter(call => call.path.endsWith("/ack")).at(-1); assert.equal(JSON.parse(ack.options.body).revision, 7);
});
test("reloading video invalidates the earlier play rejection", async () => {
  await mount(); await runInitial(); await complete(reads()[0], { session: session() });
  let rejectPlay; video.play = () => new Promise((_, reject) => { rejectPlay = reject; });
  await act(async () => { button("准备播放").props.onClick(); await tick(); });
  await act(async () => button("重新载入视频").props.onClick());
  await act(async () => { rejectPlay(new Error("late")); await tick(); }); assert.match(message(), /正在重新载入/);
});
test("a new pause command cancels pending first-time manual playback", async () => {
  await mount(); await runInitial(); await complete(reads()[0], { session: session() });
  let rejectPlay, pauseCalls = 0;
  video.play = () => new Promise((_, reject) => { rejectPlay = reject; });
  video.pause = () => { pauseCalls++; video.paused = true; rejectPlay?.(Object.assign(new Error("pause cancels play"), { name: "AbortError" })); };
  await act(async () => { button("准备播放").props.onClick(); await tick(); });
  await pollInterval(); await complete(reads().at(-1), { session: session(6, { playback_state: "paused" }) });
  assert.equal(pauseCalls, 1); assert.equal(video.paused, true); assert.ok(button("准备播放")); assert.doesNotMatch(message(), /playback_failed/);
});
