const assert = require("node:assert/strict");
const {
    buildConversationContinuityContext,
    buildMainChatPromptPlan,
    resolveGenerationPrompt,
    generateReply,
    generateReplyStream
} = require("../services/ai-service");
const { applyGenerationBudget } = require("../services/generation-budget");

const settings = {
    model: "gpt-4", max_tokens: 512, prompt_mode: "unified",
    user_details: "  fixture details\n", unified_system_prompt: "  fixture persona\n"
};
const messages = Array.from({ length: 80 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `fixture-${index}: ${"对话正文".repeat(80)}`,
    created_at: new Date(Date.UTC(2026, 8, 27, 0, index)).toISOString()
}));
messages.push({ role: "user", content: "继续讨论", created_at: "2026-09-27T02:00:00Z" });
const input = {
    settings, messages, memories: [{ summary: "fixture memory", locked: true }],
    knowledge: [{ name: "fixture.md", content: "fixture knowledge" }],
    runtimeContext: "fixture runtime", turnContext: "fixture turn", promptArchitecture: "main-chat"
};

function assertFinalTimeline(plan) {
    const dynamic = plan.receipt.delivery.dynamic_context;
    const history = plan.messages.filter((_, index) => index !== dynamic.message_index);
    if (dynamic.conversation_continuity_applied) {
        const text = plan.messages[dynamic.message_index].content;
        const offsets = [...text.matchAll(/原始对话倒数第 (\d+) 条/g)].map((match) => Number(match[1]));
        assert.ok(offsets.length >= 2 && offsets.length <= 12);
        assert.ok(offsets.every((offset) => offset <= history.length));
        for (const message of history) assert.ok(!text.includes(message.content));
        assert.equal(dynamic.chars, Array.from(text).length);
    }
    assert.equal(plan.receipt.delivery.history.context_budget.final_message_count, plan.messages.length);
    assert.equal(plan.receipt.delivery.history.latest_user_message_index, plan.messages.length - 1);
    assert.deepEqual(plan.messages.at(-1), messages.at(-1));
    return history;
}

async function main() {
    const original = JSON.stringify(input);
    const plan = resolveGenerationPrompt(input);
    const retained = assertFinalTimeline(plan);
    assert.ok(retained.length < messages.length && retained.length > 1);
    assert.deepEqual(retained, messages.slice(-retained.length), "retained history is an unchanged suffix");
    assert.ok(plan.systemInstructions[0].includes(settings.user_details));
    assert.ok(plan.systemInstructions[0].includes(settings.unified_system_prompt));
    assert.ok(plan.systemInstructions[0].includes(input.memories[0].summary));
    assert.ok(plan.systemInstructions[0].includes(input.knowledge[0].content));
    assert.ok(!JSON.stringify(plan.receipt).includes("fixture"), "receipt contains no private bodies");
    assert.ok(!JSON.stringify(plan).includes("refreshBudgetContext"), "planning hook is not serialized");

    applyGenerationBudget(plan, { settings, tools: [{ name: "fixture", description: "工具定义".repeat(500) }] });
    assert.ok(assertFinalTimeline(plan).length < retained.length, "tool budget refreshes timeline after further trimming");
    const reduced = JSON.stringify(plan);
    applyGenerationBudget(plan, { settings, tools: [{ name: "fixture", description: "工具定义".repeat(500) }] });
    assert.equal(JSON.stringify(plan), reduced, "repeated budgeting is stable");
    assert.equal(JSON.stringify(input), original, "all input objects remain unchanged");

    // When the last prior turn no longer fits, remove its time index too.
    const large = [{ role: "assistant", content: "旧消息".repeat(3000), created_at: messages[0].created_at }, messages.at(-1)];
    const onlyLatest = resolveGenerationPrompt({ ...input, messages: large, runtimeContext: "", turnContext: "" });
    assert.equal(onlyLatest.messages.length, 1);
    assert.equal(onlyLatest.receipt.delivery.dynamic_context.applied, false);
    assert.equal(onlyLatest.receipt.delivery.dynamic_context.message_index, null);
    assert.equal(onlyLatest.receipt.delivery.history.context_budget.dropped_older, 1);
    const withRuntime = resolveGenerationPrompt({ ...input, messages: large });
    assert.equal(withRuntime.messages.length, 2);
    assert.equal(withRuntime.receipt.delivery.dynamic_context.conversation_continuity_applied, false);
    assert.ok(withRuntime.messages[0].content.includes(input.runtimeContext));
    assert.ok(withRuntime.messages[0].content.includes(input.turnContext));
    assertFinalTimeline(withRuntime);
    assertFinalTimeline(buildMainChatPromptPlan(input));
    const startsWithAssistant = [messages[1], messages.at(-1)];
    const intact = resolveGenerationPrompt({ ...input, messages: startsWithAssistant });
    assert.deepEqual(intact.messages.filter((_, i) => i !== intact.receipt.delivery.dynamic_context.message_index), startsWithAssistant,
        "do not drop an existing initial assistant when no history was trimmed");
    const nearLimit = { ...input, messages: [messages[0], { ...messages.at(-1), content: "长".repeat(4850) }], runtimeContext: "", turnContext: "" };
    const withoutTime = resolveGenerationPrompt({ ...nearLimit, messages: nearLimit.messages.map(({ role, content }) => ({ role, content })) });
    const withTime = resolveGenerationPrompt(nearLimit);
    assert.deepEqual(withTime.messages, withoutTime.messages.map((message) => nearLimit.messages.find((source) => source.content === message.content)),
        "optional time index degrades when only current input fits");
    assert.equal(withTime.receipt.delivery.dynamic_context.applied, false);

    const timeline = buildConversationContinuityContext({ messages });
    assert.equal([...timeline.matchAll(/原始对话倒数第/g)].length, 12);
    assert.ok(!timeline.includes("对话正文"));
    const invalidDates = [null, undefined, "", "not-a-date"].map((created_at) => ({ role: "user", content: "fixture", created_at }));
    assert.equal(buildConversationContinuityContext({ messages: invalidDates }), "");
    assert.equal(buildConversationContinuityContext({ messages: [] }), "");
    const sparse = [messages[0], ...invalidDates, { role: "tool", content: "fixture", created_at: messages[1].created_at }, messages.at(-1)];
    const sparseTimeline = buildConversationContinuityContext({ messages: sparse, timezone: "invalid/timezone" });
    assert.match(sparseTimeline, /倒数第 6 条/);
    assert.match(sparseTimeline, /倒数第 1 条/);
    assert.doesNotMatch(sparseTimeline, /倒数第 2 条/);
    const multimodal = [{ role: "user", content: [{ type: "text", text: "fixture multimodal" }], created_at: messages[0].created_at }, messages.at(-1)];
    assert.doesNotMatch(buildConversationContinuityContext({ messages: multimodal }), /object Object|fixture multimodal/);

    const oldFetch = global.fetch;
    let calls = 0;
    try {
        for (const provider of ["custom", "openai-responses", "anthropic", "gemini"]) {
            for (const streaming of [false, true]) {
                global.fetch = async (_url, options) => {
                    calls++;
                    const body = options.body;
                    assert.ok(body.includes("fixture persona") && body.includes("fixture memory"));
                    assert.equal(body.split("继续讨论").length - 1, 1, "latest input is delivered once");
                    assert.ok(body.includes("原始对话倒数第"));
                    assert.ok(!body.includes("refreshBudgetContext"));
                    assert.ok(!body.includes("fixture-0:"), "dropped history cannot leak back through the timeline");
                    if (!streaming) return Response.json(provider === "gemini"
                        ? { candidates: [{ content: { parts: [{ text: "fixture reply" }] }, finishReason: "STOP" }] }
                        : provider === "anthropic" ? { content: [{ type: "text", text: "fixture reply" }], stop_reason: "end_turn" }
                        : provider === "openai-responses" ? { status: "completed", output_text: "fixture reply" }
                        : { choices: [{ message: { content: "fixture reply" }, finish_reason: "stop" }] });
                    const events = provider === "gemini"
                        ? [{ candidates: [{ content: { parts: [{ text: "fixture reply" }] }, finishReason: "STOP" }] }]
                        : provider === "anthropic" ? [{ type: "content_block_delta", delta: { type: "text_delta", text: "fixture reply" } }, { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" }]
                        : provider === "openai-responses" ? [{ type: "response.output_text.delta", delta: "fixture reply" }, { type: "response.completed", response: { status: "completed", output_text: "fixture reply" } }]
                        : [{ choices: [{ delta: { content: "fixture reply" } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }];
                    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
                };
                const generate = streaming ? generateReplyStream : generateReply;
                const reply = await generate({ ...input, settings: { ...settings, provider, api_url: "https://fixture.test/v1", runtime_api_key: "test-key" }, onEvent() {} });
                assert.equal(reply.text, "fixture reply");
            }
        }
        assert.equal(calls, 8);
    } finally { global.fetch = oldFetch; }
    assert.equal(JSON.stringify(input), original);
    console.log("Prompt continuity: bounded time index, final-history synchronization, unchanged source data, 8 mocked transports passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
