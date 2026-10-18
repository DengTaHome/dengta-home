import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { readFileSync } from "node:fs";

const words = node => typeof node === "string" ? node : (Array.isArray(node) ? node : node?.children || []).map(words).join("");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const ready = { status: "ready", loggedIn: true, hasCookie: true };

test("real takeout panel preserves scope, retries read failures and never duplicates a browser launch", async t => {
  const saved = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const storage = new Map(), win = new EventTarget(), doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  win.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  for (const [name, value] of [["window", win], ["document", doc], ["IS_REACT_ACT_ENVIRONMENT", true]]) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const vite = await createServer({ envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  try {
    const { default: Panel } = await vite.ssrLoadModule("/src/TakeoutLoginPanel.jsx");
    const { readOperationFailures } = await vite.ssrLoadModule("/src/operation-diagnostics.js");
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    assert.match(app, /<TakeoutLoginPanel key=\{diagnosticScopeKey\(accountStorageScope, companionScope\)\}/);
    function fixture(extra = {}) {
      let tree, currentProps = { scope: "fictional-A", available: true, readLogin: async () => ready, openLogin: async () => ({ ok: true }), appEvents: { addListener: async () => ({ remove() {} }) }, ...extra };
      return {
        async mount() { await act(async () => { tree = TestRenderer.create(React.createElement(Panel, currentProps)); }); },
        async update(next) { currentProps = { ...currentProps, ...next }; await act(async () => tree.update(React.createElement(Panel, currentProps))); },
        text: () => words(tree.toJSON()),
        button: label => tree.root.findAllByType("button").find(button => words(button.props.children) === label),
        badge: () => words(tree.root.findByType("em").props.children),
        async close() { if (tree) await act(async () => tree.unmount()); tree = null; },
      };
    }
    await t.test("failed reads are recoverable and record safe scoped diagnostics instead of claiming logout", async () => {
      let calls = 0;
      const h = fixture({ scope: "fictional-retry", readLogin: async () => { if (++calls === 1) throw Error("fictional private failure"); return { ...ready, loggedIn: false, hasCookie: false }; } });
      try {
        await h.mount(); assert.equal(h.badge(), "检测未完成"); assert.ok(h.text().includes("takeout_login_check_failed")); assert.ok(!h.text().includes("fictional private failure"));
        assert.equal(readOperationFailures("fictional-retry")[0].reasonCode, "takeout_login_check_failed");
        await act(async () => h.button("重新检测").props.onClick());
        assert.equal(calls, 2); assert.equal(h.badge(), "未检测到本机登录凭据");
      } finally { await h.close(); }
    });
    await t.test("focus, visibility, native resume and clicks share one pending check and release listeners", async () => {
      let calls = 0, nativeCallback, removed = 0;
      const pending = deferred();
      const h = fixture({ readLogin: () => { calls++; return pending.promise; }, appEvents: { addListener: async (_, callback) => { nativeCallback = callback; return { remove() { removed++; } }; } } });
      try {
        await h.mount();
        await act(async () => { win.dispatchEvent(new Event("focus")); doc.dispatchEvent(new Event("visibilitychange")); nativeCallback({ isActive: true }); });
        assert.equal(calls, 1); assert.equal(h.button("检测中…").props.disabled, true);
        await act(async () => pending.resolve(ready)); assert.equal(h.badge(), "检测到本机登录 Cookie");
      } finally { await h.close(); }
      win.dispatchEvent(new Event("focus")); doc.dispatchEvent(new Event("visibilitychange")); nativeCallback({ isActive: true });
      await act(async () => {}); assert.equal(calls, 1); assert.equal(removed, 1);
    });
    await t.test("A to B to A drops old pending receipts even when the account text matches again", async () => {
      const requests = [deferred(), deferred(), deferred()]; let index = 0;
      const h = fixture({ readLogin: () => requests[index++].promise });
      try {
        await h.mount(); await h.update({ scope: "fictional-B" }); await h.update({ scope: "fictional-A" });
        await act(async () => { requests[0].resolve(ready); requests[1].resolve(ready); }); assert.equal(h.badge(), "正在检测本机凭据…");
        await act(async () => requests[2].resolve({ ...ready, loggedIn: false, hasCookie: false })); assert.equal(h.badge(), "未检测到本机登录凭据");
      } finally { await h.close(); }
    });
    await t.test("two immediate login clicks open once and return triggers a real credential refresh", async () => {
      let opens = 0, reads = 0;
      const pending = deferred();
      const h = fixture({ readLogin: async () => { reads++; return ready; }, openLogin: () => { opens++; return pending.promise; } });
      try {
        await h.mount(); const launch = h.button("扫码登录外卖").props.onClick;
        await act(async () => { launch(); launch(); }); assert.equal(opens, 1); assert.equal(h.button("等待平台页面返回…").props.disabled, true);
        await act(async () => pending.resolve({ ok: true })); assert.equal(reads, 2); assert.equal(h.button("扫码登录外卖").props.disabled, false);
        await h.update({ feedback: { scope: "fictional-A", status: "error", message: "新的购物车核对错误" } }); assert.ok(h.text().includes("新的购物车核对错误")); assert.ok(!h.text().includes("已返回灯塔"));
      } finally { await h.close(); }
    });
    await t.test("old browser completion cannot write feedback or refresh the next companion", async () => {
      const pending = deferred(); let reads = 0;
      const h = fixture({ readLogin: async () => { reads++; return ready; }, openLogin: () => pending.promise });
      try {
        await h.mount(); await act(async () => h.button("扫码登录外卖").props.onClick()); await h.update({ scope: "fictional-other-companion" });
        await act(async () => pending.resolve({ ok: false, code: "browser_account_changed" }));
        assert.equal(reads, 2); assert.ok(!h.text().includes("browser_account_changed")); assert.equal(h.button("扫码登录外卖").props.disabled, false);
      } finally { await h.close(); }
    });
    await t.test("web and missing identity cause no native work; late listener registration is removed", async () => {
      let reads = 0, opens = 0, removed = 0;
      const late = deferred();
      const h = fixture({ available: false, readLogin: async () => { reads++; return ready; }, openLogin: async () => { opens++; return { ok: true }; }, appEvents: { addListener: () => late.promise } });
      await h.mount(); assert.equal(h.badge(), "仅 Android App 可用"); assert.equal(h.button("扫码登录外卖").props.disabled, true);
      await h.update({ available: true, scope: "" }); assert.equal(reads, 0); assert.equal(opens, 0);
      await h.update({ scope: "fictional-A" }); await h.close();
      await act(async () => late.resolve({ remove() { removed++; return Promise.reject(Error("fictional bridge already gone")); } }));
      assert.equal(removed, 1);
    });
  } finally {
    await vite.close();
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});
