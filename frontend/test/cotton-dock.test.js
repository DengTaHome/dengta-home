import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createServer } from 'vite';
import { isPetDockObscured, readPetDockEnabled } from '../src/cotton/dock-environment.js';
import { petStorageKey } from '../src/cotton/pet-state.js';

const values = new Map(), subscriptions = new Map(), observers = new Set();
const originals = new Map();
function stub(name, value) { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
const doc = { documentElement: { dataset: {} }, activeElement: null,
  addEventListener: (name, cb) => subscriptions.set(name, cb), removeEventListener: name => subscriptions.delete(name) };
stub('document', doc); stub('window', { addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener });
stub('MutationObserver', class { constructor(cb) { this.cb = cb; } observe() { observers.add(this.cb); } disconnect() { observers.delete(this.cb); } });
stub('matchMedia', () => ({ matches: true }));
stub('localStorage', { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
stub('IS_REACT_ACT_ENVIRONMENT', true);
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
  name: 'cotton-dock-component-test', enforce: 'pre',
  transform(code, id) {
    const file = id.replaceAll('\\', '/');
    if (file.endsWith('/CottonChatDock.jsx')) return code.replace("from './CottonPet.jsx'", "from 'virtual:pet-view'");
    if (file.endsWith('/CottonPet.jsx')) return code.replace("import('./cotton/pet-runtime.js')", "import('virtual:pet-runtime')");
  },
  resolveId(id) { if (id === 'virtual:pet-view' || id === 'virtual:pet-runtime') return '\0' + id; },
  load(id) {
    if (id === '\0virtual:pet-view') return `import React from 'react'; export default function Pet(){return React.createElement('canvas',{'aria-label':'pet fixture'});}`;
    if (id === '\0virtual:pet-runtime') return `export const visits=[]; export async function createPetRuntime(canvas,{initial,onChange}){const visit={stats:{satiety:60,...initial.stats},disposed:false};visits.push(visit);onChange({stats:{...visit.stats},action:'idle'});return{snapshot:()=>({stats:{...visit.stats},action:'idle'}),dispose(){visit.disposed=true;}};}`;
  },
}] });
let tree;
try {
  const { default: Dock } = await vite.ssrLoadModule('/src/CottonChatDock.jsx');
  const props = { accountScope: 'account-a', companionScope: 'companion-a' };
  await act(async () => { tree = TestRenderer.create(React.createElement(Dock, props)); });
  const toggle = () => tree.root.findAllByType('button')[0];
  assert.equal(tree.root.findAllByType('canvas').length, 0);
  await act(async () => toggle().props.onClick());
  assert.equal(tree.root.findAllByType('canvas').length, 1);
  assert.equal(readPetDockEnabled(localStorage, petStorageKey('account-a', 'companion-a')), true);
  await act(async () => { doc.documentElement.dataset.keyboardOpen = 'true'; observers.forEach(cb => cb()); });
  assert.equal(tree.root.findAllByType('canvas').length, 0, 'keyboard actually unmounts 3D view, not just CSS hiding');
  assert.equal(toggle().props['aria-pressed'], true, 'temporary concealment retains user preference');
  await act(async () => { doc.documentElement.dataset.keyboardOpen = 'false'; observers.forEach(cb => cb()); });
  assert.equal(tree.root.findAllByType('canvas').length, 1);
  await act(async () => { doc.activeElement = { matches: () => true }; subscriptions.get('focusin')(); });
  assert.equal(tree.root.findAllByType('canvas').length, 0, 'mobile typing hides before keyboard resize');
  await act(async () => { doc.activeElement = null; subscriptions.get('focusout')(); });
  await act(async () => tree.update(React.createElement(Dock, { ...props, blocked: true })));
  assert.equal(tree.root.findAllByType('canvas').length, 0);
  await act(async () => tree.update(React.createElement(Dock, { ...props, accountScope: 'account-b' })));
  assert.equal(toggle().props['aria-pressed'], false);
  await act(async () => tree.update(React.createElement(Dock, props)));
  assert.equal(tree.root.findAllByType('canvas').length, 1);
  await act(async () => toggle().props.onClick());
  assert.equal(tree.root.findAllByType('canvas').length, 0);
  await act(async () => tree.unmount()); tree = null;
  assert.equal(subscriptions.size, 0); assert.equal(observers.size, 0);
  doc.activeElement = { matches: () => true }; globalThis.matchMedia = () => ({ matches: false });
  assert.equal(isPetDockObscured(), false, 'desktop typing can retain pet');
  const { default: Pet } = await vite.ssrLoadModule('/src/CottonPet.jsx');
  const { visits } = await vite.ssrLoadModule('virtual:pet-runtime');
  await act(async () => { tree = TestRenderer.create(React.createElement(Pet, { ...props, compact: true }), { createNodeMock: () => ({}) }); });
  assert.equal(visits.length, 1);
  visits[0].stats.satiety = 78;
  await act(async () => tree.unmount()); tree = null;
  assert.equal(visits[0].disposed, true);
  assert.equal(JSON.parse(values.get(petStorageKey('account-a', 'companion-a'))).stats.satiety, 78, 'unmount persists latest completed care even before next UI notification');
  console.log('Dock opt-in, preference isolation, keyboard/focus/modal unmount, automatic return and listener cleanup passed');
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
}
