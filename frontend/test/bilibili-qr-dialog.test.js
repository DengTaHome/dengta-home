import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const names = ["window", "document", "IS_REACT_ACT_ENVIRONMENT", "__bilibiliDialogFixture"];
const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const timers = new Map();
let tree, doc, panel, nextTimer = 0, begins, checks, beginRead, checkRead;
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = {
  setInterval(fn) { timers.set(++nextTimer, fn); return nextTimer; },
  clearInterval(id) { timers.delete(id); },
};
globalThis.__bilibiliDialogFixture = {
  getBilibiliQrStatus: async () => ({ connected: false }),
  beginBilibiliQrLogin() { begins++; return beginRead?.promise || Promise.resolve({ key: `fictional-${begins}`, qr_content: `https://fictional.invalid/qr-${begins}` }); },
  checkBilibiliQrLogin() { checks++; return checkRead?.promise || Promise.resolve({ status: "expired" }); },
  disconnectBilibiliQrLogin: async () => true,
  listBilibiliFavoriteFolders: async () => [],
  listBilibiliFavoriteVideos: async () => [],
  openBuiltInBrowser: async () => { throw new Error("fixture must never open a browser"); },
  readBrowserCookie: async () => { throw new Error("fixture must never read a cookie"); },
  apiRequest: async () => { throw new Error("fixture must never call an API"); },
};
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  appType: "custom", logLevel: "silent", server: { middlewareMode: true },
  plugins: [{
    name: "bilibili-dialog-fixture", enforce: "pre",
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/BilibiliQrLogin.jsx")) return code.replace('"react-dom"', '"virtual:bili-dialog-portal"')
        .replace('"./bilibili-qr-login.js"', '"virtual:bili-dialog-api"')
        .replace('"./browser-launcher.js"', '"virtual:bili-dialog-browser"')
        .replace('"./api.js"', '"virtual:bili-dialog-base"');
    },
    resolveId(id) { if (id.startsWith("virtual:bili-dialog-")) return "\0" + id; },
    load(id) {
      if (id === "\0virtual:bili-dialog-portal") return "export const createPortal = node => node;";
      const methods = {
        "\0virtual:bili-dialog-api": ["getBilibiliQrStatus", "beginBilibiliQrLogin", "checkBilibiliQrLogin", "disconnectBilibiliQrLogin", "listBilibiliFavoriteFolders", "listBilibiliFavoriteVideos"],
        "\0virtual:bili-dialog-browser": ["openBuiltInBrowser", "readBrowserCookie"],
        "\0virtual:bili-dialog-base": ["apiRequest"],
      }[id];
      if (methods) return methods.map(name => `export const ${name}=(...args)=>globalThis.__bilibiliDialogFixture.${name}(...args);`).join("\n");
    },
  }],
});
const { default: Component } = await vite.ssrLoadModule("/src/BilibiliQrLogin.jsx");
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const button = label => tree.root.findAllByType("button").find(node => text(node) === label);
const dialog = () => tree.root.findByProps({ role: "dialog" });
const click = async label => act(async () => button(label).props.onClick());
const tick = async () => act(async () => { [...timers.values()].forEach(fn => fn()); await Promise.resolve(); await Promise.resolve(); });
async function unmount() { if (tree) { await act(async () => tree.unmount()); tree = null; } }

function documentFixture(overflow = "") {
  const listeners = [];
  const next = { hidden: false, body: { style: { overflow }, isConnected: true, focus() { next.activeElement = this; } }, listeners,
    addEventListener(name, fn, options) { listeners.push({ name, fn, capture: options === true || options?.capture === true }); },
    removeEventListener(name, fn, options) {
      const capture = options === true || options?.capture === true;
      const at = listeners.findIndex(row => row.name === name && row.fn === fn && row.capture === capture);
      if (at >= 0) listeners.splice(at, 1);
    },
    key(key, extra = {}) {
      const event = { key, defaultPrevented: false, propagationStopped: false, ...extra,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
      for (const capture of [true, false]) {
        for (const row of [...listeners].filter(row => row.name === "keydown" && row.capture === capture)) row.fn(event);
        if (event.propagationStopped) break;
      }
      return event;
    },
  };
  next.opener = { isConnected: true, focus() { next.activeElement = this; } };
  next.activeElement = next.opener;
  return next;
}
function nodeMocks() {
  const controls = new Map();
  const control = (key, disabled = false) => {
    if (!controls.has(key)) controls.set(key, { key, tabIndex: 0, disabled, isConnected: true,
      getClientRects: () => [1], focus() { if (!this.disabled) doc.activeElement = this; } });
    const value = controls.get(key); value.disabled = disabled; return value;
  };
  panel = { isConnected: true, focus() { doc.activeElement = panel; },
    querySelectorAll() { return dialog().findAll(node => ["button", "a"].includes(node.type)).map(node => control(text(node), Boolean(node.props.disabled))).filter(node => !node.disabled); },
    contains(node) { return node === panel || [...controls.values()].includes(node); },
  };
  return node => node.props.role === "dialog" ? panel : node.type === "button" && node.props.children === "取消" ? control("取消") : null;
}
async function mount(overflow = "") {
  doc = documentFixture(overflow); globalThis.document = doc;
  await act(async () => { tree = TestRenderer.create(React.createElement(Component), { createNodeMock: nodeMocks() }); });
}
beforeEach(() => { begins = 0; checks = 0; beginRead = null; checkRead = null; timers.clear(); });
afterEach(async () => { await unmount(); timers.clear(); });
after(async () => {
  await vite.close();
  for (const [name, value] of originals) {
    if (value) Object.defineProperty(globalThis, name, value);
    else delete globalThis[name];
  }
});

test("QR dialog focuses Cancel, declares a modal and contains keyboard focus", async () => {
  await mount(); await click("扫码登录哔哩哔哩");
  assert.equal(dialog().props["aria-modal"], "true");
  assert.equal(dialog().props.tabIndex, -1);
  assert.equal(doc.activeElement.key, "取消");
  assert.equal(doc.body.style.overflow, "hidden");
  const entries = panel.querySelectorAll();
  doc.activeElement = entries.at(-1);
  assert.equal(doc.key("Tab").defaultPrevented, true); assert.equal(doc.activeElement, entries[0]);
  assert.equal(doc.key("Tab", { shiftKey: true }).defaultPrevented, true); assert.equal(doc.activeElement, entries.at(-1));
  doc.activeElement = doc.opener;
  assert.equal(doc.key("Tab").defaultPrevented, true); assert.equal(doc.activeElement, entries[0]);
});

test("QR Escape captures before an earlier background listener and restores focus/overflow", async () => {
  await mount("scroll"); let lowerCloses = 0;
  const lower = event => { if (event.key === "Escape") lowerCloses++; };
  doc.addEventListener("keydown", lower);
  await click("扫码登录哔哩哔哩");
  let event; await act(async () => { event = doc.key("Escape"); });
  assert.equal(event.defaultPrevented, true); assert.equal(event.propagationStopped, true);
  assert.equal(lowerCloses, 0); assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0);
  assert.equal(timers.size, 0); assert.equal(doc.activeElement, doc.opener); assert.equal(doc.body.style.overflow, "scroll");
  assert.equal(doc.listeners.length, 1); doc.removeEventListener("keydown", lower);
});

test("QR restores the captured opener when generation temporarily moves focus to body", async () => {
  await mount(); beginRead = deferred(); await click("扫码登录哔哩哔哩");
  doc.activeElement = doc.body;
  await act(async () => beginRead.resolve({ key: "fictional-delayed", qr_content: "https://fictional.invalid/delayed" }));
  assert.equal(doc.activeElement.key, "取消");
  await act(async () => { doc.key("Escape"); });
  assert.equal(doc.activeElement, doc.opener);
});

test("QR Escape ignores IME and modified shortcuts", async () => {
  await mount(); await click("扫码登录哔哩哔哩");
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    let event; await act(async () => { event = doc.key("Escape", extra); });
    assert.equal(event.defaultPrevented, false); assert.equal(event.propagationStopped, false);
    assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 1);
  }
});

test("Escape cancels an in-flight regeneration and a late receipt cannot reopen or unlock a new request", async () => {
  await mount(); await click("扫码登录哔哩哔哩");
  const older = deferred(); beginRead = older; await click("重新生成");
  assert.equal(button("取消").props.disabled, undefined);
  assert.equal(doc.listeners.filter(row => row.name === "keydown").length, 1);
  await act(async () => { doc.key("Escape"); });
  assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0);
  const newer = deferred(); beginRead = newer; await click("扫码登录哔哩哔哩");
  await act(async () => older.resolve({ key: "fictional-old", qr_content: "https://fictional.invalid/old" }));
  assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0);
  assert.equal(button("正在生成…").props.disabled, true);
  await act(async () => newer.resolve({ key: "fictional-new", qr_content: "https://fictional.invalid/new" }));
  assert.equal(doc.activeElement.key, "取消"); assert.equal(timers.size, 1);
  assert.equal(doc.listeners.filter(row => row.name === "keydown").length, 1);
});

test("automatic QR renewal keeps the current focus and one modal listener while enforcing the six-renewal cap", async () => {
  await mount(); await click("扫码登录哔哩哔哩");
  const link = panel.querySelectorAll().at(-1); link.focus();
  for (let index = 0; index < 8; index++) await tick();
  assert.equal(begins, 7); assert.equal(checks, 7); assert.equal(timers.size, 0);
  assert.equal(doc.activeElement, link); assert.equal(doc.body.style.overflow, "hidden");
  assert.equal(doc.listeners.filter(row => row.name === "keydown").length, 1);
  assert.match(JSON.stringify(tree.toJSON()), /二维码多次过期/);
  await click("取消"); assert.equal(doc.body.style.overflow, ""); assert.equal(doc.listeners.length, 0);
});

test("closing QR does not steal focus from a newer panel and preserves a pre-existing body lock", async () => {
  await mount("hidden"); await click("扫码登录哔哩哔哩");
  const newerFocus = { isConnected: true }; doc.activeElement = newerFocus;
  await click("取消");
  assert.equal(doc.activeElement, newerFocus); assert.equal(doc.body.style.overflow, "hidden");
  assert.equal(doc.listeners.length, 0); assert.equal(timers.size, 0);
});

test("confirmed QR closes and releases its listener/scroll lock without waiting for another interaction", async () => {
  await mount("scroll"); await click("扫码登录哔哩哔哩");
  checkRead = deferred(); await tick();
  await act(async () => checkRead.resolve({ status: "confirmed", connection: { connected: true, nickname: "虚构账号" } }));
  assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0);
  assert.ok(button("读取收藏夹")); assert.equal(doc.body.style.overflow, "scroll");
  assert.equal(doc.listeners.length, 0); assert.equal(timers.size, 0); assert.equal(doc.activeElement, doc.opener);
});

test("unmounting an open QR releases its modal listener, timer and body lock", async () => {
  await mount("scroll"); await click("扫码登录哔哩哔哩");
  const savedDocument = doc;
  await unmount();
  assert.equal(savedDocument.body.style.overflow, "scroll");
  assert.equal(savedDocument.listeners.length, 0); assert.equal(timers.size, 0);
});
