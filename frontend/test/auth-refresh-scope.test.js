import assert from "node:assert/strict";
import { test } from "node:test";
import { apiFetch } from "../src/api.js";
import { AUTH_STATUS, createAuthSessionManager } from "../src/auth-session.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111", ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333", COMPANION_B = "44444444-4444-4444-8444-444444444444";
const sessionFor = (account, token, expired = false) => ({ access_token: token, expires_at: expired ? 1 : Math.floor(Date.now() / 1000) + 3600, user: { id: account, email: "fictional@example.test" } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };
async function settle() { for (let i = 0; i < 30; i += 1) await Promise.resolve(); }

async function fixture({ expired = true, sharedRefresh = false } = {}) {
  const values = new Map(), refreshes = [], shared = deferred();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  let session = sessionFor(ACCOUNT_A, "fictional-token-a", expired), listener;
  const sdk = { auth: {
    onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session }, error: null }; },
    refreshSession() { const gate = sharedRefresh ? shared : deferred(); refreshes.push(gate); return gate.promise; },
    async signOut() { session = null; listener("SIGNED_OUT", null); return { error: null }; },
  } };
  const manager = createAuthSessionManager({ supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage, createClientFn: () => sdk });
  await manager.initialize(); manager.setActiveCompanionId(COMPANION_A);
  return { manager, refreshes, storage,
    emit(event, nextSession) { session = nextSession; listener(event, nextSession); },
    switchAccount(account = ACCOUNT_B, companion = COMPANION_B) { this.emit("SIGNED_IN", sessionFor(account, account === ACCOUNT_A ? "fictional-latest-a" : "fictional-token-b")); manager.setActiveCompanionId(companion); },
    async started(count = 1) { await settle(); assert.equal(refreshes.length, count); },
    finish() { manager.destroy(); },
  };
}

for (const result of ["valid", "null", "invalid", "reject"]) test("an old " + result + " refresh result cannot overwrite the next account or expire it", async () => {
  const h = await fixture();
  try {
    const pending = h.manager.getRequestContext(); pending.catch(() => {}); await h.started();
    h.switchAccount();
    if (result === "reject") h.refreshes[0].reject(new Error("fictional refresh failure"));
    else h.refreshes[0].resolve({ data: { session: result === "null" ? null : result === "invalid" ? { access_token: "fictional-invalid" } : sessionFor(ACCOUNT_A, "fictional-stale-a") } });
    await assert.rejects(pending, { code: "settings_scope_changed" });
    assert.equal(h.manager.getSnapshot().user.id, ACCOUNT_B); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated);
    assert.deepEqual(await h.manager.getRequestContext(), { accessToken: "fictional-token-b", companionId: COMPANION_B });
  } finally { h.finish(); }
});

test("companion changes during refresh cancel the originating request", async () => {
  const h = await fixture();
  try {
    const pending = h.manager.getRequestContext(); pending.catch(() => {}); await h.started();
    h.manager.setActiveCompanionId(COMPANION_B);
    h.refreshes[0].resolve({ data: { session: sessionFor(ACCOUNT_A, "fictional-refreshed-a") } });
    await assert.rejects(pending, { code: "settings_scope_changed" });
    assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B);
  } finally { h.finish(); }
});

for (const accountChange of [true, false]) test((accountChange ? "account" : "companion") + " switching away and back cannot revive an old request", async () => {
  const h = await fixture();
  try {
    const pending = h.manager.getRequestContext(); pending.catch(() => {}); await h.started();
    if (accountChange) { h.switchAccount(); h.switchAccount(ACCOUNT_A, COMPANION_A); }
    else { h.manager.setActiveCompanionId(COMPANION_B); h.manager.setActiveCompanionId(COMPANION_A); }
    h.refreshes[0].resolve({ data: { session: sessionFor(ACCOUNT_A, "fictional-stale-a") } });
    await assert.rejects(pending, { code: "settings_scope_changed" });
    assert.equal(h.manager.getSnapshot().user.id, ACCOUNT_A); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_A);
    if (accountChange) assert.equal((await h.manager.getRequestContext()).accessToken, "fictional-latest-a");
  } finally { h.finish(); }
});

for (const failed of [false, true]) test("sign out during a pending " + (failed ? "failed" : "successful") + " refresh cannot return or restore old credentials", async () => {
  const h = await fixture();
  try {
    const pending = h.manager.getRequestContext(); pending.catch(() => {}); await h.started(); await h.manager.signOut();
    if (failed) h.refreshes[0].reject(new Error("fictional refresh failure"));
    else h.refreshes[0].resolve({ data: { session: sessionFor(ACCOUNT_A, "fictional-stale-a") } });
    await assert.rejects(pending, { code: "settings_scope_changed" });
    assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.anonymous); assert.deepEqual(await h.manager.getRequestContext(), {});
  } finally { h.finish(); }
});

test("normal TOKEN_REFRESHED before promise resolution retains the event's newer session", async () => {
  const h = await fixture();
  try {
    const pending = h.manager.getRequestContext(); await h.started();
    h.emit("TOKEN_REFRESHED", sessionFor(ACCOUNT_A, "fictional-newest-event-a"));
    h.refreshes[0].resolve({ data: { session: sessionFor(ACCOUNT_A, "fictional-older-result-a") } });
    assert.deepEqual(await pending, { accessToken: "fictional-newest-event-a", companionId: COMPANION_A });
    assert.equal((await h.manager.getRequestContext()).accessToken, "fictional-newest-event-a");
  } finally { h.finish(); }
});

test("a normal matching refresh result without an SDK event still updates credentials", async () => {
  const h = await fixture();
  try {
    const pending = h.manager.getRequestContext(); await h.started();
    h.refreshes[0].resolve({ data: { session: sessionFor(ACCOUNT_A, "fictional-refreshed-a") } });
    assert.deepEqual(await pending, { accessToken: "fictional-refreshed-a", companionId: COMPANION_A });
    assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated);
  } finally { h.finish(); }
});

test("concurrent callers remain compatible with the SDK sharing one refresh promise", async () => {
  const h = await fixture({ sharedRefresh: true });
  try {
    const first = h.manager.getRequestContext(), second = h.manager.getRequestContext(); await h.started(2);
    h.emit("TOKEN_REFRESHED", sessionFor(ACCOUNT_A, "fictional-shared-a"));
    h.refreshes[0].resolve({ data: { session: sessionFor(ACCOUNT_A, "fictional-shared-a") } });
    for (const context of await Promise.all([first, second])) assert.deepEqual(context, { accessToken: "fictional-shared-a", companionId: COMPANION_A });
  } finally { h.finish(); }
});

test("out-of-order concurrent results cannot replace the already accepted session", async () => {
  const h = await fixture();
  try {
    const first = h.manager.getRequestContext(), second = h.manager.getRequestContext(); await h.started(2);
    h.refreshes[1].resolve({ data: { session: sessionFor(ACCOUNT_A, "fictional-newer-result-a") } }); await second;
    h.refreshes[0].resolve({ data: { session: sessionFor(ACCOUNT_A, "fictional-older-result-a") } });
    assert.equal((await first).accessToken, "fictional-newer-result-a");
    assert.equal((await h.manager.getRequestContext()).accessToken, "fictional-newer-result-a");
  } finally { h.finish(); }
});

test("scope changes at the initial await cannot return the new account credentials", async () => {
  const h = await fixture({ expired: false });
  try {
    const pending = h.manager.getRequestContext(); pending.catch(() => {}); h.switchAccount();
    await assert.rejects(pending, { code: "settings_scope_changed" }); assert.equal(h.refreshes.length, 0);
  } finally { h.finish(); }
});

test("an unchanged account preserves the existing refresh-error fallback", async () => {
  const h = await fixture();
  try {
    const pending = h.manager.getRequestContext(); await h.started(); h.refreshes[0].reject(new Error("fictional network failure"));
    assert.deepEqual(await pending, { accessToken: "fictional-token-a", companionId: COMPANION_A });
    assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated);
  } finally { h.finish(); }
});

test("request headers follow the selected snapshot when persisted companion storage is stale", async () => {
  const h = await fixture({ expired: false });
  try {
    h.storage.setItem("dengta_active_companion_id_v1:" + ACCOUNT_A, COMPANION_B);
    assert.equal((await h.manager.getRequestContext()).companionId, COMPANION_A);
  } finally { h.finish(); }
});

test("the real API sends no old request after refresh switches accounts and the next request uses B", async () => {
  const h = await fixture();
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch"), windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window"), requests = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url, options) => {
    assert.equal(new URL(url).origin, "http://localhost:3000", "synthetic fixture intercepts every fetch before a network request");
    assert.equal(new URL(url).pathname, "/fixture/auth-refresh"); requests.push(options);
    return new Response("{}", { status: 200, headers: { "X-DengTa-Companion-Id": COMPANION_B } });
  } });
  try {
    const oldRequest = apiFetch("/fixture/auth-refresh", { method: "POST", body: "FICTIONAL_A_BODY", retry: false, authSession: h.manager }); oldRequest.catch(() => {}); await h.started();
    h.switchAccount(); h.refreshes[0].resolve({ data: { session: sessionFor(ACCOUNT_A, "fictional-stale-a") } });
    await assert.rejects(oldRequest); assert.equal(requests.length, 0);
    await apiFetch("/fixture/auth-refresh", { method: "POST", body: "FICTIONAL_B_BODY", retry: false, authSession: h.manager });
    assert.equal(requests.length, 1); assert.equal(requests[0].headers.get("Authorization"), "Bearer fictional-token-b");
    assert.equal(requests[0].headers.get("X-DengTa-Companion-Id"), COMPANION_B); assert.equal(requests[0].body, "FICTIONAL_B_BODY");
    assert.equal(h.manager.getSnapshot().user.id, ACCOUNT_B);
  } finally {
    h.finish();
    if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor); else delete globalThis.fetch;
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor); else delete globalThis.window;
  }
});
