import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  cachedWorkspaceEntries, workspaceCacheClear, workspaceCacheDelete,
  workspaceCacheList, workspaceCacheRead, workspaceCacheWrite,
} from "../src/workspace-cache.js";

// The unscoped legacy cache has no reliable owner; keep it but never expose it.
await new Promise((resolve, reject) => {
  const request = indexedDB.open("dengta-workspace-cache", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "path" });
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ path: "note.txt", content: "unowned fixture" });
    tx.oncomplete = () => { db.close(); resolve(); };
  };
});
assert.equal(await workspaceCacheRead("a", "note.txt"), undefined);
await workspaceCacheWrite("a", "note.txt", "fictional A");
await workspaceCacheWrite("b", "note.txt", "fictional B");
await workspaceCacheWrite("a", "docs/empty.txt", "");
assert.equal((await workspaceCacheRead("a", "note.txt")).content, "fictional A");
assert.equal((await workspaceCacheRead("b", "note.txt")).content, "fictional B");
assert.equal((await workspaceCacheRead("a", "docs/empty.txt")).content, "");
const items = await workspaceCacheList("a");
assert.equal(Array.isArray(items), true);
assert.equal(items.length, 2);
assert.equal(items.every(item => item.account === "a"), true);
assert.deepEqual(cachedWorkspaceEntries(items).map(item => [item.name, item.type]), [["docs", "dir"], ["note.txt", "file"]]);
assert.deepEqual(cachedWorkspaceEntries(items, "docs").map(item => [item.name, item.size]), [["empty.txt", 0]]);
assert.equal(cachedWorkspaceEntries([{ path: "中文.txt", content: "你好" }])[0].size, 6);
await workspaceCacheDelete("a", "note.txt");
assert.equal(await workspaceCacheRead("a", "note.txt"), undefined);
assert.equal((await workspaceCacheList("b")).length, 1);
await workspaceCacheClear("a");
assert.deepEqual(await workspaceCacheList("a"), []);
assert.equal((await workspaceCacheRead("b", "note.txt")).content, "fictional B");
await assert.rejects(workspaceCacheRead("", "note.txt"), /登录/);
await assert.rejects(workspaceCacheClear(""), /登录/);
const db = await new Promise((resolve, reject) => {
  const request = indexedDB.open("dengta-workspace-cache", 2);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const legacy = await new Promise(resolve => {
  const request = db.transaction("files").objectStore("files").get("note.txt");
  request.onsuccess = () => resolve(request.result);
});
assert.equal(legacy.content, "unowned fixture");
db.close();
console.log("Workspace cache: request results, account isolation, legacy isolation, empty files, byte counts, scoped deletion and clear passed");
