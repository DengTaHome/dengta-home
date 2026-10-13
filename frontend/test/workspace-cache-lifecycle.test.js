import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { cachedWorkspaceEntries, workspaceCacheRead, workspaceCacheList, workspaceCacheWrite, workspaceCacheClear } from "../src/workspace-cache.js";

const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function factory() { Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() }); }
function open(version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dengta-workspace-cache", version);
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
  });
}
afterEach(() => { if (original) Object.defineProperty(globalThis, "indexedDB", original); else delete globalThis.indexedDB; });

test("a blocked v1 upgrade reports failure while preserving unowned legacy data", async () => {
  factory(); const held = await open(1, db => db.createObjectStore("files", { keyPath: "path" }));
  await new Promise(resolve => { const tx = held.transaction("files", "readwrite"); tx.objectStore("files").put({ path: "legacy.txt", content: "unowned fictional content" }); tx.oncomplete = resolve; });
  await assert.rejects(workspaceCacheList("fixture-a"), { code: "workspace_cache_failed" });
  held.close(); await tick(); const db = await open(2);
  const legacy = await new Promise(resolve => { const request = db.transaction("files").objectStore("files").get("legacy.txt"); request.onsuccess = () => resolve(request.result); });
  assert.equal(legacy.content, "unowned fictional content"); db.close(); assert.deepEqual(await workspaceCacheList("fixture-a"), []);
});
test("a malformed version-two database rejects with a stable code without adding or deleting stores", async () => {
  factory(); const db = await open(2, value => value.createObjectStore("files", { keyPath: "path" })); db.close();
  await assert.rejects(workspaceCacheList("fixture-a"), { code: "workspace_cache_failed" });
  const check = await open(2); assert.deepEqual([...check.objectStoreNames], ["files"]); check.close();
});
test("a newer cache schema returns a stable failure instead of attempting a downgrade", async () => {
  factory(); const db = await open(3, value => value.createObjectStore("future", { keyPath: "path" })); db.close();
  await assert.rejects(workspaceCacheRead("fixture-a", "note.txt"), { code: "workspace_cache_failed" });
  const check = await open(3); assert.deepEqual([...check.objectStoreNames], ["future"]); check.close();
});
test("an unavailable or synchronously denied IndexedDB rejects with a stable safe code", async () => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  await assert.rejects(workspaceCacheList("fixture-a"), { code: "workspace_cache_failed" });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() { throw new Error("fictional private diagnostic"); } } });
  await assert.rejects(workspaceCacheList("fixture-a"), error => error.code === "workspace_cache_failed" && !error.message.includes("fictional private diagnostic"));
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, get() { throw new Error("fictional getter denied"); } });
  await assert.rejects(workspaceCacheList("fixture-a"), { code: "workspace_cache_failed" });
});
test("successful cache writes and clears preserve other account and exact empty content", async () => {
  factory(); await workspaceCacheWrite("fixture-a", "note.txt", "  原文\r\n🌱  "); await workspaceCacheWrite("fixture-b", "note.txt", "");
  assert.equal((await workspaceCacheRead("fixture-a", "note.txt")).content, "  原文\r\n🌱  "); await workspaceCacheClear("fixture-a");
  assert.deepEqual(await workspaceCacheList("fixture-a"), []); assert.equal((await workspaceCacheRead("fixture-b", "note.txt")).content, "");
});
test("corrupt content remains untouched but cannot masquerade as a readable cached text file", async () => {
  factory(); await workspaceCacheWrite("fixture-a", "note.txt", "valid"); const db = await open(2);
  await new Promise(resolve => { const tx = db.transaction("account-files", "readwrite"); tx.objectStore("account-files").put({ account: "fixture-a", path: "note.txt", content: { invalid: true } }); tx.oncomplete = resolve; }); db.close();
  await assert.rejects(workspaceCacheRead("fixture-a", "note.txt"), { code: "workspace_cache_failed" }); await assert.rejects(workspaceCacheList("fixture-a"), { code: "workspace_cache_failed" });
  const check = await open(2); const row = await new Promise(resolve => { const request = check.transaction("account-files").objectStore("account-files").get(["fixture-a", "note.txt"]); request.onsuccess = () => resolve(request.result); }); check.close();
  assert.deepEqual(row.content, { invalid: true });
});
test("cache tree helper handles malformed external rows without inventing files", () => {
  assert.deepEqual(cachedWorkspaceEntries(null), []); assert.deepEqual(cachedWorkspaceEntries([null, { path: 42 }, { path: "broken.txt", content: {} }]), []);
  assert.deepEqual(cachedWorkspaceEntries([{ path: "docs/empty.txt", content: "" }], "docs").map(row => [row.name, row.size]), [["empty.txt", 0]]);
});
test("cache open deadline rejects a stalled request and closes its later successful connection", async () => {
  const previousSet = globalThis.setTimeout, previousClear = globalThis.clearTimeout; let deadline, closed = 0; const request = {};
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open: () => request } });
  globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 5000); deadline = callback; return { unref() {} }; }; globalThis.clearTimeout = () => {};
  try {
    const pending = workspaceCacheList("fixture-a"); deadline(); await assert.rejects(pending, { code: "workspace_cache_failed" });
    request.result = { close() { closed++; } }; request.onsuccess(); assert.equal(closed, 1);
  } finally { globalThis.setTimeout = previousSet; globalThis.clearTimeout = previousClear; }
});
test("cache transaction deadline aborts and closes a stalled transaction instead of reporting zero files", async () => {
  const previousSet = globalThis.setTimeout, previousClear = globalThis.clearTimeout; const deadlines = []; let closed = 0, aborted = 0;
  const tx = { objectStore: () => ({ index: () => ({ getAll: () => ({}) }) }), abort() { aborted++; this.onabort?.(); } };
  const db = { transaction: () => tx, close() { closed++; } }; const request = { result: db };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() { queueMicrotask(() => request.onsuccess()); return request; } } });
  globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 5000); deadlines.push(callback); return { unref() {} }; }; globalThis.clearTimeout = () => {};
  try {
    const pending = workspaceCacheList("fixture-a"); for (let index = 0; index < 5; index++) await Promise.resolve();
    assert.equal(deadlines.length, 2); deadlines[1](); await assert.rejects(pending, { code: "workspace_cache_failed" }); assert.equal(aborted, 1); assert.equal(closed, 1);
  } finally { globalThis.setTimeout = previousSet; globalThis.clearTimeout = previousClear; }
});
