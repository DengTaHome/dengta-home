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
const MEMORY_A = "20000000-0000-4000-8000-000000000001", MEMORY_B = "20000000-0000-4000-8000-000000000002";
const memory = (id = MEMORY_A, summary = "FICTIONAL_CONFIRMED") => ({ id, summary, confirmation_status: "confirmed", created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z" });
const list = (...memories) => ({ memories });
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function settle() { for (let i = 0; i < 60; i += 1) await Promise.resolve(); }

async function harness({ initialItems = [], initialDrafts = {}, signedIn = true } = {}) {
  const descriptors = Object.fromEntries(["window", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__memorySummaryFixture"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const stored = new Map(), listeners = new Map(), timers = new Map(), requests = [], notices = [];
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key) };
  const sessionFor = account => ({ access_token: "fictional-" + account, user: { id: account, email: "fictional@example.test" } });
  let session = signedIn ? sessionFor(ACCOUNT_A) : null, authListener, signOuts = 0, refreshGate, nextTimer = 0, tree, visible = true, snapshot;
  const sdk = { auth: {
    onAuthStateChange(callback) { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session }, error: null }; },
    async refreshSession() { return refreshGate ? refreshGate.promise : { data: { session }, error: null }; },
    async signOut() { signOuts += 1; session = null; authListener?.("SIGNED_OUT", null); return { error: null }; },
  } };
  const manager = createAuthSessionManager({ supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage, createClientFn: () => sdk });
  await manager.initialize();
  if (signedIn) manager.setActiveCompanionId(COMPANION_A);
  const scope = settingsSaveScope(manager.getSnapshot());
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    confirm: () => { h.confirms += 1; return h.confirmResult; },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
  } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "__memorySummaryFixture", { configurable: true, value: { manager } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: (url, options) => new Promise(resolve => {
    assert.equal(new URL(url).origin, "http://memorysummary.example.test", "fixture never contacts production");
    requests.push({ path: new URL(url).pathname, method: options.method || "GET", body: options.body, companion: options.headers.get("X-DengTa-Companion-Id"), signal: options.signal,
      respond(status, data, companion = COMPANION_A) { resolve(new Response(status === 204 ? null : JSON.stringify(data), { status, headers: companion ? { "X-DengTa-Companion-Id": companion } : {} })); }, respondWith: resolve });
  }) });
  const vite = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true },
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("http://memorysummary.example.test"), "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("") },
    plugins: [{ name: "summary-fixture-auth", enforce: "pre", transform(source, id) { if (id.replaceAll("\\", "/").split("?")[0].endsWith("/src/auth-session.js")) return source.replace("export const authSession = createAuthSessionManager();", "export const authSession = globalThis.__memorySummaryFixture.manager;"); return null; } }] });
  const { default: Component } = await vite.ssrLoadModule("/src/LocalMemorySummaries.jsx");
  const diagnostics = await vite.ssrLoadModule("/src/operation-diagnostics.js");
  const notice = message => notices.push(message);
  function Fixture({ scopeKey, visible }) {
    const [items, setItems] = React.useState(initialItems), [drafts, setDrafts] = React.useState(initialDrafts);
    React.useLayoutEffect(() => { snapshot = { items, drafts }; }, [items, drafts]);
    return visible ? React.createElement(Component, { scopeKey, items, drafts, onItemsChange: setItems, onDraftsChange: setDrafts, onNotice: notice }) : null;
  }
  async function render() { await act(async () => { const element = React.createElement(Fixture, { key: settingsSaveScope(manager.getSnapshot()), scopeKey: settingsSaveScope(manager.getSnapshot()), visible }); if (tree) tree.update(element); else tree = TestRenderer.create(element); await settle(); }); }
  const h = { manager, requests, notices, timers, confirms: 0, confirmResult: true, render, scope, diagnostics,
    get snapshot() { return snapshot; }, text: () => text(tree.toJSON()),
    textareas() { return tree.root.findAllByType("textarea"); },
    button(label, index = 0) { return tree.root.findAll(node => node.type === "button" && text(node) === label)[index]; },
    async click(label, twice = false, index = 0) { const button = this.button(label, index); assert.ok(button, label); await act(async () => { button.props.onClick(); if (twice) button.props.onClick(); await settle(); }); },
    async edit(value, index = 0) { await act(async () => { tree.root.findAllByType("textarea")[index].props.onChange({ target: { value } }); await settle(); }); },
    async respond(index, status, data, companion = COMPANION_A) { await act(async () => { requests[index].respond(status, data, companion); await settle(); }); },
    async raw(index, response) { await act(async () => { requests[index].respondWith(response); await settle(); }); },
    async timeout() { await act(async () => { const entry = [...timers].find(([, value]) => value.delay === 15_000); assert.ok(entry); timers.delete(entry[0]); entry[1].callback(); await settle(); }); },
    async imported() { await act(async () => { listeners.get("dengta:memories-imported")?.forEach(fn => fn()); await settle(); }); },
    switchScope(account = false) { if (account) { session = sessionFor(ACCOUNT_B); authListener("SIGNED_IN", session); } manager.setActiveCompanionId(COMPANION_B); },
    holdRefresh() { session = { ...session, expires_at: Math.floor(Date.now() / 1000) - 1 }; authListener("TOKEN_REFRESHED", session); refreshGate = deferred(); return refreshGate; },
    signOuts: () => signOuts,
    async hide() { visible = false; await render(); }, async show() { visible = true; await render(); },
    async finish() { await act(async () => { tree?.unmount(); await settle(); }); manager.destroy(); await vite.close(); diagnostics.clearOperationFailures(scope); for (const [name, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } },
  };
  await render();
  return h;
}

test("first read failure stays unknown and GET-only manual recovery confirms zero", async () => { const h = await harness(); try { await h.respond(0, 503, { code: "fictional_error", message: "FICTIONAL_PRIVATE_BODY" }); assert.match(h.text(), /尚未确认|尚未成功读取/); assert.doesNotMatch(h.text(), /暂时没有长期记忆|FICTIONAL_PRIVATE_BODY/); await h.click("重新读取摘要"); await h.respond(1, 200, list()); assert.match(h.text(), /暂时没有长期记忆/); assert.ok(h.requests.every(r => r.method === "GET")); assert.equal(h.diagnostics.readOperationFailures(h.scope).length, 1); } finally { await h.finish(); } });
for (const bad of [{}, { memories: {} }, list(null), list({ ...memory(), id: "bad" }), list({ ...memory(), summary: {} }), list(memory(), memory())]) {
  test("invalid GET retains last confirmed list: " + JSON.stringify(bad).slice(0, 35), async () => { const h = await harness({ initialItems: [memory()] }); try { await h.respond(0, 200, bad); assert.match(h.text(), /memory_summary_receipt_invalid/); assert.equal(h.snapshot.items[0].summary, "FICTIONAL_CONFIRMED"); } finally { await h.finish(); } });
}
for (const bad of [{}, { memory: memory(MEMORY_B, "FICTIONAL_EDIT") }, { memory: memory(MEMORY_A, "FICTIONAL_WRONG_SUMMARY") }, { deleted: true }, { deleted: true, reason: "fictional_other" }]) {
  test("invalid PATCH never clears draft or reports success: " + JSON.stringify(bad).slice(0, 35), async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("修改"); await h.edit("FICTIONAL_EDIT"); await h.click("保存"); await h.respond(1, 200, bad); assert.equal(h.snapshot.drafts[MEMORY_A], "FICTIONAL_EDIT"); assert.equal(h.snapshot.items[0].summary, "FICTIONAL_CONFIRMED"); assert.match(h.text(), /memory_summary_receipt_invalid/); assert.doesNotMatch(h.text(), /记忆已经保存/); } finally { await h.finish(); } });
}
test("same-turn PATCH submits once and successful old edit preserves newer draft", async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("修改"); await h.edit("FICTIONAL_EDIT"); await h.click("保存", true); assert.equal(h.requests.length, 2); await h.edit("FICTIONAL_NEWER"); await h.respond(1, 200, { memory: memory(MEMORY_A, "FICTIONAL_EDIT") }); assert.equal(h.snapshot.items[0].summary, "FICTIONAL_EDIT"); assert.equal(h.snapshot.drafts[MEMORY_A], "FICTIONAL_NEWER"); assert.match(h.text(), /新输入已保留/); assert.equal(h.requests.length, 2); } finally { await h.finish(); } });
test("successful unchanged PATCH clears only submitted draft", async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("修改"); await h.edit("FICTIONAL_EDIT"); await h.click("保存"); await h.respond(1, 200, { memory: memory(MEMORY_A, "FICTIONAL_EDIT") }); assert.equal(Object.hasOwn(h.snapshot.drafts, MEMORY_A), false); assert.match(h.text(), /记忆已经保存/); } finally { await h.finish(); } });
for (const receipt of [{}, null, { deleted: true }]) test("DELETE HTTP200 is never a confirmed deletion: " + JSON.stringify(receipt), async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("删除"); await h.respond(1, 200, receipt); assert.equal(h.snapshot.items.length, 1); assert.match(h.text(), /memory_summary_receipt_invalid/); } finally { await h.finish(); } });
test("same-turn confirmed DELETE is one confirmation and one request with HTTP204", async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("删除", true); assert.equal(h.confirms, 1); assert.equal(h.requests.length, 2); await h.respond(1, 204); assert.equal(h.snapshot.items.length, 0); assert.match(h.text(), /记忆已经删除/); } finally { await h.finish(); } });
test("cancel deletion sends no write", async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); h.confirmResult = false; await h.click("删除"); assert.equal(h.requests.length, 1); } finally { await h.finish(); } });
test("existing provider residue deletion receipt is recognized only after manual PATCH", async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("修改"); await h.edit("FICTIONAL_EDIT"); await h.click("保存"); await h.respond(1, 200, { deleted: true, reason: "memory_summary_rejected" }); assert.equal(h.snapshot.items.length, 0); assert.match(h.text(), /服务端已确认删除/); assert.equal(h.requests.filter(r => r.method === "DELETE").length, 0); } finally { await h.finish(); } });
for (const deleting of [false, true]) test("old GET cannot revert a confirmed " + (deleting ? "DELETE" : "PATCH"), async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("重新读取摘要"); if (!deleting) { await h.click("修改"); await h.edit("FICTIONAL_EDIT"); } await h.click(deleting ? "删除" : "保存"); await h.respond(2, deleting ? 204 : 200, deleting ? undefined : { memory: memory(MEMORY_A, "FICTIONAL_EDIT") }); await h.respond(1, 200, list(memory())); assert.equal(h.snapshot.items.length, deleting ? 0 : 1); if (!deleting) assert.equal(h.snapshot.items[0].summary, "FICTIONAL_EDIT"); } finally { await h.finish(); } });
test("import-triggered newer GET wins over older GET without any writes", async () => { const h = await harness(); try { await h.imported(); await h.respond(1, 200, list(memory(MEMORY_B, "FICTIONAL_NEWER"))); await h.respond(0, 200, list(memory())); assert.equal(h.snapshot.items[0].id, MEMORY_B); assert.ok(h.requests.every(r => r.method === "GET")); } finally { await h.finish(); } });
test("write lock prevents another row write and read during pending PATCH", async () => { const h = await harness(); try { await h.respond(0, 200, list(memory(), memory(MEMORY_B))); await h.click("修改"); await h.edit("FICTIONAL_EDIT"); await h.click("保存"); await h.click("删除"); await h.click("重新读取摘要"); await h.imported(); assert.equal(h.requests.length, 2); assert.equal(h.confirms, 0); await h.respond(1, 200, { memory: memory(MEMORY_A, "FICTIONAL_EDIT") }); } finally { await h.finish(); } });
test("bad memory dates render time unknown and summary appears directly", async () => { const h = await harness(); try { await h.respond(0, 200, list({ ...memory(), updated_at: "FICTIONAL_BAD_DATE" })); assert.match(h.text(), /时间未知|FICTIONAL_CONFIRMED/); assert.equal(h.snapshot.items[0].summary, "FICTIONAL_CONFIRMED"); } finally { await h.finish(); } });
test("ordinary navigation unmount cancels request and retains App draft for remount", async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("修改"); await h.edit("FICTIONAL_EDIT"); await h.click("保存"); await h.hide(); assert.equal(h.requests[1].signal.aborted, true); assert.equal(h.timers.size, 0); await h.respond(1, 200, { memory: memory(MEMORY_A, "FICTIONAL_EDIT") }); assert.equal(h.snapshot.drafts[MEMORY_A], "FICTIONAL_EDIT"); await h.show(); await h.respond(2, 200, list(memory())); assert.equal(h.snapshot.drafts[MEMORY_A], "FICTIONAL_EDIT"); } finally { await h.finish(); } });
test("stalled PATCH JSON reaches complete deadline and keeps draft for manual GET", async () => { const h = await harness(), body = deferred(); try { await h.respond(0, 200, list(memory())); await h.click("修改"); await h.edit("FICTIONAL_EDIT"); await h.click("保存"); await h.raw(1, { status: 200, ok: true, headers: new Headers(), json: () => body.promise }); await h.timeout(); assert.match(h.text(), /request_timeout/); assert.equal(h.snapshot.drafts[MEMORY_A], "FICTIONAL_EDIT"); await h.click("重新读取摘要"); await h.respond(2, 200, list(memory())); await act(async () => { body.resolve({ memory: memory(MEMORY_A, "FICTIONAL_EDIT") }); await settle(); }); assert.equal(h.snapshot.items[0].summary, "FICTIONAL_CONFIRMED"); assert.equal(h.requests.length, 3); } finally { await h.finish(); } });
for (const account of [false, true]) for (const status of [200, 401]) test(`late ${status} after ${account ? "account" : "companion"} switch cannot mutate new scope or expire it`, async () => { const h = await harness(); try { h.switchScope(account); await h.render(); await h.respond(1, 200, list(memory(MEMORY_B, "FICTIONAL_NEW_SCOPE")), COMPANION_B); await h.respond(0, status, status === 401 ? { code: "invalid_session" } : list(memory()), COMPANION_A); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); assert.equal(h.signOuts(), 0); assert.equal(h.snapshot.items[0].summary, "FICTIONAL_NEW_SCOPE"); assert.equal(h.requests[0].signal.aborted, true); } finally { await h.finish(); } });
test("Auth wait cannot deliver PATCH with a new companion", async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("修改"); await h.edit("FICTIONAL_EDIT"); const gate = h.holdRefresh(); await h.click("保存"); assert.equal(h.requests.length, 1); h.switchScope(); await act(async () => { gate.resolve({ data: { session: null } }); await settle(); }); assert.equal(h.requests.length, 1); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); } finally { await h.finish(); } });
test("timed-out 401 JSON clone cannot invalidate a session after manual GET recovery", async () => { const h = await harness(), body = deferred(); try { await h.raw(0, { status: 401, ok: false, headers: new Headers(), clone: () => ({ json: () => body.promise }), json: async () => ({ code: "invalid_session" }) }); await h.timeout(); await h.click("重新读取摘要"); await h.respond(1, 200, list(memory())); await act(async () => { body.resolve({ code: "invalid_session" }); await settle(); }); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated); assert.equal(h.signOuts(), 0); } finally { await h.finish(); } });
test("current 401 still expires actual Auth manager", async () => { const h = await harness(); try { await h.respond(0, 401, { code: "invalid_session" }); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.expired); assert.ok(h.signOuts() > 0); } finally { await h.finish(); } });
test("missing account identity produces no request", async () => { const h = await harness({ signedIn: false }); try { assert.equal(h.requests.length, 0); } finally { await h.finish(); } });
test("failed reread labels retained data as previous confirmation", async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("重新读取摘要"); await h.respond(1, 503, { code: "fictional_read_failure" }); assert.match(h.text(), /保留上次确认的摘要/); assert.equal(h.snapshot.items[0].summary, "FICTIONAL_CONFIRMED"); } finally { await h.finish(); } });
test("unknown mutation error never renders raw message or credential-looking code", async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("修改"); await h.edit("FICTIONAL_EDIT"); await h.click("保存"); await h.respond(1, 502, { code: "sk-fictional-secret", message: "FICTIONAL_PRIVATE_BODY" }); assert.match(h.text(), /unknown/); assert.doesNotMatch(h.text(), /sk-fictional-secret|FICTIONAL_PRIVATE_BODY/); assert.equal(h.snapshot.drafts[MEMORY_A], "FICTIONAL_EDIT"); assert.equal(h.diagnostics.readOperationFailures(h.scope).length, 1); } finally { await h.finish(); } });
for (const status of [200, 401]) test("late PATCH " + status + " cannot attach old edit or invalidate a new account", async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("修改"); await h.edit("FICTIONAL_EDIT"); await h.click("保存"); h.switchScope(true); await h.render(); await h.respond(2, 200, list(memory(MEMORY_B, "FICTIONAL_NEW_SCOPE")), COMPANION_B); await h.respond(1, status, status === 401 ? { code: "invalid_session" } : { memory: memory(MEMORY_A, "FICTIONAL_EDIT") }, COMPANION_A); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated); assert.equal(h.manager.getSnapshot().user.id, ACCOUNT_B); assert.equal(h.signOuts(), 0); assert.equal(h.snapshot.items[0].id, MEMORY_B); assert.equal(Object.hasOwn(h.snapshot.drafts, MEMORY_A), false); assert.equal(h.requests[1].signal.aborted, true); } finally { await h.finish(); } });
test("4000-character edit capacity is explicit and oversized draft sends no write", async () => { const h = await harness(); try { await h.respond(0, 200, list(memory())); await h.click("修改"); await h.edit("x".repeat(4001)); await h.click("保存"); assert.equal(h.requests.length, 1); assert.equal(h.snapshot.drafts[MEMORY_A].length, 4001); assert.match(h.notices.at(-1), /4000/); } finally { await h.finish(); } });

test("a newer draft stays visible after the server explicitly deletes its original record", async () => {
  const h = await harness();
  try {
    await h.respond(0, 200, list(memory()));
    await h.click("修改"); await h.edit("FICTIONAL_SUBMITTED"); await h.click("保存");
    await h.edit("  FICTIONAL_NEWER\nwith original whitespace  ");
    await h.respond(1, 200, { deleted: true, reason: "memory_summary_rejected" });
    assert.equal(h.snapshot.items.length, 0);
    assert.match(h.text(), /仍然保留的输入/);
    const textarea = h.textareas()[0];
    assert.equal(textarea.props.readOnly, true);
    assert.equal(textarea.props.value, "  FICTIONAL_NEWER\nwith original whitespace  ");
    let selected = false;
    textarea.props.onFocus({ currentTarget: { select() { selected = true; } } });
    assert.equal(selected, true);
    h.confirmResult = false; await h.click("丢弃这段草稿");
    assert.equal(Object.hasOwn(h.snapshot.drafts, MEMORY_A), true);
    h.confirmResult = true; await h.click("丢弃这段草稿");
    assert.equal(Object.hasOwn(h.snapshot.drafts, MEMORY_A), false);
    assert.equal(h.requests.length, 2, "discard only removes a local draft after confirmation");
  } finally { await h.finish(); }
});

test("a draft whose record vanished on reread remains available for manual copying", async () => {
  const h = await harness({ initialItems: [memory()], initialDrafts: { [MEMORY_A]: "FICTIONAL_DRAFT" } });
  try {
    await h.respond(0, 200, list());
    assert.equal(h.textareas()[0].props.value, "FICTIONAL_DRAFT");
    assert.match(h.text(), /当前摘要列表未找到对应记录/);
    assert.equal(h.requests.length, 1);
  } finally { await h.finish(); }
});

for (const deleting of [false, true]) test(`imports during ${deleting ? "DELETE" : "PATCH"} are coalesced into one later reread`, async () => {
  const h = await harness();
  try {
    await h.respond(0, 200, list(memory()));
    if (!deleting) { await h.click("修改"); await h.edit("FICTIONAL_EDIT"); }
    await h.click(deleting ? "删除" : "保存");
    await h.imported(); await h.imported();
    assert.equal(h.requests.length, 2, "no GET races the pending write");
    await h.respond(1, deleting ? 204 : 200, deleting ? undefined : { memory: memory(MEMORY_A, "FICTIONAL_EDIT") });
    assert.equal(h.requests.length, 3);
    assert.equal(h.requests[2].method, "GET");
    await h.respond(2, 200, list(memory(MEMORY_B, "FICTIONAL_IMPORTED")));
    assert.equal(h.snapshot.items[0].summary, "FICTIONAL_IMPORTED");
  } finally { await h.finish(); }
});

test("a queued import refresh cannot run after navigating away", async () => {
  const h = await harness();
  try {
    await h.respond(0, 200, list(memory()));
    await h.click("删除"); await h.imported(); await h.hide();
    await h.respond(1, 204);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].signal.aborted, true);
  } finally { await h.finish(); }
});
