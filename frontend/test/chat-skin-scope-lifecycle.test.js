import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { env } from "node:process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { test } from "node:test";
import { apiRequest } from "../src/api.js";
import { AUTH_STATUS, createAuthSessionManager } from "../src/auth-session.js";
import {
  chatSkinPreferencesApiPayload,
  normalizeChatSkinPreferences,
  readStoredChatSkinPreferences,
  writeStoredChatSkinPreferences,
} from "../src/chat-skin.js";
import { createScopedSettingsSession, settingsSaveScope } from "../src/settings-save-scope.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const app = (env.DENGTA_CHAT_SKIN_APP_REF
  ? execFileSync("git", ["show", `${env.DENGTA_CHAT_SKIN_APP_REF}:src/App.jsx`], { cwd: root, encoding: "utf8", maxBuffer: 2_000_000 })
  : readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
function sourceBetween(startMarker, endMarker) {
  const start = app.indexOf(startMarker), end = app.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Extract actual App source: ${startMarker}`);
  return app.slice(start, end);
}
const preferencesSource = sourceBetween("  function queueChatSkinPreferences(", "\n  const loadComposerHint =");
const mountedSource = sourceBetween("    componentMountedRef.current = true;", "\n  }, [");
const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333";
const COMPANION_B = "44444444-4444-4444-8444-444444444444";
const edited = normalizeChatSkinPreferences({ skin: "taotao-cream", reduceMotion: true, ornamentActivity: "quiet", dynamicComposerHint: false });
const serverPreferences = normalizeChatSkinPreferences({ skin: "classic-glass", reduceMotion: false });
async function tick() { for (let index = 0; index < 30; index++) await Promise.resolve(); }

async function harness() {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const sessionFor = id => ({ access_token: `synthetic-${id}`, user: { id, email: "synthetic@example.test" } });
  let session = sessionFor(ACCOUNT_A), authListener;
  const signOuts = [];
  const manager = createAuthSessionManager({
    supabaseUrl: "https://synthetic.example.test", supabaseAnonKey: "synthetic-public-placeholder", storage,
    createClientFn: () => ({ auth: {
      onAuthStateChange(listener) { authListener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
      async getSession() { return { data: { session }, error: null }; },
      async signOut(options) { signOuts.push(options); session = null; authListener("SIGNED_OUT", null); return { error: null }; },
    } }),
  });
  await manager.initialize(); manager.setActiveCompanionId(COMPANION_A);
  const descriptors = Object.fromEntries(["window", "fetch"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const timers = new Map(), requests = [];
  let timerId = 0, writes = 0, preferences = serverPreferences;
  const window = {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: (url, options) => new Promise(resolve => {
    requests.push({ path: new URL(url).pathname, options,
      resolve(status = 200, data = {}, companion = COMPANION_A) {
        resolve(new Response(JSON.stringify(data), { status, headers: { "X-DengTa-Companion-Id": companion } }));
      },
    });
  }) });
  const context = {
    apiRequest: (path, options = {}) => apiRequest(path, { ...options, authSession: options.authSession || manager }),
    authSession: manager, privateMediaScope: settingsSaveScope(manager.getSnapshot()), accountStorageScope: ACCOUNT_A,
    AbortController, createScopedSettingsSession,
    STARTUP_REQUEST_OPTIONS: { retry: false },
    chatSkinPreferencesApiPayload, normalizeChatSkinPreferences, writeStoredChatSkinPreferences,
    localStorage: storage, window, useCallback: callback => callback,
    registerSettingsSaveGuard: () => () => {},
    canLeaveWorkspace: () => true,
    setSettingsExitBusy() {}, abortChatRequest() {}, releaseChatRequestAttachments() {},
    releasePendingScreenGlanceTurn() {}, revokeAttachmentDraft() {},
    setChatSkinPreferences(next) { writes++; preferences = typeof next === "function" ? next(preferences) : next; },
  };
  for (const name of new Set((preferencesSource + mountedSource).match(/\b\w+Ref\b/g))) context[name] = { current: null };
  Object.assign(context, {
    componentMountedRef: { current: true }, hasLoadedSettingsRef: { current: true }, chatAttachmentsRef: { current: [] },
    chatSkinPreferencesRef: { current: preferences }, chatSkinSaveRunRef: { current: Promise.resolve() },
    chatSkinEditRevisionRef: { current: 0 }, flushLatestSettingsDraftRef: { current: () => Promise.resolve(true) },
  });
  vm.createContext(context);
  vm.runInContext(`${preferencesSource}\nglobalThis.subject={updateChatSkinPreferences,loadChatSkinPreferences};`, context);
  const cleanup = vm.runInContext(`(() => { ${mountedSource} })()`, context);
  let disposed = false;
  return {
    context, requests, timers, values, manager, signOuts,
    get preferences() { return preferences; }, get writes() { return writes; },
    update(patch) { context.subject.updateChatSkinPreferences(patch); },
    load() { return context.subject.loadChatSkinPreferences(); },
    stored(account = ACCOUNT_A) { return readStoredChatSkinPreferences(storage, account); },
    async fireSaveTimer() {
      for (const [id, timer] of [...timers]) if (timer.delay === 260) { timers.delete(id); timer.callback(); }
      await tick();
    },
    switchAccount() { session = sessionFor(ACCOUNT_B); authListener("SIGNED_IN", session); manager.setActiveCompanionId(COMPANION_B); },
    switchCompanion() { manager.setActiveCompanionId(COMPANION_B); },
    dispose() { if (!disposed) { disposed = true; cleanup(); } },
    finish() {
      this.dispose(); manager.destroy();
      for (const [name, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
      }
    },
  };
}

test("actual App cleanup cancels the pending skin save timer before the next account can receive it", async () => {
  const subject = await harness();
  try {
    subject.update(edited); assert.equal(subject.timers.size, 1);
    subject.dispose(); subject.switchAccount(); await subject.fireSaveTimer();
    assert.equal(subject.requests.length, 0, "old timer must not issue a PUT with current account credentials");
    assert.equal(subject.context.chatSkinSaveTimerRef.current, null);
  } finally { subject.finish(); }
});

test("an already queued skin save is cancelled after the current PUT unblocks during an account switch", async () => {
  const subject = await harness();
  try {
    subject.update({ reduceMotion: true }); await subject.fireSaveTimer();
    assert.equal(subject.requests.length, 1);
    subject.update(edited); await subject.fireSaveTimer();
    assert.equal(subject.requests.length, 1, "the second write waits for the current write");
    subject.dispose(); subject.switchAccount(); subject.requests[0].resolve(200, {}); await tick();
    assert.equal(subject.requests.length, 1, "the queued old payload cannot start in the new account");
    assert.equal(subject.requests[0].options.headers.get("X-DengTa-Companion-Id"), COMPANION_A);
    assert.equal(subject.signOuts.length, 0);
    assert.equal(subject.manager.getSnapshot().user.id, ACCOUNT_B);
  } finally { subject.finish(); }
});

test("a late startup preference read preserves a newer local selection and its account storage", async () => {
  const subject = await harness();
  try {
    const pending = subject.load(); await tick(); subject.update(edited);
    subject.requests[0].resolve(200, { preferences: chatSkinPreferencesApiPayload(serverPreferences) }); await pending;
    assert.deepEqual(subject.preferences, edited);
    assert.deepEqual(subject.context.chatSkinPreferencesRef.current, edited);
    assert.deepEqual(subject.stored(), edited);
  } finally { subject.finish(); }
});

test("a read completing after actual App cleanup cannot write local storage or React state", async () => {
  const subject = await harness();
  try {
    const pending = subject.load(); await tick();
    const before = [...subject.values], writes = subject.writes;
    subject.dispose(); subject.requests[0].resolve(200, { preferences: chatSkinPreferencesApiPayload(edited) }); await pending;
    assert.deepEqual([...subject.values], before);
    assert.equal(subject.writes, writes);
    assert.deepEqual(subject.context.chatSkinPreferencesRef.current, serverPreferences);
  } finally { subject.finish(); }
});

for (const switchKind of ["account", "companion"]) {
  test(`an old skin read's 401 cannot invalidate the current session after a ${switchKind} switch`, async () => {
    const subject = await harness();
    try {
      const pending = subject.load(); await tick();
      switchKind === "account" ? subject.switchAccount() : subject.switchCompanion();
      subject.requests[0].resolve(401, { code: "invalid_session", message: "synthetic expired session" }, COMPANION_A); await pending;
      assert.equal(subject.signOuts.length, 0, "the scope wrapper ignores invalidation from an old response");
      assert.equal(subject.manager.getSnapshot().status, AUTH_STATUS.authenticated);
      assert.equal(subject.manager.getSnapshot().user.id, switchKind === "account" ? ACCOUNT_B : ACCOUNT_A);
      assert.equal(subject.manager.getSnapshot().activeCompanionId, COMPANION_B);
      assert.equal(subject.requests.length, 1, "401 must not trigger an automatic write or retry");
    } finally { subject.finish(); }
  });
}

test("ordinary same-scope load and debounced save retain the existing API payload contract", async () => {
  const subject = await harness();
  try {
    const pending = subject.load(); await tick();
    subject.requests[0].resolve(200, { preferences: chatSkinPreferencesApiPayload(edited) }); await pending;
    assert.deepEqual(subject.preferences, edited); assert.deepEqual(subject.stored(), edited);
    subject.update({ reduceMotion: false }); await subject.fireSaveTimer();
    assert.equal(subject.requests.length, 2);
    assert.equal(subject.requests[1].options.method, "PUT");
    assert.deepEqual(JSON.parse(subject.requests[1].options.body), chatSkinPreferencesApiPayload({ ...edited, reduceMotion: false }));
    assert.equal(subject.requests[1].options.headers.get("X-DengTa-Companion-Id"), COMPANION_A);
    subject.requests[1].resolve(200, {}); await tick();
    assert.equal(subject.signOuts.length, 0);
  } finally { subject.finish(); }
});
