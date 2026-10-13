import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
let tree;
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
try {
  const { default: CompanionInspiration } = await vite.ssrLoadModule("/src/CompanionInspiration.jsx");
  const drafts = [], onUse = draft => drafts.push(draft);
  await act(async () => { tree = TestRenderer.create(React.createElement(CompanionInspiration, { onUse })); });
  const button = label => tree.root.find(node => node.type === "button" && text(node) === label);
  await act(async () => button("抽一张").props.onClick());
  assert.equal(drafts.length, 0, "drawing does not send or populate any draft");
  assert.match(text(tree.toJSON()), /由你决定是否发送/);
  await act(async () => button("带到聊天").props.onClick());
  assert.equal(drafts.length, 1);
  assert.equal(button("已带入草稿").props.disabled, true);
  await act(async () => button("换一张").props.onClick());
  await act(async () => button("带到聊天").props.onClick());
  assert.equal(drafts.length, 2);
  assert.notEqual(drafts[0], drafts[1]);
  await act(async () => tree.update(React.createElement(CompanionInspiration, { onUse, disabled: true })));
  assert.equal(button("已带入草稿").props.disabled, true);
  await act(async () => tree.unmount()); tree = null;
  console.log("Actual inspiration card only prepares user-selected drafts, avoids consecutive repeats and honors busy state.");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
