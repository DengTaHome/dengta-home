import assert from "node:assert/strict";
import test from "node:test";
import { createIosAuthStorage, IOS_AUTH_STORAGE_KEYS } from "../src/auth-keychain-storage.js";
import { resolveAuthStorage } from "../src/auth-native-storage.js";

const KEY = IOS_AUTH_STORAGE_KEYS[0];
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture() {
  const secure = new Map(), preferences = new Map(), local = new Map(), calls = [];
  const keychain = {
    async get({ key }) { calls.push(`secure:get:${key}`); return { value: secure.get(key) ?? null }; },
    async set({ key, value }) { calls.push(`secure:set:${key}`); secure.set(key, value); },
    async remove({ key }) { calls.push(`secure:remove:${key}`); secure.delete(key); },
  };
  const legacyPreferences = {
    async get({ key }) { calls.push(`preferences:get:${key}`); return { value: preferences.get(key) ?? null }; },
    async remove({ key }) { calls.push(`preferences:remove:${key}`); preferences.delete(key); },
  };
  const legacyStorage = {
    getItem(key) { calls.push(`local:get:${key}`); return local.get(key) ?? null; },
    setItem(key, value) { calls.push(`local:set:${key}`); local.set(key, value); },
    removeItem(key) { calls.push(`local:remove:${key}`); local.delete(key); },
  };
  return { secure, preferences, local, calls, options: { keychain, legacyPreferences, legacyStorage } };
}

test("legacy native auth moves into verified Keychain before known plaintext copies are deleted", async () => {
  const f = fixture();
  for (const key of IOS_AUTH_STORAGE_KEYS) {
    f.preferences.set(key, "fictional-native-session");
    f.local.set(key, "fictional-stale-web-session");
  }
  f.preferences.set("unrelated-setting", "keep"); f.local.set("unrelated-draft", "keep");
  const storage = await createIosAuthStorage(f.options);
  for (const key of IOS_AUTH_STORAGE_KEYS) {
    assert.equal(await storage.getItem(key), "fictional-native-session");
    assert.equal(f.preferences.has(key), false); assert.equal(f.local.has(key), false);
    const writeAt = f.calls.indexOf(`secure:set:${key}`);
    const verifyAt = f.calls.indexOf(`secure:get:${key}`, writeAt);
    assert.ok(writeAt >= 0 && verifyAt > writeAt);
    assert.ok(f.calls.indexOf(`preferences:remove:${key}`) > verifyAt);
    assert.ok(f.calls.indexOf(`local:remove:${key}`) > verifyAt);
  }
  assert.equal(f.preferences.get("unrelated-setting"), "keep");
  assert.equal(f.local.get("unrelated-draft"), "keep");
});

test("localStorage legacy session migrates only when the native slot is empty", async () => {
  const f = fixture(); f.local.set(KEY, "fictional-web-session");
  const storage = await createIosAuthStorage(f.options);
  assert.equal(await storage.getItem(KEY), "fictional-web-session");
  assert.equal(f.local.has(KEY), false);
});

test("existing Keychain is authoritative and old plaintext is scrubbed without reuse", async () => {
  const f = fixture(); f.secure.set(KEY, "fictional-current-session");
  f.preferences.set(KEY, "fictional-stale-session"); f.local.set(KEY, "fictional-other-session");
  const storage = await createIosAuthStorage(f.options);
  assert.equal(await storage.getItem(KEY), "fictional-current-session");
  assert.equal(f.calls.includes(`secure:set:${KEY}`), false);
  assert.ok(f.calls.indexOf(`preferences:get:${KEY}`) > f.calls.indexOf(`preferences:remove:${KEY}`));
  assert.ok(f.calls.indexOf(`local:get:${KEY}`) > f.calls.indexOf(`local:remove:${KEY}`));
});

for (const failure of ["locked", "write", "readback"]) test(`migration ${failure} fails closed and still removes all known plaintext copies`, async () => {
  const f = fixture();
  for (const key of IOS_AUTH_STORAGE_KEYS) { f.preferences.set(key, "fictional-session"); f.local.set(key, "fictional-session"); }
  if (failure === "locked") f.options.keychain.get = async () => { throw new Error("fictional-provider-private-detail"); };
  if (failure === "write") f.options.keychain.set = async () => { throw new Error("fictional-provider-private-detail"); };
  if (failure === "readback") f.options.keychain.set = async () => {};
  await assert.rejects(createIosAuthStorage(f.options), error => {
    assert.equal(error.code, "ios_auth_storage_migration_failed");
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(error.message, /fictional-provider|fictional-session/);
    return true;
  });
  for (const key of IOS_AUTH_STORAGE_KEYS) {
    assert.equal(f.preferences.has(key), false); assert.equal(f.local.has(key), false);
  }
});

test("legacy cleanup failure blocks the adapter, and the other plaintext backend is still scrubbed", async () => {
  const f = fixture(); f.local.set(KEY, "fictional-session"); f.preferences.set(KEY, "fictional-session");
  f.options.legacyPreferences.remove = async () => { throw new Error("fictional-cleanup-failure"); };
  await assert.rejects(createIosAuthStorage(f.options), { code: "ios_auth_storage_migration_failed" });
  assert.equal(f.local.has(KEY), false);
});

test("storage calls after migration never read or write legacy values", async () => {
  const f = fixture(); const storage = await createIosAuthStorage(f.options); f.calls.length = 0;
  await storage.setItem(KEY, "fictional-new-session");
  assert.equal(await storage.getItem(KEY), "fictional-new-session");
  assert.ok(f.calls.every(call => call.startsWith("secure:")));
  assert.equal(f.local.has(KEY), false); assert.equal(f.preferences.has(KEY), false);
});

test("a locked read rejects instead of returning anonymous or reusing a plaintext session", async () => {
  const f = fixture(); const storage = await createIosAuthStorage(f.options);
  f.local.set(KEY, "fictional-stale-session");
  f.options.keychain.get = async () => { throw new Error("fictional-locked"); };
  await assert.rejects(storage.getItem(KEY), { code: "ios_auth_storage_read_failed" });
});

test("write followed by logout stays ordered and removes native plus legacy copies", async () => {
  const f = fixture(); const storage = await createIosAuthStorage(f.options);
  const gate = deferred(); const originalSet = f.options.keychain.set;
  f.options.keychain.set = async args => { await gate.promise; await originalSet(args); };
  f.calls.length = 0;
  const write = storage.setItem(KEY, "fictional-next-session");
  const remove = storage.removeItem(KEY);
  await Promise.resolve(); assert.equal(f.calls.includes(`secure:remove:${KEY}`), false);
  gate.resolve(); await Promise.all([write, remove]);
  assert.equal(await storage.getItem(KEY), null);
  assert.ok(f.calls.indexOf(`secure:remove:${KEY}`) > f.calls.indexOf(`secure:set:${KEY}`));
  assert.equal(f.local.has(KEY), false); assert.equal(f.preferences.has(KEY), false);
});

test("native logout failure still scrubs legacy credentials and never reports success", async () => {
  const f = fixture(); const storage = await createIosAuthStorage(f.options);
  f.local.set(KEY, "fictional-stale-session"); f.preferences.set(KEY, "fictional-stale-session");
  f.options.keychain.remove = async () => { throw new Error("fictional-native-failure"); };
  await assert.rejects(storage.removeItem(KEY), { code: "ios_auth_storage_remove_failed" });
  assert.equal(f.local.has(KEY), false); assert.equal(f.preferences.has(KEY), false);
});

test("retirement immediately rejects late old SDK writes/removals and waits for an in-flight native write before clearing", async () => {
  const f = fixture(); const storage = await createIosAuthStorage(f.options);
  const gate = deferred(), entered = deferred(); const originalSet = f.options.keychain.set;
  f.options.keychain.set = async args => { entered.resolve(); await gate.promise; await originalSet(args); };
  const write = storage.setItem(KEY, "fictional-old-session"); write.catch(() => {});
  await entered.promise;
  const queued = storage.setItem(KEY, "fictional-queued-session"); queued.catch(() => {});
  const clear = storage.retireAndClear();
  assert.equal(storage.retireAndClear(), clear);
  await assert.rejects(storage.setItem(KEY, "fictional-late-session"), { code: "ios_auth_storage_retired" });
  await assert.rejects(storage.removeItem(KEY), { code: "ios_auth_storage_retired" });
  await assert.rejects(storage.getItem(KEY), { code: "ios_auth_storage_retired" });
  gate.resolve();
  await assert.rejects(write, { code: "ios_auth_storage_retired" });
  await assert.rejects(queued, { code: "ios_auth_storage_retired" });
  await clear;
  assert.equal(f.secure.size, 0);
});

test("after retirement barrier, old calls or repeated old retirement cannot delete the next account session", async () => {
  const f = fixture(); const old = await createIosAuthStorage(f.options);
  await old.setItem(KEY, "fictional-account-a");
  const oldClear = old.retireAndClear(); await oldClear;
  const current = await createIosAuthStorage(f.options);
  await current.setItem(KEY, "fictional-account-b");
  await assert.rejects(old.setItem(KEY, "fictional-delayed-refresh-a"), { code: "ios_auth_storage_retired" });
  await assert.rejects(old.removeItem(KEY), { code: "ios_auth_storage_retired" });
  assert.equal(old.retireAndClear(), oldClear); await old.retireAndClear();
  assert.equal(await current.getItem(KEY), "fictional-account-b");
});

test("failed retirement stays closed, scrubs plaintext and permits explicit clear retry after unlocking", async () => {
  const f = fixture(); const storage = await createIosAuthStorage(f.options);
  await storage.setItem(KEY, "fictional-account-a");
  f.preferences.set(KEY, "fictional-stale-session"); f.local.set(KEY, "fictional-stale-session");
  const originalRemove = f.options.keychain.remove;
  f.options.keychain.remove = async () => { throw new Error("fictional-locked"); };
  await assert.rejects(storage.retireAndClear(), { code: "ios_auth_storage_clear_failed" });
  assert.equal(f.preferences.has(KEY), false); assert.equal(f.local.has(KEY), false);
  await assert.rejects(storage.setItem(KEY, "fictional-session"), { code: "ios_auth_storage_retired" });
  f.options.keychain.remove = originalRemove;
  await storage.retireAndClear();
  assert.equal(f.secure.size, 0);
});

test("unknown storage keys cannot access native secrets", async () => {
  const f = fixture(); const storage = await createIosAuthStorage(f.options); f.calls.length = 0;
  assert.throws(() => storage.getItem("other-service"), { code: "ios_auth_storage_invalid_key" });
  assert.deepEqual(f.calls, []);
});

test("iOS missing plugin never falls back to otherwise working Preferences/localStorage", async () => {
  const f = fixture(); f.local.set(KEY, "fictional-session"); f.preferences.set(KEY, "fictional-session");
  await assert.rejects(resolveAuthStorage({
    storage: f.options.legacyStorage,
    capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", isPluginAvailable: () => false },
    keychain: f.options.keychain,
    preferencesLoader: async () => f.options.legacyPreferences,
  }), { code: "ios_auth_storage_migration_failed" });
  assert.equal(f.local.has(KEY), false); assert.equal(f.preferences.has(KEY), false);
});

test("Web still receives its supplied storage and never loads native preferences", async () => {
  const f = fixture();
  assert.equal(await resolveAuthStorage({ storage: f.options.legacyStorage,
    capacitor: { isNativePlatform: () => false }, preferencesLoader: async () => { throw new Error("must not load"); },
  }), f.options.legacyStorage);
});

test("Android retains Preferences storage and its existing fallback", async () => {
  const f = fixture(); const preferences = { ...f.options.legacyPreferences, async set({ key, value }) { f.preferences.set(key, value); } };
  const android = { isNativePlatform: () => true, getPlatform: () => "android" };
  const storage = await resolveAuthStorage({ storage: f.options.legacyStorage, capacitor: android, preferencesLoader: async () => preferences });
  await storage.setItem(KEY, "fictional-android-session"); assert.equal(await storage.getItem(KEY), "fictional-android-session");
  assert.equal(await resolveAuthStorage({ storage: f.options.legacyStorage, capacitor: android, preferencesLoader: async () => { throw new Error("fictional-unavailable"); } }), f.options.legacyStorage);
});
