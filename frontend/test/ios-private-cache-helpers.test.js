import assert from "node:assert/strict";
import test from "node:test";
import { Capacitor } from "@capacitor/core";
import { createAccountCacheVault } from "../src/account-cache-vault.js";
import { readStoredChatModel, readStoredSessionChatModel, storeChatModel, storeSessionChatModel } from "../src/chat-models.js";
import { createMessageReference, storeMessageReferenceForMessage, applyStoredMessageReferences } from "../src/message-reference.js";
import { readInnerMonologues, storeInnerMonologue } from "../src/inner-monologue.js";
import { availableMonologueStorage, clearMonologueRecoveryMemory, resolveMonologueRecoveryId, removeMonologueRecoveryId } from "../src/monologue-recovery-storage.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const COMPANION = "44444444-4444-4444-8444-444444444444";

function vaultFixture() {
  const values = new Map();
  const vault = createAccountCacheVault({ isNative: true, plugin: {
    async read({ accountId }) { return { value: values.get(accountId) ?? null }; },
    async write({ accountId, value }) { values.set(accountId, value); },
    async clear({ accountId }) { values.delete(accountId); },
  } });
  return { values, vault };
}

test("same session/message identifiers stay separate in captured account vaults and late writes cannot repopulate a sealed owner", async () => {
  const { values, vault } = vaultFixture();
  const storageA = await vault.prepareAccountCache(ACCOUNT_A);
  const storageB = await vault.prepareAccountCache(ACCOUNT_B);
  const reference = text => createMessageReference({ id: "7", role: "assistant", content: text });
  storeSessionChatModel("42", "fictional-model-a", storageA);
  storeSessionChatModel("42", "fictional-model-b", storageB);
  storeMessageReferenceForMessage("42", "8", reference("FICTIONAL_REFERENCE_A"), storageA);
  storeMessageReferenceForMessage("42", "8", reference("FICTIONAL_REFERENCE_B"), storageB);
  storeInnerMonologue({ messageId: "8", text: "FICTIONAL_MONOLOGUE_A" }, storageA, ACCOUNT_A);
  storeInnerMonologue({ messageId: "8", text: "FICTIONAL_MONOLOGUE_B" }, storageB, ACCOUNT_B);
  await Promise.all([vault.flushAccountCache(ACCOUNT_A), vault.flushAccountCache(ACCOUNT_B)]);
  assert.equal(readStoredSessionChatModel("42", storageA), "fictional-model-a");
  assert.equal(readStoredSessionChatModel("42", storageB), "fictional-model-b");
  assert.equal(applyStoredMessageReferences([{ id: "8" }], "42", storageA)[0].tool_calls.message_reference.text, "FICTIONAL_REFERENCE_A");
  assert.equal(applyStoredMessageReferences([{ id: "8" }], "42", storageB)[0].tool_calls.message_reference.text, "FICTIONAL_REFERENCE_B");
  assert.equal(readInnerMonologues(storageB, ACCOUNT_B)["8"].text, "FICTIONAL_MONOLOGUE_B");
  assert.ok(!values.get(ACCOUNT_B).includes("FICTIONAL_REFERENCE_A"));
  const durableB = values.get(ACCOUNT_B);
  vault.sealAccountCache(ACCOUNT_A);
  assert.equal(readStoredSessionChatModel("42", storageA), "");
  assert.equal(applyStoredMessageReferences([{ id: "8" }], "42", storageA)[0].tool_calls, undefined);
  assert.deepEqual(readInnerMonologues(storageA, ACCOUNT_A), {});
  storeSessionChatModel("42", "FICTIONAL_LATE_A", storageA);
  storeMessageReferenceForMessage("42", "8", reference("FICTIONAL_LATE_A"), storageA);
  storeInnerMonologue({ messageId: "8", text: "FICTIONAL_LATE_A" }, storageA, ACCOUNT_A);
  await vault.purgeAccountCache(ACCOUNT_A);
  assert.equal(values.has(ACCOUNT_A), false);
  assert.equal(values.get(ACCOUNT_B), durableB);
});

test("iOS helpers never read legacy plaintext storage or silently fall back when the account vault is absent", async () => {
  const originalPlatform = Capacitor.getPlatform;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let plaintextReads = 0, plaintextWrites = 0;
  const plaintext = {
    getItem() { plaintextReads++; return '{"42":"FICTIONAL_UNOWNED_MODEL"}'; },
    setItem() { plaintextWrites++; }, removeItem() { plaintextWrites++; },
  };
  try {
    Capacitor.getPlatform = () => "ios";
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { plaintextReads++; return plaintext; } });
    assert.equal(readStoredSessionChatModel("42", plaintext), "");
    assert.equal(readStoredChatModel(plaintext, ACCOUNT_A), "");
    storeSessionChatModel("42", "model", plaintext);
    storeChatModel("model", plaintext, ACCOUNT_A);
    const reference = createMessageReference({ id: "7", role: "assistant", content: "FICTIONAL_REFERENCE" });
    storeMessageReferenceForMessage("42", "8", reference, plaintext);
    assert.equal(applyStoredMessageReferences([{ id: "8" }], "42", plaintext)[0].tool_calls, undefined);
    assert.deepEqual(readInnerMonologues(plaintext, ACCOUNT_A), {});
    storeInnerMonologue({ messageId: "8", text: "FICTIONAL_MONOLOGUE" }, plaintext, ACCOUNT_A);
    assert.equal(availableMonologueStorage(), null);
    const recovery = await resolveMonologueRecoveryId({ scope: JSON.stringify([ACCOUNT_A, COMPANION]), sessionId: SESSION, anchorId: "8", createId: () => crypto.randomUUID(), storage: plaintext });
    assert.equal(recovery.persisted, false);
    assert.equal(plaintextReads, 0);
    assert.equal(plaintextWrites, 0);
  } finally {
    Capacitor.getPlatform = originalPlatform;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else delete globalThis.localStorage;
  }
});

test("monologue recovery memory purge parses the exact account boundary and preserves other owners", async () => {
  const rows = new Map();
  let writable = true;
  const storage = { getItem: key => rows.get(key) ?? null, setItem(key, value) { if (writable) rows.set(key, value); } };
  const options = account => ({ scope: JSON.stringify([account, COMPANION]), sessionId: SESSION, anchorId: "8", model: "fixture-model", now: Date.now(), storage, createId: () => crypto.randomUUID() });
  const a = options("fixture-owner"), b = options("fixture-owner-extra");
  const savedA = await resolveMonologueRecoveryId(a), savedB = await resolveMonologueRecoveryId(b);
  writable = false;
  assert.equal(removeMonologueRecoveryId(a), false);
  assert.equal(removeMonologueRecoveryId(b), false);
  assert.equal(clearMonologueRecoveryMemory("fixture-owner"), 1);
  assert.equal((await resolveMonologueRecoveryId(a)).requestId, savedA.requestId);
  assert.notEqual((await resolveMonologueRecoveryId(b)).requestId, savedB.requestId);
  assert.equal(clearMonologueRecoveryMemory("fixture-owner-extra"), 1);
  assert.equal(clearMonologueRecoveryMemory(""), 0);
});
