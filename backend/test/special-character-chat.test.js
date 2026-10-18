const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { normalizeChatBody } = require("../services/chat-request");
const { generateReply, generateReplyStream, MAIN_CHAT_PROMPT_ARCHITECTURE } = require("../services/ai-service");
const { publicChatErrorCode, streamFailure } = require("../services/chat-stream-contract");
const { diagnosticRecord } = require("../services/diagnostic-errors");

const cases = ["~", "～", "〜", "\\~", "在呢乖乖~", "在呢乖乖～", "在呢乖乖\\~", "在呢乖乖", "🙂👩🏽‍💻 & < > \" ' \\", "一行\n第二行~"];
function providerFor(url) { return url.includes(":generateContent") || url.includes(":streamGenerateContent") ? "gemini" : url.endsWith("/messages") ? "anthropic" : url.endsWith("/chat/completions") ? "custom" : "openai-responses"; }
function contentText(value) { return typeof value === "string" ? value : (Array.isArray(value) ? value.map(item => item.text || "").join("") : ""); }
function userText(provider, body) {
    if (provider === "gemini") return contentText(body.contents.filter(item => item.role === "user").at(-1).parts);
    return contentText((provider === "openai-responses" ? body.input : body.messages).filter(item => item.role === "user").at(-1).content);
}
test("special characters cross normalization and all four real adapters unchanged, in JSON and character streams", { timeout: 30000 }, async t => {
    const received = [], fixtureErrors = [];
    const server = http.createServer(async (request, response) => {
        try {
            let raw = ""; for await (const chunk of request) raw += chunk;
            const body = JSON.parse(raw), provider = providerFor(request.url), input = userText(provider, body);
            received.push({ provider, input });
            const streaming = body.stream === true || request.url.includes(":streamGenerateContent");
            const model = body.model || decodeURIComponent(request.url.match(/\/models\/([^:]+)/)[1]);
            if (model.includes("invalid")) { response.writeHead(400, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { code: "invalid_request_error", message: "FICTIONAL_PRIVATE_CAUSE" } })); return; }
            const value = model.includes("empty") ? "" : `[monologue]这是测试角色公开的感受。[/monologue]${input}`;
            response.writeHead(200, { "Content-Type": streaming ? "text/event-stream" : "application/json" });
            if (!streaming) {
                response.end(JSON.stringify(provider === "gemini" ? { candidates: [{ content: { parts: [{ text: value }] } }] } : provider === "anthropic" ? { content: [{ type: "text", text: value }] } : provider === "custom" ? { choices: [{ message: { content: value } }] } : { output_text: value, status: "completed" })); return;
            }
            const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
            for (const character of value) event(provider === "gemini" ? { candidates: [{ content: { parts: [{ text: character }] } }] } : provider === "anthropic" ? { type: "content_block_delta", delta: { type: "text_delta", text: character } } : provider === "custom" ? { choices: [{ delta: { content: character } }] } : { type: "response.output_text.delta", delta: character });
            if (provider === "gemini") event({ candidates: [{ finishReason: "STOP" }] });
            else if (provider === "anthropic") { event({ type: "message_delta", delta: { stop_reason: "end_turn" } }); event({ type: "message_stop" }); }
            else if (provider === "custom") event({ choices: [{ delta: {}, finish_reason: "stop" }] });
            else event({ type: "response.completed", response: { status: "completed" } });
            response.end("data: [DONE]\n\n");
        } catch (error) { fixtureErrors.push(error); response.writeHead(500); response.end(); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const run = async (provider, value, streaming, model = "fixture-symbol") => {
        const normalized = normalizeChatBody({ message: value }); assert.equal(normalized.message, value);
        const events = [], input = { settings: { provider, api_url: apiUrl, runtime_api_key: "test-only", model, max_tokens: 1024 },
            messages: [{ role: "user", content: normalized.message }], promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE, visibleMonologue: true };
        const result = streaming ? await generateReplyStream({ ...input, onEvent: event => events.push(event) }) : await generateReply(input);
        return { result, events };
    };
    try {
        for (const provider of ["custom", "openai-responses", "anthropic", "gemini"]) {
            await t.test(provider, async () => {
                for (const value of cases) for (const streaming of [false, true]) {
                    const { result, events } = await run(provider, value, streaming);
                    assert.equal(received.at(-1).input, value); assert.equal(result.text, value);
                    if (streaming) assert.equal(events.filter(event => event.type === "text").map(event => event.content).join(""), value);
                }
            });
            await t.test(`${provider} empty and HTTP 400 stay distinct from a local symbol rejection`, async () => {
                for (const streaming of [false, true]) {
                    await assert.rejects(run(provider, "~", streaming, "fixture-empty"), error => publicChatErrorCode(error) === "provider_empty_response");
                    await assert.rejects(run(provider, "~", streaming, "fixture-invalid"), error => {
                        assert.equal(publicChatErrorCode(error), "provider_request_invalid");
                        const receipt = streamFailure(error, { userMessageCommitted: true });
                        const log = diagnosticRecord({ originalUrl: "/chat/stream", route: { path: "/chat/stream" }, method: "POST", body: {} }, error);
                        assert.equal(receipt.upstream_status, 400); assert.equal(receipt.error_source, "upstream_provider_or_gateway");
                        assert.doesNotMatch(JSON.stringify({ receipt, log }), /FICTIONAL_PRIVATE_CAUSE/); return true;
                    });
                }
            });
        }
        assert.deepEqual(fixtureErrors, []);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
