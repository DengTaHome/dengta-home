import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';
import { ambientCacheStorage, storeAmbientPreferences, storeCachedCoordinates, storeCachedWeather } from '../src/ambient-context.js';

const original = new Map(['navigator', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let renderer, position, requests, contexts;
const vite = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
const Badge = (await vite.ssrLoadModule('/src/AmbientContextBadge.jsx')).default;
test.beforeEach(() => {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, geolocation: { getCurrentPosition(success, failure) { position = { success, failure }; } } } });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  storeAmbientPreferences({ enabled: true }, storage, 'fixture-account');
  const cache = ambientCacheStorage(storage, 'fixture-account');
  storeCachedCoordinates({ latitude: 40, longitude: 116 }, cache, 0);
  storeCachedWeather({ temperatureC: 10, weatherCode: 65 }, cache, 0);
  position = null; requests = []; contexts = [];
});
test.afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
test.after(async () => {
  await vite.close();
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
async function mount(onLoadWeather) {
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Badge, { accountScope: 'fixture-account', onLoadWeather, onContextChange: value => contexts.push(value) }));
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.ok(position, 'stale coordinates must request a fresh OS position');
}
test('real badge requests coarse coordinates and does not retain another location weather on failure', async () => {
  await mount(async coordinates => { requests.push(coordinates); throw Error('fixture weather offline'); });
  await act(async () => position.success({ coords: { latitude: 31.234567, longitude: 121.478912, accuracy: 50 } }));
  assert.deepEqual(requests, [{ latitude: 31.23, longitude: 121.48 }]);
  assert.equal(contexts.at(-1).weather, null);
});
test('real badge removes cached weather from the displayed context after permission is revoked', async () => {
  await mount(async () => { requests.push('unexpected'); return { temperatureC: 20 }; });
  await act(async () => position.failure({ code: 1 }));
  assert.equal(contexts.at(-1).locationEnabled, false);
  assert.equal(contexts.at(-1).weather, null);
  assert.deepEqual(requests, []);
});
