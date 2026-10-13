import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import {
  createSettingsPayload,
  normalizeSettingsDraft,
  settingsPayloadFingerprint,
} from "../src/settings.js";
import { pendingAutosaveAfterFailure } from "../src/settings-autosave.js";
import {
  createScopedSettingsSession,
  flushSettingsBeforeAccountExit,
  registerSettingsSaveGuard,
  releaseSettingsAccountExit,
  settingsSaveScope,
} from "../src/settings-save-scope.js";
import { chooseChatModel, reconcileModelCatalog } from "../src/chat-models.js";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const authGate = fs.readFileSync(new URL("../src/AuthGate.jsx", import.meta.url), "utf8");
const accountExitStart = authGate.indexOf("  async function signOut()", authGate.indexOf("export function AccountMenu"));
const accountExitCode = authGate.slice(accountExitStart, authGate.indexOf("\n  return (", accountExitStart));
assert.ok(accountExitStart >= 0 && accountExitCode.includes("flushSettingsBeforeAccountExit"));
const saveFunctions = app.slice(
  app.indexOf("  function scheduleSettingsAutosave("),
  app.indexOf("  async function setDeviceActivityEnabled("),
);
const bootstrapFunction = app.slice(
  app.indexOf("    async function loadInitialData() {"),
  app.indexOf("    const reconnectController ="),
);
const unifiedPromptFunction = app.slice(
  app.indexOf("  function updateUnifiedPrompt("),
  app.indexOf("  function updateTurnContext("),
);
const mountedEffectStart = app.indexOf("    componentMountedRef.current = true;");
const mountedEffect = app.slice(mountedEffectStart, app.indexOf("  }, [", mountedEffectStart));
const extractedFunctions = saveFunctions + bootstrapFunction + unifiedPromptFunction + mountedEffect;

const tick = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

function harness() {
  let sequence = 0;
  let authScope = "account-a/companion-a";
  const timers = new Map();
  const requests = [];
  const stateChanges = [];
  const ui = {};
  const work = { payloads: 0, fingerprints: 0 };
  const initialSettings = normalizeSettingsDraft({
    model: "synthetic-model",
    unified_system_prompt: "  synthetic original instructions\r\n",
    user_details: "  synthetic original details\n",
  });
  const context = {
    createSettingsPayload(value) { work.payloads += 1; return createSettingsPayload(value); },
    normalizeSettingsDraft,
    settingsPayloadFingerprint(value) { work.fingerprints += 1; return settingsPayloadFingerprint(value); },
    pendingAutosaveAfterFailure,
    createScopedSettingsSession,
    registerSettingsSaveGuard,
    canLeaveWorkspace: () => true,
    chooseChatModel,
    reconcileModelCatalog,
    readStoredSessionChatModel: () => null,
    AbortController,
    TextEncoder,
    navigator: { onLine: true },
    localStorage: {},
    cancelled: false,
    accountStorageScope: "account-a",
    companionScope: "companion-a",
    privateMediaScope: JSON.stringify(["account-a", "companion-a"]),
    authSession: {
      getSnapshot() {
        const [account, companion] = authScope.split("/");
        return { user: { id: account }, activeCompanionId: companion };
      },
      async getRequestContext() { return { companionId: authScope.split("/")[1] }; },
    },
    STARTUP_REQUEST_OPTIONS: {},
    startupRequestOptions: {},
    SETTINGS_SAVE_RETRY_DELAYS_MS: [1200, 3500, 8000],
    window: {
      setTimeout(callback, delay) {
        const id = ++sequence;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) { timers.delete(id); },
    },
    applyPersonaResetToLocalStorage: () => false,
    normalizeCompanionStatus: value => value,
    normalizeCompanionInteractionStats: value => value,
    readCompanionStatus: () => ({}),
    readCompanionInteractionStats: () => ({}),
    mergeRecoveredStartupData: (current, recovered) => ({ ...current, ...recovered, activeSessionId: null }),
    readServerSessionChatModel: () => null,
    migrateLegacyChatModelToSession: () => {},
    storeSessionChatModel: () => {},
    loadInitialModels: async () => {},
    refreshServiceHealth: async () => {},
    refreshVoiceOutputStatus: async () => {},
    loadChatSkinPreferences: async () => {},
    abortChatRequest: () => {},
    releaseChatRequestAttachments: () => {},
    releasePendingScreenGlanceTurn: () => {},
    revokeAttachmentDraft: () => {},
    apiRequest(path, options = {}) {
      return new Promise((resolve, reject) => {
        const request = {
          path,
          scope: authScope,
          options,
          payload: options.body ? JSON.parse(options.body) : null,
          resolve,
          resolveSettings(settings = request.payload) { resolve({ settings: normalizeSettingsDraft(settings) }); },
          resolveBootstrap(settings = initialSettings) {
            resolve({ settings, sessions: [], state: { status: {}, interaction_stats: {} } });
          },
          reject,
        };
        requests.push(request);
        options.signal?.addEventListener("abort", () => reject(new DOMException("synthetic abort", "AbortError")), { once: true });
      });
    },
  };
  for (const name of new Set(extractedFunctions.match(/\b\w+Ref\b/g))) {
    context[name] = { current: null };
  }
  Object.assign(context, {
    draftSettingsRef: { current: initialSettings },
    confirmedSettingsRef: { current: initialSettings },
    hasLoadedSettingsRef: { current: true },
    latestDraftFingerprintRef: { current: settingsPayloadFingerprint(initialSettings) },
    lastSavedSettingsFingerprintRef: { current: settingsPayloadFingerprint(initialSettings) },
    settingsSaveRetryCountRef: { current: 0 },
    settingsSaveFailureRef: { current: false },
    settingsSaveInFlightRef: { current: false },
    settingsWriteRevisionRef: { current: 0 },
    settingsExitBusyRef: { current: false },
    chatAttachmentsRef: { current: [] },
  });
  for (const name of new Set(extractedFunctions.match(/\bset[A-Z]\w+/g))) {
    if (!context[name]) context[name] = value => {
      ui[name] = value;
      stateChanges.push({ name, value });
    };
  }
  vm.createContext(context);
  vm.runInContext(`${saveFunctions}\n${bootstrapFunction}\n${unifiedPromptFunction}\nglobalThis.subject = { updateDraft, updateUnifiedPrompt, loadInitialData, flushSettingsSaveQueue, flushLatestSettingsDraft };`, context);
  const unmount = vm.runInContext(`(() => { ${mountedEffect} })()`, context);

  return {
    context, subject: context.subject, initialSettings, requests, timers, ui, stateChanges, work,
    writes: () => requests.filter(request => request.path === "/api/v2/settings"),
    setAuthScope(value) { authScope = value; },
    unmount,
    runTimer(delay) {
      const timer = [...timers.entries()].find(([, item]) => item.delay === delay);
      if (!timer) return false;
      timers.delete(timer[0]);
      timer[1].callback();
      return true;
    },
  };
}

function accountExit(h) {
  const state = { signedOut: 0, feedback: "", busy: false };
  const context = {
    exiting: { current: false }, alive: { current: true }, snapshot: h.context.authSession.getSnapshot(),
    sessionManager: { getSnapshot: h.context.authSession.getSnapshot, signOut: async () => { state.signedOut++; } },
    settingsSaveScope, flushSettingsBeforeAccountExit, releaseSettingsAccountExit,
    setBusy: value => { state.busy = value; }, setFeedback: value => { state.feedback = value; },
  };
  return { state, run: vm.runInNewContext(`${accountExitCode}\nsignOut;`, context) };
}

test("actual account-menu exit retains the workspace when its latest leave guard declines", async () => {
  const h = harness(), calls = [];
  h.context.canLeaveWorkspace = view => { calls.push(view); return false; };
  const exit = accountExit(h);
  try {
    await exit.run(); assert.equal(exit.state.signedOut, 0);
    assert.deepEqual(calls, ["account-exit"]); assert.match(exit.state.feedback, /工作区草稿.*仍保留/);
    assert.equal(exit.state.busy, false); assert.equal(h.context.settingsExitBusyRef.current, false);
    assert.equal(h.context.draftSettingsRef.current.unified_system_prompt, h.initialSettings.unified_system_prompt);
  } finally { h.unmount(); }
});

test("account exit checks the workspace after settings flush so newer drafts remain protected", async () => {
  const h = harness(), calls = []; h.subject.updateDraft("user_details", "  fictional changed settings\n");
  h.context.canLeaveWorkspace = view => { calls.push(view); return false; };
  const exit = accountExit(h);
  try {
    const pending = exit.run(); assert.equal(h.writes().length, 1); assert.equal(calls.length, 0);
    h.writes()[0].resolveSettings(); await pending;
    assert.deepEqual(calls, ["account-exit"]); assert.equal(exit.state.signedOut, 0);
    assert.equal(h.context.settingsExitBusyRef.current, false); assert.match(exit.state.feedback, /退出已取消/);
  } finally { h.unmount(); }
});

test("actual account-menu exit proceeds once when settings and workspace both confirm", async () => {
  const h = harness(), calls = []; h.context.canLeaveWorkspace = view => { calls.push(view); return true; };
  const exit = accountExit(h);
  try {
    await exit.run(); assert.equal(exit.state.signedOut, 1); assert.deepEqual(calls, ["account-exit"]);
    assert.equal(exit.state.feedback, ""); assert.equal(h.context.settingsExitBusyRef.current, false);
  } finally { h.unmount(); }
});

test("main remounts settings state when either account or companion changes", () => {
  const keyExpression = main.match(/<LoadedApp\s+key=\{([^\n]+?)\}/)?.[1];
  assert.ok(keyExpression, "the real App entry must identify its scoped instance");
  const keyFor = (account, companion) => vm.runInNewContext(keyExpression, {
    snapshot: { user: { id: account }, activeCompanionId: companion },
  });
  assert.notEqual(keyFor("account-a", "companion-a"), keyFor("account-a", "companion-b"));
  assert.notEqual(keyFor("account-a", "companion-a"), keyFor("account-b", "companion-a"));
  assert.equal(keyFor("account-a", "companion-a"), keyFor("account-a", "companion-a"));
});

test("typing avoids serializing the whole draft; one debounce serializes the final text once", async () => {
  const h = harness();
  for (let index = 0; index < 12; index += 1) {
    h.subject.updateDraft("user_details", `  synthetic edit ${index}\n`);
  }
  assert.equal(h.work.payloads, 0);
  assert.equal(h.work.fingerprints, 0);
  assert.equal(h.writes().length, 0);
  assert.equal(h.timers.size, 1);
  h.runTimer(800);
  assert.equal(h.work.payloads, 1);
  assert.equal(h.work.fingerprints, 1);
  assert.equal(h.writes()[0].payload.user_details, "  synthetic edit 11\n");
  h.writes()[0].resolveSettings();
  await h.context.settingsSaveRunRef.current;
  h.unmount();
});

test("immediate flush cancels the debounce and saves its latest dirty revision", async () => {
  const h = harness();
  h.subject.updateDraft("user_details", "  synthetic immediate edit\r\n");
  assert.equal(h.work.fingerprints, 0);
  const flush = h.subject.flushLatestSettingsDraft();
  assert.equal(h.timers.size, 0);
  assert.equal(h.writes().length, 1);
  assert.equal(h.writes()[0].payload.user_details, "  synthetic immediate edit\r\n");
  h.writes()[0].resolveSettings();
  assert.equal(await flush, true);
  assert.equal(h.context.draftSettingsRef.current.user_details, "  synthetic immediate edit\r\n");
  h.unmount();
});

test("restoring the saved value cancels a failed draft and its retry", async () => {
  const h = harness();
  h.subject.updateDraft("user_details", "synthetic abandoned failed edit");
  h.runTimer(800);
  const failedRun = h.context.settingsSaveRunRef.current;
  h.writes()[0].reject(new Error("synthetic failed save"));
  await failedRun;
  assert.ok(h.context.pendingSettingsSaveRef.current);
  assert.equal(h.timers.size, 1);
  h.subject.updateDraft("user_details", h.initialSettings.user_details);
  assert.equal(h.context.pendingSettingsSaveRef.current, null);
  assert.equal(h.runTimer(1200), false);
  h.runTimer(800);
  assert.equal(h.writes().length, 1);
  assert.equal(h.ui.setSettingsAutosaveState, "saved");
  assert.equal(h.ui.setSettingsSaveError, "");
  assert.equal(await h.subject.flushLatestSettingsDraft(), true);
  assert.equal(h.writes().length, 1);
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test("a late failure never resurrects a draft restored before the request failed", async () => {
  const h = harness();
  h.subject.updateDraft("user_details", "synthetic abandoned in-flight edit");
  h.runTimer(800);
  const failedRun = h.context.settingsSaveRunRef.current;
  h.subject.updateDraft("user_details", h.initialSettings.user_details);
  h.writes()[0].reject(new Error("synthetic late failure with unknown server outcome"));
  await failedRun;
  assert.equal(h.context.pendingSettingsSaveRef.current, null, "the abandoned payload must not reenter the queue");
  assert.equal(h.runTimer(1200), false);
  assert.notEqual(h.ui.setSettingsAutosaveState, "saved");
  h.runTimer(800);
  assert.equal(h.writes().length, 2, "the latest restored value is reconfirmed after an uncertain failed PUT");
  assert.equal(h.writes()[1].payload.user_details, h.initialSettings.user_details);
  assert.equal(h.ui.setSettingsAutosaveState, "saving");
  h.writes()[1].resolveSettings();
  await h.context.settingsSaveRunRef.current;
  assert.equal(h.context.confirmedSettingsRef.current.user_details, h.initialSettings.user_details);
  assert.equal(h.ui.setSettingsAutosaveState, "saved");
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test("immediate exit flush reconfirms a restored draft after an older uncertain failure", async () => {
  const h = harness();
  h.subject.updateDraft("user_details", "synthetic abandoned in-flight edit");
  h.runTimer(800);
  const failedRun = h.context.settingsSaveRunRef.current;
  h.subject.updateDraft("user_details", h.initialSettings.user_details);
  h.writes()[0].reject(new Error("synthetic late failure with unknown server outcome"));
  await failedRun;
  const flush = h.subject.flushLatestSettingsDraft();
  assert.equal(h.writes().length, 2, "immediate flush cannot authorize exit using a pre-failure receipt");
  assert.equal(h.writes()[1].payload.user_details, h.initialSettings.user_details);
  h.writes()[1].resolveSettings();
  assert.equal(await flush, true);
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test("an account exit guard locks both settings update functions until its caller releases the lock", async () => {
  const h = harness();
  h.subject.updateDraft("user_details", "  synthetic value before exit\n");
  const exit = flushSettingsBeforeAccountExit(h.context.privateMediaScope);
  assert.equal(h.context.settingsExitBusyRef.current, true, "the registered App locks synchronously before awaiting a save");
  assert.equal(h.ui.setSettingsExitBusy, true);
  const draftBefore = h.context.draftSettingsRef.current;
  h.subject.updateDraft("user_details", "synthetic text during exit");
  h.subject.updateUnifiedPrompt("synthetic imported text during exit");
  assert.equal(h.context.draftSettingsRef.current, draftBefore);
  assert.equal(h.writes().length, 1);
  h.writes()[0].resolveSettings();
  assert.equal(await exit, true);
  h.subject.updateDraft("user_details", "synthetic text while logout waits");
  h.subject.updateUnifiedPrompt("synthetic imported text while logout waits");
  assert.equal(h.context.draftSettingsRef.current.user_details, "  synthetic value before exit\n");
  assert.equal(h.context.draftSettingsRef.current.unified_system_prompt, h.initialSettings.unified_system_prompt);
  assert.equal(h.timers.size, 0, "logout waiting cannot start another draft debounce");
  releaseSettingsAccountExit(h.context.privateMediaScope);
  assert.equal(h.context.settingsExitBusyRef.current, false);
  assert.equal(h.ui.setSettingsExitBusy, false);
  h.subject.updateUnifiedPrompt("  synthetic instructions after cancellation\r\n");
  assert.equal(h.context.draftSettingsRef.current.unified_system_prompt, "  synthetic instructions after cancellation\r\n");
  h.unmount();
});

test("failed account-exit saving can release the App lock and preserve further editing", async () => {
  const h = harness();
  h.subject.updateDraft("user_details", "synthetic unsaved exit draft");
  const exit = flushSettingsBeforeAccountExit(h.context.privateMediaScope);
  h.writes()[0].reject(new Error("synthetic save failure"));
  assert.equal(await exit, false);
  assert.equal(h.context.draftSettingsRef.current.user_details, "synthetic unsaved exit draft");
  releaseSettingsAccountExit(h.context.privateMediaScope);
  assert.equal(h.context.settingsExitBusyRef.current, false);
  h.subject.updateDraft("user_details", "  synthetic editable recovery\r\n");
  assert.equal(h.context.draftSettingsRef.current.user_details, "  synthetic editable recovery\r\n");
  assert.equal(h.context.pendingSettingsSaveRef.current, null, "new input cancels the failed exit payload");
  h.unmount();
});

test("new edits and immediate flush remain serialized and preserve the exact latest text", async () => {
  const h = harness();
  h.subject.updateDraft("user_details", "  first version\n");
  h.runTimer(800);
  const first = h.writes()[0];
  h.subject.updateDraft("user_details", "  latest version\r\n\n");
  const flush = h.subject.flushLatestSettingsDraft();
  assert.equal(h.writes().length, 1, "a second PUT waits for the current PUT");
  first.resolveSettings();
  await tick();
  assert.equal(h.writes().length, 2);
  assert.equal(h.context.draftSettingsRef.current.user_details, "  latest version\r\n\n", "older receipt never replaces a newer editor draft");
  h.writes()[1].resolveSettings();
  assert.equal(await flush, true);
  assert.equal(h.context.confirmedSettingsRef.current.user_details, "  latest version\r\n\n");
  assert.equal(h.context.confirmedSettingsRef.current.unified_system_prompt, h.initialSettings.unified_system_prompt);
  assert.equal(h.ui.setSettingsAutosaveState, "saved");
  h.unmount();
});

test("same-scope reconnect preserves dirty editor content and a failed older PUT retries the newer draft", async () => {
  const h = harness();
  h.subject.updateDraft("user_details", "synthetic older edit");
  h.runTimer(800);
  h.subject.updateDraft("user_details", "  synthetic latest edit\n");
  h.runTimer(800);
  const reload = h.subject.loadInitialData();
  h.requests.find(request => request.path === "/api/v2/bootstrap").resolveBootstrap();
  await reload;
  assert.equal(h.context.draftSettingsRef.current.user_details, "  synthetic latest edit\n");
  const failedRun = h.context.settingsSaveRunRef.current;
  h.writes()[0].reject(new Error("synthetic temporary failure"));
  await failedRun;
  assert.equal(h.context.pendingSettingsSaveRef.current.payload.user_details, "  synthetic latest edit\n");
  assert.equal(h.runTimer(1200), true);
  assert.equal(h.writes()[1].payload.user_details, "  synthetic latest edit\n");
  h.writes()[1].resolveSettings();
  await h.context.settingsSaveRunRef.current;
  assert.equal(h.ui.setSettingsAutosaveState, "saved");
  assert.equal(h.ui.setSettingsSaveError, "");
  h.unmount();
});

test("late bootstrap settings never roll back a PUT confirmed after the read started", async () => {
  const h = harness();
  const reload = h.subject.loadInitialData();
  const oldRead = h.requests[0];
  h.subject.updateDraft("user_details", "  synthetic newly saved details\n");
  const flush = h.subject.flushLatestSettingsDraft();
  h.writes()[0].resolveSettings();
  await flush;
  oldRead.resolveBootstrap(h.initialSettings);
  await reload;
  assert.equal(h.context.draftSettingsRef.current.user_details, "  synthetic newly saved details\n");
  assert.equal(h.context.confirmedSettingsRef.current.user_details, "  synthetic newly saved details\n");
  h.subject.updateDraft("ai_name", "synthetic renamed companion");
  h.runTimer(800);
  assert.equal(h.writes()[1].payload.user_details, "  synthetic newly saved details\n", "an unrelated later edit must not resend obsolete private fields");
  h.writes()[1].resolveSettings();
  await h.context.settingsSaveRunRef.current;
  h.unmount();
});

test("unmount cancels pending work and late successful receipts cannot write into the next scope", async () => {
  const h = harness();
  h.subject.updateDraft("user_details", "synthetic first account edit");
  h.runTimer(800);
  const first = h.writes()[0];
  h.subject.updateDraft("user_details", "synthetic newer first account edit");
  h.runTimer(800);
  const run = h.context.settingsSaveRunRef.current;
  h.unmount();
  const stateCount = h.stateChanges.length;
  h.setAuthScope("account-b/companion-b");
  first.resolveSettings();
  await tick();
  for (const unexpected of h.writes().slice(1)) unexpected.resolveSettings();
  await run;
  assert.equal(h.writes().length, 1);
  assert.equal(h.writes().filter(request => request.scope === "account-b/companion-b").length, 0);
  assert.equal(h.stateChanges.length, stateCount, "no settings feedback is published by the disposed App");
  assert.equal(h.context.pendingSettingsSaveRef.current, null);
  assert.equal(h.timers.size, 0);
});

test("late failed requests after unmount never schedule a retry with another account", async () => {
  const h = harness();
  h.subject.updateDraft("user_details", "synthetic first account edit");
  h.runTimer(800);
  const first = h.writes()[0];
  const run = h.context.settingsSaveRunRef.current;
  h.unmount();
  const stateCount = h.stateChanges.length;
  h.setAuthScope("account-b/companion-b");
  first.reject(new Error("synthetic delayed network failure"));
  await run;
  assert.equal(h.stateChanges.length, stateCount);
  assert.equal(h.timers.size, 0);
  assert.equal(h.context.pendingSettingsSaveRef.current, null);
  assert.equal(h.runTimer(1200), false);
  assert.equal(h.writes().length, 1);
});

test("model-catalog follow-up uses the same scoped lifecycle and ignores its late receipt", async () => {
  const h = harness();
  h.subject.updateDraft("model", "synthetic-new-model");
  const flush = h.subject.flushLatestSettingsDraft();
  h.writes()[0].resolveSettings();
  await tick();
  const catalogRead = h.requests.find(request => request.path === "/models");
  assert.ok(catalogRead, "a model change refreshes the actual model catalog");
  h.unmount();
  const stateCount = h.stateChanges.length;
  h.setAuthScope("account-b/companion-b");
  catalogRead.resolve({ models: [{ id: "synthetic-late-model" }], current_model: "synthetic-new-model" });
  await flush;
  assert.equal(catalogRead.options.signal?.aborted, true);
  await assert.rejects(catalogRead.options.authSession.getRequestContext(), { code: "settings_scope_changed" });
  assert.equal(h.stateChanges.length, stateCount, "late model-list success or cancellation cannot publish a stale error");
  assert.equal(h.writes().length, 1);
  assert.equal(h.timers.size, 0);
});

test("large text remains exact during lifecycle flush and the keepalive size boundary is explicit", async () => {
  const h = harness();
  const text = `  ${"合成".repeat(40000)}\r\n`;
  h.subject.updateDraft("user_details", text);
  const flush = h.subject.flushLatestSettingsDraft({ keepalive: true });
  const write = h.writes()[0];
  assert.equal(write.payload.user_details, text);
  assert.ok(new TextEncoder().encode(write.options.body).byteLength > 60 * 1024);
  assert.equal(write.options.keepalive, false, "large text cannot claim browser keepalive delivery");
  write.resolveSettings();
  assert.equal(await flush, true);
  assert.equal(h.context.confirmedSettingsRef.current.user_details, text);
  h.unmount();
});
