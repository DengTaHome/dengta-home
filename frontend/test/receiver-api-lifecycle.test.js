import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readCastReceiverSession, readReceiverToken, storeReceiverToken, clearReceiverToken } from "../src/cast-receiver-api.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("receiver cancellation finishes even if the transport ignores its signal", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Promise(() => {}); };
  const controller = new AbortController();
  const pending = readCastReceiverSession("fictional-token", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" }); assert.equal(calls, 1);
});
test("already cancelled receiver requests never reach the transport", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readCastReceiverSession("fictional-token", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 0);
});
test("receiver deadline releases a stalled request", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = async () => new Promise(() => {});
  const pending = readCastReceiverSession("fictional-token");
  t.mock.timers.tick(15_000);
  await assert.rejects(pending, { code: "cast_receiver_request_timeout" });
});
test("receiver deadline also covers a stalled JSON body", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) });
  const pending = readCastReceiverSession("fictional-token"); await Promise.resolve();
  t.mock.timers.tick(15_000);
  await assert.rejects(pending, { code: "cast_receiver_request_timeout" });
});
test("storage exceptions leave in-memory pairing usable", () => {
  const storage = { getItem() { throw new DOMException("blocked", "SecurityError"); }, setItem() { throw new DOMException("full", "QuotaExceededError"); }, removeItem() { throw new DOMException("blocked", "SecurityError"); } };
  assert.equal(readReceiverToken(storage), ""); assert.equal(storeReceiverToken(storage, "fictional-token"), "fictional-token"); assert.doesNotThrow(() => clearReceiverToken(storage));
});
