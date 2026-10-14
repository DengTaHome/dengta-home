import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { transformWithOxc } from "vite";
import { createVisualLoop } from "../src/visual-loop.js";
import { loadEntrypointCssCascade } from "./helpers/effective-css.js";

function fixture({ systemReduced = false, appReduced = false } = {}) {
  const documentObject = Object.assign(new EventTarget(), { hidden: false });
  const media = Object.assign(new EventTarget(), { matches: systemReduced });
  const frames = new Map();
  const timers = new Map();
  const timestamps = [];
  let next = 0;
  const windowObject = {
    matchMedia: () => media,
    requestAnimationFrame(callback) { frames.set(++next, callback); return next; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { timers.set(++next, callback); return next; },
    clearTimeout(id) { timers.delete(id); },
  };
  const flush = (queue) => {
    const pending = [...queue.values()];
    queue.clear();
    pending.forEach((callback) => callback(100));
  };
  const loop = createVisualLoop((timestamp) => timestamps.push(timestamp), {
    windowObject, documentObject, reducedMotion: appReduced,
  });
  return { documentObject, media, frames, timers, timestamps, loop, flush };
}

for (const mode of [
  { name: "app preference", systemReduced: false, appReduced: true },
  { name: "system preference", systemReduced: true, appReduced: false },
  { name: "both preferences", systemReduced: true, appReduced: true },
]) {
  test(`${mode.name} stops decorative loops after one static frame`, () => {
    const f = fixture(mode);
    try {
      f.flush(f.frames);
      assert.deepEqual(f.timestamps, [0], "static decorations use deterministic time");
      assert.equal(f.frames.size + f.timers.size, 0, "reduced motion leaves no recurring callback");
      f.loop.invalidate();
      f.flush(f.frames);
      assert.deepEqual(f.timestamps, [0, 0], "resize still refreshes static decorations");
      assert.equal(f.frames.size + f.timers.size, 0);
    } finally { f.loop.dispose(); }
  });
}

test("app reduction remains effective after the system setting changes", () => {
  const f = fixture({ systemReduced: true, appReduced: true });
  try {
    f.flush(f.frames);
    f.media.matches = false;
    f.media.dispatchEvent(new Event("change"));
    f.flush(f.frames);
    assert.deepEqual(f.timestamps, [0, 0]);
    assert.equal(f.frames.size + f.timers.size, 0);
  } finally { f.loop.dispose(); }
});

test("normal motion retains animation and releases work while hidden or disposed", () => {
  const f = fixture();
  try {
    f.flush(f.frames);
    assert.deepEqual(f.timestamps, [100]);
    assert.equal(f.timers.size, 1);
    f.documentObject.hidden = true;
    f.documentObject.dispatchEvent(new Event("visibilitychange"));
    assert.equal(f.frames.size + f.timers.size, 0);
    f.documentObject.hidden = false;
    f.documentObject.dispatchEvent(new Event("visibilitychange"));
    f.flush(f.frames);
    assert.deepEqual(f.timestamps, [100, 100]);
  } finally { f.loop.dispose(); }
  assert.equal(f.frames.size + f.timers.size, 0);
});

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const cascade = loadEntrypointCssCascade(new URL("../src/main.jsx", import.meta.url), {
  width: 390, height: 844, reducedMotion: false,
});

for (const suffix of ["*", "*::before", "*::after"]) {
  test(`local reduced motion reaches ${suffix} in the actual CSS entry cascade`, () => {
    const declarations = cascade.declarations(`:root[data-dengta-reduced-motion="true"] ${suffix}`);
    const disablesAnimation = declarations.animation?.value === "none" || (
      Number.parseFloat(declarations["animation-duration"]?.value) <= 0.01 &&
      declarations["animation-iteration-count"]?.value === "1" &&
      Number.parseFloat(declarations["animation-delay"]?.value) === 0
    );
    const disablesTransition = declarations.transition?.value === "none" ||
      Number.parseFloat(declarations["transition-duration"]?.value) <= 0.01;
    assert.ok(disablesAnimation, "local preference must reach classic chat, panels and pseudo-element effects");
    assert.ok(disablesTransition, "local preference must stop the popup and button springs");
    assert.equal(declarations.transform?.value, undefined, "reduction must preserve sun, moon and control geometry");
  });
}

test("the real sky reads the shared preference and passes it through the atmosphere to its loop", () => {
  const sky = fs.readFileSync(new URL("../src/CelestialBackdrop.jsx", import.meta.url), "utf8");
  assert.ok(/const reduceMotion = useReducedVisualMotion\(\)/.test(sky));
  assert.ok(/usePrototypeAtmosphere\(\{[\s\S]*?reduceMotion,[\s\S]*?\}\);/.test(sky));
  assert.ok(/createVisualLoop\(paint, \{[^}]*reducedMotion:\s*reduceMotion/.test(sky));
});

const statusSource = fs.readFileSync(new URL("../src/StatusFlowField.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const statusEffectStart = statusSource.indexOf("  useEffect(() => {");
const statusEffectEnd = statusSource.indexOf("\n  }, [active", statusEffectStart);
assert.ok(statusEffectStart >= 0 && statusEffectEnd > statusEffectStart);
const statusEffect = statusSource.slice(statusEffectStart + "  useEffect(() => {".length, statusEffectEnd);
const statusHelpersStart = statusSource.indexOf("const FRAME_INTERVAL_MS");
const statusHelpersEnd = statusSource.indexOf("export default function StatusFlowField", statusHelpersStart);
const statusHelpers = statusSource.slice(statusHelpersStart, statusHelpersEnd);

function statusFixture({ active = true, reduceMotion = false } = {}) {
  const listeners = new Map();
  const frames = new Map();
  let next = 0;
  const calls = { engines: 0, step: 0, render: 0, splat: 0, dispose: 0 };
  const classList = { add() {}, remove() {} };
  const panel = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 400 }),
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
  };
  const canvasListeners = new Map();
  const canvas = {
    closest: () => panel, parentElement: { classList },
    addEventListener(name, callback) { canvasListeners.set(name, callback); },
    removeEventListener(name) { canvasListeners.delete(name); },
  };
  const context = {
    active, reduceMotion, canvasRef: { current: canvas },
    performance: { now: () => 100 },
    requestAnimationFrame(callback) { frames.set(++next, callback); return next; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class { observe() {} disconnect() {} },
    createStatusFluidEngine() {
      calls.engines += 1;
      return {
        step: () => calls.step++, render: () => calls.render++, splat: () => calls.splat++,
        resize() {}, clear() {}, dispose: () => calls.dispose++,
      };
    },
  };
  const cleanup = vm.runInNewContext(`${statusHelpers}\n(() => {${statusEffect}\n})()`, context);
  const flush = () => {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach((callback) => callback(120));
  };
  return { calls, frames, listeners, canvasListeners, cleanup, flush };
}

test("actual status-panel effect allocates no decorative WebGL when reduction is enabled", () => {
  const f = statusFixture({ reduceMotion: true });
  try {
    f.listeners.get("pointerdown")?.({ pointerType: "mouse", button: 0, pointerId: 1, clientX: 40, clientY: 40 });
    f.flush();
    assert.equal(f.calls.engines, 0, "reduction must gate the actual renderer before allocation");
    assert.equal(f.calls.step + f.calls.splat + f.frames.size, 0, "tapping the panel must not restart hidden decorative animation");
  } finally { f.cleanup?.(); }
});

test("actual normal status-panel effect retains pointer feedback and cleans up", () => {
  const f = statusFixture();
  assert.equal(f.calls.engines, 1);
  f.listeners.get("pointerdown")({ pointerType: "mouse", button: 0, pointerId: 1, clientX: 40, clientY: 40 });
  assert.equal(f.calls.splat, 3);
  f.flush();
  assert.equal(f.calls.step, 1);
  assert.equal(f.calls.render, 1);
  f.cleanup();
  assert.equal(f.frames.size + f.listeners.size + f.canvasListeners.size, 0);
  assert.equal(f.calls.dispose, 1);
});

test("the real status component subscribes to the combined motion preference", () => {
  assert.ok(/const reduceMotion = useReducedVisualMotion\(\)/.test(statusSource));
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function compileComponent(source, name, context) {
  const body = source.replace(/^import[^;]+;\r?\n/gm, "").replace("export default function", "function");
  const transformed = (await transformWithOxc(body, `${name}.jsx`, {
    jsx: { runtime: "classic", pragma: "React.createElement", pragmaFrag: "React.Fragment" },
  })).code;
  return vm.runInNewContext(`${transformed}\n${name};`, { React, useEffect: React.useEffect, useRef: React.useRef, ...context });
}

test("actual shared hook combines app and system changes and releases both subscriptions", async () => {
  const hookSource = fs.readFileSync(new URL("../src/use-reduced-visual-motion.js", import.meta.url), "utf8");
  const observers = [];
  const listeners = new Set();
  const root = { dataset: { dengtaReducedMotion: "false" } };
  const media = {
    matches: false,
    addEventListener(name, callback) { assert.equal(name, "change"); listeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "change"); listeners.delete(callback); },
  };
  const hook = vm.runInNewContext(`${hookSource.replace(/^import[^;]+;\r?\n/gm, "").replace("export default function", "function")}\nuseReducedVisualMotion;`, {
    useSyncExternalStore: React.useSyncExternalStore,
    document: { documentElement: root },
    window: { matchMedia: () => media },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target, options) {
        assert.equal(target, root);
        assert.deepEqual([...options.attributeFilter], ["data-dengta-reduced-motion"]);
      }
      disconnect() { this.disconnected = true; }
    },
  });
  function Harness() { return React.createElement("output", null, String(hook())); }
  let tree;
  const result = () => tree.root.findByType("output").children.join("");
  const mutation = () => observers.filter((observer) => !observer.disconnected).forEach((observer) => observer.callback([]));
  const systemChange = () => listeners.forEach((listener) => listener());
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(Harness)); });
    assert.equal(result(), "false");
    await act(async () => { root.dataset.dengtaReducedMotion = "true"; mutation(); });
    assert.equal(result(), "true");
    await act(async () => { media.matches = true; systemChange(); root.dataset.dengtaReducedMotion = "false"; mutation(); });
    assert.equal(result(), "true", "turning off the app preference cannot override the system preference");
    await act(async () => { media.matches = false; systemChange(); });
    assert.equal(result(), "false");
    await act(async () => { root.dataset.dengtaReducedMotion = "true"; mutation(); media.matches = true; systemChange(); media.matches = false; systemChange(); });
    assert.equal(result(), "true", "the app preference survives system changes");
    await act(async () => tree.unmount()); tree = null;
    assert.equal(listeners.size, 0);
    assert.ok(observers.every((observer) => observer.disconnected));
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("actual App dataset publisher restores the previous owner on preference cleanup", () => {
  const datasetAt = app.indexOf("root.dataset.dengtaReducedMotion = String(chatSkinPreferences.reduceMotion)");
  const effectStart = app.lastIndexOf("useLayoutEffect(() => {", datasetAt);
  const effectEnd = app.indexOf("}, [chatSkinPreferences.reduceMotion]);", datasetAt);
  assert.ok(datasetAt >= 0 && effectStart >= 0 && effectEnd > effectStart);
  const body = app.slice(effectStart + "useLayoutEffect(() => {".length, effectEnd);
  for (const previous of [undefined, "false", "true"]) {
    const root = { dataset: previous === undefined ? {} : { dengtaReducedMotion: previous } };
    const cleanup = vm.runInNewContext(`(() => {${body}})()`, { document: { documentElement: root }, chatSkinPreferences: { reduceMotion: true } });
    assert.equal(root.dataset.dengtaReducedMotion, "true");
    cleanup();
    assert.equal(root.dataset.dengtaReducedMotion, previous);
    if (previous === undefined) assert.equal(Object.hasOwn(root.dataset, "dengtaReducedMotion"), false);
  }
});

async function settingsFixture({ reduceMotion = false, systemReduced = false, hidden = false } = {}) {
  const source = fs.readFileSync(new URL("../src/SettingsFlowField.jsx", import.meta.url), "utf8");
  const timers = new Map(), frames = new Map(), observers = [], canvasListeners = new Map(), mediaListeners = new Set(), documentListeners = new Set(), timerDelays = new Map();
  const calls = { allocations: 0, draws: 0, phases: [], bufferDeletes: 0, programDeletes: 0 };
  let next = 0;
  const motion = { value: reduceMotion };
  const documentObject = {
    hidden,
    addEventListener(name, callback) { assert.equal(name, "visibilitychange"); documentListeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "visibilitychange"); documentListeners.delete(callback); },
  };
  const media = {
    matches: systemReduced,
    addEventListener(name, callback) { mediaListeners.add(callback); },
    removeEventListener(name, callback) { mediaListeners.delete(callback); },
  };
  const flags = new Set();
  const field = { classList: { add: (name) => flags.add(name), remove: (name) => flags.delete(name) } };
  const viewport = { width: 390, height: 600, scrolling: false };
  const sheet = { classList: { contains: () => viewport.scrolling } };
  const gl = new Proxy({
    getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: (program, name) => name,
    drawArrays: () => calls.draws++,
    uniform1f: (location, phase) => calls.phases.push(phase),
    deleteBuffer: () => calls.bufferDeletes++, deleteProgram: () => calls.programDeletes++,
  }, { get(target, property) { return target[property] || (() => ({})); } });
  const canvas = {
    width: 0, height: 0, parentElement: field, closest: () => sheet,
    getBoundingClientRect: () => ({ width: viewport.width, height: viewport.height }),
    getContext() { calls.allocations++; return gl; },
    addEventListener(name, callback) { canvasListeners.set(name, callback); },
    removeEventListener(name) { canvasListeners.delete(name); },
  };
  const Component = await compileComponent(source, "SettingsFlowField", {
    useReducedVisualMotion: () => motion.value,
    document: documentObject,
    window: {
      matchMedia: (query) => query.includes("reduced-motion") ? media : { matches: true },
      setTimeout(callback, delay) { timers.set(++next, callback); timerDelays.set(next, delay); return next; },
      clearTimeout(id) { timers.delete(id); },
    },
    performance: { now: () => 100 },
    requestAnimationFrame(callback) { frames.set(++next, callback); return next; },
    cancelAnimationFrame(id) { frames.delete(id); },
    MutationObserver: class { constructor(callback) { this.kind = "mutation"; this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
    ResizeObserver: class { constructor(callback) { this.kind = "resize"; this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
  });
  const flush = (queue) => { const pending = [...queue.values()]; queue.clear(); pending.forEach((callback) => callback(200)); };
  const visibility = (nextHidden) => { documentObject.hidden = nextHidden; [...documentListeners].forEach((callback) => callback()); };
  return { Component, motion, canvas, frames, timers, observers, canvasListeners, mediaListeners, documentListeners, timerDelays, calls, flags, viewport, flush, visibility };
}

test("actual settings renderer keeps a static colorful frame for app or system reduction", async () => {
  for (const preferences of [{ reduceMotion: true }, { systemReduced: true }]) {
    const f = await settingsFixture(preferences);
    let tree;
    try {
      await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); });
      assert.equal(f.timers.size, 1);
      await act(async () => f.flush(f.timers));
      assert.equal(f.calls.draws, 1);
      assert.deepEqual(f.calls.phases, [0.64]);
      assert.equal(f.frames.size + f.timers.size, 0);
      assert.ok(f.flags.has("settings-flow-field--ready"), "reduction keeps the visible static material");
      await act(async () => tree.unmount()); tree = null;
      assert.equal(f.calls.bufferDeletes, 1); assert.equal(f.calls.programDeletes, 1);
      assert.equal(f.canvasListeners.size + f.mediaListeners.size, 0);
      assert.ok(f.observers.every((observer) => observer.disconnected));
    } finally { if (tree) await act(async () => tree.unmount()); }
  }
});

test("actual settings preference change cancels the pending warmup before starting its replacement", async () => {
  const f = await settingsFixture();
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); });
    const oldTimer = [...f.timers.keys()][0];
    f.motion.value = true;
    await act(async () => tree.update(React.createElement(f.Component)));
    assert.equal(f.timers.has(oldTimer), false, "preference change clears the actual previous effect's warmup");
    assert.equal(f.timers.size, 1);
    await act(async () => f.flush(f.timers));
    assert.equal(f.calls.allocations, 1);
    assert.equal(f.calls.draws, 1);
    assert.equal(f.frames.size, 0);
    await act(async () => tree.unmount()); tree = null;
    assert.equal(f.frames.size + f.timers.size, 0);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("actual settings preference change disposes active animation and replaces it with a static frame", async () => {
  const f = await settingsFixture();
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); });
    await act(async () => { f.flush(f.timers); f.flush(f.frames); });
    assert.equal(f.frames.size, 1);
    f.motion.value = true;
    await act(async () => tree.update(React.createElement(f.Component)));
    assert.equal(f.frames.size, 0);
    assert.equal(f.calls.bufferDeletes, 1); assert.equal(f.calls.programDeletes, 1);
    await act(async () => f.flush(f.timers));
    assert.equal(f.calls.allocations, 2);
    assert.equal(f.calls.phases.at(-1), 0.64);
    assert.equal(f.frames.size, 0);
    await act(async () => tree.unmount()); tree = null;
    assert.equal(f.calls.bufferDeletes, 2); assert.equal(f.calls.programDeletes, 2);
    assert.equal(f.frames.size + f.timers.size + f.canvasListeners.size + f.mediaListeners.size, 0);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("actual static settings canvas resizes once without starting an animation loop", async () => {
  const f = await settingsFixture({ systemReduced: true });
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); f.flush(f.timers); });
    // Effects commit after the creation callback; flush the committed warmup.
    await act(async () => f.flush(f.timers));
    assert.equal(f.calls.draws, 1);
    assert.deepEqual([f.canvas.width, f.canvas.height], [195, 300]);
    f.viewport.width = 600; f.viewport.height = 400;
    await act(async () => f.observers.find((observer) => observer.kind === "resize").callback());
    assert.equal(f.calls.draws, 2, "a static resize repaints exactly once");
    assert.deepEqual([f.canvas.width, f.canvas.height], [300, 200]);
    assert.equal(f.frames.size + f.timers.size, 0);
    await act(async () => tree.unmount()); tree = null;
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("actual static settings canvas defers resize during scrolling and redraws once on stop", async () => {
  const f = await settingsFixture({ systemReduced: true });
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); });
    await act(async () => f.flush(f.timers));
    const mutation = f.observers.find((observer) => observer.kind === "mutation");
    const resize = f.observers.find((observer) => observer.kind === "resize");
    f.viewport.scrolling = true;
    await act(async () => mutation.callback());
    f.viewport.width = 300; f.viewport.height = 800;
    await act(async () => resize.callback());
    assert.equal(f.calls.draws, 1, "scrolling keeps the last static frame");
    assert.deepEqual([f.canvas.width, f.canvas.height], [195, 300]);
    f.viewport.scrolling = false;
    await act(async () => mutation.callback());
    assert.equal(f.calls.draws, 2, "scroll stop performs one deferred draw");
    assert.deepEqual([f.canvas.width, f.canvas.height], [150, 400]);
    assert.equal(f.frames.size + f.timers.size, 0);
    await act(async () => tree.unmount()); tree = null;
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("actual settings unmount cancels warmup before any WebGL allocation", async () => {
  const f = await settingsFixture();
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); });
    assert.equal(f.timers.size, 1);
    await act(async () => tree.unmount()); tree = null;
    assert.equal(f.frames.size + f.timers.size, 0);
    f.flush(f.timers);
    assert.equal(f.calls.allocations, 0);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("actual settings hidden warmup defers all WebGL allocation until one foreground initialization", async () => {
  for (const reduceMotion of [false, true]) {
    const f = await settingsFixture({ hidden: true, reduceMotion });
    let tree;
    try {
      await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); });
      await act(async () => f.flush(f.timers));
      assert.equal(f.calls.allocations, 0, "a hidden warmup must not request a WebGL context");
      assert.equal(f.calls.draws + f.frames.size + f.timers.size + f.observers.length, 0);
      await act(async () => { f.visibility(false); f.flush(f.frames); });
      assert.equal(f.calls.allocations, 1);
      assert.equal(f.calls.draws, 1);
      assert.equal(f.frames.size, reduceMotion ? 0 : 1);
      await act(async () => f.visibility(false));
      assert.equal(f.calls.allocations, 1, "a repeated visibility receipt cannot allocate a second renderer");
      assert.equal(f.frames.size, reduceMotion ? 0 : 1);
      await act(async () => tree.unmount()); tree = null;
      assert.equal(f.calls.bufferDeletes, 1); assert.equal(f.calls.programDeletes, 1);
      assert.equal(f.frames.size + f.timers.size + f.documentListeners.size + f.canvasListeners.size + f.mediaListeners.size, 0);
      assert.ok(f.observers.every((observer) => observer.disconnected));
    } finally { if (tree) await act(async () => tree.unmount()); }
  }
});

test("actual settings foreground before warmup cannot bypass the visible 720ms delay", async () => {
  const f = await settingsFixture({ hidden: true });
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); });
    assert.deepEqual([...f.timerDelays.values()], [720]);
    const timer = [...f.timers.keys()][0];
    await act(async () => { f.visibility(false); f.visibility(false); });
    assert.equal(f.calls.allocations, 0);
    assert.equal(f.timers.has(timer), true);
    assert.equal(f.frames.size, 0);
    await act(async () => { f.flush(f.timers); f.flush(f.frames); });
    assert.equal(f.calls.allocations, 1);
    assert.equal(f.calls.draws, 1);
    await act(async () => tree.unmount()); tree = null;
    assert.equal(f.documentListeners.size + f.frames.size + f.timers.size, 0);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("actual settings deferred initialization is cancelled on unmount even for a stale visibility callback", async () => {
  const f = await settingsFixture({ hidden: true });
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); });
    await act(async () => f.flush(f.timers));
    const staleVisibility = [...f.documentListeners][0];
    assert.equal(f.calls.allocations, 0);
    assert.equal(typeof staleVisibility, "function");
    await act(async () => tree.unmount()); tree = null;
    await act(async () => { f.visibility(false); staleVisibility(); f.flush(f.frames); });
    assert.equal(f.calls.allocations + f.calls.draws + f.frames.size + f.timers.size + f.documentListeners.size + f.observers.length, 0);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("actual settings deferred initialization cannot survive a reduced-motion preference replacement", async () => {
  const f = await settingsFixture({ hidden: true });
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); });
    await act(async () => f.flush(f.timers));
    const staleVisibility = [...f.documentListeners][0];
    assert.equal(f.calls.allocations, 0);
    f.motion.value = true;
    await act(async () => tree.update(React.createElement(f.Component)));
    assert.equal(f.documentListeners.size, 0);
    assert.equal(f.timers.size, 1);
    await act(async () => { f.visibility(false); staleVisibility(); });
    assert.equal(f.calls.allocations, 0, "the replacement must complete its own warmup");
    await act(async () => f.flush(f.timers));
    assert.equal(f.calls.allocations, 1);
    assert.equal(f.calls.draws, 1);
    assert.deepEqual(f.calls.phases, [0.64]);
    assert.equal(f.frames.size, 0);
    await act(async () => tree.unmount()); tree = null;
    assert.equal(f.documentListeners.size + f.frames.size + f.timers.size, 0);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("actual settings background context restoration defers the new generation and never deletes lost handles", async () => {
  const f = await settingsFixture();
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); });
    await act(async () => { f.flush(f.timers); f.flush(f.frames); f.visibility(true); });
    let prevented = false;
    await act(async () => { f.canvasListeners.get("webglcontextlost")({ preventDefault() { prevented = true; } }); f.canvasListeners.get("webglcontextrestored")(); });
    assert.equal(prevented, true);
    assert.equal(f.calls.allocations, 1, "hidden restoration must not request another context");
    assert.equal(f.calls.bufferDeletes + f.calls.programDeletes + f.frames.size + f.timers.size, 0);
    assert.equal(f.canvasListeners.size + f.mediaListeners.size, 0, "the lost renderer must release its subscriptions");
    await act(async () => { f.visibility(false); f.flush(f.frames); });
    assert.equal(f.calls.allocations, 2);
    assert.equal(f.calls.draws, 2);
    assert.equal(f.frames.size, 1);
    await act(async () => f.visibility(false));
    assert.equal(f.calls.allocations, 2);
    assert.equal(f.frames.size, 1);
    await act(async () => tree.unmount()); tree = null;
    assert.equal(f.calls.bufferDeletes, 1); assert.equal(f.calls.programDeletes, 1);
    assert.equal(f.documentListeners.size + f.canvasListeners.size + f.mediaListeners.size + f.frames.size + f.timers.size, 0);
    assert.ok(f.observers.every((observer) => observer.disconnected));
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("actual settings background restoration cannot restart after unmount", async () => {
  const f = await settingsFixture();
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); });
    await act(async () => { f.flush(f.timers); f.flush(f.frames); f.visibility(true); });
    const staleRestore = f.canvasListeners.get("webglcontextrestored");
    await act(async () => { f.canvasListeners.get("webglcontextlost")({ preventDefault() {} }); staleRestore(); });
    assert.equal(f.calls.allocations, 1);
    const staleVisibility = [...f.documentListeners][0];
    await act(async () => tree.unmount()); tree = null;
    await act(async () => { f.visibility(false); staleVisibility(); staleRestore(); f.flush(f.frames); });
    assert.equal(f.calls.allocations, 1);
    assert.equal(f.calls.bufferDeletes + f.calls.programDeletes + f.frames.size + f.timers.size + f.documentListeners.size + f.canvasListeners.size + f.mediaListeners.size, 0);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("actual settings hidden cancelled warmup cannot allocate from an already queued stale callback", async () => {
  const f = await settingsFixture({ hidden: true });
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(f.Component), { createNodeMock: (element) => element.type === "canvas" ? f.canvas : null }); });
    const staleWarmup = [...f.timers.values()][0];
    await act(async () => tree.unmount()); tree = null;
    await act(async () => { f.visibility(false); staleWarmup(); f.flush(f.frames); });
    assert.equal(f.calls.allocations + f.calls.draws + f.frames.size + f.timers.size + f.documentListeners.size + f.canvasListeners.size + f.mediaListeners.size + f.observers.length, 0);
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("local reduction removes the prelude veil while preserving its existing timed JS cleanup", () => {
  const declarations = cascade.declarations(':root[data-dengta-reduced-motion="true"] .dengta-prelude');
  assert.equal(declarations.display?.value, "none", "turning off the leave animation must not strand an opaque launch veil");
  assert.equal(declarations.display?.important, true);
  const prelude = fs.readFileSync(new URL("../src/DengTaPrelude.jsx", import.meta.url), "utf8");
  assert.ok(/setTimeout\(\(\) => setVisible\(false\), PRELUDE_DURATION_MS\)/.test(prelude));
});
