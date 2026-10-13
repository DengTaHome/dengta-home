import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { createCoWatchLifecycle } from "../src/co-watch-lifecycle.js";
import { createCoWatchViewScope } from "../src/co-watch-view-scope.js";

const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const callback = source.match(/onReply=\{(async \(text, playbackPositionSeconds\) => \{[\s\S]*?\n {10}\})\}\s*\n\s*viewKind=/)?.[1];
assert.ok(callback, "test must execute the actual Together reply callback");
const adapterSource = readFileSync(new URL("../src/co-watch.js", import.meta.url), "utf8").replace(/^import[^;]+;\s*/gm, "").replace(/^export /gm, "");

function fixture({ expectedPosition = 12, responses = null } = {}) {
  let resolve, reject;
  const request = new Promise((yes, no) => { resolve = yes; reject = no; });
  let identity = { accountScope: "fictional-account", companionScope: "fictional-companion" };
  let view = "together", calls = 0, onRefresh = () => {};
  const session = { id: "fictional-session", status: "active", sessionMode: "direct_media", mediaPositionSeconds: 12 };
  const ui = { session, dialog: [], danmaku: [], busy: false, feedback: null, refreshes: 0 };
  const sessionRef = { current: session }, busyRef = { current: false }, jobRef = { current: null };
  const scope = value => JSON.stringify([value.accountScope, value.companionScope]);
  const lifecycle = createCoWatchLifecycle({ getIdentity: () => identity, getSession: () => sessionRef.current, isBusy: () => busyRef.current });
  const viewScope = createCoWatchViewScope({ getIdentity: () => identity, getViewKind: () => view });
  const update = key => value => { ui[key] = typeof value === "function" ? value(ui[key]) : value; };
  const context = {
    coWatchSession: session, coWatchSessionRef: sessionRef, coWatchBusyRef: busyRef,
    coWatchReplyJobRef: jobRef, coWatchLifecycleRef: { current: lifecycle }, coWatchViewScopeRef: { current: viewScope },
    privateMediaScope: scope(identity), authSession: { getSnapshot: () => identity }, settingsSaveScope: scope,
    setCoWatchSession: update("session"), setCoWatchDialog: update("dialog"), setCoWatchDanmaku: update("danmaku"),
    setIsScreenGlanceBusy: update("busy"), setScreenGlanceFeedback: update("feedback"),
    sendCoWatchReply(id, text, position) { calls++; assert.equal(id, session.id); assert.equal(position, expectedPosition); assert.equal(text, "虚构消息"); return responses ? responses(calls) : request; },
    refreshCoWatchExperience: async () => { ui.refreshes++; onRefresh(); },
  };
  const reply = runInNewContext("(" + callback + ")", context);
  return { reply, ui, sessionRef, busyRef, jobRef, lifecycle, viewScope, resolve, reject, calls: () => calls,
    changeIdentity: value => { identity = value; }, changeView: value => { view = value; }, setRefresh: value => { onRefresh = value; } };
}

for (const field of ["accountScope", "companionScope"]) test(`late reply cannot write across changed ${field} or clear another operation's busy state`, async () => {
  const f = fixture(), pending = f.reply("虚构消息");
  f.changeIdentity({ accountScope: "fictional-account", companionScope: "fictional-companion", [field]: "fictional-new-scope" });
  f.sessionRef.current = f.ui.session = { id: "fictional-new-session" };
  f.ui.dialog = []; f.ui.busy = true;
  f.resolve({ session: { id: "fictional-session" }, reaction: "虚构迟到回复", danmaku: [{ text: "虚构弹幕" }] });
  assert.equal(await pending, false);
  assert.equal(f.ui.session.id, "fictional-new-session");
  assert.equal(f.ui.dialog.length + f.ui.danmaku.length + f.ui.refreshes, 0);
  assert.equal(f.ui.busy, true);
  assert.equal(f.ui.feedback, null);
  assert.equal(await f.reply("虚构消息"), false, "old callback must not send under a new scope");
  assert.equal(f.calls(), 1);
});

test("late failure after leaving the view cannot alter feedback, and releases only its own busy state", async () => {
  const f = fixture(), pending = f.reply("虚构消息");
  f.changeView("chat"); f.reject(new Error("fictional late failure"));
  assert.equal(await pending, false);
  assert.equal(f.ui.feedback, null);
  assert.equal(f.ui.busy, false);
  assert.equal(f.jobRef.current, null);
});

test("changing session invalidates reply, bubbles and final busy reset", async () => {
  const f = fixture(), pending = f.reply("虚构消息");
  f.sessionRef.current = f.ui.session = { id: "fictional-other-session" };
  f.lifecycle.invalidate();
  f.ui.dialog = []; f.ui.busy = true;
  f.resolve({ reaction: "fictional late reply" });
  assert.equal(await pending, false);
  assert.equal(f.ui.dialog.length, 0);
  assert.equal(f.ui.busy, true);
});

test("duplicate submission before rendering issues only one reply", async () => {
  const f = fixture(), pending = f.reply("虚构消息");
  assert.equal(await f.reply("虚构消息"), false);
  assert.equal(f.calls(), 1);
  f.resolve({ reaction: "虚构回复", requestId: "fictional-receipt", session: f.ui.session });
  assert.equal(await pending, true);
  assert.equal(f.ui.dialog.at(-1).key, "reply-fictional-receipt");
  assert.equal(f.ui.refreshes, 1);
  assert.equal(f.busyRef.current, false);
  assert.equal(f.ui.busy, false);
});

test("mismatched reply receipt keeps the current session and exposes a precise error", async () => {
  const f = fixture(), pending = f.reply("虚构消息");
  f.resolve({ session: { id: "fictional-wrong-session" }, reaction: "not accepted" });
  assert.equal(await pending, false);
  assert.equal(f.ui.session.id, "fictional-session");
  assert.equal(f.ui.dialog.length + f.ui.danmaku.length + f.ui.refreshes, 0);
  assert.match(f.ui.feedback.message, /co_watch_reply_receipt_invalid/);
  assert.equal(f.ui.busy, false);
});

test("uses the normalized adapter fields for assistant message fallback", async () => {
  const f = fixture(), pending = f.reply("虚构消息");
  f.resolve({ assistantMessage: { content: "虚构后备回复" }, requestId: "fictional-fallback" });
  assert.equal(await pending, true);
  assert.equal(f.ui.dialog.at(-1).text, "虚构后备回复");
  assert.equal(f.ui.dialog.at(-1).id, "reply-fictional-fallback");
});

test("successful reply releases its busy state when refresh reports an ended session", async () => {
  const f = fixture(), pending = f.reply("虚构消息");
  f.setRefresh(() => { f.sessionRef.current = null; });
  f.resolve({ reaction: "虚构回复" });
  // Refresh is allowed to replace the session; the pending reply still owns
  // its busy state until a new lifecycle operation takes ownership.
  assert.equal(await pending, true);
  assert.equal(f.ui.busy, false);
  assert.equal(f.jobRef.current, null);
});

test("explicit playback position zero is preserved instead of falling back to session position", async () => {
  const f = fixture({ expectedPosition: 0 }), pending = f.reply("虚构消息", 0);
  f.resolve({ reaction: "虚构回复" });
  assert.equal(await pending, true);
});

test("a confirmed retry clears its previous reply error without clearing a newer playback failure", async () => {
  const f = fixture({ responses: call => call === 1 ? Promise.reject(new Error("虚构回复失败")) : Promise.resolve({ reaction: "虚构成功回复", requestId: "fictional-retry" }) });
  assert.equal(await f.reply("虚构消息"), false);
  assert.equal(f.ui.feedback.status, "error");
  assert.equal(await f.reply("虚构消息"), true);
  assert.equal(f.ui.feedback.status, "idle");
  assert.equal(f.ui.dialog.at(-1).text, "虚构成功回复");
  f.ui.feedback = { status: "error", message: "虚构播放状态同步失败" };
  assert.equal(await f.reply("虚构消息"), true);
  assert.equal(f.ui.feedback.message, "虚构播放状态同步失败", "a reply cannot dismiss an unrelated playback failure");
});

for (const raw of [null, {}, { status: "failed" }, { reaction: "   " }, { assistant_message: { content: {} } }, { reaction: {} }, { reaction: true }]) test(`empty or malformed 2xx reply is rejected after the actual adapter: ${JSON.stringify(raw)}`, async () => {
  const f = fixture(), pending = f.reply("虚构消息");
  const send = runInNewContext(adapterSource + "\n sendCoWatchReply", { apiRequest: async () => raw });
  void send("fictional-session", "虚构消息", 12).then(f.resolve, f.reject);
  assert.equal(await pending, false);
  assert.equal(f.ui.dialog.length + f.ui.danmaku.length + f.ui.refreshes, 0);
  assert.match(f.ui.feedback.message, /co_watch_reply_receipt_invalid/);
  assert.equal(f.ui.busy, false);
});
