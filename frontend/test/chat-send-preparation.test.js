import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import test from "node:test";
import { awaitChatPreparation } from "../src/chat-send-preparation.js";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const send = app.indexOf("async function sendMessage()");
const start = app.indexOf("    isSendingRef.current = true;", send);
const end = app.indexOf("    if (voiceStateRef.current === VOICE_STATES.speaking)", start);
assert.ok(send >= 0 && start > send && end > start);
const preparation = app.slice(start, end);
const abortStart = app.indexOf("function abortChatRequest(");
const abortEnd = app.indexOf("function hydrateSessionChatHistory", abortStart);
const release = request => {
  if (request.attachmentsReleased) return;
  request.attachmentsReleased = true;
  request.attachments.forEach(item => { item.released = true; });
};
const abort = compileFunction("return " + app.slice(abortStart, abortEnd), ["releaseChatRequestAttachments"])(release);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture({ save = Promise.resolve(true), model = Promise.resolve(), preserve = false } = {}) {
  const context = {
    AbortController, DOMException, awaitChatPreparation,
    isSendingRef: { current: false }, activeSessionIdRef: { current: "a" },
    chatRequestRef: { current: null }, componentMountedRef: { current: true },
    sessionModelSaveQueueRef: { current: model }, attachmentsToSend: [{ id: "fake-file", released: false }],
    preserveComposer: preserve, stage: "", notice: "", sending: false, reached: 0,
    abortChatRequest: abort, releaseChatRequestAttachments: release,
    refreshDeviceActivityContext: () => Promise.resolve(), flushLatestSettingsDraft: () => save,
  };
  context.setIsSending = value => { context.sending = value; };
  context.setSendPreparationStage = value => { context.stage = value; };
  context.setNotice = value => { context.notice = value; };
  const names = Object.keys(context);
  const run = compileFunction(`return (async () => {${preparation}\n reachedSend();})();`, [...names, "reachedSend"]);
  return { context, run: () => run(...names.map(name => context[name]), () => { context.reached++; }) };
}

test("actual App preparation stops while settings are pending; late success cannot send or release composer files", async () => {
  const save = deferred(), f = fixture({ save: save.promise });
  const run = f.run();
  assert.equal(f.context.stage, "settings");
  assert.equal(f.context.sending, true);
  abort(f.context.chatRequestRef, "user-cancel");
  await run;
  assert.equal(f.context.reached, 0);
  assert.equal(f.context.sending, false);
  assert.equal(f.context.chatRequestRef.current, null);
  assert.equal(f.context.attachmentsToSend[0].released, false);
  assert.match(f.context.notice, /本轮尚未发送/);
  save.resolve(true); await Promise.resolve();
  assert.equal(f.context.reached, 0);
});

test("model wait is cancellable and a changed conversation cannot inherit the send", async () => {
  const model = deferred(), f = fixture({ model: model.promise });
  const run = f.run();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(f.context.stage, "model");
  abort(f.context.chatRequestRef, "session-change");
  await run;
  assert.equal(f.context.reached, 0);
  assert.equal(f.context.attachmentsToSend[0].released, false);
  model.resolve(); await Promise.resolve();
  assert.equal(f.context.reached, 0);

  const save = deferred(), changed = fixture({ save: save.promise });
  const otherRun = changed.run(); changed.context.activeSessionIdRef.current = "b";
  save.resolve(true); await otherRun;
  assert.equal(changed.context.reached, 0);
});

test("settings failures keep the draft and expose a precise local code without raw exception text", async () => {
  const f = fixture({ save: Promise.resolve(false) }); await f.run();
  assert.equal(f.context.reached, 0);
  assert.match(f.context.notice, /chat_preparation_settings_unsaved/);
  assert.equal(f.context.attachmentsToSend[0].released, false);
  const rejected = fixture({ save: Promise.reject(new Error("synthetic-private-detail")) });
  await rejected.run(); assert.match(rejected.context.notice, /chat_preparation_failed/);
  assert.doesNotMatch(rejected.context.notice, /synthetic-private-detail/);
  const unexpected = fixture({ save: Promise.reject(null) }); await unexpected.run();
  assert.match(unexpected.context.notice, /chat_preparation_failed/);
  assert.equal(unexpected.context.sending, false);
});

test("ready preparation transfers attachment ownership only once; temporary screen attachments are released on stop", async () => {
  const ready = fixture(); await ready.run();
  assert.equal(ready.context.reached, 1);
  assert.equal(ready.context.chatRequestRef.current.attachments, ready.context.attachmentsToSend);
  const save = deferred(), screen = fixture({ save: save.promise, preserve: true });
  const run = screen.run();
  await Promise.resolve(); await Promise.resolve();
  abort(screen.context.chatRequestRef, "user-cancel"); await run;
  assert.equal(screen.context.attachmentsToSend[0].released, true);
  assert.match(screen.context.notice, /临时画面已释放/);
  assert.doesNotMatch(screen.context.notice, /保留在输入框/);
  save.reject(new Error("late test failure")); await Promise.resolve();
});

test("an aborted wait does not start saving and listeners are removed after normal settlement", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(awaitChatPreparation(() => { calls++; }, controller.signal), { name: "AbortError" });
  assert.equal(calls, 0);
  const current = new AbortController(); let removed = 0;
  const remove = current.signal.removeEventListener.bind(current.signal);
  current.signal.removeEventListener = (...args) => { removed++; return remove(...args); };
  assert.equal(await awaitChatPreparation(() => 42, current.signal), 42);
  assert.equal(removed, 1);
});
