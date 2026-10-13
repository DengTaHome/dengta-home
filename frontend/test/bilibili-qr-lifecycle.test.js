import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};
const names = ["window", "document", "IS_REACT_ACT_ENVIRONMENT", "__bilibiliLifecycleFixture"];
const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const intervals = new Map();
let nextTimer = 0, tree, begins, checks, statusRead, beginRead, checkRead, browserRead, cookieReads, imports, videoReads;
const folders = [
  { media_id: "fictional-A", title: "虚构收藏A", media_count: 1 },
  { media_id: "fictional-B", title: "虚构收藏B", media_count: 1 },
];
const video = (name) => [{ bvid: `BVFICTIONAL${name}`, title: `虚构视频${name}`, page_url: `https://fictional.invalid/${name}` }];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = { hidden: false, body: {} };
globalThis.window = {
  setInterval(callback) { intervals.set(++nextTimer, callback); return nextTimer; },
  clearInterval: (id) => intervals.delete(id),
};
globalThis.__bilibiliLifecycleFixture = {
  getBilibiliQrStatus: () => statusRead?.promise || Promise.resolve({ connected: false }),
  beginBilibiliQrLogin() {
    begins++;
    return beginRead?.promise || Promise.resolve({ key: `fictional-key-${begins}`, qr_content: `https://fictional.invalid/qr-${begins}` });
  },
  checkBilibiliQrLogin() { checks++; return checkRead?.promise || Promise.resolve({ status: "expired" }); },
  disconnectBilibiliQrLogin: async () => true,
  listBilibiliFavoriteFolders: async () => folders,
  listBilibiliFavoriteVideos(id) { const pending = deferred(); videoReads.set(id, pending); return pending.promise; },
  openBuiltInBrowser: () => browserRead?.promise || Promise.resolve({ ok: true }),
  readBrowserCookie: async () => { cookieReads++; return { cookie: "fictional-placeholder" }; },
  apiRequest: async () => { imports++; return { connection: { connected: true, nickname: "虚构账号" } }; },
};
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  appType: "custom", logLevel: "silent", server: { middlewareMode: true },
  plugins: [{
    name: "bilibili-lifecycle-fixture", enforce: "pre",
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/BilibiliQrLogin.jsx")) {
        return code.replace('"react-dom"', '"virtual:bili-portal"')
          .replace('"./bilibili-qr-login.js"', '"virtual:bili-api"')
          .replace('"./browser-launcher.js"', '"virtual:bili-browser"')
          .replace('"./api.js"', '"virtual:bili-base"');
      }
    },
    resolveId(id) { if (id.startsWith("virtual:bili-")) return "\0" + id; },
    load(id) {
      if (id === "\0virtual:bili-portal") return "export const createPortal = (node) => node;";
      const exports = {
        "\0virtual:bili-api": ["getBilibiliQrStatus", "beginBilibiliQrLogin", "checkBilibiliQrLogin", "disconnectBilibiliQrLogin", "listBilibiliFavoriteFolders", "listBilibiliFavoriteVideos"],
        "\0virtual:bili-browser": ["openBuiltInBrowser", "readBrowserCookie"],
        "\0virtual:bili-base": ["apiRequest"],
      }[id];
      if (exports) return exports.map((name) => `export const ${name}=(...args)=>globalThis.__bilibiliLifecycleFixture.${name}(...args);`).join("\n");
    },
  }],
});
const { default: BilibiliQrLogin } = await vite.ssrLoadModule("/src/BilibiliQrLogin.jsx");
const mount = async () => act(async () => { tree = TestRenderer.create(React.createElement(BilibiliQrLogin)); });
const unmount = async () => { if (tree) { await act(async () => tree.unmount()); tree = null; } };
const button = (label) => tree.root.findAllByType("button").find((node) => node.children.includes(label) || node.children.join("") === label);
const click = async (label) => act(async () => { button(label).props.onClick(); });
const text = () => JSON.stringify(tree.toJSON());
const tick = async () => act(async () => {
  [...intervals.values()].forEach((callback) => callback());
  await Promise.resolve(); await Promise.resolve();
});
const connect = async () => {
  statusRead = deferred(); statusRead.resolve({ connected: true, nickname: "虚构账号" });
  await mount(); await click("读取收藏夹");
};
beforeEach(() => {
  begins = 0; checks = 0; cookieReads = 0; imports = 0;
  statusRead = null; beginRead = null; checkRead = null; browserRead = null;
  videoReads = new Map(); intervals.clear();
});
afterEach(async () => { await unmount(); intervals.clear(); });
after(async () => {
  await vite.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

test("same-tick login clicks issue one begin request", async () => {
  beginRead = deferred(); await mount();
  const start = button("扫码登录哔哩哔哩").props.onClick;
  await act(async () => { start(); start(); });
  assert.equal(begins, 1);
  await act(async () => beginRead.resolve({ key: "fictional-key", qr_content: "https://fictional.invalid/qr" }));
});

test("begin receipt after unmount cannot restart polling", async () => {
  beginRead = deferred(); await mount(); await click("扫码登录哔哩哔哩"); await unmount();
  await act(async () => beginRead.resolve({ key: "fictional-old", qr_content: "https://fictional.invalid/old" }));
  assert.equal(intervals.size, 0);
  await tick(); assert.equal(checks, 0);
});

test("cancelled generation cannot reopen or unlock a newer QR request", async () => {
  await mount(); await click("扫码登录哔哩哔哩");
  const older = deferred(); beginRead = older; await click("重新生成"); await click("取消");
  assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0);
  assert.ok(button("扫码登录哔哩哔哩"), "cancelling releases the pending generation for a new attempt");
  const newer = deferred(); beginRead = newer; await click("扫码登录哔哩哔哩");
  await act(async () => older.resolve({ key: "fictional-old", qr_content: "https://fictional.invalid/old" }));
  assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0);
  assert.equal(button("正在生成…").props.disabled, true);
  await act(async () => newer.resolve({ key: "fictional-new", qr_content: "https://fictional.invalid/new" }));
  assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 1);
  assert.equal(tree.root.findByProps({ className: "netease-qr-fallback-button" }).props.href, "https://fictional.invalid/new");
});

for (const receipt of [{ status: "confirmed", connection: { connected: true, nickname: "虚构迟到账号" } }, { status: "expired" }]) test(`cancel ignores the old in-flight poll: ${receipt.status}`, async () => {
  await mount(); await click("扫码登录哔哩哔哩"); checkRead = deferred(); await tick(); await click("取消");
  await act(async () => checkRead.resolve(receipt));
  assert.equal(intervals.size, 0);
  assert.equal(begins, 1);
  assert.equal(text().includes("虚构迟到账号"), false);
  assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0);
});

test("slow poll is not duplicated by the next timer tick", async () => {
  await mount(); await click("扫码登录哔哩哔哩"); checkRead = deferred(); await tick(); await tick();
  assert.equal(checks, 1);
  await act(async () => checkRead.resolve({ status: "waiting" }));
});

test("six automatic QR renewals stop at a manual recovery prompt", async () => {
  await mount(); await click("扫码登录哔哩哔哩");
  for (let count = 0; count < 8; count++) await tick();
  assert.equal(begins, 7);
  assert.equal(checks, 7);
  assert.equal(intervals.size, 0);
  assert.ok(text().includes("二维码多次过期，请手动点击“重新生成”"));
  await click("重新生成"); assert.equal(begins, 8); assert.equal(intervals.size, 1);
});

for (const order of [["A", "B"], ["B", "A"]]) test(`latest selected folder wins for receipt order ${order.join(" then ")}`, async () => {
  await connect(); await click("虚构收藏A · 1 个"); await click("虚构收藏B · 1 个");
  await act(async () => videoReads.get(`fictional-${order[0]}`).resolve(video(order[0])));
  if (order[0] === "A") assert.equal(button("虚构收藏B · 1 个 正在读取…").props.disabled, true);
  await act(async () => videoReads.get(`fictional-${order[1]}`).resolve(video(order[1])));
  assert.ok(text().includes("虚构视频B"));
  assert.equal(text().includes("虚构视频A"), false);
});

test("logout invalidates pending favorite reads and stale folder buttons", async () => {
  await connect(); const staleFolder = button("虚构收藏A · 1 个").props.onClick;
  await click("虚构收藏A · 1 个"); await click("退出登录");
  await act(async () => videoReads.get("fictional-A").resolve(video("A")));
  assert.ok(button("扫码登录哔哩哔哩")); assert.equal(text().includes("虚构视频A"), false);
  const previous = videoReads.get("fictional-A");
  await act(async () => staleFolder()); assert.equal(videoReads.get("fictional-A"), previous);
});

test("initial connection read cannot overwrite a newer QR login receipt", async () => {
  statusRead = deferred(); await mount(); await click("扫码登录哔哩哔哩");
  checkRead = deferred(); await tick();
  await act(async () => checkRead.resolve({ status: "confirmed", connection: { connected: true, nickname: "虚构新账号" } }));
  await act(async () => statusRead.resolve({ connected: false }));
  assert.ok(button("读取收藏夹")); assert.ok(text().includes("虚构新账号"));
});

test("browser login finishing after unmount does not read or import cookies", async () => {
  browserRead = deferred(); await mount(); await click("内置浏览器登录（登录态长期有效）"); await unmount();
  await act(async () => browserRead.resolve({ ok: true }));
  assert.equal(cookieReads, 0); assert.equal(imports, 0);
});
