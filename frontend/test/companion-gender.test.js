import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";
import { COMPANION_GENDERS, companionPronoun } from "../src/companion-gender.js";
import { createSettingsPayload, normalizeSettingsDraft } from "../src/settings.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
assert.equal(companionPronoun({ ai_gender: "male" }), "他");
assert.equal(companionPronoun({ ai_gender: "female" }), "她");
assert.equal(companionPronoun({ ai_gender: "mtf" }), "她");
assert.equal(companionPronoun({ ai_gender: "ftm" }), "他");
assert.equal(companionPronoun({ ai_gender: "non_binary" }), "TA");
assert.equal(companionPronoun({ ai_gender: "transgender", ai_pronouns: "they" }), "they");
const legacy = { prompt_mode: "legacy", system_prompt: "  original \n", personality: " gentle ", unified_system_prompt: "", user_details: " details\n" };
const draft = normalizeSettingsDraft({ ...legacy, ai_gender: "male" });
const payload = createSettingsPayload(draft);
for (const key of Object.keys(legacy)) assert.equal(payload[key], legacy[key]);
assert.equal(payload.ai_gender, "male");

const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
try {
  const { default: Fields } = await vite.ssrLoadModule("/src/CompanionGenderFields.jsx");
  const { ThinkingPanel } = await vite.ssrLoadModule("/src/ChatMessageExtras.jsx");
  let renderer;
  const changes = [];
  await act(async () => { renderer = TestRenderer.create(React.createElement(Fields, { settings: { ai_gender: "female", ai_pronouns: "她" }, onChange: (...args) => changes.push(args) })); });
  assert.equal(renderer.root.findAllByType("option").length, COMPANION_GENDERS.length);
  await act(async () => renderer.root.findByType("select").props.onChange({ target: { value: "male" } }));
  assert.deepEqual(changes, [["ai_gender", "male"], ["ai_pronouns", ""]]);
  await act(async () => renderer.update(React.createElement(Fields, { settings: { ai_gender: "other" }, onChange: () => {} })));
  assert.ok(renderer.root.findByProps({ "aria-label": "自定义性别名称" }));
  await act(async () => renderer.update(React.createElement(Fields, { settings: { ai_gender: "other", companion_gender_available: false }, onChange: () => {} })));
  for (const control of renderer.root.findAllByType("input")) assert.equal(control.props.disabled, true);
  assert.equal(renderer.root.findByType("select").props.disabled, true);
  assert.match(JSON.stringify(renderer.toJSON()), /其他设置可正常自动保存/);
  await act(async () => renderer.unmount());
  for (const pronoun of ["他", "她", "TA"]) {
    await act(async () => { renderer = TestRenderer.create(React.createElement(ThinkingPanel, { message: { role: "assistant", content: "fixture", isStreaming: false }, aiPronoun: pronoun, onRequestInnerMonologue: () => {} })); });
    assert.ok(JSON.stringify(renderer.toJSON()).includes(`听听${pronoun}此刻的心声`));
    await act(async () => renderer.unmount());
  }
  console.log("Gender selection, custom pronouns, legacy preservation and rendered monologue labels passed");
} finally { await vite.close(); }
