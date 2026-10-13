import assert from "node:assert/strict";
import process from "node:process";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { setTimeout, clearTimeout, setInterval, clearInterval, localStorage: { getItem: () => null, setItem() {} } };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const localPlaylist = { id: "fictional-local", name: "虚构本地歌单", items: [{ id: "local-track", title: "虚构本地音频", url: "https://media.example.test/fictional.mp3" }] };
const oldRows = { owned: [{ playlist_id: "1001", name: "虚构旧账号歌单", item_count: 1 }], subscribed: [] };
const oldTrack = { id: "2001", title: "虚构旧账号歌曲", artist: "虚构作者" };
let tree, account, companion, connected, accountName, calls, pending, nativeCalls, browserCalls;
const fixture = {
  auth: { getSnapshot: () => ({ user: { id: account }, activeCompanionId: companion }), getRequestContext: async () => ({ accessToken: "fictional-placeholder", companionId: companion }) },
  available: () => true,
  browser() { browserCalls++; return pending.browser?.promise || Promise.resolve({ ok: true }); },
  readCookie: async () => ({ cookie: "fictional-placeholder" }),
  native() { nativeCalls++; return pending.native?.promise || Promise.resolve({ opened: true, target: "fictional-native" }); },
  async request(path, options = {}) {
    const kind = path.endsWith("/cookie-session") ? options.method === "DELETE" ? "disconnect" : options.method === "POST" ? "save" : "check"
      : path.includes("/cookie/my-playlists") ? "rows" : path.includes("/cookie/search?") ? "search"
      : path.includes("/cookie/playlist?") ? "detail" : path.includes("/cookie/daily") ? "daily"
      : path.includes("/cookie/history?") ? "history" : path.includes("/cookie/like") ? "like"
      : path.endsWith("/imports/share") ? "import" : path.endsWith("/external-playback") ? "external"
      : path.endsWith("/fictional-imported") ? "imported-detail" : path.endsWith("/fictional-local") ? "local-detail"
      : path.endsWith("/playlists") ? "library" : path.endsWith("/favorites") ? "favorites"
      : path.endsWith("/connections/manage") ? "connections" : "unexpected";
    calls.push({ kind, path, options });
    if (pending[kind]) return pending[kind].promise;
    if (kind === "disconnect") { connected = false; return { session: { connected: false } }; }
    if (kind === "save") { connected = true; accountName = "虚构新网易账号"; return { session: { connected: true, account_name: accountName } }; }
    if (kind === "check") return { session: { connected, account_name: accountName } };
    if (kind === "rows") return oldRows;
    if (kind === "search") return { items: [oldTrack] };
    if (kind === "detail") return { playlist: { name: "虚构旧账号详情", tracks: [oldTrack] } };
    if (kind === "daily") return { daily: [{ ...oldTrack, title: "虚构旧账号推荐" }] };
    if (kind === "history") return { records: [{ ...oldTrack, title: "虚构旧账号记录" }] };
    if (kind === "like") return { liked: true };
    if (kind === "import") return { playlist: { id: "fictional-imported", name: "虚构旧账号导入", items: [] } };
    if (kind === "imported-detail") return { playlist: { ...localPlaylist, id: "fictional-imported", name: "虚构迟到导入" } };
    if (kind === "local-detail") return { playlist: localPlaylist };
    if (kind === "library") return { playlists: [localPlaylist] };
    if (kind === "favorites") return { favorites: [] };
    if (kind === "connections") return { connections: [] };
    if (kind === "external") return { ok: true };
    throw new Error("Unexpected fictional route: " + path);
  },
};
globalThis.__cookieFeedback = fixture;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{
  name: "cookie-feedback-fictional-boundary", enforce: "pre",
  transform(code, id) { if (id.replaceAll("\\", "/").endsWith("/src/netease-playback.js")) return code.replace('"@capacitor/core"', '"virtual:cookie-native"'); },
  resolveId(id) { if (id === "virtual:cookie-native") return "\0" + id; },
  load(id) {
    const normalized = id.replaceAll("\\", "/");
    if (normalized.endsWith("/src/api.js")) return "export const apiRequest=(...args)=>globalThis.__cookieFeedback.request(...args);export const apiFetch=apiRequest;";
    if (normalized.endsWith("/src/auth-session.js")) return "export const authSession=globalThis.__cookieFeedback.auth;";
    if (normalized.endsWith("/src/browser-launcher.js")) return "export const browserLauncherAvailable=()=>globalThis.__cookieFeedback.available();export const openBuiltInBrowser=(...args)=>globalThis.__cookieFeedback.browser(...args);export const readBrowserCookie=(...args)=>globalThis.__cookieFeedback.readCookie(...args);";
    if (id === "\0virtual:cookie-native") return "export const Capacitor={isNativePlatform:()=>true};export const registerPlugin=()=>({open:(...args)=>globalThis.__cookieFeedback.native(...args)});";
  },
}] });
const nodeText = node => typeof node === "string" ? node : (node?.children || []).map(nodeText).join("");
const button = label => tree.root.findAllByType("button").find(node => nodeText(node) === label);
const output = () => JSON.stringify(tree.toJSON());
const count = kind => calls.filter(row => row.kind === kind).length;
const last = kind => calls.filter(row => row.kind === kind).at(-1);
const click = async label => { assert.ok(button(label), "Missing button " + label); await act(async () => { button(label).props.onClick(); }); };
const props = () => ({ accountScope: account, companionScope: companion });
async function unmount() { if (tree) { await act(async () => tree.unmount()); tree = null; } }
async function reset({ login = true, request = null } = {}) {
  await unmount(); account = "fictional-account"; companion = "fictional-companion"; connected = login; accountName = "虚构旧网易账号";
  calls = []; pending = {}; nativeCalls = 0; browserCalls = 0;
  await act(async () => { tree = TestRenderer.create(React.createElement(Music, { ...props(), request })); });
}
async function search() {
  await click("搜歌");
  await act(async () => tree.root.findByProps({ type: "search" }).props.onChange({ target: { value: "虚构关键词" } }));
  await act(async () => { tree.root.findByProps({ className: "music-cookie-search" }).props.onSubmit({ preventDefault() {} }); });
}
async function reconnect() { await click("内置浏览器登录"); assert.match(output(), /虚构新网易账号/); }
async function finish(kind, value, fail = false) { await act(async () => { if (fail) pending[kind].reject(value); else pending[kind].resolve(value); }); delete pending[kind]; }
const tests = [];
const test = (name, run) => tests.push({ name, run });
let Music;
const visible = () => nodeText(tree.toJSON());
const says = text => assert.ok(visible().includes(text), "Expected visible feedback: " + text);
const doesNotSay = text => assert.ok(!visible().includes(text), "Unexpected visible feedback: " + text);
const readFailure = kind => Object.assign(new Error("虚构读取失败"), { code: "fictional_" + kind + "_failed" });
const writes = () => calls.filter(row => ["like", "import", "external"].includes(row.kind)).length;

for (const [kind, label, loading, empty, retry, emptyData] of [
  ["rows", "我的歌单", "正在读取我的歌单", "账号下还没有歌单", "重试读取歌单", { owned: [], subscribed: [] }],
  ["daily", "每日推荐", "正在读取每日推荐", "今天暂时没有推荐歌曲", "重试读取推荐", { daily: [] }],
  ["history", "听歌记录", "正在读取听歌记录", "还没有听歌记录", "重试读取记录", { records: [] }],
]) test(`${kind}: pending, failed and confirmed empty reads have distinct feedback and one manual retry`, async () => {
  await reset(); pending[kind] = deferred(); await click(label);
  says(loading); doesNotSay(empty); assert.ok(tree.root.findAllByProps({ role: "status" }).length);
  await finish(kind, readFailure(kind), true); says("fictional_" + kind + "_failed"); doesNotSay(empty);
  assert.ok(tree.root.findAllByProps({ role: "alert" }).some(node => nodeText(node).includes("fictional_" + kind + "_failed")));
  pending[kind] = deferred(); const retryClick = button(retry)?.props.onClick; assert.ok(retryClick, "Missing read-only retry: " + retry);
  await act(async () => { retryClick(); retryClick(); }); assert.equal(count(kind), 2); says(loading);
  await finish(kind, emptyData); says(empty); doesNotSay("fictional_" + kind + "_failed"); assert.equal(writes(), 0);
});

test("same-tick duplicate playlist reads keep one request and usable pending feedback", async () => {
  await reset(); pending.rows = deferred(); const read = button("我的歌单").props.onClick;
  await act(async () => { read(); read(); }); assert.equal(count("rows"), 1); says("正在读取我的歌单");
  await finish("rows", oldRows); says("虚构旧账号歌单");
});
test("failed playlist refresh retains confirmed rows and its retry never imports or likes", async () => {
  await reset(); await click("我的歌单"); pending.rows = deferred(); await click("我的歌单");
  says("正在读取我的歌单"); says("虚构旧账号歌单");
  await finish("rows", readFailure("rows"), true); says("fictional_rows_failed"); says("虚构旧账号歌单");
  await click("重试读取歌单"); says("虚构旧账号歌单"); assert.equal(writes(), 0);
});
test("playlist detail has visible pending feedback, a scoped failure and read-only retry", async () => {
  await reset(); await click("我的歌单"); pending.detail = deferred(); await click("虚构旧账号歌单");
  says("正在读取歌单内容");
  await finish("detail", readFailure("detail"), true); says("fictional_detail_failed");
  pending.detail = deferred(); const retry = button("重试读取内容")?.props.onClick; assert.ok(retry, "Missing detail retry");
  await act(async () => { retry(); retry(); }); assert.equal(count("detail"), 2);
  await finish("detail", { playlist: { name: "虚构空歌单详情", tracks: [] } }); says("这个歌单暂无歌曲"); assert.equal(writes(), 0);
});
test("returning from pending detail cancels its receipt without changing confirmed playlists", async () => {
  await reset(); await click("我的歌单"); pending.detail = deferred(); await click("虚构旧账号歌单");
  const details = last("detail"); await click("← 返回歌单列表"); assert.equal(details.options.signal.aborted, true);
  await finish("detail", { playlist: { name: "虚构迟到详情", tracks: [] } }); doesNotSay("虚构迟到详情"); says("虚构旧账号歌单");
});
test("search failure retries its submitted query while preserving a later input draft", async () => {
  await reset(); pending.search = deferred(); await search(); says("搜索中");
  await finish("search", readFailure("search"), true); says("fictional_search_failed");
  await act(async () => tree.root.findByProps({ type: "search" }).props.onChange({ target: { value: "虚构后来草稿" } }));
  pending.search = deferred(); const retry = button("重试搜索")?.props.onClick; assert.ok(retry, "Missing search retry");
  await act(async () => { retry(); retry(); }); assert.equal(count("search"), 2);
  assert.ok(last("search").path.includes(encodeURIComponent("虚构关键词")));
  assert.equal(tree.root.findByProps({ type: "search" }).props.value, "虚构后来草稿");
  await finish("search", { items: [] }); says("没有找到相关歌曲"); doesNotSay("fictional_search_failed"); assert.equal(writes(), 0);
});
test("a hidden read error does not leak into another tab or overwrite its current status", async () => {
  await reset(); pending.daily = deferred(); await click("每日推荐"); await finish("daily", readFailure("daily"), true);
  says("fictional_daily_failed"); await click("搜歌"); doesNotSay("fictional_daily_failed");
  await search(); says("找到 1 首"); doesNotSay("fictional_daily_failed");
});
test("switching pending read types preserves the latest status and drops stale failure", async () => {
  await reset(); pending.daily = deferred(); await click("每日推荐"); const previous = last("daily");
  pending.history = deferred(); await click("听歌记录"); assert.equal(previous.options.signal.aborted, true);
  says("正在读取听歌记录"); doesNotSay("还没有听歌记录");
  await finish("daily", readFailure("daily"), true); doesNotSay("fictional_daily_failed"); says("正在读取听歌记录");
  await finish("history", { records: [] }); says("还没有听歌记录");
});
test("disconnect and a new identity discard pending read feedback and stale retry callbacks", async () => {
  await reset(); pending.rows = deferred(); await click("我的歌单"); await finish("rows", readFailure("rows"), true);
  const retry = button("重试读取歌单")?.props.onClick; assert.ok(retry, "Missing playlist retry");
  pending.rows = deferred(); await click("重试读取歌单"); const read = last("rows");
  await click("断开"); await reconnect(); assert.equal(read.options.signal.aborted, true);
  await finish("rows", readFailure("rows"), true); doesNotSay("fictional_rows_failed");
  await act(async () => { retry(); }); assert.equal(count("rows"), 2); doesNotSay("正在读取我的歌单");
});
test("a failed disconnect leaves canceled read feedback with a manual read-only recovery", async () => {
  await reset(); pending.daily = deferred(); await click("每日推荐"); const read = last("daily");
  pending.disconnect = deferred(); await click("断开"); says("读取已取消，可重新读取"); assert.equal(read.options.signal.aborted, true);
  await finish("disconnect", Object.assign(new Error("虚构断开失败"), { code: "fictional_disconnect_failed" }), true);
  says("fictional_disconnect_failed"); await finish("daily", readFailure("daily"), true); doesNotSay("fictional_daily_failed");
  await click("重试读取推荐"); says("虚构旧账号推荐"); assert.equal(count("daily"), 2); assert.equal(writes(), 0);
});
test("scope switch and unmount prevent delayed read feedback from updating a later page", async () => {
  await reset(); pending.history = deferred(); await click("听歌记录"); const read = last("history");
  account = "fictional-new-account"; companion = "fictional-new-companion";
  await act(async () => tree.update(React.createElement(Music, props()))); assert.equal(read.options.signal.aborted, true);
  await finish("history", readFailure("history"), true); doesNotSay("fictional_history_failed");
  pending.rows = deferred(); await click("我的歌单"); const next = last("rows"); await unmount(); assert.equal(next.options.signal.aborted, true);
  await finish("rows", oldRows); assert.equal(writes(), 0); assert.equal(nativeCalls, 0); assert.equal(browserCalls, 0);
});

let failures = 0;
try {
  ({ default: Music } = await vite.ssrLoadModule("/src/TogetherMusic.jsx"));
  for (const item of tests) {
    try { await item.run(); console.log("PASS " + item.name); }
    catch (error) { failures++; console.error("FAIL " + item.name + "\n" + String(error?.message || error).slice(0, 700)); }
  }
  console.log(`Cookie read feedback actual component: ${tests.length - failures}/${tests.length} passed; fictional API/native only, no audio playback.`);
  if (failures) process.exitCode = 1;
} finally { await unmount(); await vite.close(); delete globalThis.__cookieFeedback; }
