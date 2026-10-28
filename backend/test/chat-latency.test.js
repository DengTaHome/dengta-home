const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const start = server.indexOf("async function executeChatTurnOnce(");
const end = server.indexOf("async function executeChatTurn(req", start);
assert.ok(start >= 0 && end > start);
const turn = server.slice(start, end);

assert.match(
  turn,
  /const \[previousUserMessage, fetchedSettings\] = await Promise\.all\(\[/,
  "idempotency lookup and settings load must start together",
);
assert.match(
  turn,
  /const \[context, mcpRuntime\] = await Promise\.all\(\[/,
  "chat context and MCP runtime must load together before the model call",
);
assert.match(
  turn,
  /onStatus\(\{ type: "status", stage: "organizing_context" \}\);/,
  "the stream must report the real context-loading phase",
);

// 收尾阶段：回复已落库后的非关键工作不得阻塞 done，也不得把成功变成错误。
assert.match(
  turn,
  /assistantCommitted = true;/,
  "must know when the assistant reply is committed",
);
assert.match(
  turn,
  /chat_tail_persist_failed/,
  "buffer cleanup / conversation touch failures after commit must be logged, not thrown",
);
assert.match(
  turn,
  /fireAndLog\("proactive_message_schedule"/,
  "proactive message scheduling must not block the done event",
);
assert.match(
  turn,
  /fireAndLog\("autonomous_content_schedule"/,
  "autonomous content scheduling must not block the done event",
);
assert.match(
  turn,
  /deferNonCritical/,
  "streaming turns must be able to defer the memory compression LLM call",
);
assert.match(
  turn,
  /if \(deferNonCritical\) \{\s*fireAndLog\("memory_compression"/,
  "streaming turns must run memory compression in the background, not before done",
);
assert.doesNotMatch(
  turn,
  /await tryScheduleProactiveMessageEvaluation\(/,
  "proactive scheduling must not be awaited in the reply path",
);
assert.doesNotMatch(
  turn,
  /await tryScheduleAutonomousContentEvaluations\(/,
  "autonomous scheduling must not be awaited in the reply path",
);
assert.match(
  server,
  /deferNonCritical: true/,
  "the streaming chat route must defer the non-critical tail",
);

console.log("chat latency regression tests passed");
