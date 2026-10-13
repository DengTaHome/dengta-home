import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INNER_MONOLOGUE_STORAGE_KEY,
  VISIBLE_MONOLOGUE_SOURCE,
  innerMonologueForMessage,
  isSynchronizedVisibleMonologue,
  readInnerMonologues,
  reduceVisibleMonologueEvent,
  storeInnerMonologue,
  visibleMonologueForMessage,
  canRequestVisibleMonologue,
} from "../src/inner-monologue.js";
import { hydrateChatHistory } from "../src/chat-history.js";
import { mergeStreamedAssistantMessage } from "../src/chat-thinking.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

const storage = createStorage();
const saved = storeInnerMonologue(
  {
    messageId: "assistant-1",
    text: `\u0000${"我想安静地把这个念头写下来。".repeat(80)}`,
    createdAt: "2026-08-02T10:00:00.000Z",
  },
  storage,
);

assert.equal(saved["assistant-1"].text.includes("\u0000"), false);
assert.equal(saved["assistant-1"].text.length > 800, true);
assert.equal(
  innerMonologueForMessage(readInnerMonologues(storage), "assistant-1").text,
  saved["assistant-1"].text,
);
assert.ok(storage.getItem(INNER_MONOLOGUE_STORAGE_KEY));

storeInnerMonologue(
  { messageId: "assistant-a", text: "账号甲的心声" },
  storage,
  "account-a",
);
storeInnerMonologue(
  { messageId: "assistant-b", text: "账号乙的心声" },
  storage,
  "account-b",
);
assert.equal(
  readInnerMonologues(storage, "account-a")["assistant-a"].text,
  "账号甲的心声",
);
assert.equal(
  readInnerMonologues(storage, "account-a")["assistant-b"],
  undefined,
);
assert.equal(
  readInnerMonologues(storage, "account-b")["assistant-b"].text,
  "账号乙的心声",
);

const malformedStorage = createStorage({
  [INNER_MONOLOGUE_STORAGE_KEY]: "not-json",
});
assert.deepEqual(readInnerMonologues(malformedStorage), {});

const firstDelta = reduceVisibleMonologueEvent(null, {
  type: "monologue",
  phase: "delta",
  source: VISIBLE_MONOLOGUE_SOURCE,
  content: "我先接住你的感受",
  segment: 0,
  offset: 0,
});
assert.deepEqual(
  {
    text: firstDelta.text,
    state: firstDelta.state,
    source: firstDelta.source,
    stream_offset: firstDelta.stream_offset,
  },
  {
    text: "我先接住你的感受",
    state: "streaming",
    source: VISIBLE_MONOLOGUE_SOURCE,
    stream_offset: 8,
  },
);

const duplicateDelta = reduceVisibleMonologueEvent(firstDelta, {
  type: "monologue",
  phase: "delta",
  source: VISIBLE_MONOLOGUE_SOURCE,
  content: "我先接住你的感受",
  segment: 0,
  offset: 0,
});
assert.equal(duplicateDelta.text, "我先接住你的感受");

let segmentedDelta = reduceVisibleMonologueEvent(null, {
  type: "monologue",
  phase: "delta",
  source: VISIBLE_MONOLOGUE_SOURCE,
  content: "First.",
  segment: 0,
  offset: 0,
});
segmentedDelta = reduceVisibleMonologueEvent(segmentedDelta, {
  type: "monologue",
  phase: "delta",
  source: VISIBLE_MONOLOGUE_SOURCE,
  content: " More.",
  segment: 0,
  offset: 6,
});
segmentedDelta = reduceVisibleMonologueEvent(segmentedDelta, {
  type: "monologue",
  phase: "delta",
  source: VISIBLE_MONOLOGUE_SOURCE,
  content: "Second.",
  segment: 1,
  offset: 0,
});
assert.equal(
  segmentedDelta.text,
  "First. More.\n\nSecond.",
  "a tool-follow-up assistant segment must remain visible in the live monologue",
);
assert.equal(segmentedDelta.stream_segment, 1);
assert.equal(segmentedDelta.stream_offset, 7);
const duplicateSecondSegment = reduceVisibleMonologueEvent(segmentedDelta, {
  type: "monologue",
  phase: "delta",
  source: VISIBLE_MONOLOGUE_SOURCE,
  content: "Second.",
  segment: 1,
  offset: 0,
});
assert.equal(
  duplicateSecondSegment.text,
  "First. More.\n\nSecond.",
  "replayed segment-local deltas must be idempotent",
);
const continuedSecondSegment = reduceVisibleMonologueEvent(
  duplicateSecondSegment,
  {
    type: "monologue",
    phase: "delta",
    source: VISIBLE_MONOLOGUE_SOURCE,
    content: " Again.",
    segment: 1,
    offset: 7,
  },
);
assert.equal(
  continuedSecondSegment.text,
  "First. More.\n\nSecond. Again.",
);
const replayedEarlierSegment = reduceVisibleMonologueEvent(
  continuedSecondSegment,
  {
    type: "monologue",
    phase: "delta",
    source: VISIBLE_MONOLOGUE_SOURCE,
    content: "First.",
    segment: 0,
    offset: 0,
  },
);
assert.equal(
  replayedEarlierSegment.text,
  "First. More.\n\nSecond. Again.",
  "a replay from an already-settled segment must not duplicate its text",
);

let whitespaceSegment = reduceVisibleMonologueEvent(null, {
  type: "monologue",
  phase: "delta",
  source: VISIBLE_MONOLOGUE_SOURCE,
  content: "  First with provider whitespace.  ",
  segment: 0,
  offset: 0,
});
whitespaceSegment = reduceVisibleMonologueEvent(whitespaceSegment, {
  type: "monologue",
  phase: "delta",
  source: VISIBLE_MONOLOGUE_SOURCE,
  content: "  Second with provider whitespace.  ",
  segment: 1,
  offset: 0,
});
whitespaceSegment = reduceVisibleMonologueEvent(whitespaceSegment, {
  type: "monologue",
  phase: "end",
  source: VISIBLE_MONOLOGUE_SOURCE,
  state: "complete",
});
assert.equal(
  whitespaceSegment.text,
  "First with provider whitespace.\n\nSecond with provider whitespace.",
  "the live terminal text must match the server snapshot's per-segment trim and blank-line join",
);

const unicodeDelta = reduceVisibleMonologueEvent(null, {
  type: "monologue",
  phase: "delta",
  source: VISIBLE_MONOLOGUE_SOURCE,
  content: "想🙂",
  offset: 0,
});
assert.equal(unicodeDelta.stream_offset, 2);
assert.equal(
  reduceVisibleMonologueEvent(unicodeDelta, {
    type: "monologue",
    phase: "delta",
    source: VISIBLE_MONOLOGUE_SOURCE,
    content: "继续",
    offset: 4,
  }).text,
  "想🙂",
  "a gap in Unicode code-point offsets must not corrupt the visible text",
);

const completedStream = reduceVisibleMonologueEvent(duplicateDelta, {
  type: "monologue",
  phase: "end",
  source: VISIBLE_MONOLOGUE_SOURCE,
  state: "complete",
  display_truncated: false,
});
const lateDelta = reduceVisibleMonologueEvent(completedStream, {
  type: "monologue",
  phase: "delta",
  source: VISIBLE_MONOLOGUE_SOURCE,
  content: "不应在终态后追加",
  offset: 8,
});
assert.equal(lateDelta.state, "complete");
assert.equal(lateDelta.text, completedStream.text);
const failedAfterComplete = reduceVisibleMonologueEvent(completedStream, {
  type: "monologue", phase: "end", source: VISIBLE_MONOLOGUE_SOURCE, state: "failed",
});
assert.equal(failedAfterComplete.state, "failed", "a later failed turn invalidates the provisional completion");
assert.equal(failedAfterComplete.text, completedStream.text);

const missingStream = reduceVisibleMonologueEvent(null, {
  type: "monologue",
  phase: "end",
  source: VISIBLE_MONOLOGUE_SOURCE,
  state: "missing",
});
assert.equal(missingStream.text, "");
assert.equal(isSynchronizedVisibleMonologue(missingStream), true);
assert.equal(canRequestVisibleMonologue({ visibleMonologue: missingStream }), true);
assert.equal(canRequestVisibleMonologue({ visibleMonologue: completedStream }), false);
assert.equal(canRequestVisibleMonologue({ visibleMonologue: missingStream, chatError: true }), false);
for (const state of ["complete", "missing", "truncated", "failed"]) {
  const empty = { ...missingStream, state };
  assert.equal(canRequestVisibleMonologue({ visibleMonologue: empty }), true);
  assert.equal(canRequestVisibleMonologue({ visibleMonologue: empty, generationInProgress: true }), false);
  assert.equal(canRequestVisibleMonologue({ visibleMonologue: { ...empty, text: "已有可见心声" } }), false);
}
assert.equal(canRequestVisibleMonologue({ tool_calls: { visible_monologue: null } }), true);
assert.equal(canRequestVisibleMonologue({ role: "user" }), false);
assert.equal(canRequestVisibleMonologue({ tool_calls: { refusal_detected: { source: "upstream" } } }), false);
assert.equal(
  reduceVisibleMonologueEvent(null, {
    type: "monologue",
    phase: "delta",
    source: "provider_summary",
    content: "供应商隐藏推理不得进入公开心声",
  }),
  null,
);

const [hydratedAssistant] = hydrateChatHistory([
  {
    id: "assistant-history",
    role: "assistant",
    content: "最终净正文",
    reasoning_content: "隐藏的原始推理",
    visibleMonologue: {
      text: "直播草稿不应覆盖持久化结果",
      state: "streaming",
      source: VISIBLE_MONOLOGUE_SOURCE,
    },
    tool_calls: {
      visible_monologue: {
        schema_version: 1,
        text: "这是随回复保存的 AI 可见心声。",
        state: "complete",
        source: VISIBLE_MONOLOGUE_SOURCE,
        generated_with_reply: true,
        segment_count: 1,
        display_truncated: false,
      },
    },
  },
]);
const hydratedMonologue = visibleMonologueForMessage(hydratedAssistant);
assert.equal(hydratedMonologue.text, "这是随回复保存的 AI 可见心声。");
assert.equal(hydratedMonologue.state, "complete");
assert.equal(isSynchronizedVisibleMonologue(hydratedMonologue), true);
assert.equal("reasoning_content" in hydratedAssistant, false);

const doneMergedMessage = mergeStreamedAssistantMessage(
  {
    id: "local-assistant",
    content: "直播正文",
    visibleMonologue: completedStream,
  },
  {
    id: "assistant-saved",
    content: "最终净正文",
    tool_calls: {
      visible_monologue: {
        schema_version: 1,
        text: "服务端权威心声",
        state: "complete",
        source: VISIBLE_MONOLOGUE_SOURCE,
        generated_with_reply: true,
      },
    },
  },
);
assert.equal(doneMergedMessage.content, "最终净正文");
assert.equal(doneMergedMessage.visibleMonologue.text, "服务端权威心声");
assert.equal(doneMergedMessage.visibleMonologue.state, "complete");

const doneMissingMessage = mergeStreamedAssistantMessage(
  {
    id: "local-assistant-missing",
    visibleMonologue: completedStream,
  },
  {
    id: "assistant-saved-missing",
    content: "只有最终净正文",
    tool_calls: {
      visible_monologue: {
        schema_version: 1,
        text: "",
        state: "missing",
        source: VISIBLE_MONOLOGUE_SOURCE,
        generated_with_reply: true,
      },
    },
  },
);
assert.equal(doneMissingMessage.visibleMonologue.text, "");
assert.equal(doneMissingMessage.visibleMonologue.state, "missing");

const missingSnapshot = visibleMonologueForMessage({
  tool_calls: {
    visible_monologue: {
      schema_version: 1,
      text: "",
      state: "missing",
      source: VISIBLE_MONOLOGUE_SOURCE,
      generated_with_reply: true,
    },
  },
});
assert.ok(missingSnapshot, "an authoritative missing snapshot must be retained");
assert.equal(missingSnapshot.state, "missing");

const messageExtrasSource = readFileSync(
  new URL("../src/ChatMessageExtras.jsx", import.meta.url),
  "utf8",
);
const appStylesSource = readFileSync(
  new URL("../src/index.css", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../src/App.jsx", import.meta.url),
  "utf8",
);
assert.match(messageExtrasSource, /setMonologueDialogOpen\(true\)/);
assert.match(messageExtrasSource, /className="inner-monologue-dialog-backdrop"/);
assert.match(messageExtrasSource, /role="dialog"/);
assert.match(messageExtrasSource, /aria-modal="true"/);
assert.match(appStylesSource, /\.inner-monologue-dialog-backdrop\s*\{/);
assert.match(appStylesSource, /\.inner-monologue-dialog\s*\{/);
assert.match(appSource, /\/companion\/inner-monologue/);
assert.match(appSource, /timeoutMs:\s*300\s*\*\s*1000/);
assert.match(appSource, /event\.type === "monologue"/);
assert.match(appSource, /reduceVisibleMonologueEvent/);
assert.match(appSource, /<ChatTranscript/);
assert.match(readFileSync(new URL("../src/ChatTranscript.jsx", import.meta.url), "utf8"), /visibleMonologueForMessage\(item\)/);
assert.match(messageExtrasSource, /AI 生成的可见心声/);
assert.match(messageExtrasSource, /不是模型隐藏的原始思考链/);
const requestHandlerStart = appSource.indexOf(
  "async function requestVisibleInnerMonologue(item)",
);
const recoveryImport = appSource.indexOf(
  '"./inner-monologue-sync.js"',
  requestHandlerStart,
);
const synchronizedGuard = appSource.indexOf(
  "canRequestVisibleMonologue(item)",
  requestHandlerStart,
);
assert.ok(
  requestHandlerStart >= 0 &&
    synchronizedGuard > requestHandlerStart &&
    synchronizedGuard < recoveryImport,
  "a synchronized message must return before legacy ID recovery or a second request",
);
const streamHandlerStart = appSource.indexOf('await streamChat(');
const streamHandlerEnd = appSource.indexOf(
  'const history = await apiRequest(',
  streamHandlerStart,
);
const streamHandlerSource = appSource.slice(
  streamHandlerStart,
  streamHandlerEnd,
);
assert.doesNotMatch(
  streamHandlerSource,
  /storeInnerMonologue|setInnerMonologues/,
  "live monologue deltas must remain on the assistant draft, not write localStorage",
);
const sendMessageEnd = appSource.indexOf(
  "function scheduleSettingsAutosave",
  streamHandlerStart,
);
const sendMessageErrorSource = appSource.slice(
  appSource.indexOf("} catch (error)", streamHandlerEnd),
  sendMessageEnd,
);
assert.match(
  sendMessageErrorSource,
  /visibleMonologue:\s*reduceVisibleMonologueEvent\([\s\S]*state:\s*"failed"/,
  "a broken stream must settle the public monologue instead of leaving it syncing forever",
);

console.log("inner monologue local-cache checks passed");
