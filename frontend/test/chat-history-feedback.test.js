import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, transformWithOxc } from "vite";

let vite, Feedback, descriptor;
const failure = { sessionId: "fictional-session", status: "error", error: { code: "request_timeout", reason: "请求等待超时。", action: "检查网络后重试。" } };
const text = value => typeof value === "string" ? value : (value?.children || []).map(text).join("");
before(async () => {
  descriptor = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ default: Feedback } = await vite.ssrLoadModule("/src/ChatHistoryFeedback.jsx"));
});
after(async () => { await vite?.close(); if (descriptor) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", descriptor); else delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

test("actual history loading feedback exposes status without false empty-history success", () => {
  const html = renderToStaticMarkup(React.createElement(Feedback, { state: { status: "loading" } }));
  assert.match(html, /role="status"/); assert.match(html, /aria-busy="true"/); assert.match(html, /正在读取聊天记录/);
  assert.doesNotMatch(html, /<button|暂无|没有聊天记录|暂时没有读取成功/);
});

test("actual history failure offers independent read retry and diagnostic navigation", async () => {
  let tree, reads = 0, inspections = 0;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(Feedback, { state: failure, onRetry: () => reads++, onInspect: () => inspections++ })); });
    const panel = tree.root.findByProps({ className: "chat-history-feedback" });
    assert.equal(panel.props.role, "alert"); assert.equal(panel.props["aria-busy"], false);
    assert.match(text(tree.toJSON()), /request_timeout.*DT-SESSIONS/);
    assert.match(text(tree.toJSON()), /不会再次发送消息/);
    const buttons = tree.root.findAllByType("button"); assert.deepEqual(buttons.map(text), ["重新读取", "查看操作日志"]);
    await act(async () => buttons[0].props.onClick()); assert.equal(reads, 1); assert.equal(inspections, 0);
    await act(async () => buttons[1].props.onClick()); assert.equal(reads, 1); assert.equal(inspections, 1);
    assert.ok(buttons.every(button => button.props.type === "button"));
  } finally { if (tree) await act(async () => tree.unmount()); }
});

test("App actual feedback binding opens the existing logs category", async () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const start = app.indexOf("<ChatHistoryFeedback "), end = app.indexOf("/>", start);
  assert.ok(start >= 0 && end > start);
  const { code } = await transformWithOxc("const element = " + app.slice(start, end + 2) + ";", "history-feedback-binding.jsx", { lang: "jsx", jsx: { runtime: "classic", pragma: "React.createElement", pragmaFrag: "React.Fragment" } });
  const navigation = { category: null, open: false }; let retries = 0, tree;
  const build = new Function("React", "ChatHistoryFeedback", "historyLoadState", "retrySessionHistory", "setSettingsCategory", "setIsSettingsOpen", code + "\nreturn element;");
  try {
    const element = build(React, Feedback, failure, () => retries++, category => { navigation.category = category; }, open => { navigation.open = open; });
    await act(async () => { tree = TestRenderer.create(element); });
    await act(async () => tree.root.findAllByType("button")[0].props.onClick()); assert.equal(retries, 1);
    await act(async () => tree.root.findAllByType("button")[1].props.onClick());
    assert.deepEqual(navigation, { category: "logs", open: true });
    assert.match(app, /id:\s*"logs"/); assert.match(app, /settingsCategory === "logs"/);
  } finally { if (tree) await act(async () => tree.unmount()); }
});
