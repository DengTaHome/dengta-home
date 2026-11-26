import { resolveAccountCacheStorage, accountIdFromRuntimeScope } from "./account-cache-vault.js";

export const PERSONA_RESET_MARKER_KEY = "dengta_persona_reset_seen_v1";

export const PERSONA_LOCAL_STORAGE_KEYS = Object.freeze([
  "dengta_companion_status_v1",
  "dengta_companion_interactions_v1",
  "dengta_intimate_duel_v2",
  "dengta_intimate_duel_v3",
  "dengta_message_references_v1",
  "dengta_prompt_receipt_v1",
  "dengta_visible_inner_monologues_v1",
  "dengta_push_cursor",
  "dengta_push_seen_ids",
]);

export function applyPersonaResetToLocalStorage(
  resetAt,
  storage,
  accountScope = "",
) {
  storage = resolveAccountCacheStorage(storage, accountIdFromRuntimeScope(accountScope));
  const marker = String(resetAt || "").trim();
  if (!marker || !storage) return false;
  const markerKey = accountStorageKey(PERSONA_RESET_MARKER_KEY, accountScope);
  if (storage.getItem(markerKey) === marker) return false;

  for (const key of PERSONA_LOCAL_STORAGE_KEYS) {
    storage.removeItem(accountStorageKey(key, accountScope));
  }
  storage.setItem(markerKey, marker);
  return true;
}
import { accountStorageKey } from "./account-storage.js";
