import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { env } from "node:process";
import { apiRequest } from "../src/api.js";
import { AUTH_STATUS, createAuthSessionManager } from "../src/auth-session.js";
import { chooseChatModel, reconcileModelCatalog } from "../src/chat-models.js";
import { emptySettings, normalizeSettingsDraft, settingsPayloadFingerprint } from "../src/settings.js";
import { createScopedSettingsSession, settingsSaveScope } from "../src/settings-save-scope.js";
import { createStartupReconnectController, STARTUP_REQUEST_OPTIONS, mergeRecoveredStartupData } from "../src/startup-reconnect.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333";
const COMPANION_B = "44444444-4444-4444-8444-444444444444";
const app = fs.readFileSync(env.DENGTA_STARTUP_APP_SOURCE || new URL("../src/App.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const anchor = app.indexOf("    voiceOutputStatusRef.current = null;");
const effectStart = app.lastIndexOf("  useEffect(() => {", anchor) + "  useEffect(() => {".length;
const effectBody = app.slice(effectStart, app.indexOf("\n  }, [", anchor));
assert.ok(anchor >= 0 && effectBody.includes("async function loadInitialData("), "extract the actual startup effect");

async function tick() {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

async function startupHarness({ initialCompanion = COMPANION_A } = {}) {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const sessionFor = account => ({ access_token: `synthetic-${account}`, user: { id: account, email: "synthetic@example.test" } });
  let session = sessionFor(ACCOUNT_A);
  let authListener;
  const signOuts = [];
  const client = {
    auth: {
      onAuthStateChange(listener) {
        authListener = listener;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async getSession() { return { data: { session }, error: null }; },
      async signOut(options) {
        signOuts.push(options);
        session = null;
        authListener?.("SIGNED_OUT", null);
        return { error: null };
      },
    },
  };
  const manager = createAuthSessionManager({
    supabaseUrl: "https://synthetic.example.test",
    supabaseAnonKey: "synthetic-public-placeholder",
    storage,
    createClientFn: () => client,
  });
  await manager.initialize();
  if (initialCompanion) manager.setActiveCompanionId(initialCompanion);

  const requests = [];
  const ui = [];
  const timers = new Map();
  const events = new Map();
  const descriptors = Object.fromEntries(["window", "document", "fetch"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let timerId = 0;
  const window = {
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, callback) { events.set(name, callback); },
    removeEventListener(name, callback) { if (events.get(name) === callback) events.delete(name); },
  };
  const document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (url, options) => new Promise((resolve, reject) => {
      const request = {
        path: new URL(url).pathname,
        companion: options.headers.get("X-DengTa-Companion-Id"),
        signal: options.signal,
        resolve(status, data, companion = COMPANION_A) {
          resolve(new Response(JSON.stringify(data), { status, headers: companion ? { "X-DengTa-Companion-Id": companion } : {} }));
        },
      };
      requests.push(request);
      options.signal?.addEventListener("abort", () => reject(new DOMException("synthetic cancellation", "AbortError")), { once: true });
    }),
  });
  const context = {
    apiRequest: (path, options = {}) => apiRequest(path, { ...options, authSession: options.authSession || manager }),
    authSession: manager,
    privateMediaScope: settingsSaveScope(manager.getSnapshot()),
    privateMediaScopeRef: { current: settingsSaveScope(manager.getSnapshot()) },
    AbortController,
    Error,
    STARTUP_REQUEST_OPTIONS,
    createScopedSettingsSession,
    createStartupReconnectController,
    normalizeSettingsDraft,
    settingsPayloadFingerprint,
    emptySettings,
    chooseChatModel,
    reconcileModelCatalog,
    mergeRecoveredStartupData,
    accountStorageScope: ACCOUNT_A,
    visualPreview: false,
    localStorage: storage,
    window,
    applyPersonaResetToLocalStorage: () => false,
    normalizeCompanionStatus: value => value,
    normalizeCompanionInteractionStats: value => value,
    readCompanionStatus: () => ({}),
    readCompanionInteractionStats: () => ({}),
    readStoredSessionChatModel: () => null,
    readServerSessionChatModel: () => null,
    storeSessionChatModel() {},
    migrateLegacyChatModelToSession() {},
    refreshServiceHealth() {},
    refreshVoiceOutputStatus() {},
    loadChatSkinPreferences() {},
  };
  for (const name of new Set(effectBody.match(/\b\w+Ref\b/g))) if (!(name in context)) context[name] = { current: null };
  Object.assign(context, {
    settingsWriteRevisionRef: { current: 0 },
    componentMountedRef: { current: true },
    hasLoadedSettingsRef: { current: false },
    confirmedSettingsRef: { current: normalizeSettingsDraft({ model: "synthetic-model" }) },
  });
  for (const name of new Set(effectBody.match(/\bset[A-Z]\w+/g))) if (!context[name]) context[name] = value => ui.push({ name, value });
  vm.createContext(context);
  const cleanup = vm.runInContext(`(() => { ${effectBody.replace("    const reconnectController =", "    globalThis.subject = { loadInitialData, loadInitialModels };\n    const reconnectController =")} })()`, context);
  const controller = context.startupReconnectRef.current;
  const initialRun = controller.start();
  let disposed = false;
  return {
    context, controller, initialRun, requests, ui, manager, signOuts, values, timers,
    async ready() { await tick(); assert.equal(requests[0]?.path, "/api/v2/bootstrap"); },
    switchCompanion() { manager.setActiveCompanionId(COMPANION_B); },
    switchAccount() { session = sessionFor(ACCOUNT_B); authListener("SIGNED_IN", session); manager.setActiveCompanionId(COMPANION_B); },
    dispose() { if (!disposed) { disposed = true; cleanup(); } },
    finish() {
      this.dispose();
      manager.destroy();
      for (const [name, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

const bootstrapData = { settings: { model: "synthetic-model", unified_system_prompt: "  synthetic instructions\r\n", user_details: "  synthetic details\n" }, sessions: [], state: {} };

test("manual replacement aborts the actual bootstrap request and only the fresh receipt updates settings", async () => {
  const h = await startupHarness();
  try {
    await h.ready();
    const previous = h.requests[0];
    const replacement = h.controller.retryNow("manual", { replaceInFlight: true });
    await tick();
    assert.equal(previous.signal.aborted, true);
    assert.equal(h.requests.length, 2);
    previous.resolve(200, { ...bootstrapData, settings: { model: "stale" } });
    h.requests[1].resolve(200, bootstrapData);
    await replacement;
    const settings = h.ui.filter(value => value.name === "setSettings");
    assert.equal(settings.length, 1);
    assert.equal(settings[0].value.model, "synthetic-model");
    assert.equal(settings[0].value.unified_system_prompt, bootstrapData.settings.unified_system_prompt);
    assert.equal(h.controller.getState().status, "connected");
  } finally { h.finish(); }
});

test("an empty successful bootstrap receipt leaves saved settings intact and offers retry", async () => {
  const h = await startupHarness();
  try {
    await h.ready();
    const saved = h.context.confirmedSettingsRef.current;
    h.requests[0].resolve(200, {});
    await h.initialRun;
    assert.equal(h.context.confirmedSettingsRef.current, saved);
    assert.equal(h.ui.some(value => value.name === "setSettings"), false);
    assert.equal(h.controller.getState().status, "waiting");
    assert.equal(h.controller.getState().lastError.code, "startup_receipt_invalid");
  } finally { h.finish(); }
});

test("malformed session records are rejected before applying settings or any local reset", async () => {
  const h = await startupHarness();
  try {
    await h.ready(); let resets = 0;
    h.context.applyPersonaResetToLocalStorage = () => { resets++; return true; };
    h.requests[0].resolve(200, { ...bootstrapData, sessions: [null] });
    await h.initialRun;
    assert.equal(resets, 0);
    assert.equal(h.ui.some(value => value.name === "setSettings" || value.name === "setMessages"), false);
    assert.equal(h.controller.getState().lastError.code, "startup_receipt_invalid");
  } finally { h.finish(); }
});

for (const switchKind of ["companion", "account"]) {
  test(`late bootstrap success cannot restore the old companion after a ${switchKind} change`, async () => {
    const h = await startupHarness();
    try {
      await h.ready();
      const oldRequest = h.requests[0];
      assert.equal(oldRequest.companion, COMPANION_A);
      h.dispose();
      if (switchKind === "account") h.switchAccount();
      else h.switchCompanion();
      const stateCount = h.ui.length;
      oldRequest.resolve(200, bootstrapData);
      await h.initialRun;
      assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B);
      assert.equal(h.manager.getSnapshot().user?.id, switchKind === "account" ? ACCOUNT_B : ACCOUNT_A);
      assert.equal(oldRequest.signal?.aborted, true);
      assert.equal(h.ui.length, stateCount);
      assert.equal(h.requests.length, 1);
      assert.equal(await h.controller.retryNow("disposed"), null);
      assert.equal([...h.values].some(([key, value]) => key.includes(ACCOUNT_B) && value === COMPANION_A), false);
    } finally { h.finish(); }
  });
}

for (const route of ["bootstrap", "models"]) {
  for (const status of route === "models" ? [200, 401] : [401]) {
    for (const switchKind of ["companion", "account"]) {
    test(`late ${route} ${status} never changes the current login state after a ${switchKind} change`, async () => {
      const h = await startupHarness();
      try {
        await h.ready();
        let oldRequest = h.requests[0];
        if (route === "models") {
          oldRequest.resolve(200, bootstrapData);
          await h.initialRun;
          await tick();
          oldRequest = h.requests.find(request => request.path === "/models");
          assert.ok(oldRequest);
        }
        h.dispose();
        if (switchKind === "account") h.switchAccount();
        else h.switchCompanion();
        const stateCount = h.ui.length;
        oldRequest.resolve(status, status === 401 ? { code: "invalid_session" } : { models: [{ id: "synthetic-late-model" }] });
        if (route === "bootstrap") await h.initialRun;
        await tick();
        assert.equal(h.manager.getSnapshot().user?.id, switchKind === "account" ? ACCOUNT_B : ACCOUNT_A);
        assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B);
        assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated);
        assert.equal(h.signOuts.length, 0);
        assert.equal(oldRequest.signal?.aborted, true);
        assert.equal(h.ui.length, stateCount);
        assert.equal([...h.values].some(([key, value]) => key.includes(ACCOUNT_B) && value === COMPANION_A), false);
      } finally { h.finish(); }
    });
    }
  }
}

test("cleanup before the startup attempt is dispatched prevents a request in the next account", async () => {
  const h = await startupHarness();
  try {
    h.dispose();
    h.switchAccount();
    await tick();
    for (const request of h.requests) request.resolve(200, bootstrapData);
    await h.initialRun;
    assert.equal(h.requests.length, 0);
    assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B);
  } finally { h.finish(); }
});

test("the current startup scope can discover its first companion normally", async () => {
  const h = await startupHarness({ initialCompanion: "" });
  try {
    await h.ready();
    assert.equal(h.requests[0].companion, null);
    h.requests[0].resolve(200, bootstrapData);
    await h.initialRun;
    await tick();
    for (const request of h.requests.filter(item => item.path === "/models")) request.resolve(200, { models: [{ id: "synthetic-model" }] });
    await tick();
    assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_A);
    assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated);
    assert.equal(h.signOuts.length, 0);
  } finally { h.finish(); }
});

test("a current-scope failed bootstrap retries and restores exact synthetic settings", async () => {
  const h = await startupHarness();
  try {
    await h.ready();
    h.requests[0].resolve(503, { code: "synthetic_backend_unavailable" });
    await h.initialRun;
    assert.equal(h.controller.getState().status, "waiting");
    const retry = h.controller.retryNow("manual");
    await tick();
    assert.equal(h.requests[1].companion, COMPANION_A);
    h.requests[1].resolve(200, bootstrapData);
    await retry;
    await tick();
    for (const request of h.requests.filter(item => item.path === "/models")) request.resolve(200, { models: [{ id: "synthetic-model" }] });
    await tick();
    assert.equal(h.context.draftSettingsRef.current.unified_system_prompt, bootstrapData.settings.unified_system_prompt);
    assert.equal(h.context.draftSettingsRef.current.user_details, bootstrapData.settings.user_details);
    assert.equal(h.context.hasLoadedSettingsRef.current, true);
    assert.equal(h.controller.getState().status, "connected");
    assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_A);
  } finally { h.finish(); }
});

test("stopped reconnect controllers ignore a late successful attempt", async () => {
  let resolveAttempt;
  const pending = new Promise(resolve => { resolveAttempt = resolve; });
  const states = [];
  const controller = createStartupReconnectController({
    attempt: () => pending,
    onStateChange: state => states.push(state.status),
    windowTarget: { addEventListener() {}, removeEventListener() {} },
    documentTarget: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
  });
  const run = controller.start();
  await tick();
  controller.stop();
  const stateBeforeReceipt = controller.getState().status;
  const stateCount = states.length;
  resolveAttempt({ settings: {} });
  assert.equal(await run, null);
  assert.equal(controller.getState().status, stateBeforeReceipt);
  assert.notEqual(controller.getState().status, "connected");
  assert.equal(states.length, stateCount);
  assert.equal(await controller.retryNow("disposed"), null);
});
