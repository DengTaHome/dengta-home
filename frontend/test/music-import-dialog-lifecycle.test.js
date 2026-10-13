import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const previousGlobals = new Map();
function stub(name, value) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
const saved = { id: "fixture-list", name: "虚构测试歌单", itemCount: 1, items: [{ id: "fixture-track", title: "虚构歌曲", url: "https://media.example.test/audio.mp3", playbackMode: "direct_https" }] };
function deferred() {
  let resolve;
  const promise = new Promise((callback) => { resolve = callback; });
  return { promise, resolve };
}
let pending, importCalls, importOptions;
stub("IS_REACT_ACT_ENVIRONMENT", true);
stub("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout, setInterval, clearInterval, localStorage: { getItem: () => null, setItem() {} } }));
stub("document", null);
stub("__musicDialogFixture", {
  auth: { getSnapshot: () => ({ user: { id: "fixture-account" }, activeCompanionId: "fixture-companion" }) },
  listMusicPlaylists: async () => [], listMusicFavorites: async () => [], listNeteaseConnections: async () => [],
  importMusicPlaylist(payload, options) { importCalls++; importOptions = options; return pending.promise; },
  getMusicPlaylist: async () => saved,
  readNeteaseCookieSession: async () => ({ session: { connected: false } }),
});
const methods = ["listMusicPlaylists", "listMusicFavorites", "listNeteaseConnections", "importMusicPlaylist", "importNeteaseShare", "getMusicPlaylist", "readNeteaseCookieSession", "connectNeteaseMcp", "cookieGetDailyRecommend", "cookieGetMyPlaylists", "cookieGetPlayHistory", "cookieGetPlaylistTracks", "cookieLikeSong", "cookieSearchNetease", "deleteMusicFavorite", "clearNeteaseCookieSession", "saveNeteaseCookieSession", "putMusicFavorite", "requestExternalMusicPlayback", "deleteMusicPlaylist", "getNeteaseConnectionStatus", "getNeteasePlaylist", "listNeteasePlaylists", "searchNeteaseMusic", "uploadLocalMusicFile"];
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{
  name: "music-dialog-lifecycle-fixture", enforce: "pre",
  transform(code, id) {
    const normalized = id.replaceAll("\\", "/");
    if (/\/(MusicSettings|TogetherMusic)\.jsx$/.test(normalized)) return code.replace('"./music-listening.js"', '"virtual:music-dialog-api"');
    if (normalized.endsWith("/MusicImportDialog.jsx")) return code.replace('"react-dom"', '"virtual:music-dialog-portal"');
  },
  resolveId(id) { if (id.startsWith("virtual:music-dialog-")) return "\0" + id; },
  load(id) {
    if (id.replaceAll("\\", "/").endsWith("/src/auth-session.js")) return "export const authSession=globalThis.__musicDialogFixture.auth;";
    if (id === "\0virtual:music-dialog-portal") return "export const createPortal=children=>children;";
    if (id === "\0virtual:music-dialog-api") return 'export {detectNeteaseShare} from "/src/music-listening.js";\n' + methods.map((name) => `export const ${name}=(...args)=>globalThis.__musicDialogFixture.${name}?.(...args)??Promise.resolve({});`).join("\n");
  },
}] });
const { default: Music } = await vite.ssrLoadModule("/src/TogetherMusic.jsx");
const { default: Settings } = await vite.ssrLoadModule("/src/MusicSettings.jsx");
const { default: Dialog } = await vite.ssrLoadModule("/src/MusicImportDialog.jsx");
let tree, doc, panels;
function control(id, tagName = "BUTTON", { disabled = false, tabIndex = 0, visible = true } = {}) {
  return { id, tagName, disabled, tabIndex,
    getClientRects: () => visible ? [1] : [],
    focus() { if (!this.disabled) doc.activeElement = this; },
  };
}
function documentFixture() {
  const listeners = [];
  const opener = control("opener"); opener.isConnected = true;
  return { activeElement: opener, opener, visibilityState: "visible", body: { style: { overflow: "auto" } }, listeners,
    addEventListener(name, callback, options) { listeners.push({ name, callback, capture: options === true || options?.capture === true }); },
    removeEventListener(name, callback, options) {
      const capture = options === true || options?.capture === true;
      const at = listeners.findIndex((entry) => entry.name === name && entry.callback === callback && entry.capture === capture);
      if (at >= 0) listeners.splice(at, 1);
    },
    key(key, shiftKey = false, details = {}) {
      const event = { key, shiftKey, ...details, defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; },
      };
      for (const capture of [true, false]) {
        for (const entry of [...listeners]) if (entry.name === "keydown" && entry.capture === capture) entry.callback(event);
        if (event.propagationStopped) break;
      }
      return event;
    },
  };
}
function nodeMock(extraControls = []) {
  return (node) => {
    if (node.props.role !== "dialog") return null;
    const close = control("close", "BUTTON", { disabled: node.props.children[0].props.children[1].props.disabled });
    const all = [close, ...extraControls];
    const panel = control("panel", "SECTION", { tabIndex: -1 });
    Object.assign(panel, {
      close, all,
      querySelector: () => close,
      querySelectorAll(selector) {
        return all.filter((entry) => {
          if (entry.disabled) return false;
          if (["AUDIO", "VIDEO"].includes(entry.tagName)) return selector.includes(`${entry.tagName.toLowerCase()}[controls]`);
          if (entry.tagName === "SUMMARY") return selector.includes("summary");
          return selector.includes(entry.tagName.toLowerCase());
        });
      },
      contains: (entry) => entry === panel || all.includes(entry),
    });
    panels.push(panel);
    return panel;
  };
}
const button = (text) => tree.root.findAllByType("button").find((node) => node.children.includes(text));
const closeButton = () => tree.root.findAllByType("button").find((node) => node.props["aria-label"] === "关闭歌曲导入");
test.beforeEach(() => {
  pending = deferred(); importCalls = 0; importOptions = null; panels = [];
  doc = documentFixture(); globalThis.document = doc;
});
test.afterEach(async () => { if (tree) { await act(async () => tree.unmount()); tree = null; } });
test.after(async () => {
  await vite.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

test("successful import clears parent busy before closing and reopening focuses the enabled close button", async () => {
  await act(async () => { tree = TestRenderer.create(React.createElement(Music), { createNodeMock: nodeMock() }); });
  await act(async () => button("导入歌曲").props.onClick());
  assert.equal(doc.activeElement, panels[0].close);
  await act(async () => tree.root.findByType("textarea").props.onChange({ target: { value: "https://media.example.test/audio.mp3" } }));
  await act(async () => button("导入歌单").props.onClick());
  assert.equal(closeButton().props.disabled, true);
  await act(async () => pending.resolve(saved));
  assert.equal(tree.root.findAll((node) => node.props.role === "dialog").length, 0);
  assert.equal(doc.activeElement, doc.opener);
  await act(async () => button("导入歌曲").props.onClick());
  assert.equal(panels[1].close.disabled, false, "reopening must mount with the old save already finished");
  assert.equal(closeButton().props.disabled, false);
  assert.equal(doc.activeElement, panels[1].close);
  assert.equal(importCalls, 1);
});

test("parent busy notification blocks stale close and open callbacks before React rerenders", async () => {
  await act(async () => { tree = TestRenderer.create(React.createElement(Music), { createNodeMock: nodeMock() }); });
  await act(async () => button("导入歌曲").props.onClick());
  const close = tree.root.findByType(Dialog).props.onClose;
  const open = button("导入歌曲").props.onClick;
  const notifyBusy = tree.root.findByType(Settings).props.onBusyChange;
  await act(async () => { notifyBusy(true); close(); open(); });
  assert.equal(tree.root.findAllByType(Dialog).length, 1);
  assert.equal(closeButton().props.disabled, true);
  await act(async () => { notifyBusy(false); close(); });
  assert.equal(tree.root.findAllByType(Dialog).length, 0);
});

test("actual import immediately blocks stale close, stale reopen and Escape while preserving one pending save", async () => {
  await act(async () => { tree = TestRenderer.create(React.createElement(Music), { createNodeMock: nodeMock() }); });
  await act(async () => button("导入歌曲").props.onClick());
  await act(async () => tree.root.findByType("textarea").props.onChange({ target: { value: "https://media.example.test/pending.mp3" } }));
  const close = tree.root.findByType(Dialog).props.onClose;
  const open = button("导入歌曲").props.onClick;
  const submit = button("导入歌单").props.onClick;
  await act(async () => { submit(); close(); open(); doc.key("Escape"); });
  assert.equal(importCalls, 1);
  assert.equal(importOptions.signal.aborted, false);
  assert.equal(tree.root.findAllByType(Dialog).length, 1);
  assert.equal(closeButton().props.disabled, true);
  await act(async () => button("导入歌曲").props.onClick());
  assert.equal(closeButton().props.disabled, true, "an active save cannot be reset by its launch trigger");
  await act(async () => pending.resolve(saved));
  assert.equal(tree.root.findAllByType(Dialog).length, 0);
});

test("initially busy dialog focuses its first enabled visible control", async () => {
  const invisible = control("hidden-input", "INPUT", { visible: false });
  const excluded = control("negative-tab-input", "INPUT", { tabIndex: -1 });
  const input = control("name", "INPUT");
  await act(async () => { tree = TestRenderer.create(React.createElement(Dialog, { busy: true }, "Fixture"), { createNodeMock: nodeMock([invisible, excluded, input]) }); });
  assert.equal(doc.activeElement, input);
  assert.equal(closeButton().props.disabled, true);
});

test("dialog without enabled controls focuses its panel and traps Tab", async () => {
  await act(async () => { tree = TestRenderer.create(React.createElement(Dialog, { busy: true }, "Fixture"), { createNodeMock: nodeMock() }); });
  assert.equal(doc.activeElement, panels[0]);
  const event = doc.key("Tab");
  assert.equal(event.defaultPrevented, true);
  assert.equal(doc.activeElement, panels[0]);
});

test("Escape is consumed before lower document listeners while saving and closes only this dialog when idle", async () => {
  let lower = 0, closed = 0;
  const lowerHandler = () => lower++;
  doc.addEventListener("keydown", lowerHandler);
  await act(async () => { tree = TestRenderer.create(React.createElement(Dialog, { busy: true, onClose: () => closed++ }, "Fixture"), { createNodeMock: nodeMock() }); });
  const busyEvent = doc.key("Escape");
  assert.equal(busyEvent.defaultPrevented, true);
  assert.equal(closed, 0);
  assert.equal(lower, 0);
  await act(async () => tree.update(React.createElement(Dialog, { busy: false, onClose: () => closed++ }, "Fixture")));
  doc.key("Escape");
  assert.equal(closed, 1);
  assert.equal(lower, 0);
  await act(async () => tree.unmount()); tree = null;
  assert.equal(doc.listeners.length, 1, "the dialog must remove the capture listener on unmount");
  assert.equal(doc.body.style.overflow, "auto");
  assert.equal(doc.activeElement, doc.opener);
  doc.removeEventListener("keydown", lowerHandler);
});

test("Escape leaves IME composition and modified system shortcuts untouched", async () => {
  let closed = 0;
  await act(async () => { tree = TestRenderer.create(React.createElement(Dialog, { onClose: () => closed++ }, "Fixture"), { createNodeMock: nodeMock() }); });
  for (const details of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    const event = doc.key("Escape", false, details);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.propagationStopped, false);
    assert.equal(closed, 0);
  }
});

for (const tagName of ["AUDIO", "VIDEO"]) test(`Tab cycle includes the focusable ${tagName.toLowerCase()} controls element after the import button`, async () => {
  const submit = control("submit"), media = control("media", tagName);
  await act(async () => { tree = TestRenderer.create(React.createElement(Dialog, null, "Fixture"), { createNodeMock: nodeMock([submit, media]) }); });
  doc.activeElement = submit;
  assert.equal(doc.key("Tab").defaultPrevented, false, "native tab order must be allowed to reach the media element");
  doc.activeElement = media;
  assert.equal(doc.key("Tab").defaultPrevented, true);
  assert.equal(doc.activeElement, panels[0].close);
  assert.equal(doc.key("Tab", true).defaultPrevented, true);
  assert.equal(doc.activeElement, media);
});

test("duplicate import then unmount ignores the late receipt and preserves a clean new draft", async () => {
  let notified = 0;
  await act(async () => { tree = TestRenderer.create(React.createElement(Settings, { compact: true, onImported: () => notified++ })); });
  await act(async () => tree.root.findByType("textarea").props.onChange({ target: { value: "https://media.example.test/pending.mp3" } }));
  await act(async () => { const submit = button("导入歌单").props.onClick; submit(); submit(); });
  assert.equal(importCalls, 1);
  await act(async () => tree.unmount()); tree = null;
  assert.equal(importOptions.signal.aborted, true);
  await act(async () => pending.resolve(saved));
  assert.equal(notified, 0);
  await act(async () => { tree = TestRenderer.create(React.createElement(Settings, { compact: true })); });
  assert.equal(tree.root.findByType("textarea").props.value, "");
  assert.equal(importCalls, 1);
});
