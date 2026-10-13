import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {} } };
const originalFetch = globalThis.fetch, originalTimer = globalThis.setTimeout, originalClearTimer = globalThis.clearTimeout;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const identity = { accountScope: "fictional-music-account", companionScope: "fictional-music-companion" };
const analysis = { duration_sec: 124, rhythm: { tempo_bpm: 96, fast_slow: "中速" }, meter: { meter: "4/4", confidence: "low" }, harmony: { key: "C", mode: "major", key_score: 0.42 }, overall_narrative: { full: "虚构分析摘要\n第二行保留原文。" } };
const receipt = (id = "123456", extra = {}) => ({ cached: false, provider_track_id: id, title: "虚构星河", artist: "虚构歌手", analysis, ...extra });
const props = { ...identity, providerTrackId: "123456", title: "虚构星河", artist: "虚构歌手", sessionScope: "fictional-session" };
let currentIdentity, requests, handler, contextWait, trees, timers, savedCalls, fixtureIndex = 0;
const fixtureAuth = {
  getSnapshot: () => ({ user: { id: currentIdentity.accountScope }, activeCompanionId: currentIdentity.companionScope }),
  async getRequestContext() { if (contextWait) await contextWait.promise; return { accessToken: "fictional-test-token", companionId: currentIdentity.companionScope }; },
  captureCompanionFromResponse() {}, invalidateSession() {},
};
globalThis.__musicUnderstandingAuth = fixtureAuth;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, envFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{ name: "fictional-music-auth-only", enforce: "pre", load(id) {
  if (id.replaceAll("\\", "/").endsWith("/src/auth-session.js")) return "export const authSession=globalThis.__musicUnderstandingAuth;";
} }] });
const ui = await vite.ssrLoadModule("/src/music-understanding-ui.js");
const { default: Panel } = await vite.ssrLoadModule("/src/MusicUnderstandingPanel.jsx");
after(async () => { await vite.close(); globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimer; globalThis.clearTimeout = originalClearTimer; });
beforeEach(() => {
  identity.accountScope = `fictional-music-account-${++fixtureIndex}`; props.accountScope = identity.accountScope;
  currentIdentity = { ...identity }; requests = []; contextWait = null; trees = []; timers = new Map(); savedCalls = [];
  handler = ({ path }) => path.endsWith("/narration") ? { result: { tier: "casual", narration: "虚构普通解读", understanding: null } } : { understanding: receipt() };
  globalThis.fetch = async (url, options = {}) => {
    const call = { path: new URL(url).pathname, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null, signal: options.signal, headers: new Headers(options.headers) };
    requests.push(call); const result = await handler(call);
    return result instanceof Response || result?.json ? result : new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 12_000 || delay === 180_000) { const timer = { callback, delay, args }; timers.set(timer, timer); return timer; }
    return originalTimer(callback, delay, ...args);
  };
  globalThis.clearTimeout = timer => { if (!timers.delete(timer)) originalClearTimer(timer); };
});
afterEach(async () => {
  for (const tree of trees) await act(async () => tree.unmount());
  globalThis.setTimeout = originalTimer; globalThis.clearTimeout = originalClearTimer; timers.clear();
});
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const button = (tree, label) => tree.root.findAllByType("button").find(node => text(node) === label);
const output = tree => JSON.stringify(tree.toJSON());
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
async function mount(extra = {}) { let tree; await act(async () => { tree = TestRenderer.create(React.createElement(Panel, { ...props, onSaved: value => savedCalls.push(value), ...extra })); }); trees.push(tree); return tree; }
async function click(tree, label) { await act(async () => { button(tree, label).props.onClick(); await settle(); }); }
async function expire(delay) { await act(async () => { const timer = [...timers.values()].find(item => item.delay === delay); assert.ok(timer, `deadline ${delay} exists`); timer.callback(...timer.args); await settle(); }); }
const options = extra => ({ ...identity, ...extra });
const failure = (code, status = 503, message = "fictional-private-raw-error", logId) => new Response(JSON.stringify({ code, message, ...(logId ? { error_log_id: logId } : {}) }), { status, headers: { "Content-Type": "application/json" } });
const progressReceipt = (state = "running", extra = {}) => ({ status: { provider_track_id: "123456", state, stage: state === "running" ? "analyzing" : null, started_at: "2026-10-09T10:00:00.000Z", updated_at: "2026-10-09T10:00:01.000Z", error_code: state === "failed" ? "music_understanding_voice_timeout" : state === "invalid_cache" ? "music_understanding_cached_invalid" : null, http_status: state === "failed" ? 504 : state === "invalid_cache" ? 409 : null, understanding: state === "saved" ? receipt("123456", { cached: true }) : null, ...extra } });

test("status adapter is a scoped GET and validates state, stage, timestamps and confirmed analysis", async () => {
  handler = () => progressReceipt();
  assert.equal((await ui.readMusicUnderstandingStatus("123456", options())).stage, "analyzing");
  assert.equal(requests.length, 1); assert.equal(requests[0].method, "GET"); assert.equal(requests[0].path, "/api/v2/music/understanding/tracks/123456/status"); assert.equal(requests[0].body, null);
  for (const status of [progressReceipt("saved", { understanding: { ...receipt(), analysis: {} } }), progressReceipt("running", { stage: "provider-secret" }), progressReceipt("unknown", { error_code: "private-code" }), progressReceipt("running", { provider_track_id: "another-track" }), progressReceipt("failed", { updated_at: "bad-date" })]) {
    handler = () => status;
    await assert.rejects(ui.readMusicUnderstandingStatus("123456", options()), { code: "music_understanding_status_invalid" });
  }
  for (const state of ["saved", "failed", "invalid_cache", "unknown"]) { handler = () => progressReceipt(state); assert.equal((await ui.readMusicUnderstandingStatus("123456", options())).state, state); }
});
test("a running server status after a panel remount locks analysis without sending another POST", async () => {
  handler = () => progressReceipt(); const tree = await mount();
  await click(tree, "查看分析进度");
  assert.equal(requests.length, 1); assert.equal(requests[0].method, "GET");
  assert.match(output(tree), /正在分析音频/); assert.equal(button(tree, "分析并保存").props.disabled, true); assert.equal(button(tree, "我已核对，恢复分析入口"), undefined);
  handler = () => progressReceipt("unknown"); await click(tree, "查看分析进度");
  assert.match(output(tree), /无法确认/); assert.equal(button(tree, "分析并保存").props.disabled, true); assert.equal(savedCalls.length, 0);
});

test("invalid cache status shows the recovery hint without authorizing an uncertain write", async () => {
  handler = () => failure("music_understanding_voice_failed"); const tree = await mount(); await click(tree, "分析并保存");
  handler = () => progressReceipt("invalid_cache"); await click(tree, "查看分析进度");
  assert.match(output(tree), /保存缓存无法确认/);
  assert.doesNotMatch(output(tree), /music_understanding_status_invalid/);
  assert.equal(button(tree, "分析并保存").props.disabled, true);
  assert.equal(requests.filter(call => call.method === "POST").length, 1); assert.equal(savedCalls.length, 0);
  for (const extra of [{ error_code: "fictional-private-code" }, { http_status: 200 }, { error_code: null, http_status: null }]) {
    handler = () => progressReceipt("invalid_cache", extra);
    await assert.rejects(ui.readMusicUnderstandingStatus("123456", options()), { code: "music_understanding_status_invalid" });
  }
});
test("status can be read during analysis and saved confirmation cancels only the wait, ignoring late POST", async () => {
  const pending = deferred(); handler = call => call.path.endsWith("/status") ? progressReceipt() : pending.promise;
  const tree = await mount(); await click(tree, "分析并保存"); await click(tree, "查看分析进度");
  assert.equal(requests.filter(call => call.method === "POST").length, 1); assert.equal(requests[0].signal.aborted, false); assert.match(output(tree), /正在分析音频/);
  handler = () => progressReceipt("saved"); await click(tree, "查看分析进度");
  assert.equal(requests[0].signal.aborted, true); assert.equal(savedCalls.length, 1); assert.match(output(tree), /虚构分析摘要/); assert.equal(button(tree, "分析并保存").props.disabled, false);
  await act(async () => { pending.resolve({ understanding: receipt() }); await settle(); }); assert.equal(savedCalls.length, 1);
});
test("failed or unsupported server status never silently unlocks an uncertain write", async () => {
  handler = () => failure("music_understanding_voice_failed"); const tree = await mount(); await click(tree, "分析并保存");
  handler = () => progressReceipt("failed"); await click(tree, "查看分析进度"); assert.match(output(tree), /music_understanding_voice_timeout/); assert.equal(button(tree, "分析并保存").props.disabled, true);
  handler = () => failure("fictional-secret-code", 404); await click(tree, "查看分析进度"); assert.match(output(tree), /music_understanding_status_unavailable/); assert.doesNotMatch(output(tree), /fictional-private-raw-error|fictional-secret-code/); assert.equal(button(tree, "分析并保存").props.disabled, true);
  assert.equal(requests.filter(call => call.method === "POST").length, 1); assert.equal(savedCalls.length, 0);
});
test("late status after changing track cannot lock or confirm the new song", async () => {
  const pending = deferred(); handler = () => pending.promise; const tree = await mount(); await click(tree, "查看分析进度"); const signal = requests[0].signal;
  await act(async () => { tree.update(React.createElement(Panel, { ...props, providerTrackId: "777777" })); });
  assert.equal(signal.aborted, true);
  await act(async () => { pending.resolve(progressReceipt("saved")); await settle(); }); assert.equal(savedCalls.length, 0); assert.doesNotMatch(output(tree), /虚构分析摘要/); assert.equal(button(tree, "分析并保存").props.disabled, false);
});
test("status deadline covers hung JSON, does not retry and a double click makes one GET", async () => {
  const json = deferred(); handler = () => ({ ok: true, status: 200, json: () => json.promise }); const tree = await mount(); const action = button(tree, "查看分析进度").props.onClick;
  await act(async () => { action(); action(); await settle(); }); assert.equal(requests.length, 1); await expire(12_000);
  assert.equal(requests[0].signal.aborted, true); assert.match(output(tree), /music_understanding_timeout/); assert.equal(button(tree, "分析并保存").props.disabled, false); assert.equal(savedCalls.length, 0);
});

test("opening is collapsed with no request, automatic playback or save notification", async () => {
  const tree = await mount(); assert.equal(tree.root.findAllByType("details")[0].props.open, undefined); assert.equal(requests.length, 0); assert.equal(savedCalls.length, 0);
  assert.equal(button(tree, "生成专业解读"), undefined); assert.match(output(tree), /只有主动操作才会请求服务/);
});
test("casual sends only the chosen metadata and valid tier, returns plain text and never pretends analysis saved", async () => {
  const tree = await mount(); await click(tree, "聊聊这首歌");
  assert.equal(requests.length, 1); assert.equal(requests[0].path, "/api/v2/music/understanding/narration");
  assert.deepEqual(requests[0].body, { provider_track_id: "123456", title: "虚构星河", artist: "虚构歌手", tier: "casual" });
  assert.equal(requests[0].headers.get("Authorization"), "Bearer fictional-test-token"); assert.equal(requests[0].headers.get("X-DengTa-Companion-Id"), identity.companionScope);
  assert.match(output(tree), /虚构普通解读/); assert.match(output(tree), /此操作没有保存音频分析/); assert.doesNotMatch(output(tree), /已保存分析.*虚构分析摘要/); assert.equal(savedCalls.length, 0);
});
test("same-tick double analysis is one actual POST and onSaved captures scope, provider ID and session", async () => {
  const tree = await mount(), action = button(tree, "分析并保存").props.onClick;
  await act(async () => { action(); action(); await settle(); });
  assert.equal(requests.length, 1); assert.equal(requests[0].method, "POST"); assert.equal(requests[0].path, "/api/v2/music/understanding/analyze");
  assert.equal(savedCalls.length, 1); assert.deepEqual(savedCalls[0], { scope: JSON.stringify([identity.accountScope, identity.companionScope]), providerTrackId: "123456", sessionScope: "fictional-session" });
  assert.match(output(tree), /服务器已确认分析保存/); assert.match(output(tree), /虚构分析摘要/); assert.ok(button(tree, "生成专业解读"));
});
test("cached analysis is honest about no extra count; a refresh callback rejection cannot undo it", async () => {
  handler = () => ({ understanding: receipt("123456", { cached: true }) });
  const tree = await mount({ onSaved: async () => { throw Error("fictional-refresh-failed"); } }); await click(tree, "分析并保存");
  assert.match(output(tree), /这首歌已有保存分析/); assert.match(output(tree), /不会因此新增歌曲计数/); assert.match(output(tree), /虚构分析摘要/); assert.doesNotMatch(output(tree), /fictional-refresh-failed/);
});
test("analysis remains when independent expert narration fails, and a later expert success confirms its nested receipt", async () => {
  const tree = await mount(); await click(tree, "分析并保存");
  handler = () => failure("music_understanding_model_unconfigured"); await click(tree, "生成专业解读");
  assert.match(output(tree), /虚构分析摘要/); assert.match(output(tree), /music_understanding_model_unconfigured/); assert.doesNotMatch(output(tree), /fictional-private-raw-error/); assert.equal(savedCalls.length, 1);
  handler = () => ({ result: { tier: "expert", narration: "虚构专业解读\n保留换行", understanding: { cached: true, title: "虚构星河", artist: "虚构歌手", analysis } } });
  await click(tree, "生成专业解读"); assert.match(output(tree), /虚构专业解读/); assert.equal(savedCalls.length, 2); assert.equal(requests.at(-1).body.tier, "expert");
});
test("unknown analysis failure blocks further writes until actual GET confirms saved state", async () => {
  handler = () => failure("music_understanding_voice_failed"); const tree = await mount(); await click(tree, "分析并保存");
  assert.equal(button(tree, "分析并保存").props.disabled, true); assert.match(output(tree), /保存结果尚未确认/); const calls = requests.length;
  await click(tree, "分析并保存"); assert.equal(requests.length, calls);
  handler = () => failure("unrelated_missing", 404); await click(tree, "读取已保存分析"); assert.equal(button(tree, "分析并保存").props.disabled, true);
  handler = () => failure("music_understanding_voice_failed", 503); await click(tree, "读取已保存分析"); assert.equal(button(tree, "分析并保存").props.disabled, true);
  handler = () => ({ understanding: receipt("123456", { cached: true }) }); await click(tree, "读取已保存分析");
  assert.equal(button(tree, "分析并保存").props.disabled, false); assert.match(output(tree), /已读取当前账号和伴侣保存的分析/); assert.equal(savedCalls.length, 1);
  assert.equal(requests.filter(call => call.method === "POST").length, 1); assert.equal(requests.filter(call => call.method === "GET").length, 3);
});
test("only exact not-found 404 permits explicit recovery; it never automatically releases the guard or reports success", async () => {
  handler = () => failure("api_request_failed"); const tree = await mount(); await click(tree, "分析并保存");
  handler = () => failure("music_understanding_not_found", 404); await click(tree, "读取已保存分析");
  assert.equal(button(tree, "分析并保存").props.disabled, true); assert.equal(savedCalls.length, 0); assert.match(output(tree), /服务器任务仍可能执行/);
  const before = requests.length; await click(tree, "我已核对，恢复分析入口"); assert.equal(requests.length, before); assert.equal(button(tree, "分析并保存").props.disabled, false);
  handler = () => ({ understanding: receipt() }); await click(tree, "分析并保存"); assert.equal(savedCalls.length, 1);
});
test("invalid, empty, mismatched and malformed-JSON analysis receipts cannot display saved success", async () => {
  for (const data of [null, {}, { understanding: null }, { understanding: receipt("999") }, { understanding: receipt("123456", { cached: "false" }) }, { understanding: receipt("123456", { analysis: {} }) }, { understanding: receipt("123456", { analysis: { duration_sec: 0, rhythm: null, harmony: null, overall_narrative: null, structure: [] } }) }, new Response("{broken-json", { status: 200 })]) {
    handler = () => data; const tree = await mount(); await click(tree, "分析并保存");
    assert.match(output(tree), /music_understanding_receipt_invalid/); assert.equal(button(tree, "分析并保存").props.disabled, true); assert.equal(savedCalls.length, 0); assert.doesNotMatch(output(tree), /服务器已确认分析保存/);
    await act(async () => tree.unmount());
    const recovery = ui.createMusicAnalysisRecovery(identity, props.providerTrackId); recovery.confirm(recovery.getSnapshot());
  }
});
test("narration rejects missing body, wrong tier, empty text and illegal casual analysis", async () => {
  for (const result of [null, {}, { tier: "expert", narration: "wrong", understanding: null }, { tier: "casual", narration: "  ", understanding: null }, { tier: "casual", narration: "wrong", understanding: receipt() }]) {
    handler = () => ({ result }); const tree = await mount(); await click(tree, "聊聊这首歌");
    assert.match(output(tree), /music_narration_receipt_invalid/); assert.equal(savedCalls.length, 0); assert.doesNotMatch(output(tree), /已收到普通解读/); await act(async () => tree.unmount());
  }
});
test("expert missing or empty nested analysis cannot replace confirmed prior analysis", async () => {
  const tree = await mount(); await click(tree, "分析并保存");
  handler = () => ({ result: { tier: "expert", narration: "FICTIONAL_UNCONFIRMED_TEXT", understanding: { cached: true, title: "虚构星河", artist: "虚构歌手", analysis: {} } } });
  await click(tree, "生成专业解读"); assert.match(output(tree), /music_understanding_receipt_invalid/); assert.match(output(tree), /虚构分析摘要/); assert.doesNotMatch(output(tree), /FICTIONAL_UNCONFIRMED_TEXT/); assert.equal(savedCalls.length, 1);
});
test("no numeric provider ID disables all actions and adapter refuses UUID, numbers, overlong and empty IDs", async () => {
  for (const providerTrackId of ["", "local-uuid", "bd14dc2d-acc3-41e3-92bc-28e694d0f4e3", "1".repeat(21), 123]) {
    const tree = await mount({ providerTrackId }); for (const label of ["聊聊这首歌", "分析并保存", "读取已保存分析"]) { assert.equal(button(tree, label).props.disabled, true); await click(tree, label); }
    assert.equal(requests.length, 0); assert.throws(() => ui.analyzeMusicUnderstandingUi({ providerTrackId }, options()), { code: "music_track_id_invalid" }); await act(async () => tree.unmount());
  }
  assert.equal(ui.validMusicTrackId("0"), true); assert.equal(ui.validMusicTrackId(" 123 "), true);
});
test("account switch during authentication prevents transport and late JSON after a switch cannot confirm a save", async () => {
  contextWait = deferred(); const task = ui.analyzeMusicUnderstandingUi(props, options()); await settle(); currentIdentity = { ...identity, companionScope: "fictional-other-companion" }; contextWait.resolve();
  await assert.rejects(task, error => error.code === "music_scope_changed"); assert.equal(requests.length, 0);
  currentIdentity = { ...identity }; contextWait = null; const json = deferred(); handler = () => ({ ok: true, status: 200, json: () => json.promise });
  const second = ui.analyzeMusicUnderstandingUi(props, options()); await settle(); currentIdentity = { ...identity, accountScope: "fictional-other-account" }; json.resolve({ understanding: receipt() });
  await assert.rejects(second, error => error.code === "music_scope_changed");
});
test("complete write deadline covers hung JSON after HTTP headers and unlocks only GET recovery", async () => {
  const json = deferred(); handler = () => ({ ok: true, status: 200, json: () => json.promise }); const tree = await mount(); await click(tree, "分析并保存");
  assert.equal(requests.length, 1); assert.equal(requests[0].signal.aborted, false); await expire(180_000);
  assert.equal(requests[0].signal.aborted, true); assert.match(output(tree), /music_understanding_timeout/); assert.equal(button(tree, "分析并保存").props.disabled, true);
  await act(async () => { json.resolve({ understanding: receipt() }); await settle(); }); assert.equal(savedCalls.length, 0); assert.doesNotMatch(output(tree), /服务器已确认分析保存/);
});
test("read deadline covers hung JSON and GET error does not automatically retry", async () => {
  const json = deferred(); handler = () => ({ ok: true, status: 200, json: () => json.promise }); const task = ui.readMusicUnderstandingUi("123456", options()); const caught = assert.rejects(task, { code: "music_understanding_timeout" });
  await settle(); await expire(12_000); await caught; assert.equal(requests[0].signal.aborted, true);
  handler = () => failure("music_understanding_voice_failed"); await assert.rejects(ui.readMusicUnderstandingUi("123456", options()), { code: "music_understanding_voice_failed" }); assert.equal(requests.length, 2);
});
test("deadline also covers authentication and honours pre-aborted signals without transport", async () => {
  contextWait = deferred(); const task = ui.analyzeMusicUnderstandingUi(props, options()); const caught = assert.rejects(task, { code: "music_understanding_timeout" }); await settle(); await expire(180_000); await caught; assert.equal(requests.length, 0);
  const controller = new AbortController(); controller.abort(Object.assign(Error(), { code: "music_understanding_cancelled" }));
  await assert.rejects(ui.readMusicUnderstandingUi("123456", options({ signal: controller.signal })), { code: "music_understanding_cancelled" }); assert.equal(requests.length, 0);
});
test("cancelled analysis cannot confirm late output, guard is kept and a stale cancel cannot abort a later read", async () => {
  const pending = deferred(); handler = () => pending.promise; const tree = await mount(); await click(tree, "分析并保存"); const oldCancel = button(tree, "取消等待").props.onClick;
  await act(async () => oldCancel()); assert.equal(requests[0].signal.aborted, true); assert.equal(button(tree, "分析并保存").props.disabled, true);
  const read = deferred(); handler = () => read.promise; await click(tree, "读取已保存分析"); const readSignal = requests.at(-1).signal;
  await act(async () => { oldCancel(); await settle(); }); assert.equal(readSignal.aborted, false);
  await act(async () => { pending.resolve({ understanding: receipt() }); read.resolve({ understanding: receipt("123456", { cached: true }) }); await settle(); });
  assert.equal(savedCalls.length, 1); assert.match(output(tree), /已读取当前账号和伴侣保存的分析/);
});
test("switching track, session, account or companion aborts pending and old handlers cannot send or publish", async () => {
  for (const change of [{ providerTrackId: "789" }, { sessionScope: "fictional-new-session" }, { companionScope: "fictional-new-companion" }, { accountScope: "fictional-new-account" }]) {
    currentIdentity = { ...identity }; const pending = deferred(); handler = () => pending.promise;
    const tree = await mount(); const oldWrite = button(tree, "分析并保存").props.onClick; await click(tree, "分析并保存"); const oldSignal = requests.at(-1).signal; const before = requests.length;
    currentIdentity = { ...identity, ...change }; await act(async () => tree.update(React.createElement(Panel, { ...props, ...change, onSaved: value => savedCalls.push(value) })));
    assert.equal(oldSignal.aborted, true); await act(async () => { oldWrite(); pending.resolve({ understanding: receipt() }); await settle(); });
    assert.equal(requests.length, before); assert.equal(savedCalls.length, 0); assert.doesNotMatch(output(tree), /虚构分析摘要|服务器已确认分析保存/); await act(async () => tree.unmount());
  }
});
test("plain summary rendering escapes HTML and details exclude server file paths and raw secret-shaped fields", async () => {
  handler = () => ({ understanding: receipt("123456", { analysis: { ...analysis, file: "FICTIONAL_PRIVATE_PATH", token: "FICTIONAL_PRIVATE_TOKEN", lyrics: { text: "FICTIONAL_LYRICS_BODY" }, overall_narrative: { full: "<b>虚构原文</b>" } } }) });
  const tree = await mount(); await click(tree, "分析并保存"); assert.match(output(tree), /<b>虚构原文<\/b>/); assert.doesNotMatch(output(tree), /dangerouslySetInnerHTML|FICTIONAL_PRIVATE_PATH|FICTIONAL_PRIVATE_TOKEN|FICTIONAL_LYRICS_BODY/);
  assert.match(output(tree), /96/); assert.match(output(tree), /4\/4/); assert.equal(tree.root.findAllByType("b").length, 0);
});
test("safe error feedback exposes code, HTTP and legal log ID but never raw message; log loads only on explicit click under current identity", async () => {
  const logId = "00000000-0000-4000-8000-000000000016";
  handler = call => call.path.startsWith("/api/errors/") ? { log: { error_code: "music_understanding_voice_failed", upstream_status: 502 } } : failure("music_understanding_voice_failed", 502, "FICTIONAL_PRIVATE_RAW_URL_TOKEN", logId);
  const tree = await mount(); await click(tree, "分析并保存"); assert.match(output(tree), /HTTP.*502/); assert.doesNotMatch(output(tree), /FICTIONAL_PRIVATE_RAW_URL_TOKEN/); assert.equal(requests.length, 1);
  await click(tree, "查看日志"); assert.equal(requests.length, 2); assert.equal(requests[1].path, `/api/errors/${logId}`); assert.equal(requests[1].headers.get("X-DengTa-Companion-Id"), identity.companionScope); assert.match(output(tree), /00000000-0000-4000-8000-000000000016/);
  assert.equal(ui.musicUnderstandingFailure({ code: "bad\nraw", message: "PRIVATE", status: 999, error_log_id: "PRIVATE" }).code, "music_understanding_failed");
  assert.equal(ui.musicUnderstandingFailure({ code: "music_understanding_voice_failed", error_log_id: "unsafe/raw" }).logId, null);
});

test("pending analysis survives track roundtrips and session remounts, with no cross-account or companion recovery", async () => {
  const pending = deferred(); handler = () => pending.promise; const tree = await mount(); await click(tree, "分析并保存"); const before = requests.length;
  await act(async () => tree.update(React.createElement(Panel, { ...props, providerTrackId: "789" })));
  assert.equal(button(tree, "分析并保存").props.disabled, false);
  await act(async () => tree.update(React.createElement(Panel, props)));
  assert.equal(button(tree, "分析并保存").props.disabled, true); assert.match(output(tree), /保存结果尚未确认/); await click(tree, "分析并保存"); assert.equal(requests.length, before);
  await act(async () => tree.update(React.createElement(Panel, { ...props, sessionScope: "fictional-next-session" })));
  assert.equal(button(tree, "分析并保存").props.disabled, true);
  currentIdentity = { ...identity, companionScope: "fictional-other-companion" }; await act(async () => tree.update(React.createElement(Panel, { ...props, companionScope: currentIdentity.companionScope })));
  assert.equal(button(tree, "分析并保存").props.disabled, false); assert.doesNotMatch(output(tree), /保存结果尚未确认/);
  currentIdentity = { ...identity, accountScope: "fictional-other-account" }; await act(async () => tree.update(React.createElement(Panel, { ...props, accountScope: currentIdentity.accountScope })));
  assert.equal(button(tree, "分析并保存").props.disabled, false);
  currentIdentity = { ...identity }; await act(async () => tree.update(React.createElement(Panel, props)));
  assert.equal(button(tree, "分析并保存").props.disabled, true); await act(async () => { pending.resolve({ understanding: receipt() }); await settle(); });
  assert.equal(savedCalls.length, 0); assert.equal(requests.length, before);
});
test("two same-song panels share the synchronous write guard, and stale recovery cannot release a newer operation", async () => {
  const pending = deferred(); handler = () => pending.promise; const first = await mount(), second = await mount({ sessionScope: "fictional-second-session" });
  const actionA = button(first, "分析并保存").props.onClick, actionB = button(second, "分析并保存").props.onClick;
  await act(async () => { actionA(); actionB(); await settle(); }); assert.equal(requests.length, 1); assert.equal(button(second, "分析并保存").props.disabled, true);
  await click(first, "取消等待"); handler = () => failure("music_understanding_not_found", 404); await click(second, "读取已保存分析");
  const oldRestore = button(second, "我已核对，恢复分析入口").props.onClick; await act(async () => oldRestore());
  const newer = deferred(); handler = () => newer.promise; await click(second, "分析并保存"); const signal = requests.at(-1).signal;
  await act(async () => oldRestore()); assert.equal(button(second, "分析并保存").props.disabled, true); assert.equal(signal.aborted, false);
  await act(async () => { pending.resolve({ understanding: receipt() }); await settle(); }); assert.equal(savedCalls.length, 0);
  await act(async () => { newer.resolve({ understanding: receipt() }); await settle(); }); assert.equal(savedCalls.length, 1);
});

test("a later failed GET withdraws a previous missing-state review rather than offering stale recovery", async () => {
  handler = () => failure("music_understanding_voice_failed"); const tree = await mount(); await click(tree, "分析并保存");
  handler = () => failure("music_understanding_not_found", 404); await click(tree, "读取已保存分析"); const oldRestore = button(tree, "我已核对，恢复分析入口").props.onClick;
  handler = () => failure("permission_denied", 403); await click(tree, "读取已保存分析"); assert.equal(button(tree, "我已核对，恢复分析入口"), undefined);
  await act(async () => oldRestore()); assert.equal(button(tree, "分析并保存").props.disabled, true); assert.equal(savedCalls.length, 0);
});
test("a scope-mismatched auth context never transports a request or reveals its underlying failure", async () => {
  const getContext = fixtureAuth.getRequestContext;
  fixtureAuth.getRequestContext = async () => ({ accessToken: "fictional-test-token", companionId: "fictional-wrong-companion" });
  try { await assert.rejects(ui.readMusicUnderstandingUi("123456", options()), { code: "co_watch_scope_changed" }); assert.equal(requests.length, 0); }
  finally { fixtureAuth.getRequestContext = getContext; }
});
test("late old log handlers cannot read another account's log after remount", async () => {
  handler = () => failure("provider_balance_insufficient", 402, "FICTIONAL_PRIVATE_BALANCE", "00000000-0000-4000-8000-000000000016");
  const tree = await mount(); await click(tree, "聊聊这首歌"); assert.match(output(tree), /API 账户余额不足/); assert.doesNotMatch(output(tree), /FICTIONAL_PRIVATE_BALANCE/);
  const oldLog = button(tree, "查看日志").props.onClick; currentIdentity = { ...identity, accountScope: "fictional-new-account" };
  await act(async () => tree.update(React.createElement(Panel, { ...props, accountScope: currentIdentity.accountScope })));
  const before = requests.length; await act(async () => { oldLog(); await settle(); }); assert.equal(requests.length, before); assert.doesNotMatch(output(tree), /provider_balance_insufficient/);
});

test("new analysis service failure codes give fixed causes and never expose raw upstream text", async () => {
  for (const [code, status, cause] of [
    ["music_understanding_invalid_response", 502, /分析服务.*格式/],
    ["music_understanding_empty_analysis", 502, /有效.*分析/],
    ["music_understanding_cached_invalid", 409, /缓存.*失效/],
    ["netease_audio_download_timeout", 504, /音频.*超时/],
    ["netease_audio_download_interrupted", 502, /音频.*中断/],
    ["music_understanding_voice_timeout", 504, /分析服务.*超时/],
    ["music_understanding_voice_interrupted", 502, /分析服务.*中断/],
  ]) {
    const feedback = ui.musicUnderstandingFailure({ code, status, message: "FICTIONAL_RAW_PROVIDER_SECRET" });
    assert.match(feedback.reason, cause); assert.equal(feedback.code, code); assert.equal(feedback.status, status); assert.doesNotMatch(JSON.stringify(feedback), /FICTIONAL_RAW_PROVIDER_SECRET/);
  }
});
test("status-only or arbitrary nested analysis is rejected instead of being shown as saved", async () => {
  for (const weak of [{ rhythm: { status: "ok" } }, { dynamics: { debug: "ok" } }, { harmony: { status: "ok" } }, { structure: [{ error: "not analysis" }] }, { overall_narrative: { status: "ok" } }, { rhythm: "ok" }, { rhythm: { tempo_bpm: 0 } }, { dynamics: { dynamic_range_db: "0" } }, { harmony: { key_score: 0.9 } }, { meter: { meter: "unknown", confidence: "high" } }]) {
    handler = () => ({ understanding: receipt("123456", { analysis: weak }) });
    await assert.rejects(ui.analyzeMusicUnderstandingUi(props, options()), { code: "music_understanding_receipt_invalid" });
  }
});
test("legitimate summaries, partial metrics and zero-valued measurements remain valid independently", async () => {
  for (const partial of [{ overall_narrative: { opening: "虚构合法摘要" } }, { rhythm: { tempo_bpm: 96 } }, { dynamics: { dynamic_range_db: 0 } }, { harmony: { key: "C" } }, { emotion: { valence: 0 } }]) {
    handler = () => ({ understanding: receipt("123456", { analysis: partial }) }); const result = await ui.analyzeMusicUnderstandingUi(props, options()); assert.deepEqual(result.analysis, partial);
  }
});
test("exact cached-invalid GET offers an explicit replacement action and ordinary analysis never sends the repair flag", async () => {
  const tree = await mount(); handler = () => failure("music_understanding_cached_invalid", 409); await click(tree, "读取已保存分析");
  assert.ok(button(tree, "重新分析并保存")); assert.equal(button(tree, "分析并保存"), undefined); assert.match(output(tree), /替换.*失效缓存/); assert.equal(savedCalls.length, 0);
  handler = () => ({ understanding: receipt() }); const action = button(tree, "重新分析并保存").props.onClick;
  await act(async () => { action(); action(); await settle(); });
  assert.equal(requests.filter(call => call.method === "POST").length, 1); assert.equal(requests.at(-1).body.reanalyze_invalid_cache, true); assert.equal(savedCalls.length, 1);
  assert.equal(button(tree, "重新分析并保存"), undefined); await click(tree, "分析并保存"); assert.equal(Object.hasOwn(requests.at(-1).body, "reanalyze_invalid_cache"), false);
  await ui.analyzeMusicUnderstandingUi({ ...props, reanalyze_invalid_cache: "true" }, options()); assert.equal(Object.hasOwn(requests.at(-1).body, "reanalyze_invalid_cache"), false);
});
test("pending cached-invalid GET still requires explicit recovery with no POST before explicit repair", async () => {
  handler = () => failure("music_understanding_voice_timeout", 504); const tree = await mount(); await click(tree, "分析并保存");
  handler = () => failure("music_understanding_cached_invalid", 409); await click(tree, "读取已保存分析");
  assert.equal(button(tree, "重新分析并保存").props.disabled, true); assert.ok(button(tree, "我已核对，恢复分析入口"));
  const before = requests.length; await click(tree, "重新分析并保存"); assert.equal(requests.length, before); await click(tree, "我已核对，恢复分析入口"); assert.equal(requests.length, before);
  handler = () => ({ understanding: receipt() }); await click(tree, "重新分析并保存"); assert.equal(requests.at(-1).body.reanalyze_invalid_cache, true); assert.equal(savedCalls.length, 1);
});
test("wrong cached-invalid statuses or other codes cannot authorize repair or pending-operation recovery", async () => {
  const tree = await mount(); handler = () => failure("music_understanding_voice_timeout", 504); await click(tree, "分析并保存");
  for (const [code, status] of [["music_understanding_cached_invalid", 404], ["music_understanding_cached_invalid", 502], ["api_request_failed", 409], ["music_understanding_empty_analysis", 502]]) {
    handler = () => failure(code, status); await click(tree, "读取已保存分析");
    assert.equal(button(tree, "重新分析并保存"), undefined); assert.equal(button(tree, "我已核对，恢复分析入口"), undefined); assert.equal(button(tree, "分析并保存").props.disabled, true);
  }
});
test("a later failed GET invalidates a stale repair handler without sending a replacement", async () => {
  const tree = await mount(); handler = () => failure("music_understanding_cached_invalid", 409); await click(tree, "读取已保存分析");
  const staleRepair = button(tree, "重新分析并保存").props.onClick;
  handler = () => failure("permission_denied", 403); await click(tree, "读取已保存分析"); assert.equal(button(tree, "重新分析并保存"), undefined);
  const before = requests.length; await act(async () => { staleRepair(); await settle(); }); assert.equal(requests.length, before);
});
test("repair failure keeps its metadata and unknown guard; remount requires a fresh invalid-cache check", async () => {
  const tree = await mount(); handler = () => failure("music_understanding_cached_invalid", 409); await click(tree, "读取已保存分析");
  handler = () => failure("music_understanding_empty_analysis", 502); await click(tree, "重新分析并保存");
  assert.equal(button(tree, "重新分析并保存").props.disabled, true); assert.match(output(tree), /保存结果尚未确认/); assert.match(output(tree), /虚构星河/); assert.equal(savedCalls.length, 0);
  await act(async () => tree.update(React.createElement(Panel, { ...props, sessionScope: "fictional-repair-new-session" })));
  assert.equal(button(tree, "重新分析并保存"), undefined); assert.equal(button(tree, "分析并保存").props.disabled, true);
  handler = () => failure("music_understanding_cached_invalid", 409); await click(tree, "读取已保存分析"); assert.equal(button(tree, "重新分析并保存").props.disabled, true);
  const before = requests.length; await click(tree, "我已核对，恢复分析入口"); assert.equal(requests.length, before);
  const pending = deferred(); handler = () => pending.promise; await click(tree, "重新分析并保存"); const signal = requests.at(-1).signal; await click(tree, "取消等待"); assert.equal(signal.aborted, true); assert.equal(button(tree, "重新分析并保存").props.disabled, true);
  await act(async () => { pending.resolve({ understanding: receipt() }); await settle(); }); assert.equal(savedCalls.length, 0);
});
test("pre-check ordinary handlers cannot mutate a verified invalid cache and repair authorization never crosses a track key", async () => {
  const tree = await mount(), oldOrdinary = button(tree, "分析并保存").props.onClick;
  handler = () => failure("music_understanding_cached_invalid", 409); await click(tree, "读取已保存分析"); const oldRepair = button(tree, "重新分析并保存").props.onClick;
  const before = requests.length; await act(async () => { oldOrdinary(); await settle(); }); assert.equal(requests.length, before);
  await act(async () => tree.update(React.createElement(Panel, { ...props, providerTrackId: "789" })));
  assert.equal(button(tree, "重新分析并保存"), undefined); await act(async () => { oldRepair(); await settle(); }); assert.equal(requests.length, before);
});
