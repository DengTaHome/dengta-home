import assert from 'node:assert/strict';
import { createChatScrollController } from '../src/chat-scroll-controller.js';

class Target {
  listeners = new Map();
  addEventListener(name, fn) { const set = this.listeners.get(name) || new Set(); set.add(fn); this.listeners.set(name, set); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  fire(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn(event); }
}
function setup(height = 2400) {
  const list = new Target(), runtime = new Target(), frames = new Map(), timers = new Map();
  let id = 0, top = 0, resize;
  Object.assign(list, { clientHeight: 600, scrollHeight: height, firstElementChild: {}, classList: { add() {}, remove() {} } });
  Object.defineProperty(list, 'scrollTop', { get: () => top, set: v => { top = Math.max(0, Math.min(v, list.scrollHeight - list.clientHeight)); } });
  Object.assign(runtime, {
    requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(i) { frames.delete(i); },
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(i) { timers.delete(i); },
    ResizeObserver: class { constructor(fn) { resize = fn; } observe() {} disconnect() { resize = null; } },
  });
  const follow = { current: false };
  const controller = createChatScrollController(list, follow, runtime);
  function flush() { const all = [...frames.values()]; frames.clear(); all.forEach(fn => fn()); }
  return { list, runtime, frames, timers, follow, controller, flush, resize: () => resize?.() };
}
const f = setup();
assert.equal(f.list.scrollTop, 1800, 'opening jumps to latest before paint regardless of previous follow state');
f.flush();
f.list.scrollHeight += 300;
f.controller.sync();
assert.equal(f.list.scrollTop, 2100, 'stream growth follows without animation');
f.list.scrollTop = 0; f.list.fire('scroll');
f.controller.sync();
assert.equal(f.list.scrollTop, 2100, 'layout-driven scroll at top must not disable following');
f.list.fire('wheel', { deltaY: -100 }); f.list.scrollTop = 1600; f.list.fire('scroll');
f.list.scrollHeight += 300; f.controller.sync(); f.resize(); f.flush();
assert.equal(f.list.scrollTop, 1600, 'reading history stays put during streaming and media layout');
f.controller.open(); assert.equal(f.list.scrollTop, 2400, 'reopening always goes to latest');
f.list.fire('touchstart', { touches: [{ clientY: 100 }] });
f.list.fire('touchmove', { touches: [{ clientY: 180 }] });
f.list.scrollTop = 1800; f.list.fire('scroll'); f.list.scrollHeight += 200; f.controller.sync();
assert.equal(f.list.scrollTop, 1800, 'touch reading is not pulled back');
f.list.scrollTop = f.list.scrollHeight; f.list.fire('scroll'); f.list.scrollHeight += 200; f.resize(); f.flush();
assert.equal(f.list.scrollTop, 2800, 'reaching bottom resumes following delayed image layout');
f.list.clientHeight = 350; f.resize(); f.flush();
assert.equal(f.list.scrollTop, 3050, 'keyboard viewport resize keeps latest visible');
f.list.fire('keydown', { key: 'PageUp' });
f.list.fire('scroll');
assert.equal(f.follow.current, false, 'a queued bottom scroll must not cancel upward keyboard intent');
f.list.scrollTop = 1000; f.controller.sync();
assert.equal(f.list.scrollTop, 1000, 'keyboard history navigation works');
f.controller.open(); f.flush();
f.list.fire('pointerdown', { pointerType: 'mouse' }); f.list.scrollTop = 1200; f.list.fire('scroll'); f.runtime.fire('pointerup'); f.controller.sync();
assert.equal(f.list.scrollTop, 1200, 'scrollbar dragging stops following');
f.controller.open(); f.controller.dispose();
assert.equal(f.frames.size + f.timers.size, 0, 'no delayed correction survives navigation');
assert.ok([...f.list.listeners.values(), ...f.runtime.listeners.values()].every(set => set.size === 0));
const empty = setup(600); empty.flush(); empty.list.scrollHeight = 8000; empty.resize(); empty.flush();
assert.equal(empty.list.scrollTop, 7400, 'asynchronous history opens at bottom even after initially empty render');
empty.controller.dispose();
console.log('chat scroll controller: entry, async history, stream, touch/wheel/keyboard/scrollbar, resize and cleanup passed');
