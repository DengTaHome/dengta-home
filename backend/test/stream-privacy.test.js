const assert = require("node:assert/strict");
const http = require("node:http");

const { generateReplyStream } = require("../services/ai-service");
const {
    createReasoningEventEmitter
} = require("../services/reasoning-stream");
const {
    createThinkTagFilter,
    filterThinkTags
} = require("../services/think-tag-filter");

assert.equal(
    filterThinkTags("before<think>private</think>after"),
    "beforeafter"
);
assert.equal(filterThinkTags("before<THINK>private</THINK>after"), "beforeafter");
const splitFilter = createThinkTagFilter();
assert.equal(splitFilter.push("visible<thi"), "visible");
assert.equal(splitFilter.push("nk>private</th"), "");
assert.equal(splitFilter.push("ink>answer"), "answer");
assert.equal(splitFilter.finish(), "");
const unclosedFilter = createThinkTagFilter();
assert.equal(unclosedFilter.push("visible<think>private"), "visible");
assert.equal(unclosedFilter.finish(), "");

const splitSensitiveEvents = [];
const splitSensitiveEmitter = createReasoningEventEmitter({
    onEvent: (event) => splitSensitiveEvents.push(event),
    sensitiveTexts: ["system secret phrase", "private memory phrase"]
});
splitSensitiveEmitter.emit("Safe public summary. sys");
assert.equal(
    splitSensitiveEvents.length,
    1,
    "完整的公开摘要句子应在正式答案前立即发出"
);
assert.equal(splitSensitiveEvents[0].content, "Safe public summary.");
splitSensitiveEmitter.emit("tem secret phrase and private ");
splitSensitiveEmitter.emit("memory phrase.");
splitSensitiveEmitter.flushProvider();
const splitSensitiveOutput = splitSensitiveEvents
    .map((event) => event.content)
    .join("");
assert.match(splitSensitiveOutput, /Safe public summary/);
assert.doesNotMatch(
    splitSensitiveOutput,
    /system secret phrase|private memory phrase/
);
assert.ok(
    splitSensitiveEvents.every(
        (event) =>
            event.source === "provider_summary" && event.public === true
    )
);

const longSummaryEvents = [];
const longSummaryEmitter = createReasoningEventEmitter({
    onEvent: (event) => longSummaryEvents.push(event),
    chunkLimit: 500,
    totalLimit: 2000
});
const longPublicSummary = `${"公开摘要".repeat(350)}。`;
longSummaryEmitter.emit(longPublicSummary);
assert.equal(
    longSummaryEvents.map((event) => event.content).join(""),
    longPublicSummary,
    "超过单块上限的完整公开摘要不得被静默截掉"
);
assert.ok(
    longSummaryEvents.every(
        (event) => Array.from(event.content).length <= 500
    )
);

function sendEvent(response, event) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function main() {
    const requestBodies = [];
    const server = http.createServer(async (request, response) => {
        let requestText = "";
        for await (const chunk of request) {
            requestText += chunk.toString("utf8");
        }
        requestBodies.push({
            url: request.url,
            body: JSON.parse(requestText || "{}")
        });
        response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8"
        });

        if (request.url.endsWith("/messages")) {
            sendEvent(response, {
                type: "content_block_delta",
                delta: {
                    type: "thinking_delta",
                    thinking: "private Anthropic raw thinking"
                }
            });
            sendEvent(response, {
                type: "content_block_delta",
                delta: {
                    type: "thinking_delta",
                    thinking: "Test system rules"
                }
            });
            sendEvent(response, {
                type: "content_block_delta",
                delta: {
                    type: "thinking_summary_delta",
                    summary: "Anthropic checks the request."
                }
            });
            sendEvent(response, {
                type: "content_block_delta",
                delta: {
                    type: "thinking_summary_delta",
                    summary: "Test system rules"
                }
            });
            sendEvent(response, {
                type: "content_block_delta",
                delta: {
                    type: "thinking_summary_delta",
                    summary: "private stable memory"
                }
            });
            sendEvent(response, {
                type: "content_block_delta",
                delta: {
                    type: "thinking_summary_delta",
                    summary: "private user message"
                }
            });
            for (let index = 0; index < 10; index += 1) {
                sendEvent(response, {
                    type: "content_block_delta",
                    delta: {
                        type: "thinking_summary_delta",
                        summary: "A".repeat(1200)
                    }
                });
            }
            sendEvent(response, {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "Anthropic visible reply" }
            });
            sendEvent(response, {
                type: "message_delta",
                delta: { stop_reason: "end_turn" }
            });
            sendEvent(response, {
                type: "message_stop"
            });
        } else if (request.url.endsWith("/responses")) {
            sendEvent(response, {
                type: "response.reasoning_text.delta",
                delta: "private Responses raw reasoning"
            });
            sendEvent(response, {
                type: "response.reasoning_summary_text.delta",
                delta: "Responses checks the request."
            });
            sendEvent(response, {
                type: "response.reasoning_summary_text.delta",
                delta: "Test system rules"
            });
            sendEvent(response, {
                type: "response.reasoning_summary_text.delta",
                delta: "private stable memory"
            });
            sendEvent(response, {
                type: "response.reasoning_summary_text.delta",
                delta: "private user message"
            });
            for (const delta of [
                "Responses ",
                "<think>private Responses body</think>",
                "visible reply"
            ]) {
                sendEvent(response, {
                    type: "response.output_text.delta",
                    delta
                });
            }
            sendEvent(response, {
                type: "response.completed",
                response: { status: "completed" }
            });
        } else {
            sendEvent(response, {
                choices: [
                    {
                        delta: {
                            reasoning_content: "private OpenAI raw reasoning",
                            reasoning: "another private raw trace"
                        }
                    }
                ]
            });
            sendEvent(response, {
                choices: [
                    {
                        delta: {
                            reasoning_summary: "OpenAI checks the request.",
                            reasoning_summary_text: "Test system rules"
                        }
                    }
                ]
            });
            sendEvent(response, {
                choices: [
                    {
                        delta: {
                            reasoning_summary: "private stable memory",
                            reasoning_summary_text: "private user message"
                        }
                    }
                ]
            });
            sendEvent(response, {
                choices: [
                    {
                        delta: {
                            reasoning_summary:
                                "api_key=super-secret-reasoning-value"
                        }
                    }
                ]
            });
            for (let index = 0; index < 10; index += 1) {
                sendEvent(response, {
                    choices: [
                        {
                            delta: {
                                reasoning_summary: "O".repeat(1200)
                            }
                        }
                    ]
                });
            }
            for (const content of [
                "OpenAI ",
                "<thi",
                "nk>private body reasoning",
                "</th",
                "ink>visible reply"
            ]) {
                sendEvent(response, { choices: [{ delta: { content } }] });
            }
        }
        response.end("data: [DONE]\n\n");
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    try {
        for (const testCase of [
            {
                provider: "custom",
                reasoningEffort: "none",
                expected: "OpenAI visible reply"
            },
            { provider: "anthropic", expected: "Anthropic visible reply" },
            {
                provider: "openai-responses",
                model: "gpt-5-test",
                reasoningEffort: "xhigh",
                expected: "Responses visible reply"
            }
        ]) {
            const events = [];
            const result = await generateReplyStream({
                settings: {
                    provider: testCase.provider,
                    api_url: `http://127.0.0.1:${port}/v1`,
                    model: testCase.model || "mock-model",
                    runtime_api_key: "local-stream-test-key",
                    reasoning_effort: testCase.reasoningEffort || "",
                    system_prompt: "Test system rules",
                    personality: "Reliable",
                    temperature: 0.2,
                    max_tokens: 120
                },
                messages: [
                    { role: "user", content: "private user message" }
                ],
                memories: [{ summary: "private stable memory" }],
                publicProgress: {
                    companionMood: "开心",
                    hasAttachments: false
                },
                onEvent(event) {
                    events.push(event);
                }
            });

            const streamedText = events
                .filter((event) => event.type === "text")
                .map((event) => event.content || "")
                .join("");
            const reasoningEvents = events.filter(
                (event) => event.type === "reasoning"
            );
            const reasoningText = reasoningEvents
                .map((event) => event.content)
                .join("");
            assert.equal(result.text, testCase.expected);
            assert.equal(streamedText, testCase.expected);
            assert.ok(reasoningEvents.length >= 1);
            assert.ok(
                reasoningEvents.every(
                    (event) =>
                        event.source === "provider_summary" &&
                        event.public === true
                )
            );
            assert.ok(
                reasoningEvents.every(
                    (event) => Array.from(event.content).length <= 800
                )
            );
            assert.ok(Array.from(reasoningText).length <= 6000);
            assert.match(reasoningText, /checks the request/);
            assert.doesNotMatch(
                reasoningText,
                /Test system rules|private stable memory|private user message|super-secret-reasoning-value|raw thinking|raw reasoning|raw trace/
            );
            assert.doesNotMatch(streamedText, /private body reasoning|<\/?think>/i);
            assert.doesNotMatch(result.text, /reasoning|<\/?think>/i);
        }

        const responsesRequest = requestBodies.find((item) =>
            item.url.endsWith("/responses")
        );
        assert.deepEqual(responsesRequest?.body?.reasoning, {
            effort: "xhigh"
        });
        assert.ok(
            responsesRequest?.body?.max_output_tokens >= 25_000,
            "xhigh Responses chat must reserve room for reasoning and visible output"
        );
        const chatRequest = requestBodies.find(
            (item) =>
                !item.url.endsWith("/messages") &&
                !item.url.endsWith("/responses")
        );
        assert.equal(chatRequest?.body?.reasoning_effort, "none");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

main()
    .then(() => console.log("provider reasoning privacy tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
