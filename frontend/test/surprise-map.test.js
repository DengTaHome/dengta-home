import test from "node:test";
import assert from "node:assert/strict";
import { locateForSurpriseMap, validMapLocation, mapRadarPoint, surpriseMapError } from "../src/surprise-map.js";

test("manual geolocation preserves zero coordinates, real accuracy and observation time", async () => {
  const time = Date.parse("2026-10-16T00:00:00Z"); let reads = 0;
  const value = await locateForSurpriseMap({ capacitor: {}, now: () => time, geolocation: {
    getCurrentPosition(resolve, reject, options) { reads++; assert.equal(options.maximumAge, 0); assert.equal(options.enableHighAccuracy, true);
      resolve({ coords: { latitude: 0, longitude: 0, accuracy: 12 }, timestamp: time - 1000 }); },
  } });
  assert.equal(reads, 1); assert.equal(value.latitude, 0); assert.equal(value.longitude, 0); assert.equal(value.accuracy, 12);
  assert.equal(value.captured_at, new Date(time - 1000).toISOString());
  assert.equal(validMapLocation({ latitude: null, longitude: 0, accuracy: 10 }), false);
  assert.equal(validMapLocation({ latitude: 0, longitude: 0, accuracy: null }), false);
});
test("denied, stale and incomplete native location cannot masquerade as a fresh success", async () => {
  const time = Date.parse("2026-10-16T00:00:00Z");
  const native = location => ({ isPluginAvailable: () => true, Plugins: { Whereabouts: {
    requestPermissions: async () => ({ granted: true }), getLocation: async () => location,
  } } });
  await assert.rejects(locateForSurpriseMap({ now: () => time, capacitor: native({ latitude: 0, longitude: 0, accuracy: 10, timestamp: new Date(time - 130000).toISOString() }) }), { code: "surprise_map_location_stale" });
  await assert.rejects(locateForSurpriseMap({ now: () => time, capacitor: native({ latitude: 0, longitude: 0, accuracy: null, timestamp: time }) }), { code: "surprise_map_location_invalid" });
  const capacitor = native({}); capacitor.Plugins.Whereabouts.requestPermissions = async () => ({ granted: false });
  await assert.rejects(locateForSurpriseMap({ capacitor }), { code: "location_permission_denied" });
  await assert.rejects(locateForSurpriseMap({ capacitor: {}, geolocation: { getCurrentPosition: (_, reject) => reject({ code: 1 }) } }), { code: "location_permission_denied" });
});
test("radar positions stay bounded and error feedback cannot expose raw causes", () => {
  for (const area of [{ latitude: 0, longitude: 0 }, { latitude: 89, longitude: 179 }, { latitude: -90, longitude: -180 }]) {
    const point = mapRadarPoint(area, { latitude: 0, longitude: 0 });
    assert.ok(point.x >= 10 && point.x <= 90 && point.y >= 10 && point.y <= 90);
  }
  assert.equal(mapRadarPoint({ latitude: NaN, longitude: 0 }), null);
  assert.doesNotMatch(surpriseMapError({ message: "PRIVATE_FIXTURE", code: "surprise_map_out_of_range" }), /PRIVATE_FIXTURE/);
});
