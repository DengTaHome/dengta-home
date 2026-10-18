import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { readFileSync } from "node:fs";
const words = node => typeof node === "string" ? node : (Array.isArray(node) ? node : node?.children || []).map(words).join("");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test("XHS panel keeps login receipts, QR polling and diagnostics within their account and companion", async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, writable: true, configurable: true });
  const vite = await createServer({ envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  try {
    const { default: Panel } = await vite.ssrLoadModule("/src/XhsLoginPanel.jsx");
    const { readOperationFailures } = await vite.ssrLoadModule("/src/operation-diagnostics.js");
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    assert.match(app, /<XhsLoginPanel scope=\{diagnosticScopeKey\(accountStorageScope, companionScope\)\}/);
    assert.ok(!app.includes("xhsPollTimerRef"));
    function fixture(extra = {}) {
      let tree;
      const operations = { me: async () => ({ me: { user_id: "fictional-own-user" } }), start: async () => ({ login: { session: "11111111-1111-4111-8111-111111111111", qr: "data:image/png;base64,YQ==" } }), poll: async () => ({ status: { status: "pending" } }), open: async () => ({ ok: true }), cookie: async () => ({ cookie: "fictional-test-cookie" }), import: async () => ({ ok: true, mode: "service" }), logout: async () => ({ ok: true }), ...extra.operations };
      let props = { scope: "fictional-A", nativeAvailable: true, pollMs: 5, ...extra, operations };
      return { async mount() { await act(async () => { tree = TestRenderer.create(React.createElement(Panel, props)); }); },
        async update(next) { props = { ...props, ...next }; await act(async () => tree.update(React.createElement(Panel, props))); },
        text: () => words(tree.toJSON()), button: name => tree.root.findAllByType("button").find(node => words(node.props.children) === name),
        async click(name) { await act(async () => tree.root.findAllByType("button").find(node => words(node.props.children) === name).props.onClick()); },
        async close() { if (tree) await act(async () => tree.unmount()); }, operations };
    }
    await t.test("precise safe errors can be retried; empty me responses do not count as login", async () => {
      let calls = 0;
      const h = fixture({ scope: "fictional-errors", operations: { me: async () => { if (++calls === 1) throw Object.assign(Error("fictional-private-credential"), { code: "xhs_session_isolation_required", status: 503 }); return calls === 2 ? { me: {} } : { me: { user_id: "fictional" } }; } } });
      try {
        await h.mount(); await h.click("重新检测");
        assert.ok(h.text().includes("xhs_session_isolation_required")); assert.ok(!h.text().includes("fictional-private-credential"));
        assert.equal(readOperationFailures("fictional-errors")[0].reasonCode, "xhs_session_isolation_required");
        await h.click("重新检测"); assert.ok(h.text().includes("xhs_response_invalid"));
        await h.click("重新检测"); assert.ok(h.text().includes("当前账号登录已验证"));
      } finally { await h.close(); }
    });
    await t.test("switching scope rejects delayed native results before reading or importing cookies", async () => {
      const opened = deferred(); let opens = 0, reads = 0, imports = 0;
      const h = fixture({ operations: { open: () => { opens++; return opened.promise; }, cookie: async () => { reads++; return { cookie: "fictional" }; }, import: async () => { imports++; return { ok: true }; } } });
      try {
        await h.mount(); await act(async () => { const button = h.button("内置浏览器登录"); button.props.onClick(); button.props.onClick(); });
        assert.equal(opens, 1); await h.update({ scope: "fictional-B" });
        await act(async () => opened.resolve({ ok: true })); assert.equal(reads, 0); assert.equal(imports, 0); assert.ok(!h.text().includes("已验证"));
      } finally { opened.resolve({ ok: true }); await h.close(); }
    });
    await t.test("saved credentials await service validation and rejected imports keep the original reason", async () => {
      let checks = 0;
      const h = fixture({ operations: { me: async () => { checks++; return { me: {} }; }, import: async () => ({ ok: true, mode: "local" }) } });
      try { await h.mount(); await h.click("内置浏览器登录"); assert.equal(checks, 0); assert.ok(h.text().includes("登录有效性与搜索仍待验证")); } finally { await h.close(); }
      const failed = fixture({ operations: { import: async () => { throw Object.assign(Error("private"), { code: "xhs_storage_write_failed" }); } } });
      try { await failed.mount(); await failed.click("内置浏览器登录"); assert.ok(failed.text().includes("xhs_storage_write_failed")); } finally { await failed.close(); }
    });
    await t.test("QR polling never overlaps and cancel ignores a late completion", async () => {
      const waiting = deferred(); let polls = 0, me = 0;
      const h = fixture({ operations: { poll: () => { polls++; return waiting.promise; }, me: async () => { me++; return { me: { id: "fictional" } }; } } });
      try {
        await h.mount(); await h.click("扫码登录"); await act(async () => delay(25)); assert.equal(polls, 1);
        await h.click("取消扫码"); await act(async () => waiting.resolve({ status: { status: "done" } })); assert.equal(me, 0); assert.ok(h.text().includes("已取消扫码"));
      } finally { waiting.resolve({ status: { status: "pending" } }); await h.close(); }
    });
    await t.test("QR expiry clears the image and provides another attempt", async () => {
      const h = fixture({ qrTtlMs: 10 });
      try { await h.mount(); await h.click("扫码登录"); await act(async () => delay(35)); assert.ok(h.text().includes("xhs_qr_expired")); assert.equal(h.button("扫码登录").props.disabled, false); } finally { await h.close(); }
    });
  } finally { await vite.close(); if (descriptor) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", descriptor); else delete globalThis.IS_REACT_ACT_ENVIRONMENT; }
});
