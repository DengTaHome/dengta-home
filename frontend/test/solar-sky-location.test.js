import test from 'node:test';
import assert from 'node:assert/strict';
import { solarSkyMinute, getSunGlassSky } from '../src/sun-glass-sky.js';

const summer = { sunrise: '2026-06-21T21:00:00Z', sunset: '2026-06-22T11:00:00Z' };
test('location sunrise, noon and sunset align with the background trajectory', () => {
  assert.equal(solarSkyMinute(300, summer), 450);
  assert.equal(solarSkyMinute(720, summer), 810);
  assert.equal(solarSkyMinute(1140, summer), 1170);
  assert.equal(getSunGlassSky(720, summer).sunX, 50);
});
test('solar mapping stays continuous across midnight', () => {
  assert.ok(Math.abs(solarSkyMinute(1439, summer) - solarSkyMinute(0, summer)) < 2);
  const before = getSunGlassSky(1439, summer);
  const after = getSunGlassSky(0, summer);
  assert.ok(Math.abs(before.moonX - after.moonX) < 1);
});
test('missing or invalid schedules preserve the existing fallback', () => {
  assert.equal(solarSkyMinute(720), 720);
  assert.equal(solarSkyMinute(720, { sunrise: 'invalid', sunset: 'invalid' }), 720);
  assert.equal(solarSkyMinute(720, { sunrise: summer.sunset, sunset: summer.sunrise }), 720);
});

test('real clock labels remain independent of the solar animation clock', () => {
  const sky = getSunGlassSky(720, summer);
  assert.equal(sky.minute, 720);
  assert.equal(sky.solarMinute, 810);
});

test('the located sun disappears below the horizon instead of lingering after sunset', () => {
  for (const minute of [299, 300, 1140, 1141, 0]) {
    assert.equal(getSunGlassSky(minute, summer).sunOpacity, 0);
  }
  assert.ok(getSunGlassSky(301, summer).sunOpacity > 0);
  assert.ok(getSunGlassSky(1139, summer).sunOpacity > 0);
  assert.equal(getSunGlassSky(720, summer).sunOpacity, 1);
});
