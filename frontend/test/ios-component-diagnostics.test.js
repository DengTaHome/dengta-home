import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const C = "33333333-3333-4333-8333-333333333333";
const scope = id => JSON.stringify([id, C]);
const text = node => typeof node === "string" ? node : (Array.isArray(node) ? node : node?.children || []).map(text).join("");
const deferred = () => { let reject; const promise = new Promise((_, no) => { reject = no; }); return { promise, reject }; };
const fail = code => Object.assign(new Error("fictional private error body"), { code });
const descriptors = Object.fromEntries(["window", "document", "IS_REACT_ACT_ENVIRONMENT", "__componentDiagnostics"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const cacheDir = `/tmp/dengta-component-diagnostics-${process.pid}`;
const noChange = () => {};
let vite, components, cleanup, diagnostics, currentAccount = "";
const fixture = {
  manager: { getSnapshot: () => ({ status: "authenticated", user: { id: currentAccount }, activeCompanionId: C }), getRequestScope: () => ({ accountId: currentAccount, companionId: C, revision: 0 }) },
  request: async () => { throw new Error("unexpected fixture request"); },
};
before(async () => {
  const win = Object.assign(new EventTarget(), { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, confirm: () => true });
  for (const [name, value] of [["window", win], ["document", Object.assign(new EventTarget(), { visibilityState: "visible" })], ["IS_REACT_ACT_ENVIRONMENT", true], ["__componentDiagnostics", fixture]]) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), envDir: false, appType: "custom", cacheDir, logLevel: "silent", server: { middlewareMode: true, hmr: false },
    plugins: [{ name: "fictional-diagnostic-transports", enforce: "pre", transform(code, id) {
      const path = id.replaceAll("\\", "/").split("?")[0];
      if (path.endsWith("/src/auth-session.js")) return 'export const AUTH_STATUS = { authenticated: "authenticated" }; export const authSession = globalThis.__componentDiagnostics.manager;';
      if (path.endsWith("/src/api.js")) return 'export const API_BASE_URL = "https://fixture.invalid"; export function apiRequest(path, options) { return globalThis.__componentDiagnostics.request(path, options); } export const apiFetch = apiRequest;';
      return null;
    } }],
  });
  components = {
    takeout: (await vite.ssrLoadModule("/src/TakeoutLoginPanel.jsx")).default,
    xhs: (await vite.ssrLoadModule("/src/XhsLoginPanel.jsx")).default,
    map: (await vite.ssrLoadModule("/src/SurpriseMap.jsx")).SurpriseMapContent,
    memory: (await vite.ssrLoadModule("/src/LocalMemorySummaries.jsx")).default,
  };
  cleanup = await vite.ssrLoadModule("/src/account-cleanup.js");
  diagnostics = await vite.ssrLoadModule("/src/operation-diagnostics.js");
});
after(async () => {
  await vite?.close();
  await rm(cacheDir, { recursive: true, force: true });
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
});
const clear = id => cleanup.clearAccountRuntimeData(id, { localStorage: null, sessionStorage: null, sealAccountCache: noChange, purgeAccountCache: async () => {}, workspaceCacheClearLegacy: async () => {}, stopVoiceSpeech: async () => {} });

for (const [index, kind] of ["takeout", "xhs", "map", "memory"].entries()) test(`${kind} records fresh same-account login failures while rejecting its old pending callback`, async () => {
  const A = `${index + 1}1111111-1111-4111-8111-111111111111`, B = `${index + 1}2222222-2222-4222-8222-222222222222`;
  const oldRequest = deferred(), freshRequest = deferred();
  let tree;
  const mount = async (account, request) => {
    currentAccount = account;
    fixture.request = () => request.promise;
    let props;
    if (kind === "takeout") props = { scope: scope(account), available: true, readLogin: async () => ({ status: "ready", loggedIn: false }), openLogin: () => request.promise, appEvents: { addListener: async () => ({ remove() {} }) } };
    if (kind === "xhs") props = { scope: scope(account), nativeAvailable: false, operations: { me: () => request.promise } };
    if (kind === "map") props = { scopeKey: scope(account), aiName: "虚构伴侣", isCurrent: () => true, request: (path, options) => options?.method === "POST" ? request.promise : Promise.resolve({ ok: true, letters: [] }) };
    if (kind === "memory") props = { scopeKey: scope(account), onItemsChange: noChange, onDraftsChange: noChange };
    await act(async () => { tree = TestRenderer.create(React.createElement(components[kind], props)); });
    const label = { takeout: "扫码登录外卖", xhs: "重新检测", map: "请虚构伴侣写一封" }[kind];
    if (label) await act(async () => tree.root.findAllByType("button").find(button => text(button.props.children) === label).props.onClick());
  };
  const unmount = async () => { if (tree) { await act(async () => tree.unmount()); tree = null; } };
  try {
    cleanup.prepareAccountRuntimeData(A);
    await mount(A, oldRequest);
    await clear(A);
    await unmount();
    cleanup.prepareAccountRuntimeData(B);
    currentAccount = B;
    cleanup.prepareAccountRuntimeData(A);
    await mount(A, freshRequest);
    await act(async () => freshRequest.reject(fail(kind === "map" ? "surprise_map_receipt_invalid" : kind === "memory" ? "memory_summary_receipt_invalid" : kind === "xhs" ? "xhs_session_isolation_required" : "takeout_login_open_failed")));
    const rows = diagnostics.readOperationFailures(scope(A));
    assert.equal(rows.length, 1, "fresh component must retain scoped diagnostics after the same account exited before");
    assert.doesNotMatch(JSON.stringify(rows), /fictional private error body/);
    await act(async () => oldRequest.reject(fail("request_timeout")));
    assert.equal(diagnostics.readOperationFailures(scope(A)).length, 1, "late old component completion must not append to the new login");
    assert.equal(diagnostics.readOperationFailures(scope(B)).length, 0);
  } finally {
    await unmount();
    await clear(A); await clear(B);
  }
});
