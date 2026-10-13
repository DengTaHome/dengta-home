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

function withStore(mode, callback) {
  return openDatabase().then((db) => {
    return new Promise((resolve, reject) => {
      let tx, store;
      try { tx = db.transaction(STORE, mode); store = tx.objectStore(STORE); }
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
  const scope = requireAccount(account);
  return withStore("readwrite", (store) => {
    return store.put({ account: scope, path, content, savedAt: Date.now() });
  });
}

export async function workspaceCacheRead(account, path) {
  const scope = requireAccount(account);
  const item = await withStore("readonly", (store) => store.get([scope, path]));
  if (item !== undefined && (item?.account !== scope || item.path !== path || typeof item.content !== "string")) throw cacheFailure();
  return item;
}

export async function workspaceCacheList(account) {
  const scope = requireAccount(account);
  const items = await withStore("readonly", (store) => store.index("account").getAll(scope));
  if (!Array.isArray(items) || items.some(item => item?.account !== scope || typeof item.path !== "string" || typeof item.content !== "string")) throw cacheFailure();
  return items;
}

export async function workspaceCacheDelete(account, path) {
  const scope = requireAccount(account);
  return withStore("readwrite", (store) => store.delete([scope, path]));
}

export async function workspaceCacheClear(account) {
  const scope = requireAccount(account);
  return withStore("readwrite", (store) => {
    const request = store.index("account").openKeyCursor(scope);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  });
}

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
