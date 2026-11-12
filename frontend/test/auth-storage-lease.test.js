import assert from "node:assert/strict";
import test from "node:test";
import { createAuthStorageLease } from "../src/auth-storage-lease.js";
import { IOS_AUTH_STORAGE_KEYS } from "../src/auth-keychain-storage.js";

const KEY = IOS_AUTH_STORAGE_KEYS[0];
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture() {
  const values = new Map();
  const calls = [];
  return {
    values, calls,
    storage: {
      getItem(key) { calls.push(["get", key]); return values.get(key) ?? null; },
      setItem(key, value) { calls.push(["set", key]); values.set(key, value); },
      removeItem(key) { calls.push(["remove", key]); values.delete(key); },
    },
  };
}

test("missing browser storage leaves the SDK's memory storage available", () => {
  assert.equal(createAuthStorageLease(undefined), undefined);
  assert.equal(createAuthStorageLease(null), undefined);
  assert.throws(() => createAuthStorageLease({}), { code: "auth_storage_unavailable" });
});

test("SDK storage operations stay ordered across asynchronous writes", async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  const set = f.storage.setItem;
  f.storage.setItem = async (key, value) => { entered.resolve(); await gate.promise; set(key, value); };
  const lease = createAuthStorageLease(f.storage);
  const write = lease.setItem(KEY, "fictional-session");
  const read = lease.getItem(KEY);
  await entered.promise;
  assert.deepEqual(f.calls, []);
  gate.resolve();
  await write;
  assert.equal(await read, "fictional-session");
  assert.deepEqual(f.calls, [["set", KEY], ["get", KEY]]);
});

test("exit seals running and queued work before clearing, including reads", async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  const set = f.storage.setItem;
  f.storage.setItem = async (key, value) => { entered.resolve(); await gate.promise; set(key, value); };
  const lease = createAuthStorageLease(f.storage);
  const running = lease.setItem(KEY, "fictional-account-a"); running.catch(() => {});
  await entered.promise;
  const queued = lease.setItem(KEY, "fictional-queued-a"); queued.catch(() => {});
  const clear = lease.retireAndClear();
  assert.equal(lease.retireAndClear(), clear);
  await assert.rejects(lease.getItem(KEY), { code: "auth_storage_retired" });
  await assert.rejects(lease.setItem(KEY, "fictional-late-a"), { code: "auth_storage_retired" });
  await assert.rejects(lease.removeItem(KEY), { code: "auth_storage_retired" });
  assert.equal(f.calls.some(([method]) => method === "remove"), false);
  gate.resolve();
  await assert.rejects(running, { code: "auth_storage_retired" });
  await assert.rejects(queued, { code: "auth_storage_retired" });
  await clear;
  assert.equal(f.values.size, 0);
  assert.equal(f.calls.filter(([method]) => method === "set").length, 1);
});

test("late reads do not return an old session after retirement", async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  f.storage.getItem = async () => { entered.resolve(); await gate.promise; return "fictional-old-session"; };
  const lease = createAuthStorageLease(f.storage);
  const read = lease.getItem(KEY); read.catch(() => {});
  await entered.promise;
  // Delegate the clear so verification need not use this intentionally stuck reader.
  f.storage.retireAndClear = async () => {};
  const clear = lease.retireAndClear();
  gate.resolve();
  await assert.rejects(read, { code: "auth_storage_retired" });
  await clear;
});

test("a completed old barrier and late old SDK calls cannot remove the next account", async () => {
  const f = fixture(); f.values.set("public-setting", "keep");
  const old = createAuthStorageLease(f.storage);
  await old.setItem(KEY, "fictional-account-a");
  const clear = old.retireAndClear(); await clear;
  const current = createAuthStorageLease(f.storage);
  await current.setItem(KEY, "fictional-account-b");
  await assert.rejects(old.setItem(KEY, "fictional-late-a"), { code: "auth_storage_retired" });
  await assert.rejects(old.removeItem(KEY), { code: "auth_storage_retired" });
  assert.equal(old.retireAndClear(), clear); await old.retireAndClear();
  assert.equal(await current.getItem(KEY), "fictional-account-b");
  assert.equal(f.values.get("public-setting"), "keep");
});

test("native retirement delegates only after an in-flight operation completes", async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  const order = [];
  f.storage.setItem = async () => { entered.resolve(); await gate.promise; order.push("write"); };
  f.storage.retireAndClear = async () => { order.push("native-clear"); };
  const lease = createAuthStorageLease(f.storage);
  const running = lease.setItem(KEY, "fictional-session"); running.catch(() => {});
  await entered.promise;
  const clear = lease.retireAndClear();
  await Promise.resolve(); assert.deepEqual(order, []);
  gate.resolve(); await assert.rejects(running, { code: "auth_storage_retired" });
  await clear;
  assert.deepEqual(order, ["write", "native-clear"]);
  assert.deepEqual(f.calls, []);
});

test("all known auth keys are attempted on clear failure and unlock can retry", async () => {
  const f = fixture();
  for (const key of IOS_AUTH_STORAGE_KEYS) f.values.set(key, "fictional-session");
  let locked = true;
  const remove = f.storage.removeItem;
  f.storage.removeItem = key => {
    if (key === KEY && locked) { f.calls.push(["remove-locked", key]); throw new Error("fictional-provider-secret"); }
    remove(key);
  };
  const lease = createAuthStorageLease(f.storage);
  await assert.rejects(lease.retireAndClear(), error => {
    assert.equal(error.code, "auth_storage_clear_failed");
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(error.message, /fictional/);
    return true;
  });
  assert.equal(f.values.size, 1);
  await assert.rejects(lease.setItem(KEY, "fictional-session"), { code: "auth_storage_retired" });
  locked = false;
  await lease.retireAndClear();
  assert.equal(f.values.size, 0);
});

test("a silent deletion failure blocks the barrier instead of accepting stale credentials", async () => {
  const f = fixture(); f.values.set(KEY, "fictional-session"); f.storage.removeItem = () => {};
  const lease = createAuthStorageLease(f.storage);
  await assert.rejects(lease.retireAndClear(), { code: "auth_storage_clear_failed" });
});

test("provider errors cannot expose values and do not poison active operations", async () => {
  const f = fixture(); let failed = true;
  const get = f.storage.getItem;
  f.storage.getItem = key => {
    if (failed) { failed = false; throw new Error("fictional-sensitive-value"); }
    return get(key);
  };
  const lease = createAuthStorageLease(f.storage);
  await assert.rejects(lease.getItem(KEY), error => {
    assert.equal(error.code, "auth_storage_read_failed");
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(error.message, /fictional/);
    return true;
  });
  await lease.setItem(KEY, "fictional-session");
  assert.equal(await lease.getItem(KEY), "fictional-session");
  await assert.rejects(lease.getItem("unrelated-secret"), { code: "auth_storage_invalid_key" });
  assert.equal(f.calls.some(([, key]) => key === "unrelated-secret"), false);
});
