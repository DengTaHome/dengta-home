import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import {
  VISIBLE_MONOLOGUE_SOURCE,
  beginVisibleMonologueStream,
  canRequestVisibleMonologue,
  readInnerMonologues,
  reduceVisibleMonologueEvent,
  storeInnerMonologue,
} from "../src/inner-monologue.js";

const messageId = "019c0000-0000-7000-8000-000000000001";
const userMessageId = "019c0000-0000-7000-8000-000000000002";
const sessionId = "11111111-1111-4111-8111-111111111111";
const source = VISIBLE_MONOLOGUE_SOURCE;
const saved = {
  id: messageId,
  role: "assistant",
  conversation_id: sessionId,
  content: "虚构正文，保持原样。",
  created_at: "2026-10-15T00:00:00Z",
};
const snapshot = (state, text = "", extra = {}) => ({ state, text, source, ...extra });
const text = node => typeof node === "string" ? node :
  (Array.isArray(node) ? node : node?.children || []).map(text).join("");
function visibleText(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(visibleText).join("");
  if (!node) return "";
  const children = node.type === "details" && node.props.open !== true
    ? (node.children || []).filter(child => child?.type === "summary")
    : node.children || [];
  return children.map(visibleText).join("");
}
const button = (view, label) => view.root.findAllByType("button")
  .find(node => text(node.children).includes(label));
let vite, ChatMessage, ThinkingPanel, Transcript;
const previousDocument = globalThis.document;
const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;

before(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.document = new EventTarget();
  vite = await createServer({ envFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  ({ default: ChatMessage } = await vite.ssrLoadModule("/src/ChatMessage.jsx"));
  ({ ThinkingPanel } = await vite.ssrLoadModule("/src/ChatMessageExtras.jsx"));
  ({ default: Transcript } = await vite.ssrLoadModule("/src/ChatTranscript.jsx"));
});
after(async () => {
  await vite?.close();
  globalThis.document = previousDocument;
  globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
});

test("real live message shows every received public monologue character before the reply body", async () => {
  let view;
  let monologue = beginVisibleMonologueStream();
  let item = { ...saved, id: "local-assistant-fixture", content: "", isStreaming: true };
  const props = () => ({ item, innerMonologue: monologue, aiName: "虚构伙伴" });
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(ChatMessage, props())); });
    assert.equal(view.root.findByType("details").props.open, true);
    assert.equal(view.root.findAllByProps({ className: "thinking-panel-minimal" }).length, 0);
    for (const [offset, content] of ["想", "🙂", "你"].entries()) {
      monologue = reduceVisibleMonologueEvent(monologue, { type: "monologue", phase: "delta", source, offset, content });
      await act(async () => view.update(React.createElement(ChatMessage, props())));
      assert.ok(visibleText(view.toJSON()).includes(monologue.text), "the current code-point delta is visible immediately");
    }
    item = { ...item, content: "虚构正文首字" };
    await act(async () => view.update(React.createElement(ChatMessage, props())));
    const visible = visibleText(view.toJSON());
    assert.ok(visible.indexOf("想🙂你") < visible.indexOf(item.content));
    assert.equal(item.content, "虚构正文首字");
  } finally {
    if (view) await act(async () => view.unmount());
  }
});

test("recent completed monologue stays open when the transcript replaces a local ID with its server ID", async () => {
  let view;
  const publicText = "虚构的同步心声。";
  let item = { ...saved, id: "local-assistant-fixture", isStreaming: true, visibleMonologue: snapshot("streaming", publicText) };
  const props = () => ({ messages: [item], preferences: { skin: "classic-glass" }, onRequestInnerMonologue: () => {} });
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(Transcript, props())); });
    assert.ok(visibleText(view.toJSON()).includes(publicText));
    item = { ...saved, monologueAutoOpen: true, tool_calls: { visible_monologue: snapshot("complete", publicText) } };
    await act(async () => view.update(React.createElement(Transcript, props())));
    assert.equal(view.root.findByType("details").props.open, true);
    assert.ok(visibleText(view.toJSON()).includes(publicText));
  } finally {
    if (view) await act(async () => view.unmount());
  }
});

test("historical completed monologue has a visible first-paragraph preview while full text remains collapsible", async () => {
  let view;
  const fullText = `${"🙂".repeat(170)}\n\n第二段完整虚构心声。`;
  const item = Object.freeze({ ...saved });
  const monologue = Object.freeze(snapshot("complete", fullText));
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(ChatMessage, { item, innerMonologue: monologue })); });
    assert.equal(view.root.findByType("details").props.open, false);
    assert.ok(visibleText(view.toJSON()).includes(`${"🙂".repeat(160)}…`));
    assert.ok(!visibleText(view.toJSON()).includes("第二段完整虚构心声。"));
    await act(async () => view.root.findByType("details").props.onToggle({ currentTarget: { open: true } }));
    assert.ok(visibleText(view.toJSON()).includes(fullText));
    assert.equal(monologue.text, fullText);
  } finally {
    if (view) await act(async () => view.unmount());
  }
});

test("terminal failed and truncated public monologues allow supplementation even with partial text", () => {
  for (const state of ["missing", "failed", "truncated"]) {
    for (const value of ["", "虚构的先前片段"]) {
      assert.equal(canRequestVisibleMonologue(saved, snapshot(state, value)), true);
    }
  }
  assert.equal(canRequestVisibleMonologue(saved, snapshot("complete", "已完整生成")), false);
  assert.equal(canRequestVisibleMonologue({ ...saved, isStreaming: true }, snapshot("failed", "片段")), false);
  assert.equal(canRequestVisibleMonologue({ ...saved, generationInProgress: true }, snapshot("failed")), false);
  assert.equal(canRequestVisibleMonologue({ ...saved, role: "user" }, snapshot("missing")), false);
});

test("a failed reply requires a persisted UUID or positive-bigint user anchor and still blocks refusal residue", () => {
  const failed = { ...saved, chatError: true, content: "", visibleMonologue: snapshot("failed") };
  assert.equal(canRequestVisibleMonologue(failed), false);
  assert.equal(canRequestVisibleMonologue({ ...failed, monologueUserMessageId: "local-user-fixture" }), false);
  assert.equal(canRequestVisibleMonologue({ ...failed, monologueUserMessageId: userMessageId }), true);
  assert.equal(canRequestVisibleMonologue({ ...failed, monologueUserMessageId: "9007199254740993" }), true);
  assert.equal(canRequestVisibleMonologue({ ...failed, monologueUserMessageId: "9223372036854775807" }), true);
  assert.equal(canRequestVisibleMonologue({ ...failed, monologueUserMessageId: "9223372036854775808" }), false);
  assert.equal(canRequestVisibleMonologue({ ...failed, monologueUserMessageId: 9007199254740992 }), false);
  assert.equal(canRequestVisibleMonologue({ ...failed, monologueUserMessageId: "0" }), false);
  assert.equal(canRequestVisibleMonologue({ ...failed, monologueUserMessageId: "-1" }), false);
  assert.equal(canRequestVisibleMonologue({ ...failed, monologueUserMessageId: userMessageId, tool_calls: { refusal_detected: { code: "provider_boundary_residue" } } }), false);
});

test("real transcript shows a successful supplement over incomplete server snapshots and preserves complete synchronized text", async () => {
  let view;
  const supplement = { text: "成功补充的虚构心声", createdAt: saved.created_at, source, generated_with_reply: false, state: "complete" };
  try {
    for (const state of ["missing", "failed", "truncated", "complete"]) {
      const serverText = state === "missing" ? "" : "服务器原有虚构片段";
      const item = { ...saved, tool_calls: { visible_monologue: snapshot(state, serverText) } };
      await act(async () => {
        const element = React.createElement(Transcript, { messages: [item], preferences: { skin: "classic-glass" }, innerMonologues: { [messageId]: supplement }, onRequestInnerMonologue: () => {} });
        if (view) view.update(element);
        else view = TestRenderer.create(element);
      });
      const visible = visibleText(view.toJSON());
      if (state === "complete") {
        assert.ok(visible.includes(serverText));
        assert.ok(!visible.includes(supplement.text));
      } else {
        assert.ok(visible.includes(supplement.text));
        assert.ok(visible.includes("补充生成"));
        assert.ok(!visible.includes(serverText) || !serverText);
      }
    }
  } finally {
    if (view) await act(async () => view.unmount());
  }
});

test("real partial-monologue dialog retains the partial during pending/error and exposes deliberate retry", async () => {
  let view, requested = 0;
  const item = Object.freeze({ ...saved, content: "", chatError: true, monologueUserMessageId: userMessageId, partialContent: "虚构正文片段" });
  let props = { message: item, innerMonologue: snapshot("failed", "虚构心声片段"), onRequestInnerMonologue: received => { assert.equal(received, item); requested++; } };
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(ThinkingPanel, props)); });
    assert.ok(visibleText(view.toJSON()).includes("补充这次心声"));
    await act(async () => button(view, "补充这次心声").props.onClick());
    assert.equal(requested, 1);
    props = { ...props, innerMonologuePending: true };
    await act(async () => view.update(React.createElement(ThinkingPanel, props)));
    assert.ok(text(view.root.findByProps({ role: "dialog" })).includes("虚构心声片段"));
    assert.equal(button(view, "正在补充心声").props.disabled, true);
    props = { ...props, innerMonologuePending: false, innerMonologueError: "[fixture_failure] 虚构补充失败" };
    await act(async () => view.update(React.createElement(ThinkingPanel, props)));
    const dialog = view.root.findByProps({ role: "dialog" });
    assert.ok(text(dialog).includes("虚构心声片段"));
    assert.ok(text(dialog.findByProps({ role: "alert" })).includes("fixture_failure"));
    await act(async () => dialog.findAllByType("button").find(node => text(node.children) === "再试一次").props.onClick());
    assert.equal(requested, 2);
    assert.equal(item.content, "");
    assert.equal(item.partialContent, "虚构正文片段");
  } finally {
    if (view) await act(async () => view.unmount());
  }
});

test("real failed message with no reply body exposes supplement using its persisted user anchor", async () => {
  let view, requested;
  const item = Object.freeze({ ...saved, id: "local-failed-assistant", content: "", chatError: true, monologueUserMessageId: "9223372036854775807" });
  try {
    await act(async () => {
      view = TestRenderer.create(React.createElement(ChatMessage, {
        item,
        innerMonologue: snapshot("failed"),
        onRequestInnerMonologue: received => { requested = received; },
      }));
    });
    assert.ok(visibleText(view.toJSON()).includes("补充这次心声"));
    await act(async () => button(view, "补充这次心声").props.onClick());
    assert.equal(requested, item);
    assert.equal(item.content, "");
  } finally {
    if (view) await act(async () => view.unmount());
  }
});

test("supplement cache preserves its explicit source metadata and historical cache stays compatible", async () => {
  let view;
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  storeInnerMonologue({ messageId: "legacy", text: "旧格式虚构心声" }, storage, "fixture-account");
  storeInnerMonologue({ messageId, text: "后来补充的虚构心声", source, generated_with_reply: false, state: "complete" }, storage, "fixture-account");
  const records = readInnerMonologues(storage, "fixture-account");
  assert.equal(records.legacy.text, "旧格式虚构心声");
  assert.equal(records[messageId].generated_with_reply, false);
  assert.equal(records[messageId].source, source);
  assert.equal(records[messageId].state, "complete");
  assert.deepEqual(readInnerMonologues(storage, "other-account"), {});
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(ThinkingPanel, { message: saved, innerMonologue: records[messageId] })); });
    const visible = visibleText(view.toJSON());
    assert.ok(visible.includes("补充生成"));
    assert.ok(visible.includes("后来补充的虚构心声"));
    assert.ok(!visible.includes("已随本次回复同步保存"));
  } finally {
    if (view) await act(async () => view.unmount());
  }
});
