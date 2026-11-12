import { resolveAccountCacheStorage } from "./account-cache-vault.js";

function ownerForScope(scope) {
  const value = String(scope || "").trim();
  if (!value.startsWith("[")) return value;
  try { const parts = JSON.parse(value); return Array.isArray(parts) ? String(parts[0] || "") : ""; } catch { return ""; }
}

export function accountStorageKey(baseKey, accountScope = "") {
  const scope = String(accountScope || "").trim();
  return scope ? `${baseKey}:${scope}` : baseKey;
}

export function readAccountStorage(
  storage,
  baseKey,
  accountScope = "",
  { migrateLegacy = false } = {},
) {
  storage = resolveAccountCacheStorage(storage, ownerForScope(accountScope));
  const key = accountStorageKey(baseKey, accountScope);
  const stored = storage?.getItem(key);
  if (stored !== null && stored !== undefined) return stored;
  if (!migrateLegacy || key === baseKey) return null;

  const legacy = storage?.getItem(baseKey);
  if (legacy === null || legacy === undefined) return null;
  storage?.setItem(key, legacy);
  storage?.removeItem(baseKey);
  return legacy;
}

export function writeAccountStorage(
  storage,
  baseKey,
  accountScope,
  value,
) {
  storage = resolveAccountCacheStorage(storage, ownerForScope(accountScope));
  const key = accountStorageKey(baseKey, accountScope);
  if (value === null || value === undefined) storage?.removeItem(key);
  else storage?.setItem(key, String(value));
  return key;
}
