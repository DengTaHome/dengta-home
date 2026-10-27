import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import * as logRequests from "../src/error-log-request.js";
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
  // 直接挂载真实的 ErrorLogsPanel，只替换「请求层」和「账号范围」。
  // 回执校验、错误码描述、本地诊断记录全都用真实现——这样测的是行为，不是文本。
  const { default: Panel } = await vite.ssrLoadModule("/src/ErrorLogsPanel.jsx");
  const scope = JSON.stringify(["fictional-account", "fictional-companion"]);
  return {
    Panel,
    props: {
      accountScope: "fictional-account",
      companionScope: "fictional-companion",
      onOpenSettings: () => {},
      request: (path, options) => request(path, options),
      auth: { getSnapshot: () => ({ user: { id: "fictional-account" }, activeCompanionId: "fictional-companion" }) },
      readScopeKey: () => scope,
      readSaveScope: () => scope,
      // 本机诊断面板会渲染自己的按钮，这里替掉，保证「刷新」是第一个按钮。
      Diagnostics: () => null,
      // 桥接：面板是经 Vite 加载的，它内部的 operation-diagnostics 与测试直接
      // import 的那份是两个模块实例、两张内存表。不桥接就读不到记录。
      recordFailure: (...args) => recordOperationFailure(...args),
      // 用一个只渲染错误码的替身：真实现的文案里不一定带原始 code，
      // 而这几条测试关心的是「哪个错误码被记录/被展示」。
      ErrorHelp: ({ diagnostic: error }) => React.createElement("span", null, error?.code || "unknown")
    }
  };
}
test("actual settings panel aborts on leaving and ignores the late response", async () => {
  const pending = deferred(); let signal, view;
  const oldWindow = globalThis.window; globalThis.window = globalThis;
  try {
    const { Panel, props } = await panelFixture((_, options) => { signal = options.signal; return pending.promise; });
    await act(async () => { view = TestRenderer.create(React.createElement(Panel, props)); });
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
    const { Panel, props } = await panelFixture(async () => ++count === 1 ? { logs: [{ id: "a", error_code: "request_timeout", created_at: "2026-10-10T00:00:00Z" }] } : { logs: {} });
    await act(async () => { view = TestRenderer.create(React.createElement(Panel, props)); });
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
