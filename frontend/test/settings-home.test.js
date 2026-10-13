import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { buildSettingsGroups } from "../src/settings-navigation.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const categories = Object.freeze([
  { id: "appearance", label: "外观与聊天", description: "天空、玻璃、气泡与动效" },
  { id: "persona", label: "个性化与记忆", description: "提示词、长期详情与主动消息" },
  { id: "services", label: "模型与服务", description: "接口、模型、服务状态与创作" },
  { id: "voice", label: "语音与情绪", description: "语音理解、播放与麦克风" },
  { id: "devices", label: "设备与共看", description: "通知、活动感知、屏幕共看与设备" },
  { id: "fun", label: "成就与新玩法", description: "成就、纪念日、外卖与小红书" },
  { id: "data-import", label: "数据导入", description: "世界书与聊天记录" },
  { id: "data-export", label: "数据导出", description: "全量备份：聊天、人设、记忆与创作" },
  { id: "music-import", label: "音乐导入", description: "网易云歌单导入与搜索" },
  { id: "logs", label: "错误日志", description: "最近错误代码、位置与排查记录" },
].map(Object.freeze));

const originalCategories = JSON.stringify(categories);
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../../artifacts/dengta-settings-20261006/.vite-existing-home", import.meta.url)),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
let tree;

function textContent(node) {
  if (typeof node === "string") return node;
  return node?.children?.map(textContent).join("") || "";
}

try {
  const { default: SettingsHome } = await vite.ssrLoadModule("/src/SettingsHome.jsx");
  const selected = [];
  const mount = async (entries = categories) => {
    await act(async () => {
      tree = TestRenderer.create(React.createElement(SettingsHome, {
        categories: entries,
        onSelectCategory: (id) => selected.push(id),
      }));
    });
  };
  const entries = () => tree.root.findAll((node) => node.type === "button" && node.props["data-settings-category"]);
  const findButton = (label) => tree.root.find((node) => node.type === "button" && textContent(node) === label);
  const search = async (value) => {
    await act(async () => tree.root.findByType("input").props.onChange({ target: { value } }));
  };

  await mount();
  assert.equal(tree.root.findAll((node) => node.type === "section").length, 4);
  assert.deepEqual(entries().map((node) => node.props["data-settings-category"]).sort(), categories.map((category) => category.id).sort());
  assert.equal(selected.length, 0, "opening settings only displays navigation and never changes a setting");
  const guideToggle = () => tree.root.findByProps({ className: "settings-home-guide-toggle" });
  assert.equal(guideToggle().props["aria-expanded"], false, "the guide is optional and starts collapsed");
  assert.equal(tree.root.findAll((node) => node.type === "ol").length, 0);
  await act(async () => findButton("写下偏好").props.onClick());
  assert.deepEqual(selected, ["persona"]);

  await search("ＡＰＩ key");
  assert.deepEqual(entries().map((node) => node.props["data-settings-category"]), ["services"]);
  assert.match(textContent(tree.toJSON()), /找到 1 个入口/);
  assert.equal(tree.root.findAll((node) => node.type === "nav").length, 0);
  await act(async () => entries()[0].props.onClick());
  assert.deepEqual(selected, ["persona", "services"], "a filtered result opens its original destination");
  await search("备份");
  assert.deepEqual(entries().map((node) => node.props["data-settings-category"]), ["data-export"]);
  await search("屏幕 共看");
  assert.deepEqual(entries().map((node) => node.props["data-settings-category"]), ["devices"]);
  await search("不存在的功能");
  assert.equal(entries().length, 0);
  assert.match(textContent(tree.toJSON()), /没有找到匹配的设置/);
  await act(async () => findButton("查看全部设置").props.onClick());
  assert.equal(tree.root.findByType("input").props.value, "");
  assert.equal(entries().length, 10);
  await search("语音");
  await act(async () => tree.root.find((node) => node.type === "button" && node.props["aria-label"] === "清空设置搜索").props.onClick());
  assert.equal(entries().length, 10);

  await act(async () => guideToggle().props.onClick());
  assert.equal(tree.root.findAll((node) => node.type === "ol").length, 1);
  assert.equal(selected.length, 2, "expanding the guide does not navigate or apply a configuration");
  await act(async () => findButton("写下你的偏好").props.onClick());
  assert.deepEqual(selected, ["persona", "services", "persona"]);
  await act(async () => findButton("收起建议").props.onClick());
  assert.equal(tree.root.findAll((node) => node.type === "ol").length, 0);
  assert.equal(JSON.stringify(categories), originalCategories, "searching and following guidance preserve the supplied setting definitions");
  await act(async () => tree.unmount());

  await mount([{ id: "future-feature", label: "新功能", description: "新的入口" }]);
  assert.equal(entries().length, 1, "future categories stay reachable instead of disappearing from the grouped home");
  assert.match(textContent(tree.toJSON()), /更多设置/);
  assert.equal(tree.root.findAll((node) => node.type === "nav" || node.type === "aside").length, 0, "unavailable quick links and guide destinations are omitted");
  await act(async () => entries()[0].props.onClick());
  assert.equal(selected.at(-1), "future-feature");
  assert.equal(buildSettingsGroups([], "记忆").length, 0);
  console.log("Settings home behavior passed: complete navigation, keyword search, reset, optional guide, no automatic changes and future entries.");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
}
