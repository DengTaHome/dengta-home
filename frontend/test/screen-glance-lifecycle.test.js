import assert from "node:assert/strict";
import { createScreenGlanceLifecycle } from "../src/screen-glance-lifecycle.js";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const session = (mode = "screen", id = "intent") => ({ id, status: "active", sessionMode: mode });
function setup(overrides = {}) {
  const state = { identity: { accountScope: "a", companionScope: "one" }, active: null, busy: false, calls: [], config: {}, native: {} };
  const plugin = {
    getState: async () => state.native,
    startSession: async () => ({ starting: true }),
    configure: async config => { state.calls.push(["configure", config]); return config; },
    stopSession: async () => { state.calls.push(["nativeStop"]); },
    ...overrides.plugin,
  };
  const life = createScreenGlanceLifecycle({
    getIdentity: () => state.identity, getSession: () => state.active, getConfig: () => state.config, isBusy: () => state.busy,
    plugin, preparePermission: async () => ({ status: "success" }),
    createSession: async (input, options) => { state.calls.push(["create", input, options]); return session("screen", input.sessionId); },
    endSession: async (id, input, options) => { state.calls.push(["end", id, options]); return { id, status: "ended" }; },
    onBusy: value => { state.busy = value; }, onState: value => { state.native = value; state.config = value; },
    onStarted: value => { state.active = value; }, onEnded: () => { state.active = null; },
    onStopped: () => { state.calls.push(["cleanCapture"]); }, idFactory: () => "intent",
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "plugin")),
  });
  return { state, life };
}
// Consent cancellation never mutates an existing session, even ordinary sharing during music.
for (const [mode, watchTogether] of [["screen", true], ["listening", false], ["direct_media", false], ["web_page", false]]) {
  const { state, life } = setup({ plugin: { startSession: async () => ({ consentDenied: true }) } });
  state.active = session(mode, "existing");
  const result = await life.start({ watchTogether });
  assert.equal(result.cancelled, true); assert.equal(state.active.id, "existing");
  assert.deepEqual(state.calls, []); assert.equal(state.busy, false);
}
// Screen Together refuses other active modes before asking Android or writing to the server.
for (const mode of ["listening", "direct_media", "web_page"]) {
  const { state, life } = setup({ plugin: { startSession: async () => { throw new Error("must not ask"); } } });
  state.active = session(mode);
  assert.equal((await life.start({ watchTogether: true })).code, "co_watch_active_conflict");
  assert.deepEqual(state.calls, []);
}
{
  const { state, life } = setup();
  state.config = { randomEnabled: true, minimumMinutes: 10, maximumMinutes: 30, watchTogetherEnabled: true, coWatchSessionId: "old" };
  assert.equal((await life.start()).ok, true);
  const configured = state.calls.find(call => call[0] === "configure")[1];
  assert.equal(configured.watchTogetherEnabled, false); assert.equal(configured.coWatchSessionId, ""); assert.equal(configured.randomEnabled, true);
  state.active = session();
  state.calls.length = 0;
  assert.equal((await life.stop()).ok, true);
  assert.deepEqual(state.calls.map(call => call[0]), ["nativeStop", "configure", "cleanCapture", "end"]);
  assert.equal(state.calls[1][1].randomEnabled, true); assert.equal(state.calls[1][1].minimumMinutes, 10);
  assert.equal(state.calls[1][1].coWatchSessionId, ""); assert.equal(state.calls[1][1].watchTogetherEnabled, false);
}
{
  const consent = deferred(); const { state, life } = setup({ plugin: { startSession: () => consent.promise } });
  const first = life.start({ watchTogether: true });
  assert.equal((await life.start({ watchTogether: true })).code, "screen_glance_operation_busy");
  assert.equal((await life.stop()).code, "screen_glance_operation_busy");
  assert.equal(state.calls.length, 0);
  consent.resolve({ starting: true });
  assert.equal((await first).ok, true);
  assert.deepEqual(state.calls.map(call => call[0]), ["create", "configure"]);
  assert.equal(state.calls[0][1].sessionId, "intent");
  assert.equal(state.calls[0][2].accountScope, "a");
  assert.equal(state.calls[1][1].coWatchSessionId, "intent");
}
{
  const consent = deferred(); const { state, life } = setup({ plugin: { startSession: () => consent.promise } });
  const old = life.start({ watchTogether: true });
  await Promise.resolve(); await Promise.resolve();
  const stamp = life.capture(); state.identity = { accountScope: "b", companionScope: "two" }; life.invalidate();
  consent.resolve({ starting: true });
  assert.equal((await old).code, "screen_glance_scope_changed");
  assert.equal(life.current(stamp), false); assert.equal(state.active, null);
  assert.deepEqual(state.calls.map(call => call[0]), ["nativeStop"]);
}
// Failed configuration retires only the session created by this attempt; rollback failure stays visible.
for (const rollbackFails of [false, true]) {
  const { state, life } = setup({ plugin: { configure: async () => { throw new Error("configure failed"); } },
    ...(rollbackFails ? { endSession: async () => { throw new Error("offline"); } } : {}) });
  const result = await life.start({ watchTogether: true });
  assert.equal(result.code, rollbackFails ? "screen_glance_rollback_failed" : "screen_glance_start_failed");
  assert.equal(state.active?.id || null, rollbackFails ? "intent" : null);
  assert.equal(state.busy, false);
}
{
  const { state, life } = setup({ plugin: { configure: async () => { throw new Error("configure failed"); } } });
  state.active = session("screen", "borrowed"); state.native = { active: true };
  assert.equal((await life.start({ watchTogether: true })).ok, false);
  assert.equal(state.active.id, "borrowed"); assert.deepEqual(state.calls, []);
}
// Ordinary screen stop cannot end music/video. End failure retains the screen session for retry.
for (const mode of ["listening", "direct_media", "web_page"]) {
  const { state, life } = setup(); state.active = session(mode, "other");
  assert.equal((await life.stop()).ok, true); assert.equal(state.active.id, "other");
  assert.equal(state.calls.some(call => call[0] === "end"), false);
}
{
  let attempts = 0;
  const { state, life } = setup({ endSession: async id => { if (!attempts++) throw new Error("offline"); return { id, status: "ended" }; } });
  state.active = session();
  assert.equal((await life.stop()).ok, false); assert.equal(state.active.id, "intent");
  assert.equal((await life.stop()).ok, true); assert.equal(state.active, null);
}
{
  const ended = deferred(); const { state, life } = setup({ endSession: () => ended.promise }); state.active = session();
  const stop = life.stop(); await Promise.resolve(); await Promise.resolve();
  state.active = session("screen", "new"); ended.resolve({ id: "intent", status: "ended" });
  assert.equal((await stop).code, "co_watch_session_changed"); assert.equal(state.active.id, "new");
}
{
  let attempts = 0; const ids = [];
  const { life } = setup({ createSession: async input => { ids.push(input.sessionId); if (!attempts++) throw new Error("response lost"); return session("screen", input.sessionId); } });
  assert.equal((await life.start({ watchTogether: true })).ok, false);
  assert.equal((await life.start({ watchTogether: true })).ok, true); assert.deepEqual(ids, ["intent", "intent"]);
}
console.log("screen consent ownership, duplicate actions, scoped receipts and recovery passed");
