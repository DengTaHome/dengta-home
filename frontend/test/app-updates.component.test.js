import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer as httpServer } from "node:http";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer, transformWithOxc } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const release = { version_code: 122, version: "2.10.74", apk_url: "https://github.com/DengTaHome/dengta-home-frontend/releases/download/v2.10.74/DengTa-2.10.74-122.apk", sha256: "b".repeat(64), size_bytes: 40_000_000, published_at: "2026-10-16T00:00:00Z", notes: ["虚构测试：返回手势", "虚构测试：重连改进"] };
let payload = { schema_version: 1, package_id: "home.dengta.app", channel: "stable", latest: release };
const requests = [], listeners = new Map(), nativeListeners = new Map(), downloads = [], preferences = [];
const server = httpServer((request, response) => { requests.push({ path: request.url, headers: request.headers }); response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(payload)); });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/updates/android.json`;
const originalFetch = globalThis.fetch;
const originals = Object.fromEntries(["window", "document", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
globalThis.fetch = (target, options) => { assert.equal(target, "https://www.dengtahome.com/updates/android.json"); return originalFetch(url, options); };
const values = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener: (key, listener) => listeners.set(key, listener), removeEventListener: key => listeners.delete(key) } });
Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: null, addEventListener() {}, removeEventListener() {} } });
globalThis.__updateFixture = {
  App: { getInfo: async () => ({ build: "121", version: "2.10.73" }), addListener: async (key, listener) => { nativeListeners.set(key, listener); return { remove() { nativeListeners.delete(key); } }; } },
  Native: { schedule: async () => ({ enabled: true }), consumeLaunch: async () => ({ available: false }), openDownload: async value => { downloads.push(value.url); return { opened: true }; }, setEnabled: async value => { preferences.push(value.enabled); } },
  Notifications: { checkPermissions: async () => ({ display: "granted" }) },
};
const vite = await createServer({ configFile: false, envDir: false, root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{
  name: "actual-update-center",
  resolveId(id) { if (id === "virtual:update-center") return "\0update-center.jsx"; },
  async load(id) {
    if (id !== "\0update-center.jsx") return;
    const code = readFileSync(new URL("../src/AppUpdateCenter.jsx", import.meta.url), "utf8")
      .replace('import { App } from "@capacitor/app";', 'const App=globalThis.__updateFixture.App;')
      .replace('import { Capacitor, registerPlugin } from "@capacitor/core";', 'const Capacitor={getPlatform:()=>"android"};const registerPlugin=()=>globalThis.__updateFixture.Native;')
      .replace('import { LocalNotifications } from "@capacitor/local-notifications";', 'const LocalNotifications=globalThis.__updateFixture.Notifications;')
      .replaceAll('from "./', 'from "/src/').replace('import "./app-updates.css";', '');
    return (await transformWithOxc(code, "update-center.jsx", { lang: "jsx", jsx: { runtime: "automatic" } })).code;
  },
}] });
const { default: UpdateCenter } = await vite.ssrLoadModule("virtual:update-center");
let tree;
const text = node => typeof node === "string" ? node : (Array.isArray(node) ? node : node?.children || []).map(text).join("");
const button = label => tree.root.findAllByType("button").find(node => text(node) === label);
async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.fail("The real HTTP update flow did not settle");
}
after(async () => {
  if (tree) await act(async () => tree.unmount());
  await vite.close(); await new Promise(resolve => server.close(resolve));
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  delete globalThis.__updateFixture; delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

test("real update UI reads the public feed over HTTP, waits for idle, and downloads only on user activation", async () => {
  await act(async () => { tree = TestRenderer.create(React.createElement(UpdateCenter, { canPrompt: false })); });
  await until(() => requests.length === 1);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0); assert.equal(downloads.length, 0);
  await act(async () => tree.update(React.createElement(UpdateCenter, { canPrompt: true })));
  await until(() => tree.root.findAllByProps({ role: "dialog" }).length === 1);
  assert.match(text(tree.toJSON()), /2.10.73.*2.10.74/); assert.match(text(tree.toJSON()), /虚构测试：返回手势/);
  assert.equal(requests[0].path, "/updates/android.json"); assert.equal(requests[0].headers.authorization, undefined); assert.equal(requests[0].headers.cookie, undefined);
  const native = globalThis.__updateFixture.Native, openDownload = native.openDownload;
  let finishDownload;
  native.openDownload = value => { downloads.push(value.url); return new Promise(resolve => { finishDownload = resolve; }); };
  const activateDownload = button("下载更新").props.onClick;
  await act(async () => { activateDownload(); activateDownload(); });
  assert.deepEqual(downloads, [release.apk_url]);
  assert.equal(button("正在打开…").props.disabled, true);
  await act(async () => finishDownload({ opened: true }));
  native.openDownload = openDownload;
  await act(async () => button("稍后提醒").props.onClick()); assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0);
  await act(async () => listeners.get("dengta:check-app-updates")());
  await until(() => requests.length === 2 && tree.root.findAllByProps({ role: "dialog" }).length === 1);
  await act(async () => button("稍后提醒").props.onClick());
});

test("manual checks explain invalid receipts; notification preferences stop background checks and cleanup removes listeners", async () => {
  await act(async () => listeners.get("dengta:check-app-updates")());
  await until(() => tree.root.findAllByProps({ role: "dialog" }).length === 1);
  const prior = requests.length;
  payload = { schema_version: 1, package_id: "home.dengta.app", channel: "stable", latest: null };
  await act(async () => listeners.get("dengta:check-app-updates")());
  await until(() => requests.length > prior && text(tree.toJSON()).includes("当前没有比已安装版本更新"));
  assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0);
  assert.equal(button("下载更新"), undefined);
  payload = {};
  await act(async () => listeners.get("dengta:check-app-updates")());
  await until(() => text(tree.toJSON()).includes("app_update_manifest_invalid"));
  assert.equal(downloads.length, 1); assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0);
  await act(async () => listeners.get("dengta:app-update-preferences")());
  await act(async () => button("关闭后台更新通知").props.onClick());
  assert.deepEqual(preferences, [false]); assert.ok(button("开启后台更新通知"));
  await act(async () => tree.unmount()); tree = null;
  assert.equal(listeners.size, 0); assert.equal(nativeListeners.size, 0);
});

test("system permission is never requested on startup and disabled system notifications can be enabled directly", async () => {
  let requested = 0;
  const notifications = globalThis.__updateFixture.Notifications;
  notifications.checkPermissions = async () => ({ display: "denied" });
  notifications.requestPermissions = async () => { requested++; return { display: "denied" }; };
  payload = { schema_version: 1, package_id: "home.dengta.app", channel: "stable", latest: null };
  await act(async () => { tree = TestRenderer.create(React.createElement(UpdateCenter)); });
  assert.equal(requested, 0);
  await act(async () => listeners.get("dengta:app-update-preferences")());
  assert.ok(button("开启后台更新通知"));
  await act(async () => button("开启后台更新通知").props.onClick());
  assert.equal(requested, 1);
  assert.match(text(tree.toJSON()), /系统未允许通知/);
  assert.ok(button("开启后台更新通知"));
  notifications.checkPermissions = async () => ({ display: "granted" });
  await act(async () => button("开启后台更新通知").props.onClick());
  assert.equal(requested, 1);
  assert.equal(preferences.at(-1), true);
  assert.ok(button("关闭后台更新通知"));
  await act(async () => tree.unmount()); tree = null;
});

test("duplicate notification toggles are serialized and a late startup receipt cannot undo the user's choice", async () => {
  const native = globalThis.__updateFixture.Native, schedule = native.schedule, setEnabled = native.setEnabled;
  let finishSchedule, finishSave, saves = 0;
  native.schedule = () => new Promise(resolve => { finishSchedule = resolve; });
  native.setEnabled = () => { saves++; return new Promise(resolve => { finishSave = resolve; }); };
  globalThis.__updateFixture.Notifications.checkPermissions = async () => ({ display: "granted" });
  payload = { schema_version: 1, package_id: "home.dengta.app", channel: "stable", latest: null };
  await act(async () => { tree = TestRenderer.create(React.createElement(UpdateCenter)); });
  await act(async () => listeners.get("dengta:app-update-preferences")());
  const toggle = button("关闭后台更新通知").props.onClick;
  await act(async () => { toggle(); toggle(); });
  assert.equal(saves, 1);
  assert.equal(button("正在保存…").props.disabled, true);
  await act(async () => finishSave({ enabled: false }));
  assert.ok(button("开启后台更新通知"));
  await act(async () => finishSchedule({ enabled: true }));
  assert.ok(button("开启后台更新通知"));
  await act(async () => tree.unmount()); tree = null;
  native.schedule = schedule; native.setEnabled = setEnabled;
});
