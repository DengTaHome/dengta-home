import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeVault = registerPlugin("DengTaAccountVault");
export const ACCOUNT_CACHE_MAX_BYTES = 2 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const failure = (code = "account_cache_unavailable") => Object.assign(new Error("此账号的本机私密缓存暂时不可用，请重试。"), { code });
const browserStorage = () => { try { return globalThis.localStorage; } catch { return undefined; } };

export function accountIdFromRuntimeScope(scope) {
  const text = String(scope || "").trim();
  if (UUID.test(text)) return text.toLowerCase();
  try {
    const parts = JSON.parse(text);
    return Array.isArray(parts) && UUID.test(String(parts[0] || "")) ? String(parts[0]).toLowerCase() : "";
  } catch { return ""; }
}

// The Swift plugin encrypts one protected file per account. This mirror keeps
// React's synchronous initializers intact; callers must prepare before mounting.
export function createAccountCacheVault({
  isNative = () => Capacitor.getPlatform() === "ios",
  plugin = NativeVault,
  maxBytes = ACCOUNT_CACHE_MAX_BYTES,
} = {}) {
  const records = new Map(), purges = new Map(), facades = new WeakMap(), accountEpochs = new Map();
  let epoch = 0;
  const native = () => typeof isNative === "function" ? isNative() : isNative;
  function account(value) {
    const id = String(value || "").trim().toLowerCase();
    if (!UUID.test(id)) throw failure("account_cache_scope_required");
    return id;
  }
  const valid = record => records.get(record.accountId) === record && !record.sealed && record.ready;
  const assertCurrent = record => { if (!valid(record)) throw failure("account_cache_scope_changed"); };
  function serialized(accountId, entries) {
    const value = JSON.stringify({ version: 1, accountId, entries: Object.fromEntries(entries) });
    if (new TextEncoder().encode(value).byteLength > maxBytes) throw failure("account_cache_quota_exceeded");
    return value;
  }
  function decode(accountId, receipt) {
    if (!receipt || !(receipt.value === null || typeof receipt.value === "string")) throw failure("account_cache_receipt_invalid");
    if (receipt.value === null) return new Map();
    if (new TextEncoder().encode(receipt.value).byteLength > maxBytes) throw failure("account_cache_quota_exceeded");
    let data;
    try { data = JSON.parse(receipt.value); } catch { throw failure("account_cache_receipt_invalid"); }
    if (data?.version !== 1 || data.accountId !== accountId || !data.entries || typeof data.entries !== "object" || Array.isArray(data.entries) || Object.values(data.entries).some(value => typeof value !== "string")) throw failure("account_cache_receipt_invalid");
    return new Map(Object.entries(data.entries));
  }
  function schedule(record) {
    if (record.draining) return;
    record.draining = true;
    record.queue = Promise.resolve().then(async () => {
      while (valid(record) && record.pending !== null) {
        const value = record.pending;
        record.pending = null;
        try {
          await plugin.write({ accountId: record.accountId, value });
          record.error = null;
        } catch {
          record.error = failure("account_cache_write_failed");
        }
      }
    }).finally(() => {
      record.draining = false;
      if (valid(record) && record.pending !== null) schedule(record);
    });
  }
  function replace(record, entries) {
    assertCurrent(record);
    const value = serialized(record.accountId, entries);
    record.values = entries;
    record.pending = value;
    schedule(record);
  }
  function facade(record) {
    const result = Object.freeze({
      get length() { assertCurrent(record); return record.values.size; },
      key(index) { assertCurrent(record); return Number.isInteger(index) && index >= 0 ? [...record.values.keys()][index] ?? null : null; },
      getItem(key) { assertCurrent(record); return record.values.get(String(key)) ?? null; },
      setItem(key, value) { const next = new Map(record.values); next.set(String(key), String(value)); replace(record, next); },
      removeItem(key) { const next = new Map(record.values); next.delete(String(key)); replace(record, next); },
      clear() { replace(record, new Map()); },
    });
    facades.set(result, record.accountId);
    return result;
  }
  async function prepareAccountCache(accountId) {
    if (!native()) return browserStorage();
    const id = account(accountId);
    const startingEpoch = accountEpochs.get(id) || 0;
    if (purges.has(id)) await purges.get(id);
    if ((accountEpochs.get(id) || 0) !== startingEpoch) throw failure("account_cache_scope_changed");
    const existing = records.get(id);
    if (existing && !existing.sealed) {
      if (existing.ready) return existing.facade;
      return existing.preparing;
    }
    const record = { accountId: id, epoch: ++epoch, ready: false, sealed: false, values: new Map(), pending: null, queue: Promise.resolve(), draining: false, error: null };
    records.set(id, record);
    record.facade = facade(record);
    record.preparing = (async () => {
      try {
        const receipt = await plugin.read({ accountId: id });
        if (records.get(id) !== record || record.sealed) throw failure("account_cache_scope_changed");
        record.values = decode(id, receipt);
        record.ready = true;
        return record.facade;
      } catch (error) {
        record.sealed = true;
        record.values.clear();
        throw error?.code?.startsWith("account_cache_") ? error : failure();
      }
    })();
    return record.preparing;
  }
  function accountCacheStorage(accountId, fallback) {
    if (!native()) return fallback === undefined ? browserStorage() : fallback;
    const record = records.get(account(accountId));
    if (!record || !valid(record)) throw failure("account_cache_not_prepared");
    return record.facade;
  }
  function resolveAccountCacheStorage(storage, accountId) {
    if (!native()) return storage === undefined ? browserStorage() : storage;
    if (storage && facades.has(storage)) {
      if (accountId && facades.get(storage) !== account(accountId)) throw failure("account_cache_scope_changed");
      return storage;
    }
    return accountCacheStorage(accountId);
  }
  function sealAccountCache(accountId) {
    if (!native()) return;
    const id = account(accountId);
    accountEpochs.set(id, (accountEpochs.get(id) || 0) + 1);
    const record = records.get(id);
    if (!record) return;
    record.sealed = true;
    record.ready = false;
    record.pending = null;
    record.values.clear();
  }
  async function flushAccountCache(accountId) {
    if (!native()) return;
    const record = records.get(account(accountId));
    if (!record) return;
    let queue;
    do { queue = record.queue; await queue; } while (queue !== record.queue);
    if (record.error) throw record.error;
  }
  async function purgeAccountCache(accountId) {
    if (!native()) return;
    const id = account(accountId);
    if (purges.has(id)) return purges.get(id);
    const record = records.get(id);
    sealAccountCache(id);
    const purging = (async () => {
      if (record) await Promise.allSettled([record.preparing, record.queue]);
      try { await plugin.clear({ accountId: id }); } catch { throw failure("account_cache_clear_failed"); }
      if (records.get(id) === record) records.delete(id);
    })();
    purges.set(id, purging);
    try { await purging; } finally { if (purges.get(id) === purging) purges.delete(id); }
  }
  return Object.freeze({ prepareAccountCache, accountCacheStorage, resolveAccountCacheStorage, sealAccountCache, purgeAccountCache, flushAccountCache });
}

const accountVault = createAccountCacheVault();
export const { prepareAccountCache, accountCacheStorage, resolveAccountCacheStorage, sealAccountCache, purgeAccountCache, flushAccountCache } = accountVault;
