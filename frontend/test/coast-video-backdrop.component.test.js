import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const original = new Map(["document", "window", "navigator", "MutationObserver", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const vite = await createServer({ server: { middlewareMode: true }, logLevel: "silent" });
const Backdrop = (await vite.ssrLoadModule("/src/CoastVideoBackdrop.jsx")).default;
let renderer, video, attributes, plays, documentObject;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test.beforeEach(() => {
  documentObject = Object.assign(new EventTarget(), { hidden: false, documentElement: { dataset: {} } });
  const windowObject = Object.assign(new EventTarget(), { matchMedia: () => Object.assign(new EventTarget(), { matches: false }) });
  for (const [key, value] of Object.entries({ document: documentObject, window: windowObject, navigator: {}, MutationObserver: undefined, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  attributes = new Map();
  plays = 0;
  video = Object.assign(new EventTarget(), {
    getAttribute: name => attributes.get(name) || null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    load() {},
    play() { plays++; return Promise.resolve(); },
    pause() {},
  });
});
test.afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
test.after(async () => {
  await vite.close();
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

async function mount(props) {
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Backdrop, props), { createNodeMock(element) {
      if (element.type === "video") return video;
      return { closest: () => ({ querySelector: () => null, classList: { contains: () => false } }) };
    } });
    await flush();
  });
}
const layer = () => renderer.root.findByProps({ className: "coast-video-backdrop" });

test("real component is decorative, silent, inline, unfocusable, and owns only one decoder", async () => {
  await mount({ sky: { solarMinute: 720 }, weatherMode: "rain" });
  const media = renderer.root.findByType("video");
  assert.equal(media.props.muted, true);
  assert.equal(media.props.loop, true);
  assert.equal(media.props.playsInline, true);
  assert.equal(media.props.preload, "none");
  assert.equal(media.props.tabIndex, -1);
  assert.equal(media.props.src, undefined, "React must not start downloading before lifecycle gates are checked");
  assert.equal(renderer.root.findAllByType("video").length, 1);
  assert.equal(layer().props["aria-hidden"], "true");
  assert.equal(layer().props["data-weather"], "rain");
  assert.equal(attributes.get("src"), "/assets/coast-video/coast-day.mp4");
  assert.equal(layer().props["data-playback"], "loading");
  await act(async () => video.dispatchEvent(new Event("playing")));
  assert.equal(layer().props["data-playback"], "playing");
});

test("real phase switch holds the prior poster until the new clip can fade in and returns correct fallback on error", async () => {
  await mount({ sky: { solarMinute: 720 } });
  await act(async () => video.dispatchEvent(new Event("playing")));
  await act(async () => { renderer.update(React.createElement(Backdrop, { sky: { solarMinute: 1300 } })); await flush(); });
  assert.equal(attributes.get("src"), "/assets/coast-video/coast-night.mp4");
  assert.equal(renderer.root.findAllByType("video").length, 1);
  assert.equal(plays, 2);
  assert.equal(layer().props["data-playback"], "loading");
  assert.equal(renderer.root.findByType("img").props.src, "/assets/coast-video/coast-day.webp");
  await act(async () => video.dispatchEvent(new Event("playing")));
  assert.equal(layer().props["data-playback"], "playing");
  await act(async () => video.dispatchEvent(new Event("error")));
  assert.equal(layer().props["data-playback"], "error");
  assert.equal(renderer.root.findByType("img").props.src, "/assets/coast-video/coast-night.webp");
  assert.equal(attributes.has("src"), false);
});

test("real reduced-motion toggle clears the source, leaves a still, and can resume after opt-in", async () => {
  await mount({ sky: { solarMinute: 480 }, reducedMotion: true });
  assert.equal(attributes.has("src"), false);
  assert.equal(plays, 0);
  assert.equal(layer().props["data-playback"], "static");
  assert.equal(renderer.root.findByType("img").props.src, "/assets/coast-video/coast-twilight.webp");
  await act(async () => { renderer.update(React.createElement(Backdrop, { sky: { solarMinute: 480 }, reducedMotion: false })); await flush(); });
  assert.equal(attributes.get("src"), "/assets/coast-video/coast-twilight.mp4");
  assert.equal(plays, 1);
  await act(async () => renderer.unmount());
  renderer = null;
  assert.equal(attributes.has("src"), false);
});

test("completed fades remember the latest poster through three consecutive scenes", async () => {
  await mount({ sky: { solarMinute: 720 } });
  await act(async () => video.dispatchEvent(new Event("playing")));
  await act(async () => renderer.root.findByType("video").props.onTransitionEnd({ propertyName: "opacity" }));
  await act(async () => { renderer.update(React.createElement(Backdrop, { sky: { solarMinute: 1300 } })); await flush(); });
  await act(async () => video.dispatchEvent(new Event("playing")));
  await act(async () => renderer.root.findByType("video").props.onTransitionEnd({ propertyName: "opacity" }));
  assert.equal(renderer.root.findByType("img").props.src, "/assets/coast-video/coast-night.webp");
  await act(async () => { renderer.update(React.createElement(Backdrop, { sky: { solarMinute: 480 } })); await flush(); });
  assert.equal(layer().props["data-playback"], "loading");
  assert.equal(renderer.root.findByType("img").props.src, "/assets/coast-video/coast-night.webp", "the third clip must fade from the previous night, not the original day");
  await act(async () => video.dispatchEvent(new Event("playing")));
  await act(async () => renderer.root.findByType("video").props.onTransitionEnd({ propertyName: "opacity" }));
  assert.equal(renderer.root.findByType("img").props.src, "/assets/coast-video/coast-twilight.webp");
});

test("source switch cancels a fade fallback timer and a stale transition cannot replace the new poster", async () => {
  await mount({ sky: { solarMinute: 720 } });
  await act(async () => video.dispatchEvent(new Event("playing")));
  const staleTransition = renderer.root.findByType("video").props.onTransitionEnd;
  await act(async () => { renderer.update(React.createElement(Backdrop, { sky: { solarMinute: 1300 }, reducedMotion: true })); await flush(); });
  await act(async () => {
    staleTransition({ propertyName: "opacity" });
    await new Promise(resolve => setTimeout(resolve, 2200));
  });
  assert.equal(layer().props["data-playback"], "static");
  assert.equal(renderer.root.findByType("img").props.src, "/assets/coast-video/coast-night.webp");
});
