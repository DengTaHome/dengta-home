import test from 'node:test';
import assert from 'node:assert/strict';
import { rainIntensityFromAmbient, weatherModeFromAmbient } from '../src/sun-glass-sky.js';

test('light and heavy WMO rainfall have distinct bounded visual intensity', () => {
  assert.equal(rainIntensityFromAmbient({ weatherCode: 61 }), .5);
  assert.equal(rainIntensityFromAmbient({ weatherCode: 63 }), 1);
  assert.equal(rainIntensityFromAmbient({ weatherCode: 65 }), 1.6);
  assert.equal(rainIntensityFromAmbient({ weatherCode: 82 }), 1.6);
});
test('heavy rain stays rain, rather than becoming a lightning storm', () => {
  for (const weather of [{ weatherCode: 65 }, { description: '暴雨' }, { description: 'Heavy rain' }]) {
    assert.equal(weatherModeFromAmbient(weather), 'rain');
    assert.equal(rainIntensityFromAmbient(weather), 1.6);
  }
  assert.equal(weatherModeFromAmbient({ weatherCode: 95 }), 'storm');
});
test('description fallbacks and missing weather remain usable', () => {
  assert.equal(rainIntensityFromAmbient({ description: '小雨' }), .5);
  assert.equal(rainIntensityFromAmbient({ description: 'drizzle' }), .5);
  assert.equal(rainIntensityFromAmbient(null), 1);
  assert.equal(rainIntensityFromAmbient({ weatherCode: 'invalid' }), 1);
});
