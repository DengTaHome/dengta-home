import { resolveAccountCacheStorage } from "./account-cache-vault.js";
import { captureAccountRuntimeEpoch, isAccountRuntimeAvailable, isAccountRuntimeCurrent, normalizeRuntimeAccountId, registerAccountRuntimeCleanup } from "./account-cleanup.js";

const cache = new Map();
const volatileKeys = new Set();
const attemptEpochs = new WeakMap();
const validId = value => /^[a-zA-Z0-9_-]{1,100}$/.test(value || "");

export function createImportAttempt(importId, kind, accountId = "") {
  const record = { version: 1, importId: String(importId), kind, startedAt: Date.now() };
  if (accountId) attemptEpochs.set(record, captureAccountRuntimeEpoch(accountId));
  return record;
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
function accountForPrefix(prefix) {
  const match = /^dengta_import_attempt_v1\.([^.]+)\./.exec(prefix || "");
  try { return match ? normalizeRuntimeAccountId(decodeURIComponent(match[1])) : ""; } catch { return ""; }
}
function targetStorage(storage, prefix) {
  return resolveAccountCacheStorage(storage, accountForPrefix(prefix));
}
const staleStorage = error => ["account_cache_scope_changed", "account_cache_not_prepared", "account_cache_scope_required"].includes(error?.code);

export function clearAccountImportAttempts(accountId) {
  const account = normalizeRuntimeAccountId(accountId);
  for (const key of cache.keys()) if (accountForPrefix(key) === account) { cache.delete(key); volatileKeys.delete(key); }
}
registerAccountRuntimeCleanup(clearAccountImportAttempts);

export function readImportAttempts(prefix, storage) {
  if (!prefix || !isAccountRuntimeAvailable(accountForPrefix(prefix))) return [];
  let records = new Map([...cache].filter(([key]) => key.startsWith(prefix)));
  try {
    const target = targetStorage(storage, prefix);
    if (!target) return [...records.values()].sort((a, b) => a.startedAt - b.startedAt);
    const stored = new Map([...records].filter(([key]) => volatileKeys.has(key)));
    for (let i = 0; i < (target?.length || 0); i++) {
      const key = target.key(i);
      if (!key?.startsWith(prefix)) continue;
      let value;
      try { value = normalized(JSON.parse(target.getItem(key) || "null")); } catch { continue; }
      if (value && key === prefix + value.importId) { stored.set(key, value); cache.set(key,value); attemptEpochs.set(value, captureAccountRuntimeEpoch(accountForPrefix(prefix))); }
    }
    records = stored;
    for (const key of cache.keys()) if (key.startsWith(prefix) && !records.has(key)) cache.delete(key);
  } catch (error) {
    if (staleStorage(error)) return [];
    // The same-tab cache protects a remounted panel when browser storage is blocked.
  }
  return [...records.values()].sort((a, b) => a.startedAt - b.startedAt);
}

export function saveImportAttempt(prefix, record, storage) {
  const value = normalized(record);
  const account = accountForPrefix(prefix);
  if (!prefix || !value || !isAccountRuntimeAvailable(account)) return false;
  let ticket = attemptEpochs.get(record);
  if (ticket && (ticket.accountId !== account || !isAccountRuntimeCurrent(ticket))) return false;
  if (!ticket) { ticket = captureAccountRuntimeEpoch(account); attemptEpochs.set(record, ticket); }
  attemptEpochs.set(value, ticket);
  const key = prefix + value.importId;
  const remember = durable => { cache.set(key, value); if (durable) volatileKeys.delete(key); else volatileKeys.add(key); };
  try { const target = targetStorage(storage, prefix); target?.setItem(key, JSON.stringify(value)); remember(Boolean(target)); return Boolean(target); }
  catch (error) { if (!staleStorage(error)) remember(false); return false; }
}

export function clearImportAttempt(prefix, importId, storage) {
  if (!prefix || !validId(importId) || !isAccountRuntimeAvailable(accountForPrefix(prefix))) return false;
  const key = prefix + importId;
  const forget = () => { cache.delete(key); volatileKeys.delete(key); };
  try { const target = targetStorage(storage, prefix); target?.removeItem(key); forget(); return Boolean(target); }
  catch (error) { if (!staleStorage(error)) forget(); return false; }
}
