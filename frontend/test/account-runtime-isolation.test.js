import assert from "node:assert/strict";
import test from "node:test";
import { Capacitor } from "@capacitor/core";
import { createAccountCacheVault } from "../src/account-cache-vault.js";
import {
  captureAccountRuntimeEpoch, clearAccountLegacyData, clearAccountRuntimeData,
  isAccountRuntimeCurrent, prepareAccountRuntimeData,
} from "../src/account-cleanup.js";
import { createImportAttempt, importAttemptPrefix, readImportAttempts, saveImportAttempt, clearImportAttempt } from "../src/import-attempt-receipt.js";
import { captureOperationFailureScope, diagnosticScopeKey, readOperationFailures, recordOperationFailure } from "../src/operation-diagnostics.js";
import { createMusicAnalysisRecovery } from "../src/music-understanding-ui.js";
import { readGuidePreferences, saveGuidePreferences, guideStorageKey } from "../src/achievement-guide.js";
import { readThemePreferences, writeThemePreferences } from "../src/dengta-theme.js";

const A = "a1111111-1111-4111-8111-111111111111";
const B = "b2222222-2222-4222-8222-222222222222";
const C = "c3333333-3333-4333-8333-333333333333";
const scope = account => JSON.stringify([account, C]);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function storage(initial = []) {
  const values = new Map(initial);
  return { values, get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
const cleanupOptions = extra => ({ localStorage: null, sessionStorage: null, purgeAccountCache: async () => {}, sealAccountCache: () => {},
  workspaceCacheClearLegacy: async () => {}, stopVoiceSpeech: async () => {}, ...extra });

test("exit seals synchronously, removes only exact legacy owners, and completes all cleaners despite one failure", async () => {
  prepareAccountRuntimeData(A);
  const ticket = captureAccountRuntimeEpoch(A), block = deferred(), events = [];
  const aKey = `dengta_chat_draft_v2:${scope(A)}`, bKey = `dengta_chat_draft_v2:${scope(B)}`;
  const local = storage([[aKey, "fictional-a"], [bKey, "fictional-b"], ["dengta_home_auth_v1", "fictional-token"],
    ["dengta.font-mode.v1", "system"], ["dengta_message_references_v1", "unowned"]]);
  local.getItem = () => { throw new Error("cleanup must enumerate keys without reading token values"); };
  const promise = clearAccountRuntimeData(A, cleanupOptions({ localStorage: local,
    sealAccountCache: () => events.push("seal"),
    cleanupCallbacks: [() => { events.push("memory"); throw new Error("fixture failure"); }],
    purgeAccountCache: () => { events.push("vault"); return block.promise; },
    workspaceCacheClearLegacy: async () => events.push("workspace"), stopVoiceSpeech: async () => events.push("voice"),
  }));
  assert.deepEqual(events, ["seal", "memory"]);
  assert.equal(isAccountRuntimeCurrent(ticket), false);
  assert.equal(local.values.has(aKey), false);
  assert.equal(local.values.has("dengta_message_references_v1"), false);
  assert.equal(local.values.get(bKey), "fictional-b");
  assert.equal(local.values.get("dengta_home_auth_v1"), "fictional-token");
  assert.equal(local.values.get("dengta.font-mode.v1"), "system");
  block.resolve();
  await assert.rejects(promise, { code: "account_cleanup_failed" });
  assert.ok(["vault", "workspace", "voice"].every(event => events.includes(event)));
  prepareAccountRuntimeData(A);
  assert.equal(isAccountRuntimeCurrent(ticket), false, "logging back in cannot revive a pre-exit ticket");
});

test("first iOS hydration removes legacy data without retiring the current account or touching its encrypted cache", async () => {
  prepareAccountRuntimeData(A);
  const before = captureAccountRuntimeEpoch(A);
  const local = storage([[`dengta-xhs-sticker-import:${scope(A)}`, "fictional-a"], [`dengta-xhs-sticker-import:${scope(B)}`, "fictional-b"],
    ["dengta.cast.receiver-token.v1", "fictional-old-receiver"], ["dengta_home_auth_v1", "fictional-token"]]);
  const calls = [];
  await clearAccountLegacyData(A, { localStorage: local, sessionStorage: null, workspaceCacheClearLegacy: async account => calls.push(account) });
  assert.deepEqual(calls, [A]);
  assert.equal(isAccountRuntimeCurrent(before), true);
  assert.equal(local.values.has(`dengta-xhs-sticker-import:${scope(A)}`), false);
  assert.equal(local.values.has(`dengta-xhs-sticker-import:${scope(B)}`), true);
  assert.equal(local.values.has("dengta.cast.receiver-token.v1"), false);
  assert.equal(local.values.get("dengta_home_auth_v1"), "fictional-token");
  await assert.rejects(clearAccountLegacyData(A, { localStorage: null, sessionStorage: null,
    workspaceCacheClearLegacy: async () => { throw new Error("fixture failure"); } }), { code: "account_legacy_cleanup_failed" });
});

test("old login import, diagnostics, and music callbacks remain stale after the same account logs in again", async () => {
  prepareAccountRuntimeData(A);
  const prefix = importAttemptPrefix(A, C), oldAttempt = createImportAttempt("old", "chat_history", A);
  const diagnostics = captureOperationFailureScope(diagnosticScopeKey(A, C));
  const recovery = createMusicAnalysisRecovery({ accountScope: A, companionScope: C }, "123");
  const operation = recovery.begin();
  recordOperationFailure(diagnostics, "/api/v2/settings", new Error("fixture"));
  assert.equal(readOperationFailures(scope(A)).length, 1);
  await clearAccountRuntimeData(A, cleanupOptions());
  prepareAccountRuntimeData(A);
  assert.equal(saveImportAttempt(prefix, oldAttempt, storage()), false);
  assert.equal(recordOperationFailure(diagnostics, "/api/v2/settings", new Error("late fixture")), null);
  assert.equal(captureOperationFailureScope(diagnostics), diagnostics);
  assert.equal(recordOperationFailure(captureOperationFailureScope(diagnostics), "/api/v2/settings", new Error("recaptured late fixture")), null);
  assert.equal(readOperationFailures(scope(A)).length, 0);
  assert.equal(recovery.begin(), null);
  recovery.confirm(operation);
  assert.equal(recovery.getSnapshot(), null);
  const fresh = captureOperationFailureScope(scope(A));
  assert.ok(recordOperationFailure(fresh, "/api/v2/settings", new Error("new fixture")));
  assert.equal(readOperationFailures(diagnostics).length, 0);
});

test("a sealed import facade cannot read, overwrite, or remove receipts belonging to a new login of the same account", async () => {
  const vault = createAccountCacheVault({ isNative: true, plugin: {
    read: async () => ({ value: null }), write: async () => {}, clear: async () => {},
  } });
  prepareAccountRuntimeData(A);
  const old = await vault.prepareAccountCache(A), prefix = importAttemptPrefix(A, C);
  saveImportAttempt(prefix, createImportAttempt("shared", "chat_history", A), old);
  vault.sealAccountCache(A);
  await clearAccountRuntimeData(A, cleanupOptions());
  await vault.purgeAccountCache(A);
  prepareAccountRuntimeData(A);
  const fresh = await vault.prepareAccountCache(A);
  const current = createImportAttempt("shared", "world_book", A);
  assert.equal(saveImportAttempt(prefix, current, fresh), true);
  assert.deepEqual(readImportAttempts(prefix, old), []);
  assert.equal(saveImportAttempt(prefix, createImportAttempt("late", "chat_history", A), old), false);
  assert.equal(clearImportAttempt(prefix, "shared", old), false);
  assert.deepEqual(readImportAttempts(prefix, fresh).map(row => [row.importId, row.kind]), [["shared", "world_book"]]);
});

test("native theme and guide helpers do not evaluate a plaintext storage getter when their vault is unavailable", () => {
  const originalPlatform = Capacitor.getPlatform;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let plaintextReads = 0;
  try {
    Capacitor.getPlatform = () => "ios";
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { plaintextReads++; throw new Error("forbidden"); } });
    readThemePreferences(undefined, B);
    writeThemePreferences({}, undefined, B);
    readGuidePreferences(guideStorageKey(B, C));
    saveGuidePreferences(guideStorageKey(B, C), { collapsed: false });
    assert.equal(plaintextReads, 0);
  } finally {
    Capacitor.getPlatform = originalPlatform;
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else delete globalThis.localStorage;
  }
});
