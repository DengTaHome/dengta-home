import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createServer } from 'vite';
import { petStorageKey, readPetState, savePetState } from '../src/cotton/pet-state.js';
import { B1857Character } from '../src/cotton/upstream/b1857-character.js';
import { InteractionController } from '../src/cotton/upstream/interaction-controller.js';

const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const a = petStorageKey('account-a', 'companion'), b = petStorageKey('account-b', 'companion');
assert.notEqual(a, b);
assert.notEqual(a, petStorageKey('account-a', 'other'));
assert.notEqual(petStorageKey('a:b', 'c'), petStorageKey('a', 'b:c'));
assert.equal(petStorageKey('', 'companion'), null);
assert.equal(savePetState(storage, null, { mood: 10 }, false), false);
savePetState(storage, a, { mood: 80, water: Infinity, system_prompt: 'never store' }, true);
assert.deepEqual(readPetState(storage, a), { stats: { mood: 80 }, quiet: true });
assert.deepEqual(readPetState(storage, b), {});
assert.ok(!storage.getItem(a).includes('system_prompt'));
storage.setItem(b, '{invalid'); assert.deepEqual(readPetState(storage, b), {});
assert.equal(savePetState({ setItem() { throw Error(); } }, a, {}, false), false);
storage.setItem(b, JSON.stringify({ schema: 1, stats: { mood: '99', water: -20, energy: 200 } }));
assert.deepEqual(readPetState(storage, b).stats, { water: 0, energy: 100 });

const raw = readFileSync(new URL('../public/cotton/b1857.json', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../src/cotton/source-manifest.json', import.meta.url)));
assert.equal(createHash('sha256').update(raw).digest('hex'), manifest.modelSha256);
const character = new B1857Character({ asset: JSON.parse(raw) });
assert.equal(character.mesh.geometry.attributes.position.count, 49853);
const controller = new InteractionController();
assert.equal(controller.request('feed').accepted, true);
assert.equal(controller.request('feed').accepted, false);
for (let i = 0; i < 80; i++) {
  controller.update(.1);
  character.setInteraction({ id: controller.active.id, age: controller.age, envelope: controller.envelope });
  character.update(.1);
}
assert.equal(controller.stats.satiety, 78, 'food is counted exactly once at completed intake');
assert.equal(controller.active.id, 'idle');
assert.equal(controller.request('rest').accepted, true);
assert.equal(controller.request('wake').accepted, true);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.localStorage = storage;
const vite = await createServer({ root: new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
  const { default: CottonPet } = await vite.ssrLoadModule('/src/CottonPet.jsx');
  let tree;
  await act(async () => { tree = TestRenderer.create(React.createElement(CottonPet, { accountScope: 'account-a', companionScope: 'companion' })); });
  assert.equal(tree.root.findAllByType('canvas').length, 0, 'model rendering is explicitly opt-in');
  assert.equal(tree.root.findAllByProps({ 'aria-pressed': true }).length, 1);
  await act(async () => tree.update(React.createElement(CottonPet, { accountScope: 'account-c', companionScope: 'companion' })));
  assert.equal(tree.root.findAllByProps({ 'aria-pressed': true }).length, 0, 'changing account remounts independent local state');
  await act(async () => tree.unmount());
} finally { await vite.close(); delete globalThis.localStorage; }
console.log('Cotton model identity, one-time care effects, account isolation, opt-in loading and component remount passed');
