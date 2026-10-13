import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { createCoWatchViewScope } from "../src/co-watch-view-scope.js";
import { createCoWatchLifecycle } from "../src/co-watch-lifecycle.js";

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
function fixture() {
  let identity = { accountScope: "fictional-account", companionScope: "fictional-companion" }, viewKind = "together";
  const scope = createCoWatchViewScope({ getIdentity: () => identity, getViewKind: () => viewKind });
  return { scope, setIdentity: next => { identity = next; }, setView: next => { viewKind = next; } };
}

test("view refresh remembers video mode separately from listening and invalidates abandoned or older reads", () => {
  const f = fixture();
  const first = f.scope.capture({ mode: "direct" });
  assert.equal(first.sessionMode, "direct_media");
  const poll = f.scope.capture();
  assert.equal(poll.sessionMode, "direct_media");
  assert.equal(f.scope.current(first), false);
  const manual = f.scope.capture({ channel: "manual" });
  const polling = f.scope.capture({ channel: "poll" });
  assert.equal(f.scope.current(manual), true, "a poll must not invalidate the manual dialog read");
  const nextPoll = f.scope.capture({ channel: "poll" });
  assert.equal(f.scope.current(polling), false);
  assert.equal(f.scope.current(nextPoll), true);
  f.setView("music");
  assert.equal(f.scope.current(poll), false);
  assert.equal(f.scope.capture().sessionMode, "listening");
  f.setView("together");
  assert.equal(f.scope.capture().sessionMode, "direct_media");
  assert.equal(f.scope.capture({ mode: "web_page" }).sessionMode, "web_page");
  assert.equal(f.scope.capture({ mode: "external" }).sessionMode, "screen");
  const beforeSwitch = f.scope.capture({ mode: "web" });
  f.setIdentity({ accountScope: "fictional-account", companionScope: "another-fictional-companion" });
  assert.equal(f.scope.current(beforeSwitch), false);
  assert.equal(f.scope.capture().sessionMode, "screen");
  const beforeUnmount = f.scope.capture();
  f.scope.invalidate();
  assert.equal(f.scope.current(beforeUnmount), false);
});

test("an untouched entry uses its supplied default once and retains an explicit choice", () => {
  const f = fixture();
  assert.equal(f.scope.capture({ fallbackMode: "web_page" }).sessionMode, "web_page");
  assert.equal(f.scope.capture({ fallbackMode: "screen" }).sessionMode, "web_page");
  assert.equal(f.scope.capture({ mode: "direct", fallbackMode: "web_page" }).sessionMode, "direct_media");
});

function actualAppRefresh({ session = null, readSession } = {}) {
  const source = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const start = source.indexOf("  const refreshCoWatchExperience = useCallback(");
  const end = source.indexOf("  const flushPendingScreenGlanceTurn", start);
  assert.ok(start > 0 && end > start, "load the actual App refresh callback");
  const identity = { accountScope: "fictional-account", companionScope: "fictional-companion" };
  const context = {
    activeView: "together", togetherEntryMode: "external", useCallback: fn => fn,
    DIRECT_MEDIA_SOURCE_APP: "dengta-direct-media", WEB_PAGE_SOURCE_APP: "dengta-web-page",
    resolveCoWatchSessionMode: mode => ({ music: "listening", direct: "direct_media", web: "web_page" }[mode] || "screen"),
    coWatchSessionRef: { current: session }, coWatchIdentityRef: { current: identity }, applied: [], requested: [],
    danmaku: [{ text: "虚构旧场次弹幕" }], danmakuClears: 0,
    coWatchPollStampRef: { current: null },
    setCoWatchSession(next) { context.applied.push(next); },
    setCoWatchDanmaku(next) { context.danmaku = next; context.danmakuClears++; },
    setCoWatchDialog() {}, setCoWatchPreview() {}, setScreenGlanceFeedback() {},
    readActiveCoWatchSession: async ({ sessionMode }) => { context.requested.push(sessionMode); return readSession(sessionMode); },
    readCoWatchPreview: async () => ({}), refreshScreenGlanceState: async () => ({}), readCoWatchDialog: async () => [],
  };
  context.coWatchLifecycleRef = { current: createCoWatchLifecycle({ getIdentity: () => identity, getSession: () => context.coWatchSessionRef.current, isBusy: () => false, onBusy() {}, onStarted() {}, onEnded() {}, createSession() {}, endSession() {} }) };
  context.coWatchViewScopeRef = { current: createCoWatchViewScope({ getIdentity: () => identity, getViewKind: () => context.activeView }) };
  context.coWatchViewKindRef = { get current() { return context.activeView; } };
  vm.runInNewContext(source.slice(start, end) + "\nglobalThis.refreshActual = refreshCoWatchExperience;", context);
  return context;
}

test("actual App poll retains an active direct session after the user's explicit video selection", async () => {
  const session = { id: "fictional-direct", status: "active", sessionMode: "direct_media", sourceApp: "dengta-direct-media" };
  const f = actualAppRefresh({ session, readSession: mode => mode === "direct_media" ? session : null });
  await f.refreshActual({ mode: "direct_media" });
  await f.refreshActual({ silent: true, poll: true });
  assert.deepEqual(f.requested, ["direct_media", "direct_media"]);
  assert.equal(f.coWatchSessionRef.current?.id, session.id);
  assert.equal(f.danmaku.length, 1); assert.equal(f.danmakuClears, 0, "same-session polling must preserve its comments");
});

test("actual App video selection rejects a slower read for the earlier mode", async () => {
  const old = deferred(), newer = deferred();
  const f = actualAppRefresh({ readSession: mode => mode === "screen" ? old.promise : newer.promise });
  const first = f.refreshActual({ mode: "screen" });
  const second = f.refreshActual({ mode: "web_page" });
  newer.resolve(null); await second;
  const beforeLate = f.applied.length;
  old.resolve({ id: "fictional-old-screen", status: "active", sessionMode: "screen" }); await first;
  assert.equal(f.applied.length, beforeLate, "an earlier mode's response cannot replace the current selection");
  assert.equal(f.coWatchSessionRef.current, null);
});

test("actual App refresh requests listening on the music page and rejects a response after leaving it", async () => {
  const waiting = deferred();
  const f = actualAppRefresh({ readSession: () => waiting.promise });
  f.activeView = "music";
  const request = f.refreshActual({ silent: true });
  assert.equal(f.requested[0], "listening");
  f.activeView = "chat";
  waiting.resolve({ id: "fictional-listening", status: "active", sessionMode: "listening" }); await request;
  assert.equal(f.applied.length, 0, "left-page results cannot apply later");
});

test("actual App automatic polling leaves an in-flight manual dialog refresh eligible", async () => {
  const manual = deferred();
  let reads = 0;
  const f = actualAppRefresh({ readSession: () => ++reads === 1 ? manual.promise : null });
  const request = f.refreshActual({ mode: "web_page" });
  await f.refreshActual({ silent: true, poll: true });
  manual.resolve({ id: "fictional-web", status: "active", sessionMode: "web_page" }); await request;
  assert.equal(f.coWatchSessionRef.current?.id, "fictional-web");
});

test("actual App skips overlapping slow polls, accepts the first response, and resumes after it completes", async () => {
  const waiting = deferred();
  const f = actualAppRefresh({ readSession: () => waiting.promise });
  const first = f.refreshActual({ silent: true, poll: true });
  await f.refreshActual({ silent: true, poll: true });
  await f.refreshActual({ silent: true, poll: true });
  assert.equal(f.requested.length, 1, "slow network must not create a new poll every ten seconds");
  waiting.resolve({ id: "fictional-slow-screen", status: "active", sessionMode: "screen" }); await first;
  assert.equal(f.coWatchSessionRef.current?.id, "fictional-slow-screen");
  assert.equal(f.danmaku.length, 0, "a different restored session clears old comments");
  assert.equal(f.coWatchPollStampRef.current, null);
  await f.refreshActual({ silent: true, poll: true });
  assert.equal(f.requested.length, 2, "a completed poll releases its own lock");
});

test("actual App mode changes allow a new poll while manual refresh remains independent from the older poll", async () => {
  const old = deferred(), manual = deferred(), newer = deferred();
  let webReads = 0;
  const f = actualAppRefresh({ readSession: mode => mode === "screen" ? old.promise : ++webReads === 1 ? manual.promise : newer.promise });
  const oldPoll = f.refreshActual({ silent: true, poll: true });
  const manualRead = f.refreshActual({ mode: "web_page" });
  const newPoll = f.refreshActual({ silent: true, poll: true });
  const newStamp = f.coWatchPollStampRef.current;
  assert.deepEqual(f.requested, ["screen", "web_page", "web_page"]);
  old.resolve({ id: "fictional-old-screen", status: "active", sessionMode: "screen" }); await oldPoll;
  assert.equal(f.applied.length, 0);
  assert.equal(f.coWatchPollStampRef.current, newStamp, "old finally cannot unlock a newer mode's poll");
  manual.resolve(null); await manualRead;
  assert.equal(f.applied.length, 1, "an in-flight poll must not block the manual receipt");
  newer.resolve({ id: "fictional-new-web", status: "active", sessionMode: "web_page" }); await newPoll;
  assert.equal(f.coWatchSessionRef.current?.id, "fictional-new-web");
  assert.equal(f.coWatchPollStampRef.current, null);
});

test("actual App polling effect restores listening on entry and schedules scoped automatic reads", () => {
  const source = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const timer = source.indexOf("const timer = window.setInterval", source.indexOf("void refreshCoWatchExperience"));
  const start = source.lastIndexOf("  useEffect(", timer);
  const terminator = "}, [activeView, refreshCoWatchExperience]);";
  const end = source.indexOf(terminator, timer) + terminator.length;
  assert.ok(timer > 0 && start > 0 && end > timer, "load the actual App polling effect");
  const calls = [];
  let tick, cleanup, cleared = false;
  const context = {
    activeView: "music", document: { visibilityState: "visible" },
    refreshCoWatchExperience: options => { calls.push(options || {}); },
    useEffect: effect => { cleanup = effect(); },
    window: { setInterval: callback => { tick = callback; return 7; }, clearInterval: id => { cleared = id === 7; } },
  };
  vm.runInNewContext(source.slice(start, end), context);
  assert.equal(calls.length, 1, "entering music must restore the active listening session");
  assert.equal(calls[0].poll, true);
  tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].poll, true);
  context.document.visibilityState = "hidden";
  tick();
  assert.equal(calls.length, 2, "hidden pages do not poll");
  cleanup();
  assert.equal(cleared, true);
});
