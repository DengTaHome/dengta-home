import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originals = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document, createImageBitmap: globalThis.createImageBitmap };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const listeners = new Set();
let identity, requests, notices, authWait, postWait, jsonWait, bitmapWait, postResponse, rows, tree, confirms, confirmResult;
globalThis.__creativeLifecycleAuth = {
  getSnapshot: () => ({ user: { id: identity.account }, activeCompanionId: identity.companion }),
  async getRequestContext() { if (authWait) await authWait.promise; return { accessToken: identity.account, companionId: identity.companion }; },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
};
globalThis.window = { setTimeout, clearTimeout, confirm: () => { confirms++; return confirmResult; } };
globalThis.document = { createElement(name) { assert.equal(name, "canvas"); return { getContext: () => ({ drawImage() {} }), toBlob: callback => callback(new Blob(["fictional-image"], { type: "image/webp" })) }; } };
globalThis.createImageBitmap = async () => bitmapWait ? bitmapWait.promise : { width: 8, height: 8, close() {} };
globalThis.fetch = async (url, options) => {
  const path = new URL(url).pathname;
  requests.push({ path, account: options.headers.get("Authorization").replace("Bearer ", ""), companion: options.headers.get("X-DengTa-Companion-Id"), method: options.method || "GET", signal: options.signal, body: options.body ? JSON.parse(options.body) : undefined });
  if (options.method === "POST") {
    if (postWait) return postWait.promise;
    if (jsonWait) return { ok: true, status: 200, headers: new Headers(), json: () => jsonWait.promise };
    return postResponse || response({ created: true, ok: true });
  }
  if (path.endsWith("/status")) return response({ settings: { generation_mode: "confirm" }, provider: { configured: true, enabled: true, auth_configured: true } });
  if (path.endsWith("/artworks")) return response({ artworks: rows });
  return response({ ok: true });
};
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{ name: "creative-lifecycle-auth-only", enforce: "pre", load(id) {
  if (id.replaceAll("\\", "/").endsWith("/src/auth-session.js")) return "export const authSession=globalThis.__creativeLifecycleAuth;";
} }] });
const { CompanionArtworkLibrary: Library } = await vite.ssrLoadModule("/src/CompanionCreativeStudio.jsx");
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const button = label => tree.root.findAllByType("button").find(node => text(node) === label);
const render = () => React.createElement(Library, { key: JSON.stringify(identity), aiName: "虚构伙伴", onNotice: message => notices.push(message) });
async function mount(artworks = []) {
  identity = { account: "fictional-a", companion: "fictional-companion-a" }; requests = []; notices = []; rows = artworks;
  authWait = postWait = jsonWait = bitmapWait = postResponse = null; confirms = 0; confirmResult = true;
  await act(async () => { tree = TestRenderer.create(render()); });
}
async function switchScope(next) { identity = next; listeners.forEach(listener => listener()); await act(async () => tree.update(render())); }
const uploadEvent = () => ({ target: { files: [{ type: "image/png", size: 16, name: "fictional-a.png" }], value: "fixture" } });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; assert.equal(listeners.size, 0); });
after(async () => { await vite.close(); Object.assign(globalThis, originals); delete globalThis.__creativeLifecycleAuth; });

for (const next of [{ account: "fictional-b", companion: "fictional-companion-b" }, { account: "fictional-a", companion: "fictional-other-companion" }]) {
  test(`deferred old image decode cannot upload into ${next.account}/${next.companion}`, async () => {
    await mount(); bitmapWait = deferred(); let pending;
    await act(async () => { pending = tree.root.findByType("input").props.onChange(uploadEvent()); });
    await switchScope(next);
    await act(async () => { bitmapWait.resolve({ width: 8, height: 8, close() {} }); await pending; });
    assert.equal(requests.filter(call => call.method === "POST").length, 0); assert.deepEqual(notices, []);
    assert.doesNotMatch(text(tree.toJSON()), /图片已去除/);
  });
}

test("old accepted idea request is aborted locally and late receipt cannot refresh the new account or notify", async () => {
  await mount(); postWait = deferred(); let pending;
  await act(async () => { pending = button("想一张涂鸦").props.onClick(); });
  const request = requests.at(-1); assert.equal(request.account, "fictional-a");
  await switchScope({ account: "fictional-b", companion: "fictional-companion-b" });
  assert.equal(request.signal.aborted, true);
  const count = requests.length;
  await act(async () => { postWait.resolve(response({ created: true })); await pending; });
  assert.equal(requests.length, count); assert.deepEqual(notices, []); assert.equal(button("想一张涂鸦").props.disabled, false);
});

test("scope switch during response JSON decoding drops old result even after fetch finished", async () => {
  await mount(); jsonWait = deferred(); let pending;
  await act(async () => { pending = button("想一张涂鸦").props.onClick(); });
  await switchScope({ account: "fictional-a", companion: "fictional-other-companion" });
  const count = requests.length;
  await act(async () => { jsonWait.resolve({ created: true }); await pending; });
  assert.equal(requests.length, count); assert.deepEqual(notices, []);
});

test("scope switch while authentication resolves prevents sending an old operation with new credentials", async () => {
  await mount(); authWait = deferred(); let pending;
  await act(async () => { pending = button("想一张涂鸦").props.onClick(); });
  await switchScope({ account: "fictional-b", companion: "fictional-companion-b" });
  await act(async () => { authWait.resolve(); await pending; });
  assert.equal(requests.filter(call => call.method === "POST").length, 0); assert.deepEqual(notices, []);
});

test("same-tick idea clicks share the synchronous lock; successful refresh stays in the issuing scope", async () => {
  await mount(); postWait = deferred(); let first, second;
  const click = button("想一张涂鸦").props.onClick;
  await act(async () => { first = click(); second = click(); });
  assert.equal(requests.filter(call => call.method === "POST").length, 1);
  assert.equal(button("正在想…").props.disabled, true);
  await act(async () => { postWait.resolve(response({ created: true })); await Promise.all([first, second]); });
  assert.deepEqual(notices, ["虚构伙伴已经留下构思，图片还没有生成。"]);
  assert.ok(requests.every(call => call.account === "fictional-a" && call.companion === "fictional-companion-a"));
  assert.equal(button("想一张涂鸦").props.disabled, false);
});

test("manual upload still prepares fictional bytes and stores only one image without a model call", async () => {
  await mount(); let first, second;
  const change = tree.root.findByType("input").props.onChange;
  await act(async () => { first = change(uploadEvent()); second = change(uploadEvent()); await Promise.all([first, second]); });
  const writes = requests.filter(call => call.method === "POST");
  assert.equal(writes.length, 1); assert.equal(writes[0].path, "/api/v2/creative/artworks/upload");
  assert.equal(writes[0].account, "fictional-a"); assert.equal(writes[0].body.mime_type, "image/webp");
  assert.match(text(tree.toJSON()), /没有调用图片模型/);
});

test("cost confirmation, failure feedback and explicit retry remain available; double clicks cannot generate twice", async () => {
  const artwork = { id: "fictional-artwork", kind: "doodle", state: "awaiting_confirmation", title: "虚构涂鸦" };
  await mount([artwork]); confirmResult = false;
  await act(async () => button("确认费用并生成").props.onClick());
  assert.equal(requests.filter(call => call.method === "POST").length, 0);
  confirmResult = true; postWait = deferred(); let first, second;
  const click = button("确认费用并生成").props.onClick;
  await act(async () => { first = click(); second = click(); });
  assert.equal(confirms, 2, "cancelled first confirmation plus one accepted confirmation");
  assert.equal(requests.filter(call => call.method === "POST").length, 1);
  rows = [{ ...artwork, state: "failed", failure_code: "creative_provider_request_failed" }];
  await act(async () => { postWait.resolve(response({ code: "creative_provider_request_failed", message: "虚构接口失败" }, 502)); await Promise.all([first, second]); });
  assert.match(text(tree.toJSON()), /虚构接口失败/); assert.equal(button("确认费用后重试").props.disabled, false);
  postWait = null;
  await act(async () => button("确认费用后重试").props.onClick());
  assert.equal(requests.filter(call => call.method === "POST").length, 2);
  assert.equal(requests.filter(call => call.method === "POST").every(call => call.body.acknowledge_cost === true), true);
});

test("unmount aborts pending work and suppresses a late receipt", async () => {
  await mount(); postWait = deferred(); let pending;
  await act(async () => { pending = button("想一张涂鸦").props.onClick(); });
  const request = requests.at(-1), count = requests.length;
  await act(async () => tree.unmount()); tree = null;
  assert.equal(request.signal.aborted, true);
  await act(async () => { postWait.resolve(response({ created: true })); await pending; });
  assert.equal(requests.length, count); assert.deepEqual(notices, []);
});

test("generating artwork offers an explicit read-only refresh and recovery guidance without another paid call", async () => {
  const artwork = { id: "fictional-pending", kind: "doodle", state: "generating", title: "虚构待确认作品", actual_call_count: 1 };
  await mount([artwork]);
  assert.match(text(tree.toJSON()), /删除不会撤回已提交的接口调用/);
  assert.match(text(tree.toJSON()), /重新生成可能产生新的接口费用/);
  assert.equal(button("确认费用后重试"), undefined);
  rows = [{ ...artwork, state: "ready" }];
  const initialReads = requests.length;
  await act(async () => button("刷新作品状态").props.onClick());
  assert.equal(requests.length, initialReads + 2);
  assert.ok(requests.every(call => call.method === "GET"));
  assert.equal(confirms, 0);
  assert.match(text(tree.toJSON()), /已经画好/);
  assert.equal(button("刷新作品状态"), undefined);
});

test("refresh errors keep the generating artwork and its recovery controls usable", async () => {
  await mount([{ id: "fictional-pending", kind: "doodle", state: "generating", title: "虚构待确认作品" }]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response({ message: "虚构数据库暂时不可用", code: "fictional_database_unavailable" }, 503);
  try {
    await act(async () => button("刷新作品状态").props.onClick());
    assert.match(text(tree.toJSON()), /虚构数据库暂时不可用/);
    assert.equal(button("刷新作品状态").props.disabled, false);
    assert.equal(button("删除").props.disabled, false);
    assert.equal(requests.filter(call => call.method === "POST").length, 0);
  } finally { globalThis.fetch = originalFetch; }
});
