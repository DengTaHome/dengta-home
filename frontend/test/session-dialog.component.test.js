import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { transformWithOxc } from "vite";
import { MAX_SESSION_TITLE } from "../src/session-dialog-feedback.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = fs.readFileSync(new URL("../src/SessionDialog.jsx", import.meta.url), "utf8").replace(/^import[^;]+;\r?\n/gm, "").replace("export default function", "function");
const compiled = (await transformWithOxc(source, "SessionDialog.jsx", { jsx: { runtime: "classic", pragma: "React.createElement", pragmaFrag: "React.Fragment" } })).code;
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
async function fixture({ type = "rename", busy = false, lowerEscape = null } = {}) {
  const listeners = [], events = [], changes = [];
  let tree, closes = 0, confirms = 0;
  const doc = { body: { style: { overflow: "auto" } }, addEventListener(name, fn, capture = false) { listeners.push({name, fn, capture}); }, removeEventListener(name, fn, capture = false) { const index = listeners.findIndex(row => row.name === name && row.fn === fn && row.capture === capture); if (index >= 0) listeners.splice(index, 1); } };
  if (lowerEscape) doc.addEventListener("keydown", lowerEscape);
  const opener = { isConnected: true, focus() { doc.activeElement = this; events.push("opener"); } }; doc.activeElement = opener;
  const nodes = new Map();
  const panel = { isConnected: true, focus() { doc.activeElement = this; events.push("panel"); }, contains(node) { return node === this || [...nodes.values()].includes(node); },
    querySelectorAll() { return tree.root.findAll(node => ["button", "input"].includes(node.type) && !node.props.disabled).map((node, index) => {
      const key = `${node.type}:${index}`, existing = nodes.get(key);
      if (existing) return existing;
      const element = { key, isConnected: true, focus() { doc.activeElement = this; events.push(key); } }; nodes.set(key, element); return element;
    }); } };
  const Component = vm.runInNewContext(compiled + "\nSessionDialog;", { React, useRef: React.useRef, useEffect: React.useEffect, useLayoutEffect: React.useLayoutEffect, useId: React.useId, MAX_SESSION_TITLE, document: doc });
  const props = { dialog: { type, value: "fictional title", session: { title: "fictional session" } }, busy, onChange: value => changes.push(value), onClose: () => closes++, onConfirm: event => { event.preventDefault(); confirms++; } };
  await act(async () => { tree = TestRenderer.create(React.createElement(Component, props), { createNodeMock: element => element.type === "form" ? panel : null }); });
  const h = { doc, panel, opener, tree, events, changes, get closes() { return closes; }, get confirms() { return confirms; },
    async update(next) { Object.assign(props, next); await act(async () => tree.update(React.createElement(Component, props))); },
    key(key, extra = {}) {
      let prevented = 0, stopped = 0;
      const event = { key, preventDefault() { prevented++; }, stopPropagation() { stopped++; }, ...extra };
      for (const capture of [true, false]) {
        if (stopped) break;
        for (const row of [...listeners].filter(row => row.name === "keydown" && row.capture === capture)) row.fn(event);
      }
      return { prevented, stopped };
    },
    async finish() { await act(async () => tree.unmount()); if (lowerEscape) doc.removeEventListener("keydown", lowerEscape); assert.equal(doc.body.style.overflow, "auto"); assert.equal(listeners.length, 0); },
  };
  return h;
}

test("rename dialog labels the editor, respects server capacity and keeps Tab within the panel", async () => {
  const h = await fixture();
  try {
    assert.equal(h.tree.root.findByType("form").props["aria-modal"], "true");
    const input = h.tree.root.findByType("input"); assert.equal(input.props.maxLength, 60); assert.equal(input.props["aria-label"], "对话名称");
    assert.match(text(h.tree.toJSON()), /最多 60 字/);
    const nodes = h.panel.querySelectorAll(); assert.equal(h.doc.activeElement, nodes[0]);
    h.doc.activeElement = nodes.at(-1); assert.equal(h.key("Tab").prevented, 1); assert.equal(h.doc.activeElement, nodes[0]);
    assert.equal(h.key("Tab", { shiftKey: true }).prevented, 1); assert.equal(h.doc.activeElement, nodes.at(-1));
    assert.deepEqual(h.key("Escape"), { prevented: 1, stopped: 1 }); assert.equal(h.closes, 1);
  } finally { await h.finish(); }
  assert.equal(h.doc.activeElement, h.opener);
});

test("delete dialog initially focuses cancel and busy operations cannot dismiss or edit", async () => {
  const h = await fixture({ type: "delete" });
  try {
    assert.equal(text(h.tree.root.findAllByType("button")[0]), "取消");
    assert.equal(h.doc.activeElement, h.panel.querySelectorAll()[0]);
    await h.update({ busy: true });
    assert.equal(h.tree.root.findByType("form").props["aria-busy"], true);
    assert.ok(h.tree.root.findAllByType("button").every(node => node.props.disabled));
    assert.deepEqual(h.key("Escape"), { prevented: 1, stopped: 1 }); assert.equal(h.closes, 0);
    assert.equal(h.key("Tab").prevented, 1); assert.equal(h.doc.activeElement, h.panel);
    assert.match(text(h.tree.toJSON()), /等待服务器确认/);
    await h.update({ busy: false }); h.key("Escape"); assert.equal(h.closes, 1);
  } finally { await h.finish(); }
});

test("busy initial mount has a focusable panel and does not steal another panel's focus on cleanup", async () => {
  const h = await fixture({ busy: true });
  assert.equal(h.doc.activeElement, h.panel);
  const other = { isConnected: true }; h.doc.activeElement = other;
  await h.finish(); assert.equal(h.doc.activeElement, other);
});

test("dialog ignores IME and modified shortcuts and shows retained errors with a log action", async () => {
  const h = await fixture();
  try {
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) assert.deepEqual(h.key("Escape", extra), { prevented: 0, stopped: 0 });
    assert.equal(h.closes, 0);
    await h.update({ feedback: "fictional error session_receipt_invalid", onInspect() {} });
    assert.match(text(h.tree.root.findByProps({ role: "alert" })), /session_receipt_invalid.*查看操作日志/);
    assert.equal(h.tree.root.findByType("input").props.value, "fictional title");
  } finally { await h.finish(); }
});

test("Escape never reaches an earlier underlying document listener while open or busy", async () => {
  for (const busy of [false, true]) {
    let lowerCloses = 0;
    const h = await fixture({busy, lowerEscape(event) { if (event.key === "Escape") lowerCloses++; }});
    try {
      h.key("Escape");
      assert.equal(lowerCloses, 0);
      assert.equal(h.closes, busy ? 0 : 1);
    } finally { await h.finish(); }
  }
});
