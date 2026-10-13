import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const asset = JSON.parse(readFileSync(new URL('../public/cotton/b1857.json', import.meta.url)));
const pending = new Map(), listeners = new Map(), canvasListeners = new Map();
const counts = { disposed: 0, lost: 0, observed: 0, rendered: 0 };
const originals = new Map();
function stub(name, value) { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
let serial = 0;
stub('__cottonTestCounts', counts);
stub('fetch', async () => ({ ok: true, json: async () => asset }));
stub('document', { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) });
stub('requestAnimationFrame', fn => { pending.set(++serial, fn); return serial; });
stub('cancelAnimationFrame', id => pending.delete(id));
stub('matchMedia', () => ({ matches: false }));
stub('ResizeObserver', class { observe() { counts.observed++; } disconnect() { counts.observed--; } });
const canvas = { getBoundingClientRect: () => ({ width: 360, height: 340 }), addEventListener: (name, fn) => canvasListeners.set(name, fn), removeEventListener: name => canvasListeners.delete(name) };
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
  name: 'cotton-renderer-test', enforce: 'pre',
  transform(code, id) { if (id.replaceAll('\\', '/').endsWith('/cotton/pet-runtime.js')) return code.replace("from 'three'", "from 'virtual:cotton-test-three'"); },
  resolveId(id) { if (id === 'virtual:cotton-test-three') return '\0cotton-test-three'; },
  load(id) { if (id === '\0cotton-test-three') return `export * from 'three'; export class WebGLRenderer { setPixelRatio(){} setSize(){} render(){globalThis.__cottonTestCounts.rendered++} dispose(){globalThis.__cottonTestCounts.disposed++} forceContextLoss(){globalThis.__cottonTestCounts.lost++} }`; },
}] });
try {
  const { createPetRuntime } = await vite.ssrLoadModule('/src/cotton/pet-runtime.js');
  let changes = 0;
  const controller = new AbortController();
  const runtime = await createPetRuntime(canvas, { signal: controller.signal, initial: {}, onChange() { changes++; }, onError() {} });
  assert.equal(pending.size, 1); assert.equal(counts.observed, 1);
  assert.equal(runtime.command('feed').accepted, true);
  runtime.setPaused(true); assert.equal(pending.size, 0);
  assert.equal(runtime.command('pet').accepted, false);
  runtime.setQuiet(true);
  runtime.setPaused(false); assert.equal(pending.size, 1);
  assert.equal(runtime.snapshot().action, 'rest', 'quiet mode chosen during pause applies on resume');
  runtime.setQuiet(false);
  assert.equal(runtime.snapshot().action, 'wake');
  document.hidden = true; listeners.get('visibilitychange')(); assert.equal(pending.size, 0);
  document.hidden = false; listeners.get('visibilitychange')(); assert.equal(pending.size, 1);
  for (let t = 40; t <= 1200; t += 40) { const [id, callback] = pending.entries().next().value; pending.delete(id); callback(t); }
  assert.ok(changes > 1); assert.ok(counts.rendered > 1);
  const snapshot = runtime.snapshot(); snapshot.stats.mood = -100;
  assert.notEqual(runtime.snapshot().stats.mood, -100, 'snapshots cannot mutate runtime stats');
  runtime.dispose(); runtime.dispose();
  assert.equal(pending.size, 0); assert.equal(listeners.size, 0); assert.equal(canvasListeners.size, 0);
  assert.deepEqual({ disposed: counts.disposed, lost: counts.lost, observed: counts.observed }, { disposed: 1, lost: 1, observed: 0 });
  controller.abort();
  await assert.rejects(createPetRuntime(canvas, { signal: controller.signal, initial: {} }), { name: 'AbortError' });
  globalThis.fetch = async () => ({ ok: false });
  await assert.rejects(createPetRuntime(canvas, { signal: new AbortController().signal, initial: {} }), /pet_asset_unavailable/);
  console.log('Cotton runtime pause, hidden-page suspension, bounded RAF, unmount cleanup, aborted load and asset failure passed (mock GPU; real model and behavior)');
} finally {
  await vite.close();
  for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
}
await import('./cotton-runtime-resources.test.js');
