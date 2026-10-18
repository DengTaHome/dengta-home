import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import {
  appendPublicProviderSummary,
  attachThinkingTrace,
  hydrateStoredThinkingTrace,
  thinkingPanelVisible,
} from "../src/chat-thinking.js";
import { VISIBLE_MONOLOGUE_SOURCE } from "../src/inner-monologue.js";

const publicEvent = content => ({ type: "reasoning", source: "provider_summary", public: true, content });
const text = node => typeof node === "string" ? node :
  (Array.isArray(node) ? node : node?.children || []).map(text).join("");

test("only explicitly public provider-summary events alter the transient trace", () => {
  const trace = Object.freeze({ statuses: [], summary: "", lastReasoningSource: "" });
  for (const event of [
    { type: "reasoning", source: "provider_summary", content: "unmarked fixture" },
    { ...publicEvent("fixture"), public: false },
    { ...publicEvent("fixture"), public: "true" },
    { ...publicEvent("fixture"), source: "reasoning_content" },
    { ...publicEvent("fixture"), type: "text" },
    { ...publicEvent("fixture"), type: "monologue" },
    publicEvent({ private: "fixture" }),
    publicEvent(""),
    null,
  ]) assert.equal(appendPublicProviderSummary(trace, event), trace);
  assert.deepEqual(trace, { statuses: [], summary: "", lastReasoningSource: "" });
});

test("public summary appends with whitespace preserved and never adopts an untrusted previous summary", () => {
  const initial = { statuses: ["fixture-status"], summary: "untrusted fixture", lastReasoningSource: "raw_reasoning" };
  let trace = appendPublicProviderSummary(initial, publicEvent("  第一行\n"));
  trace = appendPublicProviderSummary(trace, publicEvent("\t第二行  \u0000"));
  assert.equal(trace.summary, "  第一行\n\t第二行  ");
  assert.equal(trace.lastReasoningSource, "provider_summary");
  assert.equal(trace.statuses, initial.statuses);
  assert.equal(initial.summary, "untrusted fixture");
});

test("public summary caps at 6000 Unicode characters without splitting emoji or creating repeated commits", () => {
  const trace = appendPublicProviderSummary({}, publicEvent("🙂".repeat(6001)));
  assert.equal(Array.from(trace.summary).length, 6000);
  assert.equal(trace.summary, "🙂".repeat(6000));
  assert.equal(appendPublicProviderSummary(trace, publicEvent("more fixture")), trace);
});

test("attaching a current trace marks only provider summaries and cannot trust fields on a server message", () => {
  const message = Object.freeze({ thinkingSummary: "untrusted fixture", thinkingSummarySource: "provider_summary", reasoning_content: "raw fixture" });
  const blocked = attachThinkingTrace(message, { statuses: [], summary: "unmarked fixture" });
  assert.equal(blocked.thinkingSummary, "");
  assert.equal("thinkingSummarySource" in blocked, false);
  assert.equal("reasoning_content" in blocked, false);
  const trace = appendPublicProviderSummary({}, publicEvent("  公开摘要\n"));
  const allowed = attachThinkingTrace(message, trace);
  assert.equal(allowed.thinkingSummary, "  公开摘要\n");
  assert.equal(allowed.thinkingSummarySource, "provider_summary");
  assert.equal(thinkingPanelVisible({ thinkingSummary: "unmarked fixture" }), false);
  assert.equal(thinkingPanelVisible(allowed), true);
});

test("stored history drops summary and source fields even when old storage claims a public source", () => {
  const fields = { thinkingSummary: "fixture", thinkingSummarySource: "provider_summary", thinking_summary: "fixture", thinking_summary_source: "provider_summary", lastReasoningSource: "provider_summary" };
  const message = Object.freeze({ id: "fixture", ...fields, tool_calls: { ...fields, processing_stages: ["completed"] } });
  const hydrated = hydrateStoredThinkingTrace(message);
  for (const name of Object.keys(fields)) {
    assert.equal(name in hydrated, false);
    assert.equal(name in hydrated.tool_calls, false);
    assert.equal(name in message, true);
  }
  assert.deepEqual(hydrated.thinkingStatuses, ["本轮处理完成"]);
});

test("real panel displays provider public summary in a separate area from authored visible monologue", async () => {
  const previousDocument = globalThis.document;
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.document = new EventTarget();
  const vite = await createServer({ envFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  let view;
  try {
    const { ThinkingPanel } = await vite.ssrLoadModule("/src/ChatMessageExtras.jsx");
    const props = {
      message: { role: "assistant", isStreaming: true, thinkingSummary: "  虚构接口公开摘要\n", thinkingSummarySource: "provider_summary" },
      innerMonologue: { state: "streaming", source: VISIBLE_MONOLOGUE_SOURCE, text: "虚构角色心声" },
    };
    await act(async () => { view = TestRenderer.create(React.createElement(ThinkingPanel, props)); });
    const summary = view.root.findByProps({ "aria-label": "接口提供的公开推理摘要" });
    assert.ok(text(summary).includes("不是隐藏的原始思考链，也不是角色心声"));
    assert.equal(text(summary.findByType("p")), "  虚构接口公开摘要\n");
    assert.ok(!text(summary).includes("虚构角色心声"));
    const details = view.root.findByType("details");
    assert.ok(text(details).includes("虚构角色心声"));
    assert.ok(!text(details).includes("虚构接口公开摘要"));
    await act(async () => view.update(React.createElement(ThinkingPanel, { ...props, message: { ...props.message, thinkingSummarySource: "raw_reasoning" } })));
    assert.equal(view.root.findAllByProps({ "aria-label": "接口提供的公开推理摘要" }).length, 0);
    assert.ok(!text(view.toJSON()).includes("虚构接口公开摘要"));
  } finally {
    if (view) await act(async () => view.unmount());
    await vite.close();
    globalThis.document = previousDocument;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});
