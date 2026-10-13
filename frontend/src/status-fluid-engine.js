/*
MIT License

Copyright (c) 2017 Pavel Dobryakov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Adapted for DengTa's touch-driven status surface from WebGL-Fluid-Simulation:
https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
*/

const SIM_RESOLUTION = 192;
const MOBILE_DYE_RESOLUTION = 640;
const DESKTOP_DYE_RESOLUTION = 768;
const PRESSURE_ITERATIONS = 22;
const CURL_STRENGTH = 42;
const DENSITY_DISSIPATION = 1.08;
const VELOCITY_DISSIPATION = 0.66;
const PRESSURE_DISSIPATION = 0.8;

const BASE_VERTEX_SHADER = `
precision highp float;

attribute vec2 aPosition;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;

void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const CLEAR_SHADER = `
precision mediump float;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform float value;

void main () {
  gl_FragColor = value * texture2D(uTexture, vUv);
}
`;

export const DISPLAY_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTexture;

void main () {
  vec3 raw = max(texture2D(uTexture, vUv).rgb, vec3(0.0));
  float body = max(raw.r, max(raw.g, raw.b));
  vec3 color = 1.0 - exp(-raw * 0.96);
  color = pow(color, vec3(0.88));
  float edge = smoothstep(0.006, 0.042, body);
  float core = smoothstep(0.12, 0.52, body);
  color *= 0.74 + edge * 0.34 + core * 0.08;
  gl_FragColor = vec4(color, 1.0);
}
`;

export const SPLAT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;

void main () {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + splat, 1.0);
}
`;

export const ADVECTION_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform vec2 sourceTexelSize;
uniform float dt;
uniform float dissipation;

vec4 bilerp (sampler2D source, vec2 uv, vec2 size) {
  vec2 st = uv / size - 0.5;
  vec2 cell = floor(st);
  vec2 fraction = fract(st);
  vec4 a = texture2D(source, (cell + vec2(0.5, 0.5)) * size);
  vec4 b = texture2D(source, (cell + vec2(1.5, 0.5)) * size);
  vec4 c = texture2D(source, (cell + vec2(0.5, 1.5)) * size);
  vec4 d = texture2D(source, (cell + vec2(1.5, 1.5)) * size);
  return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
}

void main () {
  vec2 velocity = bilerp(uVelocity, vUv, texelSize).xy;
  vec2 coordinate = vUv - dt * velocity * texelSize;
  vec4 result = bilerp(uSource, coordinate, sourceTexelSize);
  gl_FragColor = result / (1.0 + dissipation * dt);
}
`;

export const DIVERGENCE_SHADER = `
precision mediump float;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;

void main () {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}
`;

export const CURL_SHADER = `
precision mediump float;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;

void main () {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}
`;

export const VORTICITY_SHADER = `
precision highp float;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;

void main () {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 velocity = texture2D(uVelocity, vUv).xy + force * dt;
  gl_FragColor = vec4(clamp(velocity, -1000.0, 1000.0), 0.0, 1.0);
}
`;

export const PRESSURE_SHADER = `
precision mediump float;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;

void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float divergence = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
}
`;

export const GRADIENT_SUBTRACT_SHADER = `
precision mediump float;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;

void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity -= vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate status fluid shader");
  try {
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Unable to compile status fluid shader");
    }
    return shader;
  } catch (error) {
    gl.deleteShader(shader);
    throw error;
  }
}

function createProgram(gl, fragmentSource) {
  let vertex, fragment, handle;
  try {
    vertex = compileShader(gl, gl.VERTEX_SHADER, BASE_VERTEX_SHADER);
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    handle = gl.createProgram();
    if (!handle) throw new Error("Unable to allocate status fluid program");
    gl.attachShader(handle, vertex);
    gl.attachShader(handle, fragment);
    gl.linkProgram(handle);
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(handle) || "Unable to link status fluid program");
    }
    const uniforms = {};
    const count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS);
    for (let index = 0; index < count; index += 1) {
      const name = gl.getActiveUniform(handle, index)?.name;
      if (name) uniforms[name] = gl.getUniformLocation(handle, name);
    }
    return {
      handle,
      uniforms,
      bind() {
        gl.useProgram(handle);
      },
    };
  } catch (error) {
    if (handle) gl.deleteProgram(handle);
    throw error;
  } finally {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }
}

function supportRenderTextureFormat(gl, internalFormat, format, type) {
  let texture, framebuffer;
  try {
    texture = gl.createTexture();
    framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) return false;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  } catch {
    return false;
  } finally {
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    if (texture) gl.deleteTexture(texture);
  }
}

function getSupportedFormat(gl, internalFormat, format, type) {
  if (supportRenderTextureFormat(gl, internalFormat, format, type)) {
    return { internalFormat, format };
  }
  if (internalFormat === gl.R16F) {
    return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
  }
  if (internalFormat === gl.RG16F) {
    return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
  }
  return null;
}

function createContext(canvas) {
  const attributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  };
  let gl = canvas.getContext("webgl2", attributes);
  const webgl2 = Boolean(gl);
  if (!gl) gl = canvas.getContext("webgl", attributes);
  if (!gl) return null;

  let halfFloatType;
  let rgba;
  let rg;
  let r;
  let linearFiltering;
  if (webgl2) {
    gl.getExtension("EXT_color_buffer_float");
    linearFiltering = Boolean(gl.getExtension("OES_texture_float_linear"));
    halfFloatType = gl.HALF_FLOAT;
    rgba = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatType);
    rg = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatType);
    r = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatType);
  } else {
    const halfFloat = gl.getExtension("OES_texture_half_float");
    if (!halfFloat) return null;
    linearFiltering = Boolean(gl.getExtension("OES_texture_half_float_linear"));
    halfFloatType = halfFloat.HALF_FLOAT_OES;
    rgba = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatType);
    rg = rgba;
    r = rgba;
  }
  if (!rgba || !rg || !r) return null;
  return { gl, halfFloatType, rgba, rg, r, linearFiltering };
}

function resolutionFor(canvas, baseResolution) {
  let aspect = canvas.width / Math.max(canvas.height, 1);
  if (aspect < 1) aspect = 1 / Math.max(aspect, 0.001);
  const minimum = Math.round(baseResolution);
  const maximum = Math.round(baseResolution * aspect);
  return canvas.width > canvas.height
    ? { width: maximum, height: minimum }
    : { width: minimum, height: maximum };
}

export function createStatusFluidEngine(canvas) {
  const context = createContext(canvas);
  if (!context) return null;
  const { gl, halfFloatType, rgba, rg, r, linearFiltering } = context;
  const programSources = {
    clear: CLEAR_SHADER,
    display: DISPLAY_SHADER,
    splat: SPLAT_SHADER,
    advection: ADVECTION_SHADER,
    divergence: DIVERGENCE_SHADER,
    curl: CURL_SHADER,
    vorticity: VORTICITY_SHADER,
    pressure: PRESSURE_SHADER,
    gradient: GRADIENT_SUBTRACT_SHADER,
  };
  const programs = {};
  let quad = null;
  let indices = null;
  let disposed = false;
  const framebuffers = new Set();
  const textures = new Set();
  let dye = null;
  let velocity = null;
  let divergence = null;
  let curl = null;
  let pressure = null;

  const blit = (target) => {
    if (target) {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    } else {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    const position = gl.getAttribLocation(program, "aPosition");
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(position);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };

  const createFBO = (width, height, format, type, filtering) => {
    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to allocate status fluid texture");
    textures.add(texture);
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error("Unable to allocate status fluid framebuffer");
    framebuffers.add(fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      format.internalFormat,
      width,
      height,
      0,
      format.format,
      type,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Incomplete status fluid framebuffer");
    }
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture,
      fbo,
      width,
      height,
      texelSizeX: 1 / width,
      texelSizeY: 1 / height,
      attach(unit) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return unit;
      },
    };
  };

  const createDoubleFBO = (width, height, format, type, filtering) => {
    let first = createFBO(width, height, format, type, filtering);
    let second = createFBO(width, height, format, type, filtering);
    return {
      width,
      height,
      texelSizeX: 1 / width,
      texelSizeY: 1 / height,
      get read() {
        return first;
      },
      get write() {
        return second;
      },
      swap() {
        const temporary = first;
        first = second;
        second = temporary;
      },
    };
  };

  const releaseFramebuffers = () => {
    framebuffers.forEach((fbo) => gl.deleteFramebuffer(fbo));
    textures.forEach((texture) => gl.deleteTexture(texture));
    framebuffers.clear();
    textures.clear();
    dye = velocity = divergence = curl = pressure = null;
  };

  const clearAll = () => {
    if (disposed) return;
    const targets = [
      dye?.read,
      dye?.write,
      velocity?.read,
      velocity?.write,
      divergence,
      curl,
      pressure?.read,
      pressure?.write,
    ];
    targets.forEach((target) => {
      if (!target) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const resize = () => {
    if (disposed) return false;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2.25, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.max(2, Math.round(rect.width * dpr));
    const height = Math.max(2, Math.round(rect.height * dpr));
    if (canvas.width === width && canvas.height === height && dye) return false;
    canvas.width = width;
    canvas.height = height;
    releaseFramebuffers();
    const sim = resolutionFor(canvas, SIM_RESOLUTION);
    const dyeBase = window.innerWidth <= 820
      ? MOBILE_DYE_RESOLUTION
      : DESKTOP_DYE_RESOLUTION;
    const dyeSize = resolutionFor(canvas, dyeBase);
    const linear = linearFiltering ? gl.LINEAR : gl.NEAREST;
    try {
      dye = createDoubleFBO(
        dyeSize.width,
        dyeSize.height,
        rgba,
        halfFloatType,
        linear,
      );
      velocity = createDoubleFBO(
        sim.width,
        sim.height,
        rg,
        halfFloatType,
        linear,
      );
      divergence = createFBO(
        sim.width,
        sim.height,
        r,
        halfFloatType,
        gl.NEAREST,
      );
      curl = createFBO(sim.width, sim.height, r, halfFloatType, gl.NEAREST);
      pressure = createDoubleFBO(
        sim.width,
        sim.height,
        r,
        halfFloatType,
        gl.NEAREST,
      );
      clearAll();
      return true;
    } catch (error) {
      releaseFramebuffers();
      throw error;
    }
  };

  const setTexelSize = (program, target) => {
    if (program.uniforms.texelSize) {
      gl.uniform2f(
        program.uniforms.texelSize,
        target.texelSizeX,
        target.texelSizeY,
      );
    }
  };

  const step = (dt) => {
    if (disposed || !dye) return;
    gl.disable(gl.BLEND);

    programs.curl.bind();
    setTexelSize(programs.curl, velocity);
    gl.uniform1i(programs.curl.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    programs.vorticity.bind();
    setTexelSize(programs.vorticity, velocity);
    gl.uniform1i(programs.vorticity.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.vorticity.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(programs.vorticity.uniforms.curl, CURL_STRENGTH);
    gl.uniform1f(programs.vorticity.uniforms.dt, dt);
    blit(velocity.write);
    velocity.swap();

    programs.divergence.bind();
    setTexelSize(programs.divergence, velocity);
    gl.uniform1i(programs.divergence.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    programs.clear.bind();
    setTexelSize(programs.clear, pressure);
    gl.uniform1i(programs.clear.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(programs.clear.uniforms.value, PRESSURE_DISSIPATION);
    blit(pressure.write);
    pressure.swap();

    programs.pressure.bind();
    setTexelSize(programs.pressure, velocity);
    gl.uniform1i(programs.pressure.uniforms.uDivergence, divergence.attach(0));
    for (let index = 0; index < PRESSURE_ITERATIONS; index += 1) {
      gl.uniform1i(programs.pressure.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    programs.gradient.bind();
    setTexelSize(programs.gradient, velocity);
    gl.uniform1i(programs.gradient.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(programs.gradient.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    programs.advection.bind();
    setTexelSize(programs.advection, velocity);
    gl.uniform2f(
      programs.advection.uniforms.sourceTexelSize,
      velocity.texelSizeX,
      velocity.texelSizeY,
    );
    const velocityUnit = velocity.read.attach(0);
    gl.uniform1i(programs.advection.uniforms.uVelocity, velocityUnit);
    gl.uniform1i(programs.advection.uniforms.uSource, velocityUnit);
    gl.uniform1f(programs.advection.uniforms.dt, dt);
    gl.uniform1f(
      programs.advection.uniforms.dissipation,
      VELOCITY_DISSIPATION,
    );
    blit(velocity.write);
    velocity.swap();

    setTexelSize(programs.advection, velocity);
    gl.uniform2f(
      programs.advection.uniforms.sourceTexelSize,
      dye.texelSizeX,
      dye.texelSizeY,
    );
    gl.uniform1i(programs.advection.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(programs.advection.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(
      programs.advection.uniforms.dissipation,
      DENSITY_DISSIPATION,
    );
    blit(dye.write);
    dye.swap();
  };

  const render = () => {
    if (disposed || !dye) return;
    gl.disable(gl.BLEND);
    programs.display.bind();
    setTexelSize(programs.display, dye);
    gl.uniform1i(programs.display.uniforms.uTexture, dye.read.attach(0));
    blit(null);
  };

  const splat = (x, y, dx, dy, color, radius = 0.00062) => {
    if (disposed || !dye) return;
    programs.splat.bind();
    setTexelSize(programs.splat, velocity);
    gl.uniform1i(programs.splat.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(
      programs.splat.uniforms.aspectRatio,
      canvas.width / Math.max(canvas.height, 1),
    );
    gl.uniform2f(programs.splat.uniforms.point, x, y);
    gl.uniform3f(programs.splat.uniforms.color, dx, dy, 0);
    gl.uniform1f(programs.splat.uniforms.radius, radius);
    blit(velocity.write);
    velocity.swap();

    setTexelSize(programs.splat, dye);
    gl.uniform1i(programs.splat.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(programs.splat.uniforms.color, color[0], color[1], color[2]);
    blit(dye.write);
    dye.swap();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    releaseFramebuffers();
    Object.values(programs).forEach((program) => gl.deleteProgram(program.handle));
    if (quad) gl.deleteBuffer(quad);
    if (indices) gl.deleteBuffer(indices);
  };

  try {
    for (const [name, source] of Object.entries(programSources)) {
      programs[name] = createProgram(gl, source);
    }
    quad = gl.createBuffer();
    indices = gl.createBuffer();
    if (!quad || !indices) throw new Error("Unable to allocate status fluid buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
      gl.STATIC_DRAW,
    );
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 2, 0, 2, 3]),
      gl.STATIC_DRAW,
    );
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 1);
    resize();
    render();
  } catch (error) {
    dispose();
    throw error;
  }
  return { clear: clearAll, dispose, render, resize, splat, step };
}
