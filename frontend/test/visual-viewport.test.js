import test from "node:test";
import assert from "node:assert/strict";
import { installVisualViewportController } from "../src/mobile-viewport.js";

function fixture() {
  const listeners = new Map(), frames = new Map(), writes = [], flags = []; let nextFrame = 0;
  const target = name => ({ addEventListener: (event, fn) => listeners.set(`${name}:${event}`, fn), removeEventListener: event => listeners.delete(`${name}:${event}`) });
  const dataset = new Proxy({}, { set(object, key, value) { flags.push(value); object[key] = value; return true; } });
  const root = { dataset, style: { setProperty: (key, value) => writes.push([key, value]) } };
  const viewport = { ...target("viewport"), height: 844, width: 390, offsetTop: 0, scale: 1 };
  const windowObject = { ...target("window"), visualViewport: viewport, innerHeight: 844, innerWidth: 390, scrollY: 0,
    requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id), scrollTo() { this.scrollY = 0; } };
  const documentObject = { ...target("document"), documentElement: root, activeElement: null };
  const fire = (name, event) => listeners.get(`${name}:${event}`)?.();
  const flush = () => { for (const [id, fn] of [...frames]) { frames.delete(id); fn(); } };
  return { root, viewport, windowObject, documentObject, writes, flags, frames, listeners, fire, flush };
}
const editable = { matches: () => true };
test("focusout during keyboard dismissal cannot flash the full-height page and capsule", () => {
  const f = fixture(), stop = installVisualViewportController(f);
  f.documentObject.activeElement = editable; f.viewport.height = 500;
  f.fire("viewport", "resize"); f.flush(); assert.equal(f.root.dataset.keyboardOpen, "true");
  f.documentObject.activeElement = null; f.fire("document", "focusout"); f.flush();
  assert.equal(f.root.dataset.keyboardOpen, "true"); assert.equal(f.writes.at(-1)[1], "500px");
  f.documentObject.activeElement = editable; f.fire("document", "focusin"); f.flush();
  assert.deepEqual(f.flags, ["false", "true"]);
  f.viewport.height = 844; f.fire("viewport", "resize"); f.flush();
  assert.equal(f.root.dataset.keyboardOpen, "false"); assert.equal(f.writes.at(-1)[1], "844px"); stop();
});
test("offsetTop cannot cancel keyboard height loss and the threshold has a closing hysteresis", () => {
  const f = fixture(), stop = installVisualViewportController(f);
  f.documentObject.activeElement = editable; f.viewport.height = 500; f.viewport.offsetTop = 300;
  f.fire("viewport", "resize"); f.flush(); assert.equal(f.root.dataset.keyboardOpen, "true");
  f.viewport.offsetTop = 0; f.viewport.height = 770; f.fire("viewport", "resize"); f.flush();
  assert.equal(f.root.dataset.keyboardOpen, "true");
  f.viewport.height = 844; f.fire("viewport", "resize"); f.flush(); assert.equal(f.root.dataset.keyboardOpen, "false"); stop();
});
test("event bursts coalesce into one frame and identical viewport sizes perform no extra style writes", () => {
  const f = fixture(), stop = installVisualViewportController(f), initial = f.writes.length;
  for (let i = 0; i < 30; i++) { f.fire("viewport", "resize"); f.fire("viewport", "scroll"); f.fire("window", "resize"); }
  assert.equal(f.frames.size, 1); f.flush(); assert.equal(f.writes.length, initial);
  f.fire("viewport", "scroll"); stop(); assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, 0);
  assert.equal(f.root.dataset.keyboardOpen, undefined);
});
test("desktop resize can shrink the baseline and pinch zoom cannot resize the app layout", () => {
  const f = fixture(), stop = installVisualViewportController(f);
  f.viewport.height = 650; f.windowObject.innerHeight = 650; f.fire("window", "resize"); f.flush();
  assert.equal(f.writes.at(-1)[1], "650px");
  const before = f.writes.length; f.viewport.scale = 1.3; f.viewport.height = 300; f.fire("viewport", "resize"); f.flush();
  assert.equal(f.writes.length, before); stop();
});
test("legacy WebView fallback coalesces keyboard events and keeps the closing hysteresis", () => {
  const f = fixture(); delete f.windowObject.visualViewport;
  const stop = installVisualViewportController(f);
  f.documentObject.activeElement = editable; f.windowObject.innerHeight = 510;
  for (let index = 0; index < 30; index++) { f.fire("window", "resize"); f.fire("document", "focusin"); }
  assert.equal(f.frames.size, 1); f.flush(); assert.equal(f.root.dataset.keyboardOpen, "true");
  const writes = f.writes.length;
  f.documentObject.activeElement = null; f.fire("document", "focusout"); f.flush();
  assert.equal(f.writes.length, writes); assert.equal(f.root.dataset.keyboardOpen, "true");
  f.windowObject.innerHeight = 760; f.fire("window", "resize"); f.flush();
  assert.equal(f.root.dataset.keyboardOpen, "true"); assert.equal(f.writes.at(-1)[1], "760px");
  f.windowObject.innerHeight = 844; f.fire("window", "resize"); f.flush();
  assert.deepEqual(f.flags, ["false", "true", "false"]);
  f.fire("window", "resize"); stop(); assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, 0);
});
test("fallback desktop resize shrinks correctly and editable focus never forces a document scroll", () => {
  const f = fixture(); delete f.windowObject.visualViewport;
  const stop = installVisualViewportController(f);
  f.windowObject.innerHeight = 650; f.fire("window", "resize"); f.flush(); assert.equal(f.writes.at(-1)[1], "650px");
  f.documentObject.activeElement = editable; f.windowObject.scrollY = 25;
  f.fire("document", "focusin"); f.flush(); assert.equal(f.windowObject.scrollY, 25);
  stop();
});
test("transient zero or invalid viewport heights do not collapse either keyboard layout", () => {
  for (const legacy of [false, true]) {
    const f = fixture(); if (legacy) delete f.windowObject.visualViewport;
    const stop = installVisualViewportController(f), initial = f.writes.length;
    for (const value of [0, -1, NaN, Infinity]) {
      if (legacy) f.windowObject.innerHeight = value; else f.viewport.height = value;
      f.fire(legacy ? "window" : "viewport", "resize"); f.flush();
    }
    assert.equal(f.writes.length, initial); stop();
  }
});
