import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { createVisualLoop } from "../src/visual-loop.js";
import { recordOperationFailure, readOperationFailures, diagnosticScopeKey, clearOperationFailures } from "../src/operation-diagnostics.js";
import { FEATURE_GROUPS, FEATURE_LABELS, QUICK_FEATURES, FEATURE_DETAILS, filterFeatures } from "../src/feature-navigation.js";
import { pickActivity } from "../src/chat-activities.js";

const doc = Object.assign(new EventTarget(), { hidden: false });
const media = Object.assign(new EventTarget(), { matches: false });
const frames = new Map(), timers = new Map(); let nextId = 0, draws = 0;
const win = {
  matchMedia: () => media,
  requestAnimationFrame: fn => { frames.set(++nextId, fn); return nextId; },
  cancelAnimationFrame: id => frames.delete(id),
  setTimeout: fn => { timers.set(++nextId, fn); return nextId; },
  clearTimeout: id => timers.delete(id),
};
const flush = queue => { const pending = [...queue.values()]; queue.clear(); pending.forEach(fn => fn(100)); };
const loop = createVisualLoop(() => draws++, { windowObject: win, documentObject: doc });
flush(frames); assert.equal(draws, 1); assert.equal(frames.size, 0); assert.equal(timers.size, 1);
doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange"));
assert.equal(timers.size + frames.size, 0, "hidden canvas releases callbacks");
doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange")); flush(frames);
assert.equal(draws, 2);
media.matches = true; media.dispatchEvent(new Event("change")); flush(frames);
assert.equal(draws, 3); assert.equal(timers.size + frames.size, 0, "reduced motion draws one still frame");
loop.invalidate(); flush(frames); assert.equal(draws, 4, "resize can refresh a still frame");
loop.dispose(); doc.dispatchEvent(new Event("visibilitychange")); assert.equal(frames.size + timers.size, 0);
const scope = diagnosticScopeKey("a", "c");
recordOperationFailure(scope, "/api/v2/fun-labs/achievements/custom?secret=fixture", { message: "private fixture", stack: "private fixture", code: "private_fixture", status: 503 });
const record = readOperationFailures(scope)[0]; assert.equal(record.code, "DT-ACHIEVEMENTS");
assert.ok(!JSON.stringify(record).includes("fixture"));
assert.equal(recordOperationFailure(scope, "/api/v2/co-watch/sessions/fixture/playback", {}).code, "DT-WATCH");
assert.equal(recordOperationFailure(scope, "/api/external-memory/connections", {}).code, "DT-MCP");
assert.equal(recordOperationFailure(scope, "/api/v2/music-private", {}).code, "DT-API");
assert.equal(readOperationFailures(diagnosticScopeKey("b", "c")).length, 0);
for (let i = 0; i < 80; i++) recordOperationFailure(scope, "/unknown", {});
assert.equal(readOperationFailures(scope).length, 50);
clearOperationFailures(scope); assert.equal(readOperationFailures(scope).length, 0);
recordOperationFailure(scope, "/unknown", { name: "AbortError" }); assert.equal(readOperationFailures(scope).length, 0);
assert.notEqual(pickActivity("rain-bookshop", () => 0).id, "rain-bookshop");
const expectedFeatures = ["chat", "moments", "diary", "art", "nursery", "cotton", "together", "music", "duel", "memories", "achievements", "discover", "takeout", "workspace"];
assert.deepEqual(FEATURE_GROUPS.flatMap(group => group.ids).sort(), [...expectedFeatures].sort());
assert.ok(QUICK_FEATURES.every(id => FEATURE_LABELS[id]));
const searchItems = Object.keys(FEATURE_LABELS).map(id => ({ id, label: FEATURE_LABELS[id] }));
assert.deepEqual(filterFeatures(searchItems, "电影").map(item => item.id), ["together"]);
assert.deepEqual(filterFeatures(searchItems, "ＭＣＰ").map(item => item.id), ["memories"]);
assert.deepEqual(filterFeatures(searchItems, " 离线 文件 ").map(item => item.id), ["workspace"]);
assert.deepEqual(filterFeatures(searchItems, "新手").map(item => item.id), ["achievements"]);
assert.equal(filterFeatures(searchItems, "").length, expectedFeatures.length);
assert.deepEqual(filterFeatures(searchItems, "涂鸦").map(item => item.id), ["art"]);
assert.ok(Object.keys(FEATURE_LABELS).every(id => FEATURE_DETAILS[id]?.hint));

const old = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
let tree;
try {
  const { default: Navigation } = await vite.ssrLoadModule("/src/FeatureNavigation.jsx");
  const items = Object.entries(FEATURE_LABELS).map(([id, label]) => ({ id, label, icon: "✧" }));
  const selected = [];
  await act(async () => { tree = TestRenderer.create(React.createElement(Navigation, { items, activeView: "chat", onNavigate: id => selected.push(id) })); });
  assert.equal(tree.root.findByType("nav").findAllByType("button").length, expectedFeatures.length);
  await act(async () => tree.root.findByType("input").props.onChange({ target: { value: "听歌" } }));
  assert.equal(tree.root.findByType("nav").findAllByType("button").length, 1);
  assert.ok(tree.root.findByProps({ "aria-label": "清空玩法搜索" }));
  await act(async () => tree.root.findByType("nav").findByType("button").props.onClick());
  assert.deepEqual(selected, ["music"]);
  await act(async () => tree.root.findByType("input").props.onChange({ target: { value: "没有这个功能" } }));
  assert.equal(tree.root.findByType("nav").findAllByType("button").length, 0);
  console.log("Interaction polish: canvas lifecycle, reduced motion, diagnostic privacy/scope/bounds, navigation and activity discovery passed");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  if (old === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = old;
}
