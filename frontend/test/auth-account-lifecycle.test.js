import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthSessionManager } from "../src/auth-session.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const COMPANION = "33333333-3333-4333-8333-333333333333";
const AUTH_KEY = "dengta_home_auth_v1";
const sessionFor = (account, suffix = account) => ({ access_token: `fictional-${suffix}`, user: { id: account } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };

function fixture({ clearAccountDataFn = () => {}, resolveStorageFn, getInitialSession, login, initial = sessionFor(A), adminSignOut } = {}) {
  const values = new Map(), clients = [], clearCalls = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  const manager = createAuthSessionManager({
    supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage,
    resolveStorageFn: resolveStorageFn || (() => storage),
    clearAccountDataFn(id) { clearCalls.push(id); return clearAccountDataFn(id); },
    createClientFn(_url, _key, options) {
      const record = { options, listener: null, stopped: 0, unsubscribed: 0 };
      const index = clients.push(record) - 1;
      record.client = { auth: {
        onAuthStateChange(listener) { record.listener = listener; return { data: { subscription: { unsubscribe() { record.unsubscribed += 1; } } } }; },
        getSession: () => getInitialSession ? getInitialSession(index) : Promise.resolve({ data: { session: index === 0 ? initial : null }, error: null }),
        async signInWithPassword() {
          const result = login ? await login(index) : sessionFor(B);
          record.listener?.("SIGNED_IN", result);
          return { data: { session: result }, error: null };
        },
        async setSession() {
          const result = login ? await login(index) : sessionFor(B);
          record.listener?.("SIGNED_IN", result);
          return { data: { session: result }, error: null };
        },
        stopAutoRefresh() { record.stopped += 1; },
        admin: { signOut: adminSignOut || (() => Promise.reject(new Error("fictional offline"))) },
      } };
      return record.client;
    },
  });
  return { manager, storage, values, clients, clearCalls };
}

test("offline logout clears the local identity immediately and never waits for remote revocation", async () => {
  const remote = deferred(), cleanup = deferred();
  const h = fixture({ adminSignOut: () => remote.promise, clearAccountDataFn: () => cleanup.promise });
  await h.manager.initialize();
  const oldScope = h.manager.getRequestScope();
  await h.clients[0].options.auth.storage.setItem(AUTH_KEY, "fictional-a-persisted");
  const exiting = h.manager.signOut();
  assert.equal(h.manager.getSnapshot().user, null);
  assert.equal(h.manager.getSnapshot().status, "anonymous");
  assert.ok(h.manager.getRequestScope().revision > oldScope.revision);
  assert.deepEqual(h.clearCalls, [A]);
  assert.equal(h.clients[0].stopped, 1);
  await assert.rejects(h.clients[0].options.auth.storage.setItem(AUTH_KEY, "fictional-late-a"), { code: "auth_storage_retired" });
  cleanup.resolve();
  await exiting;
  assert.equal(h.values.has(AUTH_KEY), false);
  assert.deepEqual(await h.manager.getRequestContext(), {});
  h.manager.destroy();
});

test("B cannot initialize or login until all A local cleanup has finished", async () => {
  const cleanup = deferred();
  const h = fixture({ clearAccountDataFn: () => cleanup.promise });
  await h.manager.initialize();
  const exiting = h.manager.signOut();
  const entering = h.manager.signIn({ email: "fictional@example.test", password: "fictional-password" });
  await settle();
  assert.equal(h.clients.length, 1);
  cleanup.resolve();
  await Promise.all([exiting, entering]);
  assert.equal(h.clients.length, 2);
  assert.equal(h.manager.getSnapshot().user.id, B);
  await h.clients[1].options.auth.storage.setItem(AUTH_KEY, "fictional-b-persisted");
  await assert.rejects(h.clients[0].options.auth.storage.removeItem(AUTH_KEY), { code: "auth_storage_retired" });
  assert.equal(h.values.get(AUTH_KEY), "fictional-b-persisted");
  // A listener already queued by the SDK remains powerless after unsubscribe.
  h.clients[0].listener("TOKEN_REFRESHED", sessionFor(A, "late-a"));
  assert.equal(h.manager.getSnapshot().user.id, B);
  h.manager.destroy();
});

test("a delayed storage resolver is retired before B can acquire the same backing store", async () => {
  const resolver = deferred();
  let resolveCalls = 0;
  let h;
  h = fixture({ resolveStorageFn: () => ++resolveCalls === 1 ? resolver.promise : h.storage });
  const initializing = h.manager.initialize(); initializing.catch(() => {});
  await settle();
  const exiting = h.manager.signOut();
  const entering = h.manager.signIn({ email: "fictional@example.test", password: "fictional-password" });
  await settle();
  assert.equal(resolveCalls, 1);
  assert.equal(h.clients.length, 0);
  resolver.resolve(h.storage);
  await assert.rejects(initializing, { code: "settings_scope_changed" });
  await exiting;
  await entering;
  assert.equal(resolveCalls, 2);
  assert.equal(h.clients.length, 1);
  await h.clients[0].options.auth.storage.setItem(AUTH_KEY, "fictional-b-persisted");
  await settle();
  assert.equal(h.values.get(AUTH_KEY), "fictional-b-persisted");
  h.manager.destroy();
});

test("failed cleanup stays closed and a later explicit login retries it after unlocking", async () => {
  let unlocked = false;
  const h = fixture({ clearAccountDataFn: () => { if (!unlocked) throw new Error("fictional locked device"); } });
  await h.manager.initialize();
  await assert.rejects(h.manager.signOut(), { code: "account_cleanup_failed" });
  await assert.rejects(h.manager.signIn({}), /locked|清理/);
  assert.equal(h.clients.length, 1);
  unlocked = true;
  await h.manager.signIn({});
  assert.equal(h.manager.getSnapshot().user.id, B);
  assert.equal(h.clients.length, 2);
  assert.ok(h.clearCalls.filter(id => id === A).length >= 2);
  h.manager.destroy();
});

test("failed direct A to B cleanup remains tracked even after B logs out", async () => {
  let unlockedA = false;
  const h = fixture({ clearAccountDataFn: account => { if (account === A && !unlockedA) throw new Error("fictional A vault locked"); } });
  await h.manager.initialize();
  h.clients[0].listener("SIGNED_IN", sessionFor(B));
  await assert.rejects(h.manager.waitForAccountData(), { code: "account_cleanup_failed" });
  await assert.rejects(h.manager.signOut(), { code: "account_cleanup_failed" });
  unlockedA = true;
  await h.manager.waitForAccountData({ retry: true });
  assert.ok(h.clearCalls.filter(id => id === A).length >= 2);
  assert.ok(h.clearCalls.includes(B));
  h.manager.destroy();
});

test("old callback completion cannot replace B or turn its screen into an error", async () => {
  const oldLink = deferred();
  const h = fixture({ login: index => index === 0 ? oldLink.promise : sessionFor(B) });
  await h.manager.initialize();
  const callback = h.manager.handleAuthCallbackUrl("dengta://auth#access_token=fictional-access&refresh_token=fictional-refresh&type=recovery"); callback.catch(() => {});
  await settle();
  await h.manager.signOut();
  await h.manager.signIn({});
  oldLink.resolve(sessionFor(A));
  await assert.rejects(callback, { code: "settings_scope_changed" });
  assert.equal(h.manager.getSnapshot().user.id, B);
  assert.equal(h.manager.getSnapshot().status, "authenticated");
  h.manager.destroy();
});

test("initial restoration does not overwrite a newer SDK session event", async () => {
  const restored = deferred();
  const h = fixture({ getInitialSession: () => restored.promise });
  const initializing = h.manager.initialize();
  await settle();
  h.clients[0].listener("SIGNED_IN", sessionFor(B));
  restored.resolve({ data: { session: sessionFor(A) }, error: null });
  await initializing;
  assert.equal(h.manager.getSnapshot().user.id, B);
  h.manager.destroy();
});

test("request metadata and response companion capture are bound to the original account revision", async () => {
  const h = fixture();
  await h.manager.initialize();
  const context = await h.manager.getRequestContext();
  const requestScope = h.manager.getRequestScope();
  assert.equal(context.accountId, A);
  assert.equal(context.scopeRevision, requestScope.revision);
  assert.deepEqual(Object.keys(context), ["accessToken", "companionId"]);
  h.clients[0].listener("SIGNED_IN", sessionFor(B));
  assert.equal(h.manager.captureCompanionFromResponse({ headers: { get: () => COMPANION } }, requestScope), "");
  assert.equal(h.manager.getSnapshot().activeCompanionId, "");
  h.manager.destroy();
});


test("a late refresh or initial callback cannot silently sign A back in after B", async () => {
  const h = fixture();
  await h.manager.initialize();
  h.clients[0].listener("SIGNED_IN", sessionFor(B));
  for (const event of ["TOKEN_REFRESHED", "USER_UPDATED", "INITIAL_SESSION"]) {
    h.clients[0].listener(event, sessionFor(A, "late-refresh"));
    assert.equal(h.manager.getSnapshot().user.id, B);
  }
  h.manager.destroy();
});

test("B waits for the physical clear discovered by A's delayed resolver", async () => {
  const resolver = deferred(), clearing = deferred();
  let calls = 0, h;
  h = fixture({ resolveStorageFn: () => ++calls === 1 ? resolver.promise : h.storage });
  const initializing = h.manager.initialize(); initializing.catch(() => {});
  await settle();
  const exiting = h.manager.signOut();
  const entering = h.manager.signIn({});
  resolver.resolve({ ...h.storage, retireAndClear: () => clearing.promise.then(() => h.storage.removeItem(AUTH_KEY)) });
  await settle();
  assert.equal(h.clients.length, 0, "no SDK may read the still-uncleared A store");
  clearing.resolve();
  await assert.rejects(initializing, { code: "settings_scope_changed" });
  await Promise.all([exiting, entering]);
  await h.clients[0].options.auth.storage.setItem(AUTH_KEY, "fictional-b-persisted");
  await settle();
  assert.equal(h.values.get(AUTH_KEY), "fictional-b-persisted");
  h.manager.destroy();
});

test("logout cancels B while B is waiting for A's cleanup", async () => {
  const cleanup = deferred();
  const h = fixture({ clearAccountDataFn: () => cleanup.promise });
  await h.manager.initialize();
  const firstExit = h.manager.signOut();
  const entering = h.manager.signIn({}); entering.catch(() => {});
  await settle();
  const secondExit = h.manager.signOut();
  cleanup.resolve();
  await Promise.all([firstExit, secondExit]);
  await assert.rejects(entering, { code: "settings_scope_changed" });
  assert.equal(h.clients.length, 1);
  assert.equal(h.manager.getSnapshot().user, null);
  h.manager.destroy();
});

test("parallel sign-in and email callback cannot start competing SDK identity changes", async () => {
  const login = deferred();
  const h = fixture({ initial: null, login: () => login.promise });
  await h.manager.initialize();
  const entering = h.manager.signIn({});
  await settle();
  await assert.rejects(h.manager.signIn({}), { code: "auth_operation_in_progress" });
  await assert.rejects(h.manager.handleAuthCallbackUrl("dengta://auth#access_token=fictional-a&refresh_token=fictional-r"), { code: "auth_operation_in_progress" });
  login.resolve(sessionFor(B));
  await entering;
  assert.equal(h.manager.getSnapshot().user.id, B);
  h.manager.destroy();
});

test("migration failure during logout can recover the shared store after unlock", async () => {
  const resolver = deferred();
  let locked = true, calls = 0, h;
  h = fixture({ resolveStorageFn: () => {
    calls += 1;
    if (calls === 1) return resolver.promise;
    if (locked) throw Object.assign(new Error("fictional lock"), { code: "ios_auth_storage_migration_failed" });
    return h.storage;
  } });
  const initializing = h.manager.initialize(); initializing.catch(() => {});
  await settle();
  const exiting = h.manager.signOut(); exiting.catch(() => {});
  resolver.reject(Object.assign(new Error("fictional lock"), { code: "ios_auth_storage_migration_failed" }));
  await assert.rejects(initializing, { code: "settings_scope_changed" });
  await assert.rejects(exiting, { code: "account_cleanup_failed" });
  locked = false;
  await h.manager.waitForAccountData({ retry: true });
  await h.manager.signIn({});
  assert.equal(h.manager.getSnapshot().user.id, B);
  h.manager.destroy();
});

test("account mount revision distinguishes same-account relogin but stays stable for tokens and companion changes", async () => {
  const h = fixture({ login: () => sessionFor(A, "returned-a") });
  const initial = h.manager.getAccountDataRevision();
  await h.manager.initialize();
  const firstA = h.manager.getAccountDataRevision();
  assert.ok(firstA > initial);
  h.manager.setActiveCompanionId(COMPANION);
  h.clients[0].listener("TOKEN_REFRESHED", sessionFor(A, "refreshed-a"));
  assert.equal(h.manager.getAccountDataRevision(), firstA);
  await h.manager.signOut();
  assert.ok(h.manager.getAccountDataRevision() > firstA);
  const exiting = h.manager.getAccountDataRevision();
  // Synchronous source transitions can be batched by React. The final UID may
  // be the same; the mount revision must still differ from the old A view.
  await h.manager.signIn({});
  assert.equal(h.manager.getAccountDataRevision(), exiting + 1);
  assert.notEqual(h.manager.getAccountDataRevision(), firstA);
  assert.equal(h.manager.getSnapshot().user.id, A);
  assert.equal(Object.hasOwn(h.manager.getSnapshot(), "accountDataRevision"), false);
  h.manager.destroy();
});

test("preferences restore only after private cache hydration for the current account mount", async () => {
  const h = fixture();
  await h.manager.initialize();
  const revision = h.manager.getAccountDataRevision();
  assert.equal(h.manager.getSnapshot().activeCompanionId, "");
  // Represents data becoming readable after the native protected cache loads.
  h.storage.setItem(`dengta_active_companion_id_v1:${A}`, COMPANION);
  assert.equal(h.manager.hydrateAccountPreferences(B, revision), "");
  assert.equal(h.manager.hydrateAccountPreferences(A, revision - 1), "");
  assert.equal(h.manager.getSnapshot().activeCompanionId, "");
  assert.equal(h.manager.hydrateAccountPreferences(A, revision), COMPANION);
  assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION);
  assert.equal(h.manager.getAccountDataRevision(), revision);
  await h.manager.signOut();
  assert.equal(h.manager.hydrateAccountPreferences(A, revision), "");
  h.manager.destroy();
});
