import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const previousWindow = globalThis.window;
const timers = new Map();
let timerId = 0;
globalThis.window = {
  setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
  clearTimeout(id) { timers.delete(id); },
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const fixture = {
  calls: [], stateWrites: 0,
  fetch(limit) { const request = deferred(); this.calls.push({ limit, ...request }); return request.promise; },
};
globalThis.__errorLogExplanationFixture = fixture;
// ErrorLogsPanel 已经是可注入依赖的独立组件：直接加载真实组件，
// 通过 props 换掉请求层，不再从 App.jsx 切源码。
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent",
  server: { middlewareMode: true },
});
const privateBody = "FICTIONAL_PRIVATE_UPSTREAM_BODY_NEVER_DISPLAY";
const balanceLog = {
  id: 101, created_at: "2026-10-06T00:00:00Z", method: "POST", path: "/chat/stream",
  error_code: "provider_balance_insufficient", message: "API 账户余额不足，请检查当前模型接口。",
  error_source: "upstream_provider_or_gateway", provider_phase: "http", provider_code: "insufficient_balance",
  upstream_status: 402, stack_trace: "services/ai-service.js:42:3", error_location: "services/ai-service.js:42:3",
  request_summary: { version: "0.29.18", upstream_body: privateBody },
  raw_error: privateBody, upstream_body: privateBody,
};
const newerLog = { ...balanceLog, id: 202, error_code: "provider_model_unavailable", message: "模型接口暂时不可用。" };
let tree;
const routes = [];
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const snapshot = () => JSON.stringify(tree.toJSON());
try {
  const { default: ErrorLogsPanel } = await vite.ssrLoadModule("/src/ErrorLogsPanel.jsx");
  const mount = async (accountScope = "fictional-account-a") => {
    fixture.accountScope = accountScope;
    fixture.calls = []; fixture.stateWrites = 0; routes.length = 0;
    await act(async () => {
      tree = TestRenderer.create(React.createElement(ErrorLogsPanel, {
        key: accountScope, accountScope, companionScope: "fictional-companion-a",
        onOpenSettings: category => routes.push(category),
        request: async (path) => ({ logs: await fixture.fetch(Number(new URL(path, "https://example.test").searchParams.get("limit"))) }),
        auth: { getSnapshot: () => ({ user: { id: fixture.accountScope }, activeCompanionId: "fictional-companion-a" }) },
        Diagnostics: () => null,
      }));
    });
  };
  const flushTimers = async () => {
    const callbacks = [...timers.values()]; timers.clear();
    await act(async () => callbacks.forEach(callback => callback()));
  };
  const unmount = async () => { await act(async () => tree.unmount()); tree = null; };
  const refreshButton = () => tree.root.findByProps({ className: "error-logs-actions" }).findByType("button");
  const reject = async (index, status = 401) => {
    await act(async () => fixture.calls[index].reject(Object.assign(new Error(privateBody), {
      code: "api_request_failed", status,
    })));
  };
  const resolve = async (index, logs) => { await act(async () => fixture.calls[index].resolve(logs)); };

  await mount();
  await flushTimers();
  assert.equal(fixture.calls[0].limit, 50);
  await reject(0);
  const loadAlert = tree.root.findByProps({ className: "error-logs-load-error" });
  assert.match(text(loadAlert), /没有有效的灯塔登录状态/);
  assert.match(text(loadAlert), /重新登录后，再刷新/);
  assert.doesNotMatch(snapshot(), new RegExp(privateBody));
  assert.equal(refreshButton().props.disabled, false);
  await act(async () => refreshButton().props.onClick());
  await resolve(1, []);
  assert.equal(tree.root.findAllByProps({ className: "error-logs-load-error" }).length, 0);
  assert.match(snapshot(), /暂无错误记录/);
  await unmount();

  await mount();
  await flushTimers();
  await resolve(0, [balanceLog]);
  assert.equal(tree.root.findAllByProps({ className: "operation-error-help" }).length, 0, "row explanations appear only when the user expands that row");
  assert.equal(tree.root.findAllByType("details").length, 0);
  await act(async () => tree.root.findByProps({ className: "error-log-summary" }).props.onClick());
  const explanation = tree.root.findByProps({ className: "operation-error-help" });
  assert.match(text(explanation), /API 账户余额不足/);
  assert.match(text(explanation), /供应商控制台充值或切换有余额的接口/);
  const technical = tree.root.findByProps({ className: "error-log-technical" });
  assert.notEqual(technical.props.open, true, "technical details must start collapsed");
  assert.match(text(technical), /services\/ai-service\.js:42:3/);
  assert.match(text(technical), /HTTP: 402/);
  assert.doesNotMatch(snapshot(), new RegExp(privateBody), "successful public log records cannot render extra raw upstream fields");
  const settingsButton = explanation.findAllByType("button").find(button => text(button) === "检查相关设置");
  assert.ok(settingsButton);
  await act(async () => settingsButton.props.onClick());
  assert.deepEqual(routes, ["services"], "balance recovery must route to model service settings");

  let button = refreshButton();
  await act(async () => { button.props.onClick(); button.props.onClick(); });
  assert.equal(fixture.calls.length, 2, "same-tick refresh clicks must share one request");
  await resolve(1, [newerLog]);
  assert.match(snapshot(), /provider_model_unavailable/);
  assert.doesNotMatch(snapshot(), /provider_balance_insufficient/);

  button = refreshButton();
  await act(async () => { button.props.onClick(); button.props.onClick(); });
  assert.equal(fixture.calls.length, 3);
  await reject(2);
  assert.match(snapshot(), /provider_model_unavailable/, "a failed refresh preserves previously accepted logs");
  assert.match(snapshot(), /重新登录/);
  assert.doesNotMatch(snapshot(), new RegExp(privateBody));
  await unmount();

  for (const outcome of ["success", "failure"]) {
    await mount();
    await flushTimers();
    const pending = fixture.calls[0];
    await unmount();
    await mount("fictional-account-b");
    await flushTimers();
    await resolve(0, [newerLog]);
    const acceptedScope = snapshot(), writesBeforeLateResult = fixture.stateWrites;
    await act(async () => {
      if (outcome === "success") pending.resolve([balanceLog]);
      else pending.reject(Object.assign(new Error(privateBody), { status: 401 }));
    });
    assert.equal(snapshot(), acceptedScope, "unmounted account results cannot replace the new panel");
    assert.equal(fixture.stateWrites, writesBeforeLateResult, "unmounted results must not attempt any state update");
    assert.doesNotMatch(snapshot(), new RegExp(privateBody));
    await unmount();
  }
  await mount();
  await unmount();
  await flushTimers();
  assert.equal(fixture.calls.length, 0, "unmounting before the deferred first refresh cancels its timer");

  console.log("Actual App error logs panel passed: login recovery, balance explanation, settings routing, collapsed technical details, upstream privacy, concurrent reads and unmount.");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  delete globalThis.__errorLogExplanationFixture;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
