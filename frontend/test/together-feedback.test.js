import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createCoWatchLifecycle } from "../src/co-watch-lifecycle.js";
import { createCoWatchViewScope } from "../src/co-watch-view-scope.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { setInterval, clearInterval, setTimeout, clearTimeout };
globalThis.document = { hidden: false };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
let vite, Together;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true },
    plugins: [{ name: "fictional-together-feedback", enforce: "pre", load(id) {
      if (id.replaceAll("\\", "/").endsWith("/src/api.js")) return 'export const apiRequest = async () => ({ logged_in: false }); export const apiFetch = apiRequest; export const API_BASE_URL = "https://fictional.example.test";';
    } }] });
  ({ default: Together } = await vite.ssrLoadModule("/src/Together.jsx"));
});
after(async () => { await vite.close(); });
const props = { accountScope: "fictional-account", companionScope: "fictional-companion", screenState: {}, onReply: async () => false };
const message = "服务未确认回复，请先刷新核对。（错误代码：co_watch_reply_receipt_invalid）";

for (const sourceApp of ["dengta-direct-media", "dengta-web-page"]) {
  test(`parent reply failure is visible beside the retained draft: ${sourceApp}`, async () => {
    let tree;
    try {
      await act(async () => { tree = TestRenderer.create(React.createElement(Together, { ...props, session: { id: "fictional-session", status: "active", sourceApp }, feedback: { status: "error", message } })); });
      const input = () => tree.root.findByProps({ "aria-label": "共看消息" });
      await act(async () => input().props.onChange({ target: { value: "虚构的未发送草稿" } }));
      await act(async () => tree.root.findByProps({ className: "together-reply" }).props.onSubmit({ preventDefault() {} }));
      assert.equal(input().props.value, "虚构的未发送草稿");
      const alert = tree.root.findAllByProps({ role: "alert" }).find(node => node.children.includes(message));
      assert.ok(alert, "the actual component must display the parent error");
      assert.equal(input().props["aria-describedby"], alert.props.id);
    } finally { await act(async () => tree?.unmount()); }
  });
}

test("normal parent information does not create an error alert", async () => {
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(Together, { ...props, session: { id: "fictional-session", status: "active", sourceApp: "dengta-direct-media" }, feedback: { status: "idle", message: "虚构会话已读取" } })); });
    assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 0);
    assert.equal(tree.root.findByProps({ "aria-label": "共看消息" }).props["aria-describedby"], undefined);
  } finally { await act(async () => tree?.unmount()); }
});

test("external mode retains its existing visible feedback without an additional alert", async () => {
  let tree;
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(Together, { ...props, session: { id: "fictional-session", status: "active", sourceApp: "fictional-screen" }, feedback: { status: "error", message } })); });
    assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 0);
    assert.ok(tree.root.findAllByType("p").some(node => node.children.includes(message)));
  } finally { await act(async () => tree?.unmount()); }
});

for (const sourceApp of ["dengta-direct-media", "dengta-web-page"]) {
  test(`actual App callback clears a prior error after a confirmed retry: ${sourceApp}`, async () => {
    const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    const callback = source.match(/onReply=\{(async \(text, playbackPositionSeconds\) => \{[\s\S]*?\n {10}\})\}\s*\n\s*viewKind=/)?.[1];
    assert.ok(callback);
    const identity = { accountScope: props.accountScope, companionScope: props.companionScope };
    const session = { id: "fictional-session", status: "active", sourceApp, sessionMode: sourceApp === "dengta-web-page" ? "web_page" : "direct_media" };
    const ui = { session, dialog: [], danmaku: [], busy: false, feedback: { status: "idle", message: "虚构会话已读取" } };
    const sessionRef = { current: session }, busyRef = { current: false }, jobRef = { current: null };
    const scope = value => JSON.stringify([value.accountScope, value.companionScope]);
    const update = key => value => { ui[key] = typeof value === "function" ? value(ui[key]) : value; };
    let calls = 0, tree;
    const context = {
      coWatchSession: session, coWatchSessionRef: sessionRef, coWatchBusyRef: busyRef, coWatchReplyJobRef: jobRef,
      coWatchLifecycleRef: { current: createCoWatchLifecycle({ getIdentity: () => identity, getSession: () => sessionRef.current, isBusy: () => busyRef.current }) },
      coWatchViewScopeRef: { current: createCoWatchViewScope({ getIdentity: () => identity, getViewKind: () => "together" }) },
      privateMediaScope: scope(identity), settingsSaveScope: scope, authSession: { getSnapshot: () => identity },
      setCoWatchSession: update("session"), setCoWatchDialog: update("dialog"), setCoWatchDanmaku: update("danmaku"), setIsScreenGlanceBusy: update("busy"), setScreenGlanceFeedback: update("feedback"),
      sendCoWatchReply: async () => { if (++calls === 1) throw new Error(message); return { reaction: "虚构的确认回复", requestId: "fictional-retry" }; },
      refreshCoWatchExperience: async () => {},
    };
    const reply = runInNewContext("(" + callback + ")", context);
    const element = () => React.createElement(Together, { ...props, session: ui.session, dialog: ui.dialog, feedback: ui.feedback, busy: ui.busy, onReply: reply });
    const input = () => tree.root.findByProps({ "aria-label": "共看消息" });
    try {
      await act(async () => { tree = TestRenderer.create(element()); });
      await act(async () => input().props.onChange({ target: { value: "虚构的重试消息" } }));
      await act(async () => tree.root.findByProps({ className: "together-reply" }).props.onSubmit({ preventDefault() {} }));
      await act(async () => tree.update(element()));
      assert.equal(input().props.value, "虚构的重试消息");
      assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 1);
      await act(async () => tree.root.findByProps({ className: "together-reply" }).props.onSubmit({ preventDefault() {} }));
      await act(async () => tree.update(element()));
      assert.equal(input().props.value, "");
      assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 0);
      assert.equal(ui.feedback.status, "idle");
      assert.ok(tree.root.findAllByType("p").some(node => node.children.includes("虚构的确认回复")));
      assert.equal(calls, 2);
    } finally { await act(async () => tree?.unmount()); }
  });
}
