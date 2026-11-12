import { resolveAccountCacheStorage } from "./account-cache-vault.js";

export function chatDraftKey(account, companion, session) {
  if (!String(account || "").trim() || !String(companion || "").trim()) return null;
  return `dengta_chat_draft_v2:${JSON.stringify([account, companion, session || null])}`;
}

function draftAccount(key) {
  const prefix = "dengta_chat_draft_v2:";
  if (!String(key || "").startsWith(prefix)) return "";
  try { const scope = JSON.parse(key.slice(prefix.length)); return Array.isArray(scope) ? scope[0] : ""; } catch { return ""; }
}

export function createChatDraft(key, storage) {
  try { storage = resolveAccountCacheStorage(storage, draftAccount(key)); } catch { storage = null; }
  let value = "", timer = null, dirty = false;
  const listeners = new Set();
  try { if (key) value = storage?.getItem(key) || ""; } catch { /* In-memory draft still works. */ }
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (!key || !dirty) return;
    try {
      if (value) storage?.setItem(key, value);
      else storage?.removeItem(key);
      dirty = false;
    } catch { /* Keep the draft in memory if storage is full or unavailable. */ }
  };
  return {
    getSnapshot: () => value,
    set(update) {
      const next = typeof update === "function" ? update(value) : update;
      if (typeof next !== "string" || next === value) return;
      value = next;
      dirty = true;
      clearTimeout(timer);
      if (!value || listeners.size === 0) flush();
      else timer = setTimeout(flush, 350);
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); if (!listeners.size) flush(); };
    },
    flush,
  };
}

export function createChatDrafts(account, companion, storage) {
  try { storage = resolveAccountCacheStorage(storage, account); } catch { storage = null; }
  const stores = new Map();
  const get = (session) => {
    const id = session || null;
    if (!stores.has(id)) stores.set(id, createChatDraft(chatDraftKey(account, companion, id), storage));
    return stores.get(id);
  };
  return {
    get,
    setSession(session, update) { get(session).set(update); },
    move(from, to) {
      if ((from || null) === (to || null)) return;
      const source = get(from);
      const text = source.getSnapshot();
      if (!text) return;
      get(to).set((current) => current ? `${current}\n\n${text}` : text);
      source.set("");
    },
  };
}
