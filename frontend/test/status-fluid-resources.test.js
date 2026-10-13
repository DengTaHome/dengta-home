import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/status-fluid-engine.js", import.meta.url), "utf8");
const engineFactory = vm.runInNewContext(source.replace(/^export /gm, "") + "\ncreateStatusFluidEngine;", { window: { devicePixelRatio: 1, innerWidth: 390 } });
const eventTarget = (extra) => extra;
function fakeGL(options = {}) {
  const counts = { shader: 0, program: 0, buffer: 0, texture: 0, framebuffer: 0 };
  const live = Object.fromEntries(Object.keys(counts).map(kind => [kind, new Set()]));
  const calls = { framebufferChecks: 0, incompleteFboDraws: 0, invalidBufferDraws: 0, defaultFramebufferAttachments: 0, draws: 0 };
  let boundTexture = null, boundFbo = null, arrayBuffer = null, elementBuffer = null, currentProgram = null;
  const allocate = kind => { const id = ++counts[kind]; if (options[`${kind}MissingAt`] === id) return null; const value = { kind, id }; live[kind].add(value); return value; };
  const constants = ['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','ACTIVE_UNIFORMS','TEXTURE_2D','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','NEAREST','LINEAR','CLAMP_TO_EDGE','FRAMEBUFFER','COLOR_ATTACHMENT0','FRAMEBUFFER_COMPLETE','HALF_FLOAT','RGBA16F','RGBA','RG16F','RG','R16F','RED','ARRAY_BUFFER','ELEMENT_ARRAY_BUFFER','STATIC_DRAW','BLEND','DEPTH_TEST','COLOR_BUFFER_BIT','CURRENT_PROGRAM','FLOAT','TRIANGLES','UNSIGNED_SHORT','TEXTURE0'];
  const gl = Object.fromEntries(constants.map((name, index) => [name, index + 1]));
  Object.assign(gl, {
    drawingBufferWidth: 390, drawingBufferHeight: 400,
    getExtension: () => ({}),
    createShader(type) { const shader = allocate('shader'); if (shader) shader.type = type; return shader; }, shaderSource() {}, compileShader() {},
    getShaderParameter: shader => Boolean(shader) && shader.id !== options.shaderFailsAt,
    getShaderInfoLog: () => 'synthetic shader failure', deleteShader: shader => live.shader.delete(shader),
    createProgram: () => allocate('program'), attachShader() {}, linkProgram() {},
    getProgramParameter(program, parameter) { if (parameter === gl.ACTIVE_UNIFORMS) return 0; return Boolean(program) && program.id !== options.programFailsAt; },
    getProgramInfoLog: () => 'synthetic program failure', deleteProgram: program => live.program.delete(program),
    getUniformLocation: (program, name) => name, getActiveUniform: () => null,
    useProgram(program) { currentProgram = program; }, getParameter: () => currentProgram, getAttribLocation: () => 0,
    createBuffer: () => allocate('buffer'), deleteBuffer: buffer => live.buffer.delete(buffer),
    bindBuffer(target, buffer) { if (target === gl.ARRAY_BUFFER) arrayBuffer = buffer; if (target === gl.ELEMENT_ARRAY_BUFFER) elementBuffer = buffer; }, bufferData() {},
    createTexture: () => allocate('texture'), deleteTexture: texture => live.texture.delete(texture), bindTexture(target, texture) { boundTexture = texture; }, texParameteri() {},
    texImage2D(target, level, format, width, height) { if (boundTexture) boundTexture.complete = !(options.largeFboIncomplete && (width > 4 || height > 4)); },
    createFramebuffer: () => allocate('framebuffer'), deleteFramebuffer: framebuffer => live.framebuffer.delete(framebuffer), bindFramebuffer(target, framebuffer) { boundFbo = framebuffer; },
    framebufferTexture2D(target, attachment, textarget, texture) { if (boundFbo) boundFbo.complete = Boolean(texture?.complete); else calls.defaultFramebufferAttachments++; },
    checkFramebufferStatus() { calls.framebufferChecks++; return boundFbo?.complete ? gl.FRAMEBUFFER_COMPLETE : 0; },
    drawElements() { calls.draws++; if (boundFbo && !boundFbo.complete) calls.incompleteFboDraws++; if (!arrayBuffer || !elementBuffer) calls.invalidBufferDraws++; },
    drawArrays() { calls.draws++; if (!arrayBuffer) calls.invalidBufferDraws++; },
    activeTexture() {}, viewport() {}, clear() {}, clearColor() {}, disable() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, uniform1i() {}, uniform1f() {}, uniform2f() {}, uniform3f() {},
  });
  const snapshot = () => Object.fromEntries(Object.entries(live).map(([kind, handles]) => [kind, handles.size]));
  return { gl, counts, calls, live, snapshot };
}
function canvasFor(gl, extra = {}) {
  const rect = { left: 0, top: 0, width: 390, height: 400 };
  return { canvas: eventTarget({ width: 0, height: 0, getContext: () => gl, getBoundingClientRect: () => rect, ...extra }), rect };
}

function assertReleased(f) {
  assert.deepEqual(f.snapshot(), { shader: 0, program: 0, buffer: 0, texture: 0, framebuffer: 0 });
}

for (const options of [
  { shaderFailsAt: 2 }, { shaderFailsAt: 6 }, { shaderFailsAt: 18 },
  { shaderMissingAt: 2 }, { programMissingAt: 3 }, { programFailsAt: 3 },
  { bufferMissingAt: 1 }, { bufferMissingAt: 2 },
  { textureMissingAt: 4 }, { textureMissingAt: 8 },
  { framebufferMissingAt: 4 }, { framebufferMissingAt: 7 },
  { largeFboIncomplete: true },
]) test('status rejects failed initialization and releases partial resources: ' + JSON.stringify(options), () => {
  const f = fakeGL(options), c = canvasFor(f.gl);
  assert.throws(() => engineFactory(c.canvas));
  assertReleased(f);
  assert.equal(f.calls.invalidBufferDraws + f.calls.incompleteFboDraws + f.calls.defaultFramebufferAttachments, 0);
});

for (const options of [{ textureMissingAt: 1 }, { framebufferMissingAt: 1 }])
test('status unsupported format probe is safe: ' + JSON.stringify(options), () => {
  const f = fakeGL(options), c = canvasFor(f.gl);
  assert.equal(engineFactory(c.canvas), null);
  assertReleased(f);
  assert.equal(f.calls.defaultFramebufferAttachments + f.calls.draws, 0);
});

test('status healthy render, no-op resize and disposal do not leak or revive', () => {
  const f = fakeGL(), c = canvasFor(f.gl), engine = engineFactory(c.canvas);
  assert.ok(engine);
  assert.equal(f.calls.framebufferChecks, 11);
  engine.splat(0.5, 0.5, 10, 10, [1, 0, 0]);
  engine.step(0.02);
  engine.render();
  const allocated = { ...f.counts };
  assert.equal(engine.resize(), false);
  assert.deepEqual(f.counts, allocated);
  c.rect.width = 420;
  assert.equal(engine.resize(), true);
  assert.equal(f.snapshot().texture, 8);
  assert.equal(f.snapshot().framebuffer, 8);
  engine.dispose();
  const draws = f.calls.draws;
  engine.dispose(); engine.clear(); engine.render(); engine.step(0.02);
  engine.splat(0.5, 0.5, 10, 10, [1, 0, 0]);
  assert.equal(engine.resize(), false);
  assert.equal(f.calls.draws, draws);
  assertReleased(f);
});

test('status resize allocation failure discards incomplete targets and can be disposed', () => {
  const options = {}, f = fakeGL(options), c = canvasFor(f.gl), engine = engineFactory(c.canvas);
  options.largeFboIncomplete = true;
  c.rect.width = 420;
  assert.throws(() => engine.resize());
  assert.equal(f.snapshot().texture + f.snapshot().framebuffer, 0);
  assert.equal(f.calls.incompleteFboDraws, 0);
  engine.dispose();
  assertReleased(f);
});
