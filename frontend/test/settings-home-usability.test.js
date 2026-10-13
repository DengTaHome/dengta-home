import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { normalizeSettingsQuickLinks, readSettingsQuickLinks, writeSettingsQuickLinks } from "../src/settings-navigation.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const categories = Object.freeze([
  { id: "appearance", label: "外观与聊天" },
  { id: "persona", label: "个性化与记忆" },
  { id: "services", label: "模型与服务" },
  { id: "voice", label: "语音与情绪" },
  { id: "devices", label: "设备与共看" },
  { id: "fun", label: "成就与新玩法" },
  { id: "data-import", label: "数据导入" },
  { id: "data-export", label: "数据导出" },
  { id: "music-import", label: "音乐导入" },
  { id: "logs", label: "错误日志" },
].map(Object.freeze));
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../../artifacts/dengta-settings-20261006/.vite-tests", import.meta.url)),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const { default: SettingsHome } = await vite.ssrLoadModule("/src/SettingsHome.jsx");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
after(async () => {
  await vite.close();
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete globalThis.localStorage;
});

function textContent(node) {
  if (typeof node === "string") return node;
  return node?.children?.map(textContent).join("") || "";
}

async function fixture(options = {}) {
  const focus = [], selected = [], values = new Map(Object.entries(options.seed || {})), writes = [];
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { values.set(key, String(value)); writes.push({ key, value: String(value) }); },
    removeItem(key) { values.delete(key); writes.push({ key, value: null }); },
    ...options.storage,
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  let props = { categories, preferenceScope: "account-a/companion-a", onSelectCategory: (id) => selected.push(id), ...options.props };
  let tree;
  const render = () => React.createElement(SettingsHome, props);
  await act(async () => {
    tree = TestRenderer.create(render(), {
      createNodeMock(element) {
        if (element.type === "input") return { focus: () => focus.push("search") };
        if (element.type === "button") return { focus: () => focus.push(element.props.className) };
        return null;
      },
    });
  });
  return {
    tree, focus, selected, values, writes,
    input: () => tree.root.findByProps({ type: "search" }),
    button: (label) => tree.root.find((node) => node.type === "button" && (node.props["aria-label"] === label || textContent(node) === label)),
    quickLinks: () => tree.root.findAll((node) => node.type === "button" && node.props["data-settings-quick-link"]).map((node) => node.props["data-settings-quick-link"]),
    toggle: (id) => tree.root.findByProps({ "data-settings-quick-toggle": id }),
    async search(value) { await act(async () => this.input().props.onChange({ target: { value } })); },
    async click(label) { await act(async () => this.button(label).props.onClick()); },
    async update(next) { props = { ...props, ...next }; await act(async () => tree.update(render())); },
    async unmount() { await act(async () => tree.unmount()); },
  };
}

test("clear search returns focus to the surviving search field", async () => {
  const ui = await fixture();
  try {
    await ui.search("语音");
    await ui.click("清空设置搜索");
    assert.equal(ui.input().props.value, "");
    assert.deepEqual(ui.focus, ["search"]);
  } finally { await ui.unmount(); }
});

test("closing optional guidance returns focus to its toggle", async () => {
  const ui = await fixture();
  try {
    await ui.click("从哪里开始？按需查看的上手建议");
    await ui.click("收起建议");
    assert.deepEqual(ui.focus, ["settings-home-guide-toggle"]);
    assert.equal(ui.selected.length, 0);
  } finally { await ui.unmount(); }
});

test("unique-result Enter opens its destination, while IME and ambiguous searches do not", async () => {
  const ui = await fixture();
  try {
    let prevented = 0;
    const key = (extra = {}) => ({ key: "Enter", preventDefault: () => { prevented += 1; }, ...extra });
    await ui.search("备份");
    assert.equal(typeof ui.input().props.onKeyDown, "function");
    await act(async () => ui.input().props.onKeyDown(key({ nativeEvent: { isComposing: true } })));
    await act(async () => ui.input().props.onKeyDown(key({ keyCode: 229 })));
    assert.equal(ui.selected.length, 0);
    await act(async () => ui.input().props.onKeyDown(key()));
    assert.deepEqual(ui.selected, ["data-export"]);
    assert.equal(prevented, 1);
    await ui.search("导入");
    await act(async () => ui.input().props.onKeyDown(key()));
    assert.equal(ui.selected.length, 1, "multiple matches require an explicit choice");
    await ui.search("不存在的入口");
    await act(async () => ui.input().props.onKeyDown(key()));
    assert.equal(ui.selected.length, 1);
  } finally { await ui.unmount(); }
});

test("Escape clears searching and keeps focus without interpreting IME cancellation", async () => {
  const ui = await fixture();
  try {
    await ui.search("备份");
    assert.equal(typeof ui.input().props.onKeyDown, "function");
    await act(async () => ui.input().props.onKeyDown({ key: "Escape", isComposing: true }));
    assert.equal(ui.input().props.value, "备份");
    let prevented = 0;
    await act(async () => ui.input().props.onKeyDown({ key: "Escape", preventDefault: () => { prevented += 1; } }));
    assert.equal(ui.input().props.value, "");
    assert.deepEqual(ui.focus, ["search"]);
    assert.equal(prevented, 1);
  } finally { await ui.unmount(); }
});

test("fixed shortcuts are optional, limited to four and persisted only as category IDs", async () => {
  const ui = await fixture();
  try {
    assert.deepEqual(ui.quickLinks(), ["persona", "services", "fun"]);
    assert.equal(ui.writes.length, 0, "opening settings does not write preferences");
    await ui.click("整理常用入口");
    assert.equal(ui.selected.length, 0);
    await act(async () => ui.toggle("logs").props.onClick());
    assert.deepEqual(ui.quickLinks(), ["persona", "services", "fun", "logs"]);
    assert.equal(ui.toggle("voice").props.disabled, true);
    assert.equal(ui.writes.length, 1);
    assert.equal(ui.writes[0].key, "dengta.settings-quick-links.v1:account-a/companion-a");
    assert.deepEqual(JSON.parse(ui.writes[0].value), ["persona", "services", "fun", "logs"]);
    await act(async () => ui.toggle("services").props.onClick());
    await act(async () => ui.toggle("voice").props.onClick());
    assert.deepEqual(ui.quickLinks(), ["persona", "fun", "logs", "voice"]);
    await act(async () => ui.tree.root.findByProps({ "data-settings-quick-link": "logs" }).props.onClick());
    assert.deepEqual(ui.selected, ["logs"]);
    await ui.click("恢复默认入口");
    assert.deepEqual(ui.quickLinks(), ["persona", "services", "fun"]);
    await ui.click("完成整理");
    assert.equal(ui.tree.root.findAll((node) => node.props["data-settings-quick-toggle"]).length, 0);
    assert.equal(ui.focus.at(-1), "settings-home-quick-edit");
  } finally { await ui.unmount(); }
});

test("navigation preferences remain separated by account and companion; stale callbacks cannot write", async () => {
  const ui = await fixture();
  try {
    await ui.click("整理常用入口");
    const oldToggle = ui.toggle("logs").props.onClick;
    await act(async () => oldToggle());
    assert.ok(ui.quickLinks().includes("logs"));
    await ui.update({ preferenceScope: "account-b/companion-b" });
    assert.deepEqual(ui.quickLinks(), ["persona", "services", "fun"]);
    const oldWrites = ui.writes.length;
    await act(async () => oldToggle());
    assert.equal(ui.writes.length, oldWrites);
    await act(async () => ui.toggle("voice").props.onClick());
    assert.ok(ui.quickLinks().includes("voice"));
    assert.equal(ui.writes.at(-1).key, "dengta.settings-quick-links.v1:account-b/companion-b");
    await ui.update({ preferenceScope: "account-a/companion-a" });
    assert.ok(ui.quickLinks().includes("logs"));
    assert.ok(!ui.quickLinks().includes("voice"));
  } finally { await ui.unmount(); }
});

test("restricted storage reports temporary preference while keeping navigation usable", async () => {
  const ui = await fixture({ storage: { setItem() { throw new Error("raw-private-storage-error"); } } });
  try {
    await ui.click("整理常用入口");
    await act(async () => ui.toggle("logs").props.onClick());
    assert.ok(ui.quickLinks().includes("logs"));
    assert.match(textContent(ui.tree.toJSON()), /本次已调整.*重新打开/);
    assert.doesNotMatch(textContent(ui.tree.toJSON()), /raw-private-storage-error/);
  } finally { await ui.unmount(); }
});

test("reopening restores shortcuts and an explicit empty selection instead of adding defaults", async () => {
  const key = "dengta.settings-quick-links.v1:account-a/companion-a";
  const ui = await fixture({ seed: { [key]: JSON.stringify(["logs", "voice"]) } });
  try {
    assert.deepEqual(ui.quickLinks(), ["logs", "voice"]);
    assert.equal(ui.writes.length, 0);
    await ui.click("整理常用入口");
    await act(async () => ui.toggle("logs").props.onClick());
    await act(async () => ui.toggle("voice").props.onClick());
    assert.deepEqual(ui.quickLinks(), []);
    assert.equal(ui.values.get(key), "[]");
    assert.equal(ui.tree.root.findAllByProps({ "data-settings-category": "logs" }).length, 1, "clearing shortcuts never removes the original full navigation");
  } finally { await ui.unmount(); }
  const reopened = await fixture({ seed: { [key]: "[]" } });
  try { assert.deepEqual(reopened.quickLinks(), []); } finally { await reopened.unmount(); }
});

test("removed categories free shortcut capacity without rewriting preferences automatically", async () => {
  const ui = await fixture();
  try {
    await ui.click("整理常用入口");
    await act(async () => ui.toggle("logs").props.onClick());
    const beforeWrites = ui.writes.length;
    await ui.update({ categories: categories.filter((category) => category.id !== "services") });
    assert.deepEqual(ui.quickLinks(), ["persona", "fun", "logs"]);
    assert.equal(ui.toggle("voice").props.disabled, false);
    assert.equal(ui.writes.length, beforeWrites);
  } finally { await ui.unmount(); }
});

test("navigation storage handles malformed, unavailable and unscoped data without migration", () => {
  const reads = [], writes = [];
  const storage = {
    getItem(key) { reads.push(key); return "bad-json"; },
    setItem(key, value) { writes.push({ key, value }); },
  };
  assert.deepEqual(readSettingsQuickLinks(categories, "account-a", storage), ["persona", "services", "fun"]);
  assert.deepEqual(reads, ["dengta.settings-quick-links.v1:account-a"]);
  assert.equal(writes.length, 0);
  assert.deepEqual(normalizeSettingsQuickLinks(["logs", "logs", "missing", { id: "voice" }, "voice", "persona", "services", "fun"], categories), ["logs", "voice", "persona", "services"]);
  assert.deepEqual(writeSettingsQuickLinks(["logs"], categories, "", storage), { ids: ["logs"], persisted: false });
  assert.equal(writes.length, 0, "no global unscoped storage is written");
  assert.deepEqual(readSettingsQuickLinks(categories, "", storage), ["persona", "services", "fun"]);
  assert.equal(reads.length, 1);
  assert.deepEqual(readSettingsQuickLinks(categories, "account-b", { getItem() { throw new Error("restricted"); } }), ["persona", "services", "fun"]);
});

test("same-tick shortcut edits compose against the latest selection rather than restoring removed entries", async () => {
  const ui = await fixture();
  try {
    await ui.click("整理常用入口");
    const removeServices = ui.toggle("services").props.onClick;
    const addLogs = ui.toggle("logs").props.onClick;
    await act(async () => { removeServices(); addLogs(); });
    assert.deepEqual(ui.quickLinks(), ["persona", "fun", "logs"]);
    assert.deepEqual(JSON.parse(ui.writes.at(-1).value), ["persona", "fun", "logs"]);
  } finally { await ui.unmount(); }
});

test("an old shortcut callback uses current choices and cannot overfill the four-entry limit", async () => {
  const ui = await fixture();
  try {
    await ui.click("整理常用入口");
    const addLogs = ui.toggle("logs").props.onClick;
    const addVoice = ui.toggle("voice").props.onClick;
    await act(async () => ui.toggle("services").props.onClick());
    await act(async () => addVoice());
    await act(async () => addLogs());
    assert.deepEqual(ui.quickLinks(), ["persona", "fun", "voice", "logs"]);
    const writes = ui.writes.length;
    await act(async () => ui.toggle("services").props.onClick());
    assert.equal(ui.writes.length, writes);
    assert.equal(ui.quickLinks().length, 4);
  } finally { await ui.unmount(); }
});

test("a stale shortcut for a removed category cannot rewrite current preferences", async () => {
  const ui = await fixture();
  try {
    await ui.click("整理常用入口");
    const addLogs = ui.toggle("logs").props.onClick;
    await ui.update({ categories: categories.filter(category => category.id !== "logs") });
    const writes = ui.writes.length;
    await act(async () => addLogs());
    assert.equal(ui.writes.length, writes);
    assert.deepEqual(ui.quickLinks(), ["persona", "services", "fun"]);
  } finally { await ui.unmount(); }
});
