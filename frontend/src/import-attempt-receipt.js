const cache = new Map();
const volatileKeys = new Set();
const validId = value => /^[a-zA-Z0-9_-]{1,100}$/.test(value || "");

export function createImportAttempt(importId, kind) {
  return { version: 1, importId: String(importId), kind, startedAt: Date.now() };
}

export function importAttemptPrefix(account, companion) {
  const encode = value => encodeURIComponent(value).replaceAll(".", "%2E");
  return account && companion ? `dengta_import_attempt_v1.${encode(account)}.${encode(companion)}.` : null;
}
function normalized(record) {
  if (record?.version !== 1 || !validId(record.importId) || !["world_book", "chat_history"].includes(record.kind)
      || !Number.isSafeInteger(record.startedAt) || record.startedAt < 0 || record.startedAt > 8_640_000_000_000_000) return null;
  return { version: 1, importId: record.importId, kind: record.kind, startedAt: record.startedAt };
}
function targetStorage(storage) { return storage === undefined ? globalThis.localStorage : storage; }

export function readImportAttempts(prefix, storage) {
  if (!prefix) return [];
  let records = new Map([...cache].filter(([key]) => key.startsWith(prefix)));
  try {
    const target = targetStorage(storage);
    if (!target) return [...records.values()].sort((a, b) => a.startedAt - b.startedAt);
    const stored = new Map([...records].filter(([key]) => volatileKeys.has(key)));
    for (let i = 0; i < (target?.length || 0); i++) {
      const key = target.key(i);
      if (!key?.startsWith(prefix)) continue;
      let value;
      try { value = normalized(JSON.parse(target.getItem(key) || "null")); } catch { continue; }
      if (value && key === prefix + value.importId) { stored.set(key, value); cache.set(key,value); }
    }
    records = stored;
    for (const key of cache.keys()) if (key.startsWith(prefix) && !records.has(key)) cache.delete(key);
  } catch { /* The same-tab cache still protects a remounted panel when storage is blocked. */ }
  return [...records.values()].sort((a, b) => a.startedAt - b.startedAt);
}

export function saveImportAttempt(prefix, record, storage) {
  const value = normalized(record);
  if (!prefix || !value) return false;
  const key = prefix + value.importId;
  cache.set(key, value);
  volatileKeys.add(key);
  try { const target = targetStorage(storage); target?.setItem(key, JSON.stringify(value)); if(target)volatileKeys.delete(key); return Boolean(target); }
  catch { return false; }
}

export function clearImportAttempt(prefix, importId, storage) {
  if (!prefix || !validId(importId)) return false;
  const key = prefix + importId;
  cache.delete(key);
  volatileKeys.delete(key);
  try { const target = targetStorage(storage); target?.removeItem(key); return Boolean(target); }
  catch { return false; }
}
