import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import "fake-indexeddb/auto";
import { workspaceCacheClear, workspaceCacheWrite, workspaceCacheList } from "../src/workspace-cache.js";

const priorAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
const priorWindow = globalThis.window;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { setTimeout, clearTimeout, confirm: () => true };
const apiNames = ["workspaceTree", "workspaceStats", "workspaceReadFile", "workspaceWriteFile", "workspaceDeleteFile", "workspaceAgentsMd"];
let online = false, pending = null, currentContent = "cloud fixture", truncated = false;
let notifyPendingRead;
const reads = [];
globalThis.__workspaceTestApi = {
  async workspaceTree() {
    if (!online) throw new TypeError("fictional offline");
    return { ok: true, path: "/", entries: [{ name: "empty.txt", type: "file", size: 0 }, { name: "second.txt", type: "file", size: 0 }] };
  },
  async workspaceStats() { return { ok: true, files: 2, bytes: 2, partial: false }; },
  async workspaceReadFile(path) {
    reads.push(path);
    if (pending) { const value = pending; pending = null; notifyPendingRead?.(); return value; }
    if (!online) throw new TypeError("fictional offline");
    return { ok: true, path, content: currentContent, chars: currentContent.length, truncated };
  },
  async workspaceWriteFile() { return { ok: true }; },
  async workspaceDeleteFile() { return { ok: true }; },
  async workspaceAgentsMd() { return { ok: true, content: "fictional fixture" }; },
};
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true },
  plugins: [{ name: "workspace-api-fixture", enforce: "pre", load(id) {
    if (id.replaceAll("\\", "/").endsWith("/src/workspace-api.js")) {
      return apiNames.map(name => `export const ${name} = (...args) => globalThis.__workspaceTestApi.${name}(...args);`).join("\n");
    }
  } }],
});
let tree;
const settle = () => new Promise(resolve => setTimeout(resolve, 25));
const click = async node => act(async () => { await node.props.onClick(); await settle(); });
const button = text => tree.root.findAllByType("button").find(node => node.children.includes(text));
const fileButton = name => tree.root.findAllByProps({ className: "workspace-file-name" }).find(node => node.findByType("strong").children[0] === name);
try {
  await workspaceCacheClear("manager-a"); await workspaceCacheClear("manager-b");
  await workspaceCacheWrite("manager-a", "empty.txt", "");
  await workspaceCacheWrite("manager-b", "secret.txt", "fictional B");
  const { default: Manager } = await vite.ssrLoadModule("/src/WorkspaceManager.jsx");
  await act(async () => { tree = TestRenderer.create(React.createElement(Manager, { accountScope: "manager-a" })); await settle(); });
  await act(settle);
  await act(async () => {
    const deadline = Date.now() + 3000;
    while (!fileButton("empty.txt") && Date.now() < deadline) await settle();
  });
  assert.ok(fileButton("empty.txt")); assert.equal(fileButton("secret.txt"), undefined);
  await click(fileButton("empty.txt"));
  assert.equal(tree.root.findByType("textarea").props.value, "");
  assert.match(JSON.stringify(tree.toJSON()), /离线副本/);
  online = true;
  await click(button("刷新"));
  let release;
  const pendingReadStarted = new Promise(resolve => { notifyPendingRead = resolve; });
  pending = new Promise(resolve => { release = resolve; });
  await act(async () => { void fileButton("empty.txt").props.onClick(); await pendingReadStarted; });
  await click(fileButton("second.txt"));
  await act(async () => { release({ ok: true, path: "empty.txt", chars: 13, content: "stale fixture", truncated: false }); await settle(); });
  assert.equal(tree.root.findByType("textarea").props.value, "cloud fixture");
  truncated = true; currentContent = "preview fixture";
  await click(fileButton("empty.txt"));
  assert.equal(tree.root.findByType("textarea").props.readOnly, true);
  assert.equal(button("保存").props.disabled, true);
  await act(async () => {
    const deadline = Date.now() + 3000;
    while ((await workspaceCacheList("manager-a")).some(item => item.path === "empty.txt") && Date.now() < deadline) await settle();
  });
  assert.equal((await workspaceCacheList("manager-a")).some(item => item.path === "empty.txt"), false);
  assert.deepEqual(reads.slice(-3), ["empty.txt", "second.txt", "empty.txt"]);
  console.log("Workspace UI: scoped offline tree, empty cached file, root paths, stale response isolation and truncated preview protection passed");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close(); delete globalThis.__workspaceTestApi;
  if (priorAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = priorAct;
  if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow;
}
