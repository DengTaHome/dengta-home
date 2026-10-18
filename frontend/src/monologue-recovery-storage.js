const STORAGE_KEY = "dengta_monologue_recovery_v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const MAX_ENTRIES = 128;
const MAX_AGE = 24 * 60 * 60 * 1000;
const invalidatedAnchors = new Set();

export function availableMonologueStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function keyFor(scope) { return `${STORAGE_KEY}:${scope}`; }
function anchorKey(sessionId, userAnchor, anchorId) {
  return JSON.stringify([sessionId, userAnchor === true, String(anchorId)]);
}
function read(storage, scope, now) {
  const stored = storage?.getItem(keyFor(scope));
  let value;
  try { value = JSON.parse(stored || "{}"); } catch { return {}; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, row]) => {
    let anchor;
    try { anchor = JSON.parse(key); } catch { return false; }
    return Array.isArray(anchor) && anchor.length === 3 && UUID.test(anchor[0]) &&
      typeof anchor[1] === "boolean" && typeof anchor[2] === "string" && anchor[2].length <= 80 &&
      row && UUID.test(row.requestId) && HASH.test(row.fingerprint) &&
      Number.isFinite(row.createdAt) && row.createdAt <= now && now - row.createdAt <= MAX_AGE;
  }).slice(-MAX_ENTRIES).map(([key, row]) => [key, {
    requestId: row.requestId, fingerprint: row.fingerprint, createdAt: row.createdAt,
  }]));
}

export async function resolveMonologueRecoveryId({
  scope, sessionId, userAnchor, anchorId, model, companionStatus = {}, createId,
  storage = availableMonologueStorage(), now = Date.now(),
}) {
  const fresh = () => ({ requestId: createId(), persisted: false });
  if (!scope || !UUID.test(sessionId) || !String(anchorId || "")) return fresh();
  let requestId;
  try {
    const { mood, energyLevel, focus, microState } = companionStatus;
    const bytes = new TextEncoder().encode(JSON.stringify([model, mood, energyLevel, focus, microState]));
    const fingerprint = Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
    const anchor = anchorKey(sessionId, userAnchor, anchorId);
    const invalidationKey = JSON.stringify([scope, anchor]);
    const rows = read(storage, scope, now);
    const previous = invalidatedAnchors.has(invalidationKey) ? null : rows[anchor];
    requestId = previous?.fingerprint === fingerprint ? previous.requestId : createId();
    if (!UUID.test(requestId)) return fresh();
    delete rows[anchor];
    rows[anchor] = { requestId, fingerprint, createdAt: previous?.fingerprint === fingerprint ? previous.createdAt : now };
    const serialized = JSON.stringify(Object.fromEntries(Object.entries(rows).slice(-MAX_ENTRIES)));
    storage.setItem(keyFor(scope), serialized);
    const persisted = storage.getItem(keyFor(scope)) === serialized;
    if (persisted) invalidatedAnchors.delete(invalidationKey);
    return { requestId, persisted };
  } catch {
    return { requestId: requestId || createId(), persisted: false };
  }
}

export function removeMonologueRecoveryId({ scope, sessionId, userAnchor, anchorId, requestId, storage = availableMonologueStorage() }) {
  const anchor = anchorKey(sessionId, userAnchor, anchorId);
  const invalidationKey = JSON.stringify([scope, anchor]);
  // Keep a local barrier when a browser can read old data but rejects removal.
  const invalidate = () => {
    invalidatedAnchors.add(invalidationKey);
    if (invalidatedAnchors.size > MAX_ENTRIES) invalidatedAnchors.delete(invalidatedAnchors.values().next().value);
  };
  if (!requestId) invalidate();
  try {
    const rows = read(storage, scope, Date.now());
    if (!rows[anchor] || (requestId && rows[anchor].requestId !== requestId)) return true;
    invalidate();
    delete rows[anchor];
    const serialized = JSON.stringify(rows);
    storage.setItem(keyFor(scope), serialized);
    const removed = storage.getItem(keyFor(scope)) === serialized;
    if (removed) invalidatedAnchors.delete(invalidationKey);
    return removed;
  } catch {
    return false;
  }
}
import { sha256 } from "@noble/hashes/sha2.js";
