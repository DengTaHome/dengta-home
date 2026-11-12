import assert from "node:assert/strict";
import test from "node:test";
import { refreshDiscovery } from "../src/discovery-feed.js";
import { startTakeoutRunner } from "../src/takeout-executor.js";
import { clearAccountRuntimeData, prepareAccountRuntimeData } from "../src/account-cleanup.js";
import { diagnosticScopeKey, readOperationFailures, recordOperationFailure } from "../src/operation-diagnostics.js";

const A = "71111111-1111-4111-8111-111111111111";
const B = "72222222-2222-4222-8222-222222222222";
const C = "73333333-3333-4333-8333-333333333333";
const scope = account => diagnosticScopeKey(account, C);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const exit = account => clearAccountRuntimeData(account, {
  localStorage: null, sessionStorage: null, sealAccountCache() {}, purgeAccountCache: async () => {},
  workspaceCacheClearLegacy: async () => {}, stopVoiceSpeech: async () => {},
});

function discover(account, response) {
  const token = { scope: scope(account) };
  return refreshDiscovery({
    token, currentToken: () => token, isMounted: () => true,
    lock: { current: null }, update() {}, request: async () => response,
  });
}

test("discovery failures from new A are recorded while delayed old A receipts stay retired", async () => {
  prepareAccountRuntimeData(A);
  const delayed = deferred();
  const old = discover(A, delayed.promise);
  await exit(A);
  prepareAccountRuntimeData(B);
  await discover(B, {});
  assert.equal(readOperationFailures(scope(B)).length, 2);
  prepareAccountRuntimeData(A);
  await discover(A, {});
  assert.equal(readOperationFailures(scope(A)).length, 2);
  delayed.resolve({});
  await old;
  assert.equal(readOperationFailures(scope(A)).length, 2, "old asynchronous receipt must not append to the new login");
  assert.equal(readOperationFailures(scope(B)).length, 2);
  assert.equal(recordOperationFailure(scope(A), "/api/v2/fun-labs/interests", new Error("late raw scope")), null, "raw scope strings remain retired after exit");
  await exit(A); await exit(B);
});

test("takeout runner captures its diagnostic authority at creation, including across same-account login", async () => {
  const saved = Object.fromEntries(["window", "setTimeout", "clearTimeout", "setInterval", "clearInterval"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const intervals = [], values = new Map(), stops = [];
  const stub = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  stub("window", { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  stub("setInterval", callback => { intervals.push(callback); return intervals.length; });
  stub("setTimeout", () => 0); stub("clearInterval", () => {}); stub("clearTimeout", () => {});
  const begin = (account, id, nativeResponse) => {
    const done = deferred(), started = deferred();
    const stop = startTakeoutRunner({
      scope: scope(account), capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true },
      plugin: { orderProduct: async () => { started.resolve(); return nativeResponse; } },
      client: async path => path.endsWith("/pending") ? { commands: [{ id, command: { action: "order", requirement: "fictional", shop_name: "fictional" } }] } : {},
      onCommandDone: () => done.resolve(),
    });
    stops.push(stop);
    intervals.at(-1)();
    return { done, started };
  };
  try {
    prepareAccountRuntimeData(A);
    const delayed = deferred();
    const old = begin(A, "old-command", delayed.promise);
    await old.started.promise;
    await exit(A);
    prepareAccountRuntimeData(B);
    await begin(B, "b-command", { status: "logged_out" }).done.promise;
    assert.equal(readOperationFailures(scope(B)).length, 1);
    prepareAccountRuntimeData(A);
    await begin(A, "new-a-command", { status: "logged_out" }).done.promise;
    assert.equal(readOperationFailures(scope(A)).length, 1);
    delayed.resolve({ status: "logged_out" });
    await old.done.promise;
    assert.equal(readOperationFailures(scope(A)).length, 1, "a stale runner cannot acquire a fresh diagnostic ticket on a later poll/completion");
    assert.equal(readOperationFailures(scope(B)).length, 1);
  } finally {
    stops.forEach(stop => stop());
    for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    await exit(A); await exit(B);
  }
});
