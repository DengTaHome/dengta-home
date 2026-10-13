import * as THREE from 'three';
import { B1857Character } from './upstream/b1857-character.js';
import { ACTIONS, InteractionController } from './upstream/interaction-controller.js';
import { InteractionProps } from './upstream/interaction-props.js';

function validateAsset(asset) {
  const fail = () => { throw new Error('pet_asset_invalid'); };
  if (!asset || !Array.isArray(asset.bones) || !asset.bones.length) fail();
  const names = new Set();
  for (const bone of asset.bones) {
    if (!bone || typeof bone.name !== 'string' || names.has(bone.name) ||
        !Array.isArray(bone.head) || bone.head.length !== 3 || !bone.head.every(Number.isFinite) ||
        (bone.parent && !names.has(bone.parent))) fail();
    names.add(bone.name);
  }
  for (const name of ['chest', 'neck', 'head', 'ear.L', 'ear.R', 'fore.L.lower', 'fore.R.lower', 'fore.L.paw', 'fore.R.paw', 'tail_0', 'tail_1', 'tail_2', 'tail_3']) {
    if (!names.has(name)) fail();
  }
  for (const name of ['positions', 'normals', 'indices', 'skinIndices', 'skinWeights']) {
    if (!Array.isArray(asset[name]) || !asset[name].length) fail();
  }
  const vertices = asset.positions.length / 3;
  if (!Number.isInteger(vertices) || asset.normals.length !== vertices * 3 ||
      asset.skinIndices.length !== vertices * 4 || asset.skinWeights.length !== vertices * 4 ||
      asset.indices.length % 3 !== 0) fail();
}

export async function createPetRuntime(canvas, { signal, initial, onChange, onError }) {
  const response = await fetch(`${import.meta.env.BASE_URL}cotton/b1857.json`, { signal });
  if (!response.ok) throw new Error('pet_asset_unavailable');
  const asset = await response.json();
  signal.throwIfAborted();
  validateAsset(asset);
  let renderer, scene, pet, observer, motionObserver, reduced;
  let disposed = false, raf = 0;
  function dispose() {
    if (disposed) return;
    settleStatic();
    disposed = true;
    let cleanupError;
    const release = cleanup => { try { cleanup(); } catch (error) { cleanupError ||= error; } };
    release(() => cancelAnimationFrame(raf));
    release(() => observer?.disconnect());
    release(() => motionObserver?.disconnect());
    release(() => document.removeEventListener('visibilitychange', resume));
    release(() => canvas.removeEventListener('webglcontextlost', lost));
    release(() => reduced?.removeEventListener?.('change', motionChanged));
    release(() => reduced?.removeListener?.(motionChanged));
    const geometries = new Set(), materials = new Set(), textures = new Set();
    for (const root of [scene, pet?.group, pet?.helper]) release(() => root?.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [].concat(object.material || [])) if (material) materials.add(material);
    }));
    for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    geometries.forEach(geometry => release(() => geometry.dispose()));
    textures.forEach(texture => release(() => texture.dispose()));
    materials.forEach(material => release(() => material.dispose()));
    release(() => pet?.skeleton.dispose());
    release(() => renderer?.dispose());
    release(() => renderer?.forceContextLoss());
    if (cleanupError) throw cleanupError;
  }
  let camera, behavior, props;
  let quiet = initial.quiet === true, paused = false, pendingQuiet = false, visible = !document.hidden;
  let last = 0, lastNotify = 0, motionUntil = 0, reducedMotion = false, frozenAt = null;
  try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, 1, .01, 20);
  camera.position.set(.58, .42, 1.35);
  camera.lookAt(0, .24, .02);
  scene.add(new THREE.HemisphereLight(0xfffaf1, 0x7e8975, 2.5));
  const light = new THREE.DirectionalLight(0xfff8ef, 3);
  light.position.set(-.9, 1.5, 1.3);
  scene.add(light);
  pet = new B1857Character({ asset });
  scene.add(pet.group, pet.helper);
  behavior = new InteractionController();
  Object.assign(behavior.stats, initial.stats);
  props = new InteractionProps(scene, pet);
  reduced = matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = prefersReducedMotion();
  } catch (error) {
    try { dispose(); } catch { /* Preserve the initialization error after attempting every release. */ }
    throw error;
  }
  function prefersReducedMotion() { return reduced.matches || document.documentElement?.dataset?.dengtaReducedMotion === 'true'; }
  function snapshot() { settleStatic(); return { stats: { ...behavior.stats }, action: behavior.active.id }; }
  function notify() { onChange(snapshot()); }
  function draw() { renderer.render(scene, camera); }
  function resize() {
    if (disposed) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.PI / 10) * Math.max(1, 1 / camera.aspect)));
    camera.updateProjectionMatrix();
    draw();
  }
  function frame(now) {
    raf = 0;
    if (disposed || paused || document.hidden) return;
    const interval = quiet || reducedMotion ? 1000 / 15 : 1000 / 30;
    if (now - last < interval) { schedule(); return; }
    const dt = last ? Math.min(.1, (now - last) / 1000) : 0;
    last = now;
    behavior.update(dt);
    pet.setInteraction({ id: behavior.active.id, age: behavior.age, envelope: behavior.envelope });
    pet.update(dt);
    props.update(dt, behavior);
    // The upstream authoring history is diagnostic only; bound it for long visits.
    if (behavior.history.length > 32) behavior.history.splice(0, behavior.history.length - 32);
    draw();
    if (now - lastNotify > 1000) { lastNotify = now; notify(); }
    if (reducedMotion && behavior.time >= motionUntil) notify();
    schedule();
  }
  function schedule() {
    if (disposed || paused || document.hidden) return;
    if (!reducedMotion || behavior.time < motionUntil) { frozenAt = null; raf = requestAnimationFrame(frame); }
    else frozenAt = performance.now();
  }
  function settleStatic() {
    if (disposed || frozenAt === null) return;
    const now = performance.now(), elapsed = Math.max(0, now - frozenAt) / 1000;
    frozenAt = now;
    if (!visible || paused || !elapsed || !['idle', 'rest'].includes(behavior.active.id)) return;
    const time = behavior.time;
    behavior.update(elapsed);
    // The author's rest gain uses elapsed time; its animation clock clamps a tick to .1s.
    behavior.time = time + elapsed;
  }
  function resume() {
    settleStatic();
    visible = !document.hidden;
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    frozenAt = null;
    schedule();
  }
  function allowActionMotion() {
    const duration = ACTIONS[behavior.active.id].duration;
    motionUntil = behavior.time + (duration ? Math.max(0, duration - behavior.age) : .8) + .7;
  }
  function motionChanged() {
    if (disposed) return;
    const next = prefersReducedMotion();
    if (next === reducedMotion) return;
    settleStatic();
    reducedMotion = next;
    if (next && behavior.active.id !== 'idle') allowActionMotion();
    else motionUntil = behavior.time;
    if (!paused && !document.hidden) draw();
    resume();
  }
  function command(id) {
    if (disposed || paused) return { accepted: false, reason: '先继续陪伴，再和小棉花互动。' };
    settleStatic();
    const result = behavior.request(id);
    if (result.accepted) { pet.command(id); allowActionMotion(); notify(); resume(); }
    return result;
  }
  function lost(event) { event.preventDefault(); settleStatic(); paused = true; resume(); onError(); }
  try {
  observer = new ResizeObserver(resize);
  observer.observe(canvas);
  document.addEventListener('visibilitychange', resume);
  canvas.addEventListener('webglcontextlost', lost);
  if (reduced.addEventListener) reduced.addEventListener('change', motionChanged);
  else reduced.addListener?.(motionChanged);
  if (document.documentElement && typeof MutationObserver !== 'undefined') {
    motionObserver = new MutationObserver(motionChanged);
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dengta-reduced-motion'] });
  }
  if (quiet) command('rest');
  pet.setInteraction({ id: behavior.active.id, age: behavior.age, envelope: behavior.envelope });
  pet.update(0);
  props.update(0, behavior);
  notify(); resize(); resume();
  signal.throwIfAborted();
  } catch (error) {
    try { dispose(); } catch { /* Preserve the initialization error after attempting every release. */ }
    throw error;
  }
  return {
    command,
    snapshot,
    setPaused(value) {
      if (disposed) return;
      settleStatic();
      paused = value;
      if (!paused && pendingQuiet) { behavior.request(quiet ? 'rest' : 'wake', { force: true }); allowActionMotion(); pendingQuiet = false; notify(); }
      resume();
    },
    setQuiet(value) {
      if (disposed) return;
      settleStatic();
      quiet = value;
      pendingQuiet = paused;
      if (!paused) { behavior.request(value ? 'rest' : 'wake', { force: true }); allowActionMotion(); notify(); resume(); }
    },
    dispose,
  };
}
