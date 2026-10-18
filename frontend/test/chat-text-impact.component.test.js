import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act, StrictMode } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const names = ["window", "document", "localStorage", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__textImpactFixture"];
const originals = new Map(names.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const storage = new Map();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let index = 0; index < 5; index++) await new Promise(resolve => globalThis.setImmediate(resolve)); };
class Events {
  listeners = new Map();
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, event = {}) { [...(this.listeners.get(type) || [])].forEach(listener => listener(event)); }
  get listenerCount() { return [...this.listeners.values()].reduce((total, value) => total + value.size, 0); }
}
let tree, state, props, strict = false, serial = 0, doc, view, trigger;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, envDir: false,
  appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{ name: "text-impact-fixture-boundaries", enforce: "pre",
    load(id) {
      if (id.replaceAll("\\", "/").endsWith("/src/text-impact-player.js")) {
        return "export async function playTextImpact(source, options) { return globalThis.__textImpactFixture.play(source, options); }";
      }
    },
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/src/ChatTextImpact.jsx")) {
        // TestRenderer has no DOM portal renderer; retain the real component and all handlers.
        return code.replace('import { createPortal } from "react-dom";', "const createPortal = children => children;");
      }
    },
  }] });
const { default: Control } = await vite.ssrLoadModule("/src/ChatTextImpact.jsx");
const preference = await vite.ssrLoadModule("/src/text-impact-preferences.js");
await vite.ssrLoadModule("/src/text-impact-player.js");
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const button = label => tree.root.findAllByType("button").find(node => text(node) === label || node.props["aria-label"] === label);
const output = () => text(tree.toJSON());
const render = () => strict ? React.createElement(StrictMode, null, React.createElement(Control, props)) : React.createElement(Control, props);
async function mount(changes = {}, useStrict = false) {
  strict = useStrict; props = { rowRef: { current: { querySelector: selector => { assert.equal(selector, ".message-content"); return state.source; } } },
    scopeKey: `fixture-account-${serial}:companion-a:conversation-a`, messageId: "fixture-message-a", ...changes };
  await act(async () => { tree = TestRenderer.create(render(), { createNodeMock: element => element.type === "button" ? trigger : { contains: () => false } }); await flush(); });
}
async function update(changes) { props = { ...props, ...changes }; await act(async () => { tree.update(render()); await flush(); }); }
async function open() { await act(async () => { button("文字弹弹乐").props.onClick({ currentTarget: trigger }); await flush(); }); }
async function click(label) { await act(async () => { button(label).props.onClick(); await flush(); }); }
beforeEach(() => {
  serial++; strict = false;
  doc = Object.assign(new Events(), { body: {} }); view = Object.assign(new Events(), { innerWidth: 390, innerHeight: 740 });
  trigger = { getBoundingClientRect: () => ({ right: 370, top: state.anchorTop ?? 700 }), focus() { state.focuses++; }, contains: target => target === trigger };
  state = { calls: [], stops: 0, focuses: 0, pending: null, result: null, source: { isConnected: true, textContent: "Keep this real message ～🙂" },
    async play(source, options) {
      state.calls.push({ source, ...options });
      if (state.pending) return state.pending.promise;
      return state.result || { started: true, stop: () => state.stops++ };
    } };
  for (const [key, value] of Object.entries({ document: doc, window: view, __textImpactFixture: state,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: () => assert.fail("text impact controls must never call an AI or modify input through an API") })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});
afterEach(async () => {
  if (tree) await act(async () => { tree.unmount(); await flush(); }); tree = null;
  assert.equal(doc.listenerCount + view.listenerCount, 0, "popover listeners must not outlive the control");
});
after(async () => { await vite.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });

test("real controls default to manual playback and expose accessible, bounded options", async () => {
  await mount({ recent: true }); assert.equal(state.calls.length, 0);
  assert.equal(button("文字弹弹乐").props["aria-expanded"], false);
  assert.deepEqual(preference.readTextImpactPreference(props.scopeKey), { auto: false, mode: "scatter", target: "composer" });
  await open(); assert.equal(button("文字弹弹乐").props["aria-expanded"], true);
  const menu = tree.root.findByProps({ "aria-label": "文字弹弹乐选项" });
  assert.equal(menu.props.style.width, 252); assert.ok(menu.props.style.left >= 16); assert.ok(menu.props.style.top >= 16);
  assert.equal(tree.root.findByType("input").props.checked, false);
  assert.match(output(), /原消息和输入内容都会保留/);
  assert.ok(button("对方头像")); assert.ok(button("输入框")); assert.ok(button("文字弹弹")); assert.ok(button("重力散落"));
});

test("manual mode uses only its own message, chosen destination and scope without editing original content", async () => {
  await mount(); await open(); await click("对方头像"); await click("文字弹弹");
  assert.equal(state.calls.length, 1);
  assert.deepEqual(state.calls[0], { source: state.source, mode: "burst", target: "avatar", scopeKey: props.scopeKey });
  assert.equal(state.source.textContent, "Keep this real message ～🙂");
  assert.match(output(), /原消息已保留/); assert.equal(button("文字弹弹乐").props["aria-expanded"], false);
});

test("reduced motion and a reply still generating render no control or automatic request", async () => {
  await mount({ generating: true, recent: true }); assert.equal(tree.toJSON(), null); assert.equal(state.calls.length, 0);
  await act(async () => preference.saveTextImpactPreference(props.scopeKey, { auto: true }));
  await update({ generating: false, reducedMotion: true }); assert.equal(tree.toJSON(), null); assert.equal(state.calls.length, 0);
});

test("StrictMode newly completed reply plays exactly once and never while streaming", async () => {
  const scopeKey = `fixture-account-${serial}:strict-companion:conversation`;
  preference.saveTextImpactPreference(scopeKey, { auto: true, mode: "burst", target: "avatar" });
  await mount({ scopeKey, generating: true, recent: true }, true); assert.equal(state.calls.length, 0);
  await update({ generating: false }); assert.equal(state.calls.length, 1);
  await update({ recent: true }); assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].scopeKey, scopeKey); assert.equal(state.calls[0].mode, "burst");
});

test("StrictMode mounting an already completed new reply does not cancel its sole automatic playback", async () => {
  const scopeKey = `fixture-account-${serial}:strict-mount:conversation`;
  preference.saveTextImpactPreference(scopeKey, { auto: true });
  await mount({ scopeKey, recent: true }, true); assert.equal(state.calls.length, 1);
});

test("enabling automatic playback does not replay an already completed message or history", async () => {
  await mount({ recent: true });
  await act(async () => { preference.saveTextImpactPreference(props.scopeKey, { auto: true }); await flush(); });
  assert.equal(state.calls.length, 0);
  await update({ recent: false, messageId: "history-row" }); assert.equal(state.calls.length, 0);
  await update({ messageId: "next-new-row", recent: true }); assert.equal(state.calls.length, 1);
});

test("automatic preferences stay within account, companion and conversation scope and anonymous rows cannot save", async () => {
  await mount(); const firstScope = props.scopeKey;
  await open(); await act(async () => tree.root.findByType("input").props.onChange({ target: { checked: true } }));
  await click("对方头像");
  assert.equal(preference.readTextImpactPreference(firstScope).auto, true);
  await click("关闭文字弹弹乐");
  await update({ scopeKey: `fixture-account-${serial}:companion-b:conversation-a`, messageId: "other-message" });
  assert.deepEqual(preference.readTextImpactPreference(props.scopeKey), { auto: false, mode: "scatter", target: "composer" });
  await update({ scopeKey: "" }); await open(); assert.equal(tree.root.findByType("input").props.disabled, true);
  assert.deepEqual(preference.saveTextImpactPreference("", { auto: true }), { auto: false, mode: "scatter", target: "composer" });
});

test("unmounting or switching scope stops only the animation owned by this component", async () => {
  await mount(); await open(); await click("重力散落"); assert.equal(state.calls.length, 1);
  await update({ scopeKey: `fixture-account-${serial}:replacement:conversation`, messageId: "replacement" }); assert.equal(state.stops, 1);
  await open(); await click("文字弹弹");
  await act(async () => tree.unmount()); tree = null; assert.equal(state.stops, 2);
});

test("a play receipt arriving after unmount is stopped and never updates a replacement component", async () => {
  await mount(); const pending = deferred(); state.pending = pending;
  await open(); await click("文字弹弹"); assert.equal(state.calls.length, 1);
  await act(async () => tree.unmount()); tree = null;
  await act(async () => { pending.resolve({ started: true, stop: () => state.stops++ }); await flush(); });
  assert.equal(state.stops, 1);
});

test("a disconnected own source does not reach the player after its lazy load", async () => {
  await mount(); state.source.isConnected = false; await open(); await click("文字弹弹"); assert.equal(state.calls.length, 0);
});

test("failure is actionable and a subsequent manual retry succeeds", async () => {
  await mount(); state.result = { started: false }; await open(); await click("文字弹弹");
  assert.match(output(), /没有加载成功.*再试一次/);
  state.result = null; await open(); await click("文字弹弹"); assert.equal(state.calls.length, 2); assert.match(output(), /原消息已保留/);
});

test("Escape and viewport changes close options and release transient listeners", async () => {
  await mount(); await open(); assert.ok(doc.listenerCount > 0);
  await act(async () => doc.emit("keydown", { key: "Escape" })); assert.equal(button("文字弹弹乐").props["aria-expanded"], false); assert.equal(state.focuses, 1);
  assert.equal(doc.listenerCount + view.listenerCount, 0);
  await open(); state.anchorTop = 650; await act(async () => view.emit("scroll")); assert.equal(button("文字弹弹乐").props["aria-expanded"], false);
  await open(); await act(async () => view.emit("resize")); assert.equal(button("文字弹弹乐").props["aria-expanded"], false);
  await open(); await act(async () => doc.emit("pointerdown", { target: {} })); assert.equal(button("文字弹弹乐").props["aria-expanded"], false);
});
test("a delayed or unrelated scroll with a stationary anchor does not dismiss newly opened options", async () => {
  await mount(); await open();
  await act(async () => view.emit("scroll", { target: {} }));
  assert.equal(button("文字弹弹乐").props["aria-expanded"], true);
  await click("对方头像"); assert.equal(button("文字弹弹乐").props["aria-expanded"], true);
  state.anchorTop = 600; await act(async () => view.emit("scroll", { target: {} }));
  assert.equal(button("文字弹弹乐").props["aria-expanded"], false);
});
