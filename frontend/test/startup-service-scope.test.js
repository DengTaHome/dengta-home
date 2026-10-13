import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { env } from "node:process";
import { test } from "node:test";
import { apiFetch, apiRequest } from "../src/api.js";
import { AUTH_STATUS, createAuthSessionManager } from "../src/auth-session.js";
import { createScopedSettingsSession, settingsSaveScope } from "../src/settings-save-scope.js";
import { normalizeVoiceOutput } from "../src/voice-output.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333";
const COMPANION_B = "44444444-4444-4444-8444-444444444444";
const app = fs.readFileSync(env.DENGTA_STARTUP_SERVICE_APP_SOURCE || new URL("../src/App.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const voice = fs.readFileSync(new URL("../src/voice-output.js", import.meta.url), "utf8");
const voiceReadFunctions = voice.slice(voice.indexOf("async function voiceOutputResponse("), voice.indexOf("export function voiceOutputPayload(")).replaceAll("export ", "");
function callback(name) {
  const declaration = `const ${name} = useCallback(`;
  const start = app.indexOf(declaration) + declaration.length;
  const end = app.indexOf("\n  }, [", start) + 4;
  assert.ok(start >= declaration.length && end > start, `extract the actual ${name} callback`);
  return app.slice(start, end);
}
const serviceCallbacks = `globalThis.refreshVoiceOutputStatus = (${callback("refreshVoiceOutputStatus")});\nglobalThis.refreshServiceHealth = (${callback("refreshServiceHealth")});`;

async function tick() {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

async function serviceHarness() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  const sessionFor = account => ({ access_token: `synthetic-${account}`, user: { id: account, email: "synthetic@example.test" } });
  let session = sessionFor(ACCOUNT_A);
  let authListener;
  let signOutCount = 0;
  const client = { auth: {
    onAuthStateChange(listener) { authListener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session }, error: null }; },
    async signOut() { signOutCount += 1; session = null; authListener?.("SIGNED_OUT", null); return { error: null }; },
  } };
  const manager = createAuthSessionManager({ supabaseUrl: "https://synthetic.example.test", supabaseAnonKey: "synthetic-public-placeholder", storage, createClientFn: () => client });
  await manager.initialize();
  manager.setActiveCompanionId(COMPANION_A);
  const descriptors = Object.fromEntries(["window", "fetch"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const requests = [];
  const ui = [];
  const timers = new Map();
  let timerId = 0;
  const window = {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: (url, options) => new Promise((resolve, reject) => {
    const request = {
      path: new URL(url).pathname,
      companion: options.headers.get("X-DengTa-Companion-Id"),
      accept: options.headers.get("Accept"),
      signal: options.signal,
      resolve(status, data, companion = COMPANION_A) { resolve(new Response(JSON.stringify(data), { status, headers: companion ? { "X-DengTa-Companion-Id": companion } : {} })); },
    };
    requests.push(request);
    options.signal?.addEventListener("abort", () => reject(new DOMException("synthetic cancellation", "AbortError")), { once: true });
  }) });
  const controller = new AbortController();
  const context = {
    authSession: manager,
    privateMediaScope: settingsSaveScope(manager.getSnapshot()),
    componentMountedRef: { current: true },
    settingsScopeControllerRef: { current: controller },
    voiceOutputStatusRef: { current: null },
    createScopedSettingsSession,
    normalizeVoiceOutput,
    apiFetch: (path, options = {}) => apiFetch(path, { ...options, authSession: options.authSession || manager }),
    apiRequest: (path, options = {}) => apiRequest(path, { ...options, authSession: options.authSession || manager }),
    setVoiceService: value => ui.push({ name: "voiceService", value }),
    setServiceHealth: value => ui.push({ name: "serviceHealth", value }),
    applyVoiceOutputStatus: value => ui.push({ name: "voiceOutput", value }),
  };
  vm.createContext(context);
  vm.runInContext(`${voiceReadFunctions}\n${serviceCallbacks}`, context);
  return {
    context, manager, requests, ui, timers,
    dispose() { context.componentMountedRef.current = false; controller.abort(); },
    switchCompanion() { manager.setActiveCompanionId(COMPANION_B); },
    switchAccount() { session = sessionFor(ACCOUNT_B); authListener("SIGNED_IN", session); manager.setActiveCompanionId(COMPANION_B); },
    signOutCount: () => signOutCount,
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

for (const route of ["status", "fallback"]) {
  for (const status of [200, 401]) {
    test(`late voice ${route} ${status} cannot mutate the next account`, async () => {
      const h = await serviceHarness();
      try {
        const run = h.context.refreshVoiceOutputStatus();
        await tick();
        assert.equal(h.requests[0]?.path, "/api/v2/voice-output/status");
        assert.equal(h.requests[0].companion, COMPANION_A);
        let request = h.requests[0];
        if (route === "fallback") {
          request.resolve(404, {});
          await tick();
          request = h.requests[1];
          assert.equal(request?.path, "/api/v2/voice-output");
          assert.equal(request.companion, COMPANION_A);
          assert.equal(request.accept, "application/json");
        }
        h.dispose();
        h.switchAccount();
        const stateCount = h.ui.length;
        request.resolve(status, status === 401 ? { code: "invalid_session" } : { configured: true });
        await run;
        assert.equal(h.manager.getSnapshot().user?.id, ACCOUNT_B);
        assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B);
        assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated);
        assert.equal(h.signOutCount(), 0);
        assert.equal(request.signal?.aborted, true);
        assert.equal(h.ui.length, stateCount);
        assert.equal(h.timers.size, 0);
      } finally { h.finish(); }
    });
  }
}

test("current voice 404 fallback preserves scoped context and applies its successful result", async () => {
  const h = await serviceHarness();
  try {
    const run = h.context.refreshVoiceOutputStatus();
    await tick();
    h.requests[0].resolve(404, {});
    await tick();
    assert.equal(h.requests[1]?.path, "/api/v2/voice-output");
    assert.equal(h.requests[1].companion, COMPANION_A);
    h.requests[1].resolve(200, { voice_output: { model: "synthetic-voice", enabled: true } });
    await run;
    assert.equal(h.ui.find(change => change.name === "voiceOutput")?.value.model, "synthetic-voice");
    assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_A);
  } finally { h.finish(); }
});

for (const switchKind of ["companion", "account"]) {
  test(`late voice warmup 401 cannot invalidate the current ${switchKind} scope`, async () => {
    const h = await serviceHarness();
    try {
      const run = h.context.refreshServiceHealth();
      await tick();
      assert.equal(h.requests[0]?.path, "/health");
      h.requests[0].resolve(200, { features: { hervoice_proxy_configured: true } }, "");
      await run;
      await tick();
      const warmup = h.requests.find(request => request.path === "/voice/warmup");
      assert.ok(warmup);
      h.dispose();
      if (switchKind === "account") h.switchAccount();
      else h.switchCompanion();
      const stateCount = h.ui.length;
      warmup.resolve(401, { code: "invalid_session" });
      await tick();
      assert.equal(h.manager.getSnapshot().user?.id, switchKind === "account" ? ACCOUNT_B : ACCOUNT_A);
      assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B);
      assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated);
      assert.equal(h.signOutCount(), 0);
      assert.equal(warmup.signal?.aborted, true);
      assert.equal(h.ui.length, stateCount);
      assert.equal(h.timers.size, 0);
    } finally { h.finish(); }
  });
}

test("a disposed health result never starts voice warmup or updates the discarded page", async () => {
  const h = await serviceHarness();
  try {
    const run = h.context.refreshServiceHealth();
    await tick();
    h.dispose();
    h.switchAccount();
    const stateCount = h.ui.length;
    h.requests[0].resolve(200, { features: { hervoice_proxy_configured: true } }, "");
    await run;
    assert.equal(h.requests.length, 1);
    assert.equal(h.ui.length, stateCount);
    assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B);
  } finally { h.finish(); }
});

for (const unavailable of ["unmounted", "missing controller", "aborted controller"]) {
  test(`service refresh callbacks return before reading or publishing when ${unavailable}`, async () => {
    const h = await serviceHarness();
    try {
      if (unavailable === "unmounted") h.context.componentMountedRef.current = false;
      else if (unavailable === "missing controller") h.context.settingsScopeControllerRef.current = null;
      else h.context.settingsScopeControllerRef.current.abort();
      const voice = h.context.refreshVoiceOutputStatus();
      const health = h.context.refreshServiceHealth();
      await tick();
      for (const request of h.requests) request.resolve(200, { features: {} }, "");
      await Promise.all([voice, health]);
      assert.equal(h.requests.length, 0);
      assert.equal(h.ui.length, 0);
    } finally { h.finish(); }
  });
}
