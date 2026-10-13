import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers';
import { createServer } from 'vite';
import * as THREE from 'three';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { InteractionController } from '../src/cotton/upstream/interaction-controller.js';

const asset = JSON.parse(readFileSync(new URL('../public/cotton/b1857.json', import.meta.url)));
const pending = new Map(), listeners = new Map(), canvasListeners = new Map(), mediaListeners = new Set(), mutations = new Set();
const originals = new Map(), geometryDisposals = new Map(), materialDisposals = new Map();
let state, serial = 0, currentAsset = asset;
function stub(name, value) { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
const doc = { hidden: false, documentElement: { dataset: {} }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
const media = { matches: false, addEventListener: (_, fn) => mediaListeners.add(fn), removeEventListener: (_, fn) => mediaListeners.delete(fn) };
const canvas = { getBoundingClientRect: () => ({ width: 360, height: 340 }), addEventListener: (name, fn) => canvasListeners.set(name, fn), removeEventListener: name => canvasListeners.delete(name) };
const fetchAsset = async () => ({ ok: true, json: async () => currentAsset });
stub('__cottonTestState', {});
stub('fetch', fetchAsset);
stub('document', doc);
stub('requestAnimationFrame', fn => { pending.set(++serial, fn); return serial; });
stub('cancelAnimationFrame', id => pending.delete(id));
stub('matchMedia', () => media);
stub('ResizeObserver', class {
  constructor() { state.resizeCreated++; }
  observe() { state.resizeObserved++; if (state.failure === 'resize-observe') throw state.error; }
  disconnect() { state.resizeDisconnected++; }
});
stub('MutationObserver', class {
  constructor(fn) { this.fn = fn; state.mutationCreated++; }
  observe(target, options) {
    assert.equal(target, doc.documentElement);
    assert.deepEqual(options.attributeFilter, ['data-dengta-reduced-motion']);
    mutations.add(this.fn);
    if (state.failure === 'mutation-observe') throw state.error;
  }
  disconnect() { state.mutationDisconnected++; mutations.delete(this.fn); }
});
stub('localStorage', { getItem: () => null, setItem() {} });
stub('IS_REACT_ACT_ENVIRONMENT', true);
const disposers = [];
for (const [type, map] of [[THREE.BufferGeometry, geometryDisposals], [THREE.Material, materialDisposals], [THREE.Skeleton, null]]) {
  const original = type.prototype.dispose;
  type.prototype.dispose = function () {
    if (map) map.set(this, (map.get(this) || 0) + 1);
    else state.skeletonDisposed++;
    return original.call(this);
  };
  disposers.push(() => { type.prototype.dispose = original; });
}
function reset() {
  assert.equal(pending.size, 0); assert.equal(listeners.size, 0); assert.equal(canvasListeners.size, 0);
  assert.equal(mediaListeners.size, 0); assert.equal(mutations.size, 0);
  geometryDisposals.clear(); materialDisposals.clear();
  state = { created: 0, disposed: 0, lost: 0, rendered: 0, resizeCreated: 0, resizeObserved: 0, resizeDisconnected: 0, mutationCreated: 0, mutationDisconnected: 0, skeletonDisposed: 0, changes: 0, clock: 0, error: new Error('initialization-fixture') };
  globalThis.__cottonTestState = state;
  currentAsset = asset; doc.hidden = false; doc.documentElement.dataset.dengtaReducedMotion = 'false'; media.matches = false;
  globalThis.fetch = fetchAsset;
}
function tick(until, start = 0) {
  for (let t = start; t <= until; t += 1000 / 60) {
    assert.ok(pending.size <= 1, 'at most one outstanding RAF');
    const entry = pending.entries().next().value;
    if (!entry) break;
    pending.delete(entry[0]); entry[1](t);
  }
}
function tickClock(until) {
  for (let t = state.clock; t <= until; t += 1000 / 60) {
    const entry = pending.entries().next().value;
    if (!entry) break;
    state.clock = t;
    pending.delete(entry[0]); entry[1](t);
  }
  state.clock = until;
}
function assertReleased(expected = 1) {
  assert.equal(state.created, expected); assert.equal(state.disposed, expected); assert.equal(state.lost, expected);
  assert.equal(state.resizeDisconnected, state.resizeCreated);
  assert.equal(state.mutationDisconnected, state.mutationCreated);
  assert.equal(pending.size, 0); assert.equal(listeners.size, 0); assert.equal(canvasListeners.size, 0);
  assert.equal(mediaListeners.size, 0); assert.equal(mutations.size, 0);
  for (const count of [...geometryDisposals.values(), ...materialDisposals.values()]) assert.equal(count, 1, 'shared scene resources dispose once');
}
const options = () => ({ signal: new AbortController().signal, initial: {}, onChange() { state.changes++; }, onError() {} });
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
  name: 'cotton-renderer-test', enforce: 'pre',
  transform(code, id) {
    const file = id.replaceAll('\\', '/');
    if (file.endsWith('/cotton/pet-runtime.js')) return code.replace("from 'three'", "from 'virtual:cotton-test-three'").replaceAll('performance.now()', 'globalThis.__cottonTestState.clock');
    if (file.endsWith('/cotton/upstream/interaction-props.js')) return code.replace('this.group.add(this.ball);', "this.group.add(this.ball);if(globalThis.__cottonTestState.failure==='props-partial')throw globalThis.__cottonTestState.error;");
  },
  resolveId(id) { if (id === 'virtual:cotton-test-three') return '\0cotton-test-three'; },
  load(id) { if (id === '\0cotton-test-three') return `export * from 'three'; export class WebGLRenderer {
    constructor(){globalThis.__cottonTestState.created++}
    setPixelRatio(){if(globalThis.__cottonTestState.failure==='pixel-ratio')throw globalThis.__cottonTestState.error}
    setSize(){if(globalThis.__cottonTestState.failure==='resize')throw globalThis.__cottonTestState.error}
    render(scene){globalThis.__cottonTestState.scene=scene;globalThis.__cottonTestState.rendered++}
    dispose(){globalThis.__cottonTestState.disposed++;if(globalThis.__cottonTestState.failDispose)throw Error('cleanup-fixture')}
    forceContextLoss(){globalThis.__cottonTestState.lost++}
  }`; },
}] });
let tree;
try {
  const { createPetRuntime } = await vite.ssrLoadModule('/src/cotton/pet-runtime.js');
  reset();
  const runtime = await createPetRuntime(canvas, options());
  assert.equal(pending.size, 1); assert.equal(state.resizeObserved, 1);
  assert.equal(runtime.command('feed').accepted, true);
  runtime.setPaused(true); assert.equal(pending.size, 0);
  assert.equal(runtime.command('pet').accepted, false);
  runtime.setQuiet(true); runtime.setPaused(false); assert.equal(pending.size, 1);
  assert.equal(runtime.snapshot().action, 'rest', 'quiet mode chosen during pause applies on resume');
  runtime.setQuiet(false); assert.equal(runtime.snapshot().action, 'wake');
  doc.hidden = true; listeners.get('visibilitychange')(); assert.equal(pending.size, 0);
  doc.hidden = false; listeners.get('visibilitychange')(); assert.equal(pending.size, 1);
  tick(4000); assert.ok(state.changes > 1); assert.ok(state.rendered > 1);
  const snapshot = runtime.snapshot(); snapshot.stats.mood = -100;
  assert.notEqual(runtime.snapshot().stats.mood, -100, 'snapshots cannot mutate runtime stats');
  const geometries = new Set(), materials = new Set();
  state.scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); for (const material of [].concat(object.material || [])) materials.add(material); });
  runtime.dispose(); runtime.dispose(); assertReleased();
  assert.equal(geometryDisposals.size, geometries.size); assert.equal(materialDisposals.size, materials.size); assert.equal(state.skeletonDisposed, 1);
  runtime.setQuiet(true); runtime.setPaused(false); assert.equal(pending.size, 0);

  for (const origin of ['os', 'app']) {
    reset(); if (origin === 'os') media.matches = true; else doc.documentElement.dataset.dengtaReducedMotion = 'true';
    const reduced = await createPetRuntime(canvas, options());
    assert.equal(state.rendered, 1); assert.equal(pending.size, 0, `${origin} reduction has a static initial frame without RAF`);
    const propGroup = state.scene.children.find(group => group.isGroup && group.name === '');
    assert.equal(propGroup.children[1].visible, false, 'initial static frame hides the unused feeding hand');
    assert.equal(reduced.command('feed').accepted, true); assert.equal(pending.size, 1);
    assert.equal(reduced.command('feed').accepted, false, 'reduced motion preserves action cooldown');
    tick(11000); assert.equal(pending.size, 0); assert.equal(reduced.snapshot().action, 'idle');
    assert.equal(reduced.snapshot().stats.satiety, 78, 'finite authored feeding still commits once');
    assert.ok(state.rendered > 1, 'active user action is rendered');
    const finalRenders = state.rendered; tick(22000, 11000); assert.equal(state.rendered, finalRenders);
    state.clock += 10000;
    assert.equal(reduced.command('feed').accepted, true, 'cooldown elapses in static idle without allocating idle RAF');
    tick(32000, 22000); assert.equal(pending.size, 0); assert.equal(reduced.snapshot().stats.satiety, 96);
    doc.hidden = true; listeners.get('visibilitychange')(); doc.hidden = false; listeners.get('visibilitychange')();
    assert.equal(pending.size, 0, 'returning to a completed static action stays idle');
    reduced.setQuiet(true); tick(26000, 22000); assert.equal(pending.size, 0); assert.equal(reduced.snapshot().action, 'rest');
    reduced.setPaused(true); reduced.setQuiet(false); assert.equal(pending.size, 0);
    reduced.setPaused(false); assert.equal(reduced.snapshot().action, 'wake'); assert.equal(pending.size, 1);
    tick(33000, 26000); assert.equal(pending.size, 0); assert.equal(reduced.snapshot().action, 'idle');
    reduced.dispose(); reduced.dispose(); assertReleased();
  }

  reset(); doc.documentElement.dataset.dengtaReducedMotion = 'true';
  const resting = await createPetRuntime(canvas, { ...options(), initial: { quiet: true, stats: { energy: 50 } } });
  tickClock(3000); assert.equal(pending.size, 0);
  const restStart = resting.snapshot();
  const expectedRest = new InteractionController(); Object.assign(expectedRest.stats, restStart.stats); expectedRest.request('rest'); expectedRest.update(10);
  const restDraws = state.rendered;
  state.clock += 10000;
  const rested = resting.snapshot();
  assert.ok(Math.abs(rested.stats.energy - expectedRest.stats.energy) < 1e-9, 'static visible rest preserves the author controller gain without RAF');
  assert.deepEqual(resting.snapshot(), rested, 'repeated snapshot at the same clock cannot double-count rest');
  assert.equal(resting.command('unknown-action').accepted, false); assert.deepEqual(resting.snapshot(), rested, 'rejected action at the same clock cannot double-count rest');
  assert.equal(state.rendered, restDraws); assert.equal(pending.size, 0);
  state.clock += 5000;
  expectedRest.update(5);
  assert.equal(resting.command('feed').accepted, true);
  assert.ok(Math.abs(resting.snapshot().stats.energy - expectedRest.stats.energy) < 1e-9, 'the next interaction settles rest before switching action');
  tickClock(state.clock + 11000); assert.equal(resting.snapshot().stats.satiety, 78, 'lazy rest settlement cannot duplicate active feeding commits'); assert.equal(pending.size, 0);
  resting.dispose(); assertReleased();

  reset(); doc.documentElement.dataset.dengtaReducedMotion = 'true';
  const restLifecycle = await createPetRuntime(canvas, { ...options(), initial: { quiet: true, stats: { energy: 50 } } });
  tickClock(3000);
  const beforeHide = restLifecycle.snapshot().stats.energy;
  state.clock += 5000; doc.hidden = true; listeners.get('visibilitychange')();
  const hiddenEnergy = restLifecycle.snapshot().stats.energy;
  assert.ok(Math.abs(hiddenEnergy - beforeHide - .6) < 1e-9, 'visibility transition settles the previously visible rest segment');
  state.clock += 60000; assert.equal(restLifecycle.snapshot().stats.energy, hiddenEnergy, 'hidden time has no care gain');
  doc.hidden = false; listeners.get('visibilitychange')(); assert.equal(pending.size, 0);
  state.clock += 2000; restLifecycle.setPaused(true);
  const pausedEnergy = restLifecycle.snapshot().stats.energy;
  assert.ok(Math.abs(pausedEnergy - hiddenEnergy - .24) < 1e-9, 'pause settles the eligible preceding segment');
  state.clock += 60000; assert.equal(restLifecycle.snapshot().stats.energy, pausedEnergy, 'paused time has no care gain');
  restLifecycle.setPaused(false); assert.equal(pending.size, 0);
  state.clock += 3000; const resumedEnergy = restLifecycle.snapshot().stats.energy;
  assert.ok(Math.abs(resumedEnergy - pausedEnergy - .36) < 1e-9, 'resume starts a fresh visible unpaused rest segment');
  state.clock += 2000; restLifecycle.setQuiet(false);
  assert.ok(Math.abs(restLifecycle.snapshot().stats.energy - resumedEnergy - .24) < 1e-9, 'quiet toggle settles rest before waking');
  assert.equal(restLifecycle.snapshot().action, 'wake');
  tickClock(state.clock + 5000); assert.equal(pending.size, 0);
  restLifecycle.dispose(); assertReleased();

  reset(); doc.documentElement.dataset.dengtaReducedMotion = 'true';
  const resumedRest = await createPetRuntime(canvas, { ...options(), initial: { quiet: true, stats: { energy: 50 } } });
  tickClock(3000); const staticEnergy = resumedRest.snapshot().stats.energy;
  state.clock += 5000; listeners.get('visibilitychange')();
  assert.ok(Math.abs(resumedRest.snapshot().stats.energy - staticEnergy - .6) < 1e-9, 'a visible resume settles rest before rebuilding its baseline'); assert.equal(pending.size, 0);
  state.clock += 5000; doc.documentElement.dataset.dengtaReducedMotion = 'false'; mutations.forEach(fn => fn());
  const normalRestEnergy = resumedRest.snapshot().stats.energy;
  assert.ok(Math.abs(normalRestEnergy - staticEnergy - 1.2) < 1e-9, 'exiting reduced motion settles rest before restarting RAF'); assert.equal(pending.size, 1);
  tickClock(state.clock); assert.equal(resumedRest.snapshot().stats.energy, normalRestEnergy, 'the resumed first frame cannot replay the static elapsed segment');
  resumedRest.dispose(); assertReleased();

  reset(); doc.documentElement.dataset.dengtaReducedMotion = 'true';
  const cappedRest = await createPetRuntime(canvas, { ...options(), initial: { quiet: true, stats: { energy: 99 } } });
  tickClock(3000); state.clock += 100000; assert.equal(cappedRest.snapshot().stats.energy, 100, 'author rest energy cap remains intact'); assert.equal(pending.size, 0);
  cappedRest.dispose(); assertReleased();

  reset();
  const changing = await createPetRuntime(canvas, options());
  doc.documentElement.dataset.dengtaReducedMotion = 'true'; mutations.forEach(fn => fn()); assert.equal(pending.size, 0);
  media.matches = true; mediaListeners.forEach(fn => fn());
  doc.documentElement.dataset.dengtaReducedMotion = 'false'; mutations.forEach(fn => fn()); assert.equal(pending.size, 0, 'OS reduction remains effective after app opt-out');
  media.matches = false; mediaListeners.forEach(fn => fn()); assert.equal(pending.size, 1);
  changing.command('pet'); doc.documentElement.dataset.dengtaReducedMotion = 'true'; mutations.forEach(fn => fn());
  tick(7000); assert.equal(changing.snapshot().action, 'idle'); assert.equal(pending.size, 0, 'in-flight action finishes after motion preference changes');
  changing.dispose(); assertReleased();

  reset(); const lost = await createPetRuntime(canvas, options()); let prevented = false;
  canvasListeners.get('webglcontextlost')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(pending.size, 0); assert.equal(lost.command('pet').accepted, false);
  lost.dispose(); assertReleased();

  for (const invalid of [{}, { ...asset, normals: [] }, { ...asset, bones: [{ name: 'head', head: [0, 0, 0], parent: 'missing' }] }]) {
    reset(); currentAsset = invalid;
    await assert.rejects(createPetRuntime(canvas, options()), /pet_asset_invalid/); assertReleased(0);
  }
  for (const failure of ['pixel-ratio', 'props-partial', 'resize-observe', 'mutation-observe', 'resize', 'callback', 'aborted-notify']) {
    reset(); state.failure = failure;
    const config = options();
    if (failure === 'callback') { config.onChange = () => { throw state.error; }; state.failDispose = true; }
    if (failure === 'aborted-notify') { const abort = new AbortController(); config.signal = abort.signal; config.onChange = () => abort.abort(); }
    await assert.rejects(createPetRuntime(canvas, config), failure === 'aborted-notify' ? { name: 'AbortError' } : error => error === state.error);
    assertReleased();
    if (failure !== 'pixel-ratio') { assert.equal(state.skeletonDisposed, 1); assert.ok(geometryDisposals.size >= 4); }
  }
  reset(); const abort = new AbortController(); abort.abort();
  await assert.rejects(createPetRuntime(canvas, { ...options(), signal: abort.signal }), { name: 'AbortError' }); assertReleased(0);
  reset(); globalThis.fetch = async () => ({ ok: false });
  await assert.rejects(createPetRuntime(canvas, options()), /pet_asset_unavailable/); assertReleased(0);
  reset(); globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid-json'); } });
  await assert.rejects(createPetRuntime(canvas, options()), /invalid-json/); assertReleased(0);

  const { default: CottonPet } = await vite.ssrLoadModule('/src/CottonPet.jsx');
  async function settle() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); }
  reset(); state.failure = 'resize';
  await act(async () => { tree = TestRenderer.create(React.createElement(CottonPet, { compact: true }), { createNodeMock: () => canvas }); await settle(); });
  assert.equal(tree.root.findAllByProps({ role: 'alert' }).length, 1, 'runtime initialization error reaches React retry UI'); assertReleased();
  state.failure = undefined;
  const retry = tree.root.findAllByType('button').find(button => button.children.includes('重新打开'));
  await act(async () => { retry.props.onClick(); await settle(); });
  assert.equal(tree.root.findAllByProps({ role: 'alert' }).length, 0); assert.equal(state.created, 2); assert.equal(state.disposed, 1);
  await act(async () => tree.unmount()); tree = null; assertReleased(2);
  reset(); let finishFetch;
  globalThis.fetch = () => new Promise(resolve => { finishFetch = () => resolve({ ok: true, json: async () => asset }); });
  await act(async () => { tree = TestRenderer.create(React.createElement(CottonPet, { compact: true }), { createNodeMock: () => canvas }); await settle(); });
  assert.equal(typeof finishFetch, 'function');
  await act(async () => tree.unmount()); tree = null;
  await act(async () => { finishFetch(); await settle(); }); assertReleased(0);
  console.log('Cotton runtime: real model/controller/props, mocked GPU; initialization rollback, exact-once scene cleanup, app/OS static idle, finite care actions, lazy visible-rest gain without RAF, pause/hidden exclusion, live motion changes, context loss, React error retry and late-load unmount passed. Simulated RAF is not device FPS.');
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  disposers.forEach(restore => restore());
  for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
}
