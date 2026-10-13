const assert = require("node:assert/strict");
const { resolveGenerationPrompt, MAIN_CHAT_PROMPT_ARCHITECTURE, generateReply, generateReplyStream } = require("../services/ai-service");
const { applyGenerationBudget, assertSerializedRequestBudget } = require("../services/generation-budget");
const { publicChatErrorMessage } = require("../services/chat-stream-contract");

async function main() {
    const settings = { model: "gpt-4", provider: "custom", prompt_mode: "unified", unified_system_prompt: "  Keep my exact settings.\n", user_details: " user details\n", max_tokens: 512 };
    const messages = Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `${index}: ${"历史记录".repeat(60)}` }));
    messages.push({ role: "user", content: "latest request" });
    const knowledge = [{ name: "notes.md", content: "知识".repeat(900) }];
    const input = { settings, messages, knowledge, memories: [], runtimeContext: "current runtime", turnContext: "current turn", promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE };
    const original = JSON.stringify(input);
    const plan = resolveGenerationPrompt(input);
    assert.ok(plan.messages.length < messages.length);
    assert.deepEqual(plan.messages.at(-1), messages.at(-1));
    assert.equal(plan.messages[0].role, "user");
    assert.ok(plan.systemInstructions[0].includes(settings.unified_system_prompt));
    assert.ok(plan.systemInstructions[0].includes(knowledge[0].content));
    const dynamic = plan.receipt.delivery.dynamic_context;
    assert.ok(plan.messages[dynamic.message_index].content.includes("current runtime"));
    assert.equal(dynamic.message_index, plan.messages.length - 2);
    const firstCount = plan.messages.length;
    applyGenerationBudget(plan, { settings, tools: [{ name: "memory", description: "工具描述".repeat(300), input_schema: { type: "object" } }] });
    assert.ok(plan.messages.length < firstCount, "tool definitions must consume the final budget");
    assert.ok(plan.messages[dynamic.message_index].content.includes("current turn"));
    assert.equal(plan.receipt.delivery.history.latest_user_message_index, plan.messages.length - 1);
    assert.equal(JSON.stringify(input), original, "planning must not alter saved input objects");

    assert.throws(() => resolveGenerationPrompt({ ...input, knowledge: [{ name: "large.md", content: "知识".repeat(9000) }] }), { code: "context_budget_exceeded" });
    const body = { model: "gpt-4", max_tokens: 512, messages: [{ role: "tool", content: "tool result ".repeat(5000) }] };
    assert.throws(() => assertSerializedRequestBudget("https://fixture.test/v1", { body: JSON.stringify(body) }), { code: "context_budget_exceeded" });
    const imageBody = { model: "gpt-4o", max_tokens: 512, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64," + "A".repeat(100000) } }] }] };
    assert.doesNotThrow(() => assertSerializedRequestBudget("https://fixture.test/v1", { body: JSON.stringify(imageBody) }));
    assert.doesNotThrow(() => resolveGenerationPrompt({ settings: { ...settings, model: "gpt-4o" }, messages: imageBody.messages }));
    assert.throws(() => assertSerializedRequestBudget("https://fixture.test/models/gpt-4:generateContent", { body: JSON.stringify({ contents: [{ parts: [{ text: "very large ".repeat(6000) }] }] }) }), { code: "context_budget_exceeded" });
    const originalFetch = global.fetch;
    let networkCalls = 0;
    global.fetch = async () => { networkCalls++; throw new Error("must not send"); };
    try {
        for (const generate of [generateReply, generateReplyStream]) {
            await assert.rejects(generate({ ...input, settings: { ...settings, runtime_api_key: "test-key", api_url: "https://fixture.test/v1" }, knowledge: [{ content: "知识".repeat(9000) }], onEvent() {} }), { code: "context_budget_exceeded" });
        }
        assert.equal(networkCalls, 0);
        networkCalls = 0;
        let toolWrites = 0;
        global.fetch = async () => {
            networkCalls++;
            return Response.json({ choices: [{ message: { content: "", tool_calls: [{ id: "write-1", type: "function", function: { name: "remember", arguments: "{}" } }] }, finish_reason: "tool_calls" }] });
        };
        await assert.rejects(generateReply({
            settings: { ...settings, runtime_api_key: "test-key", api_url: "https://fixture.test/v1" },
            messages: [{ role: "user", content: "remember fixture" }],
            tools: [{ name: "remember", input_schema: { type: "object" } }],
            executeTool: async () => { toolWrites++; return { content: "oversize result ".repeat(7000) }; }
        }), { code: "context_budget_exceeded" });
        assert.equal(toolWrites, 1);
        assert.equal(networkCalls, 1, "oversize tool follow-up is rejected before another provider request");
    } finally { global.fetch = originalFetch; }
    assert.ok(!publicChatErrorMessage({ code: "context_budget_exceeded", message: "private upstream contents" }).includes("private upstream"));
    console.log("Final prompt budget, protected dynamic input, tool overhead, no data mutation and preflight tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
