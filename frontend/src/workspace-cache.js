import { Capacitor } from "@capacitor/core";
import { accountCacheStorage, flushAccountCache } from "./account-cache-vault.js";

// Web / Android use the existing IndexedDB cache. iOS stores these rows inside
// the account's encrypted native vault, never a plaintext IndexedDB fallback.
// 工作区文件本地缓存（IndexedDB）：把查看过的文件缓存在手机本地，
// 离线时仍能查看已缓存的内容；「清理缓存」一键删除全部缓存副本。

const DB_NAME = "dengta-workspace-cache";
const STORE = "account-files";
const DB_VERSION = 2;
const CACHE_TIMEOUT_MS = 5000;

function cacheFailure() { return Object.assign(new Error("本账号离线缓存暂时不可用。"), { code: "workspace_cache_failed" }); }

function openDatabase() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    try { request = globalThis.indexedDB.open(DB_NAME, DB_VERSION); } catch { reject(cacheFailure()); return; }
    const finish = (callback, value) => {
      if (settled) return false;
      settled = true; clearTimeout(timer); callback(value); return true;
    };
    const timer = setTimeout(() => finish(reject, cacheFailure()), CACHE_TIMEOUT_MS);
    timer.unref?.();
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ["account", "path"] });
        store.createIndex("account", "account");
      }
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      finish(resolve, request.result);
    };
    request.onerror = () => finish(reject, cacheFailure());
    request.onblocked = () => finish(reject, cacheFailure());
  });
}

function withStore(mode, callback, { clearUnowned = false } = {}) {
  return openDatabase().then((db) => {
    return new Promise((resolve, reject) => {
      let tx, store;
      try {
        const stores = clearUnowned && db.objectStoreNames.contains("files") ? [STORE, "files"] : [STORE];
        tx = db.transaction(stores, mode); store = tx.objectStore(STORE);
        if (stores.length > 1) tx.objectStore("files").clear();
      }
      catch { db.close(); reject(cacheFailure()); return; }
      let result;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer); db.close(); callback(value);
      };
      const timer = setTimeout(() => { finish(reject, cacheFailure()); try { tx.abort(); } catch { /* 事务可能已经结束。 */ } }, CACHE_TIMEOUT_MS);
      timer.unref?.();
      try {
        result = callback(store);
      } catch (error) {
        tx.abort();
        finish(reject, error);
        return;
      }
      tx.oncomplete = () => finish(resolve, result?.result);
      tx.onerror = () => finish(reject, cacheFailure());
      tx.onabort = () => finish(reject, cacheFailure());
    });
  });
}

function requireAccount(account) {
  const scope = String(account || "").trim();
  if (!scope) throw new Error("请登录后使用工作区离线缓存。");
  return scope;
}

export async function workspaceCacheWrite(account, path, content) {
  if (Capacitor.getPlatform() === "ios") return nativeWorkspace.write(account, path, content);
  const scope = requireAccount(account);
  return withStore("readwrite", (store) => {
    return store.put({ account: scope, path, content, savedAt: Date.now() });
  });
}

export async function workspaceCacheRead(account, path) {
  if (Capacitor.getPlatform() === "ios") return nativeWorkspace.read(account, path);
  const scope = requireAccount(account);
  const item = await withStore("readonly", (store) => store.get([scope, path]));
  if (item !== undefined && (item?.account !== scope || item.path !== path || typeof item.content !== "string")) throw cacheFailure();
  return item;
}

export async function workspaceCacheList(account) {
  if (Capacitor.getPlatform() === "ios") return nativeWorkspace.list(account);
  const scope = requireAccount(account);
  const items = await withStore("readonly", (store) => store.index("account").getAll(scope));
  if (!Array.isArray(items) || items.some(item => item?.account !== scope || typeof item.path !== "string" || typeof item.content !== "string")) throw cacheFailure();
  return items;
}

export async function workspaceCacheDelete(account, path) {
  if (Capacitor.getPlatform() === "ios") return nativeWorkspace.delete(account, path);
  const scope = requireAccount(account);
  return withStore("readwrite", (store) => store.delete([scope, path]));
}

export async function workspaceCacheClear(account) {
  if (Capacitor.getPlatform() === "ios") return nativeWorkspace.clear(account);
  return workspaceCacheClearLegacy(account);
}

// Explicit cleanup for account-owned rows left by older native builds. It is
// never consulted as a fallback when a native vault read/write fails.
export async function workspaceCacheClearLegacy(account, { clearUnowned = false } = {}) {
  const scope = requireAccount(account);
  return withStore("readwrite", (store) => {
    const request = store.index("account").openKeyCursor(scope);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  }, { clearUnowned });
}

const NATIVE_WORKSPACE_KEY = "dengta.workspace-cache.v3";

export function createNativeWorkspaceCache({ storageForAccount = accountCacheStorage, flush = flushAccountCache } = {}) {
  function state(account) {
    const scope = requireAccount(account);
    const storage = storageForAccount(scope);
    const encoded = storage.getItem(NATIVE_WORKSPACE_KEY);
    const rows = encoded === null ? [] : JSON.parse(encoded);
    if (!Array.isArray(rows) || rows.some(row => row?.account !== scope || typeof row.path !== "string" || typeof row.content !== "string")) throw cacheFailure();
    return { scope, storage, rows };
  }
  async function run(action) { try { return await action(); } catch { throw cacheFailure(); } }
  async function persist(current, rows) {
    if (rows.length) current.storage.setItem(NATIVE_WORKSPACE_KEY, JSON.stringify(rows));
    else current.storage.removeItem(NATIVE_WORKSPACE_KEY);
    await flush(current.scope);
    // An in-flight operation cannot report success after its facade is sealed.
    current.storage.getItem(NATIVE_WORKSPACE_KEY);
  }
  return Object.freeze({
    write: (account, path, content) => run(async () => {
      const current = state(account);
      if (typeof path !== "string" || !path || typeof content !== "string") throw cacheFailure();
      const item = { account: current.scope, path, content, savedAt: Date.now() };
      await persist(current, [...current.rows.filter(row => row.path !== path), item]);
    }),
    read: (account, path) => run(() => state(account).rows.find(row => row.path === path)),
    list: account => run(() => state(account).rows),
    delete: (account, path) => run(async () => { const current = state(account); await persist(current, current.rows.filter(row => row.path !== path)); }),
    clear: account => run(async () => { const current = state(account); await persist(current, []); }),
  });
}

const nativeWorkspace = createNativeWorkspaceCache();

export function cachedWorkspaceEntries(items, path = "") {
  const prefix = path ? `${path.replace(/\/$/, "")}/` : "";
  const entries = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (typeof item?.path !== "string" || typeof item.content !== "string") continue;
    if (!item.path.startsWith(prefix)) continue;
    const relative = item.path.slice(prefix.length);
    const [name, ...rest] = relative.split("/");
    if (!name) continue;
    const type = rest.length ? "dir" : "file";
    if (!entries.has(name) || type === "dir") {
      entries.set(name, { name, type, size: type === "file" ? new Blob([item.content]).size : 0 });
    }
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}
