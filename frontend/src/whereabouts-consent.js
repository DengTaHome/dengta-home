import { accountStorageKey } from "./account-storage.js";

const CONSENT_KEY = "dengta_whereabouts_recording_consent_v1";
const listeners = new Set();
const denied = new WeakMap();

function usableScope(scope) {
  try {
    const value = JSON.parse(scope);
    return Array.isArray(value) && value.length === 2 && value.every(part => typeof part === "string" && part.trim());
  } catch { return false; }
}

function storageFor(candidate) {
  try { return candidate ?? globalThis.localStorage; } catch { return undefined; }
}

export function readWhereaboutsConsent(scope, candidate) {
  const storage = storageFor(candidate);
  if (!usableScope(scope) || !storage || denied.get(storage)?.has(scope)) return false;
  try { return storage.getItem(accountStorageKey(CONSENT_KEY, scope)) === "enabled"; }
  catch { return false; }
}

export function setWhereaboutsConsent(scope, enabled, candidate) {
  const storage = storageFor(candidate);
  if (!usableScope(scope) || !storage) throw Object.assign(new Error("Location consent could not be saved"), { code: "whereabouts_consent_unavailable" });
  let scopes = denied.get(storage);
  if (!scopes) { scopes = new Set(); denied.set(storage, scopes); }
  scopes.add(scope);
  const key = accountStorageKey(CONSENT_KEY, scope), value = enabled === true ? "enabled" : "disabled";
  let saved = false;
  try { storage.setItem(key, value); saved = storage.getItem(key) === value; }
  catch { /* An unconfirmed local write must not authorize collection. */ }
  if (saved && enabled === true) scopes.delete(scope);
  for (const listener of listeners) listener();
  if (!saved) throw Object.assign(new Error("Location consent could not be saved"), { code: "whereabouts_consent_unavailable" });
  return enabled === true;
}

export function subscribeWhereaboutsConsent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
