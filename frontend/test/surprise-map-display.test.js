import test from "node:test";
import assert from "node:assert/strict";
import { coarseMapCenter, displayMapArea, mountSurpriseMap, SURPRISE_MAP_TILES } from "../src/surprise-map-display.js";

const letter = { id: "letter-fixture", title: '<img onerror="fixture">', body: "PRIVATE_BODY_FIXTURE", area: { latitude: 31.23456, longitude: 121.45678, radius_m: 300 } };
function fakeLibrary() {
  const calls = [], circles = [], handlers = {}, layers = new Set();
  const map = { setView: (...args) => { calls.push(["view", ...args]); return map; }, fitBounds: (...args) => calls.push(["fit", ...args]),
    invalidateSize: options => calls.push(["resize", options]), hasLayer: layer => layers.has(layer), removeLayer: layer => layers.delete(layer),
    remove: () => calls.push(["remove"]), attributionControl: { setPrefix: value => calls.push(["prefix", value]) } };
  const tile = { on: (name, callback) => { handlers[name] = callback; }, addTo: () => { layers.add(tile); handlers.loading?.(); return tile; }, off: () => calls.push(["off"]) };
  const group = { addTo: () => group, clearLayers: () => { circles.splice(0); }, getBounds: () => circles.map(circle => [circle.point, circle.options.radius]) };
  const library = { map: (_host, options) => { calls.push(["map", options]); return map; }, tileLayer: (url, options) => { calls.push(["tiles", url, options]); return tile; }, featureGroup: () => group,
    control: { zoom: options => ({ addTo: () => calls.push(["zoom", options]) }) },
    circle: (point, options) => { const events = {}, attributes = {}, listeners = {}; const circle = {
      on: (name, callback) => { events[name] = callback; }, getElement: () => ({ setAttribute: (key, value) => { attributes[key] = value; }, addEventListener: (key, value) => { listeners[key] = value; } }),
      addTo: () => { circles.push({ point, options, attributes, listeners, events }); events.add?.(); return circle; },
      getBounds: () => [point, options.radius],
    }; return circle; } };
  return { calls, circles, handlers, layers, library };
}
const fakeDocument = () => { const events = new Map(); return { hidden: false, events, addEventListener: (key, value) => events.set(key,value), removeEventListener: key => events.delete(key) }; };

test("map display rejects invalid receipts, clamps poles and coarsens GPS without mutating it", () => {
  const position = Object.freeze({ latitude: 31.23456789, longitude: 121.45678901, accuracy: 5, captured_at: "PRIVATE_TIME" });
  assert.deepEqual(coarseMapCenter(position), { latitude: 31.23, longitude: 121.46 });
  assert.deepEqual(coarseMapCenter({ latitude: 0, longitude: 0 }), { latitude: 0, longitude: 0 });
  assert.equal(displayMapArea({ latitude: 91, longitude: 0, radius_m: 300 }), null);
  assert.equal(displayMapArea({ latitude: 0, longitude: 0, radius_m: -1 }), null);
  assert.equal(displayMapArea({ latitude: 0, longitude: 0, radius_m: Infinity }), null);
  assert.equal(coarseMapCenter({ latitude: 0, longitude: 181 }), null);
  assert.equal(displayMapArea({ latitude: 90, longitude: 180, radius_m: 300 }).latitude, 85.0511);
});
test("lazy initialization draws bounded letter areas, no private body or exact GPS reaches the map library", async () => {
  const fixture = fakeLibrary(), selected = [], documentObject = fakeDocument();
  const runtime = mountSurpriseMap({}, { load: async () => fixture.library, documentObject, onSelect: id => selected.push(id) });
  runtime.update({ items: [letter], position: { latitude: 31.23456789, longitude: 121.45678901 }, selectedId: null });
  await runtime.ready;
  assert.equal(fixture.calls.find(call => call[0] === "tiles")[1], SURPRISE_MAP_TILES);
  const options = fixture.calls.find(call => call[0] === "tiles")[2];
  assert.equal(options.keepBuffer, 0); assert.equal(options.updateWhenIdle, true); assert.match(options.attribution, /OpenStreetMap/);
  assert.equal(options.referrerPolicy, "strict-origin-when-cross-origin");
  assert.deepEqual(fixture.calls.filter(call => call[0] === "view").at(-1)[1], [31.23, 121.46]);
  assert.doesNotMatch(JSON.stringify(fixture.calls), /PRIVATE_BODY_FIXTURE|31\.23456789|121\.45678901/);
  const circle = fixture.circles[0]; assert.equal(circle.attributes.role, "button"); assert.equal(circle.attributes.tabindex, "0");
  assert.match(circle.attributes["aria-label"], /<img/); // Plain attribute text, never an HTML popup.
  circle.events.click(); circle.listeners.keydown({ key: "Enter", preventDefault() {} });
  assert.deepEqual(selected, [letter.id, letter.id]); runtime.destroy();
});
test("closing before a delayed library load cannot create a map or request tiles", async () => {
  const fixture = fakeLibrary(), statuses = []; let resolve;
  const pending = new Promise(done => { resolve = done; });
  const runtime = mountSurpriseMap({}, { load: () => pending, onStatus: value => statuses.push(value) });
  runtime.destroy(); resolve(fixture.library); await runtime.ready;
  assert.equal(fixture.calls.length, 0); assert.deepEqual(statuses, []);
});
test("the loading deadline also covers a stalled map module download", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = fakeLibrary(), statuses = []; let resolve;
  const pending = new Promise(done => { resolve = done; });
  const runtime = mountSurpriseMap({}, { load: () => pending, onStatus: value => statuses.push(value) });
  await Promise.resolve(); context.mock.timers.tick(18000);
  assert.equal(statuses.at(-1), "timeout"); runtime.destroy(); resolve(fixture.library); await runtime.ready;
  assert.equal(fixture.calls.length, 0);
});
test("map resources pause offscreen and in the background, then detach on unmount", async () => {
  const fixture = fakeLibrary(), documentObject = fakeDocument(), callbacks = {}, disconnected = [];
  class Resize { constructor(callback) { callbacks.resize = callback; } observe() {} disconnect() { disconnected.push("resize"); } }
  class Intersection { constructor(callback) { callbacks.intersection = callback; } observe() {} disconnect() { disconnected.push("intersection"); } }
  const runtime = mountSurpriseMap({}, { load: async () => fixture.library, documentObject, ResizeObserverClass: Resize, IntersectionObserverClass: Intersection });
  await runtime.ready; assert.equal(fixture.layers.size, 1);
  callbacks.intersection([{ isIntersecting: false }]); assert.equal(fixture.layers.size, 0);
  callbacks.intersection([{ isIntersecting: true }]); assert.equal(fixture.layers.size, 1);
  documentObject.hidden = true; documentObject.events.get("visibilitychange")(); assert.equal(fixture.layers.size, 0);
  documentObject.hidden = false; documentObject.events.get("visibilitychange")(); assert.equal(fixture.layers.size, 1);
  callbacks.resize(); assert.ok(fixture.calls.some(call => call[0] === "resize"));
  runtime.destroy(); runtime.destroy(); assert.equal(documentObject.events.size, 0);
  assert.deepEqual(disconnected.sort(), ["intersection", "resize"]); assert.equal(fixture.calls.filter(call => call[0] === "remove").length, 1);
});
test("tile failures are reported without exposing a raw provider error", async () => {
  const fixture = fakeLibrary(), statuses = [];
  const runtime = mountSurpriseMap({}, { load: async () => fixture.library, documentObject: fakeDocument(), onStatus: value => statuses.push(value) });
  await runtime.ready; fixture.handlers.tileerror({ message: "PRIVATE_PROVIDER_ERROR" }); assert.equal(statuses.at(-1), "unavailable");
  fixture.handlers.load(); assert.equal(statuses.at(-1), "unavailable");
  fixture.handlers.loading(); fixture.handlers.load(); assert.equal(statuses.at(-1), "ready");
  runtime.destroy(); fixture.handlers.load(); assert.equal(statuses.at(-1), "ready");
  const failed = mountSurpriseMap({}, { load: async () => { throw Error("PRIVATE_PROVIDER_ERROR"); }, onStatus: value => statuses.push(value) });
  await failed.ready; assert.equal(statuses.at(-1), "failed"); failed.destroy();
});
test("selecting a letter focuses only its blurred area; viewing all does not request location", async () => {
  const fixture = fakeLibrary(), runtime = mountSurpriseMap({}, { load: async () => fixture.library, documentObject: fakeDocument() });
  runtime.update({ items: [letter], position: null, selectedId: letter.id }); await runtime.ready;
  assert.deepEqual(fixture.calls.filter(call => call[0] === "fit").at(-1)[1], [[letter.area.latitude, letter.area.longitude], letter.area.radius_m]);
  runtime.fit(); assert.deepEqual(fixture.calls.filter(call => call[0] === "fit").at(-1)[1], [[[letter.area.latitude, letter.area.longitude], letter.area.radius_m]]); runtime.destroy();
});
