import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { AUTH_STATUS, createAuthSessionManager } from "../src/auth-session.js";
import { settingsSaveScope } from "../src/settings-save-scope.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111", ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333", COMPANION_B = "44444444-4444-4444-8444-444444444444";
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function settle() { for (let i = 0; i < 70; i += 1) await Promise.resolve(); }
const receipt = { ok: true, imported: 2, skipped: 1, total: 3, mode: "chunks" };

async function harness({ signedIn = true } = {}) {
  const descriptors = Object.fromEntries(["window", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__memoryImportFixture"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const stored = new Map(), timers = new Map(), requests = [];
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key) };
  const sessionFor = account => ({ access_token: "fictional-" + account, user: { id: account, email: "fictional@example.test" } });
  let session = signedIn ? sessionFor(ACCOUNT_A) : null, listener, refreshGate, signOuts = 0, timerId = 0, tree;
  const sdk = { auth: {
    onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session }, error: null }; },
    async refreshSession() { return refreshGate ? refreshGate.promise : { data: { session }, error: null }; },
    async signOut() { signOuts += 1; session = null; listener?.("SIGNED_OUT", null); return { error: null }; },
  } };
  const manager = createAuthSessionManager({ supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage, createClientFn: () => sdk });
  await manager.initialize();
  if (signedIn) manager.setActiveCompanionId(COMPANION_A);
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
  } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "__memoryImportFixture", { configurable: true, value: { manager } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: (url, options) => new Promise(resolve => {
    assert.equal(new URL(url).origin, "http://memoryimport.example.test", "fixture cannot contact a real memory service");
    requests.push({ path: new URL(url).pathname, options, companion: options.headers.get("X-DengTa-Companion-Id"),
      respond(status, data, companion = COMPANION_A) { resolve(new Response(JSON.stringify(data), { status, headers: { "X-DengTa-Companion-Id": companion } })); }, respondWith: resolve });
    // Transport deliberately ignores abort so the production request/auth guards must reject stale work.
  }) });
  const vite = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true },
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("http://memoryimport.example.test"), "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("") },
    plugins: [{ name: "memory-import-real-component-and-auth", enforce: "pre", transform(source, id) {
      const path = id.replaceAll("\\", "/").split("?")[0];
      if (path.endsWith("/src/auth-session.js")) return source.replace("export const authSession = createAuthSessionManager();", "export const authSession = globalThis.__memoryImportFixture.manager;");
      if (path.endsWith("/src/App.jsx")) {
        const start = source.indexOf("function MemoryImportCard("), end = source.indexOf("function shanghaiClientTime", start);
        assert.ok(start >= 0 && end > start);
        return `import { useLayoutEffect, useRef, useState } from "react";
          import { invalidMemoryReceipt, memoryCount, memoryUiFailure, useMemoryUiRequest as useScopedUiRequest } from "./memory-ui-feedback.js";
          import { describeOperationError } from "./operation-error-help.js";
          function ChatErrorLog() { return null; }
          ${source.slice(start, end)}
          export default MemoryImportCard;`;
      }
      return null;
    } }] });
  const { default: Component } = await vite.ssrLoadModule("/src/App.jsx");
  async function render() { await act(async () => { const scopeKey = settingsSaveScope(manager.getSnapshot()); const element = React.createElement(Component, { key: scopeKey, scopeKey }); if (tree) tree.update(element); else tree = TestRenderer.create(element); await settle(); }); }
  await render();
  const h = { manager, requests, timers, render, text: () => text(tree.toJSON()), signOuts: () => signOuts,
    button(kind = "file") { return tree.root.findAll(node => node.type === "button" && node.props.className === (kind === "file" ? "memory-import-run" : "memory-import-history"))[0]; },
    async file() { await act(async () => { tree.root.findByType("input").props.onChange({ target: { files: [new File(["FICTIONAL_ACCOUNT_A_FILE"], "fictional-a.txt", { type: "text/plain" })] } }); await settle(); }); },
    async click(kind = "file", twice = false) { const button = this.button(kind); await act(async () => { button.props.onClick(); if (twice) button.props.onClick(); await settle(); }); },
    async respond(index, status, data, companion) { await act(async () => { requests[index].respond(status, data, companion); await settle(); }); },
    async raw(index, response) { await act(async () => { requests[index].respondWith(response); await settle(); }); },
    async timeout(delay) { await act(async () => { const entry = [...timers].find(([, value]) => value.delay === delay); assert.ok(entry); timers.delete(entry[0]); entry[1].callback(); await settle(); }); },
    holdRefresh() { session = { ...session, expires_at: 1 }; listener("TOKEN_REFRESHED", session); refreshGate = deferred(); return refreshGate; },
    switchScope(account = false) { if (account) { session = sessionFor(ACCOUNT_B); listener("SIGNED_IN", session); } manager.setActiveCompanionId(COMPANION_B); },
    async unmount() { if (tree) { await act(async () => { tree.unmount(); await settle(); }); tree = null; } },
    async finish() { await this.unmount(); manager.destroy(); await vite.close(); for (const [name, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } },
  };
  return h;
}

for (const kind of ["file", "history"]) {
  test(kind + " same-turn double click sends one POST and locks both import actions", async () => {
    const h = await harness();
    try { await h.file(); await h.click(kind, true); await h.click(kind === "file" ? "history" : "file"); assert.equal(h.requests.length, 1); assert.equal(h.button("file").props.disabled, true); assert.equal(h.button("history").props.disabled, true); assert.equal(h.requests[0].options.method, "POST"); await h.respond(0, 200, receipt); assert.match(h.text(), /导入完成/); } finally { await h.finish(); }
  });

  test(kind + " auth refresh wait cannot move an import to the newly selected companion", async () => {
    const h = await harness();
    try { await h.file(); const gate = h.holdRefresh(); await h.click(kind); assert.equal(h.requests.length, 0); h.switchScope(); await h.unmount(); await act(async () => { gate.resolve({ data: { session: null } }); await settle(); }); assert.equal(h.requests.length, 0); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); } finally { await h.finish(); }
  });

  for (const status of [200, 401]) test(`${kind} late ${status} after unmount cannot change or expire the next account`, async () => {
    const h = await harness();
    try { await h.file(); await h.click(kind); h.switchScope(true); await h.unmount(); assert.equal(h.requests[0].options.signal.aborted, true); assert.equal(h.timers.size, 0); await h.respond(0, status, status === 200 ? receipt : { code: "invalid_session" }); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated); assert.equal(h.manager.getSnapshot().user.id, ACCOUNT_B); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); assert.equal(h.signOuts(), 0); } finally { await h.finish(); }
  });
}

test("multipart file body and its contents are preserved without a JSON content type", async () => {
  const h = await harness();
  try { await h.file(); await h.click(); const request = h.requests[0]; assert.equal(request.companion, COMPANION_A); assert.equal(request.options.headers.has("Content-Type"), false); assert.ok(request.options.body instanceof FormData); assert.equal(await request.options.body.get("file").text(), "FICTIONAL_ACCOUNT_A_FILE"); await h.respond(0, 200, receipt); } finally { await h.finish(); }
});

test("failed import retains selected file for explicit retry and hides raw error fields", async () => {
  const h = await harness();
  try { await h.file(); await h.click(); await h.respond(0, 502, { code: "sk-provider-secret-123456789", message: "FICTIONAL_PRIVATE_BODY", error_log_id: "FICTIONAL_PRIVATE_LOG" }); assert.doesNotMatch(h.text(), /sk-provider-secret|FICTIONAL_PRIVATE/); assert.match(h.text(), /避免重复/); assert.equal(h.button().props.disabled, false); assert.equal(h.requests.length, 1); await h.click(); assert.equal(h.requests.length, 2); assert.equal(await h.requests[1].options.body.get("file").text(), "FICTIONAL_ACCOUNT_A_FILE"); await h.respond(1, 200, receipt); } finally { await h.finish(); }
});

for (const bad of [{ ok: true }, { ok: true, imported: -1 }, { ok: true, imported: 1, skipped: "unknown" }, { ok: true, imported: 1, total: null }]) test("malformed import success is unconfirmed: " + JSON.stringify(bad), async () => {
  const h = await harness();
  try { await h.file(); await h.click(); await h.respond(0, 200, bad); assert.match(h.text(), /memory_ui_receipt_invalid/); assert.doesNotMatch(h.text(), /导入完成/); assert.equal(h.button().props.disabled, false); } finally { await h.finish(); }
});

test("successful imported-only receipt keeps optional gateway counters optional", async () => {
  const h = await harness();
  try { await h.click("history"); await h.respond(0, 200, { ok: true, imported: 2 }); assert.match(h.text(), /导入完成/); assert.match(h.text(), /成功 2 条/); } finally { await h.finish(); }
});

test("stalled JSON reaches the complete import deadline and late body cannot report success", async () => {
  const h = await harness(), body = deferred();
  try { await h.file(); await h.click(); await h.raw(0, { status: 200, ok: true, headers: new Headers(), json: () => body.promise }); await h.timeout(90000); assert.match(h.text(), /request_timeout/); assert.equal(h.button().props.disabled, false); assert.equal(h.requests[0].options.signal.aborted, true); await act(async () => { body.resolve(receipt); await settle(); }); assert.doesNotMatch(h.text(), /导入完成/); assert.equal(h.requests.length, 1); } finally { await h.finish(); }
});

test("the App scope key remount clears selected file and aborts old work", async () => {
  const h = await harness();
  try { await h.file(); await h.click(); h.switchScope(); await h.render(); assert.equal(h.requests[0].options.signal.aborted, true); assert.equal(h.button().props.disabled, true); await h.respond(0, 200, receipt); assert.doesNotMatch(h.text(), /导入完成/); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); } finally { await h.finish(); }
});

test("current 401 still expires the actual auth manager", async () => {
  const h = await harness();
  try { await h.click("history"); await h.respond(0, 401, { code: "invalid_session" }); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.expired); assert.ok(h.signOuts() > 0); } finally { await h.finish(); }
});

test("missing account identity sends no memory import", async () => {
  const h = await harness({ signedIn: false });
  try { await h.file(); await h.click(); await h.click("history"); assert.equal(h.requests.length, 0); } finally { await h.finish(); }
});
