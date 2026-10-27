import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

// 心潮徽章：验证「有数据才渲染、没数据什么都不画」。
// 这条测试存在的原因：审查指出此前 XinchaoCapsule 只有测试引用、App 里零引用，
// 一通绿灯但功能对用户不可见。徽章是真正把它挂进界面的那一环，必须有测试盯着。

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    logLevel: "silent",
});

const { default: XinchaoBadge } = await vite.ssrLoadModule("/src/XinchaoBadge.jsx");

const PAYLOAD = {
    configured: true,
    state: {
        emotion: { label: "平静", valence: 0.52, arousal: 0.32 },
        drives: {
            possess: 0.79,
            monitor: 0.79,
            share: 0.79,
            crave: 0.12,
            grief: 0.1,
        },
        consciousness: "awake",
        revision: 12,
        lastConversationAt: "2026-10-27T12:00:00.000Z",
    },
};

test("renders nothing while the state is unavailable", async () => {
    let view;
    try {
        await act(async () => {
            view = TestRenderer.create(
                React.createElement(XinchaoBadge, {
                    request: async () => {
                        throw new Error("offline");
                    },
                })
            );
        });
        assert.equal(view.toJSON(), null, "a failing request must not draw anything");
    } finally {
        if (view) await act(async () => view.unmount());
    }
});

test("renders nothing when the backend says it is not configured", async () => {
    let view;
    try {
        await act(async () => {
            view = TestRenderer.create(
                React.createElement(XinchaoBadge, {
                    request: async () => ({ configured: false }),
                })
            );
        });
        assert.equal(view.toJSON(), null, "an unconfigured backend must not draw anything");
    } finally {
        if (view) await act(async () => view.unmount());
    }
});

test("renders the capsule once a state arrives", async () => {
    let view;
    try {
        await act(async () => {
            view = TestRenderer.create(
                React.createElement(XinchaoBadge, {
                    request: async () => PAYLOAD,
                })
            );
        });
        const json = JSON.stringify(view.toJSON());
        assert.match(json, /xinchao-capsule/, "the capsule is mounted inside the status bar");
        assert.match(json, /心潮|平静/, "the capsule carries the emotion label");
    } finally {
        if (view) await act(async () => view.unmount());
    }
});

test("stays gone when disabled", async () => {
    let calls = 0;
    let view;
    try {
        await act(async () => {
            view = TestRenderer.create(
                React.createElement(XinchaoBadge, {
                    enabled: false,
                    request: async () => {
                        calls += 1;
                        return PAYLOAD;
                    },
                })
            );
        });
        assert.equal(view.toJSON(), null, "a disabled badge draws nothing");
        assert.equal(calls, 0, "a disabled badge does not even request");
    } finally {
        if (view) await act(async () => view.unmount());
    }
});

await vite.close();
console.log("Xinchao badge: unavailable, unconfigured, rendered and disabled states passed");
