import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { recoverSynchronizedAssistantMessage } from '../src/inner-monologue-sync.js';
import { canRequestVisibleMonologue, innerMonologueForMessage, storeInnerMonologue } from '../src/inner-monologue.js';
import { createScopedSettingsSession, settingsSaveScope } from '../src/settings-save-scope.js';
import { recordOperationFailure, readOperationFailures, clearOperationFailures } from '../src/operation-diagnostics.js';

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

function harness({ api = async () => receipt, flush = async () => true, items = [message] } = {}) {
  const writes = [], calls = [], states = { messages: items, pending: {}, errors: {}, monologues: {} };
  const scope = JSON.stringify(['account-a', 'companion-a']);
  let snapshot = { user: { id: 'account-a' }, activeCompanionId: 'companion-a' };
  const env = {
    canRequestVisibleMonologue, innerMonologueForMessage, storeInnerMonologue,
    createScopedSettingsSession, settingsSaveScope, recoverSynchronizedAssistantMessage,
    activeSessionIdRef: { current: sessionId }, privateMediaScope: scope,
    innerMonologueRequestsRef: { current: new Map() },
    innerMonologueRequestScopeRef: { current: { active: true, generation: 1 } },
    innerMonologuePending: {}, innerMonologues: {},
    authSession: { getSnapshot: () => snapshot, getRequestContext: async () => ({ companionId: snapshot.activeCompanionId }) },
    accountStorageScope: 'account-a', selectedChatModel: 'fixture-model', settings: {},
    companionStatusRef: { current: {} }, companionStatusForRequest: value => value,
    readStoredSessionChatModel: () => '', flushLatestSettingsDraft: flush,
    recordOperationFailure,
    hydrateSessionChatHistory: value => value,
    apiRequest: async (path, options) => { calls.push({ path, options }); return api(path, options); },
    globalThis: { localStorage: { getItem: () => null, setItem: (key, value) => writes.push({ key, value }) } },
  };
  for (const [setter, field] of Object.entries({ setMessages: 'messages', setInnerMonologuePending: 'pending', setInnerMonologueErrors: 'errors', setInnerMonologues: 'monologues' })) {
    env[setter] = update => { states[field] = typeof update === 'function' ? update(states[field]) : update; };
  }
  // Execute the actual App handler with controlled API/auth/state boundaries.
  const run = new Function('env', `with (env) { ${handler}; return requestVisibleInnerMonologue; }`)(env);
  return { run, env, states, calls, writes, switchOwner() { snapshot = { user: { id: 'account-b' }, activeCompanionId: 'companion-b' }; } };
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
