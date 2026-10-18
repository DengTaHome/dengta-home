import assert from "node:assert/strict";
import fs from "node:fs";
import { appendThinkingStatus } from "../src/chat-thinking.js";

assert.deepEqual(appendThinkingStatus([], "preparing_request"), [
  "正在准备并发送这条消息",
]);

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const sendStart = app.indexOf("async function sendMessage()");
const sendEnd = app.indexOf("sendMessageRef.current = sendMessage", sendStart);
assert.ok(sendStart >= 0 && sendEnd > sendStart);
const sendHandler = app.slice(sendStart, sendEnd);

const startupStart = app.indexOf("async function loadInitialData(");
const startupEnd = app.indexOf(
  "const reconnectController = createStartupReconnectController",
  startupStart,
);
assert.ok(startupStart >= 0 && startupEnd > startupStart);
const startupHandler = app.slice(startupStart, startupEnd);
assert.match(
  startupHandler,
  /apiRequest\(\s*"\/api\/v2\/bootstrap",\s*requestOptions,?\s*\)/,
  "startup must use one authenticated bootstrap request",
);
assert.doesNotMatch(
  startupHandler,
  /Promise\.all\(\[[\s\S]*?\/api\/v2\/settings[\s\S]*?\/api\/v2\/sessions[\s\S]*?\/api\/v2\/companion-state/,
  "startup must not repeat authentication across three separate requests",
);

assert.match(
  sendHandler,
  /const deviceActivityRefresh = refreshDeviceActivityContext\(\{ silent: true \}\);/,
  "device context refresh must start in parallel instead of blocking the local reply draft",
);
assert.match(
  sendHandler,
  /thinkingStatuses:\s*appendThinkingStatus\(\[\],\s*"preparing_request"\)/,
  "the assistant draft must expose a truthful local progress state immediately",
);
assert.ok(
  sendHandler.indexOf("setMessages((current) =>") <
    sendHandler.indexOf("await Promise.race("),
  "the visible assistant draft must render before the native device refresh finishes",
);

console.log("chat latency tests passed");
