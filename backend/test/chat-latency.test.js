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

console.log("chat latency regression tests passed");
