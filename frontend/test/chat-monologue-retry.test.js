import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  appendThinkingStatus,
  mergeStreamedAssistantMessage,
  restartStreamedAssistantMessage,
} from "../src/chat-thinking.js";
import {
  VISIBLE_MONOLOGUE_SOURCE,
  beginVisibleMonologueStream,
  canRequestVisibleMonologue,
  innerMonologueForMessage,
  readInnerMonologues,
  removeStoredInnerMonologue,
  storeInnerMonologue,
  visibleMonologueForMessage,
} from "../src/inner-monologue.js";
import { isSynchronizedChatMessage, recoverSynchronizedAssistantMessage } from "../src/inner-monologue-sync.js";
import { createMonologueRequestOperation } from "../src/monologue-request-lifecycle.js";
import { resolveMonologueRecoveryId, removeMonologueRecoveryId } from "../src/monologue-recovery-storage.js";
import { createScopedSettingsSession, settingsSaveScope } from "../src/settings-save-scope.js";

const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const localAssistantId = "local-assistant-retry-fixture";
const sessionId = "11111111-1111-4111-8111-111111111111";
const snapshot = (state, text, extra = {}) => ({ source: VISIBLE_MONOLOGUE_SOURCE, state, text, ...extra });
const failureFields = {
  chatError: true, partialContent: "Earlier temporary reply", error_code: "fixture_error",
  error_location: "fixture", error_log_id: "fixture-log", error_source: "fixture-source",
  provider_code: "fixture-code", provider_phase: "event", upstream_status: 502,
  error_time: "2026-10-15T00:00:00Z", monologueAutoOpen: true, monologueUserMessageId: "42",
};
const previous = Object.freeze({
  id: localAssistantId, role: "assistant", conversation_id: sessionId, content: "Earlier error",
  ...failureFields,
  thinkingSummary: "Earlier provider summary", thinkingSummarySource: "provider_summary",
  visibleMonologue: snapshot("failed", "Earlier partial monologue"),
  tool_calls: Object.freeze({
    visible_monologue: snapshot("complete", "Earlier supplement", { generated_with_reply: false }),
    resolved_model: "fixture-model", fixture_receipt: { id: "keep" },
  }),
});

test("actual App retry draft removes failure and old supplement metadata without mutating other tool receipts", () => {
  const start = source.indexOf("        const assistantDraft = {");
  const end = source.indexOf("        return next;", start);
  assert.ok(start >= 0 && end > start);
  const [draft] = new Function(
    "next", "localAssistantId", "sessionId", "appendThinkingStatus",
    "beginVisibleMonologueStream", "restartStreamedAssistantMessage",
    `${source.slice(start, end)}return next;`,
  )([previous], localAssistantId, sessionId, appendThinkingStatus, beginVisibleMonologueStream, restartStreamedAssistantMessage);
  for (const key of Object.keys(failureFields)) assert.equal(Object.hasOwn(draft, key), false, key);
  assert.equal(draft.isStreaming, true);
  assert.equal(draft.content, "");
  assert.equal(draft.thinkingSummary, undefined);
  assert.equal(draft.thinkingSummarySource, undefined);
  assert.equal(visibleMonologueForMessage(draft).state, "streaming");
  assert.equal(visibleMonologueForMessage(draft).text, "");
  assert.equal(draft.tool_calls.visible_monologue, undefined);
  assert.equal(draft.tool_calls.fixture_receipt, previous.tool_calls.fixture_receipt);
  assert.equal(draft.tool_calls.resolved_model, "fixture-model");
  assert.equal(previous.tool_calls.visible_monologue.text, "Earlier supplement");
  assert.equal(previous.chatError, true);
});

test("successful server reply clears failure flags and keeps its authoritative monologue", () => {
  const authoritative = snapshot("complete", "Current synchronized monologue", { generated_with_reply: true });
  const server = { id: "43", role: "assistant", content: "Current saved reply", tool_calls: { visible_monologue: authoritative, fixture_saved: true } };
  const done = mergeStreamedAssistantMessage(previous, server);
  for (const key of Object.keys(failureFields)) assert.equal(Object.hasOwn(done, key), false, key);
  assert.equal(done.content, server.content);
  assert.equal(done.isStreaming, false);
  assert.equal(visibleMonologueForMessage(done).text, authoritative.text);
  assert.equal(done.tool_calls.fixture_saved, true);
});

test("successful legacy reply without a monologue snapshot keeps current streamed text instead of an old supplement", () => {
  const live = { ...previous, visibleMonologue: snapshot("streaming", "Current received monologue") };
  const done = mergeStreamedAssistantMessage(live, { id: "43", content: "Saved reply" });
  assert.equal(done.chatError, undefined);
  assert.equal(done.partialContent, undefined);
  assert.equal(done.tool_calls.visible_monologue, undefined);
  assert.equal(done.tool_calls.fixture_receipt, previous.tool_calls.fixture_receipt);
  assert.equal(visibleMonologueForMessage(done).text, "Current received monologue");
  assert.equal(visibleMonologueForMessage(done).state, "missing");
});

test("actual App retry cancellation discards late supplement receipts and only removes the retried message cache", async () => {
  const functionStart = source.indexOf("  async function requestVisibleInnerMonologue(item)");
  const functionEnd = source.indexOf("  async function processCompanionInteractionQueue()", functionStart);
  const handler = source.slice(functionStart, functionEnd).replace(
    /const \{ recoverSynchronizedAssistantMessage \} = await import\(\s*"\.\/inner-monologue-sync\.js"\s*\);/, "",
  );
  const cancelStart = source.indexOf("      const previousSupplement = innerMonologueRequestsRef.current.get(String(localAssistantId));");
  const cancelEnd = source.indexOf("      streamingSessionIdRef.current = sessionId;", cancelStart);
  assert.ok(cancelStart >= 0 && cancelEnd > cancelStart);
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  storeInnerMonologue({ messageId: "unrelated", text: "Keep this cached fixture" }, storage, "account-fixture");
  const failed = { ...previous, tool_calls: { fixture_receipt: { id: "keep" } } };
  const states = { messages: [failed], pending: {}, errors: {}, monologues: readInnerMonologues(storage, "account-fixture") };
  const auth = { user: { id: "account-fixture" }, activeCompanionId: "companion-fixture" };
  let release;
  const env = {
    canRequestVisibleMonologue, innerMonologueForMessage, storeInnerMonologue, removeStoredInnerMonologue,
    resolveMonologueRecoveryId: args => resolveMonologueRecoveryId({ ...args, storage }),
    removeMonologueRecoveryId: args => removeMonologueRecoveryId({ ...args, storage }),
    availableMonologueStorage: () => storage,
    VISIBLE_MONOLOGUE_SOURCE, isSynchronizedChatMessage, recoverSynchronizedAssistantMessage, createMonologueRequestOperation,
    createScopedSettingsSession, settingsSaveScope,
    createCompanionInteractionEventId: () => crypto.randomUUID(),
    innerMonologueRequestsRef: { current: new Map() }, innerMonologueRecoveryAttemptsRef: { current: new Map() },
    innerMonologueRequestScopeRef: { current: { active: true } },
    activeSessionIdRef: { current: sessionId }, privateMediaScope: settingsSaveScope(auth),
    authSession: { getSnapshot: () => auth }, innerMonologues: {},
    accountStorageScope: "account-fixture", selectedChatModel: "fixture-model", settings: {},
    companionStatusRef: { current: {} }, companionStatusForRequest: value => value,
    readStoredSessionChatModel: () => "", flushLatestSettingsDraft: async () => true,
    recordOperationFailure() {}, localAssistantId, sessionId, completedUserMessageId: "42",
    globalThis: { localStorage: storage },
    async apiRequest(_path, options) {
      const body = JSON.parse(options.body);
      await new Promise(resolve => { release = resolve; });
      return { session_id: sessionId, user_message_id: "42", inner_monologue: "Late supplementary fixture", recovery_request_id: body.recovery_request_id };
    },
  };
  for (const [setter, key] of Object.entries({ setMessages: "messages", setInnerMonologuePending: "pending", setInnerMonologueErrors: "errors", setInnerMonologues: "monologues" })) {
    env[setter] = update => { states[key] = typeof update === "function" ? update(states[key]) : update; };
  }
  const run = new Function("env", `with(env) { ${handler}; return requestVisibleInnerMonologue; }`)(env);
  const pending = run(failed);
  await new Promise(resolve => globalThis.setImmediate(resolve));
  const operation = env.innerMonologueRequestsRef.current.get(localAssistantId);
  assert.ok(operation);
  env.innerMonologueRequestsRef.current.set("same-operation-alias", operation);
  const unrelated = { controller: new AbortController() };
  env.innerMonologueRequestsRef.current.set("unrelated", unrelated);
  storeInnerMonologue({ messageId: localAssistantId, text: "Old cached retry fixture" }, storage, "account-fixture");
  states.monologues = readInnerMonologues(storage, "account-fixture");
  new Function("env", `with(env) { ${source.slice(cancelStart, cancelEnd)} }`)(env);
  states.messages = [{ id: localAssistantId, role: "assistant", isStreaming: true, visibleMonologue: snapshot("streaming", "Current retry monologue") }];
  const before = JSON.stringify(states);
  assert.equal(operation.controller.signal.aborted, true);
  assert.equal(env.innerMonologueRequestsRef.current.has(localAssistantId), false);
  assert.equal(env.innerMonologueRequestsRef.current.has("same-operation-alias"), false);
  assert.equal(env.innerMonologueRequestsRef.current.get("unrelated"), unrelated);
  assert.equal(unrelated.controller.signal.aborted, false);
  assert.equal(env.innerMonologueRecoveryAttemptsRef.current.size, 0);
  assert.equal(readInnerMonologues(storage, "account-fixture")[localAssistantId], undefined);
  assert.equal(readInnerMonologues(storage, "account-fixture").unrelated.text, "Keep this cached fixture");
  release();
  await pending;
  assert.equal(JSON.stringify(states), before);
  assert.equal(visibleMonologueForMessage(states.messages[0]).text, "Current retry monologue");
});

test("primary retry invalidates settled failed supplement IDs for both exact anchors without another active operation", async () => {
  const start = source.indexOf("      const previousSupplement = innerMonologueRequestsRef.current.get(String(localAssistantId));");
  const end = source.indexOf("      if (previousSupplement)", start);
  assert.ok(start >= 0 && end > start);
  const scope = "account-fixture:companion-fixture";
  const key = (targetScope, conversationId, userAnchor, anchorId) =>
    JSON.stringify([targetScope, conversationId, userAnchor, anchorId]);
  const affected = [
    key(scope, sessionId, false, localAssistantId),
    key(scope, sessionId, true, "42"),
  ];
  const unrelated = [
    key("different-account:companion-fixture", sessionId, true, "42"),
    key(scope, "different-conversation", true, "42"),
    key(scope, sessionId, true, "43"),
    key(scope, sessionId, false, "42"),
  ];
  const attempts = new Map([...affected, ...unrelated].map((value, index) => [value, { requestId: index }]));
  const values = new Map(), storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const stored = { scope, sessionId, model: 'fixture-model', companionStatus: {}, createId: () => crypto.randomUUID(), storage };
  const assistant = await resolveMonologueRecoveryId({ ...stored, userAnchor: false, anchorId: localAssistantId });
  const user = await resolveMonologueRecoveryId({ ...stored, userAnchor: true, anchorId: '42' });
  const keep = await resolveMonologueRecoveryId({ ...stored, userAnchor: false, anchorId: '42' });
  const env = {
    removeMonologueRecoveryId: args => removeMonologueRecoveryId({ ...args, storage }),
    innerMonologueRequestsRef: { current: new Map() },
    innerMonologueRecoveryAttemptsRef: { current: attempts },
    privateMediaScope: scope, sessionId, localAssistantId, completedUserMessageId: "42",
  };
  new Function("env", "with(env) {" + source.slice(start, end) + "}")(env);
  assert.deepEqual([...attempts.keys()], unrelated);
  assert.notEqual((await resolveMonologueRecoveryId({ ...stored, userAnchor: false, anchorId: localAssistantId })).requestId, assistant.requestId);
  assert.notEqual((await resolveMonologueRecoveryId({ ...stored, userAnchor: true, anchorId: '42' })).requestId, user.requestId);
  assert.equal((await resolveMonologueRecoveryId({ ...stored, userAnchor: false, anchorId: '42' })).requestId, keep.requestId);
});
