import test from 'node:test';
import assert from 'node:assert/strict';
import { ambientCacheStorage, readEnabledAmbientCache, storeCachedCoordinates, storeCachedWeather, clearCachedWeather, storeAmbientPreferences, buildAmbientContext } from '../src/ambient-context.js';

function fixture() {
  const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) };
  storeCachedCoordinates({ latitude: 31, longitude: 121 }, storage);
  storeCachedWeather({ temperatureC: 20, weatherCode: 65 }, storage);
  return { data, storage };
}
test('shared coordinates cannot implicitly authorize a new account', () => {
  const { data, storage } = fixture();
  const before = [...data];
  const result = readEnabledAmbientCache(storage, 'new-account');
  assert.equal(result.preferences.enabled, false);
  assert.equal(result.coordinates.coordinates, null);
  assert.equal(result.weather.weather, null);
  assert.deepEqual([...data], before);
});
test('explicit consent is required per account and denial hides cached data', () => {
  const { storage } = fixture();
  storeAmbientPreferences({ enabled: true }, storage, 'account-a');
  storeCachedWeather({ temperatureC: 20, weatherCode: 65 }, ambientCacheStorage(storage, 'account-a'));
  assert.ok(readEnabledAmbientCache(storage, 'account-a').weather.weather);
  assert.equal(readEnabledAmbientCache(storage, 'account-b').weather.weather, null);
  storeAmbientPreferences({ enabled: true, permissionDenied: true }, storage, 'account-a');
  assert.equal(readEnabledAmbientCache(storage, 'account-a').coordinates.coordinates, null);
});

test('two consenting accounts keep independent locations and weather', () => {
  const { storage } = fixture();
  for (const account of ['a', 'b']) storeAmbientPreferences({ enabled: true }, storage, account);
  const a = ambientCacheStorage(storage, 'a');
  const b = ambientCacheStorage(storage, 'b');
  storeCachedCoordinates({ latitude: 31, longitude: 121 }, a);
  storeCachedCoordinates({ latitude: 40, longitude: 116 }, b);
  storeCachedWeather({ temperatureC: 20, weatherCode: 65 }, a);
  storeCachedWeather({ temperatureC: 10, weatherCode: 0 }, b);
  assert.equal(readEnabledAmbientCache(storage, 'a').weather.weather.temperatureC, 20);
  assert.equal(readEnabledAmbientCache(storage, 'b').weather.weather.temperatureC, 10);
  assert.equal(readEnabledAmbientCache(storage, 'b').coordinates.coordinates.latitude, 40);
  clearCachedWeather(a);
  assert.equal(readEnabledAmbientCache(storage, 'a').weather.weather, null);
  assert.equal(readEnabledAmbientCache(storage, 'b').weather.weather.temperatureC, 10);
});

test('an enabled new account does not adopt another account legacy global cache', () => {
  const { data, storage } = fixture();
  storeAmbientPreferences({ enabled: true }, storage, 'new');
  const before = [...data];
  const state = readEnabledAmbientCache(storage, 'new');
  assert.equal(state.weather.weather, null);
  assert.equal(state.coordinates.coordinates, null);
  assert.deepEqual([...data], before);
});
test('disabled location never exposes old weather in the ambient context', () => {
  const result = buildAmbientContext({ clock: { time: '12:00', date: '2026-10-14' }, weather: { temperatureC: 20, description: '大雨' }, locationEnabled: false });
  assert.equal(result.weather, null);
  assert.equal(result.locationEnabled, false);
});
