import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { navItems } from "../src/feature-navigation.js";

// 滑动高亮块必须真的出现在菜单里。
// 审查指出过：组件和测试都在，但没人渲染它，于是「功能存在」是假的。
// 这条测试盯的就是「它被挂进了菜单容器」。

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    logLevel: "silent",
});

const { default: FeatureNavigation } = await vite.ssrLoadModule("/src/FeatureNavigation.jsx");

test("the menu renders the sliding indicator inside the groups container", async () => {
    let view;
    try {
        await act(async () => {
            view = TestRenderer.create(
                React.createElement(FeatureNavigation, {
                    items: navItems,
                    activeView: "chat",
                    onNavigate: () => {},
                })
            );
        });
        const groups = view.root.findAllByProps({ className: "feature-navigation-groups has-sliding-indicator" });
        assert.equal(groups.length >= 1, true, "the groups container exists");
        const indicator = view.root.findAllByProps({ className: "sliding-indicator" });
        assert.equal(indicator.length >= 1, true, "the sliding indicator is rendered inside the menu");
        assert.equal(indicator[0].props["aria-hidden"], "true", "the indicator stays out of the accessibility tree");
    } finally {
        if (view) await act(async () => view.unmount());
    }
});

test("the active entry is marked and navigation is wired", async () => {
    const navigated = [];
    let view;
    try {
        await act(async () => {
            view = TestRenderer.create(
                React.createElement(FeatureNavigation, {
                    items: navItems,
                    activeView: "diary",
                    onNavigate: (id) => navigated.push(id),
                })
            );
        });
        const entryButtons = view.root.findAllByType("button");
        assert.ok(entryButtons.length >= navItems.length, "every entry is rendered as a button");
        const activeButtons = view.root.findAllByProps({ "aria-current": "page" });
        assert.equal(activeButtons.length, 1, "exactly one entry is the current page");
        await act(async () => activeButtons[0].props.onClick());
        assert.deepEqual(navigated, ["diary"], "clicking the active entry reports the same view id");
    } finally {
        if (view) await act(async () => view.unmount());
    }
});

test("searching hides the indicator target without removing the indicator itself", async () => {
    let view;
    try {
        await act(async () => {
            view = TestRenderer.create(
                React.createElement(FeatureNavigation, {
                    items: navItems,
                    activeView: "chat",
                    onNavigate: () => {},
                })
            );
        });
        const input = view.root.findAllByType("input")[0];
        await act(async () => {
            input.props.onChange({ target: { value: "涂鸦" } });
        });
        const indicator = view.root.findAllByProps({ className: "sliding-indicator" });
        assert.equal(indicator.length >= 1, true, "the indicator survives filtering");
        const activeButtons = view.root.findAllByProps({ "aria-current": "page" });
        assert.equal(activeButtons.length, 0, "no entry is marked active when it is filtered out");
    } finally {
        if (view) await act(async () => view.unmount());
    }
});

await vite.close();
console.log("Feature navigation: indicator placement, active marking, navigation wiring and filtered state passed");
