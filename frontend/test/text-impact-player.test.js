import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { measureTextImpactGlyphs, playTextImpact, stopTextImpact } from "../src/text-impact-player.js";

const originals = new Map(["window", "document", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let fixture;
class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type) { for (const callback of [...(this.listeners.get(type) || [])]) callback({ type }); }
  get listenerCount() { return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0); }
}
const rectangle = (left = 20, top = 40, width = 20, height = 20) => ({ left, top, width, height, right: left + width, bottom: top + height });
const classes = () => {
  const values = new Set();
  return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value) };
};
function makeFixture(text = "Hello，朋友🙂") {
  const frames = new Map(), canvases = [], observers = [], drawn = [], attributes = new Map();
  let frameId = 0, rangesDetached = 0, calls = 0;
  const scope = { dataset: { textImpactScope: "account-a:companion-a:conversation-a" } };
  const media = Object.assign(new Events(), { matches: false });
  const viewport = Object.assign(new Events(), { width: 390, height: 740 });
  const view = Object.assign(new Events(), {
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 3, visualViewport: viewport,
    performance: { now: () => 0 }, matchMedia: () => media,
    getComputedStyle: () => ({ fontStyle: "normal", fontWeight: "400", fontSize: "16px", fontFamily: "fixture-font", color: "rgb(17, 34, 51)" }),
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
  });
  const doc = Object.assign(new Events(), { defaultView: view, visibilityState: "visible", documentElement: { dataset: {} } });
  const source = {
    ownerDocument: doc, isConnected: true, textContent: text, classList: classes(),
    getClientRects: () => [rectangle()], getBoundingClientRect: () => rectangle(20, 40, 340, 140),
    closest: selector => selector === "[data-text-impact-scope]" ? scope : { classList: { contains: value => value === "assistant" } },
  };
  const node = { textContent: text, parentElement: source };
  const composer = { value: "Keep the unsent fixture ～🙂", getBoundingClientRect: () => rectangle(40, 650, 300, 48), closest: () => scope };
  let rectForRange = (_node, start) => rectangle(20 + (start % 14) * 20, 40 + Math.floor(start / 14) * 22);
  doc.createTreeWalker = root => {
    assert.equal(root, source, "only the selected message can supply particles");
    let visited = false;
    return { nextNode: () => visited ? null : (visited = true, node) };
  };
  doc.createRange = () => {
    let current, start;
    return { setStart(node, offset) { current = node; start = offset; }, setEnd() {},
      getBoundingClientRect() { calls++; return rectForRange(current, start); }, detach() { rangesDetached++; } };
  };
  doc.querySelectorAll = selector => selector === ".composer textarea" ? [composer] : [];
  doc.createElement = name => {
    assert.equal(name, "canvas");
    const context = { scale() {}, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, fillText: text => drawn.push(text) };
    const canvas = { style: {}, dataset: {}, removed: false,
      setAttribute: (name, value) => attributes.set(name, value), getContext: () => context,
      remove() { this.removed = true; const index = canvases.indexOf(this); if (index >= 0) canvases.splice(index, 1); } };
    return canvas;
  };
  doc.body = { appendChild: canvas => canvases.push(canvas) };
  return { source, node, composer, doc, view, media, viewport, frames, canvases, observers, drawn, attributes, scope,
    tick(now = 16) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)); },
    setRangeRect: callback => { rectForRange = callback; },
    get rangesDetached() { return rangesDetached; }, get measured() { return calls; } };
}
beforeEach(() => {
  stopTextImpact(); fixture = makeFixture();
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: fixture.doc }, window: { configurable: true, value: fixture.view },
    fetch: { configurable: true, value: () => assert.fail("a local text animation must not call any API") },
  });
});
afterEach(() => { stopTextImpact(); assert.equal(fixture.canvases.length, 0); assert.equal(fixture.frames.size, 0); });
after(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
const play = options => playTextImpact(fixture.source, { scopeKey: fixture.scope.dataset.textImpactScope, ...options });
const assertStopped = () => {
  assert.equal(fixture.canvases.length, 0); assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.source.classList.contains("text-impact-source-playing"), false);
  assert.equal(fixture.view.listenerCount + fixture.viewport.listenerCount + fixture.doc.listenerCount + fixture.media.listenerCount, 0);
  assert.ok(fixture.observers.every(observer => observer.disconnected));
};

test("measurement preserves graphemes and style and reads only the selected message", () => {
  fixture.node.textContent = "A👩🏽‍🚀e\u0301 中";
  const glyphs = measureTextImpactGlyphs(fixture.source, { width: 390, height: 740 });
  assert.deepEqual(glyphs.map(glyph => glyph.text), ["A", "👩🏽‍🚀", "e\u0301", "中"]);
  assert.equal(glyphs[0].font, "normal 400 16px fixture-font");
  assert.equal(glyphs[0].color, "rgb(17, 34, 51)");
  assert.equal(fixture.rangesDetached, 1);
  assert.equal(fixture.source.textContent, "Hello，朋友🙂");
});

test("measurement bounds expensive Range reads and skips offscreen glyphs", () => {
  fixture.node.textContent = "字".repeat(1000);
  fixture.setRangeRect((_node, start) => start < 300 ? rectangle(-200, -200) : rectangle());
  const glyphs = measureTextImpactGlyphs(fixture.source, { width: 390, height: 740, maximum: 1000 });
  assert.equal(fixture.measured, 320);
  assert.equal(glyphs.length, 20);
  fixture.setRangeRect(() => rectangle());
  assert.equal(measureTextImpactGlyphs(fixture.source, { width: 390, height: 740, maximum: 1000 }).length, 96);
});

test("manual playback uses one noninteractive canvas and leaves original text and composer untouched", async () => {
  const originalText = fixture.source.textContent, originalInput = fixture.composer.value;
  assert.equal((await play({ mode: "burst" })).started, true);
  assert.equal(fixture.canvases.length, 1); assert.equal(fixture.frames.size, 1);
  assert.equal(fixture.canvases[0].width, 780); assert.equal(fixture.canvases[0].height, 1480);
  assert.equal(fixture.attributes.get("aria-hidden"), "true");
  assert.match(fixture.canvases[0].style.cssText, /pointer-events:none/);
  fixture.tick(16); fixture.tick(32);
  assert.ok(fixture.drawn.length > 0);
  assert.equal(fixture.source.textContent, originalText); assert.equal(fixture.composer.value, originalInput);
});

test("repeat play replaces the canvas and RAF instead of accumulating render loops", async () => {
  const first = await play(); const oldCanvas = fixture.canvases[0];
  const second = await play({ mode: "burst", target: "avatar" });
  assert.equal(first.started, true); assert.equal(second.started, true);
  assert.equal(oldCanvas.removed, true); assert.equal(fixture.canvases.length, 1); assert.equal(fixture.frames.size, 1);
  first.stop(); assert.equal(fixture.canvases.length, 1, "a stale owner cannot stop its replacement");
  second.stop(); second.stop(); assertStopped();
});

test("a stop before the lazy engine resolves cancels the pending animation", async () => {
  const pending = play(); stopTextImpact();
  assert.deepEqual(await pending, { started: false, reason: "cancelled" }); assertStopped();
});

test("a page hidden during lazy import cannot create a background canvas", async () => {
  const pending = play(); fixture.doc.visibilityState = "hidden";
  assert.equal((await pending).started, false); assertStopped();
});

test("a foreign pane cannot provide the destination avatar or composer", async () => {
  const foreign = { closest: () => ({ dataset: { textImpactScope: "another-account:companion:conversation" } }),
    getBoundingClientRect: () => assert.fail("foreign-scope destinations must never be measured") };
  fixture.doc.querySelectorAll = () => [foreign];
  assert.equal((await play({ target: "avatar" })).started, true);
  stopTextImpact();
  assert.equal((await play({ target: "composer" })).started, true);
});

test("an unowned source cannot animate even if connected and visible", async () => {
  const previous = fixture.source.closest;
  fixture.source.closest = selector => selector === "[data-text-impact-scope]" ? null : previous(selector);
  assert.equal((await play()).started, false); assertStopped();
});

test("concurrent lazy starts retain only the newest animation", async () => {
  const first = play(); const second = play({ mode: "burst" });
  assert.equal((await first).started, false); assert.equal((await second).started, true);
  assert.equal(fixture.canvases.length, 1); assert.equal(fixture.frames.size, 1);
});

for (const setting of ["app", "os", "hidden", "disconnected", "foreign-scope", "empty"]) {
  test(`${setting} source cannot allocate a canvas or animation frame`, async () => {
    if (setting === "app") fixture.doc.documentElement.dataset.dengtaReducedMotion = "true";
    if (setting === "os") fixture.media.matches = true;
    if (setting === "hidden") fixture.doc.visibilityState = "hidden";
    if (setting === "disconnected") fixture.source.isConnected = false;
    if (setting === "foreign-scope") fixture.scope.dataset.textImpactScope = "another-account";
    if (setting === "empty") fixture.node.textContent = " \n\t";
    assert.equal((await play({ scopeKey: "account-a:companion-a:conversation-a" })).started, false);
    assertStopped();
  });
}

for (const [owner, event] of [["view", "resize"], ["view", "scroll"], ["viewport", "resize"], ["viewport", "scroll"], ["doc", "visibilitychange"], ["media", "change"]]) {
  test(`${owner} ${event} promptly removes canvas, RAF and every lifecycle listener`, async () => {
    assert.equal((await play()).started, true); fixture[owner].emit(event); assertStopped();
  });
}

test("source removal, owner change and hard timeout stop on the next frame", async () => {
  await play(); fixture.source.isConnected = false; fixture.tick(); assertStopped();
  fixture.source.isConnected = true; await play(); fixture.scope.dataset.textImpactScope = "replacement-scope"; fixture.tick(); assertStopped();
  fixture.scope.dataset.textImpactScope = "account-a:companion-a:conversation-a";
  await play(); fixture.tick(5600); assertStopped();
});

test("turning on app reduced motion immediately stops playback through its observer", async () => {
  await play(); fixture.doc.documentElement.dataset.dengtaReducedMotion = "true";
  fixture.observers[0].callback(); assertStopped();
});

test("canvas unavailability returns a recoverable result without hiding the source", async () => {
  const create = fixture.doc.createElement;
  fixture.doc.createElement = name => ({ ...create(name), getContext: () => null });
  assert.deepEqual(await play(), { started: false, reason: "canvas_unavailable" }); assertStopped();
});
