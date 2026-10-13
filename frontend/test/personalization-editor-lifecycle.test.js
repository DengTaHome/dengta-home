import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
let vite, cacheDir, PersonalizationEditor, tree, props, draft, writes, workers;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

before(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "dengta-editor-lifecycle-"));
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    cacheDir,
    appType: "custom", logLevel: "silent", server: { middlewareMode: true },
  });
  ({ default: PersonalizationEditor } = await vite.ssrLoadModule("/src/PersonalizationEditor.jsx"));
});

after(async () => {
  if (tree) await act(async () => tree.unmount());
  await vite?.close();
  if (cacheDir) {
    assert.equal(dirname(resolve(cacheDir)), resolve(tmpdir()));
    assert.ok(basename(cacheDir).startsWith("dengta-editor-lifecycle-"));
    await rm(cacheDir, { recursive: true, force: true });
  }
  if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
  else delete globalThis.Worker;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

const render = () => React.createElement(PersonalizationEditor, props);
async function mount(value = "原始文本") {
  if (tree) await act(async () => tree.unmount());
  draft = value;
  writes = [];
  props = {
    field: "unified_system_prompt", label: "个性化指令", scopeKey: "fictional-account/fictional-companion", value,
    onChange(text) {
      writes.push(text);
      draft = text;
      props = { ...props, value: text };
      tree.update(render());
    },
  };
  await act(async () => { tree = TestRenderer.create(render()); });
}
async function update(changes) {
  props = { ...props, ...changes };
  if (Object.hasOwn(changes, "value")) draft = changes.value;
  await act(async () => tree.update(render()));
}
const button = (label) => tree.root.findAllByType("button").find(node => node.children.includes(label));
async function beginImport() {
  let resolve, reject;
  const file = { name: "fictional.txt", type: "text/plain", arrayBuffer: () => new Promise((accept, fail) => { resolve = accept; reject = fail; }) };
  await act(async () => tree.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file], value: "selected" } }));
  return {
    finish: (text) => act(async () => resolve(new TextEncoder().encode(text).buffer)),
    fail: () => act(async () => reject(new Error("fictional read failed"))),
  };
}

test("disabling the actual editor releases an unresolved import immediately", async () => {
  await mount();
  const pending = await beginImport();
  assert.ok(button("读取中…"));
  await update({ disabled: true });
  await update({ disabled: false });
  assert.equal(button("导入文本")?.props.disabled, false, "a cancelled file must not leave import locked until the file resolves");
  assert.equal(draft, "原始文本");
  await pending.finish("取消的文件");
});

test("re-enabling the actual editor does not revive the import cancelled by disabling", async () => {
  await mount();
  const pending = await beginImport();
  await update({ disabled: true });
  await update({ disabled: false });
  await pending.finish("取消的文件\r\n");
  assert.equal(draft, "原始文本", "disabled-to-enabled is a lifecycle boundary, even before the read has finished");
  assert.deepEqual(writes, []);
});

test("a cancelled file error cannot replace feedback from a newer import", async () => {
  await mount();
  const oldRead = await beginImport();
  await update({ disabled: true });
  await update({ disabled: false });
  const nextRead = await beginImport();
  await nextRead.finish("  新原文\r\n");
  await oldRead.fail();
  assert.equal(draft, "原始文本\n\n  新原文\r\n");
  assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 0);
});

test("fast large-text editing starts background counting only after the latest edit settles", async () => {
  workers = [];
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: class {
    constructor() { workers.push(this); }
    postMessage(text) { this.text = text; }
    terminate() { this.terminated = true; }
  } });
  const base = "中".repeat(1000000);
  await mount(base);
  for (let index = 1; index <= 8; index += 1) {
    await act(async () => tree.root.findByType("textarea").props.onChange({ target: { value: `${base}${index}` } }));
  }
  assert.equal(draft, `${base}8`, "draft changes never wait for counting");
  assert.equal(workers.length, 0, "avoid creating, cloning a million-character string into and destroying a Worker for every quick edit");
  await act(async () => new Promise(resolve => setTimeout(resolve, 180)));
  assert.equal(workers.length, 1);
  assert.equal(workers[0].text, `${base}8`);
  await act(async () => workers[0].onmessage({ data: { count: 1000001 } }));
  assert.equal(tree.root.findByType("output").children.join(""), "1,000,001 个字符");
});

test("unmounting before the delay cancels counting without creating a Worker", async () => {
  workers.length = 0;
  await mount("中".repeat(30000));
  await act(async () => tree.unmount());
  tree = null;
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(workers.length, 0);
  assert.deepEqual(writes, []);
});

test("changing to a small text cancels the pending large count and shows the immediate Unicode count", async () => {
  workers.length = 0;
  await mount("中".repeat(30000));
  await update({ value: "中👩🏽‍💻e\u0301🇨🇳\r\n" });
  assert.equal(tree.root.findByType("output").children.join(""), "5 个字符");
  await act(async () => new Promise(resolve => setTimeout(resolve, 180)));
  assert.equal(workers.length, 0);
  assert.deepEqual(writes, []);
});

test("obsolete Worker receipts remain ignored throughout the new delay", async () => {
  workers.length = 0;
  await mount("中".repeat(30000));
  await act(async () => new Promise(resolve => setTimeout(resolve, 180)));
  const oldWorker = workers[0];
  await update({ value: "文".repeat(40000) });
  assert.equal(oldWorker.terminated, true);
  await act(async () => oldWorker.onmessage({ data: { count: 30000 } }));
  assert.equal(tree.root.findByType("output").children.join(""), "正在统计…");
  await act(async () => new Promise(resolve => setTimeout(resolve, 180)));
  await act(async () => workers[1].onmessage({ data: { count: 40000 } }));
  assert.equal(tree.root.findByType("output").children.join(""), "40,000 个字符");
});

test("Worker startup failure still counts full composed text cooperatively after the delay", async () => {
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: class {
    constructor() { throw new Error("synthetic Worker startup failure"); }
  } });
  const value = "👩🏽‍💻".repeat(3500);
  assert.ok(value.length > 20000);
  await mount(value);
  assert.equal(tree.root.findByType("output").children.join(""), "正在统计…");
  await act(async () => new Promise(resolve => setTimeout(resolve, 210)));
  assert.equal(tree.root.findByType("output").children.join(""), "3,500 个字符");
  assert.equal(draft, value);
  assert.deepEqual(writes, []);
});
