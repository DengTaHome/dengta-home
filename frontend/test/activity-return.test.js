import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { createActivityReturn, resolveActivityReturn } from "../src/activity-return.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const identity = Object.freeze({ accountScope: "account-a", companionScope: "companion-a" });
const session = Object.freeze({ id: "activity-a", status: "active", sessionMode: "listening", title: "虚构歌单" });
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), envFile: false, appType: "custom", logLevel: "silent",
  cacheDir: fileURLToPath(new URL("../../artifacts/dengta-design-polish-20261007/.vite-activity-return", import.meta.url)),
  server: { middlewareMode: true },
});
const { default: ActivityReturnBar } = await vite.ssrLoadModule("/src/ActivityReturnBar.jsx");
after(async () => { await vite.close(); });

for (const [mode, view, entryMode, label] of [
  ["listening", "music", "music", "一起听"], ["direct_media", "together", "direct", "一起看"],
  ["web_page", "together", "web", "一起看"], ["screen", "together", "external", "一起看"],
]) test(`return to ${mode} keeps the confirmed activity without changing supplied data`, () => {
  const current = Object.freeze({ ...session, sessionMode: mode });
  const before = JSON.stringify([current, identity]);
  const bookmark = createActivityReturn(current, identity, view);
  assert.deepEqual(resolveActivityReturn(bookmark, identity, current), { view, entryMode, label, sessionId: current.id, title: current.title });
  assert.equal(createActivityReturn(current, identity, view === "music" ? "together" : "music"), null);
  assert.equal(JSON.stringify([current, identity]), before);
  assert.ok(Object.isFrozen(bookmark));
});

test("ended, missing, switched or unsupported sessions cannot offer an activity return", () => {
  const bookmark = createActivityReturn(session, identity, "music");
  for (const current of [null, {}, { ...session, id: "other" }, { ...session, status: "ended" }, { ...session, sessionMode: "web_page" }]) {
    assert.equal(resolveActivityReturn(bookmark, identity, current), null);
  }
  for (const nextIdentity of [{ ...identity, accountScope: "account-b" }, { ...identity, companionScope: "companion-b" }, {}]) {
    assert.equal(resolveActivityReturn(bookmark, nextIdentity, session), null);
  }
  assert.equal(resolveActivityReturn(null, identity, session), null);
  assert.equal(createActivityReturn({ ...session, status: "ended" }, identity, "music"), null);
  assert.equal(createActivityReturn({ ...session, sessionMode: "unknown" }, identity, "music"), null);
  assert.equal(createActivityReturn(session, {}, "music"), null);
  assert.equal(createActivityReturn({ ...session, id: "" }, identity, "music"), null);
});

test("activity title stays bounded for display and is never copied to the return bookmark", () => {
  const current = { ...session, title: "⭐".repeat(300) };
  const bookmark = createActivityReturn(current, identity, "music");
  assert.equal(Object.hasOwn(bookmark, "title"), false);
  assert.equal(Array.from(resolveActivityReturn(bookmark, identity, current).title).length, 180);
  assert.equal(resolveActivityReturn(bookmark, identity, { ...session, title: null }).title, "");
});

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
function appFunction(name) {
  const start = app.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1);
  const open = app.indexOf("{", start);
  let depth = 1, end = open + 1;
  while (depth && end < app.length) { if (app[end] === "{") depth++; if (app[end] === "}") depth--; end++; }
  return app.slice(start, end);
}
function navigationFixture() {
  const calls = [], context = {
    activeView: "music", activeViewRef: { current: "music" }, coWatchIdentityRef: { current: { ...identity } },
    coWatchSessionRef: { current: session }, hasLoadedSettingsRef: { current: true }, draftSettingsRef: { current: {} },
    activityReturn: null, createActivityReturn, resolveActivityReturn,
    canLeaveWorkspace: () => true, shouldScheduleSettingsOnViewChange: () => false,
    scheduleSettingsAutosave: () => calls.push("settings-write"), closeComposerMenu: () => calls.push("close-menu"),
    requestStatusPanelClose: () => calls.push("close-status"),
    setActiveView: view => { calls.push(["view", view]); context.activeView = view; context.activeViewRef.current = view; },
    setIsSidebarOpen: value => calls.push(["sidebar", value]), setIsMobileNavOpen: value => calls.push(["navigation", value]),
    setActivityReturn: value => { context.activityReturn = value; }, setTogetherEntryMode: value => calls.push(["mode", value]),
  };
  vm.createContext(context);
  vm.runInContext(`${appFunction("changeView")}\n${appFunction("returnToActivity")}`, context);
  return { context, calls };
}

test("actual App navigation remembers only a confirmed same-scope activity and returns by its mode", () => {
  const { context, calls } = navigationFixture();
  context.changeView("chat");
  assert.equal(context.activityReturn.sessionId, session.id);
  calls.length = 0;
  context.returnToActivity();
  assert.deepEqual(calls.filter(Array.isArray).map(row => Array.from(row)), [["mode", "music"], ["view", "music"], ["sidebar", false], ["navigation", false]]);
  assert.ok(!calls.includes("settings-write"));
});

test("actual return revalidates an old click against the live account, companion and activity", () => {
  for (const switched of ["account", "companion", "session", "ended"]) {
    const { context, calls } = navigationFixture();
    context.changeView("chat"); calls.length = 0;
    if (switched === "account") context.coWatchIdentityRef.current.accountScope = "account-b";
    if (switched === "companion") context.coWatchIdentityRef.current.companionScope = "companion-b";
    if (switched === "session") context.coWatchSessionRef.current = { ...session, id: "activity-b" };
    if (switched === "ended") context.coWatchSessionRef.current = { ...session, status: "ended" };
    context.returnToActivity();
    assert.equal(context.activityReturn, null);
    assert.deepEqual(calls, []);
  }
});

test("blocked navigation, other pages and unconfirmed activity never create a misleading return entry", () => {
  for (const from of ["chat", "takeout", "workspace"]) {
    const { context } = navigationFixture(); context.activeViewRef.current = from; context.activeView = from;
    context.changeView("diary"); assert.equal(context.activityReturn, null);
  }
  const { context, calls } = navigationFixture();
  context.canLeaveWorkspace = () => false; context.changeView("chat");
  assert.equal(context.activityReturn, null); assert.deepEqual(calls, []);
  context.canLeaveWorkspace = () => true; context.coWatchSessionRef.current = null;
  context.changeView("chat"); assert.equal(context.activityReturn, null);
});

test("return bar opens only on user click and dismissing has no activity or data side effects", async () => {
  let opens = 0, dismissals = 0, tree;
  const activity = resolveActivityReturn(createActivityReturn(session, identity, "music"), identity, session);
  await act(async () => { tree = TestRenderer.create(React.createElement(ActivityReturnBar, { activity, onOpen: () => opens++, onDismiss: () => dismissals++ })); });
  try {
    assert.equal(opens, 0); assert.equal(dismissals, 0);
    assert.match(JSON.stringify(tree.toJSON()), /返回后核对播放进度/);
    assert.equal(tree.root.findByProps({ "aria-label": "回到本次活动" }).type, "section");
    await act(async () => tree.root.findByProps({ "aria-label": "回到一起听" }).props.onClick());
    assert.equal(opens, 1);
    await act(async () => tree.root.findByProps({ "aria-label": "收起活动入口" }).props.onClick());
    assert.equal(dismissals, 1); assert.equal(opens, 1);
    await act(async () => tree.update(React.createElement(ActivityReturnBar, { activity: null })));
    assert.equal(tree.toJSON(), null);
  } finally { await act(async () => tree.unmount()); }
});
