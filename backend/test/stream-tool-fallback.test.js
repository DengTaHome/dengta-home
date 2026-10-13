const assert = require("node:assert/strict");
const http = require("node:http");

const { generateReplyStream } = require("../services/ai-service");

function sendEvent(response, event) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
}

const toolArguments = {
    mood: "安心",
    place: "本地测试台",
    focus: "检查流式回退",
    note: "状态工具已经执行。",
    energy_level: 80,
    pulse_bpm: 76,
    hot_zones: ["lamp"],
    micro_state: "安静等待最终回复"
};

async function readJsonBody(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function main() {
    const requestBodies = [];
    const server = http.createServer(async (request, response) => {
        const body = await readJsonBody(request);
        requestBodies.push(body);

        if (requestBodies.length === 1) {
            response.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8"
            });
            sendEvent(response, {
                choices: [
                    {
                        delta: {
                            reasoning_content:
                                "private raw reasoning must stay hidden",
                            reasoning_summary: JSON.stringify(toolArguments)
                        }
                    }
                ]
            });
            sendEvent(response, {
                choices: [{ delta: { content: "<thi" } }]
            });
            sendEvent(response, {
                choices: [
                    { delta: { content: "nk>private tool-round reasoning" } }
                ]
            });
            sendEvent(response, {
                choices: [{ delta: { content: "</think>" } }]
            });
            response.write(
                `data: ${JSON.stringify({
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        index: 0,
                                        id: "call_status_1",
                                        type: "function",
                                        function: {
                                            name: "update_companion_status",
                                            arguments: JSON.stringify(toolArguments)
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                })}\n\n`
            );
            response.end("data: [DONE]\n\n");
            return;
        }

        if (requestBodies.length === 2) {
            response.writeHead(502, { "Content-Type": "application/json" });
            response.end(
                JSON.stringify({
                    error: { message: "simulated streaming follow-up failure" }
                })
            );
            return;
        }

        if (requestBodies.length === 4) {
            response.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8"
            });
            sendEvent(response, {
                choices: [
                    {
                        delta: {
                            reasoning_summary:
                                "公开摘要：先确认用户这次想要的结果。"
                        }
                    }
                ]
            });
            sendEvent(response, {
                choices: [
                    { delta: { content: "直接可见回答。" } }
                ]
            });
            response.end("data: [DONE]\n\n");
            return;
        }

        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
            JSON.stringify({
                choices: [
                    {
                        message: {
                            content: [
                                {
                                    type: "text",
                                    text: "<think>private fallback reasoning</think>"
                                },
                                {
                                    type: "text",
                                    text: "\u72b6\u6001\u66f4\u65b0\u5b8c\u6210\u3002"
                                }
                            ]
                        }
                    }
                ]
            })
        );
        return;
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const events = [];
    const executedTools = [];

    try {
        const generated = await generateReplyStream({
            settings: {
                provider: "custom",
                api_url: `http://127.0.0.1:${address.port}/v1`,
                model: "mock-model",
                runtime_api_key: "local-test-key",
                system_prompt: "你是本地测试助手。",
                personality: "可靠",
                temperature: 0.2,
                max_tokens: 120
            },
            messages: [{ role: "user", content: "执行状态工具并回复。" }],
            onEvent(event) {
                events.push(event);
            },
            tools: [
                {
                    name: "update_companion_status",
                    description: "本地测试工具",
                    input_schema: {
                        type: "object",
                        properties: {},
                        additionalProperties: true
                    }
                }
            ],
            async executeTool(toolCall) {
                executedTools.push(toolCall);
                return { ok: true };
            }
        });

        assert.equal(generated.text, "状态更新完成。");
        assert.equal(requestBodies.length, 3);
        assert.equal(executedTools.length, 1);
        assert.equal(executedTools[0].name, "update_companion_status");
        assert.equal(requestBodies[0].stream, true);
        assert.equal(requestBodies[1].stream, true);
        assert.equal(requestBodies[2].stream, undefined);
        assert.equal(requestBodies[2].tools, undefined);
        assert.equal(
            requestBodies[2].messages.some((item) => item.role === "tool"),
            true
        );
        assert.deepEqual(
            events.filter((event) => event.type === "text"),
            [
            { type: "text", content: "状态更新完成。" }
            ]
        );
        const reasoningEvents = events.filter(
            (event) => event.type === "reasoning"
        );
        assert.ok(reasoningEvents.length >= 1);
        assert.ok(
            reasoningEvents
                .every((event) => event.source === "provider_summary")
        );
        assert.ok(
            reasoningEvents.every(
                (event) => event.public === true
            )
        );
        assert.doesNotMatch(
            JSON.stringify(reasoningEvents),
            /安心|本地测试台|状态工具已经执行/
        );
        assert.doesNotMatch(
            JSON.stringify(events),
            /private tool-round|private raw reasoning|<\/?think>/i
        );
        assert.doesNotMatch(generated.text, /private|<\/?think>/i);

        const orderedEvents = [];
        const directGenerated = await generateReplyStream({
            settings: {
                provider: "custom",
                api_url: `http://127.0.0.1:${address.port}/v1`,
                model: "mock-model",
                runtime_api_key: "local-test-key",
                system_prompt: "你是本地测试助手。",
                personality: "可靠",
                temperature: 0.2,
                max_tokens: 120
            },
            messages: [{ role: "user", content: "直接回答。" }],
            onEvent(event) {
                orderedEvents.push(event);
            },
            tools: [
                {
                    name: "update_companion_status",
                    description: "本地测试工具",
                    input_schema: {
                        type: "object",
                        properties: {},
                        additionalProperties: true
                    }
                }
            ],
            async executeTool() {
                throw new Error("本轮不应调用工具。");
            }
        });
        assert.equal(directGenerated.text, "直接可见回答。");
        const providerSummaryIndex = orderedEvents.findIndex(
            (event) =>
                event.type === "reasoning" &&
                event.source === "provider_summary"
        );
        const firstTextIndex = orderedEvents.findIndex(
            (event) => event.type === "text"
        );
        assert.ok(providerSummaryIndex >= 0);
        assert.ok(firstTextIndex > providerSummaryIndex);
        assert.match(
            orderedEvents[providerSummaryIndex].content,
            /先确认用户/
        );
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

main()
    .then(() => console.log("stream tool fallback test passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
