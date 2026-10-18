import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { reportWhereabouts, startWhereaboutsScheduler } from "../src/whereabouts.js";
import { accountStorageKey } from "../src/account-storage.js";
import { settingsSaveScope } from "../src/settings-save-scope.js";
import { readWhereaboutsConsent, setWhereaboutsConsent } from "../src/whereabouts-consent.js";
import { locateForSurpriseMap } from "../src/surprise-map.js";

const originals = new Map(["window", "document", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => globalThis.setImmediate(resolve));
const key = snapshot => accountStorageKey("dengta_whereabouts_last_report", settingsSaveScope(snapshot));
let state, session, capacitor, storage, values, listeners, calls, timers, doc, now;
beforeEach(() => {
  now = 1_800_000_000_000; values = new Map(); listeners = new Set(); calls = []; timers = new Map();
  state = { snapshot: { user: { id: "fictional-account-a" }, activeCompanionId: "fictional-companion-a" },
    permissions: 0, captures: 0, requests: 0, prompts: 0, granted: true,
    permissionWait: null, locationWait: null, authWait: null, responseWait: null,
    point: { latitude: 0, longitude: 0, accuracy: 6.25, batteryLevel: 0, timestamp: "2026-10-16T00:00:00Z" } };
  storage = { getItem: name => values.get(name) || null, setItem: (name, value) => values.set(name, value) };
  session = {
    getSnapshot: () => state.snapshot,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    async getRequestContext() { if (state.authWait) await state.authWait.promise; return { companionId: state.snapshot.activeCompanionId }; },
  };
  capacitor = { isPluginAvailable: name => name === "Whereabouts", Plugins: { Whereabouts: {
    async checkPermissions() { state.permissions++; if (state.permissionWait) await state.permissionWait.promise; return { granted: state.granted }; },
    async requestPermissions() { state.prompts++; return { granted: true }; },
    async getLocation() { state.captures++; if (state.locationWait) return state.locationWait.promise; return state.point; },
  } } };
  doc = { visibilityState: "visible", listeners: new Set(),
    addEventListener(type, listener) { assert.equal(type, "visibilitychange"); this.listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, "visibilitychange"); this.listeners.delete(listener); } };
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { setInterval(callback) { const id = timers.size + 1; timers.set(id, callback); return id; }, clearInterval: id => timers.delete(id) } },
    document: { configurable: true, value: doc }, localStorage: { configurable: true, value: storage },
  });
});
afterEach(() => { assert.equal(listeners.size, 0, "completed location operations must release account subscriptions"); });
after(() => { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
const switchScope = snapshot => { state.snapshot = snapshot; [...listeners].forEach(callback => callback()); };
async function apiRequest(path, options) {
  state.requests++;
  const context = await options.authSession.getRequestContext();
  calls.push({ path, options, context, body: JSON.parse(options.body) });
  if (state.responseWait) return state.responseWait.promise;
  return { ok: true, id: calls.length };
}
const report = changes => reportWhereabouts({ apiRequest, capacitor, authSession: session, storage, now: () => now, ...changes });

test("valid zero coordinates, zero battery and reported accuracy reach only the captured account and companion", async () => {
  const expectedScope = structuredClone(state.snapshot);
  assert.equal((await report()).ok, true);
  assert.equal(calls.length, 1); assert.equal(calls[0].path, "/api/v2/whereabouts/ingest");
  assert.equal(calls[0].body.latitude, 0); assert.equal(calls[0].body.longitude, 0);
  assert.equal(calls[0].body.accuracy, 6.25); assert.equal(calls[0].body.batteryLevel, 0);
  assert.deepEqual(calls[0].options.authSession.getSnapshot(), expectedScope);
  assert.equal(calls[0].context.companionId, expectedScope.activeCompanionId);
  assert.equal(values.get(key(expectedScope)), String(now));
  assert.equal(state.prompts, 0, "background reporting only queries an existing OS grant");
});

test("legacy global throttling never blocks a different account or companion", async () => {
  values.set("dengta_whereabouts_last_report", String(now));
  const accountA = structuredClone(state.snapshot);
  await report(); await report(); assert.equal(calls.length, 1);
  switchScope({ user: { id: "fictional-account-b" }, activeCompanionId: "fictional-companion-b" });
  const accountB = structuredClone(state.snapshot);
  await report(); assert.equal(calls.length, 2);
  switchScope({ user: accountB.user, activeCompanionId: "fictional-companion-c" });
  await report(); assert.equal(calls.length, 3);
  assert.equal(values.get(key(accountA)), String(now)); assert.equal(values.get(key(accountB)), String(now));
  switchScope(accountA); await report(); assert.equal(calls.length, 3);
});

test("scope changes while native permission lookup is pending prevent location capture", async () => {
  const wait = deferred(); state.permissionWait = wait;
  const pending = report(); await flush();
  switchScope({ user: { id: "fictional-account-b" }, activeCompanionId: "fictional-companion-b" });
  wait.resolve(); assert.equal(await pending, null);
  assert.equal(state.captures, 0); assert.equal(state.requests, 0); assert.equal(values.size, 0);
});

test("a location captured for the prior account cannot be delivered with replacement credentials", async () => {
  const wait = deferred(); state.locationWait = wait;
  const pending = report(); await flush(); assert.equal(state.captures, 1);
  switchScope({ user: { id: "fictional-account-b" }, activeCompanionId: "fictional-companion-b" });
  wait.resolve(state.point); assert.equal(await pending, null);
  assert.equal(state.requests, 0); assert.equal(calls.length, 0); assert.equal(values.size, 0);
});

test("switching away and back does not revive a previously cancelled location capture", async () => {
  const original = structuredClone(state.snapshot), wait = deferred(); state.locationWait = wait;
  const pending = report(); await flush();
  switchScope({ user: { id: "fictional-account-b" }, activeCompanionId: "fictional-companion-b" });
  switchScope(original); wait.resolve(state.point);
  assert.equal(await pending, null); assert.equal(calls.length, 0); assert.equal(values.size, 0);
});

test("switching companion while authentication resolves aborts the request before network delivery", async () => {
  const wait = deferred(); state.authWait = wait;
  const pending = report(); await flush(); assert.equal(state.requests, 1);
  switchScope({ user: state.snapshot.user, activeCompanionId: "fictional-companion-new" });
  wait.resolve(); assert.equal(await pending, null); assert.equal(calls.length, 0); assert.equal(values.size, 0);
});

test("late server receipts after logout cannot update any account's throttle record", async () => {
  const wait = deferred(); state.responseWait = wait;
  const pending = report(); await flush(); assert.equal(calls.length, 1);
  const oldSession = calls[0].options.authSession;
  switchScope({ user: null, activeCompanionId: "" });
  assert.equal(calls[0].options.signal.aborted, true);
  wait.resolve({ ok: true, id: 99 }); assert.equal(await pending, null);
  assert.equal(values.size, 0); assert.equal(oldSession.getSnapshot().user.id, "fictional-account-a");
});

test("concurrent reports for the same scope share one native capture and request", async () => {
  const wait = deferred(); state.locationWait = wait;
  const first = report(), second = report({ force: true }); await flush();
  assert.equal(state.permissions, 1); assert.equal(state.captures, 1);
  wait.resolve(state.point);
  assert.deepEqual(await first, await second); assert.equal(calls.length, 1);
});

test("failed requests do not start a success throttle and an explicit retry can complete", async () => {
  assert.equal(await report({ apiRequest: async () => { throw Error("fictional offline fixture"); } }), null);
  assert.equal(values.size, 0);
  assert.equal((await report()).ok, true); assert.equal(state.captures, 2);
});

test("an old, expired or future throttle record does not suppress fresh reporting", async () => {
  for (const value of ["not-a-time", String(now + 60000), String(now - 20 * 60000), "-1"]) {
    values.set(key(state.snapshot), value); await report();
  }
  assert.equal(calls.length, 4);
});

test("blocked optional storage leaves authorized reporting usable", async () => {
  const blocked = { getItem() { throw Error("fictional blocked read"); }, setItem() { throw Error("fictional blocked write"); } };
  assert.equal((await report({ storage: blocked })).ok, true); assert.equal(calls.length, 1);
});

for (const point of [null, {}, { latitude: null, longitude: 0 }, { latitude: "", longitude: 0 },
  { latitude: true, longitude: 1 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: 1, longitude: NaN }]) {
  test(`invalid coordinate fixture ${JSON.stringify(point)} is not converted into a valid location`, async () => {
    state.point = point; assert.equal(await report(), null); assert.equal(calls.length, 0); assert.equal(values.size, 0);
  });
}

test("unknown accuracy and battery stay absent instead of being invented as zero", async () => {
  state.point = { latitude: "0", longitude: "120.123456", accuracy: null, batteryLevel: undefined };
  await report(); assert.equal(calls[0].body.latitude, 0); assert.equal(calls[0].body.longitude, 120.123456);
  assert.equal(Object.hasOwn(calls[0].body, "accuracy"), false); assert.equal(Object.hasOwn(calls[0].body, "batteryLevel"), false);
});

test("anonymous, unselected-companion and pre-aborted reports do not query permissions", async () => {
  switchScope({ user: null, activeCompanionId: "" }); assert.equal(await report(), null);
  switchScope({ user: { id: "fictional-account" }, activeCompanionId: "" }); assert.equal(await report(), null);
  switchScope({ user: { id: "fictional-account" }, activeCompanionId: "fictional-companion" });
  const controller = new AbortController(); controller.abort(); assert.equal(await report({ signal: controller.signal }), null);
  assert.equal(state.permissions, 0);
});

test("a denied grant cannot prompt or capture and can later recover after a user grants access", async () => {
  state.granted = false; assert.equal(await report(), null); assert.equal(state.captures, 0); assert.equal(state.prompts, 0);
  state.granted = true; assert.equal((await report()).ok, true);
});

test("scheduler gates foreground and timer reports and releases both timer and listener", async () => {
  let active = false;
  setWhereaboutsConsent(settingsSaveScope(state.snapshot), true, storage);
  const stop = startWhereaboutsScheduler({ apiRequest, capacitor, authSession: session, storage, now: () => now, getActive: () => active });
  for (const callback of timers.values()) callback(); for (const callback of doc.listeners) callback(); await flush();
  assert.equal(state.permissions, 0);
  active = true; doc.visibilityState = "hidden";
  for (const callback of timers.values()) callback(); for (const callback of doc.listeners) callback(); await flush(); assert.equal(state.permissions, 0);
  doc.visibilityState = "visible";
  for (const callback of doc.listeners) callback(); await flush(); assert.equal(calls.length, 1);
  stop(); stop(); assert.equal(timers.size, 0); assert.equal(doc.listeners.size, 0);
});

test("scheduler unmount aborts a pending native result before it can be uploaded", async () => {
  const wait = deferred(); state.locationWait = wait;
  setWhereaboutsConsent(settingsSaveScope(state.snapshot), true, storage);
  const stop = startWhereaboutsScheduler({ apiRequest, capacitor, authSession: session, storage, now: () => now });
  for (const callback of doc.listeners) callback(); await flush(); assert.equal(state.captures, 1);
  stop(); wait.resolve(state.point); await flush();
  assert.equal(calls.length, 0); assert.equal(values.get(key(state.snapshot)), undefined); assert.equal(timers.size, 0); assert.equal(doc.listeners.size, 0);
});

test("one-time treasure-map permission does not enable periodic collection", async () => {
  state.granted = false; state.point.timestamp = now;
  capacitor.Plugins.Whereabouts.requestPermissions = async () => { state.prompts++; state.granted = true; return { granted: true }; };
  const stop = startWhereaboutsScheduler({ apiRequest, capacitor, authSession: session, storage, now: () => now });
  try {
    await locateForSurpriseMap({ capacitor, now: () => now });
    assert.equal(state.granted, true); assert.equal(state.captures, 1);
    for (const callback of doc.listeners) callback(); await flush();
    assert.equal(timers.size, 0); assert.equal(state.permissions, 0); assert.equal(calls.length, 0);
    assert.equal(readWhereaboutsConsent(settingsSaveScope(state.snapshot), storage), false);
  } finally { stop(); }
});

test("explicit consent is isolated by account and companion and controls the timer", async () => {
  const original = structuredClone(state.snapshot), scope = settingsSaveScope(original);
  const stop = startWhereaboutsScheduler({ apiRequest, capacitor, authSession: session, storage, now: () => now });
  try {
    assert.equal(timers.size, 0); setWhereaboutsConsent(scope, true, storage); assert.equal(timers.size, 1);
    switchScope({ user: original.user, activeCompanionId: "fictional-companion-other" });
    assert.equal(timers.size, 0); for (const callback of doc.listeners) callback(); await flush(); assert.equal(calls.length, 0);
    switchScope({ user: { id: "fictional-account-other" }, activeCompanionId: original.activeCompanionId });
    assert.equal(timers.size, 0);
    switchScope(original); assert.equal(timers.size, 1);
    setWhereaboutsConsent(scope, false, storage); assert.equal(timers.size, 0);
  } finally { stop(); }
});

test("revocation while a native position is pending drops the result and removes the timer", async () => {
  const scope = settingsSaveScope(state.snapshot), wait = deferred(); state.locationWait = wait;
  setWhereaboutsConsent(scope, true, storage);
  const stop = startWhereaboutsScheduler({ apiRequest, capacitor, authSession: session, storage, now: () => now });
  try {
    for (const callback of doc.listeners) callback(); await flush(); assert.equal(state.captures, 1);
    setWhereaboutsConsent(scope, false, storage); assert.equal(timers.size, 0);
    wait.resolve(state.point); await flush(); assert.equal(calls.length, 0);
    assert.equal(values.get(key(state.snapshot)), undefined);
    for (const callback of doc.listeners) callback(); await flush(); assert.equal(state.captures, 1);
  } finally { stop(); }
});

test("revocation aborts an in-flight upload and ignores a late server receipt", async () => {
  const scope = settingsSaveScope(state.snapshot), wait = deferred(); state.responseWait = wait;
  setWhereaboutsConsent(scope, true, storage);
  const stop = startWhereaboutsScheduler({ apiRequest, capacitor, authSession: session, storage, now: () => now });
  try {
    for (const callback of doc.listeners) callback(); await flush(); assert.equal(calls.length, 1);
    setWhereaboutsConsent(scope, false, storage); assert.equal(calls[0].options.signal.aborted, true);
    wait.resolve({ ok: true }); await flush(); assert.equal(values.get(key(state.snapshot)), undefined);
  } finally { stop(); }
});

test("unavailable consent storage cannot enable automatic recording, including failed revocation writes", async () => {
  const scope = settingsSaveScope(state.snapshot), blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  let stop = startWhereaboutsScheduler({ apiRequest, capacitor, authSession: session, storage: blocked, now: () => now });
  assert.throws(() => setWhereaboutsConsent(scope, true, blocked), error => error.code === "whereabouts_consent_unavailable");
  for (const callback of doc.listeners) callback(); await flush(); assert.equal(state.permissions, 0); assert.equal(timers.size, 0); stop();
  setWhereaboutsConsent(scope, true, storage);
  stop = startWhereaboutsScheduler({ apiRequest, capacitor, authSession: session, storage, now: () => now });
  try {
    assert.equal(timers.size, 1); storage.setItem = () => { throw Error("blocked write"); };
    assert.throws(() => setWhereaboutsConsent(scope, false, storage), error => error.code === "whereabouts_consent_unavailable");
    assert.equal(readWhereaboutsConsent(scope, storage), false); assert.equal(timers.size, 0);
    for (const callback of doc.listeners) callback(); await flush(); assert.equal(calls.length, 0);
  } finally { stop(); }
});

test("force remains available for an explicit manual report without enabling the scheduler", async () => {
  assert.equal(readWhereaboutsConsent(settingsSaveScope(state.snapshot), storage), false);
  assert.equal((await report({ force: true })).ok, true); assert.equal(calls.length, 1);
  const stop = startWhereaboutsScheduler({ apiRequest, capacitor, authSession: session, storage, now: () => now });
  try { for (const callback of doc.listeners) callback(); await flush(); assert.equal(calls.length, 1); assert.equal(timers.size, 0); }
  finally { stop(); }
});
