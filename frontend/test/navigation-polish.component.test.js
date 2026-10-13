import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../../artifacts/dengta-design-polish-20261007/.vite-navigation-tests", import.meta.url)),
  envFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const { default: FeatureNavigation } = await vite.ssrLoadModule("/src/FeatureNavigation.jsx");
const { default: SettingsHome } = await vite.ssrLoadModule("/src/SettingsHome.jsx");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
after(async () => {
  await vite.close();
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete globalThis.localStorage;
});

const items = Object.freeze([
  { id: "chat", label: "聊天", icon: "C" },
  { id: "cotton", label: "小棉花", icon: "P" },
  { id: "music", label: "听歌", icon: "M" },
  { id: "future-feature", label: "未来玩法", icon: "F" },
].map(Object.freeze));
const categories = Object.freeze([
  { id: "persona", label: "个性化与记忆" },
  { id: "services", label: "模型与服务" },
  { id: "fun", label: "成就与新玩法" },
  { id: "voice", label: "语音与情绪" },
  { id: "logs", label: "错误日志" },
].map(Object.freeze));

function content(node) {
  if (typeof node === "string") return node;
  if (node?.props?.["aria-hidden"]) return "";
  return node?.children?.map(content).join("") || "";
}

function keyEvent(key, extra = {}) {
  const calls = { prevented: 0, stopped: 0 };
  return {
    calls,
    event: {
      key,
      preventDefault() { calls.prevented += 1; },
      stopPropagation() { calls.stopped += 1; },
      ...extra,
    },
  };
}

async function fixture(Component, props) {
  const selected = [], focus = [], writes = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: (...args) => writes.push(args), removeItem: (...args) => writes.push(args) },
  });
  let tree;
  await act(async () => {
    tree = TestRenderer.create(React.createElement(Component, {
      onNavigate: (id) => selected.push(id),
      onSelectCategory: (id) => selected.push(id),
      ...props,
    }), {
      createNodeMock(element) {
        if (element.type === "input") return { focus: () => focus.push("search") };
        if (element.type === "button") return { focus: () => focus.push(element.props.className) };
        return null;
      },
    });
  });
  return {
    tree, selected, focus, writes,
    input: () => tree.root.findByProps({ type: "search" }),
    button: (label) => tree.root.find((node) => node.type === "button" && (node.props["aria-label"] === label || content(node) === label)),
    async search(value) { await act(async () => this.input().props.onChange({ target: { value } })); },
    async click(label) { await act(async () => this.button(label).props.onClick()); },
    async press(key, extra) {
      const event = keyEvent(key, extra);
      await act(async () => this.input().props.onKeyDown(event.event));
      return event.calls;
    },
    async unmount() { await act(async () => tree.unmount()); },
  };
}

const ignoredKeys = [
  { isComposing: true }, { nativeEvent: { isComposing: true } },
  { keyCode: 229 }, { nativeEvent: { keyCode: 229 } },
  { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
];

test("feature navigation keeps all known and future destinations reachable and preserves supplied items", async () => {
  const before = JSON.stringify(items);
  const ui = await fixture(FeatureNavigation, { items, activeView: "cotton" });
  try {
    const nav = ui.tree.root.findByType("nav");
    assert.equal(nav.findAllByType("button").length, items.length);
    assert.equal(nav.findAllByProps({ "aria-current": "page" }).length, 1);
    assert.match(content(nav), /更多功能.*未来玩法/);
    assert.equal(ui.selected.length, 0);
    await ui.click("未来玩法");
    assert.deepEqual(ui.selected, ["future-feature"]);
    await ui.search("未来");
    assert.equal(nav.findAllByType("button").length, 1);
    assert.match(content(ui.tree.toJSON()), /找到 1 个玩法/);
    await ui.press("Enter");
    assert.deepEqual(ui.selected, ["future-feature", "future-feature"]);
    assert.equal(JSON.stringify(items), before);
    assert.equal(ui.writes.length, 0);
  } finally { await ui.unmount(); }
});

test("single feature search Enter opens once; IME and modified keys never navigate", async () => {
  const ui = await fixture(FeatureNavigation, { items });
  try {
    await ui.search("桌宠");
    for (const extra of ignoredKeys) {
      assert.deepEqual(await ui.press("Enter", extra), { prevented: 0, stopped: 0 });
    }
    assert.deepEqual(ui.selected, []);
    assert.deepEqual(await ui.press("Enter"), { prevented: 1, stopped: 0 });
    assert.deepEqual(ui.selected, ["cotton"]);
    await ui.search("一");
    assert.ok(ui.tree.root.findByType("nav").findAllByType("button").length > 1);
    assert.equal((await ui.press("Enter")).prevented, 0);
    await ui.search("没有这个玩法");
    assert.equal((await ui.press("Enter")).prevented, 0);
    assert.deepEqual(ui.selected, ["cotton"]);
  } finally { await ui.unmount(); }
});

test("feature search reset restores focus, while Escape consumes only its actual clearing action", async () => {
  const ui = await fixture(FeatureNavigation, { items });
  try {
    assert.equal(ui.tree.root.findAllByProps({ "aria-label": "清空玩法搜索" }).length, 0);
    await ui.search("没有这个玩法");
    await ui.click("清空玩法搜索");
    assert.equal(ui.input().props.value, "");
    assert.deepEqual(ui.focus, ["search"]);
    assert.equal(ui.tree.root.findByType("nav").findAllByType("button").length, items.length);
    await ui.search("歌");
    for (const extra of ignoredKeys) assert.equal((await ui.press("Escape", extra)).prevented, 0);
    assert.equal(ui.input().props.value, "歌");
    assert.deepEqual(await ui.press("Escape"), { prevented: 1, stopped: 1 });
    assert.equal(ui.input().props.value, "");
    assert.equal(ui.focus.at(-1), "search");
    assert.deepEqual(await ui.press("Escape"), { prevented: 0, stopped: 0 });
  } finally { await ui.unmount(); }
});

test("a default empty feature navigation does not fail and keeps its labeled search usable", async () => {
  const ui = await fixture(FeatureNavigation, {});
  try {
    const label = ui.tree.root.findByType("label");
    assert.equal(label.props.htmlFor, ui.input().props.id);
    assert.match(content(ui.tree.toJSON()), /暂时没有可用玩法/);
    await ui.search("歌");
    assert.match(content(ui.tree.toJSON()), /没有找到匹配的玩法/);
    await ui.click("清空玩法搜索");
    assert.equal(ui.input().props.value, "");
    assert.deepEqual(ui.selected, []);
  } finally { await ui.unmount(); }
});

test("settings search also ignores modified Enter shortcuts", async () => {
  const ui = await fixture(SettingsHome, { categories, preferenceScope: "fictional-account/fictional-companion" });
  try {
    await ui.search("语音");
    for (const extra of ignoredKeys) assert.equal((await ui.press("Enter", extra)).prevented, 0);
    assert.deepEqual(ui.selected, []);
    await ui.press("Enter");
    assert.deepEqual(ui.selected, ["voice"]);
  } finally { await ui.unmount(); }
});

test("shortcut count explains its cap without altering saved choices until the user selects a toggle", async () => {
  const ui = await fixture(SettingsHome, { categories, preferenceScope: "fictional-account/fictional-companion" });
  try {
    await ui.click("整理常用入口");
    const count = () => ui.tree.root.findByProps({ className: "settings-home-quick-count" });
    const group = ui.tree.root.findByProps({ "aria-label": "选择常用设置入口" });
    assert.equal(group.props["aria-describedby"], count().props.id);
    assert.equal(content(count()), "已固定 3 / 4 个入口");
    assert.equal(ui.writes.length, 0);
    await act(async () => ui.tree.root.findByProps({ "data-settings-quick-toggle": "voice" }).props.onClick());
    assert.equal(ui.writes.length, 1);
    assert.match(content(count()), /已固定 4 \/ 4 个入口.*取消一项/);
    assert.equal(ui.tree.root.findByProps({ "data-settings-quick-toggle": "logs" }).props.disabled, true);
    await ui.click("完成整理");
    assert.equal(ui.focus.at(-1), "settings-home-quick-edit");
    assert.equal(ui.tree.root.findAllByProps({ className: "settings-home-quick-editor" }).length, 0);
    assert.equal(ui.writes.length, 1);
  } finally { await ui.unmount(); }
});

for (const panel of [
  { toggle: "整理常用入口", className: "settings-home-quick-editor", focus: "settings-home-quick-edit" },
  { toggle: "从哪里开始？按需查看的上手建议", className: "settings-home-guide-content", focus: "settings-home-guide-toggle" },
]) test(`Escape collapses ${panel.className} and returns focus without navigation or preference writes`, async () => {
  const ui = await fixture(SettingsHome, { categories, preferenceScope: "fictional-account/fictional-companion" });
  try {
    await ui.click(panel.toggle);
    const contentPanel = () => ui.tree.root.findByProps({ className: panel.className });
    for (const extra of ignoredKeys) {
      const event = keyEvent("Escape", extra);
      await act(async () => contentPanel().props.onKeyDown(event.event));
      assert.deepEqual(event.calls, { prevented: 0, stopped: 0 });
    }
    const event = keyEvent("Escape");
    await act(async () => contentPanel().props.onKeyDown(event.event));
    assert.deepEqual(event.calls, { prevented: 1, stopped: 1 });
    assert.equal(ui.tree.root.findAllByProps({ className: panel.className }).length, 0);
    assert.equal(ui.focus.at(-1), panel.focus);
    assert.deepEqual(ui.selected, []);
    assert.equal(ui.writes.length, 0);
  } finally { await ui.unmount(); }
});
