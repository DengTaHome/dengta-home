import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/SettingsFlowField.jsx", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("function compileShader("), source.indexOf("export default function SettingsFlowField"));
const build = runInNewContext(`const VERTEX_SHADER="fixture-vertex", FRAGMENT_SHADER="fixture-fragment"; ${helpers}; createProgram`);

function fixture({ fragmentFails = false, programMissing = false, linkFails = false } = {}) {
  const created = [], deleted = [], programs = [], releasedPrograms = [];
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader(type) { const shader = { type }; created.push(shader); return shader; },
    shaderSource() {}, compileShader() {},
    getShaderParameter(shader) { return !(fragmentFails && shader.type === 2); },
    getShaderInfoLog() { return "fixture compile failure"; },
    deleteShader(shader) { deleted.push(shader); },
    createProgram() { if (programMissing) return null; const program = {}; programs.push(program); return program; },
    attachShader(program) { if (!program) throw new Error("fixture allocation failure"); },
    linkProgram() {}, getProgramParameter() { return !linkFails; },
    getProgramInfoLog() { return "fixture link failure"; }, deleteProgram(program) { releasedPrograms.push(program); },
  };
  return { gl, created, deleted, programs, releasedPrograms };
}

for (const options of [{ fragmentFails: true }, { programMissing: true }, { linkFails: true }]) test(`failed shader setup releases allocated resources: ${JSON.stringify(options)}`, () => {
  const f = fixture(options);
  assert.throws(() => build(f.gl));
  assert.equal(f.deleted.length, f.created.length);
  assert.deepEqual(new Set(f.deleted), new Set(f.created));
  assert.deepEqual(f.releasedPrograms, f.programs);
});

test("successful shader setup releases shaders and keeps the linked program for the renderer", () => {
  const f = fixture();
  const program = build(f.gl);
  assert.equal(f.deleted.length, 2);
  assert.equal(program, f.programs[0]);
  assert.equal(f.releasedPrograms.length, 0);
});

const normalized = source.replaceAll("\r\n", "\n");
const componentAt = normalized.indexOf("export default function SettingsFlowField");
const effectAt = normalized.indexOf("  useEffect(() => {", componentAt);
const effectEnd = normalized.indexOf("\n  }, [reduceMotion]", effectAt);
assert.ok(effectAt >= 0 && effectEnd > effectAt);
const effect = normalized.slice(effectAt + "  useEffect(() => {".length, effectEnd);
const rendererSource = normalized.slice(0, componentAt).replace(/^import[^;]+;\n/gm, "");

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
  }, extra);
}

function rendererFixture({ failAt, reduceMotion = false } = {}) {
  const f = fixture();
  const frames = new Map(), timers = new Map(), observers = [], flags = new Set();
  const buffers = [], deletedBuffers = [], invalidHandles = new Set(), staleDeletes = [];
  const deleteProgram = f.gl.deleteProgram;
  let next = 0, draws = 0;
  const fail = (stage) => {
    if (failAt === stage) throw new Error(`fixture ${stage} failure`);
  };
  Object.assign(f.gl, {
    getAttribLocation() { fail("attribute"); return 0; },
    getUniformLocation: (program, name) => name,
    createBuffer() {
      if (failAt === "buffer-null") return null;
      const buffer = {}; buffers.push(buffer); return buffer;
    },
    deleteBuffer(buffer) {
      if (invalidHandles.has(buffer)) staleDeletes.push(buffer);
      else deletedBuffers.push(buffer);
    },
    deleteProgram(program) {
      if (invalidHandles.has(program)) staleDeletes.push(program);
      else deleteProgram(program);
    },
    bindBuffer() {}, bufferData() { fail("buffer-data"); },
    useProgram() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, disable() {},
    viewport() {}, uniform2f() {}, uniform1f() {},
    drawArrays() { fail("draw"); draws++; },
  });
  const documentObject = eventTarget({ hidden: false });
  const media = eventTarget({ matches: false });
  const sheet = { classList: { contains: () => false } };
  const canvas = eventTarget({
    width: 0, height: 0,
    parentElement: { classList: {
      add: (...names) => names.forEach((name) => flags.add(name)),
      remove: (...names) => names.forEach((name) => flags.delete(name)),
    } },
    closest: () => sheet,
    getContext() { fail("context"); return f.gl; },
    getBoundingClientRect: () => ({ width: 390, height: 600 }),
  });
  const cleanup = runInNewContext(`${rendererSource}\n(() => {${effect}\n})()`, {
    canvasRef: { current: canvas }, reduceMotion, document: documentObject,
    window: {
      matchMedia: (query) => query.includes("reduced-motion") ? media : { matches: true },
      setTimeout(callback) { timers.set(++next, callback); return next; },
      clearTimeout: (id) => timers.delete(id),
    },
    performance: { now: () => 100 },
    requestAnimationFrame(callback) { frames.set(++next, callback); return next; },
    cancelAnimationFrame: (id) => frames.delete(id),
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() { fail("resize-observe"); }
      disconnect() { this.disconnected = true; }
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    },
  });
  const flush = (queue) => { const pending = [...queue.values()]; queue.clear(); pending.forEach((callback) => callback(200)); };
  const loseContext = () => {
    [...buffers, ...f.programs].forEach((handle) => invalidHandles.add(handle));
    [...(canvas.listeners.get("webglcontextlost") || [])].forEach((callback) => callback({ preventDefault() {} }));
  };
  const restoreContext = () => [...(canvas.listeners.get("webglcontextrestored") || [])].forEach((callback) => callback());
  return { ...f, frames, timers, observers, flags, canvas, documentObject, media, buffers, deletedBuffers, staleDeletes, loseContext, restoreContext, cleanup, flush, draws: () => draws };
}

test("restoring a lost context never deletes handles from its old generation", () => {
  const f = rendererFixture();
  try {
    f.flush(f.timers); f.flush(f.frames);
    f.loseContext();
    assert.equal(f.frames.size, 0);
    assert.equal(f.flags.has("settings-flow-field--fallback"), true);
    f.restoreContext(); f.flush(f.frames);
    assert.equal(f.staleDeletes.length, 0);
    assert.equal(f.programs.length, 2);
    assert.equal(f.flags.has("settings-flow-field--ready"), true);
  } finally { f.cleanup(); }
  assert.equal(f.staleDeletes.length, 0);
  assert.deepEqual(f.deletedBuffers, [f.buffers[1]]);
  assert.deepEqual(f.releasedPrograms, [f.programs[1]]);
  assert.equal(f.canvas.listeners.size + f.media.listeners.size + f.documentObject.listeners.size, 0);
});

test("unmount after context loss removes listeners without deleting obsolete handles", () => {
  const f = rendererFixture();
  f.flush(f.timers); f.flush(f.frames); f.loseContext(); f.cleanup();
  assert.equal(f.staleDeletes.length, 0);
  assert.equal(f.frames.size + f.timers.size, 0);
  assert.ok(f.observers.every((observer) => observer.disconnected));
  assert.equal(f.canvas.listeners.size + f.media.listeners.size + f.documentObject.listeners.size, 0);
});

for (const failAt of ["context", "attribute", "buffer-null", "buffer-data", "resize-observe", "draw"]) test(`renderer initialization falls back and releases partial setup: ${failAt}`, () => {
  const f = rendererFixture({ failAt });
  try {
    assert.doesNotThrow(() => { f.flush(f.timers); f.flush(f.frames); });
    assert.equal(f.flags.has("settings-flow-field--fallback"), true);
    assert.equal(f.flags.has("settings-flow-field--ready"), false);
    assert.equal(f.frames.size + f.timers.size, 0);
    assert.deepEqual(f.releasedPrograms, f.programs);
    assert.deepEqual(f.deletedBuffers, f.buffers);
    assert.deepEqual(new Set(f.deleted), new Set(f.created));
    assert.ok(f.observers.every((observer) => observer.disconnected));
    assert.equal(f.canvas.listeners.size + f.media.listeners.size + f.documentObject.listeners.size, 0);
    assert.equal(f.draws(), 0);
  } finally { f.cleanup(); }
  assert.deepEqual(f.releasedPrograms, f.programs, "unmount must not release failed resources twice");
  assert.deepEqual(f.deletedBuffers, f.buffers);
  assert.equal(f.flags.size, 0);
});

test("static first-frame failure also releases registered observers and listeners", () => {
  const f = rendererFixture({ failAt: "draw", reduceMotion: true });
  try {
    assert.doesNotThrow(() => f.flush(f.timers));
    assert.equal(f.flags.has("settings-flow-field--fallback"), true);
    assert.equal(f.frames.size, 0);
    assert.deepEqual(f.releasedPrograms, f.programs);
    assert.deepEqual(f.deletedBuffers, f.buffers);
    assert.ok(f.observers.every((observer) => observer.disconnected));
    assert.equal(f.canvas.listeners.size + f.media.listeners.size + f.documentObject.listeners.size, 0);
  } finally { f.cleanup(); }
});
