import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { backendTestRoot } from "./helpers/backend-test-root.js";
import { createSettingsPayload, normalizeSettingsDraft } from "../src/settings.js";
const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const backendRoot = backendTestRoot({ frontendRoot, requiredFiles: ["package.json", "services/settings-store.js"] });
const requireBackend = createRequire(path.join(backendRoot, "package.json"));
const { DEFAULT_SETTINGS, cleanUnifiedSystemPrompt, cleanUserDetails, updateStoredSettings } = requireBackend("./services/settings-store.js");
test("million-character frontend payload survives actual backend cleaning and settings save unchanged", async () => {
  const longText = "  " + "中文👩🏽‍💻 e\u0301\r\n".repeat(85000) + "尾部  \n";
  assert.ok(longText.length > 1_000_000);
  const payload = JSON.parse(JSON.stringify(createSettingsPayload(normalizeSettingsDraft({ unified_system_prompt: longText, user_details: longText }))));
  assert.equal(cleanUnifiedSystemPrompt(payload.unified_system_prompt), longText);
  assert.equal(cleanUserDetails(payload.user_details), longText);
  let stored = { ...DEFAULT_SETTINGS, id: "synthetic-settings-row" }, writes = 0;
  const database = { from(table) {
    assert.equal(table, "settings");
    return {
      select() { return this; }, order() { return this; }, limit() { return this; },
      async maybeSingle() { return { data: stored, error: null }; },
      update(changes) { writes++; stored = { ...stored, ...changes }; return this; },
      eq(column, id) { assert.equal(column, "id"); assert.equal(id, "synthetic-settings-row"); return this; },
      async single() { return { data: stored, error: null }; },
    };
  } };
  const saved = normalizeSettingsDraft(await updateStoredSettings(database, payload));
  assert.equal(writes, 1); assert.equal(saved.unified_system_prompt, longText); assert.equal(saved.user_details, longText);
});
