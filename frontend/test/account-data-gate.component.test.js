import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let vite, AccountDataGate, AuthGate;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ AccountDataGate, default: AuthGate } = await vite.ssrLoadModule("/src/AuthGate.jsx"));
});
after(async () => { await vite?.close(); });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const manager = (id, barrier = Promise.resolve()) => ({
  getSnapshot: () => ({ status: "authenticated", user: { id } }),
  waitForAccountData: () => barrier,
});
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");

test("business children stay unmounted until exit barrier and protected cache both finish", async () => {
  const exit = deferred(), cache = deferred(), events = [];
  let renderer;
  const props = { accountId: "A", sessionManager: manager("A", exit.promise), prepareCache: async () => { events.push("cache"); await cache.promise; }, prepareRuntime: () => events.push("runtime") };
  await act(async () => { renderer = TestRenderer.create(React.createElement(AccountDataGate, props, () => { events.push("business"); return React.createElement("p", null, "private chat"); })); });
  assert.deepEqual(events, []);
  assert.doesNotMatch(text(renderer.toJSON()), /private chat/);
  await act(async () => { exit.resolve(); await exit.promise; });
  assert.deepEqual(events, ["cache"]);
  assert.doesNotMatch(text(renderer.toJSON()), /private chat/);
  await act(async () => { cache.resolve(); await cache.promise; });
  assert.deepEqual(events, ["cache", "runtime", "business"]);
  await act(async () => renderer.unmount());
});

test("late account A hydration cannot mount A or reset B's runtime", async () => {
  const cacheA = deferred(), runtime = [], business = [];
  const prepareCache = id => id === "A" ? cacheA.promise : Promise.resolve();
  const prepareRuntime = id => runtime.push(id);
  const element = id => React.createElement(AccountDataGate, { key: id, accountId: id, sessionManager: manager(id), prepareCache, prepareRuntime }, () => { business.push(id); return React.createElement("p", null, id); });
  let renderer;
  await act(async () => { renderer = TestRenderer.create(element("A")); });
  await act(async () => renderer.update(element("B")));
  assert.deepEqual(runtime, ["B"]);
  await act(async () => { cacheA.resolve(); await cacheA.promise; });
  assert.deepEqual(runtime, ["B"]);
  assert.deepEqual(business, ["B"]);
  assert.equal(text(renderer.toJSON()), "B");
  await act(async () => renderer.unmount());
});

test("protected storage failure exposes retry and never mounts private children", async () => {
  let attempts = 0, mounts = 0, renderer;
  const prepareCache = async () => { if (++attempts === 1) throw new Error("fixture secret details must stay hidden"); };
  await act(async () => { renderer = TestRenderer.create(React.createElement(AccountDataGate, { accountId: "A", sessionManager: manager("A"), prepareCache, prepareRuntime() {} }, () => { mounts++; return React.createElement("p", null, "private chat"); })); });
  assert.equal(mounts, 0);
  assert.match(text(renderer.toJSON()), /解锁 iPhone/);
  assert.doesNotMatch(text(renderer.toJSON()), /fixture secret/);
  await act(async () => renderer.root.findByType("button").props.onClick());
  assert.equal(attempts, 2);
  assert.equal(mounts, 1);
  await act(async () => renderer.unmount());
});

test("rejected exit cleanup prevents reading the next account cache", async () => {
  let reads = 0, renderer;
  const barrier = deferred();
  await act(async () => { renderer = TestRenderer.create(React.createElement(AccountDataGate, { accountId: "B", sessionManager: manager("B", barrier.promise), prepareCache: async () => { reads++; }, prepareRuntime() {} }, React.createElement("p", null, "private chat"))); });
  await act(async () => { barrier.reject(new Error("fixture cleanup failed")); await barrier.promise.catch(() => {}); });
  assert.equal(reads, 0);
  assert.doesNotMatch(text(renderer.toJSON()), /private chat/);
  assert.match(text(renderer.toJSON()), /重试/);
  await act(async () => renderer.unmount());
});

test("legacy private data cleanup must succeed before encrypted cache hydration", async () => {
  const events = [];
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(AccountDataGate, {
    accountId: "A", sessionManager: manager("A"),
    clearLegacy: async () => { events.push("legacy"); throw new Error("fixture clear failed"); },
    prepareCache: async () => events.push("cache"),
    prepareRuntime: () => events.push("runtime"),
  }, React.createElement("p", null, "private chat"))); });
  assert.deepEqual(events, ["legacy"]);
  assert.doesNotMatch(text(renderer.toJSON()), /private chat/);
  assert.match(text(renderer.toJSON()), /重试/);
  await act(async () => renderer.unmount());
});

test("batched logout and same-account login remount business data even when the anonymous frame is skipped", async () => {
  let snapshot = { status: "authenticated", user: { id: "fixture-account" }, activeCompanionId: "" };
  let revision = 0, mounts = 0, renderer;
  const listeners = new Set();
  const sessionManager = {
    isConfigured: () => true, initialize: async () => snapshot,
    getSnapshot: () => snapshot, getAccountDataRevision: () => revision,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const publish = next => {
    if (snapshot.user?.id !== next.user?.id) revision++;
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };
  function PrivateScreen() {
    React.useEffect(() => { mounts++; }, []);
    return React.createElement("p", null, "private chat");
  }
  await act(async () => { renderer = TestRenderer.create(React.createElement(AuthGate, { sessionManager }, React.createElement(PrivateScreen))); });
  assert.equal(mounts, 1);
  await act(async () => {
    publish({ status: "anonymous", user: null, activeCompanionId: "" });
    publish({ status: "authenticated", user: { id: "fixture-account" }, activeCompanionId: "" });
  });
  assert.equal(mounts, 2, "new account activation must discard all old component state");
  await act(async () => publish({ ...snapshot, activeCompanionId: "another-companion" }));
  assert.equal(mounts, 2, "companion changes do not restart the account preparation boundary");
  await act(async () => renderer.unmount());
});
