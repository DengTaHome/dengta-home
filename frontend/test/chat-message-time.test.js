import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const text = node => typeof node === "string" ? node : (Array.isArray(node) ? node : node?.children || []).map(text).join("");

test("a malformed saved message time does not prevent the actual chat message or newer deltas from rendering", async () => {
  const vite = await createServer({ appType: "custom", envDir: false, logLevel: "silent", server: { middlewareMode: true } });
  let renderer;
  try {
    const { default: ChatMessage } = await vite.ssrLoadModule("/src/ChatMessage.jsx");
    for (const created_at of ["not-a-date", "2026-99-99", {}]) {
      const item = { id: "fictional-message", role: "assistant", content: "星灯的虚构回复", created_at, isStreaming: true };
      await act(async () => { renderer = TestRenderer.create(React.createElement(ChatMessage, { item })); });
      assert.ok(text(renderer.toJSON()).includes(item.content));
      assert.equal(text(renderer.root.findByType("time")), "时间未知");
      await act(async () => renderer.update(React.createElement(ChatMessage, { item: { ...item, content: item.content + "继续显示" } })));
      assert.ok(text(renderer.toJSON()).includes(item.content + "继续显示"));
      await act(async () => renderer.unmount());
      renderer = null;
    }
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await vite.close();
  }
});

test("valid, absent and explicitly formatted saved times keep the current display contract and original message unchanged", async () => {
  const vite = await createServer({ appType: "custom", envDir: false, logLevel: "silent", server: { middlewareMode: true } });
  let renderer;
  try {
    const { default: ChatMessage } = await vite.ssrLoadModule("/src/ChatMessage.jsx");
    const date = "2026-10-08T01:23:00Z";
    for (const [created_at, formattedTime, expected] of [
      [date, undefined, new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(date))],
      [null, undefined, "刚刚"],
      ["invalid", "导入时提供的时间", "导入时提供的时间"],
      ["invalid", { invalid: true }, "时间未知"],
    ]) {
      const item = Object.freeze({ id: "fictional-message", role: "user", content: "  原文\n保持不变 ✨", created_at, formattedTime });
      await act(async () => { renderer = TestRenderer.create(React.createElement(ChatMessage, { item })); });
      assert.equal(text(renderer.root.findByType("time")), expected);
      assert.equal(text(renderer.root.findAllByProps({ className: "message-content" })[0]), item.content);
      await act(async () => renderer.unmount());
      renderer = null;
    }
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await vite.close();
  }
});
