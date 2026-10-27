import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

import {
  DRIVE_LIMIT,
  capsuleTitle,
  clampLevel,
  consciousnessLabel,
  formatLastConversation,
  formatPercent,
  normalizeXinchaoPayload,
  percentWidth,
  sortDrives,
} from "../src/xinchao.js";

// --- 纯函数 ---

const sixDrives = [
  { key: "attachment", label: "想靠近", value: 0.52 },
  { key: "curiosity", label: "想分享", value: 0.61 },
  { key: "longing", label: "惦记", value: 0.33 },
  { key: "tenderness", label: "温柔", value: 0.47 },
  { key: "closeness", label: "亲近", value: 0.44 },
  { key: "restlessness", label: "躁动", value: 0.21 },
];

const sorted = sortDrives(sixDrives);
assert.equal(sorted.length, DRIVE_LIMIT, "only the top 5 drives are rendered");
assert.deepEqual(
  sorted.map((drive) => drive.key),
  ["curiosity", "attachment", "tenderness", "closeness", "longing"],
  "drives are sorted by value descending and truncated"
);
assert.equal(sorted[5], undefined, "the sixth drive is dropped");
assert.equal(sortDrives(null).length, 0, "missing drives produce an empty list");
assert.equal(
  sortDrives([{ key: "x", value: Number.NaN }, { key: "y", label: "好", value: 0.4 }]).length,
  1,
  "drives without a finite value are discarded"
);
assert.equal(
  sortDrives([{ key: "no_label", value: 0.4 }])[0].label,
  "no_label",
  "a missing label falls back to the key instead of rendering undefined"
);

assert.equal(formatPercent(0.615), "62", "the value renders as an integer without a percent sign");
assert.equal(formatPercent(null), "0", "a non-number formats to 0");
assert.equal(percentWidth(0.5), 50, "bar width is a 0..100 number");
assert.equal(percentWidth(-1), 0, "bar width never goes negative");
assert.equal(clampLevel(0), 0.08, "a zero drive still shows a visible petal");
assert.equal(clampLevel(2), 1, "levels are capped at 1");

assert.equal(
  capsuleTitle({ emotion: { label: "雀跃" }, drives: sixDrives }),
  "雀跃 · 想分享61 / 想靠近52 / 温柔47 / 亲近44 / 惦记33",
  "the capsule title lists emotion and the top five drives"
);
assert.equal(
  capsuleTitle({ emotion: { label: "平静" }, drives: [] }),
  "平静 · 心潮",
  "no drives degrades to a plain label"
);

assert.equal(consciousnessLabel("awake"), "此刻醒着", "awake is localised");
assert.equal(consciousnessLabel(null), "心潮流动", "null falls back to 心潮流动");
assert.equal(
  consciousnessLabel("drowsy"),
  "心潮流动",
  "an unexpected English enum is swallowed instead of printed raw"
);

assert.equal(formatLastConversation(null), "", "no timestamp means no text");
assert.equal(formatLastConversation("not a date"), "", "an invalid timestamp means no text");
assert.ok(
  formatLastConversation("2026-10-27T09:42:00.000Z").length > 0,
  "a valid timestamp renders a localised string"
);

assert.equal(normalizeXinchaoPayload(null), null, "an empty payload means the feature is off");
assert.equal(
  normalizeXinchaoPayload({ configured: false, state: { drives: sixDrives } }),
  null,
  "configured:false disables the feature even if state is present"
);
assert.equal(
  normalizeXinchaoPayload({ configured: true }),
  null,
  "configured:true without state disables the feature"
);

const normalized = normalizeXinchaoPayload({
  configured: true,
  state: {
    emotion: { label: "雀跃" },
    drives: sixDrives,
    consciousness: "drowsy",
    revision: 4,
    lastConversationAt: "2026-10-27T09:42:00.000Z",
  },
});
assert.equal(normalized.drives.length, DRIVE_LIMIT, "normalisation also truncates");
assert.equal(normalized.consciousness, null, "only 'awake' survives normalisation");
assert.equal(normalized.emotion.label, "雀跃", "emotion label is preserved");

// --- 组件渲染 ---

const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const { default: XinchaoCapsule } = await vite.ssrLoadModule("/src/XinchaoCapsule.jsx");
  const { default: XinchaoDetails } = await vite.ssrLoadModule("/src/XinchaoDetails.jsx");

  const state = {
    emotion: { label: "雀跃" },
    drives: sortDrives(sixDrives),
    consciousness: "awake",
    revision: 4,
    lastConversationAt: "2026-10-27T09:42:00.000Z",
  };

  // 胶囊：5 片花瓣 + 文案 + 版本号
  {
    let tree;
    await act(async () => {
      tree = TestRenderer.create(React.createElement(XinchaoCapsule, { state, onOpen: () => {} }));
    });
    const root = tree.root;

    assert.equal(
      root.findAll((node) => node.props?.className === "xinchao-capsule-petal").length,
      5,
      "the capsule renders exactly five petals"
    );
    const petals = root.findAll((node) => node.props?.className === "xinchao-capsule-petal");
    assert.equal(
      petals[0].props.style["--xinchao-index"],
      0,
      "each petal carries its index for the staggered animation delay"
    );
    assert.ok(
      petals[0].props.style["--xinchao-level"] > 0.6,
      "the first petal reflects the highest drive"
    );

    const small = root.findAllByType("small");
    const strong = root.findAllByType("strong");
    assert.equal(small[0].children[0], "雀跃", "the capsule shows the emotion label");
    assert.equal(strong[0].children[0], "想分享", "the capsule shows the dominant drive");

    const button = root.findByType("button");
    assert.equal(button.props.type, "button", "the capsule is a real button");
    assert.match(button.props["aria-label"], /想分享61/, "the accessible label carries the numbers");

    await act(async () => tree.unmount());
  }

  // 胶囊：没有数据时也不该崩
  {
    let tree;
    await act(async () => {
      tree = TestRenderer.create(React.createElement(XinchaoCapsule, { state: null }));
    });
    const root = tree.root;
    assert.equal(
      root.findAll((node) => node.props?.className === "xinchao-capsule-petal").length,
      0,
      "a null state renders no petals"
    );
    assert.equal(root.findAllByType("small")[0].children[0], "平静", "a null state reads as 平静");
    assert.equal(root.findAllByType("strong")[0].children[0], "心潮", "a null state falls back to 心潮");
    await act(async () => tree.unmount());
  }

  // 详情：dialog（默认）与 region（inline）
  {
    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(XinchaoDetails, { state, aiName: "灯塔", onClose: () => {} })
      );
    });
    const root = tree.root;
    const dialog = root.findByProps({ role: "dialog" });
    assert.equal(dialog.props["aria-modal"], false, "a floating panel is not an aria-modal dialog");
    assert.equal(
      dialog.props["aria-label"],
      "灯塔的心潮状态",
      "the panel is labelled with the companion name"
    );
    assert.equal(
      root.findAll((node) => node.props?.className === "xinchao-details-drive").length,
      5,
      "the details list shows five drives"
    );
    assert.equal(root.findAllByType("b")[0].children[0], "61", "each row prints a percentage");
    assert.equal(root.findAllByType("button").length, 1, "a close button appears when onClose is given");
    await act(async () => tree.unmount());
  }

  {
    let tree;
    await act(async () => {
      tree = TestRenderer.create(
        React.createElement(XinchaoDetails, { state, aiName: "灯塔", inline: true })
      );
    });
    const root = tree.root;
    assert.equal(root.findAllByProps({ role: "region" }).length, 1, "inline mode is a region");
    assert.equal(root.findAllByType("button").length, 0, "inline mode has no close button");
    await act(async () => tree.unmount());
  }

  console.log(
    "Xinchao UI: drive truncation, percent formatting, capsule title, consciousness swallowing, capsule and details rendering passed"
  );
} finally {
  await vite.close();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
