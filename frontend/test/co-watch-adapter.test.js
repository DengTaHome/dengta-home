import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const calls = [];
let receipt;
globalThis.__coWatchAdapterFixture = {
  request(path, options) { calls.push({ path, options }); return Promise.resolve(receipt); },
};
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true },
  plugins: [{
    name: "co-watch-adapter-fixture", enforce: "pre",
    load(id) {
      const path = id.replaceAll("\\", "/");
      if (path.endsWith("/src/api.js")) return 'export const apiRequest=(...args)=>globalThis.__coWatchAdapterFixture.request(...args);';
      if (path.endsWith("/src/auth-session.js")) return "export const authSession={};";
    },
  }],
});
const { sendCoWatchReply } = await vite.ssrLoadModule("/src/co-watch.js");
after(async () => { await vite.close(); delete globalThis.__coWatchAdapterFixture; });

test("actual co-watch reply adapter preserves every timed danmaku receipt without rewriting text", async () => {
  const danmaku = [
    { text: "  虚构字幕👩🏽‍🚀\r\n ", media_time_seconds: 12.25, color: "fixture" },
    { text: "第二行", media_time_seconds: 0 },
  ];
  const assistant = { id: "fictional-assistant", content: "Fictional response" };
  receipt = { reaction: "Fictional response", danmaku, assistant_message: assistant };
  const result = await sendCoWatchReply("fictional/session", "Fictional input", 12);
  assert.deepEqual(result.danmaku, danmaku);
  assert.equal(result.assistantMessage, assistant);
  assert.equal(result.reaction, receipt.reaction);
  assert.equal(calls.at(-1).path, "/api/v2/co-watch/sessions/fictional%2Fsession/reply");
  const body = JSON.parse(calls.at(-1).options.body);
  assert.equal(body.text, "Fictional input");
  assert.equal(body.media_position_seconds, 12);
  assert.equal(body.request_id, result.requestId);
});

test("actual co-watch reply adapter supplies an empty list for absent or malformed danmaku", async () => {
  for (const danmaku of [undefined, null, "fixture", { text: "fixture" }]) {
    receipt = { reaction: "Fictional response", danmaku };
    const result = await sendCoWatchReply("fictional-session", "Fictional input");
    assert.deepEqual(result.danmaku, []);
  }
});

test("rejects abnormal reaction types before normalization can turn them into text", async () => {
  for (const reaction of [{}, [], ["fictional"], true, false, 0, 12]) {
    receipt = { reaction };
    await assert.rejects(sendCoWatchReply("fictional-session", "Fictional input"), { code: "co_watch_reply_receipt_invalid" });
  }
});

test("rejects abnormal assistant message or content types without falling back to object text", async () => {
  for (const assistant_message of ["fictional", [], { content: {} }, { content: true }, { content: ["fictional"] }]) {
    receipt = { assistant_message };
    await assert.rejects(sendCoWatchReply("fictional-session", "Fictional input"), { code: "co_watch_reply_receipt_invalid" });
  }
});

test("rejects empty or nonobject successful envelopes without echoing raw data", async () => {
  for (const value of [null, {}, [], "fictional response", { status: "failed" }, { reaction: "  " }]) {
    receipt = value;
    await assert.rejects(sendCoWatchReply("fictional-session", "Fictional input"), error => {
      assert.equal(error.code, "co_watch_reply_receipt_invalid");
      assert.match(error.message, /刷新/);
      assert.doesNotMatch(error.message, /fictional response|failed/);
      return true;
    });
  }
});

test("preserves legitimate string literals without keyword rejection", async () => {
  for (const reaction of ["true", "false", "0", "[object Object]", "剧情中她拒绝了邀请", "普通虚构对白💙"]) {
    receipt = { reaction };
    assert.equal((await sendCoWatchReply("fictional-session", "Fictional input")).reaction, reaction);
  }
});

test("accepts a plain assistant message fallback and preserves its original content", async () => {
  const assistant = { id: "fictional-assistant", content: "  虚构后备回复\n💙  " };
  receipt = { reaction: null, assistant_message: assistant };
  const result = await sendCoWatchReply("fictional-session", "Fictional input");
  assert.equal(result.reaction, "");
  assert.equal(result.assistantMessage, assistant);
  assert.equal(result.assistantMessage.content, assistant.content);
});
