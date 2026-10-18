import test from "node:test";
import assert from "node:assert/strict";
import { createAppBackController, createBackLayerRegistry } from "../src/app-back-navigation.js";

test("keyboard, top dialog, capsule, navigation and two root backs are handled in that order", async () => {
  const calls = [], layers = createBackLayerRegistry();
  let keyboard = true, capsule = true, page = "diary", now = 1_000;
  const closeSettings = layers.register(() => { calls.push("settings"); closeSettings(); }, 200);
  const closeThought = layers.register(() => { calls.push("thought"); closeThought(); }, 300);
  const controller = createAppBackController({
    now: () => now,
    dismissKeyboard: async () => { if (!keyboard) return false; keyboard = false; calls.push("keyboard"); return true; },
    closeLayer: () => layers.closeTop() || (capsule ? (capsule = false, calls.push("capsule"), true) : false),
    goBack: () => page === "chat" ? false : (page = "chat", calls.push("chat"), true),
    showExitHint: () => calls.push("hint"), exit: () => calls.push("exit"),
  });
  for (let index = 0; index < 6; index++) await controller.back();
  assert.deepEqual(calls, ["keyboard", "thought", "settings", "capsule", "chat", "hint"]);
  now += 500; await controller.back(); assert.equal(calls.at(-1), "exit");
});

test("exit confirmation expires and is reset by a dialog, pause and scope changes", async () => {
  let now = 5, overlay = false, hints = 0, exits = 0;
  const controller = createAppBackController({ now: () => now, dismissKeyboard: async () => false,
    closeLayer: () => { if (!overlay) return false; overlay = false; return true; }, goBack: () => false,
    showExitHint: () => hints++, exit: () => exits++ });
  await controller.back(); now += 2_001; await controller.back(); assert.equal(hints, 2);
  overlay = true; await controller.back(); await controller.back(); assert.equal(hints, 3);
  controller.reset(); await controller.back(); assert.equal(hints, 4); assert.equal(exits, 0);
});

test("a late keyboard result after disposal cannot close a new account panel or exit", async () => {
  let resolve, actions = 0;
  const controller = createAppBackController({ dismissKeyboard: () => new Promise(done => { resolve = done; }),
    closeLayer: () => actions++, goBack: () => actions++, showExitHint: () => actions++, exit: () => actions++ });
  const first = controller.back(); const rapid = controller.back();
  controller.reset(); resolve(false); await Promise.all([first, rapid]); assert.equal(actions, 0);
  controller.dispose(); await controller.back(); assert.equal(actions, 0);
});

test("equal priority layers close the most recently opened and unregister on unmount", () => {
  const layers = createBackLayerRegistry(), calls = [];
  const removeA = layers.register(() => calls.push("A"), 200);
  const removeB = layers.register(() => calls.push("B"), 200);
  layers.closeTop(); removeB(); layers.closeTop(); removeA();
  assert.deepEqual(calls, ["B", "A"]); assert.equal(layers.closeTop(), false);
});
