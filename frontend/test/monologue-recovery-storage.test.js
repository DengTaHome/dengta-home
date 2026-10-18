import assert from "node:assert/strict";
import test from "node:test";
import { availableMonologueStorage, resolveMonologueRecoveryId, removeMonologueRecoveryId } from "../src/monologue-recovery-storage.js";

const scope = JSON.stringify(["fixture-account", "fixture-companion"]);
const sessionId = "11111111-1111-4111-8111-111111111111";
const otherSession = "22222222-2222-4222-8222-222222222222";
const base = { scope, sessionId, userAnchor: false, anchorId: "42", model: "fictional-private-model",
  companionStatus: { mood: "fictional-private-mood", energyLevel: 50, focus: "fictional-private-focus", microState: "fictional-private-state" },
  createId: () => crypto.randomUUID(), now: 1_000_000 };
function memoryStorage() {
  const rows = new Map();
  return { rows, getItem: key => rows.get(key) || null, setItem: (key, value) => rows.set(key, value) };
}

test("reopened same input reuses UUID; storage contains only bounded non-text metadata", async () => {
  const storage = memoryStorage();
  const first = await resolveMonologueRecoveryId({ ...base, storage });
  const reopened = await resolveMonologueRecoveryId({ ...base, storage, now: base.now + 50 });
  assert.equal(first.persisted, true); assert.equal(reopened.requestId, first.requestId);
  const serialized = [...storage.rows.values()][0];
  assert.ok(!serialized.includes("fictional-private"));
  const row = Object.values(JSON.parse(serialized))[0];
  assert.deepEqual(Object.keys(row).sort(), ["createdAt", "fingerprint", "requestId"]);
  assert.match(row.fingerprint, /^[a-f0-9]{64}$/);
});

test("model and actual state input changes rotate IDs, countdown-only changes do not", async () => {
  const storage = memoryStorage();
  const first = await resolveMonologueRecoveryId({ ...base, storage });
  const timer = await resolveMonologueRecoveryId({ ...base, storage, companionStatus: { ...base.companionStatus, countdown: { remainingSeconds: 1 } } });
  assert.equal(first.requestId, timer.requestId);
  for (const variant of [{ model: "another-model" }, ...["mood", "energyLevel", "focus", "microState"].map(key => ({ companionStatus: { ...base.companionStatus, [key]: "changed" } }))]) {
    const changed = await resolveMonologueRecoveryId({ ...base, storage, ...variant });
    assert.notEqual(changed.requestId, first.requestId);
    await resolveMonologueRecoveryId({ ...base, storage });
  }
});

test("different accounts, companions, sessions and anchor roles never share recovery IDs", async () => {
  const storage = memoryStorage();
  const variants = [{}, { scope: JSON.stringify(["other-account", "fixture-companion"]) },
    { scope: JSON.stringify(["fixture-account", "other-companion"]) }, { sessionId: otherSession },
    { userAnchor: true }, { anchorId: "43" }];
  const ids = [];
  for (const variant of variants) ids.push((await resolveMonologueRecoveryId({ ...base, storage, ...variant })).requestId);
  assert.equal(new Set(ids).size, variants.length);
});

test("exact invalidation preserves other anchors and ignores an old operation's cleanup", async () => {
  const storage = memoryStorage(), now = Date.now();
  const first = await resolveMonologueRecoveryId({ ...base, storage, now });
  const second = await resolveMonologueRecoveryId({ ...base, storage, now, userAnchor: true });
  assert.equal(removeMonologueRecoveryId({ ...base, storage, requestId: crypto.randomUUID() }), true);
  assert.equal((await resolveMonologueRecoveryId({ ...base, storage, now })).requestId, first.requestId);
  assert.equal(removeMonologueRecoveryId({ ...base, storage, requestId: first.requestId }), true);
  assert.notEqual((await resolveMonologueRecoveryId({ ...base, storage, now })).requestId, first.requestId);
  assert.equal((await resolveMonologueRecoveryId({ ...base, storage, now, userAnchor: true })).requestId, second.requestId);
});

test("expired and corrupt entries rotate safely; quota, blocked and silent writes are reported", async () => {
  const storage = memoryStorage();
  const first = await resolveMonologueRecoveryId({ ...base, storage });
  const expired = await resolveMonologueRecoveryId({ ...base, storage, now: base.now + 24 * 60 * 60 * 1000 + 1 });
  assert.notEqual(expired.requestId, first.requestId);
  storage.rows.set([...storage.rows.keys()][0], "not-json");
  assert.equal((await resolveMonologueRecoveryId({ ...base, storage })).persisted, true);
  for (const [failing, removable] of [
    [{ getItem: () => null, setItem() { throw new DOMException("synthetic quota", "QuotaExceededError"); } }, true],
    [{ getItem() { throw new DOMException("synthetic blocked", "SecurityError"); }, setItem() {} }, false],
    [{ getItem: () => null, setItem() {} }, true], [null, true],
  ]) {
    const result = await resolveMonologueRecoveryId({ ...base, storage: failing });
    assert.equal(result.persisted, false); assert.match(result.requestId, /^[a-f0-9-]{36}$/);
    assert.equal(removeMonologueRecoveryId({ ...base, storage: failing }), removable);
  }
});

test("malformed row extras are discarded and one scope stores at most 128 entries", async () => {
  const storage = memoryStorage();
  for (let index = 1; index <= 135; index++) await resolveMonologueRecoveryId({ ...base, storage, anchorId: String(index) });
  assert.equal(Object.keys(JSON.parse([...storage.rows.values()][0])).length, 128);
});

test("a blocked browser localStorage getter safely degrades without exposing its error", async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('Synthetic blocked access', 'SecurityError'); } });
    assert.equal(availableMonologueStorage(), null);
    assert.equal((await resolveMonologueRecoveryId(base)).persisted, false);
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete globalThis.localStorage;
  }
});

test("failed invalidation cannot reuse stale durable IDs in the same open application", async () => {
  const rows = new Map(); let writable = true;
  const storage = { getItem: key => rows.get(key) || null, setItem(key, value) { if (writable) rows.set(key, value); } };
  const options = { ...base, now: Date.now(), storage };
  const original = await resolveMonologueRecoveryId(options);
  writable = false;
  assert.equal(removeMonologueRecoveryId(options), false);
  const next = await resolveMonologueRecoveryId(options);
  assert.notEqual(next.requestId, original.requestId); assert.equal(next.persisted, false);
});
