import assert from "node:assert/strict";
import {
  STREAMING_PARTIAL_PREFIX,
  mergeStreamingPartial,
  streamingPartialMessage
} from "../src/streaming-partial.js";

const PARTIAL = {
  clientMessageId: "client-1",
  content: "我抱紧你，然后",
  updatedAt: "2026-10-27T12:00:00.000Z"
};

// --- 构造 ---
{
  const message = streamingPartialMessage(PARTIAL);
  assert.equal(message.role, "assistant", "the partial renders as an assistant message");
  assert.equal(message.content, PARTIAL.content, "the generated text is preserved exactly");
  assert.equal(message.isStreaming, true, "it is marked as still streaming");
  assert.equal(
    message.id,
    `${STREAMING_PARTIAL_PREFIX}client-1`,
    "the id is namespaced so it can never collide with a real message id"
  );
  assert.equal(message.client_message_id, "client-1", "the client message id is kept for matching");
}

// --- 空内容不显示 ---
{
  assert.equal(streamingPartialMessage({ content: "" }), null, "empty content is not rendered");
  assert.equal(streamingPartialMessage({ content: "   " }), null, "whitespace-only content is not rendered");
  assert.equal(streamingPartialMessage(null), null, "null is not rendered");
  assert.equal(streamingPartialMessage({}), null, "missing content is not rendered");
}

// --- 追加 ---
{
  const history = [{ id: "m1", role: "user", content: "在吗" }];
  const merged = mergeStreamingPartial(history, PARTIAL);
  assert.equal(merged.length, 2, "the partial is appended after the history");
  assert.equal(merged[1].isStreaming, true, "the appended row is the streaming one");
  assert.equal(history.length, 1, "the input array is not mutated");
}

// --- 有正式消息就不追加（避免重影）---
{
  const history = [
    { id: "m1", role: "user", content: "在吗" },
    { id: "m2", role: "assistant", content: "我抱紧你，然后就不说话了", client_message_id: "client-1" }
  ];
  const merged = mergeStreamingPartial(history, PARTIAL);
  assert.equal(merged.length, 2, "a committed reply suppresses the streaming placeholder");
  assert.equal(merged, history, "the original array is returned untouched");
}

// --- 重复拉取：替换而不是重复追加 ---
{
  const first = mergeStreamingPartial([], PARTIAL);
  const second = mergeStreamingPartial(first, { ...PARTIAL, content: "我抱紧你，然后就不说话了。" });
  assert.equal(second.length, 1, "reloading replaces the placeholder instead of appending a second one");
  assert.equal(second[0].content, "我抱紧你，然后就不说话了。", "the newer, longer text wins");
  assert.equal(first[0].content, "我抱紧你，然后", "the earlier snapshot is untouched");
}

// --- 没有部分内容时原样返回 ---
{
  const history = [{ id: "m1" }];
  assert.equal(mergeStreamingPartial(history, null), history, "no partial means no change");
  assert.equal(mergeStreamingPartial(null, PARTIAL).length, 1, "a null history still produces the partial");
}

// --- 部分缺少 clientMessageId ---
{
  const message = streamingPartialMessage({ content: "半句话" });
  assert.equal(message.id, `${STREAMING_PARTIAL_PREFIX}unknown`, "a missing id still yields a namespaced id");
  assert.equal(message.client_message_id, undefined, "no fabricated client message id");
}

console.log(
  "Streaming partial UI: assistant shape, namespaced id, empty suppression, append, committed-reply suppression, reload replacement and missing ids passed"
);
