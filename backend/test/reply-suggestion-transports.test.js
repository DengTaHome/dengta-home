const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {
    MAIN_CHAT_PROMPT_ARCHITECTURE,
    generateReply,
    generateReplyStream
} = require("../services/ai-service");
const {
    REPLY_SUGGESTION_ENVELOPE_MAX_CHARS,
    createReplySuggestionEnvelopeProtocol
} = require("../services/reply-suggestion-envelope");
const {
    SELECT_REPLY_SUGGESTIONS_TOOL,
    createReplySuggestionSelector
} = require("../services/reply-suggestions");

const FIXED_NONCE = "a".repeat(32);
const VISIBLE_REPLY = "今晚回来就抱抱你。";
const EXPECTED_SUGGESTIONS = ["那你抱紧一点", "先说说你有多想我"];

function codePointLength(value) {
    return Array.from(String(value || "")).length;
}

function systemInstructionBlocks(provider, body) {
    if (provider === "gemini") {
        return Array.isArray(body?.systemInstruction?.parts)
            ? body.systemInstruction.parts.map((part) => String(part?.text || ""))
            : [];
    }
    if (provider === "anthropic") {
        return Array.isArray(body?.system)
            ? body.system.map((part) => String(part?.text || ""))
            : [];
    }
    if (provider === "custom") {
        return Array.isArray(body?.messages)
            ? body.messages
                  .filter((message) => message?.role === "system")
                  .map((message) => String(message?.content || ""))
            : [];
    }
    return typeof body?.instructions === "string" ? [body.instructions] : [];
}

function providerFromUrl(url) {
    if (url.includes(":generateContent") || url.includes(":streamGenerateContent")) {
        return "gemini";
    }
    if (url.endsWith("/messages")) return "anthropic";
    if (url.endsWith("/chat/completions")) return "custom";
    return "openai-responses";
}

function envelopeMarkers(instructionText) {
    const openMarker = instructionText.match(
        /<<<DENGTA_REPLY_SUGGESTIONS_V1:[a-f0-9]{32}>>>/
    )?.[0];
    const closeMarker = instructionText.match(
        /<<<END_DENGTA_REPLY_SUGGESTIONS_V1:[a-f0-9]{32}>>>/
    )?.[0];
    assert.ok(openMarker, "provider system instruction must contain an opener");
    assert.ok(closeMarker, "provider system instruction must contain a closer");
    assert.equal(
        openMarker.match(/[a-f0-9]{32}/)?.[0],
        closeMarker.match(/[a-f0-9]{32}/)?.[0],
        "both envelope markers must use the same per-turn nonce"
    );
    return { openMarker, closeMarker };
}

function sendEvent(response, event) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function sendProviderDelta(response, provider, character) {
    if (provider === "gemini") {
        sendEvent(response, {
            candidates: [{ content: { parts: [{ text: character }] } }]
        });
        return;
    }
    if (provider === "anthropic") {
        sendEvent(response, {
            type: "content_block_delta",
            delta: { type: "text_delta", text: character }
        });
        return;
    }
    if (provider === "custom") {
        sendEvent(response, {
            choices: [{ delta: { content: character } }]
        });
        return;
    }
    sendEvent(response, {
        type: "response.output_text.delta",
        delta: character
    });
}

function providerJsonResponse(provider, rawText) {
    if (provider === "gemini") {
        return { candidates: [{ content: { parts: [{ text: rawText }] } }] };
    }
    if (provider === "anthropic") {
        return { content: [{ type: "text", text: rawText }] };
    }
    if (provider === "custom") {
        return { choices: [{ message: { content: rawText } }] };
    }
    return { output_text: rawText };
}

function assertEnvelopeFilterBoundaries() {
    const protocol = createReplySuggestionEnvelopeProtocol({
        nonce: FIXED_NONCE
    });
    const validRaw = `${VISIBLE_REPLY}${protocol.openMarker}${JSON.stringify({
        suggestions: EXPECTED_SUGGESTIONS
    })}${protocol.closeMarker}`;

    for (let split = 0; split <= validRaw.length; split += 1) {
        const filter = protocol.createFilter();
        const visible = `${filter.push(validRaw.slice(0, split))}${filter.push(
            validRaw.slice(split)
        )}${filter.finish()}`;
        assert.equal(visible, VISIBLE_REPLY);
        assert.deepEqual(filter.getSuggestions(), EXPECTED_SUGGESTIONS);
    }

    const characterFilter = protocol.createFilter();
    let characterVisible = "";
    for (const character of validRaw) {
        characterVisible += characterFilter.push(character);
    }
    characterVisible += characterFilter.finish();
    assert.equal(characterVisible, VISIBLE_REPLY);
    assert.deepEqual(
        characterFilter.getSuggestions(),
        EXPECTED_SUGGESTIONS
    );

    assert.deepEqual(protocol.filterText("普通正文"), {
        text: "普通正文",
        suggestions: []
    });
    for (const suffix of ["<", "<<", "<<<"]) {
        assert.deepEqual(protocol.filterText(`普通正文${suffix}`), {
            text: `普通正文${suffix}`,
            suggestions: []
        });
    }

    const lowercaseRaw = `${VISIBLE_REPLY}${protocol.openMarker.toLowerCase()}${JSON.stringify(
        { suggestions: EXPECTED_SUGGESTIONS }
    )}${protocol.closeMarker.toLowerCase()}`;
    const lowercaseFilter = protocol.createFilter();
    let lowercaseVisible = "";
    for (const character of lowercaseRaw) {
        lowercaseVisible += lowercaseFilter.push(character);
    }
    lowercaseVisible += lowercaseFilter.finish();
    assert.equal(lowercaseVisible, VISIBLE_REPLY);
    assert.deepEqual(
        lowercaseFilter.getSuggestions(),
        EXPECTED_SUGGESTIONS
    );

    for (const invalidTail of [
        protocol.openMarker.slice(0, -5),
        `${protocol.openMarker}{"suggestions":["只有一条"]}`,
        `${protocol.openMarker}{"suggestions":["一样","一样"],"extra":true}${protocol.closeMarker}`,
        `${protocol.openMarker}not-json${protocol.closeMarker}`,
        `${protocol.openMarker}${JSON.stringify({
            suggestions: ["一", "二"],
            extra: true
        })}${protocol.closeMarker}`,
        `${protocol.openMarker}${JSON.stringify({
            suggestions: ["x".repeat(REPLY_SUGGESTION_ENVELOPE_MAX_CHARS + 1), "二"]
        })}${protocol.closeMarker}`,
        `${protocol.openMarker}${JSON.stringify({
            suggestions: EXPECTED_SUGGESTIONS
        })}${protocol.closeMarker}协议后还有正文`,
        protocol.closeMarker
    ]) {
        const filter = protocol.createFilter();
        let visible = "";
        for (const character of `${VISIBLE_REPLY}${invalidTail}`) {
            visible += filter.push(character);
        }
        visible += filter.finish();
        assert.equal(visible, VISIBLE_REPLY);
        assert.deepEqual(filter.getSuggestions(), []);
        assert.doesNotMatch(
            visible,
            /DENGTA_REPLY_SUGGESTIONS|suggestions|那你抱紧一点/
        );
    }
}

function providerSettings(provider, apiUrl, model = "mock-model") {
    return {
        provider,
        api_url: apiUrl,
        runtime_api_key: "local-test-key",
        model,
        ai_name: "小灯",
        system_prompt: "稳定遵循主聊天人设。",
        temperature: 0.2,
        max_tokens: 800
    };
}

async function runProviderTurn({
    provider,
    apiUrl,
    stream,
    model = "mock-model",
    userText = "你回来以后会做什么？"
}) {
    const selector = createReplySuggestionSelector();
    const events = [];
    const input = {
        settings: providerSettings(provider, apiUrl, model),
        messages: [{ role: "user", content: userText }],
        promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
        tools: [SELECT_REPLY_SUGGESTIONS_TOOL],
        executeTool: selector.executeTool
    };
    const result = stream
        ? await generateReplyStream({
              ...input,
              onEvent(event) {
                  events.push(event);
              }
          })
        : await generateReply(input);
    return { result, selector, events };
}

async function main() {
    assertEnvelopeFilterBoundaries();

    const requests = [];
    const server = http.createServer(async (request, response) => {
        let requestText = "";
        for await (const chunk of request) requestText += chunk.toString("utf8");
        const body = JSON.parse(requestText || "{}");
        const provider = providerFromUrl(request.url);
        const blocks = systemInstructionBlocks(provider, body);
        const instructionText = blocks.join("\n\n");
        const streaming =
            request.url.includes(":streamGenerateContent") || body.stream === true;
        requests.push({
            provider,
            body,
            blocks,
            instructionText,
            streaming
        });
        if (provider === "custom" && Array.isArray(body.tools)) {
            response.writeHead(400, {
                "Content-Type": "application/json; charset=utf-8"
            });
            response.end(
                JSON.stringify({
                    error: { message: "tools are not supported" }
                })
            );
            return;
        }
        const markers = envelopeMarkers(instructionText);
        const requestedModel =
            provider === "gemini"
                ? decodeURIComponent(
                      request.url.match(/\/models\/([^:]+):/)?.[1] || ""
                  )
                : body.model;
        const validEnvelope = `${markers.openMarker}${JSON.stringify({
            suggestions: EXPECTED_SUGGESTIONS
        })}${markers.closeMarker}`;
        const rawText =
            requestedModel === "no-envelope"
                ? VISIBLE_REPLY
                : requestedModel === "trailing-symbol"
                  ? `${VISIBLE_REPLY}<`
                : requestedModel === "truncated-envelope"
                  ? `${VISIBLE_REPLY}${validEnvelope.slice(
                        0,
                        -markers.closeMarker.length - 4
                    )}`
                  : `${VISIBLE_REPLY}${validEnvelope}`;
        if (!streaming) {
            response.writeHead(200, {
                "Content-Type": "application/json; charset=utf-8"
            });
            response.end(JSON.stringify(providerJsonResponse(provider, rawText)));
            return;
        }

        response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8"
        });
        if (
            provider === "openai-responses" &&
            body.model === "completed-only"
        ) {
            sendEvent(response, {
                type: "response.completed",
                response: { output_text: rawText }
            });
        } else {
            for (const character of rawText) {
                sendProviderDelta(response, provider, character);
            }
            if (provider === "openai-responses") {
                sendEvent(response, {
                    type: "response.completed",
                    response: { status: "completed" }
                });
            } else if (provider === "anthropic") {
                sendEvent(response, {
                    type: "message_delta",
                    delta: { stop_reason: "end_turn" }
                });
                sendEvent(response, { type: "message_stop" });
            } else if (provider === "gemini") {
                sendEvent(response, { candidates: [{ finishReason: "STOP" }] });
            }
        }
        response.end("data: [DONE]\n\n");
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const apiUrl = `http://127.0.0.1:${port}/v1`;

    try {
        for (const provider of [
            "gemini",
            "anthropic",
            "openai-responses"
        ]) {
            for (const stream of [false, true]) {
                const { result, selector, events } = await runProviderTurn({
                    provider,
                    apiUrl,
                    stream
                });
                assert.equal(result.text, VISIBLE_REPLY);
                assert.deepEqual(
                    selector.getSuggestions(),
                    EXPECTED_SUGGESTIONS
                );
                if (stream) {
                    const publicText = events
                        .filter((event) => event.type === "text")
                        .map((event) => event.content || "")
                        .join("");
                    assert.equal(publicText, VISIBLE_REPLY);
                    assert.doesNotMatch(
                        JSON.stringify(events),
                        /DENGTA_REPLY_SUGGESTIONS|suggestions|那你抱紧一点/
                    );
                }

                const request = requests.at(-1);
                assert.equal(request.provider, provider);
                assert.match(
                    request.instructionText,
                    /只有确实能生成两条合适候选时/
                );
                if (provider === "openai-responses") {
                    assert.ok(
                        result.prompt_receipt.system_instruction_blocks >= 2,
                        "Responses joins logical system blocks into one provider field"
                    );
                } else {
                    assert.equal(
                        result.prompt_receipt.system_instruction_blocks,
                        request.blocks.length
                    );
                }
                assert.equal(
                    result.prompt_receipt.system_message_count,
                    request.blocks.length > 0 ? 1 : 0
                );
                assert.equal(
                    result.prompt_receipt.system_payload_chars,
                    codePointLength(request.instructionText)
                );
                assert.equal(
                    result.prompt_receipt.payload_preview.system.chars,
                    codePointLength(request.instructionText)
                );
                assert.doesNotMatch(
                    JSON.stringify(result.prompt_receipt),
                    /DENGTA_REPLY_SUGGESTIONS|[a-f0-9]{32}/
                );
            }
        }

        const completedOnly = await runProviderTurn({
            provider: "openai-responses",
            apiUrl,
            stream: true,
            model: "completed-only"
        });
        assert.equal(completedOnly.result.text, VISIBLE_REPLY);
        assert.deepEqual(
            completedOnly.selector.getSuggestions(),
            EXPECTED_SUGGESTIONS
        );
        assert.equal(
            completedOnly.events
                .filter((event) => event.type === "text")
                .map((event) => event.content || "")
                .join(""),
            VISIBLE_REPLY
        );

        const noEnvelope = await runProviderTurn({
            provider: "gemini",
            apiUrl,
            stream: false,
            model: "no-envelope"
        });
        assert.equal(noEnvelope.result.text, VISIBLE_REPLY);
        assert.deepEqual(noEnvelope.selector.getSuggestions(), []);

        const trailingSymbol = await runProviderTurn({
            provider: "gemini",
            apiUrl,
            stream: true,
            model: "trailing-symbol"
        });
        assert.equal(trailingSymbol.result.text, `${VISIBLE_REPLY}<`);
        assert.deepEqual(trailingSymbol.selector.getSuggestions(), []);
        assert.equal(
            trailingSymbol.events
                .filter((event) => event.type === "text")
                .map((event) => event.content || "")
                .join(""),
            `${VISIBLE_REPLY}<`
        );

        const truncatedEnvelope = await runProviderTurn({
            provider: "anthropic",
            apiUrl,
            stream: true,
            model: "truncated-envelope"
        });
        assert.equal(truncatedEnvelope.result.text, VISIBLE_REPLY);
        assert.deepEqual(truncatedEnvelope.selector.getSuggestions(), []);
        assert.equal(
            truncatedEnvelope.events
                .filter((event) => event.type === "text")
                .map((event) => event.content || "")
                .join(""),
            VISIBLE_REPLY
        );
        assert.doesNotMatch(
            JSON.stringify(truncatedEnvelope.events),
            /DENGTA_REPLY_SUGGESTIONS|suggestions|那你抱紧一点/
        );

        for (const stream of [false, true]) {
            const requestCountBefore = requests.length;
            const customFallback = await runProviderTurn({
                provider: "custom",
                apiUrl,
                stream
            });
            assert.equal(
                requests.length - requestCountBefore,
                2,
                "a tools-unsupported gateway may use its existing reply fallback, never a separate suggestion request"
            );
            const initialRequest = requests.at(-2);
            const fallbackRequest = requests.at(-1);
            assert.ok(Array.isArray(initialRequest.body.tools));
            assert.equal(Object.hasOwn(fallbackRequest.body, "tools"), false);
            assert.match(
                fallbackRequest.instructionText,
                /DENGTA_REPLY_SUGGESTIONS_V1/
            );
            assert.equal(customFallback.result.text, VISIBLE_REPLY);
            assert.deepEqual(
                customFallback.selector.getSuggestions(),
                EXPECTED_SUGGESTIONS
            );
            assert.equal(
                customFallback.result.prompt_receipt.system_payload_chars,
                codePointLength(fallbackRequest.instructionText)
            );
            assert.equal(
                customFallback.result.prompt_receipt.system_message_count,
                1
            );
            if (stream) {
                const publicText = customFallback.events
                    .filter((event) => event.type === "text")
                    .map((event) => event.content || "")
                    .join("");
                assert.equal(publicText, VISIBLE_REPLY);
                assert.doesNotMatch(
                    JSON.stringify(customFallback.events),
                    /DENGTA_REPLY_SUGGESTIONS|suggestions|那你抱紧一点/
                );
            }
        }

        assert.equal(
            requests.length,
            14,
            "text-only providers use one request; a rejected native-tool attempt uses only its existing reply fallback"
        );

        const serverSource = fs.readFileSync(
            path.join(__dirname, "..", "server.js"),
            "utf8"
        );
        const voiceStart = serverSource.search(
            /app\.post\(\r?\n\s*"\/voice\/turn"/
        );
        const voiceEnd = serverSource.indexOf(
            'app.post("/voice/speech"',
            voiceStart
        );
        assert.ok(
            voiceStart >= 0 && voiceEnd > voiceStart,
            "voice route boundaries must be discoverable with LF or CRLF line endings"
        );
        const voiceRoute = serverSource.slice(voiceStart, voiceEnd);
        assert.match(voiceRoute, /generateReply\(\{/);
        assert.match(voiceRoute, /SELECT_REPLY_SUGGESTIONS_TOOL/);
        assert.match(
            voiceRoute,
            /finalizeReplySuggestions\(\{[\s\S]*?candidate:\s*chatTools\.getReplySuggestions\(\)[\s\S]*?previousSuggestions:/
        );
        assert.match(
            voiceRoute,
            /replySuggestionToolCalls\(\s*finalizedReplySuggestions\s*\)/
        );
        assert.match(
            serverSource,
            /dynamic_reply_suggestions_provider_agnostic:\s*true/
        );
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }

    console.log(
        "provider-agnostic reply suggestion envelope and streaming privacy tests passed"
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
