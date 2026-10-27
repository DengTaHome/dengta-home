import assert from "node:assert/strict";
import {
  PARTIAL_REPLY_COPY,
  PARTIAL_REPLY_COPIED,
  PARTIAL_REPLY_NOTE,
  isPartialReply,
  shouldShowPartialReplyNote,
} from "../src/partial-reply.js";

// --- 标记识别 ---
assert.equal(isPartialReply({ partial_reply: true }), true, "a true flag is detected");
assert.equal(isPartialReply({ partial_reply: false }), false, "a false flag is not partial");
assert.equal(isPartialReply({ partial_reply: "true" }), false, "a string is not the boolean flag");
assert.equal(isPartialReply({}), false, "a missing flag is not partial");
assert.equal(isPartialReply(null), false, "null tool_calls is not partial");
assert.equal(isPartialReply(undefined), false, "undefined tool_calls is not partial");
assert.equal(isPartialReply("partial"), false, "a non-object is not partial");

// --- 只在有正文时提示 ---
assert.equal(
  shouldShowPartialReplyNote({ partial_reply: true }, "我抱紧你，然后"),
  true,
  "a flagged reply with text shows the note"
);
assert.equal(
  shouldShowPartialReplyNote({ partial_reply: true }, ""),
  false,
  "an empty fragment does not show a note"
);
assert.equal(
  shouldShowPartialReplyNote({ partial_reply: true }, "   \n "),
  false,
  "a whitespace-only fragment does not show a note"
);
assert.equal(
  shouldShowPartialReplyNote({}, "有正文但没有标记"),
  false,
  "text without the flag does not show the note"
);
assert.equal(
  shouldShowPartialReplyNote({ partial_reply: true }, null),
  false,
  "null content does not show the note"
);

// --- 文案与线上一致 ---
assert.equal(PARTIAL_REPLY_NOTE, "生成中断 · 已保留当时内容", "the note matches the production wording");
assert.equal(PARTIAL_REPLY_COPY, "复制片段", "the button matches the production wording");
assert.equal(PARTIAL_REPLY_COPIED, "已复制", "the copied state has its own label");

console.log(
  "Partial reply: flag detection, empty fragments, non-boolean flags, null tool_calls and production wording passed"
);
