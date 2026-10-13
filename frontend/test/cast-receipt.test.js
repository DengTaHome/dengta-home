import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitCastReceipt } from "../src/cast-receipt.js";

test("bridge deadline releases the waiter without retrying or accepting a late receipt", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve;
  const request = new Promise(yes => { resolve = yes; });
  const result = awaitCastReceipt(request, { timeoutMs: 3000, code: "cast_stop_timeout" });
  const rejected = assert.rejects(result, error => error.code === "cast_stop_timeout");
  t.mock.timers.tick(3000);
  await rejected;
  resolve({ completed: true });
  await Promise.resolve();
});

test("cancelled media does not hold the UI and late native rejection is observed", async () => {
  const controller = new AbortController();
  let reject;
  const request = new Promise((yes, no) => { reject = no; });
  const result = awaitCastReceipt(request, { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, error => error.name === "AbortError");
  reject(new Error("late native failure"));
  await Promise.resolve();
  await assert.rejects(awaitCastReceipt(Promise.reject(new Error("already cancelled")), { signal: controller.signal }), error => error.name === "AbortError");
});

test("confirmed result and precise native error survive the wrapper", async () => {
  const receipt = { playWhenReady: false, positionMs: 41000 };
  assert.equal(await awaitCastReceipt(Promise.resolve(receipt)), receipt);
  const error = Object.assign(new Error("fixture"), { code: "playback_media_changed" });
  await assert.rejects(awaitCastReceipt(Promise.reject(error)), result => result === error);
});
