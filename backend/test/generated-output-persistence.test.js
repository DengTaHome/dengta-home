const assert = require("node:assert/strict");
const { generateReply, generateReplyStream, generateMemorySummary, generateMomentReaction } = require("../services/ai-service");
const { streamFailure } = require("../services/chat-stream-contract");

async function main() {
    const originalFetch = global.fetch;
    const previous = process.env.PROVIDER_OUTPUT_GUARD_DISABLED;
    delete process.env.PROVIDER_OUTPUT_GUARD_DISABLED;
    const refusal = "I'm sorry, but I cannot fulfill this request due to content policy.";
    const input = { settings: { provider: "custom", api_url: "https://fixture.test/v1", runtime_api_key: "test-key", model: "mock-model", max_tokens: 256 }, messages: [{ role: "user", content: "fixture" }], memories: [] };
    try {
        for (const provider of ["gemini", "anthropic", "openai-responses"]) {
            global.fetch = async () => Response.json(provider === "gemini"
                ? { candidates: [{ content: { parts: [{ text: refusal }] }, finishReason: "STOP" }] }
                : provider === "anthropic"
                    ? { content: [{ type: "text", text: refusal }], stop_reason: "end_turn" }
                    : { status: "completed", output_text: refusal });
            await assert.rejects(generateReply({ ...input, settings: { ...input.settings, provider } }), { code: "provider_boundary_residue" });
            const events = provider === "gemini"
                ? [{ candidates: [{ content: { parts: [{ text: refusal }] }, finishReason: "STOP" }] }]
                : provider === "anthropic"
                    ? [{ type: "content_block_delta", delta: { type: "text_delta", text: refusal } }, { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" }]
                    : [{ type: "response.output_text.delta", delta: refusal }, { type: "response.completed", response: { status: "completed", output_text: refusal } }];
            global.fetch = async () => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
            await assert.rejects(generateReplyStream({ ...input, settings: { ...input.settings, provider }, onEvent() {} }), { code: "provider_boundary_residue" });
        }
        for (const text of [refusal, '{"error":{"code":"upstream_error","message":"private diagnostic"}}']) {
            global.fetch = async () => Response.json({ choices: [{ message: { content: text }, finish_reason: "stop" }] });
            const summary = await generateMemorySummary(input);
            assert.equal(summary.text, "");
            assert.equal(summary.skipped, true, "refusal/error document must not become a memory summary");
            await assert.rejects(generateMomentReaction({ settings: input.settings, prompt: "fixture" }), (error) => ["provider_boundary_residue", "provider_error_document"].includes(error.code));
            let persisted = 0;
            await assert.rejects(generateReply(input).then(() => { persisted++; }), (error) => ["provider_boundary_residue", "provider_error_document"].includes(error.code));
            assert.equal(persisted, 0);
            global.fetch = async () => new Response(text.match(/.{1,7}/g).map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join("") + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
            const events = [];
            await assert.rejects(generateReplyStream({ ...input, onEvent: (event) => events.push(event) }).then(() => { persisted++; }), (error) => {
                const failure = streamFailure(error, { userMessageCommitted: true });
                assert.ok(!JSON.stringify(failure).includes(refusal));
                assert.ok(!JSON.stringify(failure).includes("private diagnostic"));
                return ["provider_boundary_residue", "provider_error_document"].includes(error.code);
            });
            assert.equal(persisted, 0);
            assert.ok(events.some((event) => event.type === "text"), "normal streaming need not buffer until completion");
        }
        for (const text of ["他拒绝了邀请，然后继续整理房间。", "我不能继续假装冷漠，随后把心意说了出来。", '示例代码：{"error":"example"}']) {
            global.fetch = async () => Response.json({ choices: [{ message: { content: text }, finish_reason: "stop" }] });
            assert.equal((await generateReply(input)).text, text);
        }
        let executed = 0;
        global.fetch = async () => Response.json({ choices: [{ message: { content: refusal, tool_calls: [{ id: "tool-1", type: "function", function: { name: "remember", arguments: "{}" } }] }, finish_reason: "tool_calls" }] });
        await assert.rejects(generateReply({ ...input, tools: [{ name: "remember", input_schema: { type: "object" } }], executeTool: async () => { executed++; } }), { code: "provider_boundary_residue" });
        assert.equal(executed, 0, "refusal output must not trigger accompanying memory writes");
        let streamController;
        let firstText;
        const firstTextReceived = new Promise((resolve) => { firstText = resolve; });
        const encoder = new TextEncoder();
        global.fetch = async () => new Response(new ReadableStream({ start(controller) {
            streamController = controller;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "即时显示" } }] })}\n\n`));
        } }), { headers: { "content-type": "text/event-stream" } });
        let completed = false;
        const pending = generateReplyStream({ ...input, onEvent(event) { if (event.type === "text") firstText(); } }).then((result) => { completed = true; return result; });
        let timer;
        try {
            await Promise.race([firstTextReceived, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("first text was buffered")), 1000); })]);
            assert.equal(completed, false, "text must be visible before upstream completion");
        } finally {
            clearTimeout(timer);
            streamController.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
            streamController.close();
            await pending;
        }
        console.log("Default buffered/unbuffered output rejects residue before successful persistence; ordinary dialogue and tool guards passed");
    } finally {
        global.fetch = originalFetch;
        if (previous === undefined) delete process.env.PROVIDER_OUTPUT_GUARD_DISABLED;
        else process.env.PROVIDER_OUTPUT_GUARD_DISABLED = previous;
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
