import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer, transformWithOxc } from "vite";
import * as logRequests from "../src/error-log-request.js";
import { describeOperationError } from "../src/operation-error-help.js";
import { recordOperationFailure, readOperationFailures, clearOperationFailures } from "../src/operation-diagnostics.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const text = view => JSON.stringify(view.toJSON());
const diagnostic = { error_code: "request_timeout", error_location: "fixture.js:12:2" };
let vite, Log;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
  ({ default: Log } = await vite.ssrLoadModule("/src/ChatErrorLog.jsx"));
});
after(async () => { await vite?.close(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

test("log list has an end-to-end deadline and aborts a stuck request", async () => {
  assert.equal(typeof logRequests.requestErrorLogs, "function");
  let signal;
  await assert.rejects(logRequests.requestErrorLogs(async (_, options) => {
    signal = options.signal; return new Promise(() => {});
  }, 50, 5), { code: "request_timeout" });
  assert.equal(signal.aborted, true);
});

test("invalid list and mismatched detail receipts are explicit failures", async () => {
  assert.equal(typeof logRequests.requestErrorLogs, "function");
  for (const logs of [null, {}, [{ error_code: "unknown" }]]) {
    await assert.rejects(logRequests.requestErrorLogs(async () => ({ logs })), { code: "error_logs_receipt_invalid" });
  }
  await assert.rejects(logRequests.requestErrorLog("expected", async () => ({ log: { id: "other", error_code: "unknown" } })), { code: "error_log_receipt_invalid" });
  assert.deepEqual(await logRequests.requestErrorLogs(async () => ({ logs: [] })), []);
});

test("scope cancellation releases a pending log read without waiting for timeout", async () => {
  const controller = new AbortController(); let inner;
  const operation = logRequests.requestErrorLog("a", async (_, options) => {
    inner = options.signal; return new Promise(() => {});
  }, 1000, { signal: controller.signal });
  controller.abort();
  await assert.rejects(operation, { name: "AbortError" });
  assert.equal(inner.aborted, true);
});

test("same-tick detail toggles submit only one read", async () => {
  const pending = deferred(); let count = 0, view;
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(Log, { logId: "a", diagnostic, loadLog: () => { count++; return pending.promise; } })); });
    const toggle = view.root.findAllByType("button")[0].props.onClick;
    await act(async () => { toggle(); toggle(); });
    assert.equal(count, 1);
    await act(async () => { pending.resolve({ id: "a", ...diagnostic }); await pending.promise; });
  } finally { if (view) await act(async () => view.unmount()); }
});

test("replacing a log aborts its read and cannot display the old receipt", async () => {
  const pending = deferred(); const signals = []; let view;
  const loadLog = (id, options) => { signals.push(options?.signal); return id === "a" ? pending.promise : Promise.resolve({ id: "b", error_code: "request_timeout", error_location: "new.js:2:3" }); };
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(Log, { logId: "a", diagnostic, loadLog })); });
    await act(async () => view.root.findAllByType("button")[0].props.onClick());
    await act(async () => view.update(React.createElement(Log, { logId: "b", diagnostic, loadLog })));
    assert.equal(signals[0]?.aborted, true);
    await act(async () => view.root.findAllByType("button")[0].props.onClick());
    await act(async () => { pending.resolve({ id: "a", error_location: "OLD_RECEIPT.js:7:8" }); await pending.promise; });
    assert.doesNotMatch(text(view), /OLD_RECEIPT/);
    assert.match(text(view), /new.js:2:3/);
    await act(async () => view.unmount()); view = null;
  } finally { if (view) await act(async () => view.unmount()); }
});

test("leaving detail aborts its pending read", async () => {
  let signal, view; const pending = deferred();
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(Log, { logId: "a", diagnostic, loadLog: (_, options) => { signal = options.signal; return pending.promise; } })); });
    await act(async () => view.root.findAllByType("button")[0].props.onClick());
    await act(async () => view.unmount()); view = null;
    assert.equal(signal.aborted, true);
    await act(async () => { pending.resolve({ id: "a", ...diagnostic }); await pending.promise; });
  } finally { if (view) await act(async () => view.unmount()); }
});

test("invalid detail receipt keeps local diagnostics and offers retry", async () => {
  let view;
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(Log, { logId: "a", diagnostic, loadLog: async () => ({ id: "other", error_location: "WRONG_LOG.js:2:3" }) })); });
    await act(async () => view.root.findAllByType("button")[0].props.onClick());
    assert.doesNotMatch(text(view), /WRONG_LOG/);
    assert.match(text(view), /error_log_receipt_invalid/);
    assert.match(text(view), /fixture.js:12:2/);
    assert.match(text(view), /重试读取日志/);
  } finally { if (view) await act(async () => view.unmount()); }
});

async function panelFixture(request) {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const start = app.indexOf("function ErrorLogsPanel("), end = app.indexOf("\nfunction MemoryImportCard(", start);
  assert.ok(start >= 0 && end > start);
  const { code } = await transformWithOxc(app.slice(start, end), "log-panel.jsx", { lang: "jsx", jsx: { runtime: "classic", pragma: "React.createElement", pragmaFrag: "React.Fragment" } });
  const scope = JSON.stringify(["fictional-account", "fictional-companion"]);
  const authSession = { getSnapshot: () => ({ user: { id: "fictional-account" }, activeCompanionId: "fictional-companion" }) };
  const { createScopedSettingsSession } = await import("../src/settings-save-scope.js");
  const wrapper = (path, options) => request(path, options);
  const hooks = ["useState", "useRef", "useEffect", "useLayoutEffect", "useCallback"];
  const Panel = new Function("React", ...hooks, "fetchErrorLogs", "requestErrorLogs", "apiRequest", "authSession", "createScopedSettingsSession", "settingsSaveScope", "diagnosticScopeKey", "recordOperationFailure", "describeOperationError", "LocalDiagnostics", "OperationErrorHelp", code + "\nreturn ErrorLogsPanel;")(
    React, ...hooks.map(key => React[key]), async () => { const data = await wrapper("/api/errors", {}); return Array.isArray(data?.logs) ? data.logs : []; },
    logRequests.requestErrorLogs, wrapper, authSession, createScopedSettingsSession, () => scope, () => scope, recordOperationFailure, describeOperationError,
    () => null, ({ diagnostic }) => React.createElement("span", null, diagnostic.code || "unknown"));
  return Panel;
}

test("actual settings panel aborts on leaving and ignores the late response", async () => {
  const pending = deferred(); let signal, view;
  const oldWindow = globalThis.window; globalThis.window = globalThis;
  try {
    const Panel = await panelFixture((_, options) => { signal = options.signal; return pending.promise; });
    await act(async () => { view = TestRenderer.create(React.createElement(Panel, { accountScope: "fictional-account", companionScope: "fictional-companion" })); });
    await act(async () => new Promise(resolve => setTimeout(resolve, 25)));
    assert.ok(signal);
    await act(async () => view.unmount()); view = null;
    assert.equal(signal.aborted, true);
    await act(async () => { pending.resolve({ logs: [] }); await pending.promise; });
  } finally { if (view) await act(async () => view.unmount()); globalThis.window = oldWindow; }
});

test("actual settings panel preserves valid logs after malformed refresh", async () => {
  let count = 0, view; const oldWindow = globalThis.window; globalThis.window = globalThis;
  try {
    const Panel = await panelFixture(async () => ++count === 1 ? { logs: [{ id: "a", error_code: "request_timeout", created_at: "2026-10-10T00:00:00Z" }] } : { logs: {} });
    await act(async () => { view = TestRenderer.create(React.createElement(Panel, { accountScope: "fictional-account", companionScope: "fictional-companion" })); });
    await act(async () => new Promise(resolve => setTimeout(resolve, 25)));
    assert.match(text(view), /request_timeout/);
    await act(async () => view.root.findAllByType("button")[0].props.onClick());
    assert.match(text(view), /error_logs_receipt_invalid/);
    assert.match(text(view), /request_timeout/);
    assert.equal(count, 2);
    const scope = JSON.stringify(["fictional-account", "fictional-companion"]);
    assert.equal(readOperationFailures(scope)[0].code, "DT-LOGS");
    assert.equal(readOperationFailures(scope)[0].reasonCode, "error_logs_receipt_invalid");
    clearOperationFailures(scope);
  } finally { if (view) await act(async () => view.unmount()); globalThis.window = oldWindow; }
});
