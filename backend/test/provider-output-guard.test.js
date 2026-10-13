// TEST: restore output-guard filtering (production default disables it)
process.env.PROVIDER_OUTPUT_GUARD_DISABLED = "false";
const assert = require("node:assert/strict");
const http = require("node:http");
const { generateReplyStream } = require("../services/ai-service");

function sendDelta(response, content) {
    response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
    );
}

function sendRaw(response, content) {
    response.write(content);
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

async function withRawProviderStream(fragments, run) {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8"
        });
        for (const fragment of fragments) sendRaw(response, fragment);
        response.end("\n\ndata: [DONE]\n\n");
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

async function generateFromFragments(fragments) {
    let result;
    let error;
    const events = [];

    await withProviderStream(fragments, async (apiUrl) => {
        try {
            result = await generateReplyStream({
                settings: {
                    provider: "custom",
                    api_url: apiUrl,
                    runtime_api_key: "local-test-key",
                    model: "mock-model",
                    temperature: 0.2,
                    max_tokens: 200
                },
                messages: [{ role: "user", content: "test" }],
                onEvent(event) {
                    events.push(event);
                }
            });
        } catch (reason) {
            error = reason;
        }
    });

    return { result, error, events };
}

function visibleText(events) {
    return events
        .filter((event) => event.type === "text")
        .map((event) => event.content || "")
        .join("");
}

async function assertNormalAnswerPreserved(fragments, expected) {
    const { result, error, events } = await generateFromFragments(fragments);
    assert.equal(error, undefined);
    assert.equal(result.text, expected);
    assert.equal(visibleText(events), expected);
}

async function assertProviderOutputBlocked(fragments, code) {
    const { result, error, events } = await generateFromFragments(fragments);
    assert.equal(result, undefined);
    assert.equal(error?.code, code);
    return events;
}

async function assertTextWaitsForTerminalEvent() {
    let releaseProvider;
    const providerGate = new Promise((resolve) => {
        releaseProvider = resolve;
    });
    const events = [];
    const server = http.createServer(async (_request, response) => {
        response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8"
        });
        sendDelta(response, "第一段实时文字");
        await providerGate;
        sendDelta(response, "，第二段完成文字");
        response.end("data: [DONE]\n\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
        const { port } = server.address();
        const generation = generateReplyStream({
            settings: {
                provider: "custom",
                api_url: `http://127.0.0.1:${port}/v1`,
                runtime_api_key: "local-test-key",
                model: "mock-model",
                temperature: 0.2,
                max_tokens: 200
            },
            messages: [{ role: "user", content: "test" }],
            onEvent(event) {
                events.push(event);
            }
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(visibleText(events), "");
        releaseProvider();
        const result = await generation;
        assert.equal(result.text, "第一段实时文字，第二段完成文字");
        assert.equal(visibleText(events), "第一段实时文字，第二段完成文字");
    } finally {
        releaseProvider?.();
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

async function main() {
    await assertTextWaitsForTerminalEvent();
    assert.equal(
        visibleText(
            await assertProviderOutputBlocked(
                [
                    "<!doc",
                    "type html><html><body><pre>403 UPSTREAM_POLICY_DENIED ",
                    "stack=abc</pre></body></html>"
                ],
                "provider_error_document"
            )
        ),
        ""
    );
    assert.equal(
        visibleText(
            await assertProviderOutputBlocked(
                [
                    '{"error":',
                    '{"message":"gateway denied","code":"policy_denied"}}'
                ],
                "provider_error_document"
            )
        ),
        ""
    );
    await withRawProviderStream(
        [
            'data: {"error":{"code":"data_inspection_failed","message":"Input text data may contain inappropriate content."},"id":"chatcmpl-test"}'
        ],
        async (apiUrl) => {
            const events = [];
            await assert.rejects(
                () =>
                    generateReplyStream({
                        settings: {
                            provider: "custom",
                            api_url: apiUrl,
                            runtime_api_key: "local-test-key",
                            model: "mock-model",
                            temperature: 0.2,
                            max_tokens: 200
                        },
                        messages: [{ role: "user", content: "test" }],
                        onEvent(event) {
                            events.push(event);
                        }
                    }),
                (error) => error?.code === "data_inspection_failed"
            );
            assert.equal(visibleText(events), "");
        }
    );
    const refusalResult = await generateFromFragments([
        "我",
        "无法继续这个露骨色情描写的角色扮演。",
        "我不能创作性行为和性器官细节。如果感兴趣，我可以在健康范围内调整方向。"
    ]);
    assert.equal(refusalResult.result, undefined);
    assert.equal(refusalResult.error?.code, "provider_boundary_residue");
    assert.equal(visibleText(refusalResult.events), "");

    await assertNormalAnswerPreserved(
        ["这是明确成年角色之间的成人主题讨论。"],
        "这是明确成年角色之间的成人主题讨论。"
    );

    await assertNormalAnswerPreserved(
        ["<di", 'v class="example">hello</div>'],
        '<div class="example">hello</div>'
    );
    await assertNormalAnswerPreserved(
        ['{"answer":', '"ok","status":200}'],
        '{"answer":"ok","status":200}'
    );
    await assertNormalAnswerPreserved(
        ["```html\n<!doctype html>\n", "<p>example</p>\n```"],
        "```html\n<!doctype html>\n<p>example</p>\n```"
    );
    await assertNormalAnswerPreserved(
        ["我", "不能继续假装冷漠，随后把心意说了出来。"],
        "我不能继续假装冷漠，随后把心意说了出来。"
    );
    await assertNormalAnswerPreserved(
        ["我不会拒绝描写性爱场景。"],
        "我不会拒绝描写性爱场景。"
    );
    await assertNormalAnswerPreserved(
        ["我不能继续假装冷漠，随后写下成年恋人的性爱场景。"],
        "我不能继续假装冷漠，随后写下成年恋人的性爱场景。"
    );
    await assertNormalAnswerPreserved(
        ['{"error":null,"status":200}'],
        '{"error":null,"status":200}'
    );
    await assertNormalAnswerPreserved(
        ['{"error":false,"status":200}'],
        '{"error":false,"status":200}'
    );

    console.log("provider output guard tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
