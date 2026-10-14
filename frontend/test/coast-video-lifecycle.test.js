import assert from "node:assert/strict";
import test from "node:test";
import { coastSceneForSky, createCoastVideoLifecycle } from "../src/coast-video-lifecycle.js";

function fixture({ hidden = false, reducedMotion = false, saveData = false, getBattery } = {}) {
  const documentObject = Object.assign(new EventTarget(), { hidden, documentElement: { dataset: {} } });
  const windowObject = new EventTarget();
  const media = Object.assign(new EventTarget(), { matches: reducedMotion });
  windowObject.matchMedia = () => media;
  const connection = Object.assign(new EventTarget(), { saveData });
  const navigatorObject = { connection, ...(getBattery ? { getBattery } : {}) };
  const attributes = new Map();
  const calls = { load: 0, play: 0, pause: 0 };
  const video = Object.assign(new EventTarget(), {
    getAttribute: name => attributes.get(name) || null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    load: () => { calls.load++; },
    play: () => { calls.play++; return Promise.resolve(); },
    pause: () => { calls.pause++; },
  });
  let custom = false, settings = false;
  const applicationRoot = { querySelector: () => custom ? {} : null, classList: { contains: () => settings } };
  const states = [], observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const lifecycle = createCoastVideoLifecycle(video, {
    source: "/fixture/coast.mp4", documentObject, windowObject, navigatorObject, applicationRoot,
    onState: state => states.push(state), MutationObserverClass: Observer,
  });
  return {
    lifecycle, calls, video, attributes, states, documentObject, windowObject, media, connection, observers, applicationRoot,
    custom(value) { custom = value; observers[1].callback([{ target: applicationRoot }]); },
    settings(value) { settings = value; observers[1].callback([{ target: applicationRoot }]); },
  };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("coast clips follow the location-adjusted solar minute rather than a fixed wall-clock day", () => {
  assert.equal(coastSceneForSky({ minute: 720, solarMinute: 300 }), "night");
  assert.equal(coastSceneForSky({ minute: 120, solarMinute: 720 }), "day");
  for (const minute of [400, 480, 1030, 1180]) assert.equal(coastSceneForSky({ solarMinute: minute }), "twilight");
  assert.equal(coastSceneForSky({}), "day");
});

for (const options of [{ hidden: true }, { reducedMotion: true }, { saveData: true }]) {
  test(`no decorative media download or decoder is started under ${Object.keys(options)[0]}`, async () => {
    const f = fixture(options);
    await flush();
    assert.equal(f.attributes.has("src"), false);
    assert.equal(f.calls.load, 0);
    assert.equal(f.calls.play, 0);
    assert.equal(f.states.at(-1), "static");
    f.lifecycle.dispose();
  });
}

test("foreground resume preserves one clip and does not stack play attempts", async () => {
  const f = fixture();
  await flush();
  assert.equal(f.calls.play, 1);
  f.lifecycle.synchronize();
  f.lifecycle.synchronize();
  await flush();
  assert.equal(f.calls.play, 1);
  f.video.dispatchEvent(new Event("playing"));
  assert.equal(f.states.at(-1), "playing");
  f.documentObject.hidden = true;
  f.documentObject.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.states.at(-1), "static");
  const loads = f.calls.load;
  f.documentObject.hidden = false;
  f.documentObject.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(f.calls.play, 2);
  assert.equal(f.calls.load, loads);
  assert.equal(f.video.muted, true);
  assert.equal(f.video.defaultMuted, true);
  f.lifecycle.dispose();
});

test("custom chat background releases the decorative decoder and restores after removal", async () => {
  const f = fixture();
  await flush();
  f.video.dispatchEvent(new Event("playing"));
  f.custom(true);
  assert.equal(f.attributes.has("src"), false);
  assert.equal(f.states.at(-1), "static");
  const plays = f.calls.play;
  f.custom(true);
  await flush();
  assert.equal(f.calls.play, plays);
  f.custom(false);
  await flush();
  assert.equal(f.calls.play, plays + 1);
  f.lifecycle.dispose();
});

test("opening settings yields video work without downloading another scene", async () => {
  const f = fixture();
  await flush();
  f.video.dispatchEvent(new Event("playing"));
  const loads = f.calls.load;
  f.settings(true);
  assert.equal(f.states.at(-1), "static");
  f.settings(false);
  await flush();
  assert.equal(f.calls.play, 2);
  assert.equal(f.calls.load, loads);
  f.lifecycle.dispose();
});

test("autoplay denial returns a static poster and cannot retry endlessly", async () => {
  const f = fixture();
  f.video.play = () => { f.calls.play++; return Promise.reject(Error("fixture autoplay denied")); };
  await flush();
  assert.equal(f.states.at(-1), "error");
  assert.equal(f.attributes.has("src"), false);
  f.lifecycle.synchronize();
  f.documentObject.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(f.calls.play, 1);
  f.lifecycle.dispose();
});

test("a delayed old play rejection cannot clear a new scene's source", async () => {
  const f = fixture();
  let rejectPlay;
  f.video.play = () => new Promise((resolve, reject) => { rejectPlay = reject; });
  await flush();
  const states = f.states.length;
  f.lifecycle.dispose();
  f.video.setAttribute("src", "/fixture/new-scene.mp4");
  rejectPlay(Error("old source aborted"));
  await flush();
  assert.equal(f.video.getAttribute("src"), "/fixture/new-scene.mp4");
  assert.equal(f.states.length, states);
});

test("late battery receipt cannot add listeners or revive a disposed backdrop", async () => {
  let resolveBattery;
  const f = fixture({ getBattery: () => new Promise(resolve => { resolveBattery = resolve; }) });
  await flush();
  f.lifecycle.dispose();
  const plays = f.calls.play;
  const battery = Object.assign(new EventTarget(), { level: 0.1, charging: false });
  resolveBattery(battery);
  await flush();
  battery.dispatchEvent(new Event("chargingchange"));
  assert.equal(f.calls.play, plays);
  assert.equal(f.attributes.has("src"), false);
  assert.ok(f.observers.every(observer => observer.disconnected));
});

test("low battery returns the poster and charging resumes playback", async () => {
  const battery = Object.assign(new EventTarget(), { level: 0.15, charging: false });
  const f = fixture({ getBattery: () => Promise.resolve(battery) });
  await flush();
  assert.equal(f.states.at(-1), "static");
  assert.equal(f.attributes.has("src"), false);
  battery.charging = true;
  battery.dispatchEvent(new Event("chargingchange"));
  await flush();
  assert.equal(f.attributes.get("src"), "/fixture/coast.mp4");
  f.lifecycle.dispose();
  const count = f.calls.play;
  battery.dispatchEvent(new Event("levelchange"));
  await flush();
  assert.equal(f.calls.play, count);
});

test("bfcache pagehide stops video until pageshow, including when visibility remains visible", async () => {
  const f = fixture();
  await flush();
  f.video.dispatchEvent(new Event("playing"));
  f.windowObject.dispatchEvent(new Event("pagehide"));
  assert.equal(f.states.at(-1), "static");
  f.lifecycle.synchronize();
  await flush();
  assert.equal(f.calls.play, 1);
  f.windowObject.dispatchEvent(new Event("pageshow"));
  await flush();
  assert.equal(f.calls.play, 2);
  f.lifecycle.dispose();
});
