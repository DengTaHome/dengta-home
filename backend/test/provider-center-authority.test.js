const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    buildSettingsChanges,
    providerCenterBaseSettings,
    stripLegacyProviderFields
} = require("../services/settings-store");
const {
    unconfiguredRuntimeSettings
} = require("../services/ai-provider-center");

const legacyStored = {
    id: "settings-id",
    provider: "openai-responses",
    api_url: "https://legacy.example/v1",
    model: "legacy-model",
    reasoning_effort: "xhigh",
    ai_name: "Companion",
    prompt_mode: "unified",
    unified_system_prompt: "",
    user_details: "",
    temperature: 0.7,
    context_turns: 20,
    max_tokens: 2048,
    compression_threshold: 12000,
    compression_keep: 20,
    timezone: "Asia/Shanghai",
    push_enabled: false,
    max_push_per_day: 7
};

assert.deepEqual(
    stripLegacyProviderFields({
        provider: "anthropic",
        api_url: "https://ignored.example/v1",
        model: "ignored-model",
        reasoning_effort: "max",
        ai_name: "Updated companion"
    }),
    { ai_name: "Updated companion" },
    "legacy settings endpoints must never accept chat-provider routing fields"
);

assert.deepEqual(
    providerCenterBaseSettings(legacyStored),
    {
        ...legacyStored,
        provider: "custom",
        api_url: "",
        model: "",
        reasoning_effort: ""
    },
    "legacy database columns must not become runtime provider settings"
);

const unconfigured = unconfiguredRuntimeSettings(
    providerCenterBaseSettings(legacyStored)
);
assert.equal(unconfigured.provider, "custom");
assert.equal(unconfigured.api_url, "");
assert.equal(unconfigured.model, "");
assert.equal(unconfigured.runtime_api_key, "");
assert.equal(unconfigured.provider_profile_id, null);

const changes = buildSettingsChanges(legacyStored, {
    ai_name: "Updated companion",
    provider: "anthropic",
    api_url: "https://ignored.example/v1",
    model: "ignored-model",
    reasoning_effort: "max"
});
assert.equal(changes.ai_name, "Updated companion");
assert.equal(changes.provider, legacyStored.provider);
assert.equal(changes.api_url, legacyStored.api_url);
assert.equal(changes.model, legacyStored.model);
assert.equal(changes.reasoning_effort, legacyStored.reasoning_effort);

const root = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const settingsSource = fs.readFileSync(
    path.join(root, "services", "settings-store.js"),
    "utf8"
);
const retiredPolicyPath = path.join(
    root,
    "services",
    "provider-settings-policy.js"
);

assert.equal(
    fs.existsSync(retiredPolicyPath),
    false,
    "the deployment-wide provider lock module must stay retired"
);
assert.doesNotMatch(serverSource, /AI_PROVIDER_PIN|AI_API_URL_PIN/);
assert.doesNotMatch(serverSource, /provider_settings_locked|provider_pins_valid/);
assert.doesNotMatch(settingsSource, /process\.env|CUSTOM_API_KEY/);
assert.match(
    serverSource,
    /\/health is public[\s\S]*?profiles: 0,[\s\S]*?enabled_profiles: 0,[\s\S]*?active_profile: null/,
    "public health must not expose or select a tenant provider profile"
);
assert.match(serverSource, /aiProviderCenter\s*\.forDatabase\(database\)/);
assert.match(
    serverSource,
    /resolveDefaultSettings\(providerCenterBaseSettings\(stored\)\)/
);

console.log("provider center authority tests passed");
