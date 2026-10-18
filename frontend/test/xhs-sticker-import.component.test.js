import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
const text = node => typeof node === "string" ? node : (Array.isArray(node) ? node : node?.children || []).map(text).join("");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const note = "111111111111111111111111";
const prefs = { xhs_enabled: false, schema_available: true }, found = { ok: true, result: { items: [{ note_id: note, title: "虚构开心猫猫~", author: "虚构作者" }] } };
const saved = { ok: true, asset: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", purpose: "custom_sticker", status: "active" }, source: { provider: "xiaohongshu", note_id: note, title: "虚构开心猫猫~" } };
function sessionFixture() { let value = { user: { id: "fictional-a" }, activeCompanionId: "fictional-c" }; const listeners = new Set(); return { getSnapshot: () => value, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, change(next) { value = next; listeners.forEach(listener => listener()); } }; }
test("XHS sticker settings use scoped permissions, search, durable retries and late-response guards", async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"); Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true, writable: true });
  const vite = await createServer({ envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  try {
    const { default: Panel } = await vite.ssrLoadModule("/src/XhsStickerImportSettings.jsx");
    function fixture(request = async () => prefs, onRefresh = async () => true) {
      const session = sessionFixture(); let tree;
      return { session, async mount() { await act(async () => { tree = TestRenderer.create(React.createElement(Panel, { request, session, onRefresh })); }); },
        text: () => text(tree.toJSON()), checkbox: () => tree.root.findByProps({ type: "checkbox" }),
        button: name => tree.root.findAllByType("button").find(node => text(node.props.children) === name),
        async search(value = "开心~") { await act(async () => tree.root.findByProps({ type: "search" }).props.onChange({ target: { value } })); await act(async () => tree.root.findByType("form").props.onSubmit({ preventDefault() {} })); },
        async click(name) { await act(async () => tree.root.findAllByType("button").find(node => text(node.props.children) === name).props.onClick()); },
        async close() { if (tree) await act(async () => tree.unmount()); } };
    }
    await t.test("old schema disables only this source and permissions wait for a real save receipt", async () => {
      const disabled = fixture(async () => ({ xhs_enabled: false, schema_available: false }));
      try { await disabled.mount(); assert.equal(disabled.checkbox().props.disabled, true); assert.ok(disabled.text().includes("原有上传和 B 站设置不受影响")); } finally { await disabled.close(); }
      const h = fixture(async (_path, options) => { if (options?.method) { assert.deepEqual(JSON.parse(options.body), { xhs_enabled: true }); throw { code: "sticker_import_storage_failed" }; } return prefs; });
      try { await h.mount(); await act(async () => h.checkbox().props.onChange({ target: { checked: true } })); assert.equal(h.checkbox().props.checked, false); assert.ok(h.text().includes("sticker_import_storage_failed")); } finally { await h.close(); }
    });
    await t.test("search encodes special characters and uncertain imports reuse a request ID", async () => {
      const waiting = deferred(), imports = []; let refresh = 0;
      const h = fixture(async (path, options) => {
        if (path.includes("/search?")) { assert.ok(path.endsWith(encodeURIComponent("开心~"))); return found; }
        if (!options?.method) return prefs;
        imports.push(JSON.parse(options.body)); return imports.length === 1 ? waiting.promise : { ...saved, replayed: true };
      }, async () => { refresh++; return true; });
      try {
        await h.mount(); await h.search(); assert.ok(h.text().includes("虚构开心猫猫~"));
        await act(async () => { const button = h.button("收进表情库"); button.props.onClick(); button.props.onClick(); }); assert.equal(imports.length, 1);
        await act(async () => waiting.resolve(Promise.reject({ code: "sticker_import_timeout" }))); assert.ok(h.text().includes("sticker_import_timeout"));
        await h.click("收进表情库"); assert.deepEqual(imports[1], imports[0]); assert.equal(refresh, 1); assert.ok(h.text().includes("已找回上次导入"));
      } finally { waiting.resolve(saved); await h.close(); }
    });
    await t.test("changing companion cancels a pending import and cannot refresh the new catalog", async () => {
      const waiting = deferred(); let signal, refresh = 0;
      const h = fixture(async (path, options) => { if (path.includes("/search?")) return found; if (!options?.method) return prefs; signal = options.signal; return waiting.promise; }, async () => { refresh++; return true; });
      try {
        await h.mount(); await h.search(); await h.click("收进表情库");
        await act(async () => h.session.change({ user: { id: "fictional-b" }, activeCompanionId: "fictional-d" })); assert.equal(signal.aborted, true);
        await act(async () => waiting.resolve(saved)); assert.equal(refresh, 0); assert.ok(!h.text().includes("已保存到表情包架")); assert.ok(!h.text().includes("虚构开心猫猫"));
      } finally { waiting.resolve(saved); await h.close(); }
    });
    await t.test("login errors stay actionable and empty search results are explicit", async () => {
      let searches = 0;
      const h = fixture(async path => { if (!path.includes("/search?")) return prefs; if (++searches === 1) throw { code: "cookie_expired", message: "fictional-private-cookie" }; return { ok: true, result: { items: [] } }; });
      try { await h.mount(); await h.search(); assert.ok(h.text().includes("cookie_expired")); assert.ok(!h.text().includes("fictional-private-cookie")); await h.search(); assert.ok(h.text().includes("没有找到相关笔记")); } finally { await h.close(); }
    });
  } finally { await vite.close(); if (original) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", original); else delete globalThis.IS_REACT_ACT_ENVIRONMENT; }
});
