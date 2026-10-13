import assert from "node:assert/strict";
import test from "node:test";
import { readChatDisplayContent } from "../src/chat-display-content.js";

const suffix = JSON.stringify({ next_best_actions: ["一起听歌 🎵", "画一张小涂鸦"] });
test("only a complete assistant's exact trailing payload becomes readable suggestions, without mutation", () => {
  const message = Object.freeze({ role: "assistant", content: `虚构回复。\n\n${suffix}` });
  assert.deepEqual(readChatDisplayContent(message), { content: "虚构回复。", nextActions: ["一起听歌 🎵", "画一张小涂鸦"] });
  assert.equal(message.content, `虚构回复。\n\n${suffix}`);
});
test("user JSON, code examples, streams, failures and unrelated or invalid structures remain verbatim", () => {
  const inputs = [
    { role: "user", content: `例子\n\n${suffix}` },
    { role: "assistant", content: `例子\n\n${suffix}`, isStreaming: true },
    { role: "assistant", content: `例子\n\n${suffix}`, generationInProgress: true },
    { role: "assistant", content: `错误\n\n${suffix}`, chatError: true },
    ...[suffix, `代码示例\n\n\`\`\`json\n${suffix}\n\`\`\``, `示例\n\n~~~json\n${suffix}\n~~~`, '正文\n\n{"next_best_actions":[]}', '正文\n\n{"next_best_actions":[{}]}', '正文\n\n{"next_best_actions":["x"],"other":"y"}', '正文\n\n{"next_best_actions":["x"]', '正文\n\n{"other":["x"]}', `正文\n\n${suffix}\n其他正文`, `正文\n\n${JSON.stringify({ next_best_actions: ["字".repeat(241)] })}`].map(content => ({ role: "assistant", content })),
  ];
  for (const input of inputs) assert.deepEqual(readChatDisplayContent(input), { content: input.content, nextActions: [] });
});
