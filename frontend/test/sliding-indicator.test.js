import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

import { boxKey, measureIndicator } from "../src/sliding-indicator-geometry.js";

// 一个够用的假元素：只需要 getBoundingClientRect 与滚动量。
function fakeElement({ left, top, width, height, scrollLeft = 0, scrollTop = 0 }) {
  return {
    scrollLeft,
    scrollTop,
    getBoundingClientRect: () => ({ left, top, width, height }),
  };
}

// --- 几何计算 ---

assert.equal(measureIndicator(null, null), null, "no elements means nothing to draw");
assert.equal(
  measureIndicator(fakeElement({ left: 0, top: 0, width: 100, height: 40 }), null),
  null,
  "a missing active element means nothing to draw"
);
assert.equal(
  measureIndicator({}, fakeElement({ left: 0, top: 0, width: 10, height: 10 })),
  null,
  "a container without getBoundingClientRect is rejected rather than throwing"
);

const container = fakeElement({ left: 20, top: 100, width: 300, height: 44, scrollLeft: 12, scrollTop: 4 });
const active = fakeElement({ left: 70, top: 108, width: 90, height: 28 });

const box = measureIndicator(container, active);
assert.deepEqual(
  box,
  { left: 62, top: 12, width: 90, height: 28 },
  "the box is relative to the container's content box and includes its scroll offset"
);

assert.equal(
  measureIndicator(container, fakeElement({ left: 70, top: 108, width: 0, height: 28 })),
  null,
  "a zero-width active item hides the indicator instead of drawing a hairline"
);
assert.equal(
  measureIndicator(fakeElement({ left: 0, top: 0, width: 300, height: 0 }), active),
  null,
  "a zero-height container hides the indicator"
);
assert.equal(
  measureIndicator(container, fakeElement({ left: 70, top: 108, width: 90, height: 0.5 })),
  null,
  "sub-pixel heights count as not laid out yet"
);

assert.equal(
  boxKey({ left: 62, top: 12, width: 90, height: 28 }),
  "62|12|90|28",
  "the box key changes only when the geometry actually changes"
);
assert.equal(boxKey(null), "", "a missing box yields an empty key");

// 同一组输入必须得到同一个 key —— 这正是「没有移动就不重绘」的依据。
assert.equal(
  boxKey(measureIndicator(container, active)),
  boxKey(measureIndicator(container, active)),
  "identical geometry produces an identical key"
);

// --- 渲染 ---

const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { default: SlidingIndicator } = await vite.ssrLoadModule("/src/SlidingIndicator.jsx");

  // 默认 class
  {
    let tree;
    await act(async () => {
      tree = TestRenderer.create(React.createElement(SlidingIndicator, {}));
    });
    const span = tree.root.findByType("span");
    assert.equal(span.props.className, "sliding-indicator", "the indicator carries its base class");
    assert.equal(span.props["aria-hidden"], "true", "the indicator is hidden from assistive tech");
    await act(async () => tree.unmount());
  }

  // 追加 class
  {
    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(SlidingIndicator, { className: "is-dark" })
      );
    });
    assert.equal(
      tree.root.findByType("span").props.className,
      "sliding-indicator is-dark",
      "an extra class is appended after the base class"
    );
    await act(async () => tree.unmount());
  }

  // 未挂载的 ref（null）也不能抛
  {
    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(SlidingIndicator, {
          containerRef: { current: null },
          activeRef: { current: null },
          activeKey: "music",
          revision: 3,
        })
      );
    });
    assert.equal(
      tree.root.findAllByType("span").length,
      1,
      "mounting with empty refs still renders without throwing"
    );
    await act(async () => tree.unmount());
  }

  console.log(
    "SlidingIndicator: geometry, sub-pixel guards, box key stability, class composition and empty-ref mounting passed"
  );
} finally {
  await vite.close();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
