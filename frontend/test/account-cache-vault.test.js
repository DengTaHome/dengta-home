import assert from "node:assert/strict";
import test from "node:test";
import { createAccountCacheVault } from "../src/account-cache-vault.js";
import { createNativeWorkspaceCache } from "../src/workspace-cache.js";
import { createChatDrafts } from "../src/chat-draft.js";
import { readChatHistoryCache, writeChatHistoryCache } from "../src/chat-history-cache.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const companion = "33333333-3333-4333-8333-333333333333";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(overrides = {}, options = {}) {
  const files = new Map(), calls = [];
  const plugin = {
    async read({ accountId }) { calls.push(["read", accountId]); return { value: files.get(accountId) ?? null }; },
    async write({ accountId, value }) { calls.push(["write", accountId]); files.set(accountId, value); },
    async clear({ accountId }) { calls.push(["clear", accountId]); files.delete(accountId); },
    ...overrides,
  };
  return { vault: createAccountCacheVault({ isNative: true, plugin, ...options }), files, calls, plugin };
}

test("native cache requires a prepared UUID owner and never returns plaintext fallback", async () => {
  const { vault, calls } = fixture();
  const plaintext = { getItem: () => "FICTIONAL_UNSAFE", setItem() { throw new Error("must not write plaintext"); } };
  assert.throws(() => vault.accountCacheStorage(A, plaintext), { code: "account_cache_not_prepared" });
  assert.throws(() => vault.accountCacheStorage("", plaintext), { code: "account_cache_scope_required" });
  await assert.rejects(vault.prepareAccountCache("not-a-uuid"), { code: "account_cache_scope_required" });
  const storage = await vault.prepareAccountCache(A);
  assert.equal(vault.accountCacheStorage(A, plaintext), storage);
  assert.equal(vault.resolveAccountCacheStorage(storage, A), storage);
  assert.throws(() => vault.resolveAccountCacheStorage(storage, B), { code: "account_cache_scope_changed" });
  assert.throws(() => vault.resolveAccountCacheStorage(plaintext), { code: "account_cache_scope_required" });
  assert.equal(storage.getItem("anything"), null);
  assert.deepEqual(calls, [["read", A]]);
});

test("Web/Android preserve injected storage without native plugin calls", async () => {
  const plugin = new Proxy({}, { get() { throw new Error("native must remain unused"); } });
  const vault = createAccountCacheVault({ isNative: false, plugin });
  const storage = { getItem() {}, setItem() {}, removeItem() {} };
  assert.equal(vault.accountCacheStorage("", storage), storage);
  assert.equal(vault.resolveAccountCacheStorage(storage, A), storage);
  await vault.flushAccountCache(A); await vault.purgeAccountCache(A);
});

test("identical keys persist in distinct owner files and reload without crossing accounts", async () => {
  const { vault, plugin, files } = fixture();
  const a = await vault.prepareAccountCache(A), b = await vault.prepareAccountCache(B);
  a.setItem("draft", "fictional A"); b.setItem("draft", "fictional B");
  await Promise.all([vault.flushAccountCache(A), vault.flushAccountCache(B)]);
  assert.equal(a.length, 1); assert.equal(a.key(0), "draft"); assert.equal(a.key(1), null);
  const reloaded = createAccountCacheVault({ isNative: true, plugin });
  assert.equal((await reloaded.prepareAccountCache(A)).getItem("draft"), "fictional A");
  assert.equal((await reloaded.prepareAccountCache(B)).getItem("draft"), "fictional B");
  assert.equal(JSON.parse(files.get(A)).accountId, A);
  assert.equal(JSON.parse(files.get(B)).accountId, B);
  assert.ok(!files.get(A).includes("fictional B"));
});

test("read failure or malformed ownership receipt fails closed and preserves disk content", async () => {
  for (const value of ["not JSON", JSON.stringify({ version: 1, accountId: B, entries: { secret: "fictional B" } }), JSON.stringify({ version: 1, accountId: A, entries: { bad: {} } })]) {
    const { vault, files } = fixture(); files.set(A, value);
    await assert.rejects(vault.prepareAccountCache(A), { code: "account_cache_receipt_invalid" });
    assert.equal(files.get(A), value);
    assert.throws(() => vault.accountCacheStorage(A), { code: "account_cache_not_prepared" });
  }
  const { vault } = fixture({ read: async () => { throw new Error("fixture transport unavailable"); } });
  await assert.rejects(vault.prepareAccountCache(A), { code: "account_cache_unavailable" });
});

test("logout during asynchronous hydration cannot publish a usable old facade", async () => {
  const gate = deferred();
  const { vault } = fixture({ read: async () => gate.promise });
  const preparing = vault.prepareAccountCache(A);
  vault.sealAccountCache(A);
  gate.resolve({ value: null });
  await assert.rejects(preparing, { code: "account_cache_scope_changed" });
  assert.throws(() => vault.accountCacheStorage(A), { code: "account_cache_not_prepared" });
});

test("seal blocks synchronous readers and late draft/history flushes before erase", async () => {
  const { vault, files } = fixture();
  const a = await vault.prepareAccountCache(A), b = await vault.prepareAccountCache(B);
  const drafts = createChatDrafts(A, companion, a);
  const draft = drafts.get("same-session");
  const unsubscribe = draft.subscribe(() => {});
  draft.set("fictional unsent A");
  vault.sealAccountCache(A);
  unsubscribe(); // useChatDraft cleanup flushes on unmount; the old facade must reject.
  assert.throws(() => a.getItem("draft"), { code: "account_cache_scope_changed" });
  assert.throws(() => a.setItem("draft", "late"), { code: "account_cache_scope_changed" });
  assert.equal(writeChatHistoryCache({ accountScope: A, companionScope: companion, sessionId: "same-session", messages: [{ id: 1, role: "user", content: "late fictional A" }], storage: a }), false);
  assert.equal(readChatHistoryCache({ accountScope: A, companionScope: companion, storage: a }), null);
  b.setItem("draft", "fictional B");
  await vault.flushAccountCache(B); await vault.purgeAccountCache(A);
  assert.equal(files.has(A), false); assert.equal(b.getItem("draft"), "fictional B");
});

test("erase waits for started native writes and cancels queued snapshots before clear", async () => {
  const gate = deferred(), started = deferred(), events = [], files = new Map();
  const { vault } = fixture({
    async write({ accountId, value }) { events.push("write-start"); started.resolve(); await gate.promise; files.set(accountId, value); events.push("write-end"); },
    async clear({ accountId }) { events.push("clear"); files.delete(accountId); },
  });
  const storage = await vault.prepareAccountCache(A);
  storage.setItem("draft", "first"); await started.promise;
  storage.setItem("draft", "queued and must not be written");
  const erasing = vault.purgeAccountCache(A);
  assert.deepEqual(events, ["write-start"]);
  gate.resolve(); await erasing;
  assert.deepEqual(events, ["write-start", "write-end", "clear"]);
  assert.equal(files.has(A), false);
});

test("relogin preparation waits for the previous erase and creates a fresh facade", async () => {
  const gate = deferred(), started = deferred();
  const f = fixture({ async clear({ accountId }) { started.resolve(); await gate.promise; f.files.delete(accountId); } });
  const old = await f.vault.prepareAccountCache(A);
  old.setItem("old", "private fictional old"); await f.vault.flushAccountCache(A);
  const erase = f.vault.purgeAccountCache(A); await started.promise;
  let loaded = false;
  const reloading = f.vault.prepareAccountCache(A).then(value => { loaded = true; return value; });
  await Promise.resolve(); assert.equal(loaded, false);
  gate.resolve(); await erase;
  const current = await reloading;
  assert.notEqual(current, old); assert.equal(current.getItem("old"), null);
  assert.throws(() => old.getItem("old"), { code: "account_cache_scope_changed" });
});

test("UTF-8 quota rejects a write atomically and durability errors remain observable", async () => {
  const f = fixture({}, { maxBytes: 180 });
  const storage = await f.vault.prepareAccountCache(A);
  storage.setItem("keep", "fictional");
  assert.throws(() => storage.setItem("oversize", "🌊".repeat(100)), { code: "account_cache_quota_exceeded" });
  assert.equal(storage.getItem("oversize"), null); assert.equal(storage.getItem("keep"), "fictional");
  await f.vault.flushAccountCache(A);
  const broken = fixture({ write: async () => { throw new Error("fixture protected file locked"); } });
  (await broken.vault.prepareAccountCache(A)).setItem("draft", "fictional");
  await assert.rejects(broken.vault.flushAccountCache(A), { code: "account_cache_write_failed" });
});

test("native workspace uses encrypted owner facades; deletion cannot affect another account", async () => {
  const { vault, files } = fixture();
  await vault.prepareAccountCache(A); await vault.prepareAccountCache(B);
  const cache = createNativeWorkspaceCache({ storageForAccount: id => vault.accountCacheStorage(id), flush: id => vault.flushAccountCache(id) });
  await cache.write(A, "same.txt", "fictional A"); await cache.write(B, "same.txt", "fictional B");
  assert.equal((await cache.read(A, "same.txt")).content, "fictional A");
  assert.equal((await cache.read(B, "same.txt")).content, "fictional B");
  await cache.write(A, "empty.txt", ""); assert.equal((await cache.list(A)).length, 2);
  await cache.clear(A); assert.deepEqual(await cache.list(A), []);
  assert.equal((await cache.read(B, "same.txt")).content, "fictional B");
  vault.sealAccountCache(A);
  await assert.rejects(cache.write(A, "late.txt", "must not persist"), { code: "workspace_cache_failed" });
  assert.ok(!files.get(B).includes("must not persist"));
});
