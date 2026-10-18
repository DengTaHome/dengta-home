import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isSynchronizedChatMessage, recoverSynchronizedAssistantMessage } from '../src/inner-monologue-sync.js';
import { VISIBLE_MONOLOGUE_SOURCE, canRequestVisibleMonologue, innerMonologueForMessage, storeInnerMonologue } from '../src/inner-monologue.js';
import { createScopedSettingsSession, settingsSaveScope } from '../src/settings-save-scope.js';
import { recordOperationFailure, readOperationFailures, clearOperationFailures } from '../src/operation-diagnostics.js';
import { createMonologueRequestOperation } from '../src/monologue-request-lifecycle.js';
import { resolveMonologueRecoveryId, removeMonologueRecoveryId } from '../src/monologue-recovery-storage.js';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  async function requestVisibleInnerMonologue(item)');
const end = source.indexOf('  async function processCompanionInteractionQueue()', start);
assert.ok(start >= 0 && end > start);
const handler = source.slice(start, end).replace(
  /const \{ recoverSynchronizedAssistantMessage \} = await import\(\s*"\.\/inner-monologue-sync\.js"\s*\);/,
  '',
);
const messageId = '019c0000-0000-7000-8000-000000000001';
const sessionId = '11111111-1111-4111-8111-111111111111';
const message = { id: messageId, role: 'assistant', content: 'Fictional reply.', conversation_id: sessionId };
const receipt = { message_id: messageId, session_id: sessionId, conversation_id: sessionId, inner_monologue: 'Fictional visible monologue.' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => globalThis.setImmediate(resolve));

function harness({ api = async () => receipt, flush = async () => true, items = [message], clock, storage: providedStorage } = {}) {
  const writes = [], calls = [], states = { messages: items, pending: {}, errors: {}, monologues: {} };
  const values = new Map();
  const storage = providedStorage || { getItem: key => values.get(key) || null, setItem: (key, value) => {
    values.set(key, value);
    if (key.startsWith('dengta_visible_inner_monologues_v1:')) writes.push({ key, value });
  } };
  const scope = JSON.stringify(['account-a', 'companion-a']);
  let snapshot = { user: { id: 'account-a' }, activeCompanionId: 'companion-a' };
  const env = {
    canRequestVisibleMonologue, innerMonologueForMessage, storeInnerMonologue,
    resolveMonologueRecoveryId: args => resolveMonologueRecoveryId({ ...args, storage }),
    removeMonologueRecoveryId: args => removeMonologueRecoveryId({ ...args, storage }),
    availableMonologueStorage: () => storage,
    createMonologueRequestOperation: () => createMonologueRequestOperation(clock || {}),
    VISIBLE_MONOLOGUE_SOURCE, isSynchronizedChatMessage,
    createCompanionInteractionEventId: () => crypto.randomUUID(),
    createScopedSettingsSession, settingsSaveScope, recoverSynchronizedAssistantMessage,
    activeSessionIdRef: { current: sessionId }, privateMediaScope: scope,
    innerMonologueRequestsRef: { current: new Map() },
    innerMonologueRecoveryAttemptsRef: { current: new Map() },
    innerMonologueRequestScopeRef: { current: { active: true, generation: 1 } },
    innerMonologuePending: {}, innerMonologues: {},
    authSession: { getSnapshot: () => snapshot, getRequestContext: async () => ({ companionId: snapshot.activeCompanionId }) },
    accountStorageScope: 'account-a', selectedChatModel: 'fixture-model', settings: {},
    companionStatusRef: { current: {} }, companionStatusForRequest: value => value,
    readStoredSessionChatModel: () => '', flushLatestSettingsDraft: flush,
    recordOperationFailure,
    hydrateSessionChatHistory: value => value,
    apiRequest: async (path, options) => { calls.push({ path, options }); return api(path, options); },
    globalThis: { localStorage: storage },
  };
  for (const [setter, field] of Object.entries({ setMessages: 'messages', setInnerMonologuePending: 'pending', setInnerMonologueErrors: 'errors', setInnerMonologues: 'monologues' })) {
    env[setter] = update => { states[field] = typeof update === 'function' ? update(states[field]) : update; };
  }
  // Execute the actual App handler with controlled API/auth/state boundaries.
  const { run, cancel } = new Function('env', `with (env) { ${handler}; return {run:requestVisibleInnerMonologue,cancel:cancelVisibleInnerMonologue}; }`)(env);
  return { run, cancel, env, states, calls, writes, switchOwner() { snapshot = { user: { id: 'account-b' }, activeCompanionId: 'companion-b' }; } };
}

test('actual App lifecycle aborts pending work and clears locks on scope/session cleanup', () => {
  const match = source.match(/ {2}useLayoutEffect\(\(\) => \{\s+const lifecycle = \{[\s\S]*?\}, \[privateMediaScope, activeSessionId\]\);/);
  assert.ok(match, 'actual request lifecycle hook is present');
  const h = harness(), operation = { controller: new AbortController() };
  h.env.innerMonologueRequestsRef.current.set(messageId, operation);
  let cleanup;
  h.env.useLayoutEffect = fn => { cleanup = fn(); };
  h.env.activeSessionId = sessionId;
  new Function('env', `with (env) { ${match[0]} }`)(h.env);
  assert.equal(h.env.innerMonologueRequestScopeRef.current.active, true);
  cleanup();
  assert.equal(operation.controller.signal.aborted, true);
  assert.equal(h.env.innerMonologueRequestScopeRef.current.active, false);
  assert.equal(h.env.innerMonologueRequestsRef.current.size, 0);
});

test('same-tick supplement clicks send exactly one request and release the lock', async () => {
  const response = deferred(), h = harness({ api: () => response.promise });
  const first = h.run(message), second = h.run(message);
  await tick();
  assert.equal(h.calls.length, 1);
  response.resolve(receipt);
  await Promise.all([first, second]);
  assert.equal(h.writes.length, 1);
  assert.equal(h.env.innerMonologueRequestsRef.current.size, 0);
});

test('a sync read that finds a completed monologue updates only its local row without another generation', async () => {
  const local = { ...message, id: 'local-assistant-needs-sync' };
  const complete = { ...message, tool_calls: { visible_monologue: { source: VISIBLE_MONOLOGUE_SOURCE, text: 'Already synchronized fictional thought', state: 'complete' } } };
  const h = harness({ items: [local, { id: 'new-user-message', role: 'user', content: 'Keep current draft history' }], api: async () => ({ messages: [complete] }) });
  await h.run(local);
  assert.equal(h.calls.length, 1); assert.match(h.calls[0].path, /\/messages$/);
  assert.equal(h.writes.length, 0); assert.equal(h.states.messages[0].id, messageId);
  assert.equal(h.states.messages[0].tool_calls.visible_monologue.text, complete.tool_calls.visible_monologue.text);
  assert.equal(h.states.messages[0].monologueAutoOpen, true);
  assert.equal(h.states.messages[1].id, 'new-user-message');
  assert.equal(h.states.pending[local.id], false); assert.equal(h.env.innerMonologueRequestsRef.current.size, 0);
});

test('switching owner while settings flush waits submits no old request', async () => {
  const ready = deferred(), h = harness({ flush: () => ready.promise });
  const task = h.run(message);
  await tick();
  h.switchOwner(); ready.resolve(true); await task;
  assert.equal(h.calls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('late response after switching session writes no monologue or new UI state', async () => {
  const response = deferred(), h = harness({ api: () => response.promise });
  const task = h.run(message);
  await tick();
  h.env.activeSessionIdRef.current = 'session-b';
  const before = JSON.stringify(h.states);
  response.resolve(receipt); await task;
  assert.equal(h.writes.length, 0);
  assert.equal(JSON.stringify(h.states), before);
});

test('recovered local message never replaces newly received chat history', async () => {
  const local = { ...message, id: 'local-assistant-123' }, newer = { ...message, id: 'newer-message', content: 'New reply.' };
  const h = harness({ items: [local, newer], api: async path => path.includes('/messages') ? { messages: [message] } : receipt });
  await h.run(local);
  assert.deepEqual(h.states.messages.map(row => row.id), [messageId, 'newer-message']);
  assert.equal(h.calls[0].options.authSession.getSnapshot().user.id, 'account-a');
  assert.ok(h.calls.every(row => row.options.signal instanceof AbortSignal));
});

for (const [label, invalid] of Object.entries({ empty: { ...receipt, inner_monologue: '' }, wrongMessage: { ...receipt, message_id: 'other-message' }, wrongSession: { ...receipt, session_id: 'other-session' } })) {
  test(`${label} successful HTTP receipt is rejected without writing cache`, async () => {
    const h = harness({ api: async () => invalid });
    clearOperationFailures(h.env.privateMediaScope);
    await h.run(message);
    assert.equal(h.writes.length, 0);
    assert.match(h.states.errors[messageId] || '', /inner_monologue_receipt_invalid/);
    assert.equal(h.states.pending[messageId], false);
    const logs = readOperationFailures(h.env.privateMediaScope);
    assert.equal(logs[0].code, 'DT-MONOLOGUE');
    assert.equal(logs[0].reasonCode, 'inner_monologue_receipt_invalid');
    assert.ok(!JSON.stringify(logs).includes('Fictional'));
  });
}

test('failed supplement exposes precise code and permits a deliberate retry', async () => {
  let attempts = 0;
  const h = harness({ api: async () => { if (++attempts === 1) throw Object.assign(new Error('API balance is insufficient.'), { code: 'provider_balance_insufficient' }); return receipt; } });
  await h.run(message);
  assert.match(h.states.errors[messageId], /provider_balance_insufficient/);
  assert.equal(h.writes.length, 0);
  await h.run(message);
  assert.equal(attempts, 2);
  assert.equal(h.states.errors[messageId], '');
  assert.equal(h.writes.length, 1);
});

test('failed body uses committed user anchor, without resending its error or partial text', async () => {
  const failed = { ...message, id: 'local-assistant-failed', chatError: true,
    monologueUserMessageId: '9223372036854775807', content: 'Synthetic failure.',
    visibleMonologue: { source: VISIBLE_MONOLOGUE_SOURCE, state: 'failed', text: 'Earlier partial.' } };
  const h = harness({ items: [failed], api: async (_path, options) => {
    const body = JSON.parse(options.body);
    return { ...receipt, message_id: undefined, user_message_id: body.user_message_id,
      anchor_type: 'user_message', anchor_id: body.user_message_id,
      recovery_request_id: body.recovery_request_id, source: VISIBLE_MONOLOGUE_SOURCE,
      generated_with_reply: false };
  } });
  await h.run(failed);
  assert.equal(h.calls.length, 1);
  const body = JSON.parse(h.calls[0].options.body);
  assert.equal(body.user_message_id, failed.monologueUserMessageId);
  assert.equal(Object.hasOwn(body, 'message_id'), false);
  assert.match(body.recovery_request_id, /^[0-9a-f-]{36}$/i);
  assert.ok(!JSON.stringify(body).includes('Synthetic failure'));
  assert.ok(!JSON.stringify(body).includes('Earlier partial'));
  assert.equal(h.states.messages[0].content, failed.content);
  assert.equal(h.states.messages[0].tool_calls.visible_monologue.generated_with_reply, false);
  assert.equal(h.states.messages[0].tool_calls.visible_monologue.text, receipt.inner_monologue);
  assert.equal(h.states.monologues[failed.id].state, 'complete');
});

test('bigint assistant anchor sends one POST without history polling', async () => {
  const item = { ...message, id: 42 };
  const h = harness({ items: [item], api: async () => ({ ...receipt, message_id: 42 }) });
  await h.run(item);
  assert.equal(h.calls.length, 1);
  assert.equal(JSON.parse(h.calls[0].options.body).message_id, 42);
  assert.equal(h.states.messages[0].visibleMonologue.generated_with_reply, false);
});

test('failed supplement keeps the visible partial and a mismatched recovery receipt is rejected', async () => {
  const item = { ...message, visibleMonologue: { source: VISIBLE_MONOLOGUE_SOURCE, state: 'truncated', text: 'Earlier partial.' } };
  const h = harness({ items: [item], api: async () => ({ ...receipt, recovery_request_id: 'different-request' }) });
  await h.run(item);
  assert.equal(h.writes.length, 0);
  assert.equal(h.states.messages[0].visibleMonologue.text, 'Earlier partial.');
  assert.match(h.states.errors[messageId], /inner_monologue_receipt_invalid/);
});

test('invalid local user anchor cannot send a supplement request', async () => {
  const item = { ...message, chatError: true, monologueUserMessageId: 'local-user-123' };
  const h = harness({ items: [item] });
  await h.run(item);
  assert.equal(h.calls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('retry after lost POST response reuses recovery id and status snapshot', async () => {
  let attempts = 0;
  const h = harness({ api: async (_path, options) => {
    if (++attempts === 1) throw new Error('Connection lost after generation.');
    const body = JSON.parse(options.body);
    return { ...receipt, recovery_request_id: body.recovery_request_id };
  } });
  h.env.companionStatusRef.current = { mood: 'first snapshot' };
  await h.run(message);
  h.env.companionStatusRef.current = { mood: 'changed meanwhile' };
  await h.run(message);
  const [first, second] = h.calls.map(call => JSON.parse(call.options.body));
  assert.equal(first.recovery_request_id, second.recovery_request_id);
  assert.deepEqual(first.companion_status, second.companion_status);
  assert.equal(h.env.innerMonologueRecoveryAttemptsRef.current.size, 0);
});

function deadlineClock() {
  const timers = new Map(); let sequence = 0;
  return { timers, setTimer(fn) { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimer(id) { timers.delete(id); }, expire() { for (const fn of [...timers.values()]) fn(); } };
}

test('deadline releases a hanging POST/body lock; retry reuses its ID and late data never overwrites it', async () => {
  const response = deferred(), clock = deadlineClock(); let count = 0;
  const h = harness({ clock, api: async (_path, options) => {
    if (++count === 1) return response.promise;
    return { ...receipt, recovery_request_id: JSON.parse(options.body).recovery_request_id };
  } });
  const first = h.run(message); await tick();
  assert.equal(h.states.pending[messageId], true);
  clock.expire(); await first;
  assert.equal(h.env.innerMonologueRequestsRef.current.size, 0); assert.equal(clock.timers.size, 0);
  assert.equal(h.states.pending[messageId], false); assert.match(h.states.errors[messageId], /inner_monologue_timeout/);
  assert.equal(h.calls[0].options.signal.aborted, true); assert.equal(h.writes.length, 0);
  await h.run(message);
  const [a,b] = h.calls.map(call => JSON.parse(call.options.body));
  assert.equal(a.recovery_request_id, b.recovery_request_id); assert.equal(h.writes.length, 1);
  assert.equal(h.calls[1].options.retry, false);
  response.resolve({ ...receipt, inner_monologue: 'Old late text' }); await tick();
  assert.equal(h.writes.length, 1); assert.equal(h.states.messages[0].visibleMonologue.text, receipt.inner_monologue);
});

test('deadline covers settings save without later submitting a cancelled generation', async () => {
  const saved = deferred(), clock = deadlineClock(), h = harness({ clock, flush: () => saved.promise });
  const task = h.run(message); await tick(); clock.expire(); await task;
  assert.equal(h.states.pending[messageId], false); assert.match(h.states.errors[messageId], /inner_monologue_timeout/);
  saved.resolve(true); await tick();
  assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0); assert.equal(clock.timers.size, 0);
});

test('cancel exits an uncooperative sync read, preserves partial text and starts no further reads', async () => {
  const history = deferred(), clock = deadlineClock();
  const item = { ...message, id: 'local-assistant-pending', visibleMonologue: { source: VISIBLE_MONOLOGUE_SOURCE, state: 'truncated', text: 'Original partial' } };
  const h = harness({ clock, items: [item], api: () => history.promise });
  const task = h.run(item); await tick(); assert.equal(h.calls.length, 1);
  h.cancel(item); await task;
  assert.equal(h.states.pending[item.id], false); assert.match(h.states.errors[item.id], /inner_monologue_cancelled/);
  assert.equal(h.states.messages[0].visibleMonologue.text, 'Original partial');
  history.resolve({ messages: [] }); await tick();
  assert.equal(h.calls.length, 1); assert.equal(h.writes.length, 0); assert.equal(clock.timers.size, 0);
});

test('a timed-out former operation cannot release a replacement operation lock', async () => {
  const response = deferred(), clock = deadlineClock(), h = harness({ clock, api: () => response.promise });
  const task = h.run(message); await tick();
  const replacement = { controller: new AbortController() };
  h.env.innerMonologueRequestsRef.current.set(messageId, replacement);
  clock.expire(); await task;
  assert.equal(h.env.innerMonologueRequestsRef.current.get(messageId), replacement);
  assert.equal(h.states.pending[messageId], true); assert.equal(h.states.errors[messageId], '');
  response.resolve(receipt); await tick(); assert.equal(h.writes.length, 0);
});

test('actual App reopened after a lost response reuses only same-scope and same-input recovery ID', async () => {
  const rows = new Map(), storage = { getItem: key => rows.get(key) || null, setItem: (key, value) => rows.set(key, value) };
  const first = harness({ storage, api: async () => { throw new Error('Lost synthetic response'); } });
  await first.run(message);
  const originalId = JSON.parse(first.calls[0].options.body).recovery_request_id;
  const reopened = harness({ storage });
  await reopened.run(message);
  assert.equal(JSON.parse(reopened.calls[0].options.body).recovery_request_id, originalId);
  assert.ok(!JSON.stringify([...rows.values()]).includes('fixture-model'));
  assert.equal(reopened.states.messages[0].visibleMonologue.text, receipt.inner_monologue);
  const changed = harness({ storage }); changed.env.selectedChatModel = 'changed-model';
  await changed.run(message);
  assert.notEqual(JSON.parse(changed.calls[0].options.body).recovery_request_id, originalId);
});

test('actual App quota failure preserves generated text and reports temporary visibility without a second generation', async () => {
  const storage = { getItem: () => null, setItem() { throw new DOMException('Synthetic quota only', 'QuotaExceededError'); } };
  const h = harness({ storage });
  h.states.monologues = { earlier: { text: 'Earlier in-memory fixture' } };
  await h.run(message);
  assert.equal(h.calls.length, 1);
  assert.equal(h.states.monologues[messageId].text, receipt.inner_monologue);
  assert.equal(h.states.monologues.earlier.text, 'Earlier in-memory fixture');
  assert.equal(h.states.messages[0].visibleMonologue.text, receipt.inner_monologue);
  assert.match(h.states.errors[messageId], /inner_monologue_storage_unavailable/);
  assert.match(h.states.errors[messageId], /仅在本次打开期间/);
  assert.ok(!h.states.errors[messageId].includes('Synthetic quota only'));
});

test('actual App unavailable recovery storage explains that only same-mount retry keeps the ID', async () => {
  const storage = { getItem: () => null, setItem() { throw new DOMException('Synthetic quota only', 'QuotaExceededError'); } };
  const h = harness({ storage, api: async () => { throw Object.assign(new Error('Network unavailable'), { code: 'fixture_network' }); } });
  await h.run(message); await h.run(message);
  assert.equal(h.calls.length, 2);
  assert.equal(JSON.parse(h.calls[0].options.body).recovery_request_id, JSON.parse(h.calls[1].options.body).recovery_request_id);
  assert.match(h.states.errors[messageId], /inner_monologue_recovery_storage_unavailable/);
});
