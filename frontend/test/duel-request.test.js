import assert from 'node:assert/strict';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { createAuthSessionManager } from '../src/auth-session.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const storage = new Map(), calls = [];
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const COMPANION_A = '33333333-3333-4333-8333-333333333333';
const COMPANION_B = '44444444-4444-4444-8444-444444444444';
const oldGlobals = Object.fromEntries(['localStorage', 'window', 'fetch', '__duelRequestManager'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
globalThis.window = { setTimeout, clearTimeout, setInterval, clearInterval };
const manager = createAuthSessionManager({ supabaseUrl: 'https://fictional.example.test', supabaseAnonKey: 'fictional-public-placeholder', storage: globalThis.localStorage,
  createClientFn: () => ({ auth: {
    async getSession() { return { data: { session: { access_token: 'fictional-session', user: { id: ACCOUNT } } }, error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
  } }) });
await manager.initialize();
globalThis.__duelRequestManager = manager;
globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
  assert.equal(new URL(url).origin, 'http://duel.example.test');
  calls.push({ options, resolve: data => resolve(new Response(JSON.stringify(data), { status: 200 })), reject });
});
const vite = await createServer({ configFile: false, envDir: false, root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('http://duel.example.test'), 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('') },
  plugins: [{ name: 'duel-sdk-fixture', enforce: 'pre', transform(source, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/auth-session.js')) return source.replace('export const authSession = createAuthSessionManager();', 'export const authSession = globalThis.__duelRequestManager;');
  } }] });
let tree;
try {
  const { default: Duel } = await vite.ssrLoadModule('/src/IntimateDuel.jsx');
  const render = async companionScope => act(async () => { manager.setActiveCompanionId(companionScope); tree = TestRenderer.create(React.createElement(Duel, { accountScope: ACCOUNT, companionScope, aiName: 'Fixture', userName: 'Tester' })); });
  await render(COMPANION_A);
  const firstButton = tree.root.findAllByType('button').find(node => String(node.props.className || '').includes('recover') === false && node.props.disabled === false && node.findAllByType('strong').length > 0);
  let run;
  await act(async () => { run = firstButton.props.onClick(); void firstButton.props.onClick(); });
  assert.equal(calls.length, 1, 'two clicks in the same tick start only one round');
  assert.equal(calls[0].options.headers.get('X-DengTa-Companion-Id'), COMPANION_A);
  const restart = tree.root.findAllByType('button').find(node => node.children.some(value => typeof value === 'string' && /重开|重新/.test(value)));
  assert.ok(restart);
  await act(async () => restart.props.onClick());
  assert.equal(calls[0].options.signal.aborted, true);
  await act(async () => { calls[0].resolve({ narration: 'old stale fictional text', reaction: 'old stale reaction' }); await run; });
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /old stale/);
  assert.equal([...storage.keys()].filter(key => key.startsWith('dengta_intimate_duel_v3:')).length, 1);
  await act(async () => tree.unmount());
  await render(COMPANION_B);
  assert.equal([...storage.keys()].filter(key => key.startsWith('dengta_intimate_duel_v3:')).length, 2, 'companion save slots are distinct');
  const secondButton = tree.root.findAllByType('button').find(node => node.props.disabled === false && node.findAllByType('strong').length > 0);
  await act(async () => { run = secondButton.props.onClick(); });
  await act(async () => { calls[1].resolve({ ok: false, refused: true, refusal_code: 'provider_boundary_residue', companion_skill: null, reaction: '', narration: '' }); await run; });
  const saved = [...storage.entries()].find(([key]) => key.startsWith('dengta_intimate_duel_v3:') && key.includes(COMPANION_B));
  assert.equal(JSON.parse(saved[1]).round, 1, 'failed round restores resources and round state');
  await act(async () => tree.unmount());
  console.log('duel request lifecycle passed: double click, restart, companion scope, refusal rollback');
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close(); manager.destroy();
  for (const [name, descriptor] of Object.entries(oldGlobals)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
}
