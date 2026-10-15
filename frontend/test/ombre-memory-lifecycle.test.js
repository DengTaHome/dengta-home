import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { env } from "node:process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { AUTH_STATUS, createAuthSessionManager } from "../src/auth-session.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111", ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333", COMPANION_B = "44444444-4444-4444-8444-444444444444";
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const item = (id = "fictional-a", type = "dynamic") => ({ id, name: id, type, contentPreview: "FICTIONAL_PREVIEW_" + id });
const list = (...items) => ({ items, total: items.length });
async function settle() { for (let i = 0; i < 80; i += 1) await Promise.resolve(); }

async function harness({ signedIn = true } = {}) {
  const descriptors = Object.fromEntries(["window", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__ombreMemoryFixture"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
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
  Object.defineProperty(globalThis, "__ombreMemoryFixture", { configurable: true, value: { manager } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: (url, options) => new Promise(resolve => {
    const address = new URL(url);
    assert.equal(address.origin, "http://ombre-memory.example.test", "fixture cannot contact a real memory service");
    requests.push({ path: address.pathname + address.search, options, companion: options.headers.get("X-DengTa-Companion-Id"),
      respond(status, data, companion = COMPANION_A) { resolve(new Response(JSON.stringify(data), { status, headers: { "X-DengTa-Companion-Id": companion } })); }, respondWith: resolve });
    // Ignore abort deliberately: the real API and scoped reader must reject late work.
  }) });
  const vite = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true },
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("http://ombre-memory.example.test"), "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("") },
    plugins: [{ name: "ombre-real-component-and-api", enforce: "pre", async transform(source, id) {
      const path = id.replaceAll("\\", "/").split("?")[0];
      if (path.endsWith("/src/auth-session.js")) return source.replace("export const authSession = createAuthSessionManager();", "export const authSession = globalThis.__ombreMemoryFixture.manager;");
      if (env.DENGTA_OMBRE_BASELINE && path.endsWith("/src/OmbreMemories.jsx")) return readFile(env.DENGTA_OMBRE_BASELINE, "utf8");
      return null;
    } }] });
  const { default: Component } = await vite.ssrLoadModule("/src/OmbreMemories.jsx");
  await act(async () => { tree = TestRenderer.create(React.createElement(Component)); await settle(); });
  const h = { manager, requests, timers, text: () => text(tree.toJSON()), signOuts: () => signOuts,
    button(label) { return tree.root.findAll(node => node.type === "button" && (text(node) === label || node.props["aria-label"] === label))[0]; },
    dialogs() { return tree.root.findAll(node => node.props.role === "dialog"); },
    async click(label) { const target = this.button(label); assert.ok(target, "actual UI contains " + label); await act(async () => { target.props.onClick(); await settle(); }); },
    async open(id = "fictional-a") { const target = tree.root.findAll(node => node.type === "button" && node.props.className === "ombre-memory-item").find(node => text(node).startsWith(id)); assert.ok(target); await act(async () => { target.props.onClick(); await settle(); }); },
    async search(value) { await act(async () => { tree.root.findByType("input").props.onChange({ target: { value } }); await settle(); }); await act(async () => { tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); await settle(); }); },
    async respond(index, status, data, companion) { await act(async () => { assert.ok(requests[index], "expected request " + index); requests[index].respond(status, data, companion); await settle(); }); },
    async raw(index, response) { await act(async () => { requests[index].respondWith(response); await settle(); }); },
    async timeout() { await act(async () => { for (const [id, timer] of [...timers]) { if (timers.delete(id)) timer.callback(); } await settle(); }); },
    async ready(offset = 0, initialList = true) { await this.respond(offset, 200, { configured: true, mcp: { configured: false } }); await this.respond(offset + 1, 200, { connections: [] }); await this.respond(offset + 2, 200, { configured: false, available: false, tools: [] }); await this.respond(offset + 3, 200, { configured: true, available: true, total: 2 }); if (initialList) await this.respond(offset + 4, 200, list(item(), item("fictional-b", "permanent"))); },
    async holdRefresh() { await act(async () => { session = { ...session, expires_at: 1 }; listener("TOKEN_REFRESHED", session); refreshGate = deferred(); await settle(); }); return refreshGate; },
    async switchScope(account = false) { await act(async () => { if (account) { session = sessionFor(ACCOUNT_B); listener("SIGNED_IN", session); } manager.setActiveCompanionId(COMPANION_B); await settle(); }); },
    async unmount() { if (tree) { await act(async () => { tree.unmount(); await settle(); }); tree = null; } },
    async finish() { await this.unmount(); manager.destroy(); await vite.close(); for (const [name, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } },
  };
  return h;
}

test("old filter success cannot replace the current filter list", async () => {
  const h = await harness();
  try {
    await h.ready(); await h.click("动态"); await h.click("永久");
    assert.equal(h.requests[5].path, "/api/ombre/buckets?type=dynamic"); assert.equal(h.requests[6].path, "/api/ombre/buckets?type=permanent");
    await h.respond(6, 200, list(item("fictional-current", "permanent"))); await h.respond(5, 200, list(item("fictional-old")));
    assert.match(h.text(), /fictional-current/); assert.doesNotMatch(h.text(), /fictional-old/); assert.equal(h.button("永久").props.className, "active");
    assert.equal(h.requests[5].options.signal.aborted, true);
  } finally { await h.finish(); }
});

test("closing a pending detail prevents its late success from reopening the dialog", async () => {
  const h = await harness();
  try {
    await h.ready(); await h.open(); await h.click("关闭记忆详情"); assert.equal(h.dialogs().length, 0);
    await h.respond(5, 200, { ...item(), content: "FICTIONAL_LATE_DETAIL" }); assert.equal(h.dialogs().length, 0); assert.equal(h.requests[5].options.signal.aborted, true);
  } finally { await h.finish(); }
});

test("an initial list read cannot overwrite a filter selected before it finishes", async () => {
  const h = await harness();
  try { await h.ready(0, false); await h.click("永久"); await h.respond(5, 200, list(item("fictional-current", "permanent"))); await h.respond(4, 200, list(item("fictional-old"))); assert.match(h.text(), /fictional-current/); assert.doesNotMatch(h.text(), /fictional-old/); assert.equal(h.requests[4].options.signal.aborted, true); } finally { await h.finish(); }
});

test("old filter failure cannot end the newer loading state or inject an error", async () => {
  const h = await harness();
  try { await h.ready(); await h.click("动态"); await h.click("永久"); await h.respond(5, 502, { code: "fictional_old_error", message: "FICTIONAL_PRIVATE_BODY" }); assert.match(h.text(), /正在读取记忆/); assert.doesNotMatch(h.text(), /fictional_old_error|FICTIONAL_PRIVATE_BODY/); await h.respond(6, 200, list(item("fictional-current"))); assert.match(h.text(), /fictional-current/); assert.equal(h.requests.length, 7); } finally { await h.finish(); }
});

for (const lane of ["list", "detail"]) test("cancelled " + lane + " 401 cannot expire the same current account", async () => {
  const h = await harness();
  try { await h.ready(); if (lane === "list") { await h.click("动态"); await h.click("永久"); } else { await h.open(); await h.click("关闭记忆详情"); } await h.respond(5, 401, { code: "invalid_session", message: "FICTIONAL_PRIVATE_BODY" }); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated); assert.equal(h.signOuts(), 0); assert.equal(h.dialogs().length, 0); assert.doesNotMatch(h.text(), /FICTIONAL_PRIVATE_BODY/); if (lane === "list") { assert.match(h.text(), /正在读取记忆/); await h.respond(6, 200, list()); } } finally { await h.finish(); }
});

test("a search response cannot replace a newer filter and its URL keeps the submitted query", async () => {
  const h = await harness();
  try { await h.ready(); await h.search(" fictional / query "); assert.equal(h.requests[5].path, "/api/ombre/search?q=fictional%20%2F%20query"); await h.click("永久"); await h.respond(6, 200, list(item("fictional-current"))); await h.respond(5, 200, list(item("fictional-old"))); assert.match(h.text(), /fictional-current/); assert.doesNotMatch(h.text(), /fictional-old|fictional \/ query/); } finally { await h.finish(); }
});

for (const status of [200, 502]) test("a replaced detail ignores the old " + status + " response", async () => {
  const h = await harness();
  try { await h.ready(); await h.open(); await h.open("fictional-b"); await h.respond(5, status, status === 200 ? { ...item(), content: "FICTIONAL_OLD_DETAIL" } : { code: "fictional_old_error", message: "FICTIONAL_PRIVATE_BODY" }); assert.match(h.text(), /正在读取完整内容/); assert.doesNotMatch(h.text(), /FICTIONAL_OLD_DETAIL|fictional_old_error|FICTIONAL_PRIVATE_BODY/); await h.respond(6, 200, { ...item("fictional-b"), content: "FICTIONAL_CURRENT_DETAIL" }); assert.match(h.text(), /FICTIONAL_CURRENT_DETAIL/); assert.equal(h.requests[5].options.signal.aborted, true); } finally { await h.finish(); }
});

test("changing a filter closes and cancels its pending detail", async () => {
  const h = await harness();
  try { await h.ready(); await h.open(); await h.click("永久"); await h.respond(5, 200, { ...item(), content: "FICTIONAL_OLD_DETAIL" }); assert.equal(h.dialogs().length, 0); assert.equal(h.requests[5].options.signal.aborted, true); await h.respond(6, 200, list()); assert.match(h.text(), /这里还没有记忆/); } finally { await h.finish(); }
});

for (const account of [false, true]) for (const lane of ["list", "detail"]) for (const status of [200, 401]) test(`${lane} late ${status} after ${account ? "account" : "companion"} switch cannot restore old data or expire current auth`, async () => {
  const h = await harness();
  try {
    await h.ready(); if (lane === "list") await h.click("动态"); else await h.open(); await h.switchScope(account);
    assert.doesNotMatch(h.text(), /fictional-a|FICTIONAL_PREVIEW/); assert.equal(h.dialogs().length, 0); assert.equal(h.requests[5].options.signal.aborted, true);
    await h.respond(5, status, status === 200 ? lane === "list" ? list(item("fictional-old")) : { ...item(), content: "FICTIONAL_OLD_DETAIL" } : { code: "invalid_session", message: "FICTIONAL_PRIVATE_BODY" });
    assert.doesNotMatch(h.text(), /fictional-old|FICTIONAL_OLD_DETAIL|FICTIONAL_PRIVATE_BODY/); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated); assert.equal(h.manager.getSnapshot().user.id, account ? ACCOUNT_B : ACCOUNT_A); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); assert.equal(h.signOuts(), 0);
  } finally { await h.finish(); }
});

for (const lane of ["list", "detail", "connection"]) for (const status of [200, 401]) test(lane + " late " + status + " after unmount cannot invalidate auth or change companion", async () => {
  const h = await harness();
  try { let index = 0; if (lane !== "connection") { await h.ready(); if (lane === "list") await h.click("动态"); else await h.open(); index = 5; } await h.unmount(); assert.equal(h.requests[index].options.signal.aborted, true); assert.equal(h.timers.size, 0); await h.respond(index, status, status === 200 ? list(item("fictional-old")) : { code: "invalid_session", message: "FICTIONAL_PRIVATE_BODY" }, COMPANION_B); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_A); assert.equal(h.signOuts(), 0); } finally { await h.finish(); }
});

for (const status of [200, 401]) test("initial connection late " + status + " after account switch cannot launch the old chain", async () => {
  const h = await harness();
  try { await h.switchScope(true); const count = h.requests.length; assert.equal(count, 4); await h.respond(0, status, status === 200 ? { configured: true } : { code: "invalid_session" }); await h.respond(1, 200, { connections: [] }); assert.equal(h.requests.length, count); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated); assert.equal(h.manager.getSnapshot().user.id, ACCOUNT_B); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); assert.equal(h.signOuts(), 0); } finally { await h.finish(); }
});

test("auth preparation is fixed to the original companion and cannot send after a switch", async () => {
  const h = await harness();
  try { await h.ready(); const gate = await h.holdRefresh(); await h.click("动态"); assert.equal(h.requests.length, 5); await h.switchScope(); await h.unmount(); await act(async () => { gate.resolve({ data: { session: { access_token: "fictional-refresh", user: { id: ACCOUNT_A }, expires_at: 9999999999 } }, error: null }); await settle(); }); assert.equal(h.requests.length, 5); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); } finally { await h.finish(); }
});

test("list failure hides raw errors and can be re-read with the same filter using GET only", async () => {
  const h = await harness();
  try { await h.ready(); await h.click("永久"); await h.respond(5, 502, { code: "sk-provider-secret-123456789", message: "FICTIONAL_PRIVATE_BODY", error_log_id: "FICTIONAL_PRIVATE_LOG" }); assert.match(h.text(), /本次读取未完成/); assert.doesNotMatch(h.text(), /sk-provider-secret|FICTIONAL_PRIVATE/); await h.click("重新读取记忆"); assert.equal(h.requests[6].path, h.requests[5].path); await h.respond(6, 200, list(item("fictional-recovered"))); assert.match(h.text(), /fictional-recovered/); assert.ok(h.requests.every(r => !r.options.method || r.options.method === "GET")); } finally { await h.finish(); }
});

test("a loading list can be explicitly restarted and the abandoned result stays hidden", async () => {
  const h = await harness();
  try { await h.ready(); await h.click("动态"); await h.click("重新读取记忆"); assert.equal(h.requests[5].options.signal.aborted, true); await h.respond(6, 200, list(item("fictional-recovered"))); await h.respond(5, 200, list(item("fictional-old"))); assert.match(h.text(), /fictional-recovered/); assert.doesNotMatch(h.text(), /fictional-old/); } finally { await h.finish(); }
});

test("connection failure is safe and a GET-only recovery restarts the connection chain", async () => {
  const h = await harness();
  try { await h.respond(0, 502, { code: "sk-provider-secret-123456789", message: "FICTIONAL_PRIVATE_BODY" }); assert.match(h.text(), /暂时无法读取外部记忆/); assert.doesNotMatch(h.text(), /sk-provider-secret|FICTIONAL_PRIVATE/); assert.equal(h.requests[1].options.signal.aborted, true); await h.click("重新读取连接"); await h.ready(2); assert.match(h.text(), /fictional-a/); assert.ok(h.requests.every(r => !r.options.method || r.options.method === "GET")); } finally { await h.finish(); }
});

test("connection loading can be restarted before its first response", async () => {
  const h = await harness();
  try { await h.click("重新读取连接"); assert.equal(h.requests[0].options.signal.aborted, true); await h.ready(2); await h.respond(0, 200, { configured: false }); await h.respond(1, 200, { connections: [] }); assert.match(h.text(), /fictional-a/); assert.doesNotMatch(h.text(), /DengTa 主记忆库已启用/); } finally { await h.finish(); }
});

test("detail failure has a safe retry and cannot display preview as confirmed full content", async () => {
  const h = await harness();
  try { await h.ready(); await h.open(); await h.respond(5, 502, { code: "sk-provider-secret-123456789", message: "FICTIONAL_PRIVATE_BODY" }); assert.equal(h.dialogs().length, 1); assert.doesNotMatch(text(h.dialogs()[0]), /sk-fictional|FICTIONAL_PRIVATE|暂无正文/); await h.click("重新读取详情"); assert.equal(h.requests[6].path, h.requests[5].path); await h.respond(6, 200, { ...item(), content: "FICTIONAL_RECOVERED_DETAIL" }); assert.match(text(h.dialogs()[0]), /FICTIONAL_RECOVERED_DETAIL/); } finally { await h.finish(); }
});

test("a stalled JSON body times out, allows retry, and ignores a late parsed list", async () => {
  const h = await harness(), body = deferred();
  try { await h.ready(); await h.click("动态"); await h.raw(5, { status: 200, ok: true, headers: new Headers(), json: () => body.promise }); await h.timeout(); assert.match(h.text(), /request_timeout/); assert.equal(h.requests[5].options.signal.aborted, true); await h.click("重新读取记忆"); await h.respond(6, 200, list(item("fictional-recovered"))); await act(async () => { body.resolve(list(item("fictional-old"))); await settle(); }); assert.match(h.text(), /fictional-recovered/); assert.doesNotMatch(h.text(), /fictional-old/); } finally { await h.finish(); }
});

for (const bad of [{}, { items: {} }, null]) test("invalid list receipt is an explicit failure: " + JSON.stringify(bad), async () => {
  const h = await harness();
  try { await h.ready(); await h.click("动态"); await h.respond(5, 200, bad); assert.match(h.text(), /memory_ui_receipt_invalid/); assert.doesNotMatch(h.text(), /这里还没有记忆/); } finally { await h.finish(); }
});

test("a mismatched detail id is not shown as the selected memory", async () => {
  const h = await harness();
  try { await h.ready(); await h.open(); await h.respond(5, 200, { ...item("fictional-other"), content: "FICTIONAL_WRONG_DETAIL" }); assert.match(h.text(), /memory_ui_receipt_invalid/); assert.doesNotMatch(h.text(), /FICTIONAL_WRONG_DETAIL/); } finally { await h.finish(); }
});

test("current 401 still expires the actual current session", async () => {
  const h = await harness();
  try { await h.ready(); await h.click("动态"); await h.respond(5, 401, { code: "invalid_session" }); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.expired); assert.ok(h.signOuts() > 0); } finally { await h.finish(); }
});

test("missing identity does not send an Ombre request", async () => {
  const h = await harness({ signedIn: false });
  try { assert.equal(h.requests.length, 0); await h.click("重新读取连接"); assert.equal(h.requests.length, 0); } finally { await h.finish(); }
});
