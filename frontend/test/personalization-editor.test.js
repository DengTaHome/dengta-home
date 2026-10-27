import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { StrictMode, act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { appendPersonalizationText, countPersonalizationCharacters, countPersonalizationCharactersCooperatively, readPersonalizationTextFile } from "../src/personalization-editor.js";
import { createSettingsPayload, normalizeSettingsDraft } from "../src/settings.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
const copied = [];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (text) => copied.push(text) } } });
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
let tree;
try {
  const { default: PersonalizationEditor } = await vite.ssrLoadModule("/src/PersonalizationEditor.jsx");
  let draft = "", calls = [], props;
  const render = () => React.createElement(PersonalizationEditor, props);
  const mount = async (value = "", options = {}) => {
    draft = value; calls = [];
    props = {
      field: "unified_system_prompt", label: "个性化指令", value, scopeKey: "account-a/companion-a",
      onChange: (text) => { calls.push(text); draft = text; props = { ...props, value: text }; tree.update(render()); },
      ...options,
    };
    await act(async () => { tree = TestRenderer.create(render()); });
  };
  const update = async (updates) => {
    props = { ...props, ...updates };
    if (Object.hasOwn(updates, "value")) draft = updates.value;
    await act(async () => tree.update(render()));
  };
  const unmount = async () => { await act(async () => tree.unmount()); tree = null; };
  const textarea = () => tree.root.findByType("textarea");
  const fileInput = () => tree.root.findByProps({ type: "file" });
  const button = (text) => tree.root.findAllByType("button").find((node) => node.children.some((child) => child === text));
  const fakeFile = (text, name = "instructions.txt") => ({ name, type: "text/plain", arrayBuffer: async () => new TextEncoder().encode(text).buffer });
  const importFile = async (file) => {
    const target = { files: [file], value: "selected" };
    await act(async () => { fileInput().props.onChange({ target }); });
    assert.equal(target.value, "", "same file can be chosen again");
  };

  assert.equal(countPersonalizationCharacters("中👩🏽‍💻e\u0301🇨🇳\r\n"), 5, "Chinese, combined emoji, combining marks, flags and CRLF use visible character boundaries");
  assert.equal(await countPersonalizationCharactersCooperatively("中👩🏽‍💻e\u0301🇨🇳\r\n".repeat(5000), () => false), 25000, "fallback counts in batches without splitting composed characters");
  assert.equal(await countPersonalizationCharactersCooperatively("中".repeat(1000000), () => true), null, "cancelled fallback never completes an obsolete count");
  assert.equal(appendPersonalizationText("  旧文\r\n", "\n 新文  \n"), "  旧文\r\n\n\n\n 新文  \n");
  assert.equal(await readPersonalizationTextFile(fakeFile("\uFEFF  原文\r\n\n👩🏽‍💻  \n")), "\uFEFF  原文\r\n\n👩🏽‍💻  \n", "file decoding preserves BOM, spaces and line endings");
  const utf16 = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x0d, 0x00, 0x0a, 0x00]);
  assert.equal(await readPersonalizationTextFile({ name: "details.txt", arrayBuffer: async () => utf16.buffer }), "\uFEFF中\r\n");
  await assert.rejects(() => readPersonalizationTextFile(fakeFile("%PDF-binary", "fake.txt")), /另存为纯文本/);
  await assert.rejects(() => readPersonalizationTextFile(fakeFile("a\0b")), /二进制数据/);
  await assert.rejects(() => readPersonalizationTextFile({ name: "file.docx", arrayBuffer: async () => new ArrayBuffer(0) }), /纯文本文件/);

  await mount("中👩🏽‍💻e\u0301🇨🇳\r\n");
  assert.equal(textarea().props.maxLength, undefined);
  assert.equal(textarea().props["data-setting-field"], "unified_system_prompt");
  assert.equal(tree.root.findByType("output").children.join(""), "5 个字符");
  assert.equal(button("展开编辑").props["aria-expanded"], false);
  await act(async () => button("展开编辑").props.onClick());
  assert.equal(button("收起编辑").props["aria-expanded"], true);
  assert.equal(calls.length, 0, "expansion never changes text");
  await act(async () => button("收起编辑").props.onClick());
  await act(async () => {
    textarea().props.onChange({ target: { value: "  即时输入\n\n  " } });
    assert.equal(calls.at(-1), "  即时输入\n\n  ", "parent draft changes synchronously before a save can run");
  });
  assert.equal(textarea().props.value, draft);
  await act(async () => button("复制原文").props.onClick());
  assert.equal(copied.at(-1), draft);
  navigator.clipboard.writeText = async () => { throw new Error("permission_denied"); };
  await act(async () => button("复制原文").props.onClick());
  assert.equal(draft, "  即时输入\n\n  ");
  assert.ok(tree.root.findAllByProps({ role: "alert" }).length > 0, "clipboard failure is visible and keeps the exact draft");
  navigator.clipboard.writeText = async (text) => copied.push(text);
  await importFile(fakeFile("  追加\r\n👩🏽‍💻  "));
  assert.equal(draft, "  即时输入\n\n  \n\n  追加\r\n👩🏽‍💻  ");
  const beforeEmpty = draft, callsBeforeEmpty = calls.length;
  await importFile(fakeFile(""));
  assert.equal(draft, beforeEmpty);
  assert.equal(calls.length, callsBeforeEmpty);
  await importFile(fakeFile("PK\u0003\u0004disguised"));
  assert.equal(draft, beforeEmpty);
  assert.ok(tree.root.findAllByProps({ role: "alert" }).length > 0);
  await unmount();

  const workers = [];
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: class {
    constructor() { workers.push(this); }
    postMessage(text) { this.text = text; }
    terminate() { this.terminated = true; }
  } });
  const firstLargeText = "中".repeat(1000000), nextLargeText = `${firstLargeText}👩🏽‍💻`;
  await mount(firstLargeText);
  assert.equal(tree.root.findByType("output").children.join(""), "正在统计…", "large text is never synchronously counted in the render");
  await act(async () => new Promise(resolve => setTimeout(resolve, 450)));
  assert.equal(workers.at(-1).text, firstLargeText);
  const oldWorker = workers.at(-1);
  await act(async () => {
    textarea().props.onChange({ target: { value: nextLargeText } });
    assert.equal(draft, nextLargeText, "a pending background count does not delay draft changes");
  });
  assert.equal(oldWorker.terminated, true);
  await act(async () => new Promise(resolve => setTimeout(resolve, 450)));
  const latestWorker = workers.at(-1);
  await act(async () => latestWorker.onmessage({ data: { count: 1000001 } }));
  assert.equal(tree.root.findByType("output").children.join(""), "1,000,001 个字符");
  await act(async () => oldWorker.onmessage({ data: { count: 999 } }));
  assert.equal(tree.root.findByType("output").children.join(""), "1,000,001 个字符", "obsolete worker receipts cannot change the displayed count");
  await unmount();
  assert.equal(latestWorker.terminated, true);
  if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
  else delete globalThis.Worker;

  let resolveFile;
  const delayedFile = () => ({ name: "delayed.txt", arrayBuffer: () => new Promise((resolve) => { resolveFile = resolve; }) });
  await mount("旧文");
  await importFile(delayedFile());
  await act(async () => textarea().props.onChange({ target: { value: "读取期间输入  \n" } }));
  await act(async () => resolveFile(new TextEncoder().encode("  文件原文\r\n").buffer));
  assert.equal(draft, "读取期间输入  \n\n\n  文件原文\r\n", "async import appends to the latest text");
  await importFile(delayedFile());
  await update({ scopeKey: "account-b/companion-b", value: "新账号内容" });
  const beforeOldRead = calls.length;
  await act(async () => resolveFile(new TextEncoder().encode("旧账号文件").buffer));
  assert.equal(draft, "新账号内容");
  assert.equal(calls.length, beforeOldRead, "scope switch cancels old file delivery");
  assert.equal(button("导入文本").props.disabled, false);
  await importFile(delayedFile());
  await update({ disabled: true });
  await act(async () => resolveFile(new TextEncoder().encode("不能加入").buffer));
  assert.equal(draft, "新账号内容");
  await update({ disabled: false });
  assert.equal(button("导入文本").props.disabled, false, "disabling cancels import without leaving a stuck loading state");
  await importFile(delayedFile());
  await unmount();
  await act(async () => resolveFile(new TextEncoder().encode("卸载后文件").buffer));
  assert.equal(calls.length, beforeOldRead, "unmounted editor does not write a draft");

  const longText = `  ${"中文👩🏽‍💻 e\u0301\r\n".repeat(85000)}尾部  \n`;
  assert.ok(longText.length > 1_000_000);
  await mount("", { field: "user_details", label: "你的详情" });
  await importFile(fakeFile(longText));
  assert.equal(draft, longText, "million-character import retains every original character");
  assert.equal(textarea().props.value, longText);
  await act(async () => button("展开编辑").props.onClick());
  await act(async () => button("收起编辑").props.onClick());
  assert.equal(draft, longText);
  await act(async () => button("复制原文").props.onClick());
  assert.equal(copied.at(-1), longText);
  const normalized = normalizeSettingsDraft({ unified_system_prompt: longText, user_details: draft });
  const payload = JSON.parse(JSON.stringify(createSettingsPayload(normalized)));
  assert.equal(normalizeSettingsDraft(payload).unified_system_prompt, longText);
  assert.equal(normalizeSettingsDraft(payload).user_details, longText, "frontend JSON payload preserves the complete strings");
  await unmount();

  await act(async () => { tree = TestRenderer.create(React.createElement(StrictMode, null, React.createElement(PersonalizationEditor, { field: "user_details", label: "你的详情", value: "", onChange: (text) => calls.push(text), scopeKey: "strict-scope" }))); });
  const strictCalls = calls.length;
  await importFile(fakeFile("  严格模式原文\n"));
  assert.equal(calls.length, strictCalls + 1, "StrictMode imports once");
  assert.equal(calls.at(-1), "  严格模式原文\n");
  await unmount();
  console.log("Personalization editor passed: actual React editing, expansion, Unicode/background count, exact import/copy, latest text, scope cancellation, disabled/unmount/StrictMode, and million-character frontend round trip.");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete globalThis.navigator;
  if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
  else delete globalThis.Worker;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
