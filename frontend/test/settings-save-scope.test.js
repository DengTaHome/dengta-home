import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { apiRequest } from "../src/api.js";
import { clearOperationFailures, diagnosticScopeKey, readOperationFailures } from "../src/operation-diagnostics.js";
import {
  createScopedSettingsSession,
  flushSettingsBeforeAccountExit,
  registerSettingsSaveGuard,
  releaseSettingsAccountExit,
  settingsSaveScope,
} from "../src/settings-save-scope.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function sessionHarness() {
  let snapshot = { user: { id: "account-a" }, activeCompanionId: "companion-a" };
  let contextReader = async () => ({ companionId: snapshot.activeCompanionId });
  const calls = { context: 0, capture: 0, invalidate: 0 };
  const manager = {
    getSnapshot: () => snapshot,
    async getRequestContext() { calls.context += 1; return contextReader(); },
    captureCompanionFromResponse() { calls.capture += 1; },
    invalidateSession() { calls.invalidate += 1; },
  };
  const controller = new AbortController();
  const scope = settingsSaveScope(snapshot);
  return {
    manager, calls, controller, scope,
    scoped: createScopedSettingsSession(manager, scope, controller.signal),
    change(account = "account-b", companion = "companion-b") {
      snapshot = { user: { id: account }, activeCompanionId: companion };
    },
    readWith(reader) { contextReader = reader; },
  };
}

test("request context accepts the current scope and blocks an already changed account or companion", async () => {
  const h = sessionHarness();
  assert.equal((await h.scoped.getRequestContext()).companionId, "companion-a");
  h.change("account-a", "companion-b");
  await assert.rejects(h.scoped.getRequestContext(), { code: "settings_scope_changed" });
  assert.equal(h.calls.context, 1, "changed scope is rejected before reading authentication context");
  const changedAccount = sessionHarness();
  changedAccount.change("account-b", "companion-a");
  await assert.rejects(changedAccount.scoped.getRequestContext(), { code: "settings_scope_changed" });
  assert.equal(changedAccount.calls.context, 0);
});

test("scope changes during async authentication lookup cannot return the new context", async () => {
  const h = sessionHarness();
  const pending = deferred();
  h.readWith(() => pending.promise);
  const read = h.scoped.getRequestContext();
  h.change();
  pending.resolve({ companionId: "companion-b" });
  await assert.rejects(read, { code: "settings_scope_changed" });
});

test("a request context with a different companion is rejected even if the local snapshot is stale", async () => {
  const h = sessionHarness();
  h.readWith(async () => ({ companionId: "companion-b" }));
  await assert.rejects(h.scoped.getRequestContext(), { code: "settings_scope_changed" });
});

test("scoped diagnostics retain their original account and companion after the current scope changes", async () => {
  const h = sessionHarness();
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalScope = diagnosticScopeKey("account-a", "companion-a");
  const nextScope = diagnosticScopeKey("account-b", "companion-b");
  clearOperationFailures(originalScope);
  clearOperationFailures(nextScope);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { clearTimeout } });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => {
      h.change();
      return new Response(JSON.stringify({ code: "synthetic_save_failure" }), { status: 500 });
    },
  });
  try {
    const original = h.scoped.getSnapshot();
    assert.equal(original.user?.id, "account-a");
    assert.equal(original.activeCompanionId, "companion-a");
    await assert.rejects(apiRequest("/api/v2/settings", {
      method: "PUT", body: "{}", retry: false, authSession: h.scoped, signal: h.controller.signal,
    }), { status: 500 });
    assert.equal(h.scoped.getSnapshot().user?.id, "account-a");
    assert.equal(h.scoped.getSnapshot().activeCompanionId, "companion-a");
    assert.equal(readOperationFailures(originalScope).length, 1, "the real apiRequest records metadata under the originating settings scope");
    assert.equal(readOperationFailures(originalScope)[0].code, "DT-SETTINGS");
    assert.equal(readOperationFailures(nextScope).length, 0);
    assert.equal(h.calls.capture, 0);
  } finally {
    clearOperationFailures(originalScope);
    clearOperationFailures(nextScope);
    if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor);
    else delete globalThis.fetch;
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete globalThis.window;
  }
});

test("empty and null companion contexts normalize to the same unselected scope", async () => {
  const h = sessionHarness();
  h.change("account-a", "");
  const scoped = createScopedSettingsSession(h.manager, settingsSaveScope(h.manager.getSnapshot()), h.controller.signal);
  h.readWith(async () => ({ companionId: null }));
  assert.equal((await scoped.getRequestContext()).companionId, null);
  h.readWith(async () => ({}));
  assert.deepEqual(await scoped.getRequestContext(), {});
});

test("cancellation before or during context lookup blocks delivery and later session side effects", async () => {
  const before = sessionHarness();
  before.controller.abort();
  await assert.rejects(before.scoped.getRequestContext(), { code: "settings_scope_changed" });
  assert.equal(before.calls.context, 0);
  const during = sessionHarness();
  const pending = deferred();
  during.readWith(() => pending.promise);
  const read = during.scoped.getRequestContext();
  during.controller.abort();
  pending.resolve({ companionId: "companion-a" });
  await assert.rejects(read, { code: "settings_scope_changed" });
  during.scoped.captureCompanionFromResponse({});
  await during.scoped.invalidateSession("synthetic expired response");
  assert.equal(during.calls.capture, 0);
  assert.equal(during.calls.invalidate, 0);
});

test("late response capture or invalidation never changes a different account", async () => {
  const h = sessionHarness();
  h.scoped.captureCompanionFromResponse({});
  await h.scoped.invalidateSession("synthetic current response");
  assert.equal(h.calls.capture, 1);
  assert.equal(h.calls.invalidate, 1);
  h.change();
  h.scoped.captureCompanionFromResponse({});
  await h.scoped.invalidateSession("synthetic late response");
  assert.equal(h.calls.capture, 1);
  assert.equal(h.calls.invalidate, 1);
});

test("exit guard requires a confirmed save and rejects removed or replaced registrations", async () => {
  const absent = "synthetic-no-registration";
  assert.equal(await flushSettingsBeforeAccountExit(absent), true);
  const failedScope = "synthetic-failed-guard";
  const unregisterFailed = registerSettingsSaveGuard(failedScope, async () => false);
  assert.equal(await flushSettingsBeforeAccountExit(failedScope), false);
  unregisterFailed();
  const oldSave = deferred();
  const scope = "synthetic-replaced-guard";
  const unregisterOld = registerSettingsSaveGuard(scope, () => oldSave.promise);
  const exit = flushSettingsBeforeAccountExit(scope);
  const unregisterNew = registerSettingsSaveGuard(scope, async () => true);
  unregisterOld();
  oldSave.resolve(true);
  assert.equal(await exit, false, "the old App cannot authorize exit after a new App registers");
  assert.equal(await flushSettingsBeforeAccountExit(scope), true, "old cleanup does not remove the new guard");
  unregisterNew();
  const removedSave = deferred();
  const unregisterRemoved = registerSettingsSaveGuard(scope, () => removedSave.promise);
  const removedExit = flushSettingsBeforeAccountExit(scope);
  unregisterRemoved();
  removedSave.resolve(true);
  assert.equal(await removedExit, false);
});

test("exit locking happens before saving and remains active until explicitly released", async () => {
  const scope = "synthetic-exit-lock";
  const pending = deferred();
  const events = [];
  const unregister = registerSettingsSaveGuard(scope, () => {
    events.push("save");
    return pending.promise;
  }, busy => events.push(busy));
  try {
    const exit = flushSettingsBeforeAccountExit(scope);
    assert.deepEqual(events, [true, "save"]);
    pending.resolve(true);
    assert.equal(await exit, true);
    assert.deepEqual(events, [true, "save"], "confirmed saving keeps inputs locked while logout waits");
    releaseSettingsAccountExit(scope);
    assert.deepEqual(events, [true, "save", false]);
  } finally {
    unregister();
  }
});

test("actual account menu waits for saving, avoids duplicate logout, and retains the page after save failure", async () => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const actDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let tree;
  let unregister;
  try {
    const { AccountMenu } = await vite.ssrLoadModule("/src/AuthGate.jsx");
    const guards = await vite.ssrLoadModule("/src/settings-save-scope.js");
    const snapshot = { user: { id: "synthetic-account", email: "synthetic@example.test" }, activeCompanionId: "synthetic-companion" };
    let logoutCount = 0;
    let exitBusy = false;
    const exitBusyChanges = [];
    const setExitBusy = busy => { exitBusy = busy; exitBusyChanges.push(busy); };
    const logoutPending = deferred();
    let logoutError = null;
    const manager = {
      getSnapshot: () => snapshot,
      async signOut() {
        logoutCount += 1;
        if (logoutError) throw logoutError;
        await logoutPending.promise;
      },
    };
    const pending = deferred();
    unregister = guards.registerSettingsSaveGuard(guards.settingsSaveScope(snapshot), () => pending.promise, setExitBusy);
    await act(async () => { tree = TestRenderer.create(React.createElement(AccountMenu, { sessionManager: manager, snapshot })); });
    await act(async () => tree.root.findByProps({ className: "account-menu-trigger" }).props.onClick());
    let firstLogout;
    await act(async () => {
      const button = tree.root.findByProps({ role: "menuitem" });
      firstLogout = button.props.onClick();
      await button.props.onClick();
    });
    assert.equal(logoutCount, 0);
    assert.equal(exitBusy, true, "the real menu locks App inputs while the settings request waits");
    assert.equal(tree.root.findByProps({ role: "menuitem" }).props.disabled, true);
    await act(async () => { pending.resolve(true); });
    assert.equal(logoutCount, 1);
    assert.equal(exitBusy, true, "the lock remains active throughout the signOut request");
    await act(async () => { logoutPending.resolve(); await firstLogout; });
    assert.equal(exitBusy, false);
    assert.deepEqual(exitBusyChanges, [true, false]);
    unregister();
    await act(async () => tree.unmount());
    tree = null;

    unregister = guards.registerSettingsSaveGuard(guards.settingsSaveScope(snapshot), async () => false, setExitBusy);
    await act(async () => { tree = TestRenderer.create(React.createElement(AccountMenu, { sessionManager: manager, snapshot })); });
    await act(async () => tree.root.findByProps({ className: "account-menu-trigger" }).props.onClick());
    await act(async () => tree.root.findByProps({ role: "menuitem" }).props.onClick());
    assert.equal(logoutCount, 1, "failed save does not log out or discard the editor's App");
    assert.match(tree.root.findByProps({ role: "alert" }).children.join(""), /设置尚未保存/);
    assert.equal(tree.root.findByProps({ role: "menuitem" }).props.disabled, false);
    assert.equal(exitBusy, false, "a failed save unlocks the retained App for editing");
    assert.deepEqual(exitBusyChanges, [true, false, true, false]);
    unregister();
    await act(async () => tree.unmount());
    tree = null;

    logoutError = new Error("synthetic logout request failed");
    unregister = guards.registerSettingsSaveGuard(guards.settingsSaveScope(snapshot), async () => true, setExitBusy);
    await act(async () => { tree = TestRenderer.create(React.createElement(AccountMenu, { sessionManager: manager, snapshot })); });
    await act(async () => tree.root.findByProps({ className: "account-menu-trigger" }).props.onClick());
    await act(async () => tree.root.findByProps({ role: "menuitem" }).props.onClick());
    assert.equal(logoutCount, 2);
    assert.match(tree.root.findByProps({ role: "alert" }).children.join(""), /synthetic logout request failed/);
    assert.equal(tree.root.findByProps({ role: "menuitem" }).props.disabled, false);
    assert.equal(exitBusy, false, "a failed signOut request also unlocks the retained App");
    assert.deepEqual(exitBusyChanges, [true, false, true, false, true, false]);
  } finally {
    unregister?.();
    if (tree) await act(async () => tree.unmount());
    await vite.close();
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else delete globalThis.document;
    if (actDescriptor) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actDescriptor);
    else delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
