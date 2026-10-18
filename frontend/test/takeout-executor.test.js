import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
  name: 'takeout-api-fixture', enforce: 'pre',
  transform(code, id) { if (id.replaceAll('\\', '/').endsWith('/takeout-executor.js')) return code.replace('"./api.js"', '"virtual:takeout-api"'); },
  resolveId(id) { if (id === 'virtual:takeout-api') return '\0' + id; },
  load(id) { if (id === '\0virtual:takeout-api') return 'export const apiRequest=()=>{throw Error("unexpected real API call")};'; },
}] });
const descriptors = new Map();
function stub(name, value) { descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value, writable: true }); }
const interval = [], timeout = [], storage = new Map();
stub('setInterval', fn => { interval.push(fn); return interval.length; });
stub('setTimeout', fn => { timeout.push(fn); return timeout.length; });
stub('clearInterval', () => {}); stub('clearTimeout', () => {});
stub('window', { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
try {
  const { executeTakeoutCommand, startTakeoutRunner } = await vite.ssrLoadModule('/src/takeout-executor.js');
  const command = { id: 'fixture-command', command: { action: 'order', requirement: '虚构餐品', shop_name: '虚构店铺' } };
  let opens = 0; const calls = [];
  const plugin = { orderProduct: async () => { opens++; return { added: true }; }, searchShops: async () => { opens++; return { shops: [] }; } };
  const client = async path => { calls.push(path); if (path.endsWith('/result')) throw Error('fixture network error with private text'); return {}; };
  const result = await executeTakeoutCommand(command, { client, plugin });
  assert.equal(opens, 1); assert.equal(result.ok, true); assert.equal(result.receipt_synced, false);
  assert.equal(result.code, 'takeout_result_sync_failed');
  assert.equal(calls.some(path => path.endsWith('/failure')), false, 'receipt failure must not mark native success as failure');
  const failureBodies = [];
  const failure = await executeTakeoutCommand(command, { plugin: { orderProduct: async () => { throw Error('fixture private text'); } }, client: async (path, options) => { if (path.endsWith('/failure')) failureBodies.push(options.body); return {}; } });
  assert.equal(failure.code, 'takeout_native_execution_failed'); assert.equal(failure.receipt_synced, true);
  assert.ok(failureBodies.every(body => !body.includes('fixture private text')));
  for (const [status, code] of [['logged_out','takeout_login_expired'],['verification','takeout_verification_required'],['shop_not_found','takeout_shop_not_found'],['product_not_found','takeout_product_not_found'],['over_limit','takeout_budget_exceeded'],['error','takeout_page_execution_failed']]) {
    let body;
    const outcome = await executeTakeoutCommand(command, { plugin: { orderProduct: async () => ({ status, error: 'fixture private text' }) }, client: async (path, options) => { if (path.endsWith('/result')) body = options.body; return {}; } });
    assert.equal(outcome.ok, false); assert.equal(outcome.code, code); assert.ok(!body.includes('fixture private text'));
  }
  for (const code of ['takeout_page_init_failed','takeout_page_renderer_failed','takeout_page_interrupted','takeout_page_not_ready','takeout_page_touch_unavailable','takeout_page_load_failed','browser_account_restore_required']) {
    for (const action of ['search','order']) {
      let resultBody;
      const nativeValue = { status: 'error', code, error: 'fictional private cause' };
      const nativePlugin = { searchShops: async () => nativeValue, orderProduct: async () => nativeValue };
      const outcome = await executeTakeoutCommand({ ...command, command: { action, requirement: 'fictional' } }, { plugin: nativePlugin, client: async (path, options) => { if (path.endsWith('/result')) resultBody = JSON.parse(options.body); return {}; } });
      assert.equal(outcome.ok, false); assert.equal(outcome.code, code); assert.equal(outcome.receipt_synced, true);
      assert.equal(resultBody.result.code, code); assert.equal(resultBody.result.error, outcome.message);
      assert.ok(!JSON.stringify(resultBody).includes('fictional private cause'));
    }
    let failureBody;
    const outcome = await executeTakeoutCommand({ ...command, command: { action: 'search', requirement: 'fictional' } }, {
      plugin: { searchShops: async () => { throw Object.assign(Error('fictional private cause'), { code }); } },
      client: async (path, options) => { if (path.endsWith('/failure')) failureBody = JSON.parse(options.body); return {}; },
    });
    assert.equal(outcome.code, code); assert.equal(outcome.ok, false); assert.equal(outcome.receipt_synced, true);
    assert.equal(failureBody.message, outcome.message); assert.ok(!outcome.message.includes('fictional private cause'));
    const loggedOut = await executeTakeoutCommand(command, { plugin: { orderProduct: async () => ({ status: 'logged_out', code }) }, client: async () => ({}) });
    assert.equal(loggedOut.code, 'takeout_login_expired', 'a technical code must not replace an existing explicit status');
  }
  const unknownNative = await executeTakeoutCommand(command, { plugin: { orderProduct: async () => ({ status: 'error', code: 'fictional_private_provider_code', error: 'fictional private cause' }) }, client: async () => ({}) });
  assert.equal(unknownNative.code, 'takeout_page_execution_failed'); assert.ok(!JSON.stringify(unknownNative).includes('fictional_private_provider_code'));
  const unknownReject = await executeTakeoutCommand(command, { plugin: { orderProduct: async () => { throw Object.assign(Error('fictional private cause'), { code: 'fictional_private_provider_code' }); } }, client: async () => ({}) });
  assert.equal(unknownReject.code, 'takeout_native_execution_failed'); assert.ok(!JSON.stringify(unknownReject).includes('fictional private cause'));
  const incomplete = await executeTakeoutCommand({ ...command, command: { action: 'search', requirement: 'fixture' } }, { plugin: { searchShops: async () => ({ loading: true, shops: [] }) }, client: async () => ({}) });
  assert.equal(incomplete.code, 'takeout_search_incomplete'); assert.equal(incomplete.ok, false);
  const malformed = await executeTakeoutCommand(command, { plugin: { orderProduct: async () => null }, client: async () => ({}) });
  assert.equal(malformed.code, 'takeout_native_result_invalid');
  const invalid = await executeTakeoutCommand({ ...command, command: { action: 'invalid', requirement: 'fixture' } }, { client: async () => ({}), plugin });
  assert.equal(invalid.code, 'takeout_command_invalid'); assert.equal(opens, 1);
  let active = true; const ack = deferred();
  const stoppedExecution = executeTakeoutCommand(command, { client: () => ack.promise, plugin, shouldContinue: () => active });
  active = false; ack.resolve({}); assert.equal(await stoppedExecution, null); assert.equal(opens, 1);

  const capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true };
  const pending = deferred(); let polls = 0, done = 0, signal;
  const stop = startTakeoutRunner({ scope: 'fixture-account-companion', capacitor, plugin, onCommandDone: () => { done++; }, client: async (path, options) => { signal = options.signal; if (path.endsWith('/pending')) { polls++; return pending.promise; } return {}; } });
  interval.at(-1)(); interval.at(-1)(); timeout.at(-1)(); await settle();
  assert.equal(polls, 1, 'slow reads cannot overlap');
  stop(); assert.equal(signal.aborted, true); pending.resolve({ commands: [command] }); await settle();
  assert.equal(opens, 1); assert.equal(done, 0);
  const native = deferred();
  const oldStop = startTakeoutRunner({ scope: 'old-companion', capacitor, plugin: { orderProduct: async () => { opens++; return native.promise; } }, onCommandDone: () => { done++; }, client: async path => path.endsWith('/pending') ? { commands: [command] } : (calls.push(path), {}) });
  interval.at(-1)(); await settle(); oldStop(); const before = calls.length;
  native.resolve({ added: true }); await settle();
  assert.equal(calls.length, before, 'late native completion cannot report in the new scope'); assert.equal(done, 0);
  assert.ok(storage.has('dengta_takeout_attempted_v2:old-companion'));
  const freshStop = startTakeoutRunner({ scope: 'new-companion', capacitor, plugin, client: async path => path.endsWith('/pending') ? { commands: [command] } : {} });
  interval.at(-1)(); await settle(); freshStop();
  assert.equal(opens, 3, 'old companion marker cannot suppress a new companion command');
  assert.equal(storage.has('dengta_takeout_attempted_v2:new-companion'), false);
  const errorStop = startTakeoutRunner({ scope: 'error-companion', capacitor, plugin: { orderProduct: async () => ({ status: 'logged_out', error: 'fixture private text' }) }, client: async path => path.endsWith('/pending') ? { commands: [command] } : {} });
  interval.at(-1)(); await settle(); errorStop();
  const { readOperationFailures } = await vite.ssrLoadModule('/src/operation-diagnostics.js');
  const entries = readOperationFailures('error-companion');
  assert.equal(entries[0].code, 'DT-TAKEOUT'); assert.equal(entries[0].reasonCode, 'takeout_login_expired');
  assert.ok(!JSON.stringify(entries).includes('fixture private text'));
  assert.equal(readOperationFailures('new-companion').length, 0);
  for (const code of ['takeout_page_init_failed','takeout_page_renderer_failed','takeout_page_interrupted','takeout_page_not_ready','takeout_page_touch_unavailable','takeout_page_load_failed','browser_account_restore_required']) {
    const scope = 'fictional-' + code;
    const codeStop = startTakeoutRunner({ scope, capacitor,
      plugin: { searchShops: async () => { throw Object.assign(Error('fictional private cause'), { code }); } },
      client: async path => path.endsWith('/pending') ? { commands: [{ ...command, command: { action: 'search', requirement: 'fictional' } }] } : {},
    });
    interval.at(-1)(); await settle(); codeStop();
    const diagnostics = readOperationFailures(scope);
    assert.equal(diagnostics[0].reasonCode, code); assert.equal(diagnostics[0].code, 'DT-TAKEOUT');
    assert.ok(!JSON.stringify(diagnostics).includes('fictional private cause'));
  }
  const search = deferred(), cancelledScopes = [], searchInputs = [], searchCalls = [];
  const searchStop = startTakeoutRunner({ scope: 'fictional-search-old', capacitor,
    plugin: { searchShops: input => { searchInputs.push(input); return search.promise; }, cancelSearch: async input => cancelledScopes.push(input.scope) },
    onCommandDone: () => { done++; }, client: async path => { searchCalls.push(path); return path.endsWith('/pending') ? { commands: [{ ...command, command: { action: 'search', requirement: '虚构店铺' } }] } : {}; },
  });
  interval.at(-1)(); await settle();
  assert.equal(searchInputs[0].scope, 'fictional-search-old');
  searchStop(); searchStop(); assert.deepEqual(cancelledScopes, ['fictional-search-old']);
  const beforeSearch = searchCalls.length;
  search.resolve({ shops: [{ name: '虚构店铺' }] }); await settle();
  assert.equal(searchCalls.length, beforeSearch, 'cancelled search cannot post into a later identity');
  assert.equal(done, 0);
  let failedOtherDevice = false;
  storage.set('dengta_takeout_attempted_v2:claimed-elsewhere', JSON.stringify({ id: command.id }));
  const collisionStop = startTakeoutRunner({ scope: 'claimed-elsewhere', capacitor, plugin, client: async path => {
    if (path.endsWith('/pending')) return { commands: [command] };
    if (path.endsWith('/ack')) throw Object.assign(Error('already claimed'), { status: 409 });
    if (path.endsWith('/failure')) failedOtherDevice = true;
    return {};
  } });
  interval.at(-1)(); await settle(); collisionStop(); assert.equal(failedOtherDevice, false);
  console.log('takeout lifecycle regression passed: receipt failures, invalid commands, polling lock, scope cancellation and scoped markers');
} finally {
  for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  await vite.close();
}
