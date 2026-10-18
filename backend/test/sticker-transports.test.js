const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const vm = require("node:vm");
const test = require("node:test");
const sticker = require("../services/companion-stickers");
const { listActiveCustomStickers } = require("../services/private-media");
const { createTenantDatabase } = require("../services/request-scope");
const { publicMessage } = require("../services/chat-attachments");
const { streamSuccess } = require("../services/chat-stream-contract");
const { MAIN_CHAT_PROMPT_ARCHITECTURE, generateReply, generateReplyStream } = require("../services/ai-service");

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const companionA = "33333333-3333-4333-8333-333333333333";
const companionB = "44444444-4444-4444-8444-444444444444";
const ownId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreignId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherCompanionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const archivedId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const visibleReply = "这是虚构测试的正文。";
const visibleHeart = "这是虚构角色主动公开的心声。";
const persona = "PERSONA_FIXTURE: preserve this exact personalization text.";
const details = "DETAILS_FIXTURE: preserve this exact user details text.";

function mockAdminDatabase(rows) {
    return { from(table) {
        assert.equal(table, "account_media_assets");
        const filters = [];
        const query = {
            select() { return query; },
            eq(key, value) { filters.push([key, value]); return query; },
            async order() {
                return { data: rows.filter(row => filters.every(([key, value]) => row[key] === value)), error: null };
            }
        };
        return query;
    } };
}

function actualExecutor(candidates) {
    const source = fs.readFileSync(require.resolve("../server"), "utf8");
    const start = source.indexOf("function createChatToolExecutor(");
    const end = source.indexOf("\nfunction previousReplySuggestionsFromMessages", start);
    assert.ok(start >= 0 && end > start);
    const context = {
        ...sticker,
        supabase: {},
        createCompanionActivities: () => ({ execute: async () => ({ ok: true }), getActions: () => [] }),
        bilibiliQrLogin: {},
        createReplySuggestionSelector: () => ({ getSuggestions: () => [] }),
        sanitizeCompanionStatusSnapshot: value => value,
        COMPANION_ACTIVITY_TOOL: { name: "fixture-activity" },
        UPDATE_COMPANION_STATUS_TOOL: { name: "fixture-status" }
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    return context.createChatToolExecutor("fixture-session", {}, "fixture-client", null, {}, "fixture-user", candidates);
}

test("actual scoped catalog and chat executor preserve custom IDs through both save expressions and done receipts", async () => {
    const own = { id: ownId, user_id: userA, companion_id: companionA, purpose: "custom_sticker", status: "active",
        display_name: "虚构招呼贴图", alt_text: "虚构角色开心招手", mood_tags: ["happy"] };
    const rows = [own,
        { ...own, id: foreignId, user_id: userB },
        { ...own, id: otherCompanionId, companion_id: companionB },
        { ...own, id: archivedId, status: "archived" }];
    const original = JSON.stringify(rows);
    const scope = { userId: userA, companionId: companionA,
        db: createTenantDatabase({ adminSupabase: mockAdminDatabase(rows), tenant: { userId: userA, companionId: companionA } }) };
    const candidates = await listActiveCustomStickers(scope);
    assert.deepEqual(candidates, [{ id: ownId, display_name: own.display_name, alt_text: own.alt_text, mood_tags: ["happy"] }]);
    const executor = actualExecutor(candidates);
    for (const id of [foreignId, otherCompanionId, archivedId]) {
        const result = await executor.executeTool({ name: sticker.SELECT_COMPANION_STICKER_TOOL.name,
            arguments: JSON.stringify({ custom_sticker_id: id }) });
        assert.equal(result.ok, false);
    }
    assert.equal((await executor.executeTool({ name: sticker.SELECT_COMPANION_STICKER_TOOL.name,
        arguments: JSON.stringify({ custom_sticker_id: ownId }) })).ok, true);
    assert.equal(executor.getCustomStickerId(), ownId);
    const source = fs.readFileSync(require.resolve("../server"), "utf8");
    const saveExpressions = [...source.matchAll(/companionStickerToolCalls\(chatTools\)/g)];
    assert.equal(saveExpressions.length, 2, "both the current chat path and legacy success path must use the full receipt");
    assert.doesNotMatch(source, /companionStickerToolCalls\(chatTools\.getStickerId\(\)\)/);
    for (const [expression] of saveExpressions) {
        const metadata = vm.runInNewContext(expression, { companionStickerToolCalls: sticker.companionStickerToolCalls, chatTools: executor });
        assert.deepEqual(metadata, { custom_sticker_id: ownId });
        const message = publicMessage({ id: "42", role: "assistant", content: visibleReply,
            created_at: "2026-10-16T00:00:00Z", tool_calls: metadata });
        assert.equal(streamSuccess({ assistant_message: message }).assistant_message.tool_calls.custom_sticker_id, ownId);
    }
    assert.equal(JSON.stringify(rows), original, "catalog selection and tool use must not modify private media metadata");
});

function providerFor(url) {
    if (url.includes(":generateContent") || url.includes(":streamGenerateContent")) return "gemini";
    if (url.endsWith("/messages")) return "anthropic";
    if (url.endsWith("/chat/completions")) return "custom";
    return "openai-responses";
}
function systemBlocks(provider, body) {
    if (provider === "gemini") return body.systemInstruction.parts.map(part => part.text);
    if (provider === "anthropic") return body.system.map(part => part.text);
    if (provider === "custom") return body.messages.filter(message => message.role === "system").map(message => message.content);
    return [body.instructions];
}
function sendEvent(response, event) { response.write(`data: ${JSON.stringify(event)}\n\n`); }
function sendDelta(response, provider, content) {
    if (provider === "gemini") return sendEvent(response, { candidates: [{ content: { parts: [{ text: content }] } }] });
    if (provider === "anthropic") return sendEvent(response, { type: "content_block_delta", delta: { type: "text_delta", text: content } });
    if (provider === "custom") return sendEvent(response, { choices: [{ delta: { content } }] });
    return sendEvent(response, { type: "response.output_text.delta", delta: content });
}
function jsonReply(provider, text) {
    if (provider === "gemini") return { candidates: [{ content: { parts: [{ text }] } }] };
    if (provider === "anthropic") return { content: [{ type: "text", text }] };
    if (provider === "custom") return { choices: [{ message: { content: text } }] };
    return { output_text: text };
}

test("real Chat, Responses, Anthropic and Gemini adapters carry only validated sticker selections", { timeout: 30000 }, async (t) => {
    const requests = [], fixtureErrors = [];
    const server = http.createServer(async (request, response) => {
        try {
            let raw = "";
            for await (const chunk of request) raw += chunk;
            const body = JSON.parse(raw);
            const provider = providerFor(request.url);
            const instruction = systemBlocks(provider, body).join("\n\n");
            const model = provider === "gemini" ? decodeURIComponent(request.url.match(/\/models\/([^:]+):/)[1]) : body.model;
            const streaming = request.url.includes(":streamGenerateContent") || body.stream === true;
            requests.push({ provider, model, streaming, body, instruction });
            if (provider === "custom" && Array.isArray(body.tools)) {
                if (!model.includes("native")) {
                    response.writeHead(400, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ error: { message: "tools are not supported" } }));
                    return;
                }
                if (!body.messages.some(message => message.role === "tool")) {
                    const call = { id: "fixture-sticker-call", type: "function", function: {
                        name: sticker.SELECT_COMPANION_STICKER_TOOL.name, arguments: JSON.stringify({ custom_sticker_id: ownId }) } };
                    response.writeHead(200, { "Content-Type": streaming ? "text/event-stream" : "application/json" });
                    if (streaming) {
                        sendEvent(response, { choices: [{ delta: { tool_calls: [{ index: 0, ...call }] } }] });
                        sendEvent(response, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
                        response.end("data: [DONE]\n\n");
                    } else response.end(JSON.stringify({ choices: [{ message: { content: "", tool_calls: [call] } }] }));
                    return;
                }
            }
            let text = `[monologue]${visibleHeart}[/monologue]${visibleReply}`;
            if (!model.includes("native")) {
                const open = instruction.match(/<<<DENGTA_REPLY_SUGGESTIONS_V1:[a-f0-9]{32}>>>/)?.[0];
                const close = instruction.match(/<<<END_DENGTA_REPLY_SUGGESTIONS_V1:[a-f0-9]{32}>>>/)?.[0];
                assert.ok(open && close, "a sticker-only tool must enable the existing envelope capability");
                const chosen = model.includes("foreign") ? foreignId : ownId;
                text += `${open}${JSON.stringify({ sticker: { custom_sticker_id: chosen } })}${close}`;
            }
            response.writeHead(200, { "Content-Type": streaming ? "text/event-stream" : "application/json" });
            if (!streaming) { response.end(JSON.stringify(jsonReply(provider, text))); return; }
            for (const character of text) sendDelta(response, provider, character);
            if (model.includes("incomplete")) { response.end(); return; }
            if (provider === "gemini") sendEvent(response, { candidates: [{ finishReason: "STOP" }] });
            else if (provider === "anthropic") {
                sendEvent(response, { type: "message_delta", delta: { stop_reason: "end_turn" } });
                sendEvent(response, { type: "message_stop" });
            } else if (provider === "openai-responses") sendEvent(response, { type: "response.completed", response: { status: "completed" } });
            else sendEvent(response, { choices: [{ delta: {}, finish_reason: "stop" }] });
            response.end("data: [DONE]\n\n");
        } catch (error) {
            fixtureErrors.push(error);
            response.writeHead(500, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: { message: "synthetic fixture failure" } }));
        }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const run = async ({ provider, streaming, model = "fixture-sticker" }) => {
        const executor = actualExecutor([{ id: ownId, display_name: "虚构招呼贴图", alt_text: "虚构角色开心招手", mood_tags: ["happy"] }]);
        const settings = { provider, api_url: apiUrl, runtime_api_key: "test-only", model,
            prompt_mode: "unified", unified_system_prompt: persona, user_details: details, max_tokens: 512 };
        const saved = JSON.stringify(settings), events = [];
        const input = { settings, messages: [{ role: "user", content: "虚构测试输入。" }],
            promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE, visibleMonologue: true,
            tools: [executor.getStickerTool()], executeTool: executor.executeTool };
        const result = streaming ? await generateReplyStream({ ...input, onEvent: event => events.push(event) }) : await generateReply(input);
        assert.equal(JSON.stringify(settings), saved);
        return { result, executor, events };
    };
    try {
        for (const provider of ["custom", "openai-responses", "anthropic", "gemini"]) {
            for (const streaming of [false, true]) await t.test(`${provider} ${streaming ? "stream" : "JSON"}`, async () => {
                const start = requests.length;
                const { result, executor, events } = await run({ provider, streaming });
                assert.equal(result.text, visibleReply);
                assert.equal(result.visible_monologue.text, visibleHeart);
                assert.equal(result.visible_monologue.state, "complete");
                assert.deepEqual(sticker.companionStickerToolCalls(executor), { custom_sticker_id: ownId });
                assert.equal(requests.length - start, provider === "custom" ? 2 : 1);
                const last = requests.at(-1);
                assert.ok(last.instruction.includes(persona));
                assert.ok(last.instruction.includes(details));
                assert.ok(last.instruction.indexOf(details) < last.instruction.indexOf(persona));
                assert.ok(last.instruction.indexOf(persona) < last.instruction.indexOf("【DengTa 本轮隐藏元数据协议】"));
                assert.equal(result.tools_unsupported, provider === "custom");
                if (streaming) {
                    assert.equal(events.filter(event => event.type === "text").map(event => event.content).join(""), visibleReply);
                    assert.doesNotMatch(JSON.stringify(events), /DENGTA_REPLY_SUGGESTIONS|custom_sticker_id|aaaaaaaa-aaaa/);
                }
            });
            await t.test(`${provider} unknown candidate is rejected`, async () => {
                const { result, executor } = await run({ provider, streaming: true, model: "fixture-foreign-sticker" });
                assert.equal(result.text, visibleReply);
                assert.deepEqual(sticker.companionStickerToolCalls(executor), {});
            });
            await t.test(`${provider} incomplete terminal does not apply envelope selection`, async () => {
                const executor = actualExecutor([{ id: ownId, mood_tags: ["happy"] }]);
                await assert.rejects(generateReplyStream({
                    settings: { provider, api_url: apiUrl, runtime_api_key: "test-only", model: "fixture-incomplete-sticker", max_tokens: 512 },
                    messages: [{ role: "user", content: "虚构输入。" }], promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
                    visibleMonologue: true, tools: [executor.getStickerTool()], executeTool: executor.executeTool, onEvent() {}
                }));
                assert.deepEqual(sticker.companionStickerToolCalls(executor), {});
            });
        }
        for (const streaming of [false, true]) await t.test(`native Chat tool ${streaming ? "stream" : "JSON"}`, async () => {
            const start = requests.length;
            const { result, executor } = await run({ provider: "custom", streaming, model: "fixture-native-sticker" });
            assert.equal(result.text, visibleReply);
            assert.deepEqual(sticker.companionStickerToolCalls(executor), { custom_sticker_id: ownId });
            assert.equal(result.tools_unsupported, false);
            assert.equal(requests.length - start, 2);
        });
        assert.deepEqual(fixtureErrors, []);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
