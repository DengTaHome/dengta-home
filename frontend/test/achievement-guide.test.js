import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { freshAchievements, guideStorageKey, readGuidePreferences } from "../src/achievement-guide.js";

const values = new Map();
const originals = new Map();
function stub(name, value) { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
stub("localStorage", { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
stub("IS_REACT_ACT_ENVIRONMENT", true);
const key = guideStorageKey("account-a", "companion-a");
assert.notEqual(key, guideStorageKey("account-b", "companion-a"));
assert.notEqual(key, guideStorageKey("account-a", "companion-b"));
assert.equal(guideStorageKey("", "companion-a"), null);
values.set("dengta_onboarding_v1", JSON.stringify({ step: 3 }));
assert.equal(readGuidePreferences(key).step, "hello", "never import unscoped legacy progress");
values.set(key, '{"step":"unknown","visited":null}');
assert.equal(readGuidePreferences(key).step, "hello");
values.delete(key);
const first = { code: "first_chat", title: "初次相遇", unlocked: true };
assert.deepEqual(freshAchievements(null, [first]), [], "initial load never celebrates old achievements");
assert.deepEqual(freshAchievements(["first_chat"], []), []);
assert.deepEqual(freshAchievements([], [first]), [first]);
assert.deepEqual(freshAchievements(["first_chat"], [first]), []);

const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
let tree;
try {
  const { default: Guide } = await vite.ssrLoadModule("/src/AchievementGuide.jsx");
  const actions = [];
  let attempts = 0, resolveClaim;
  const props = { storageKey: key, onAction: action => actions.push(action), onClaim: () => { attempts++; return new Promise(resolve => { resolveClaim = resolve; }); } };
  await act(async () => { tree = TestRenderer.create(React.createElement(Guide, props)); });
  const button = text => tree.root.findAllByType("button").find(node => node.children.join("").includes(text));
  assert.equal(tree.root.findAll(node => node.props.role === "dialog").length, 0);
  assert.equal(tree.root.findAllByType("nav").length, 0, "first visit offers help without expanding a tutorial");
  await act(async () => button("看看路线").props.onClick());
  await act(async () => button("去聊天").props.onClick());
  assert.deepEqual(actions, ["hello"]);
  await act(async () => button("需要时再接入").props.onClick());
  await act(async () => button("先自己逛逛").props.onClick());
  assert.equal(tree.root.findAllByType("nav").length, 0);
  assert.equal(readGuidePreferences(key).step, "connect", "closing never resets progress");
  await act(async () => tree.unmount());
  await act(async () => { tree = TestRenderer.create(React.createElement(Guide, props)); });
  assert.equal(tree.root.findAllByType("nav").length, 0, "dismiss survives remount");
  await act(async () => button("看看路线").props.onClick());
  assert.equal(tree.root.findByType("h3").children.join(""), "需要时再接入");
  await act(async () => button("换一步看看").props.onClick());
  assert.equal(tree.root.findByType("h3").children.join(""), "挑一个喜欢的玩法");
  await act(async () => button("留一份小纪念").props.onClick());
  assert.equal(button("收下入门纪念").props.disabled, true);
  await act(async () => tree.update(React.createElement(Guide, { ...props, achievements: [first] })));
  assert.equal(button("收下入门纪念").props.disabled, false);
  await act(async () => button("收下入门纪念").props.onClick());
  assert.equal(button("正在保存").props.disabled, true);
  assert.equal(attempts, 1);
  await act(async () => resolveClaim({ unlocked: {code:"onboarding_1",unlocked:true}, achievements:[first,{code:"onboarding_1",title:"Fictional keepsake",unlocked:true}] }));
  assert.equal(button("纪念已收好").props.disabled,true);
  await act(async () => tree.update(React.createElement(Guide, { ...props, key:"failed-claim", achievements: [first], onClaim: async () => { throw Error("synthetic failure"); } })));
  await act(async () => button("收下入门纪念").props.onClick());
  assert.ok(tree.root.findAll(node => node.props.role === "status").some(node => node.children.join("").includes("结果尚未确认")));
  await act(async () => tree.update(React.createElement(Guide, { ...props, key: "b", storageKey: guideStorageKey("account-b", "companion-a") })));
  await act(async () => button("看看路线").props.onClick());
  assert.equal(tree.root.findByType("h3").children.join(""), "先聊一句");
  await act(async () => tree.unmount()); tree = null;

  const { default: Notice } = await vite.ssrLoadModule("/src/AchievementNotice.jsx");
  let dismissed = 0;
  await act(async () => { tree = TestRenderer.create(React.createElement(Notice, { items: [first], onDismiss: () => dismissed++, onView: () => {} })); });
  assert.equal(tree.root.findAll(node => node.props.role === "dialog" || node.props["aria-modal"]).length, 0);
  assert.equal(tree.root.findAll(node => node.props.role === "status").length, 1);
  await act(async () => button("收起").props.onClick());
  assert.equal(dismissed, 1);
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.ok(!app.includes("dengta_onboarding_v1") && !app.includes("onboardingAutoShownRef"));
  assert.ok(app.includes("refreshFunLabsSections"), "achievement refresh uses the scoped section loader; race behavior is tested in fun-labs-refresh.test.js");
  console.log("Achievement guide: dismiss/resume, scope, optional steps, confirmed rewards, failure recovery and non-modal notices passed");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
}
