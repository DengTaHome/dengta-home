const assert = require("node:assert/strict");
const {
    buildUserAgentsMd, buildUserAgentsMdPlan, resolveGenerationPrompt,
    buildPromptReceipt, generateReply
} = require("../services/ai-service");

const base = {
    model: "gpt-4o", max_tokens: 512,
    user_details: "  DETAILS-FIXTURE\n",
    unified_system_prompt: "  UNIFIED-FIXTURE\n",
    system_prompt: "  SYSTEM-FIXTURE\n",
    additional_prompt: "\nADDITIONAL-FIXTURE  ", personality: "PERSONA-FIXTURE"
};
const architectures = ["main-chat", "companion-interaction", "intimate-duel", "moment-module", "moment-post-module", "diary-module", "profile-refresh-module", "proactive-message-module", "visible-inner-monologue", "unknown-fixture"];
const messages = [{ role: "user", content: "消息原文" }];
const occurrences = (text, fragment) => text.split(fragment).length - 1;

async function main() {
    for (const mode of ["unified", " UNIFIED ", "legacy", " LEGACY ", undefined, "unknown"]) {
        for (const unified of [base.unified_system_prompt, "", "  \n\t"]) {
            const settings = { ...base, prompt_mode: mode, unified_system_prompt: unified };
            const original = JSON.stringify(settings);
            const useUnified = String(mode || "").trim().toLowerCase() === "unified" && Boolean(unified.trim());
            const agents = buildUserAgentsMdPlan({ settings });
            assert.equal(agents.content, buildUserAgentsMd({ settings }));
            assert.equal(agents.sources.unified_system_prompt, useUnified);
            assert.deepEqual(agents.sources.legacy_fields, useUnified ? [] : ["system_prompt", "additional_prompt", "personality"]);
            for (const promptArchitecture of architectures) {
                const plan = resolveGenerationPrompt({ settings, messages, memories: [], promptArchitecture });
                const text = plan.systemInstructions.join("\n\n");
                assert.equal(occurrences(text, base.user_details), 1, `${promptArchitecture}: details once`);
                for (const field of ["system_prompt", "additional_prompt", "personality"]) {
                    assert.equal(occurrences(text, base[field]), useUnified ? 0 : 1, `${promptArchitecture}: ${field}`);
                }
                assert.equal(occurrences(text, base.unified_system_prompt), useUnified ? 1 : 0);
                assert.ok(plan.systemInstructions[0].startsWith('<file path="agents.md">'));
                if (promptArchitecture === "main-chat") {
                    assert.equal(plan.receipt.unified_system_prompt_applied, useUnified);
                }
            }
            assert.equal(JSON.stringify(settings), original);
        }
    }

    const memories = Array.from({ length: 15 }, (_, index) => ({ summary: `MEMORY-${index}-END`, locked: index === 14 }));
    memories[14].summary = "😀".repeat(2502);
    memories[2].summary = "fixture secret: sk-fixture1234567890";
    const input = { settings: { ...base, prompt_mode: "unified" }, messages, memories, promptArchitecture: "main-chat" };
    const original = JSON.stringify(input);
    const agents = buildUserAgentsMdPlan(input);
    const expectedTexts = [memories[14].summary.slice(0, 5000) + "…(截断)", ...memories.slice(0, 11).map((m) => m.summary.replace("sk-fixture1234567890", "[已隐藏密钥]"))];
    assert.equal(agents.memory.count, 12);
    assert.equal(agents.memory.provided_count, 15);
    assert.equal(agents.memory.omitted_count, 3);
    assert.equal(agents.memory.truncated_count, 1);
    assert.equal(agents.memory.core_count, 1);
    assert.equal(agents.memory.chars, Array.from(expectedTexts.join("\n\n")).length);
    for (const text of expectedTexts) assert.ok(agents.content.includes(text));
    assert.ok(!agents.content.includes("MEMORY-11-END"));
    const plan = resolveGenerationPrompt(input);
    assert.equal(plan.receipt.delivery.stable_memory.count, 12);
    for (const provider of ["custom", "openai-responses", "anthropic", "gemini"]) {
        const receipt = buildPromptReceipt(input.settings, { provider, systemInstructions: plan.systemInstructions, messages: plan.messages, promptPlanReceipt: plan.receipt });
        assert.equal(receipt.delivery.stable_memory.count, 12);
        assert.equal(receipt.delivery.stable_memory.position, "agents_md");
        assert.equal(receipt.delivery.stable_memory.block_index, 0);
        assert.equal(receipt.delivery.stable_memory.omitted_count, 3);
        assert.equal(receipt.delivery.stable_memory.truncated_count, 1);
        assert.equal(receipt.delivery.stable_memory.chars, agents.memory.chars);
        assert.doesNotMatch(JSON.stringify(receipt), /MEMORY-|DETAILS-FIXTURE|sk-fixture/);
    }
    assert.equal(JSON.stringify(input), original, "never mutate saved data or reorder caller memories");
    const empty = buildUserAgentsMdPlan({ memories: [null, { summary: "" }] });
    assert.equal(empty.content, "");
    assert.equal(empty.memory.count, 0);
    assert.equal(empty.memory.omitted_count, 2);

    const fetch = global.fetch;
    try {
        let calls = 0;
        global.fetch = async (_url, options) => {
            calls++;
            const body = JSON.parse(options.body);
            assert.ok(body.messages[0].content.includes(base.system_prompt));
            assert.equal(occurrences(body.messages[0].content, base.system_prompt), 1);
            assert.ok(!body.messages[0].content.includes(base.unified_system_prompt));
            return Response.json({ choices: [{ message: { content: "fixture reply" }, finish_reason: "stop" }] });
        };
        const result = await generateReply({ ...input, settings: { ...base, prompt_mode: "unified", unified_system_prompt: " \n", provider: "custom", api_url: "https://fixture.test/v1", runtime_api_key: "test-key" } });
        assert.equal(result.text, "fixture reply");
        assert.equal(result.prompt_receipt.delivery.stable_memory.count, 12);
        assert.equal(calls, 1);
    } finally { global.fetch = fetch; }
    console.log("Prompt sources: 180 architecture/mode cases, exact selected-memory receipts, transport and no-mutation checks passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
