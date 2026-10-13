import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { FEATURE_LABELS } from "../src/feature-navigation.js";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const titleStart = app.indexOf("  const viewTitle = ");
const titleEnd = app.indexOf("  const showStartupRecovery =", titleStart);
assert.ok(titleStart >= 0 && titleEnd > titleStart, "use the actual App title assignment");
const titleAssignment = app.slice(titleStart, titleEnd);
const navStart = app.indexOf("const navItems = [");
const navEnd = app.indexOf("\n];", navStart);
assert.ok(navStart >= 0 && navEnd > navStart, "use the actual navigation table");
const navItems = vm.runInNewContext(`${app.slice(navStart, navEnd + 3)}\nnavItems;`);
const renderedViews = [...app.matchAll(/activeView === "([a-z-]+)" && (?:render|\()/g)].map((match) => match[1]);
const viewIds = [...new Set([...navItems.map((item) => item.id), ...renderedViews])];

function titleFor(activeView, activeSession = null) {
  return vm.runInNewContext(`${titleAssignment}\nviewTitle;`, { activeView, activeSession, FEATURE_LABELS });
}

for (const id of viewIds) {
  test(`actual ${id} view has a meaningful header`, () => {
    const title = titleFor(id);
    assert.equal(typeof title, "string");
    assert.ok(title.trim().length > 0, `${id} must not leave its h1 empty`);
    if (id !== "chat" && FEATURE_LABELS[id]) assert.equal(title, FEATURE_LABELS[id]);
  });
}

test("chat preserves its session title and usable unnamed fallback", () => {
  assert.equal(titleFor("chat", { title: "虚构会话标题" }), "虚构会话标题");
  assert.ok(titleFor("chat").trim());
});

test("unknown or newly introduced views retain a nonempty fallback", () => {
  assert.equal(typeof titleFor("fixture-future-view"), "string");
  assert.ok(titleFor("fixture-future-view").trim());
});

test("the displayed non-chat heading uses the validated actual title", () => {
  assert.match(app, /<h1>\{viewTitle\}<\/h1>/);
});
