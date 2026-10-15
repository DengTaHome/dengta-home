import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { AUTH_STATUS, createAuthSessionManager } from "../src/auth-session.js";
import { settingsSaveScope } from "../src/settings-save-scope.js";
import { hydrateChatHistory } from "../src/chat-history.js";
import { applyStoredMessageReferences } from "../src/message-reference.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111", ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333", COMPANION_B = "44444444-4444-4444-8444-444444444444";
const SESSION_A = "55555555-5555-4555-8555-555555555555", SESSION_B = "66666666-6666-4666-8666-666666666666";
const message = (id, content = id) => ({ id, role: "assistant", content, created_at: "2026-10-15T00:00:00Z" });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function settle() { for (let index = 0; index < 60; index++) await Promise.resolve(); }

const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const effectStart = source.indexOf("  useEffect(() => {\n    let cancelled = false;\n\n    async function loadMessages()");
const effectEnd = source.indexOf("\n  const getMomentsRequestScope", effectStart);
const actionsStart = source.indexOf("  function retrySessionHistory()");
const actionsEnd = source.indexOf("\n  function openSessionDialog(", actionsStart);
const hydrateStart = source.indexOf("function hydrateSessionChatHistory(");
const hydrateEnd = source.indexOf("\nfunction App(", hydrateStart);
assert.ok(effectStart >= 0 && effectEnd > effectStart && actionsStart >= 0 && actionsEnd > actionsStart && hydrateStart >= 0 && hydrateEnd > hydrateStart);
const bindings = ["useEffect", "activeSessionId", "historyRetryRevision", "historyLoadState", "setHistoryLoadState", "setHistoryRetryRevision", "historyLoadPendingRef", "setMessages", "messagesSessionIdRef", "messageLoadTokenRef", "streamingSessionIdRef", "activeSessionIdRef", "requestSessionHistory", "isHistoryScopeCurrent", "privateMediaScope", "recordOperationFailure", "describeOperationError", "hydrateChatHistory", "applyStoredMessageReferences", "canLeaveWorkspace", "chatScrollControllerRef", "abortChatRequest", "chatRequestRef", "closeComposerMenu", "requestStatusPanelClose", "setActiveSessionId", "setActiveView", "setIsSidebarOpen", "isSendingRef"];
const runActualAppHistory = new Function(...bindings, source.slice(hydrateStart, hydrateEnd) + "\n" + source.slice(effectStart, effectEnd) + "\n" + source.slice(actionsStart, actionsEnd) + "\nreturn { retrySessionHistory, chooseSession };");

async function harness({ initialSession = SESSION_A, streaming = false } = {}) {
  const names = ["window", "fetch", "localStorage", "IS_REACT_ACT_ENVIRONMENT", "__chatHistoryFixture"];
  const descriptors = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const stored = new Map(), timers = new Map(), requests = [];
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key) };
  const sessionFor = account => ({ access_token: "fictional-" + account, user: { id: account, email: "fixture@example.test" } });
  let session = sessionFor(ACCOUNT_A), authListener, signOuts = 0, nextTimer = 0, tree, controls, snapshot, initialId = initialSession;
  const manager = createAuthSessionManager({ supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage, createClientFn: () => ({ auth: {
    onAuthStateChange(listener) { authListener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session }, error: null }; },
    async refreshSession() { return { data: { session }, error: null }; },
    async signOut() { signOuts++; session = null; authListener?.("SIGNED_OUT", null); return { error: null }; },
  } }) });
  await manager.initialize(); manager.setActiveCompanionId(COMPANION_A);
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "__chatHistoryFixture", { configurable: true, value: { manager } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
  } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: (url, options) => new Promise(resolve => {
    assert.equal(new URL(url).origin, "http://chathistory.example.test", "history fixtures never contact production");
    requests.push({ path: new URL(url).pathname, options,
      respond(status, data, companion = COMPANION_A) { resolve(new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { ...(companion ? { "X-DengTa-Companion-Id": companion } : {}) } })); },
      respondWith: resolve,
    });
    // Deliberately ignore transport abort: the real API and scope guard must reject stale work.
  }) });
  const vite = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true },
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("http://chathistory.example.test"), "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("") },
    plugins: [{ name: "history-fictional-auth", enforce: "pre", transform(code, id) {
      if (id.replaceAll("\\", "/").split("?")[0].endsWith("/src/auth-session.js")) return code.replace("export const authSession = createAuthSessionManager();", "export const authSession = globalThis.__chatHistoryFixture.manager;");
      return null;
    } }],
  });
  const { useMemoryUiRequest } = await vite.ssrLoadModule("/src/memory-ui-feedback.js");
  const diagnostics = await vite.ssrLoadModule("/src/operation-diagnostics.js");
  const { describeOperationError } = await vite.ssrLoadModule("/src/operation-error-help.js");
  const initialScope = settingsSaveScope(manager.getSnapshot());
  function Fixture({ privateMediaScope }) {
    const [activeSessionId, setActiveSessionId] = React.useState(initialId);
    const [messages, setMessages] = React.useState([]);
    const [historyLoadState, setHistoryLoadState] = React.useState(null);
    const [historyRetryRevision, setHistoryRetryRevision] = React.useState(0);
    const [, setActiveView] = React.useState("chat"), [, setIsSidebarOpen] = React.useState(false);
    const historyLoadPendingRef = React.useRef(false), messagesSessionIdRef = React.useRef(streaming ? initialId : null);
    const messageLoadTokenRef = React.useRef(0), streamingSessionIdRef = React.useRef(streaming ? initialId : null);
    const activeSessionIdRef = React.useRef(activeSessionId), isSendingRef = React.useRef(false);
    const chatScrollControllerRef = React.useRef({ open() {} }), chatRequestRef = React.useRef(null);
    const { request: requestSessionHistory, isCurrent: isHistoryScopeCurrent } = useMemoryUiRequest(privateMediaScope);
    const actions = runActualAppHistory(React.useEffect, activeSessionId, historyRetryRevision, historyLoadState, setHistoryLoadState, setHistoryRetryRevision, historyLoadPendingRef, setMessages, messagesSessionIdRef, messageLoadTokenRef, streamingSessionIdRef, activeSessionIdRef, requestSessionHistory, isHistoryScopeCurrent, privateMediaScope, diagnostics.recordOperationFailure, describeOperationError, hydrateChatHistory, applyStoredMessageReferences, () => true, chatScrollControllerRef, () => {}, chatRequestRef, () => {}, () => {}, setActiveSessionId, setActiveView, setIsSidebarOpen, isSendingRef);
    controls = { ...actions, setMessages, historyLoadPendingRef, messageLoadTokenRef, streamingSessionIdRef, isSendingRef };
    React.useLayoutEffect(() => { snapshot = { activeSessionId, messages, historyLoadState, historyRetryRevision }; });
    return null;
  }
  async function render() {
    const scope = settingsSaveScope(manager.getSnapshot());
    await act(async () => { const element = React.createElement(Fixture, { key: scope, privateMediaScope: scope }); if (tree) tree.update(element); else tree = TestRenderer.create(element); await settle(); });
  }
  const h = { manager, requests, timers, initialScope, diagnostics, render,
    get snapshot() { return snapshot; }, get controls() { return controls; }, signOuts: () => signOuts,
    async retry(twice = false) { const retry = controls.retrySessionHistory; await act(async () => { retry(); if (twice) retry(); await settle(); }); },
    async choose(id, twice = false) { const choose = controls.chooseSession; await act(async () => { choose(id); if (twice) choose(id); await settle(); }); },
    async respond(index, status, data, companion) { await act(async () => { requests[index].respond(status, data, companion); await settle(); }); },
    async raw(index, response) { await act(async () => { requests[index].respondWith(response); await settle(); }); },
    async timeout() { await act(async () => { const timer = [...timers].find(([, entry]) => entry.delay === 15_000); assert.ok(timer, "complete-body deadline exists"); timers.delete(timer[0]); timer[1].callback(); await settle(); }); },
    async generateNewMessage() { await act(async () => { controls.messageLoadTokenRef.current++; controls.setMessages([message("new-generation")]); await settle(); }); },
    async switchScope(account = false) { if (account) { session = sessionFor(ACCOUNT_B); authListener("SIGNED_IN", session); } manager.setActiveCompanionId(COMPANION_B); initialId = SESSION_B; await render(); },
    async unmount() { if (tree) { await act(async () => { tree.unmount(); await settle(); }); tree = null; } },
    async finish() { await this.unmount(); manager.destroy(); await vite.close(); diagnostics.clearOperationFailures(initialScope); diagnostics.clearOperationFailures(JSON.stringify([ACCOUNT_A, COMPANION_B])); diagnostics.clearOperationFailures(JSON.stringify([ACCOUNT_B, COMPANION_B])); for (const [name, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } },
  };
  await render();
  return h;
}

test("actual history effect shows loading, explicit first-read failure and GET-only same-turn retry", async () => {
  const h = await harness(); try {
    assert.deepEqual(h.snapshot.historyLoadState, { sessionId: SESSION_A, status: "loading" });
    assert.equal(h.requests[0].path, `/api/v2/sessions/${SESSION_A}/messages`);
    await h.respond(0, 503, { code: "fictional_failure", message: "FICTIONAL_PRIVATE_BODY" });
    assert.equal(h.snapshot.historyLoadState.status, "error");
    assert.equal(h.controls.historyLoadPendingRef.current, false);
    assert.doesNotMatch(JSON.stringify(h.snapshot.historyLoadState), /FICTIONAL_PRIVATE_BODY/);
    await h.retry(true); assert.equal(h.requests.length, 2); assert.equal(h.snapshot.historyLoadState.status, "loading");
    await h.respond(1, 200, { messages: [message("confirmed")] });
    assert.equal(h.snapshot.historyLoadState, null); assert.equal(h.snapshot.messages[0].id, "confirmed");
    assert.ok(h.requests.every(request => (request.options.method || "GET") === "GET" && request.options.body === undefined));
    assert.equal(h.requests[1].options.headers.get("X-DengTa-Companion-Id"), COMPANION_A);
  } finally { await h.finish(); }
});

test("reselecting the actual current session retries a failed read exactly once", async () => {
  const h = await harness(); try {
    await h.respond(0, 503, { code: "fictional_failure" });
    await h.choose(SESSION_A, true); assert.equal(h.requests.length, 2);
    await h.respond(1, 200, { messages: [] }); assert.equal(h.snapshot.historyLoadState, null);
    await h.choose(SESSION_A, true); assert.equal(h.requests.length, 2, "confirmed empty history is not an error");
  } finally { await h.finish(); }
});

test("ordinary rerender and retry during pending read do not duplicate history requests", async () => {
  const h = await harness(); try {
    await h.render(); await h.retry(true); await h.choose(SESSION_A, true);
    assert.equal(h.requests.length, 1, "real scoped hook callbacks stay stable between renders");
    await h.respond(0, 200, { messages: [] });
  } finally { await h.finish(); }
});

for (const status of [200, 503]) test(`late session A HTTP ${status} cannot replace session B history or feedback`, async () => {
  const h = await harness(); try {
    await h.choose(SESSION_B); assert.equal(h.requests.length, 2);
    await h.respond(1, 200, { messages: [message("new-session")] });
    await h.respond(0, status, status === 200 ? { messages: [message("old-session")] } : { code: "fictional_old_error" });
    assert.equal(h.snapshot.activeSessionId, SESSION_B); assert.equal(h.snapshot.messages[0].id, "new-session");
    assert.equal(h.snapshot.historyLoadState, null); assert.equal(h.controls.historyLoadPendingRef.current, false);
  } finally { await h.finish(); }
});

test("old request completion cannot release the new session pending-read lock", async () => {
  const h = await harness(); try {
    await h.choose(SESSION_B); await h.respond(0, 503, { code: "fictional_old_error" });
    assert.equal(h.snapshot.historyLoadState.status, "loading"); assert.equal(h.controls.historyLoadPendingRef.current, true);
    await h.retry(true); assert.equal(h.requests.length, 2);
    await h.respond(1, 200, { messages: [] });
  } finally { await h.finish(); }
});

for (const account of [false, true]) test(`late 401 after ${account ? "account" : "companion"} change cannot expire the new identity`, async () => {
  const h = await harness(); try {
    await h.switchScope(account);
    assert.equal(h.requests[0].options.signal.aborted, true);
    assert.equal(h.requests[1].options.headers.get("X-DengTa-Companion-Id"), COMPANION_B);
    await h.respond(1, 200, { messages: [message("new-identity")] }, COMPANION_B);
    await h.respond(0, 401, { code: "invalid_session", message: "FICTIONAL_PRIVATE_BODY" });
    assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated);
    assert.equal(h.manager.getSnapshot().user.id, account ? ACCOUNT_B : ACCOUNT_A);
    assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); assert.equal(h.signOuts(), 0);
    assert.equal(h.snapshot.messages[0].id, "new-identity"); assert.equal(h.snapshot.historyLoadState, null);
    assert.equal(h.diagnostics.readOperationFailures(settingsSaveScope(h.manager.getSnapshot())).length, 0);
  } finally { await h.finish(); }
});

test("401 JSON already pending before account switch cannot sign out the replacement account", async () => {
  const h = await harness(), body = deferred(); try {
    await h.raw(0, { status: 401, ok: false, headers: new Headers(), clone: () => ({ json: () => body.promise }), json: () => body.promise });
    await h.switchScope(true); await h.respond(1, 200, { messages: [] }, COMPANION_B);
    await act(async () => { body.resolve({ code: "invalid_session" }); await settle(); });
    assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated); assert.equal(h.signOuts(), 0);
    assert.equal(h.snapshot.historyLoadState, null);
  } finally { await h.finish(); }
});

test("stalled history JSON hits the complete deadline, then manual retry recovers without late overwrite", async () => {
  const h = await harness(), body = deferred(); try {
    await h.raw(0, { status: 200, ok: true, headers: new Headers(), json: () => body.promise });
    await h.timeout(); assert.equal(h.snapshot.historyLoadState.status, "error");
    assert.equal(h.snapshot.historyLoadState.error.code, "request_timeout"); assert.equal(h.timers.size, 0);
    assert.equal(h.requests[0].options.signal.aborted, true, "complete deadline aborts the transport even after response headers");
    await h.retry(true); assert.equal(h.requests.length, 2);
    await h.respond(1, 200, { messages: [message("after-timeout")] });
    await act(async () => { body.resolve({ messages: [message("late-body")] }); await settle(); });
    assert.equal(h.snapshot.messages[0].id, "after-timeout"); assert.equal(h.snapshot.historyLoadState, null);
  } finally { await h.finish(); }
});

for (const status of [200, 503]) test(`generation token invalidation ignores old history HTTP ${status}`, async () => {
  const h = await harness(); try {
    await h.generateNewMessage();
    await h.respond(0, status, status === 200 ? { messages: [message("old-history")] } : { code: "fictional_old_error" });
    assert.equal(h.snapshot.messages[0].id, "new-generation");
    assert.notEqual(h.snapshot.historyLoadState?.status, "error");
  } finally { await h.finish(); }
});

for (const receipt of [{}, null, { messages: null }, { messages: {} }, { messages: "FICTIONAL_PRIVATE_BODY" }]) test("malformed history receipt remains an explicit error: " + JSON.stringify(receipt), async () => {
  const h = await harness(); try {
    await h.respond(0, 200, receipt);
    assert.equal(h.snapshot.historyLoadState.status, "error"); assert.equal(h.snapshot.historyLoadState.error.code, "session_receipt_invalid");
    assert.deepEqual(h.snapshot.messages, []); assert.doesNotMatch(JSON.stringify(h.snapshot.historyLoadState), /FICTIONAL_PRIVATE_BODY/);
    assert.ok(h.diagnostics.readOperationFailures(h.initialScope).some(entry => entry.reasonCode === "session_receipt_invalid"));
  } finally { await h.finish(); }
});

test("confirmed empty history is valid and never creates a receipt diagnostic", async () => {
  const h = await harness(); try {
    await h.respond(0, 200, { messages: [] }); assert.equal(h.snapshot.historyLoadState, null); assert.deepEqual(h.snapshot.messages, []);
    assert.equal(h.diagnostics.readOperationFailures(h.initialScope).length, 0);
  } finally { await h.finish(); }
});

test("retry is blocked while a send or companion stream owns the current session", async () => {
  const h = await harness(); try {
    await h.respond(0, 503, { code: "fictional_failure" });
    h.controls.isSendingRef.current = true; await h.retry(true); assert.equal(h.requests.length, 1);
    h.controls.isSendingRef.current = false; h.controls.streamingSessionIdRef.current = SESSION_A; await h.retry(true); assert.equal(h.requests.length, 1);
    h.controls.streamingSessionIdRef.current = null; await h.retry(true); assert.equal(h.requests.length, 2);
    await h.respond(1, 200, { messages: [] });
  } finally { await h.finish(); }
});

test("no selected session or already displayed streaming session sends no history request", async () => {
  for (const options of [{ initialSession: null }, { streaming: true }]) {
    const h = await harness(options); try { assert.equal(h.requests.length, 0); assert.equal(h.snapshot.historyLoadState, null); assert.equal(h.controls.historyLoadPendingRef.current, false); } finally { await h.finish(); }
  }
});

test("unmount cancels pending transport and all history deadlines", async () => {
  const h = await harness(); try {
    await h.unmount(); assert.equal(h.requests[0].options.signal.aborted, true); assert.equal(h.timers.size, 0);
    await h.respond(0, 401, { code: "invalid_session" }); assert.equal(h.signOuts(), 0);
  } finally { await h.finish(); }
});

test("unmount aborts history transport while its JSON body remains pending", async () => {
  const h = await harness(), body = deferred(); try {
    await h.raw(0, { status: 200, ok: true, headers: new Headers(), json: () => body.promise });
    assert.equal(h.requests[0].options.signal.aborted, false);
    await h.unmount();
    assert.equal(h.requests[0].options.signal.aborted, true, "body consumption retains the same cancellable transport signal");
    assert.equal(h.timers.size, 0);
    await act(async () => { body.resolve({ messages: [message("late-unmounted-body")] }); await settle(); });
    assert.equal(h.signOuts(), 0);
  } finally { await h.finish(); }
});

test("account scope replacement aborts a pending history body and preserves the new account history", async () => {
  const h = await harness(), body = deferred(); try {
    await h.raw(0, { status: 200, ok: true, headers: new Headers(), json: () => body.promise });
    await h.switchScope(true);
    assert.equal(h.requests[0].options.signal.aborted, true, "scope unmount truly aborts the old body transport");
    await h.respond(1, 200, { messages: [message("replacement-account-history")] }, COMPANION_B);
    await act(async () => { body.resolve({ messages: [message("late-old-account-body")] }); await settle(); });
    assert.equal(h.snapshot.messages[0].id, "replacement-account-history"); assert.equal(h.snapshot.historyLoadState, null);
    assert.equal(h.manager.getSnapshot().user.id, ACCOUNT_B); assert.equal(h.signOuts(), 0); assert.equal(h.timers.size, 0);
  } finally { await h.finish(); }
});
