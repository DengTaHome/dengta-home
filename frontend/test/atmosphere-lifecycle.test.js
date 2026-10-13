import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function eventTarget(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    listeners,
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback);
      if (!listeners.get(name)?.size) listeners.delete(name);
    },
    dispatch(name, event = {}) {
      for (const callback of [...(listeners.get(name) || [])]) callback(event);
    },
  }, extra);
}

function runtime() {
  let next = 0;
  const time = { now: 100 };
  const frames = new Map(), timers = new Map(), observers = [];
  const documentObject = eventTarget({ hidden: false });
  const media = eventTarget({ matches: false });
  const windowObject = eventTarget({
    matchMedia: (query) => query.includes("reduced-motion") ? media : { matches: true },
    requestAnimationFrame(callback) { frames.set(++next, callback); return next; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { timers.set(++next, callback); return next; },
    clearTimeout(id) { timers.delete(id); },
  });
  const context = {
    document: documentObject, window: windowObject,
    performance: { now: () => time.now },
    requestAnimationFrame: windowObject.requestAnimationFrame,
    cancelAnimationFrame: windowObject.cancelAnimationFrame,
    ResizeObserver: class {
      constructor(callback) { this.kind = "resize"; this.callback = callback; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    },
    MutationObserver: class {
      constructor(callback) { this.kind = "mutation"; this.callback = callback; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    },
  };
  const flush = (queue, now = time.now) => {
    time.now = now;
    const pending = [...queue.values()];
    queue.clear();
    pending.forEach((callback) => callback(now));
  };
  const flags = new Set();
  const field = { classList: {
    add: (...names) => names.forEach((name) => flags.add(name)),
    remove: (...names) => names.forEach((name) => flags.delete(name)),
  } };
  return { context, documentObject, windowObject, media, time, frames, timers, observers, flush, flags, field };
}

function effectSource(filename, component, dependencies) {
  const source = fs.readFileSync(new URL(`../src/${filename}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const componentAt = source.indexOf(`export default function ${component}`);
  const effectAt = source.indexOf("  useEffect(() => {", componentAt);
  const effectEnd = source.indexOf(`\n  }, [${dependencies}`, effectAt);
  assert.ok(componentAt >= 0 && effectAt >= 0 && effectEnd > effectAt);
  const helpers = source.slice(0, componentAt).replace(/^import[^;]+;\n/gm, "");
  const effect = source.slice(effectAt + "  useEffect(() => {".length, effectEnd);
  return `${helpers}\n(() => {${effect}\n})()`;
}

const settingsEffect = effectSource("SettingsFlowField.jsx", "SettingsFlowField", "reduceMotion");
const statusEffect = effectSource("StatusFlowField.jsx", "StatusFlowField", "active");

function settingsFixture({ reduceMotion = false } = {}) {
  const f = runtime();
  const calls = { allocations: 0, draws: 0, rects: 0, phases: [], bufferDeletes: 0, programDeletes: 0 };
  const viewport = { width: 390, height: 600, scrolling: false };
  const sheet = { classList: { contains: () => viewport.scrolling } };
  const gl = new Proxy({
    getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: (program, name) => name,
    drawArrays: () => calls.draws++,
    uniform1f: (location, phase) => calls.phases.push(phase),
    deleteBuffer: () => calls.bufferDeletes++, deleteProgram: () => calls.programDeletes++,
  }, { get(target, property) { return target[property] || (() => ({})); } });
  const canvas = eventTarget({
    width: 0, height: 0, parentElement: f.field, closest: () => sheet,
    getBoundingClientRect() { calls.rects++; return { width: viewport.width, height: viewport.height }; },
    getContext() { calls.allocations++; return gl; },
  });
  const cleanup = vm.runInNewContext(settingsEffect, { ...f.context, reduceMotion, canvasRef: { current: canvas } });
  const warmup = () => { f.flush(f.timers); f.flush(f.frames); };
  return { ...f, calls, canvas, viewport, cleanup, warmup };
}

function statusFixture({ fail = false, field } = {}) {
  const f = runtime();
  if (field) f.field = field;
  const calls = { engines: 0, step: 0, render: 0, splat: 0, clear: 0, resize: 0, dispose: 0 };
  const faults = { create: fail };
  const panel = eventTarget({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 400 }) });
  const canvas = eventTarget({ closest: () => panel, parentElement: f.field });
  const cleanup = vm.runInNewContext(statusEffect, {
    ...f.context, active: true, reduceMotion: false, canvasRef: { current: canvas },
    createStatusFluidEngine: () => {
      calls.engines++;
      if (faults.create) return null;
      return Object.fromEntries(["step", "render", "splat", "clear", "resize", "dispose"].map((name) => [name, () => {
        if (faults[name]) throw new Error("Synthetic graphics failure");
        calls[name]++;
      }]));
    },
  });
  const down = () => panel.dispatch("pointerdown", { pointerType: "mouse", button: 0, pointerId: 1, clientX: 40, clientY: 40 });
  return { ...f, calls, faults, panel, canvas, cleanup, down };
}

test("settings stops queued work while hidden and resumes its visible phase", () => {
  const f = settingsFixture();
  try {
    f.warmup();
    f.flush(f.frames, 300);
    const phase = f.calls.phases.at(-1);
    f.time.now = 300;
    f.documentObject.hidden = true;
    f.documentObject.dispatch("visibilitychange");
    assert.equal(f.frames.size, 0, "background settings must cancel its queued frame");
    const drawCount = f.calls.draws;
    f.flush(f.frames, 10300);
    assert.equal(f.calls.draws, drawCount);
    f.documentObject.hidden = false;
    f.documentObject.dispatch("visibilitychange");
    f.flush(f.frames, 10400);
    const delta = f.calls.phases.at(-1) - phase;
    assert.ok(delta > 0 && delta < 0.02, `hidden time must not jump the material phase: ${delta}`);
  } finally { f.cleanup(); }
  assert.equal(f.frames.size + f.timers.size + f.documentObject.listeners.size + f.canvas.listeners.size, 0);
});

test("settings measures the canvas on invalidation instead of every animated draw", () => {
  const f = settingsFixture();
  try {
    f.warmup();
    const rects = f.calls.rects;
    for (const now of [200, 300, 400, 500]) f.flush(f.frames, now);
    assert.ok(f.calls.draws >= 4);
    assert.equal(f.calls.rects, rects, "unchanged geometry should not trigger repeated layout reads");
    f.viewport.width = 600;
    f.observers.find((observer) => observer.kind === "resize").callback();
    f.flush(f.frames, 600);
    assert.equal(f.calls.rects, rects + 1);
    assert.equal(f.canvas.width, 300);
  } finally { f.cleanup(); }
});

test("settings rebuilds WebGL after context restoration and clears stale fallback classes", () => {
  const f = settingsFixture();
  try {
    f.warmup();
    let prevented = false;
    f.canvas.dispatch("webglcontextlost", { preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(f.frames.size, 0);
    assert.equal(f.flags.has("settings-flow-field--fallback"), true);
    f.canvas.dispatch("webglcontextrestored");
    f.flush(f.frames, 200);
    assert.equal(f.calls.allocations, 2, "context restoration must rebuild shader state");
    assert.equal(f.flags.has("settings-flow-field--fallback"), false);
    assert.equal(f.flags.has("settings-flow-field--ready"), true);
  } finally { f.cleanup(); }
  assert.equal(f.calls.bufferDeletes, 1, "the lost context already invalidated its old buffer");
  assert.equal(f.calls.programDeletes, 1, "only the restored context's program can be released");
});

test("settings context recovery keeps one loop and cannot restart after unmount", () => {
  const f = settingsFixture();
  f.warmup();
  for (let index = 0; index < 2; index++) {
    f.canvas.dispatch("webglcontextlost", { preventDefault() {} });
    f.canvas.dispatch("webglcontextrestored");
    f.flush(f.frames, 200 + index * 100);
    assert.equal(f.frames.size, 1, "restoration must not stack animation loops");
  }
  const staleFrame = [...f.frames.values()][0];
  f.cleanup();
  const allocations = f.calls.allocations, draws = f.calls.draws;
  f.canvas.dispatch("webglcontextrestored");
  staleFrame(500);
  assert.equal(f.calls.allocations, allocations);
  assert.equal(f.calls.draws, draws);
  assert.equal(f.frames.size, 0);
  assert.equal(f.calls.bufferDeletes, 1);
  assert.equal(f.calls.programDeletes, 1);
});

test("settings preserves the visible phase across scroll pauses", () => {
  const f = settingsFixture();
  try {
    f.warmup();
    f.flush(f.frames, 300);
    const phase = f.calls.phases.at(-1);
    const scroll = f.observers.find((observer) => observer.kind === "mutation");
    f.viewport.scrolling = true;
    scroll.callback();
    assert.equal(f.frames.size, 0);
    f.time.now = 10300;
    f.viewport.scrolling = false;
    scroll.callback();
    f.flush(f.frames, 10400);
    const delta = f.calls.phases.at(-1) - phase;
    assert.ok(delta > 0 && delta < 0.02, `scroll time must not jump the material phase: ${delta}`);
  } finally { f.cleanup(); }
});

test("settings warmup while hidden leaves no queued animation or drawing", () => {
  const f = settingsFixture();
  try {
    f.documentObject.hidden = true;
    f.warmup();
    assert.equal(f.calls.draws, 0);
    assert.equal(f.frames.size + f.timers.size, 0);
    f.documentObject.hidden = false;
    f.documentObject.dispatch("visibilitychange");
    f.flush(f.frames, 200);
    assert.equal(f.calls.draws, 1);
    assert.equal(f.frames.size, 1);
  } finally { f.cleanup(); }
});

test("static settings defer hidden resize and repaint once on foreground return", () => {
  const f = settingsFixture({ reduceMotion: true });
  try {
    f.warmup();
    f.documentObject.hidden = true;
    f.documentObject.dispatch("visibilitychange");
    f.viewport.width = 600;
    f.observers.find((observer) => observer.kind === "resize").callback();
    assert.equal(f.calls.draws, 1, "hidden static material must defer GPU work");
    f.documentObject.hidden = false;
    f.documentObject.dispatch("visibilitychange");
    assert.equal(f.calls.draws, 2);
    assert.equal(f.canvas.width, 300);
    assert.equal(f.frames.size + f.timers.size, 0);
  } finally { f.cleanup(); }
});

test("status cancels background feedback and ignores hidden resize or pointer events", () => {
  const f = statusFixture();
  try {
    f.down();
    f.flush(f.frames, 120);
    assert.equal(f.frames.size, 1);
    f.documentObject.hidden = true;
    f.documentObject.dispatch("visibilitychange");
    assert.equal(f.frames.size, 0, "background status must cancel its queued simulation");
    const count = f.calls.render + f.calls.splat;
    f.observers.find((observer) => observer.kind === "resize").callback();
    f.down();
    assert.equal(f.calls.render + f.calls.splat, count);
    f.documentObject.hidden = false;
    f.documentObject.dispatch("visibilitychange");
    assert.equal(f.frames.size, 0, "old pointer trails must not revive after foregrounding");
    f.down();
    assert.equal(f.frames.size, 1, "a fresh interaction still animates");
  } finally { f.cleanup(); }
  assert.equal(f.documentObject.listeners.size + f.windowObject.listeners.size + f.panel.listeners.size + f.frames.size, 0);
  assert.equal(f.calls.dispose, 1);
});

test("status stops dragging when the pointer is released outside the panel", () => {
  const f = statusFixture();
  try {
    f.down();
    const splats = f.calls.splat;
    f.windowObject.dispatch("pointerup", { pointerId: 1 });
    f.panel.dispatch("pointermove", { pointerId: 1, clientX: 180, clientY: 120 });
    assert.equal(f.calls.splat, splats, "returning to the panel after external release must not draw a stuck trail");
  } finally { f.cleanup(); }
});

test("status clears a dragging pointer on window blur and ignores a disposed frame", () => {
  const f = statusFixture();
  f.down();
  const splats = f.calls.splat;
  f.windowObject.dispatch("blur");
  f.panel.dispatch("pointermove", { pointerId: 1, clientX: 180, clientY: 120 });
  assert.equal(f.calls.splat, splats);
  const staleFrame = [...f.frames.values()][0];
  f.cleanup();
  const steps = f.calls.step;
  staleFrame(200);
  assert.equal(f.calls.step, steps);
  assert.equal(f.frames.size, 0);
});

test("status removes a failed fallback before a later successful renderer", () => {
  const failed = statusFixture({ fail: true });
  assert.equal(failed.flags.has("status-flow-field--fallback"), true);
  failed.cleanup?.();
  const recovered = statusFixture({ field: failed.field });
  try {
    assert.equal(failed.flags.has("status-flow-field--fallback"), false);
  } finally { recovered.cleanup(); }
});

test("status context loss stops feedback and restoration creates one fresh engine", () => {
  const f = statusFixture();
  try {
    f.down();
    const staleFrame = [...f.frames.values()][0];
    let prevented = false;
    f.canvas.dispatch("webglcontextlost", { preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(f.calls.dispose, 1);
    assert.equal(f.frames.size, 0);
    assert.equal(f.flags.has("status-flow-field--ready"), false);
    assert.equal(f.flags.has("status-flow-field--fallback"), true);
    const splats = f.calls.splat;
    f.down();
    staleFrame(200);
    assert.equal(f.calls.splat, splats);
    assert.equal(f.calls.step, 0);
    f.canvas.dispatch("webglcontextrestored");
    assert.equal(f.calls.engines, 2);
    assert.equal(f.flags.has("status-flow-field--ready"), true);
    assert.equal(f.flags.has("status-flow-field--fallback"), false);
    assert.equal(f.frames.size, 0);
    f.down();
    assert.equal(f.frames.size, 1);
    const steps = f.calls.step;
    staleFrame(250);
    assert.equal(f.calls.step, steps, "a cancelled old frame cannot touch the restored engine");
    assert.equal(f.frames.size, 1);
  } finally { f.cleanup(); }
  assert.equal(f.calls.dispose, 2);
  assert.equal(f.canvas.listeners.size + f.frames.size, 0);
});

test("status repeated context recovery keeps one feedback loop and stops after unmount", () => {
  const f = statusFixture();
  for (let index = 0; index < 3; index++) {
    f.down();
    f.canvas.dispatch("webglcontextlost", { preventDefault() {} });
    f.canvas.dispatch("webglcontextrestored");
    f.down();
    assert.equal(f.frames.size, 1);
  }
  assert.equal(f.calls.engines, 4);
  assert.equal(f.calls.dispose, 3);
  const restore = [...f.canvas.listeners.get("webglcontextrestored")][0];
  const stale = [...f.frames.values()][0];
  f.cleanup();
  restore(); stale(500);
  assert.equal(f.calls.engines, 4);
  assert.equal(f.calls.dispose, 4);
  assert.equal(f.frames.size, 0);
});

test("status defers context restoration while hidden and discards old pointer trails", () => {
  const f = statusFixture();
  try {
    f.down();
    f.canvas.dispatch("webglcontextlost", { preventDefault() {} });
    f.documentObject.hidden = true;
    f.documentObject.dispatch("visibilitychange");
    f.canvas.dispatch("webglcontextrestored");
    assert.equal(f.calls.engines, 1);
    assert.equal(f.frames.size, 0);
    f.documentObject.hidden = false;
    f.documentObject.dispatch("visibilitychange");
    assert.equal(f.calls.engines, 2);
    f.panel.dispatch("pointermove", { pointerId: 1, clientX: 150, clientY: 120 });
    assert.equal(f.calls.splat, 3);
    assert.equal(f.frames.size, 0);
    f.down();
    assert.equal(f.frames.size, 1);
  } finally { f.cleanup(); }
});

test("status failed initialization can recover on restore and leaves no listeners after unmount", () => {
  const f = statusFixture({ fail: true });
  const restore = [...(f.canvas.listeners.get("webglcontextrestored") || [])][0];
  assert.equal(typeof restore, "function");
  f.faults.create = false;
  f.canvas.dispatch("webglcontextrestored");
  assert.equal(f.calls.engines, 2);
  assert.equal(f.flags.has("status-flow-field--ready"), true);
  f.cleanup();
  restore();
  assert.equal(f.calls.engines, 2);
  assert.equal(f.calls.dispose, 1);
  assert.equal(f.canvas.listeners.size + f.documentObject.listeners.size + f.windowObject.listeners.size + f.panel.listeners.size, 0);
});

for (const operation of ["step", "render", "splat", "resize"]) {
  test(`status ${operation} failure falls back without leaking frames or throwing into the page`, () => {
    const f = statusFixture();
    try {
      if (operation === "step" || operation === "render") f.down();
      f.faults[operation] = true;
      assert.doesNotThrow(() => {
        if (operation === "resize") f.observers.find((observer) => observer.kind === "resize").callback();
        else if (operation === "splat") f.down();
        else f.flush(f.frames, 200);
      });
      assert.equal(f.flags.has("status-flow-field--ready"), false);
      assert.equal(f.flags.has("status-flow-field--fallback"), true);
      assert.equal(f.frames.size, 0);
      assert.equal(f.calls.dispose, 1);
      assert.doesNotThrow(f.down);
      assert.equal(f.frames.size, 0);
    } finally { f.cleanup(); }
    assert.equal(f.calls.dispose, 1);
  });
}
