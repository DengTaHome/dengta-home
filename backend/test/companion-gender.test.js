const assert = require("node:assert/strict");
const { buildGenderChanges, companionGenderInstruction, GENDERS } = require("../services/companion-gender");
const { buildSettingsChanges, DEFAULT_SETTINGS } = require("../services/settings-store");
const { resolveGenerationPrompt } = require("../services/ai-service");
const { resolveContextWindow } = require("../services/context-budget");

const original = { ...DEFAULT_SETTINGS, system_prompt: "  old\n", additional_prompt: "\nextra ", personality: " gentle  ", unified_system_prompt: " exact instruction \n", user_details: "\n exact details " };
for (const [gender, { pronoun }] of Object.entries(GENDERS)) {
    const changed = buildSettingsChanges(original, { ai_gender: gender });
    assert.equal(changed.ai_gender, gender);
    for (const field of ["system_prompt", "additional_prompt", "personality", "unified_system_prompt", "user_details"]) {
        assert.equal(changed[field], original[field], `preserve ${field}`);
    }
    for (const arch of ["main-chat", "companion-interaction", "moment-module", "moment-post-module", "diary-module", "profile-refresh-module", "proactive-message-module", "visible-inner-monologue"]) {
        const plan = resolveGenerationPrompt({ settings: changed, messages: [{ role: "user", content: "hello" }], memories: [], promptArchitecture: arch });
        if (gender !== "unspecified") assert.ok(plan.systemInstructions.at(-1).includes(`"third_person":"${pronoun}"`), `${gender}/${arch}`);
        assert.ok(plan.systemInstructions[0].includes(original.unified_system_prompt));
    }
}
assert.match(companionGenderInstruction({ ai_gender: "non_binary", ai_pronouns: "they" }), /"third_person":"they"/);
assert.equal(companionGenderInstruction({}), "");
assert.deepEqual(buildGenderChanges({ ai_gender: "female", ai_pronouns: "她" }, { ai_gender: "male" }), { ai_gender: "male", ai_pronouns: "" });
assert.throws(() => buildGenderChanges({}, { ai_gender: "__proto__" }), { code: "invalid_companion_gender" });
assert.throws(() => buildGenderChanges({}, { ai_pronouns: "x\nignored" }), { code: "invalid_companion_gender" });
assert.throws(() => buildGenderChanges({}, { ai_gender_label: "x".repeat(61) }), { code: "invalid_companion_gender" });
assert.equal(resolveContextWindow("vendor/gpt-4-32k-snapshot"), 32768);
assert.equal(resolveContextWindow("vendor/o1-mini-snapshot"), 128000);
const plan = resolveGenerationPrompt({ settings: original, messages: [], memories: [], promptArchitecture: "main-chat" });
assert.equal(plan.receipt.delivery.persistent_instructions.custom_instructions.block_index, 0);
assert.equal(plan.systemInstructions.filter((text) => text.includes(original.unified_system_prompt)).length, 1);
console.log("Companion gender, prompt preservation and model matching tests passed");

async function verifyMigrationBoundary() {
    const { updateStoredSettings } = require("../services/settings-store");
    let writes = 0, lastChanges;
    const current = { ...original, id: "fixture" };
    const query = { select() { return this; }, order() { return this; }, limit() { return this; },
        maybeSingle: async () => ({ data: current }),
        update(changes) { writes++; lastChanges=changes; return this; }, eq() { return this; }, single: async () => ({ data: current }) };
    const database = { from: () => query };
    await updateStoredSettings(database, { ai_gender: "female" });
    assert.equal(writes, 1, "deferred gender rollout must not block existing settings");
    assert.equal(Object.hasOwn(lastChanges,'ai_gender'),false);
    assert.equal(lastChanges.unified_system_prompt,current.unified_system_prompt);
    await updateStoredSettings(database, { ai_name: "fixture" });
    assert.equal(writes, 2, "other settings remain available before migration");
    Object.assign(current, { ai_gender: "unspecified", ai_pronouns: "", ai_gender_label: "" });
    await updateStoredSettings(database, { ai_gender: "female" });
    assert.equal(writes, 3);
    assert.equal(lastChanges.ai_gender,'female');
    console.log("Gender rollout boundary: unsupported fields deferred, existing settings and migrated schema passed");
}
verifyMigrationBoundary().catch(error => { console.error(error); process.exitCode = 1; });
