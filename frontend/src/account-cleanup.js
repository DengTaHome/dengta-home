import { sealAccountCache, purgeAccountCache } from "./account-cache-vault.js";
import { Capacitor } from "@capacitor/core";

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const runtimeEpochs = new Map();
const sealedAccounts = new Set();
const cleanupListeners = new Set();

// UUIDs are case insensitive. Do not change opaque non-UUID account IDs.
export function normalizeRuntimeAccountId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return UUID.test(id) ? id.toLowerCase() : id;
}

export function accountIdFromRuntimeScope(scope) {
  if (typeof scope !== "string") return "";
  try {
    const value = JSON.parse(scope);
    if (Array.isArray(value)) return normalizeRuntimeAccountId(value[0]);
  } catch { /* A bare account ID is also a valid account storage scope. */ }
  return normalizeRuntimeAccountId(scope);
}

export function captureAccountRuntimeEpoch(accountId) {
  const id = normalizeRuntimeAccountId(accountId);
  return Object.freeze({ accountId: id, epoch: runtimeEpochs.get(id) || 0 });
}

export function isAccountRuntimeCurrent(ticket) {
  return Boolean(ticket?.accountId) && !sealedAccounts.has(ticket.accountId) &&
    ticket.epoch === (runtimeEpochs.get(ticket.accountId) || 0);
}

export function isAccountRuntimeAvailable(accountId) {
  const id = normalizeRuntimeAccountId(accountId);
  return Boolean(id) && !sealedAccounts.has(id);
}

// Call only after the previous account's exit promise and native preparation.
// Tickets captured before exit remain stale even when the same account returns.
export function prepareAccountRuntimeData(accountId) {
  const id = normalizeRuntimeAccountId(accountId);
  if (!id) return;
  sealedAccounts.delete(id);
  runtimeEpochs.set(id, (runtimeEpochs.get(id) || 0) + 1);
}

export function registerAccountRuntimeCleanup(listener) {
  if (typeof listener !== "function") throw new TypeError("Account cleanup must be a function");
  cleanupListeners.add(listener);
  return () => cleanupListeners.delete(listener);
}

const SCOPED_STORAGE_BASES = Object.freeze([
  "dengta_active_companion_id_v1", "dengta_chat_model_v1", "dengta_chat_session_models_v1",
  "dengta_message_references_v1", "dengta_visible_inner_monologues_v1", "dengta_monologue_recovery_v1",
  "dengta_chat_draft_v2", "dengta_companion_status_v1", "dengta_companion_interactions_v1",
  "dengta_intimate_duel_v2", "dengta_intimate_duel_v3", "dengta_prompt_receipt_v1",
  "dengta_push_cursor", "dengta_push_seen_ids", "dengta_persona_reset_seen_v1",
  "dengta_companion_reply_notified_v1", "dengta_companion_reply_baseline_v1",
  "dengta_home_ambient_location_v1", "dengta_home_ambient_weather_v1", "dengta_home_ambient_preferences_v1",
  "dengta_whereabouts_last_report", "dengta_whereabouts_recording_consent_v1", "dengta_groq_key_expires_at",
  "dengta_story_chapters_v1", "dengta_music_moments_v1", "dengta_guide_v2", "dengta_cotton_v1",
  "dengta_emotion_understanding_enabled", "dengta_voice_playback_mode", "dengta_text_impact_v1",
  "dengta.chat-skin.v1", "dengta.together.direct-media.v2", "dengta:ai-music-results:v1", "dengta:ai-music-results:v2",
  "dengta_together_web_page_v2", "dengta.ui-theme.v2", "dengta.ui-theme.v1",
  "dengta-sticker-import", "dengta-xhs-sticker-import", "dengta_takeout_attempted_v2",
]);

// These old maps have no reliable owner. Remove them; never adopt them into the
// next account. Public visual/font preferences and auth token keys are excluded.
const UNSCOPED_PRIVATE_KEYS = new Set([
  "dengta_message_references_v1", "dengta_chat_model_v1", "dengta_chat_session_models_v1",
  "dengta_visible_inner_monologues_v1", "dengta_monologue_recovery_v1",
  "dengta_companion_status_v1", "dengta_companion_interactions_v1", "dengta_intimate_duel_v2",
  "dengta_intimate_duel_v3", "dengta_prompt_receipt_v1", "dengta_push_cursor", "dengta_push_seen_ids",
  "dengta_home_ambient_location_v1", "dengta_home_ambient_weather_v1", "dengta_pending_room_invite",
  "dengta.cast.receiver-token.v1",
]);

export function isAccountPrivateStorageKey(key, accountId) {
  if (typeof key !== "string") return false;
  const id = normalizeRuntimeAccountId(accountId);
  if (!id) return false;
  if (UNSCOPED_PRIVATE_KEYS.has(key)) return true;
  for (const base of SCOPED_STORAGE_BASES) {
    if (key.startsWith(`${base}:`)) return accountIdFromRuntimeScope(key.slice(base.length + 1)) === id;
  }
  const chatCache = /^dengta\.chat-cache\.v[1-5]:(.+)$/.exec(key);
  if (chatCache) return accountIdFromRuntimeScope(chatCache[1]) === id;
  // The account segment in these formats is encoded and delimited, not a
  // substring: deleting account "a" must preserve account "a.b" and "ab".
  const receipt = /^(dengta_import_attempt_v1|dengta_import_checkpoint_v1)\.([^.]+)\.([^.]+)\.[^.]+(?:\.[a-f0-9]{64})?$/.exec(key);
  if (receipt) {
    try { return normalizeRuntimeAccountId(decodeURIComponent(receipt[2])) === id; }
    catch { return false; }
  }
  return false;
}

function browserStorage(name) {
  try { return globalThis[name]; } catch { return undefined; }
}

export function purgeAccountLegacyStorage(accountId, storage) {
  if (!storage) return 0;
  const keys = [];
  // Enumerate key names only. In particular, never read token values.
  for (let index = 0; index < (storage.length || 0); index += 1) {
    const key = storage.key(index);
    if (isAccountPrivateStorageKey(key, accountId)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}

// Run once before an iOS account's encrypted cache is hydrated. The account's
// legacy plaintext data must not survive until its first explicit sign out.
export async function clearAccountLegacyData(accountId, options = {}) {
  const id = normalizeRuntimeAccountId(accountId);
  if (!id) return;
  const failures = [];
  const tasks = [];
  for (const storage of [
    Object.hasOwn(options, "localStorage") ? options.localStorage : browserStorage("localStorage"),
    Object.hasOwn(options, "sessionStorage") ? options.sessionStorage : browserStorage("sessionStorage"),
  ]) {
    try { purgeAccountLegacyStorage(id, storage); } catch (error) { failures.push(error); }
  }
  if (options.workspaceCacheClearLegacy || globalThis.indexedDB) tasks.push(Promise.resolve().then(async () => {
    const clear = options.workspaceCacheClearLegacy || (await import("./workspace-cache.js")).workspaceCacheClearLegacy;
    // Old v1 rows have no reliable owner. iOS removes those rebuildable
    // plaintext cache copies rather than assigning them to the next login.
    await clear(id, { clearUnowned: Capacitor.getPlatform() === "ios" });
  }));
  for (const result of await Promise.allSettled(tasks)) if (result.status === "rejected") failures.push(result.reason);
  if (failures.length) throw Object.assign(new AggregateError(failures, "旧版私密缓存清理未完成，请重试。"), { code: "account_legacy_cleanup_failed" });
}

export async function clearAccountRuntimeData(accountId, options = {}) {
  const id = normalizeRuntimeAccountId(accountId);
  if (!id) return;
  const failures = [];
  const tasks = [];
  // Everything above the first await is the exit barrier. An old draft or
  // pending callback cannot use a captured native facade after this call.
  try { (options.sealAccountCache || sealAccountCache)(id); } catch (error) { failures.push(error); }
  sealedAccounts.add(id);
  runtimeEpochs.set(id, (runtimeEpochs.get(id) || 0) + 1);
  for (const listener of [...cleanupListeners, ...(options.cleanupCallbacks || [])]) {
    try { tasks.push(Promise.resolve(listener(id))); } catch (error) { failures.push(error); }
  }
  tasks.push(clearAccountLegacyData(id, options));
  tasks.push(Promise.resolve().then(() => (options.purgeAccountCache || purgeAccountCache)(id)));
  tasks.push(Promise.resolve().then(async () => {
    const stop = options.stopVoiceSpeech || (await import("./voice.js")).stopVoiceSpeech;
    await stop();
  }));
  for (const result of await Promise.allSettled(tasks)) if (result.status === "rejected") failures.push(result.reason);
  if (failures.length) throw Object.assign(new AggregateError(failures, "Account cleanup could not finish"), { code: "account_cleanup_failed" });
}
