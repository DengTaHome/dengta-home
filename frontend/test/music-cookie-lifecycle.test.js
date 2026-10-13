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
globalThis.__cookieLifecycle = fixture;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{
  name: "cookie-lifecycle-fictional-boundary", enforce: "pre",
  transform(code, id) { if (id.replaceAll("\\", "/").endsWith("/src/netease-playback.js")) return code.replace('"@capacitor/core"', '"virtual:cookie-native"'); },
  resolveId(id) { if (id === "virtual:cookie-native") return "\0" + id; },
  load(id) {
    const normalized = id.replaceAll("\\", "/");
    if (normalized.endsWith("/src/api.js")) return "export const apiRequest=(...args)=>globalThis.__cookieLifecycle.request(...args);export const apiFetch=apiRequest;";
    if (normalized.endsWith("/src/auth-session.js")) return "export const authSession=globalThis.__cookieLifecycle.auth;";
    if (normalized.endsWith("/src/browser-launcher.js")) return "export const browserLauncherAvailable=()=>globalThis.__cookieLifecycle.available();export const openBuiltInBrowser=(...args)=>globalThis.__cookieLifecycle.browser(...args);export const readBrowserCookie=(...args)=>globalThis.__cookieLifecycle.readCookie(...args);";
    if (id === "\0virtual:cookie-native") return "export const Capacitor={isNativePlatform:()=>true};export const registerPlugin=()=>({open:(...args)=>globalThis.__cookieLifecycle.native(...args)});";
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
  await act(async () => tree.root.findByProps({ className: "music-cookie-search" }).props.onSubmit({ preventDefault() {} }));
}
async function reconnect() { await click("内置浏览器登录"); assert.match(output(), /虚构新网易账号/); }
async function finish(kind, value, fail = false) { await act(async () => { if (fail) pending[kind].reject(value); else pending[kind].resolve(value); }); delete pending[kind]; }
const tests = [];
const test = (name, run) => tests.push({ name, run });
let Music;
test("disconnect cancels old playlist success before new provider login", async () => {
  await reset(); pending.rows = deferred(); await click("我的歌单"); const old = last("rows");
  await click("断开"); assert.equal(old.options.signal.aborted, true); await reconnect();
  await finish("rows", oldRows); assert.doesNotMatch(output(), /虚构旧账号歌单/); assert.match(output(), /虚构新网易账号/);
});
test("late cookie read failure cannot replace the new account feedback", async () => {
  await reset(); pending.daily = deferred(); await click("每日推荐"); const old = last("daily");
  await click("断开"); await reconnect(); assert.equal(old.options.signal.aborted, true);
  await finish("daily", Object.assign(new Error("虚构迟到读取错误"), { code: "fictional_late_read" }), true);
  assert.doesNotMatch(output(), /fictional_late_read/); assert.match(output(), /虚构新网易账号/);
});
test("confirmed identity change clears cached cookie views and retains local audio", async () => {
  await reset(); await act(async () => tree.root.findAllByType("select").find(node => node.findAllByType("option").some(option => option.props.value === localPlaylist.id)).props.onChange({ target: { value: localPlaylist.id } }));
  const source = tree.root.findByType("audio").props.src;
  await search(); await click("每日推荐"); await click("听歌记录"); await click("我的歌单"); await click("虚构旧账号歌单");
  await click("断开"); await reconnect();
  await click("搜歌"); assert.doesNotMatch(output(), /虚构旧账号歌曲/);
  pending.rows = deferred(); await click("我的歌单"); assert.doesNotMatch(output(), /虚构旧账号歌单|虚构旧账号详情/);
  pending.daily = deferred(); await click("每日推荐"); assert.doesNotMatch(output(), /虚构旧账号推荐/);
  pending.history = deferred(); await click("听歌记录"); assert.doesNotMatch(output(), /虚构旧账号记录/);
  assert.equal(tree.root.findByType("audio").props.src, source); assert.match(output(), /虚构本地音频/);
});
test("disconnect failure preserves login and cached results while discarding canceled work", async () => {
  await reset(); await click("我的歌单"); pending.detail = deferred(); await click("虚构旧账号歌单"); const detail = last("detail");
  pending.disconnect = deferred(); await click("断开"); assert.equal(detail.options.signal.aborted, true);
  await finish("disconnect", Object.assign(new Error("虚构断开失败"), { code: "fictional_disconnect_failed" }), true);
  assert.match(output(), /虚构旧网易账号/); assert.match(output(), /虚构旧账号歌单/); assert.match(output(), /fictional_disconnect_failed/);
  assert.equal(button("断开").props.disabled, false);
  await finish("detail", { playlist: { name: "虚构迟到详情", tracks: [] } }); assert.doesNotMatch(output(), /虚构迟到详情/);
  await click("虚构旧账号歌单"); assert.equal(count("detail"), 2);
});
test("same-tick disconnect locks stale search browse write and external clicks", async () => {
  await reset(); await search();
  const submit = tree.root.findByProps({ className: "music-cookie-search" }).props.onSubmit;
  const browse = button("每日推荐").props.onClick, like = button("♥").props.onClick, play = button("播放").props.onClick, leave = button("断开").props.onClick;
  pending.disconnect = deferred();
  await act(async () => { leave(); submit({ preventDefault() {} }); browse(); like(); play(); leave(); });
  assert.equal(count("disconnect"), 1); assert.equal(count("search"), 1); assert.equal(count("daily"), 0); assert.equal(count("like"), 0); assert.equal(nativeCalls, 0);
  await finish("disconnect", { session: { connected: false } }); await reconnect();
  await act(async () => { submit({ preventDefault() {} }); browse(); like(); play(); leave(); });
  assert.equal(count("search"), 1); assert.equal(count("daily"), 0); assert.equal(count("like"), 0); assert.equal(nativeCalls, 0); assert.equal(count("disconnect"), 1);
});
test("identity change aborts an already submitted write and ignores late success or failure", async () => {
  for (const fail of [false, true]) {
    await reset(); await search(); pending.like = deferred(); await click("♥"); const write = last("like");
    await click("断开"); await reconnect(); assert.equal(write.options.signal.aborted, true);
    await finish("like", fail ? Object.assign(new Error("虚构迟到红心失败"), { code: "fictional_late_write" }) : { liked: true }, fail);
    assert.doesNotMatch(output(), /已红心|fictional_late_write/); assert.equal(count("like"), 1);
  }
});
test("cookie import follow-up uses the canceled write scope without replacing local playback", async () => {
  await reset(); await act(async () => tree.root.findAllByType("select").find(node => node.findAllByType("option").some(option => option.props.value === localPlaylist.id)).props.onChange({ target: { value: localPlaylist.id } }));
  const source = tree.root.findByType("audio").props.src;
  await click("我的歌单"); pending["imported-detail"] = deferred(); await click("导入"); const read = last("imported-detail");
  await click("断开"); assert.equal(read.options.signal.aborted, true);
  await finish("imported-detail", { playlist: { ...localPlaylist, id: "fictional-imported", name: "虚构迟到导入" } });
  assert.doesNotMatch(output(), /虚构迟到导入/); assert.equal(tree.root.findByType("audio").props.src, source);
});
test("canceling a pending native open prevents its later metadata request", async () => {
  await reset(); await search(); pending.native = deferred(); await click("播放"); assert.equal(nativeCalls, 1);
  await click("断开"); await reconnect(); await finish("native", { opened: true, target: "fictional-native" });
  assert.equal(count("external"), 0); assert.doesNotMatch(output(), /已交给网易云打开/);
});
test("already opened cookie playback cancels its pending metadata feedback", async () => {
  await reset(); await search(); pending.external = deferred(); await click("播放");
  const metadata = last("external"); assert.equal(nativeCalls, 1); assert.equal(count("external"), 1);
  await click("断开"); await reconnect(); assert.equal(metadata.options.signal.aborted, true);
  await finish("external", Object.assign(new Error("虚构迟到外部确认失败"), { code: "fictional_late_external" }), true);
  assert.equal(nativeCalls, 1); assert.doesNotMatch(output(), /fictional_late_external|已交给网易云打开/);
});
test("new confirmed provider repeats the same activity query once after identity change", async () => {
  const request = { id: "fictional-activity", query: "虚构活动关键词" };
  await reset({ request }); assert.equal(count("search"), 1);
  pending.disconnect = deferred(); await click("断开"); assert.equal(count("search"), 1);
  await finish("disconnect", { session: { connected: false } }); await reconnect(); assert.equal(count("search"), 2);
  await act(async () => tree.update(React.createElement(Music, { ...props(), request }))); assert.equal(count("search"), 2);
});
test("failed disconnect does not consume or repeat the previous activity query", async () => {
  await reset({ request: { id: "fictional-activity", query: "虚构活动关键词" } }); assert.equal(count("search"), 1);
  pending.disconnect = deferred(); await click("断开");
  await finish("disconnect", Object.assign(new Error("虚构断开失败"), { code: "fictional_disconnect_failed" }), true);
  assert.equal(count("search"), 1); assert.match(output(), /虚构旧账号歌曲/);
});
test("activity query arriving during identity change waits for confirmed scope availability", async () => {
  await reset(); pending.disconnect = deferred(); await click("断开");
  const request = { id: "fictional-new-activity", query: "虚构后来活动" };
  await act(async () => tree.update(React.createElement(Music, { ...props(), request }))); assert.equal(count("search"), 0);
  await finish("disconnect", Object.assign(new Error("虚构断开失败"), { code: "fictional_disconnect_failed" }), true);
  assert.equal(count("search"), 1); assert.ok(last("search").path.includes(encodeURIComponent(request.query)));
});
test("unconfirmed save receipts preserve disconnected state and expose the precise error", async () => {
  for (const receipt of [null, {}, { session: { connected: false } }]) {
    await reset({ login: false }); pending.save = deferred(); await click("内置浏览器登录"); await finish("save", receipt);
    assert.match(output(), /music_cookie_receipt_invalid/); assert.doesNotMatch(output(), /网易云登录状态已保存/);
    assert.ok(button("内置浏览器登录")); assert.equal(count("library"), 1);
  }
});
test("scope switch and unmount reject delayed cookie login and stale callbacks", async () => {
  await reset({ login: false }); pending.browser = deferred(); const login = button("内置浏览器登录").props.onClick;
  await act(async () => { login(); }); await unmount(); await finish("browser", { ok: true }); assert.equal(count("save"), 0);
  await act(async () => { login(); }); assert.equal(browserCalls, 1);
  await reset(); pending.rows = deferred(); await click("我的歌单"); const read = last("rows");
  const browse = button("每日推荐").props.onClick; account = "fictional-new-account"; companion = "fictional-new-companion";
  await act(async () => tree.update(React.createElement(Music, props()))); assert.equal(read.options.signal.aborted, true);
  await finish("rows", oldRows); await act(async () => { browse(); });
  assert.doesNotMatch(output(), /虚构旧账号歌单/); assert.equal(count("daily"), 0);
});
test("duplicate login and a delayed browser receipt cannot save into a switched scope", async () => {
  await reset({ login: false }); pending.browser = deferred(); const login = button("内置浏览器登录").props.onClick;
  await act(async () => { login(); login(); }); assert.equal(browserCalls, 1);
  account = "fictional-new-account"; companion = "fictional-new-companion";
  await act(async () => tree.update(React.createElement(Music, props())));
  assert.equal(button("内置浏览器登录").props.disabled, false);
  await finish("browser", { ok: true }); assert.equal(count("save"), 0);
  await act(async () => { login(); }); assert.equal(browserCalls, 1);
  await click("内置浏览器登录"); assert.equal(browserCalls, 2); assert.equal(count("save"), 1);
});

let failures = 0;
try {
  ({ default: Music } = await vite.ssrLoadModule("/src/TogetherMusic.jsx"));
  for (const item of tests) {
    try { await item.run(); console.log("PASS " + item.name); }
    catch (error) { failures++; console.error("FAIL " + item.name + "\n" + (error?.stack || error)); }
  }
  console.log(`Cookie lifecycle actual component: ${tests.length - failures}/${tests.length} passed; only fictional API and native boundary calls.`);
  if (failures) process.exitCode = 1;
} finally { await unmount(); await vite.close(); delete globalThis.__cookieLifecycle; }
