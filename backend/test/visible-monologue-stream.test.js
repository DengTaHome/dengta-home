// TEST: restore output-guard filtering (production default disables it)
process.env.PROVIDER_OUTPUT_GUARD_DISABLED = "false";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const {
    MAIN_CHAT_PROMPT_ARCHITECTURE,
    buildMainChatPromptPlan,
    generateReply,
    generateReplyStream
} = require("../services/ai-service");
const {
    createVisibleMonologueOutput,
    createVisibleMonologueSplitter
} = require("../services/visible-monologue-stream");
const { publicMessage } = require("../services/chat-attachments");

function splitChunks(chunks) {
    const splitter = createVisibleMonologueSplitter();
    let text = "";
    let monologue = "";
    let closed = false;

    for (const chunk of chunks) {
        const output = splitter.push(chunk);
        text += output.textDelta;
        monologue += output.monologueDelta;
        closed ||= output.justClosed;
    }
    const tail = splitter.finish();
    text += tail.textDelta;
    monologue += tail.monologueDelta;

    return { text, monologue, closed, state: tail.state };
}

function sendDelta(response, content) {
    response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
    );
}

function reconstructSegmentedMonologue(events) {
    const segments = new Map();
    for (const event of events.filter(
        (value) => value.type === "monologue" && value.phase === "delta"
    )) {
        const segment = Number(event.segment);
        const offset = Number(event.offset);
        const existing = Array.from(segments.get(segment) || "");
        const content = Array.from(String(event.content || ""));
        if (offset < existing.length) {
            assert.equal(
                existing.slice(offset, offset + content.length).join(""),
                content.join(""),
                "a replayed segment delta must match the published content"
            );
            continue;
        }
        assert.equal(
            offset,
            existing.length,
            "offsets are local to each assistant-response segment"
        );
        segments.set(segment, [...existing, ...content].join(""));
    }
    return [...segments.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, value]) => value.trim())
        .filter(Boolean)
        .join("\n\n");
}

async function withProviderStream(fragments, run) {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8"
        });
        for (const fragment of fragments) sendDelta(response, fragment);
        response.end("data: [DONE]\n\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
        const { port } = server.address();
        await run(`http://127.0.0.1:${port}/v1`);
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

async function withProviderJson(content, run) {
    const server = http.createServer(async (_request, response) => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
            JSON.stringify({ choices: [{ message: { content } }] })
        );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
        const { port } = server.address();
        await run(`http://127.0.0.1:${port}/v1`);
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

async function withToolProvider(run) {
    let requestCount = 0;
    const server = http.createServer(async (_request, response) => {
        requestCount += 1;
        response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8"
        });
        if (requestCount === 1) {
            sendDelta(
                response,
                "[monologue]Planning the tool call.[/monologue]"
            );
            response.write(
                `data: ${JSON.stringify({
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: "call_1",
                                        function: {
                                            name: "lookup",
                                            arguments: JSON.stringify({
                                                query: "private-tool-value"
                                            })
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                })}\n\n`
            );
        } else {
            sendDelta(
                response,
                "[monologue]Using private-tool-result.[/monologue]Final tool answer."
            );
        }
        response.end("data: [DONE]\n\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
        const { port } = server.address();
        await run(`http://127.0.0.1:${port}/v1`);
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

async function withFailingProvider(run) {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8"
        });
        sendDelta(response, "[monologue]Started but not finished.");
        setImmediate(() => response.destroy());
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
        const { port } = server.address();
        await run(`http://127.0.0.1:${port}/v1`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

async function main() {
    const promptPlan = buildMainChatPromptPlan({
        settings: { prompt_mode: "legacy" },
        messages: [{ role: "user", content: "Are you there?" }],
        visibleMonologue: true
    });
    const promptText = promptPlan.systemInstructions.join("\n\n");
    assert.match(promptText, /\[monologue\]/);
    assert.match(promptText, /\[\/monologue\]/);
    assert.doesNotMatch(promptText, /\b(?:brief|safe|boundary)\b/i);
    assert.match(promptText, /length, tone, and detail follow/i);
    assert.equal(
        promptPlan.receipt.visible_monologue_contract_version,
        "visible-monologue-v2"
    );
    assert.equal(promptPlan.receipt.visible_monologue_enabled, true);
    assert.equal(promptPlan.receipt.visible_monologue_max_characters, 6000);
    const personalizedPromptPlan = buildMainChatPromptPlan({
        settings: {
            prompt_mode: "unified",
            unified_system_prompt: "CUSTOM-LONG-MONOLOGUE-INSTRUCTION",
            user_details: "USER-DETAILS-MONOLOGUE-PREFERENCE"
        },
        messages: [{ role: "user", content: "Are you there?" }],
        visibleMonologue: true
    });
    assert.equal(
        personalizedPromptPlan.systemInstructions[0],
        "USER-DETAILS-MONOLOGUE-PREFERENCE"
    );
    assert.equal(
        personalizedPromptPlan.systemInstructions[1],
        "CUSTOM-LONG-MONOLOGUE-INSTRUCTION"
    );
    assert.match(
        personalizedPromptPlan.systemInstructions[2],
        /\[monologue\]/
    );

    const torn = splitChunks([
        "[mono",
        "logue]I want to meet the feeling first.[/mono",
        "logue]I am here; take your time."
    ]);

    assert.deepEqual(torn, {
        text: "I am here; take your time.",
        monologue: "I want to meet the feeling first.",
        closed: true,
        state: "complete"
    });
    assert.deepEqual(splitChunks(["No marker reply."]), {
        text: "No marker reply.",
        monologue: "",
        closed: false,
        state: "missing"
    });
    assert.deepEqual(splitChunks(["[monologue]Unclosed thought"]), {
        text: "",
        monologue: "Unclosed thought",
        closed: false,
        state: "truncated"
    });
    const surrogateSplitter = createVisibleMonologueSplitter({
        maxCharacters: 1
    });
    const surrogateFirst = surrogateSplitter.push("[monologue]\ud83d");
    const surrogateSecond = surrogateSplitter.push(
        "\ude00[/monologue]body"
    );
    const surrogateTail = surrogateSplitter.finish();
    assert.equal(
        surrogateFirst.monologueDelta + surrogateSecond.monologueDelta,
        "😀"
    );
    assert.equal(surrogateSecond.textDelta, "body");
    assert.equal(surrogateTail.displayTruncated, false);

    const repeatFinishSplitter = createVisibleMonologueSplitter();
    repeatFinishSplitter.push("[monologue]once[/monologue]body");
    const firstFinish = repeatFinishSplitter.finish();
    assert.deepEqual(repeatFinishSplitter.finish(), firstFinish);
    assert.deepEqual(repeatFinishSplitter.push("late"), {
        textDelta: "",
        monologueDelta: "",
        justClosed: false,
        displayTruncated: false
    });

    const noMarkerOutput = createVisibleMonologueOutput({ enabled: true });
    noMarkerOutput.pushText("No marker reply.");
    assert.deepEqual(noMarkerOutput.finish().visible_monologue, {
        schema_version: 1,
        text: "",
        state: "missing",
        source: "model_authored_visible_monologue",
        generated_with_reply: true,
        segment_count: 0,
        display_truncated: false,
        redacted: false
    });

    const boundedSplitter = createVisibleMonologueSplitter({
        maxCharacters: 4
    });
    const boundedFirst = boundedSplitter.push(
        "[monologue]123456[/monologue]answer"
    );
    const boundedTail = boundedSplitter.finish();
    assert.equal(boundedFirst.monologueDelta, "1234");
    assert.equal(boundedFirst.textDelta, "answer");
    assert.equal(boundedTail.state, "complete");
    assert.equal(boundedTail.displayTruncated, true);
    const boundedOutput = createVisibleMonologueOutput({
        enabled: true,
        maxCharacters: 4
    });
    boundedOutput.pushText(
        "[monologue]123456[/monologue]answer"
    );
    const boundedResult = boundedOutput.finish();
    assert.equal(boundedResult.text, "answer");
    assert.equal(boundedResult.visible_monologue.text, "1234");
    assert.equal(boundedResult.visible_monologue.state, "truncated");
    assert.equal(
        boundedResult.visible_monologue.display_truncated,
        true
    );

    const privateInstruction = "internal system instruction alpha";
    const credential = "Bearer sk-provider-secret-123456789-fixture-4";
    const unsafePayload =
        `[monologue]I will not expose ${credential} or ` +
        `${privateInstruction}.[/monologue]Safe answer.`;
    for (let cut = 1; cut < unsafePayload.length; cut += 1) {
        const privateEvents = [];
        const output = createVisibleMonologueOutput({
            enabled: true,
            sensitiveTexts: [privateInstruction],
            onEvent: (event) => privateEvents.push(event)
        });
        output.pushText(unsafePayload.slice(0, cut));
        output.pushText(unsafePayload.slice(cut));
        const privateResult = output.finish();
        const publicSurface = JSON.stringify({
            events: privateEvents,
            result: privateResult
        });
        assert.doesNotMatch(
            publicSurface,
            /sk-provider-secret-123456789-fixture-4|internal system instruction alpha/,
            `sensitive text leaked at split ${cut}`
        );
        assert.equal(privateResult.text, "Safe answer.");
        assert.equal(privateResult.visible_monologue.redacted, true);
    }

    const segmentedEvents = [];
    const segmentedOutput = createVisibleMonologueOutput({
        enabled: true,
        onEvent: (event) => segmentedEvents.push(event)
    });
    segmentedOutput.pushText("[monologue]First.");
    segmentedOutput.pushText(" More.[/monologue]");
    segmentedOutput.nextAssistantResponse();
    segmentedOutput.pushText("[monologue]Second.");
    segmentedOutput.pushText(" Again.[/monologue]Final answer.");
    const segmented = segmentedOutput.finish();
    assert.equal(segmented.text, "Final answer.");
    assert.equal(
        segmented.visible_monologue.text,
        "First. More.\n\nSecond. Again."
    );
    assert.equal(segmented.visible_monologue.segment_count, 2);
    const deltaOffsets = segmentedEvents
        .filter((event) => event.phase === "delta")
        .map(({ segment, offset }) => ({ segment, offset }));
    const firstSegmentOffsets = deltaOffsets.filter((entry) => entry.segment === 0);
    const secondSegmentOffsets = deltaOffsets.filter((entry) => entry.segment === 1);
    assert.deepEqual(firstSegmentOffsets, [{ segment: 0, offset: 0 }, { segment: 0, offset: 6 }]);
    assert.deepEqual(secondSegmentOffsets, [{ segment: 1, offset: 0 }, { segment: 1, offset: 7 }]);
    const segmentedDeltas = segmentedEvents.filter(
        (event) => event.phase === "delta"
    );
    assert.equal(
        reconstructSegmentedMonologue([
            ...segmentedDeltas,
            segmentedDeltas[2],
            segmentedDeltas[3]
        ]),
        segmented.visible_monologue.text,
        "live segmented deltas and the authoritative snapshot must use the same blank-line join"
    );
    assert.equal(
        segmentedEvents.filter((event) => event.phase === "end").length,
        1
    );

    const events = [];
    let generated;
    await withProviderStream(
        [
            "[mono",
            "logue]I want to reassure you.[/mono",
            "logue]I am right here."
        ],
        async (apiUrl) => {
            generated = await generateReplyStream({
                settings: {
                    provider: "custom",
                    api_url: apiUrl,
                    runtime_api_key: "local-test-key",
                    model: "mock-model",
                    temperature: 0.2,
                    max_tokens: 200
                },
                messages: [{ role: "user", content: "Are you there?" }],
                promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
                visibleMonologue: true,
                onEvent(event) {
                    events.push(event);
                }
            });
        }
    );

    assert.equal(
        events
            .filter((event) => event.type === "text")
            .map((event) => event.content || "")
            .join(""),
        "I am right here."
    );
    const monologueDeltas = events.filter(
        (event) => event.type === "monologue" && event.phase === "delta"
    );
    assert.equal(
        monologueDeltas.map((event) => event.content).join(""),
        "I want to reassure you.",
    );
    assert.equal(monologueDeltas.length, 1, "do not split a provider fragment into artificial character events");
    assert.equal(monologueDeltas[0].offset, 0);
    assert.equal(monologueDeltas[0].content, "I want to reassure you.");
    assert.deepEqual(
        events.filter(
            (event) => event.type === "monologue" && event.phase === "end"
        ),
        [
            {
                type: "monologue",
                phase: "end",
                source: "model_authored_visible_monologue",
                public: true,
                state: "complete",
                display_truncated: false,
                characters: 23
            }
        ]
    );
    assert.equal(generated.text, "I am right here.");
    assert.deepEqual(generated.visible_monologue, {
        schema_version: 1,
        text: "I want to reassure you.",
        state: "complete",
        source: "model_authored_visible_monologue",
        generated_with_reply: true,
        segment_count: 1,
        display_truncated: false,
        redacted: false
    });

    let nonStreamGenerated;
    await withProviderJson(
        "[monologue]I will answer gently.[/monologue]Non-stream answer.",
        async (apiUrl) => {
            nonStreamGenerated = await generateReply({
                settings: {
                    provider: "custom",
                    api_url: apiUrl,
                    runtime_api_key: "local-test-key",
                    model: "mock-model",
                    temperature: 0.2,
                    max_tokens: 200
                },
                messages: [{ role: "user", content: "Please answer." }],
                promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
                visibleMonologue: true
            });
        }
    );
    assert.equal(nonStreamGenerated.text, "Non-stream answer.");
    assert.equal(
        nonStreamGenerated.visible_monologue.text,
        "I will answer gently."
    );

    const toolEvents = [];
    let toolGenerated;
    await withToolProvider(async (apiUrl) => {
        toolGenerated = await generateReplyStream({
            settings: {
                provider: "custom",
                api_url: apiUrl,
                runtime_api_key: "local-test-key",
                model: "mock-model",
                temperature: 0.2,
                max_tokens: 200
            },
            messages: [{ role: "user", content: "Use the tool." }],
            promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
            visibleMonologue: true,
            tools: [
                {
                    name: "lookup",
                    description: "Lookup test data",
                    input_schema: { type: "object" }
                }
            ],
            async executeTool() {
                return { ok: true, secret: "private-tool-result" };
            },
            onEvent: (event) => toolEvents.push(event)
        });
    });
    assert.equal(toolGenerated.text, "Final tool answer.");
    assert.equal(
        toolGenerated.visible_monologue.text,
        "Planning the tool call.\n\nUsing [redacted sensitive content]."
    );
    assert.doesNotMatch(
        JSON.stringify({
            toolEvents,
            text: toolGenerated.text,
            visible_monologue: toolGenerated.visible_monologue
        }),
        /private-tool-result/
    );
    assert.equal(toolGenerated.visible_monologue.segment_count, 2);
    assert.equal(
        toolEvents.filter((event) => event.phase === "end").length,
        1
    );
    const toolDeltaOffsets = toolEvents
        .filter((event) => event.phase === "delta")
        .map(({ segment, offset }) => ({ segment, offset }));
    const toolFirstSegment = toolDeltaOffsets.filter((entry) => entry.segment === 0);
    const toolSecondSegment = toolDeltaOffsets.filter((entry) => entry.segment === 1);
    assert.deepEqual(toolFirstSegment, [{ segment: 0, offset: 0 }]);
    assert.deepEqual(toolSecondSegment, [{ segment: 1, offset: 0 }]);
    const failedEvents = [];
    await withFailingProvider(async (apiUrl) => {
        await assert.rejects(() =>
            generateReplyStream({
                settings: {
                    provider: "custom",
                    api_url: apiUrl,
                    runtime_api_key: "local-test-key",
                    model: "mock-model",
                    temperature: 0.2,
                    max_tokens: 200
                },
                messages: [{ role: "user", content: "Fail now." }],
                promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
                visibleMonologue: true,
                onEvent: (event) => failedEvents.push(event)
            })
        );
    });
    assert.deepEqual(
        failedEvents.filter((event) => event.phase === "end"),
        [
            {
                type: "monologue",
                phase: "end",
                source: "model_authored_visible_monologue",
                public: true,
                state: "failed",
                display_truncated: false,
                // Provider text remains buffered until a successful terminal event,
                // so a failed stream cannot expose a partial visible monologue.
                characters: 0
            }
        ]
    );

    const projected = publicMessage({
        id: "assistant-id",
        role: "assistant",
        content: "I am right here.",
        created_at: "2026-08-12T00:00:00.000Z",
        tool_calls: {
            visible_monologue: {
                ...generated.visible_monologue,
                internal_note: "must not be public"
            }
        }
    });
    assert.deepEqual(projected.visible_monologue, generated.visible_monologue);
    assert.doesNotMatch(JSON.stringify(projected), /internal_note/);
    const rejectedProjection = publicMessage({
        id: "assistant-id",
        role: "assistant",
        content: "Safe body",
        created_at: "2026-08-12T00:00:00.000Z",
        tool_calls: {
            visible_monologue: {
                ...generated.visible_monologue,
                source: "provider_raw_chain_of_thought"
            }
        }
    });
    assert.equal(
        Object.hasOwn(rejectedProjection, "visible_monologue"),
        false
    );

    const serverSource = fs.readFileSync(
        path.join(__dirname, "..", "server.js"),
        "utf8"
    );
    assert.match(
        serverSource,
        /visible_monologue:\s*generated\.visible_monologue/
    );
    assert.match(
        serverSource,
        /\["text",\s*"reasoning",\s*"monologue"\]\.includes\(event\?\.type\)/
    );

    // 变体标记容错：模型偶尔把闭合标记写成变体（如 [/monologuel]），
    // 不得泄漏进正文，也不能让心声块无法闭合。
    const variantChunks = splitChunks([
        "[monologue]jin tian hao lei[/monologuel]zheng wen kai shi"
    ]);
    assert.equal(variantChunks.monologue, "jin tian hao lei");
    assert.equal(variantChunks.text, "zheng wen kai shi");
    assert.equal(variantChunks.closed, true);

    const strayVariant = splitChunks(["ni hao ya[/monologuel]ji xu shuo hua"]);
    assert.equal(strayVariant.text, "ni hao yaji xu shuo hua");
    assert.equal(strayVariant.monologue, "");

    const crossDeltaVariant = splitChunks([
        "[monologue]di yi ju",
        "di er ju[/monologuel]zheng wen"
    ]);
    assert.equal(crossDeltaVariant.monologue, "di yi judi er ju");
    assert.equal(crossDeltaVariant.text, "zheng wen");
    assert.equal(crossDeltaVariant.closed, true);

    const disabledPathEvents = [];
    const disabledOutput = createVisibleMonologueOutput({
        enabled: false,
        onEvent: (event) => disabledPathEvents.push(event)
    });
    disabledOutput.pushText("zheng chang[/monologuel]geng duo");
    assert.equal(disabledPathEvents[0].content, "zheng changgeng duo");
    assert.equal(disabledOutput.finish().text, "zheng changgeng duo");

    console.log("visible monologue stream tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
