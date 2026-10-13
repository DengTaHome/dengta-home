import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { COMPANION_INSPIRATIONS, INSPIRATION_CATEGORIES, drawCompanionInspiration } from "../src/companion-inspiration.js";

for (const category of INSPIRATION_CATEGORIES) test(`${category.label} draws a complete round before repeats`, () => {
  const count = COMPANION_INSPIRATIONS.filter(card => category.id === "all" || card.category === category.id).length;
  const ids = new Set();
  let state = { category: category.id };
  for (let index = 0; index < count; index++) {
    const next = drawCompanionInspiration(state, () => 0);
    assert.ok(next.card);
    if (category.id !== "all") assert.equal(next.card.category, category.id);
    assert.equal(ids.has(next.card.id), false);
    ids.add(next.card.id);
    state = { category: category.id, previousId: next.card.id, seenIds: next.seenIds };
  }
  const restart = drawCompanionInspiration(state, () => 0);
  assert.equal(restart.restarted, true);
  assert.notEqual(restart.card.id, state.previousId);
  assert.deepEqual(restart.seenIds, [restart.card.id]);
});

test("unknown filters and malformed draw history keep a usable bounded card", () => {
  for (const value of [NaN, Infinity, -10, 0, 1, 99]) {
    const next = drawCompanionInspiration({ category: "future", previousId: "story", seenIds: "bad-history" }, () => value);
    assert.ok(COMPANION_INSPIRATIONS.includes(next.card));
    assert.notEqual(next.card.id, "story");
    assert.equal(next.seenIds.length, 1);
  }
});

test("actual inspiration categories, async draft confirmation and failure recovery", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let tree;
  const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
  try {
    const { default: Component } = await vite.ssrLoadModule("/src/CompanionInspiration.jsx");
    const drafts = [];
    let finish;
    const onUse = draft => { drafts.push(draft); return new Promise(resolve => { finish = resolve; }); };
    await act(async () => { tree = TestRenderer.create(React.createElement(Component, { onUse })); });
    const button = label => tree.root.find(node => node.type === "button" && text(node) === label);
    await act(async () => button("共创故事").props.onClick());
    assert.equal(drafts.length, 0);
    assert.equal(tree.root.findAllByProps({ className: "companion-inspiration-result" }).length, 0);
    assert.equal(button("共创故事").props["aria-pressed"], true);
    await act(async () => button("抽一张").props.onClick());
    assert.match(text(tree.toJSON()), /共创故事/);
    const click = button("带到聊天").props.onClick;
    await act(async () => { click(); click(); });
    assert.equal(drafts.length, 1, "synchronous lock covers same-tick draft preparation");
    assert.equal(button("正在带入…").props.disabled, true);
    assert.equal(button("换一张").props.disabled, true);
    await act(async () => finish(false));
    assert.equal(button("带到聊天").props.disabled, false);
    assert.match(text(tree.toJSON()), /暂时没能放入聊天草稿/);
    await act(async () => button("带到聊天").props.onClick());
    await act(async () => finish(true));
    assert.equal(button("已带入草稿").props.disabled, true);
    assert.equal(drafts.length, 2);
    assert.equal(drafts[0], drafts[1], "manual retry reuses the same selected draft");
    await act(async () => button("轻聊日常").props.onClick());
    await act(async () => button("抽一张").props.onClick());
    await act(async () => tree.update(React.createElement(Component, { onUse: () => Promise.reject(new Error("synthetic-private-error-body")) })));
    await act(async () => button("带到聊天").props.onClick());
    assert.match(text(tree.toJSON()), /暂时没能放入聊天草稿/);
    assert.doesNotMatch(text(tree.toJSON()), /synthetic-private-error-body/);
    assert.equal(button("带到聊天").props.disabled, false);
    await act(async () => tree.update(React.createElement(Component)));
    assert.equal(button("带到聊天").props.disabled, true, "a missing action cannot claim draft success");
    await act(async () => tree.unmount()); tree = null;
  } finally {
    if (tree) await act(async () => tree.unmount());
    await vite.close();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
