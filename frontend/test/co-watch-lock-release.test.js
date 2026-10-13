import assert from "node:assert/strict";
import { createCoWatchLifecycle } from "../src/co-watch-lifecycle.js";
import { createScreenGlanceLifecycle } from "../src/screen-glance-lifecycle.js";
for (const screen of [false, true]) {
  let identity = { accountScope: "a", companionScope: "one" }, busy = false, resolve;
  const wait = new Promise(done => { resolve = done; });
  const args = { getIdentity: () => identity, getSession: () => null, isBusy: () => busy, onBusy: value => { busy = value; },
    createSession: () => wait, endSession: () => wait, onStarted: () => assert.fail("stale start applied"), onEnded: () => assert.fail("stale end applied"),
    getConfig: () => ({}), plugin: { getState: () => wait, stopSession: async () => ({}) }, preparePermission: async () => ({}), onState: () => {}, onStopped: () => {} };
  const lifecycle = screen ? createScreenGlanceLifecycle(args) : createCoWatchLifecycle(args);
  const run = lifecycle.start({ sessionMode: "direct_media" });
  assert.equal(busy, true);
  identity = { accountScope: "a", companionScope: "two" };
  resolve({ id: "old", status: "active" });
  assert.match((await run).code, /scope_changed/);
  assert.equal(busy, false, `${screen ? "screen" : "media"}: owner must release lock before delayed effect cleanup`);
  lifecycle.invalidate(); assert.equal(busy, false);
}
console.log("late scope cleanup cannot strand the owner operation lock");
