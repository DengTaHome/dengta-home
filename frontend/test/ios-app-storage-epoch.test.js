import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAccountCacheVault } from "../src/account-cache-vault.js";
import { readStoredSessionChatModel, storeSessionChatModel } from "../src/chat-models.js";
import { applyStoredMessageReferences, clearStoredMessageReferencesForSession, storeMessageReferenceForMessage } from "../src/message-reference.js";
import { resolveMonologueRecoveryId, removeMonologueRecoveryId } from "../src/monologue-recovery-storage.js";
import { hydrateChatHistory } from "../src/chat-history.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const start = source.indexOf("  const privateStorage = useMemo(", source.indexOf("function App("));
const end = source.indexOf("  const [sessions, setSessions]", start);
assert.ok(start > 0 && end > start);
const hydrateStart = source.indexOf("function hydrateSessionChatHistory(");
const hydrateEnd = source.indexOf("\nfunction App(", hydrateStart);
const hydrateAccountChatHistory = new Function("applyStoredMessageReferences", "hydrateChatHistory", source.slice(hydrateStart, hydrateEnd) + "\nreturn hydrateSessionChatHistory;")(applyStoredMessageReferences, hydrateChatHistory);
const mountActualStorageBindings = new Function(
  "accountStorageScope", "accountCacheStorage", "useMemo", "useCallback",
  "readSessionModelFromStorage", "storeSessionModelInStorage", "storeReferenceInStorage", "clearReferencesInStorage",
  "resolveMonologueRecoveryFromStorage", "removeMonologueRecoveryFromStorage", "hydrateAccountChatHistory",
  source.slice(start, end) + "\nreturn { privateStorage, privateSessionStorage, readStoredSessionChatModel, storeSessionChatModel, storeMessageReferenceForMessage, clearStoredMessageReferencesForSession, hydrateSessionChatHistory };",
);

function fixture() {
  const disk = new Map();
  const vault = createAccountCacheVault({ isNative: true, plugin: {
    async read({ accountId }) { return { value: disk.get(accountId) ?? null }; },
    async write({ accountId, value }) { disk.set(accountId, value); },
    async clear({ accountId }) { disk.delete(accountId); },
  } });
  const mount = account => mountActualStorageBindings(
    account, vault.accountCacheStorage, factory => factory(), callback => callback,
    readStoredSessionChatModel, storeSessionChatModel, storeMessageReferenceForMessage, clearStoredMessageReferencesForSession,
    resolveMonologueRecoveryId, removeMonologueRecoveryId, hydrateAccountChatHistory,
  );
  return { disk, vault, mount };
}

test("actual App bindings keep model and quote metadata inside the captured account vault", async () => {
  const { vault, mount } = fixture();
  await vault.prepareAccountCache(A); await vault.prepareAccountCache(B);
  const a = mount(A), b = mount(B);
  const quote = { message_id: "17", role: "user", text: "fictional private quote" };
  a.storeSessionChatModel("23", "fictional-model-a");
  a.storeMessageReferenceForMessage("23", "19", quote);
  assert.equal(a.readStoredSessionChatModel("23"), "fictional-model-a");
  assert.equal(b.readStoredSessionChatModel("23"), "");
  assert.equal(a.hydrateSessionChatHistory([{ id: "19", role: "assistant", content: "reply" }], "23")[0].tool_calls.message_reference.text, quote.text);
  assert.equal(b.hydrateSessionChatHistory([{ id: "19", role: "assistant", content: "reply" }], "23")[0].tool_calls?.message_reference, undefined);
  assert.equal(a.privateSessionStorage, a.privateStorage, "native receipt metadata also uses this account's protected vault");
  await vault.flushAccountCache(A);
});

test("actual old App callbacks cannot write into B or the same account after logout and login again", async () => {
  const { vault, mount } = fixture();
  await vault.prepareAccountCache(A); const oldA = mount(A);
  oldA.storeSessionChatModel("23", "old-model");
  vault.sealAccountCache(A);
  await vault.purgeAccountCache(A);
  await vault.prepareAccountCache(B); const b = mount(B);
  b.storeSessionChatModel("23", "model-b");
  await vault.prepareAccountCache(A); const newA = mount(A);
  newA.storeSessionChatModel("23", "new-model-a");
  oldA.storeSessionChatModel("23", "late-old-a");
  oldA.clearStoredMessageReferencesForSession("23");
  assert.throws(() => oldA.privateSessionStorage.setItem("late-music-receipt", "private"), { code: "account_cache_scope_changed" });
  assert.equal(b.readStoredSessionChatModel("23"), "model-b");
  assert.equal(newA.readStoredSessionChatModel("23"), "new-model-a");
  assert.equal(oldA.readStoredSessionChatModel("23"), "");
  assert.equal(newA.privateStorage.getItem("late-music-receipt"), null);
  await vault.flushAccountCache(A); await vault.flushAccountCache(B);
});
