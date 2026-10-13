import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { createSettingsPayload, normalizeSettingsDraft } from "../src/settings.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
let view;
try {
  const { default: ChatContextSettings } = await server.ssrLoadModule("/src/ChatContextSettings.jsx");
  let settings = normalizeSettingsDraft({ context_turns: 50, compression_threshold: 8000,
    unified_system_prompt: "  原始人设\n", user_details: "\n原始详情 " });
  const original = { ...settings };
  const onChange = (field, value) => { settings = { ...settings, [field]: value }; };
  await act(async () => { view = TestRenderer.create(React.createElement(ChatContextSettings, { settings, onChange })); });
  assert.match(JSON.stringify(view.toJSON()), /50/);
  assert.equal(view.root.findByType("input").props.max, "1000000");
  await act(async () => { view.root.findByType("button").props.onClick(); });
  assert.equal(settings.context_turns, 0);
  assert.equal(settings.compression_threshold, 0);
  assert.equal(settings.unified_system_prompt, original.unified_system_prompt);
  assert.equal(settings.user_details, original.user_details);
  await act(async () => { view.update(React.createElement(ChatContextSettings, { settings, onChange })); });
  assert.equal(view.root.findByType("select").props.value, "auto");
  assert.equal(view.root.findAllByType("input").length, 0);
  await act(async () => { view.root.findByType("select").props.onChange({ target: { value: "custom" } }); });
  assert.equal(settings.context_turns, 10000);
  const payload = createSettingsPayload(settings);
  assert.equal(payload.context_turns, 10000);
  assert.equal(payload.compression_threshold, 0);
  assert.equal(payload.unified_system_prompt, original.unified_system_prompt);
  assert.equal(normalizeSettingsDraft({}).context_turns, 0);
  assert.equal(normalizeSettingsDraft({ context_turns: 50 }).context_turns, 50);
} finally {
  if (view) await act(async () => view.unmount());
  await server.close();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
console.log("large chat context selection, activation, save payload and personalization tests passed");
