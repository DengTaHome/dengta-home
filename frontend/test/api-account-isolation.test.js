import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = { setTimeout, clearTimeout };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const changed = error => error?.code === "settings_scope_changed";

function manager(accountId = "account-a", companionId = "companion-a") {
  let identity = { accountId, companionId, revision: 0 };
  const captures = [], invalidations = [];
  return {
    captures, invalidations,
    change(account = identity.accountId, companion = identity.companionId) {
      identity = { accountId: account, companionId: companion, revision: identity.revision + 1 };
    },
    getRequestScope: () => Object.freeze({ ...identity }),
    getSnapshot: () => ({ status: identity.accountId ? "authenticated" : "anonymous", user: identity.accountId ? { id: identity.accountId } : null, activeCompanionId: identity.companionId }),
    getRequestContext: async () => ({ accessToken: identity.accountId ? "fictional-" + identity.accountId : "", companionId: identity.companionId }),
    captureCompanionFromResponse(response, expected) {
      captures.push({ accountId: identity.accountId, expected, companionId: response.headers.get("X-DengTa-Companion-Id") });
    },
    invalidateSession(message) { invalidations.push(message); this.change("", ""); },
  };
}
globalThis.__apiScopeDefault = manager();
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  appType: "custom", logLevel: "silent", server: { middlewareMode: true },
  plugins: [{
    name: "fictional-default-auth-boundary",
    resolveId(id) { if (id === "virtual:api-scope-auth") return "\0" + id; },
    load(id) { if (id === "\0virtual:api-scope-auth") return "export const authSession=globalThis.__apiScopeDefault;"; },
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/src/api.js")) return code.replace('from "./auth-session.js"', 'from "virtual:api-scope-auth"');
    },
  }],
});
const { apiFetch, apiRequest, clearApiRequestCache, streamChat } = await vite.ssrLoadModule("/src/api.js");
const runtime = await vite.ssrLoadModule("/src/account-cleanup.js");
const diagnostics = await vite.ssrLoadModule("/src/operation-diagnostics.js");
function transport() {
  const calls = [];
  globalThis.fetch = (url, options) => { const pending = deferred(); calls.push({ url, options, ...pending }); return pending.promise; };
  return calls;
}
const json = (value, options = {}) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", "X-DengTa-Companion-Id": "companion-response" }, ...options });
after(async () => {
  await vite.close();
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  delete globalThis.__apiScopeDefault;
});

test("the default session deduplicates same-account reads and keeps complete headers and independent bodies", async () => {
  const auth = globalThis.__apiScopeDefault;
  const calls = transport();
  const first = apiFetch("/api/v2/bootstrap");
  const second = apiFetch("/api/v2/bootstrap", { authSession: null });
  await flush(); assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.get("Authorization"), "Bearer fictional-account-a");
  assert.equal(calls[0].options.cache, "no-store", "private JSON must not enter the shared HTTP cache");
  calls[0].resolve(json({ owner: "a" }));
  const responses = await Promise.all([first, second]);
  assert.deepEqual(await responses[0].json(), { owner: "a" });
  assert.deepEqual(await responses[1].json(), { owner: "a" });
  assert.equal(responses[1].headers.get("X-DengTa-Companion-Id"), "companion-response");
  assert.equal(auth.captures.length, 1);
});

test("B never joins A's default-session request, and A's late headers cannot capture B's companion", async () => {
  const auth = globalThis.__apiScopeDefault;
  clearApiRequestCache(); auth.captures.length = 0;
  const calls = transport();
  const old = apiRequest("/api/v2/bootstrap", { retry: false });
  const oldRejected = assert.rejects(old, changed);
  await flush(); auth.change("account-b", "companion-b");
  const current = apiRequest("/api/v2/bootstrap", { retry: false });
  await flush(); assert.equal(calls.length, 2);
  calls[0].resolve(json({ private: "fictional-a" }));
  await oldRejected;
  assert.equal(auth.captures.length, 0);
  calls[1].resolve(json({ private: "fictional-b" }));
  assert.deepEqual(await current, { private: "fictional-b" });
  assert.equal(auth.getSnapshot().activeCompanionId, "companion-b");
  assert.equal(auth.captures[0].accountId, "account-b");
});

test("JSON that finishes after an account switch is rejected even when its headers arrived earlier", async () => {
  const auth = manager(), calls = transport();
  const read = apiRequest("/api/v2/account", { authSession: auth, retry: false });
  const rejected = assert.rejects(read, changed);
  await flush();
  let body;
  calls[0].resolve(new Response(new ReadableStream({ start(controller) { body = controller; } }), { headers: { "Content-Type": "application/json" } }));
  await flush(); auth.change("account-b", "companion-b");
  body.enqueue(new TextEncoder().encode('{"private":"fictional-a"}')); body.close();
  await rejected;
  assert.equal(auth.getSnapshot().activeCompanionId, "companion-b");
  assert.ok(auth.captures.every(capture => capture.accountId === "account-a"));
});

test("a stale 401 body cannot invalidate B after A's response headers", async () => {
  const auth = manager(), calls = transport();
  const read = apiFetch("/api/v2/account", { authSession: auth, retry: false });
  const rejected = assert.rejects(read, changed);
  await flush(); let body;
  calls[0].resolve(new Response(new ReadableStream({ start(controller) { body = controller; } }), { status: 401, headers: { "Content-Type": "application/json" } }));
  await flush(); auth.change("account-b", "companion-b");
  body.enqueue(new TextEncoder().encode('{"code":"invalid_session"}')); body.close();
  await rejected; assert.equal(auth.invalidations.length, 0);
  assert.equal(auth.getSnapshot().user.id, "account-b");
});

test("companion changes and A-B-A session revisions do not share in-flight reads", async () => {
  for (const change of [auth => auth.change("account-a", "companion-b"), auth => { auth.change("account-b", "companion-b"); auth.change("account-a", "companion-a"); }]) {
    const auth = manager(), calls = transport();
    const old = apiRequest("/api/v2/bootstrap", { authSession: auth, retry: false });
    const rejected = assert.rejects(old, changed);
    await flush(); change(auth);
    const current = apiRequest("/api/v2/bootstrap", { authSession: auth, retry: false });
    await flush(); assert.equal(calls.length, 2);
    calls[0].resolve(json({ revision: "old" })); await rejected;
    calls[1].resolve(json({ revision: "new" })); assert.deepEqual(await current, { revision: "new" });
  }
});

test("separate auth managers and anonymous private reads never share responses", async () => {
  for (const auths of [[manager(), manager()], [manager("", ""), manager("", "")]]) {
    const calls = transport();
    const requests = auths.map(auth => apiRequest("/api/v2/bootstrap", { authSession: auth, retry: false }));
    await flush(); assert.equal(calls.length, 2);
    calls.forEach((call, index) => call.resolve(json({ request: index })));
    assert.deepEqual(await Promise.all(requests), [{ request: 0 }, { request: 1 }]);
  }
  const auth = manager("", ""), calls = transport();
  const requests = [apiRequest("/api/v2/bootstrap", { authSession: auth }), apiRequest("/api/v2/bootstrap", { authSession: auth })];
  await flush(); assert.equal(calls.length, 2);
  calls.forEach((call, index) => call.resolve(json({ request: index })));
  assert.deepEqual(await Promise.all(requests), [{ request: 0 }, { request: 1 }]);
});

test("a joined caller aborts promptly without cancelling the owner or starting another request", async () => {
  const auth = manager(), calls = transport(), abort = new AbortController();
  const owner = apiRequest("/api/v2/bootstrap", { authSession: auth });
  const joined = apiRequest("/api/v2/bootstrap", { authSession: auth, signal: abort.signal });
  const rejected = assert.rejects(joined, { name: "AbortError" });
  await flush(); assert.equal(calls.length, 1);
  abort.abort(); await rejected;
  assert.notEqual(calls[0].options.signal?.aborted, true);
  calls[0].resolve(json({ owner: "still-active" }));
  assert.deepEqual(await owner, { owner: "still-active" });
  assert.equal(calls.length, 1);
});

test("a joined caller's timeout leaves the owner running", async () => {
  const auth = manager(), calls = transport();
  const owner = apiRequest("/api/v2/bootstrap", { authSession: auth });
  const joined = apiRequest("/api/v2/bootstrap", { authSession: auth, timeoutMs: 10 });
  await assert.rejects(joined, { code: "request_timeout" });
  assert.equal(calls.length, 1); assert.notEqual(calls[0].options.signal?.aborted, true);
  calls[0].resolve(json({ owner: "still-active" }));
  assert.deepEqual(await owner, { owner: "still-active" });
});

test("the initiating caller's abort or timeout cannot cancel a joined reader", async () => {
  for (const timed of [false, true]) {
    const auth = manager(), calls = transport(), abort = new AbortController();
    const owner = apiRequest("/api/v2/bootstrap", { authSession: auth, ...(timed ? { timeoutMs: 10 } : { signal: abort.signal }) });
    const rejected = assert.rejects(owner, timed ? { code: "request_timeout" } : { name: "AbortError" });
    const joined = apiRequest("/api/v2/bootstrap", { authSession: auth });
    await flush(); assert.equal(calls.length, 1);
    if (!timed) abort.abort();
    await rejected;
    assert.notEqual(calls[0].options.signal?.aborted, true);
    calls[0].resolve(json({ owner: "joined reader still active" }));
    assert.deepEqual(await joined, { owner: "joined reader still active" });
  }
});

test("a legitimate initial companion response remains readable by both deduplicated consumers", async () => {
  const auth = manager("account-a", ""), calls = transport();
  auth.captureCompanionFromResponse = (response, expected) => {
    assert.equal(expected.accountId, "account-a"); assert.equal(expected.companionId, "");
    const companion = response.headers.get("X-DengTa-Companion-Id");
    auth.change("account-a", companion);
    return companion;
  };
  const first = apiRequest("/api/v2/bootstrap", { authSession: auth });
  const second = apiRequest("/api/v2/bootstrap", { authSession: auth });
  await flush(); assert.equal(calls.length, 1);
  calls[0].resolve(json({ selected: "companion-response" }));
  assert.deepEqual(await Promise.all([first, second]), [{ selected: "companion-response" }, { selected: "companion-response" }]);
});

test("the first authenticated request can finish initialization before binding its network identity", async () => {
  const context = deferred(), auth = manager("", ""), calls = transport();
  const getSnapshot = auth.getSnapshot;
  auth.getSnapshot = () => { const snapshot = getSnapshot(); return { ...snapshot, status: snapshot.user ? "authenticated" : "loading" }; };
  auth.getRequestContext = () => context.promise;
  const read = apiRequest("/api/v2/account", { authSession: auth });
  await flush(); assert.equal(calls.length, 0);
  auth.change("account-a", "companion-a");
  context.resolve({ accountId: "account-a", accessToken: "fictional-account-a", companionId: "companion-a", scopeRevision: auth.getRequestScope().revision });
  await flush(); assert.equal(calls.length, 1);
  calls[0].resolve(json({ owner: "a" }));
  assert.deepEqual(await read, { owner: "a" });
});

test("initial loading never relabels A's resolved credentials as B when B logs in before the await continuation", async () => {
  for (const includeIdentity of [false, true]) {
    const auth = manager("", ""), calls = transport(), getSnapshot = auth.getSnapshot;
    auth.getSnapshot = () => { const snapshot = getSnapshot(); return { ...snapshot, status: snapshot.user ? "authenticated" : "loading" }; };
    auth.getRequestContext = () => {
      auth.change("account-a", "");
      const context = { accessToken: "fictional-token-a", companionId: "" };
      if (includeIdentity) Object.assign(context, { accountId: "account-a", scopeRevision: auth.getRequestScope().revision });
      queueMicrotask(() => auth.change("account-b", ""));
      return Promise.resolve(context);
    };
    await assert.rejects(apiRequest("/api/v2/account", { authSession: auth, retry: false }), changed);
    assert.equal(calls.length, 0, "A's request must never be sent under B's identity");
    assert.equal(auth.getSnapshot().user.id, "account-b");
    assert.equal(auth.captures.length, 0);
  }
});

test("a previously returned Response cannot expose its body after account switch", async () => {
  const auth = manager(), calls = transport();
  const read = apiFetch("/api/v2/account", { authSession: auth });
  await flush(); calls[0].resolve(json({ private: "fictional-a" }));
  const response = await read;
  auth.change("account-b", "companion-b");
  assert.throws(() => response.json(), changed);
  assert.throws(() => response.clone(), changed);
  assert.throws(() => response.body, changed);
});

test("purging an old pending map cannot let its late finalizer delete a newer request", async () => {
  const auth = manager(), calls = transport();
  const old = apiRequest("/api/v2/bootstrap", { authSession: auth });
  await flush(); clearApiRequestCache(auth);
  const current = apiRequest("/api/v2/bootstrap", { authSession: auth });
  await flush(); assert.equal(calls.length, 2);
  calls[0].resolve(json({ request: "old" })); await old; await flush();
  const joined = apiRequest("/api/v2/bootstrap", { authSession: auth });
  await flush(); assert.equal(calls.length, 2);
  calls[1].resolve(json({ request: "new" }));
  assert.deepEqual(await Promise.all([current, joined]), [{ request: "new" }, { request: "new" }]);
});

test("diagnostics captured after relogin remain writable while old requests cannot repopulate the account", async () => {
  const auth = manager("diagnostic-account-a", "diagnostic-companion-a"), calls = transport();
  const scope = diagnostics.diagnosticScopeKey("diagnostic-account-a", "diagnostic-companion-a");
  runtime.prepareAccountRuntimeData("diagnostic-account-a");
  const old = apiRequest("/api/v2/settings", { method: "PUT", authSession: auth });
  const oldRejected = assert.rejects(old, changed);
  await flush();
  await runtime.clearAccountRuntimeData("diagnostic-account-a", {
    sealAccountCache() {}, purgeAccountCache: async () => {}, stopVoiceSpeech: async () => {},
    workspaceCacheClearLegacy: async () => {}, localStorage: null, sessionStorage: null,
  });
  auth.change("diagnostic-account-b", "diagnostic-companion-b");
  auth.change("diagnostic-account-a", "diagnostic-companion-a");
  runtime.prepareAccountRuntimeData("diagnostic-account-a");
  const current = apiRequest("/api/v2/settings", { method: "PUT", authSession: auth });
  const currentRejected = assert.rejects(current, { status: 500 });
  await flush();
  calls[1].resolve(json({ code: "fictional_failure" }, { status: 500 }));
  await currentRejected;
  calls[0].resolve(json({ code: "fictional_old_failure" }, { status: 500 }));
  await oldRejected;
  assert.equal(diagnostics.readOperationFailures(scope).length, 1);
  assert.equal(diagnostics.readOperationFailures(scope)[0].code, "DT-SETTINGS");
  diagnostics.clearOperationFailures(scope);
});

test("stream chunks and multiple events inside one chunk cannot cross an account switch", async () => {
  const auth = manager(), calls = transport(), events = [];
  const stream = streamChat({ message: "fictional" }, event => { events.push(event); auth.change("account-b", "companion-b"); }, { authSession: auth });
  const rejected = assert.rejects(stream, changed);
  await flush(); let body;
  calls[0].resolve(new Response(new ReadableStream({ start(controller) { body = controller; } }), { headers: { "Content-Type": "text/event-stream" } }));
  await flush();
  body.enqueue(new TextEncoder().encode('data: {"type":"text","content":"A only"}\n\ndata: {"type":"text","content":"must not reach B"}\n\n'));
  await rejected; assert.equal(events.length, 1);
});
