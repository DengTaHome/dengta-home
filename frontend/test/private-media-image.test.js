import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { StrictMode, act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
const oldCreateUrl = URL.createObjectURL, oldRevokeUrl = URL.revokeObjectURL;
const createdUrls = [], revokedUrls = [], observers = [], listeners = new Set();
const fixture = {
  snapshot: { user: { id: "account-a" }, activeCompanionId: "companion-a" }, calls: [],
  publish(snapshot) { fixture.snapshot = snapshot; listeners.forEach((listener) => listener(snapshot)); },
  request(path, options) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    fixture.calls.push({ path, options, snapshot: fixture.snapshot, resolve, reject });
    return promise;
  },
};
globalThis.__privateImageFixture = fixture;
Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: class {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe(target) { this.target = target; }
  disconnect() { this.disconnected = true; }
  emit(isIntersecting) { this.callback([{ target: this.target, isIntersecting }]); }
} });
URL.createObjectURL = () => { const url = `blob:synthetic-${createdUrls.length + 1}`; createdUrls.push(url); return url; };
URL.revokeObjectURL = (url) => revokedUrls.push(url);
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true },
  plugins: [{
    name: "private-image-api-fixture", enforce: "pre",
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/src/use-private-media.js")) {
        return code.replace('"./api"', '"virtual:private-image-api"').replace('"./auth-session.js"', '"virtual:private-image-auth"');
      }
    },
    resolveId(id) { if (id.startsWith("virtual:private-image-")) return `\0${id}`; },
    load(id) {
      if (id === "\0virtual:private-image-api") return 'export const API_BASE_URL="https://backend.example.test"; export const apiFetch=(...args)=>globalThis.__privateImageFixture.request(...args);';
      if (id === "\0virtual:private-image-auth") return 'const fixture=globalThis.__privateImageFixture; export const authSession={getSnapshot:()=>fixture.snapshot,subscribe:listener=>{globalThis.__privateImageListeners.add(listener);return()=>globalThis.__privateImageListeners.delete(listener);}};';
    },
  }],
});
globalThis.__privateImageListeners = listeners;
let tree;
try {
  const { AuthenticatedImage } = await vite.ssrLoadModule("/src/PrivateMedia.jsx");
  const { usePrivateMediaSource } = await vite.ssrLoadModule("/src/use-private-media.js");
  const sourceA = "/api/v2/private-media/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/content";
  const sourceB = "/api/v2/private-media/assets/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/content";
  let props;
  const mount = async (options = {}, strict = false) => {
    fixture.calls = []; observers.length = 0;
    props = { src: sourceA, alt: "虚构图片", className: "fixture-image", ...options };
    const content = React.createElement(AuthenticatedImage, props);
    await act(async () => { tree = TestRenderer.create(strict ? React.createElement(StrictMode, null, content) : content, { createNodeMock: (element) => ({ type: element.type }) }); });
  };
  const update = async (updates) => { props = { ...props, ...updates }; await act(async () => tree.update(React.createElement(AuthenticatedImage, props))); };
  const unmount = async () => { await act(async () => tree.unmount()); tree = null; };
  const visible = async () => { await act(async () => observers.at(-1).emit(true)); };
  const resolve = async (index) => { await act(async () => fixture.calls[index].resolve({ ok: true, blob: async () => new Blob(["synthetic pixels"]) })); };

  await mount();
  assert.equal(fixture.calls.length, 0, "offscreen private images must not start an authenticated fetch");
  assert.equal(observers.length, 1);
  await act(async () => observers[0].emit(false));
  assert.equal(fixture.calls.length, 0);
  await visible();
  assert.equal(fixture.calls.length, 1, "entering the viewport starts one read");
  assert.equal(fixture.calls[0].path, sourceA);
  assert.equal(fixture.calls[0].options.retry, false);
  assert.equal(fixture.calls[0].options.cache, "no-store");
  assert.equal(fixture.calls[0].options.signal.aborted, false);
  await resolve(0);
  const firstUrl = tree.root.findByType("img").props.src;
  assert.equal(firstUrl, createdUrls.at(-1));
  assert.equal(tree.root.findByType("img").props.decoding, "async");
  await act(async () => fixture.publish({ user: { id: "account-b" }, activeCompanionId: "companion-b" }));
  assert.equal(tree.root.findAllByType("img").length, 0, "same URL never paints another scope's old blob");
  assert.ok(revokedUrls.includes(firstUrl));
  assert.equal(fixture.calls[0].options.signal.aborted, true);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[1].snapshot.user.id, "account-b");
  await resolve(1);
  const secondUrl = tree.root.findByType("img").props.src;
  assert.notEqual(secondUrl, firstUrl);
  await act(async () => fixture.publish({ user: { id: "account-b" }, activeCompanionId: "companion-c" }));
  assert.equal(tree.root.findAllByType("img").length, 0);
  assert.ok(revokedUrls.includes(secondUrl), "companion switch within one account revokes its old blob");
  assert.equal(fixture.calls.length, 3);
  await resolve(2);
  const companionUrl = tree.root.findByType("img").props.src;
  await unmount();
  assert.ok(revokedUrls.includes(companionUrl));

  await mount();
  await visible();
  const oldObserver = observers.at(-1);
  await update({ src: sourceB });
  assert.equal(fixture.calls[0].options.signal.aborted, true);
  assert.equal(fixture.calls.length, 1, "a new offscreen source waits for its own observation");
  await act(async () => oldObserver.emit(true));
  assert.equal(fixture.calls.length, 1, "old observer cannot make the new source visible");
  const urlsBeforeOldRead = createdUrls.length;
  await resolve(0);
  assert.equal(createdUrls.length, urlsBeforeOldRead, "late response for an old source creates no blob URL");
  assert.equal(tree.root.findAllByType("img").length, 0);
  await visible();
  assert.equal(fixture.calls[1].path, sourceB);
  await unmount();
  assert.equal(fixture.calls[1].options.signal.aborted, true);
  assert.ok(observers.every((observer) => observer.disconnected));
  await resolve(1);
  assert.equal(createdUrls.length, urlsBeforeOldRead, "unmounted read never creates a blob URL");

  await mount({ loading: "eager" });
  assert.equal(fixture.calls.length, 1, "eager avatars keep immediate loading");
  assert.equal(observers.length, 0);
  await act(async () => fixture.publish({ user: { id: "account-a" }, activeCompanionId: "companion-a" }));
  await act(async () => fixture.publish({ user: { id: "account-b" }, activeCompanionId: "companion-b" }));
  assert.equal(fixture.calls.length, 3);
  await resolve(0); await resolve(1);
  assert.equal(tree.root.findAllByType("img").length, 0, "A-B-A scope cycles cannot revive an earlier read");
  await resolve(2);
  await unmount();

  await mount({}, true);
  assert.equal(fixture.calls.length, 0, "StrictMode still leaves offscreen media unread");
  await visible();
  assert.equal(fixture.calls.length, 1, "StrictMode visibility starts only one read");
  await resolve(0);
  const strictUrl = tree.root.findByType("img").props.src;
  await unmount();
  assert.ok(revokedUrls.includes(strictUrl));

  await mount();
  await visible();
  await act(async () => fixture.calls[0].resolve({ ok: false, json: async () => ({ message: "fixture inaccessible" }) }));
  assert.ok(tree.root.findByProps({ role: "status" }).children.join("").includes("暂时无法显示"));
  assert.equal(fixture.calls.length, 1, "failed image reads do not loop");
  await unmount();

  delete globalThis.IntersectionObserver;
  let preview;
  await mount({ onPreview: (url) => { preview = url; } });
  assert.equal(fixture.calls.length, 1, "browsers without observers retain a readable eager fallback");
  await resolve(0);
  const previewUrl = tree.root.findByType("img").props.src;
  tree.root.findByType("button").props.onClick();
  assert.equal(preview, previewUrl);
  await unmount();
  if (previousObserver) Object.defineProperty(globalThis, "IntersectionObserver", previousObserver);

  fixture.calls = [];
  let currentMedia;
  function SourceHarness({ enabled = true }) {
    currentMedia = usePrivateMediaSource(sourceA, { enabled });
    return React.createElement("output", null, currentMedia.url);
  }
  await act(async () => { tree = TestRenderer.create(React.createElement(SourceHarness)); });
  assert.equal(fixture.calls.length, 1, "direct source-hook consumers remain eager by default");
  await resolve(0);
  const directUrl = currentMedia.url;
  await act(async () => tree.update(React.createElement(SourceHarness, { enabled: false })));
  assert.equal(currentMedia.url, "");
  assert.ok(revokedUrls.includes(directUrl));
  await unmount();
  assert.equal(listeners.size, 0, "auth subscriptions leave no mounted-image residue");

  console.log("Actual private image passed: offscreen zero fetches, visible loading, eager/fallback/direct hook, scope and source isolation, old responses, no shared cache, request abort, blob revocation, StrictMode and preview.");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  URL.createObjectURL = oldCreateUrl; URL.revokeObjectURL = oldRevokeUrl;
  if (previousObserver) Object.defineProperty(globalThis, "IntersectionObserver", previousObserver);
  else delete globalThis.IntersectionObserver;
  delete globalThis.__privateImageFixture; delete globalThis.__privateImageListeners;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
