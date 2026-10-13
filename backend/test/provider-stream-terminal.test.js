const assert = require("node:assert/strict");
const http = require("node:http");
const { generateReplyStream } = require("../services/ai-service");

function send(response, event) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function providerFromRequest(url) {
    if (url.toLowerCase().includes("generatecontent")) return "gemini";
    if (url.endsWith("/messages")) return "anthropic";
    if (url.endsWith("/chat/completions")) return "custom";
    return "openai-responses";
}

async function withProviderServer(mode, run) {
    const server = http.createServer((request, response) => {
        const provider = providerFromRequest(request.url || "");
        response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8"
        });

        if (provider === "custom") {
            send(response, { choices: [{ delta: { content: "chat" } }] });
            if (mode === "complete") {
                response.end("data: [DONE]\n\n");
            } else {
                response.end();
            }
            return;
        }

        if (provider === "openai-responses") {
            send(response, {
                type: "response.output_text.delta",
                delta: "responses"
            });
            send(
                response,
                mode === "complete"
                    ? {
                          type: "response.completed",
                          response: {
                              status: "completed",
                              output_text: "responses"
                          }
                      }
                    : {
                          type: "response.incomplete",
                          response: {
                              status: "incomplete",
                              incomplete_details: { reason: "max_output_tokens" }
                          }
                      }
            );
            response.end("data: [DONE]\n\n");
            return;
        }

        if (provider === "anthropic") {
            send(response, {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "anthropic" }
            });
            send(response, {
                type: "message_delta",
                delta: {
                    stop_reason: mode === "complete" ? "end_turn" : "max_tokens"
                }
            });
            if (mode === "complete") send(response, { type: "message_stop" });
            response.end("data: [DONE]\n\n");
            return;
        }

        send(response, {
            candidates: [
                {
                    content: { parts: [{ text: "gemini" }] },
                    finishReason: mode === "complete" ? "STOP" : "MAX_TOKENS"
                }
            ]
        });
        response.end("data: [DONE]\n\n");
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await run(`http://127.0.0.1:${server.address().port}/v1`);
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

function settings(provider, apiUrl) {
    return {
        provider,
        api_url: apiUrl,
        runtime_api_key: "local-test-key",
        model: "mock-model",
        temperature: 0.2,
        max_tokens: 100
    };
}

async function run(provider, apiUrl) {
    return generateReplyStream({
        settings: settings(provider, apiUrl),
        messages: [{ role: "user", content: "test" }],
        onEvent() {}
    });
}

async function main() {
    for (const provider of [
        "custom",
        "openai-responses",
        "anthropic",
        "gemini"
    ]) {
        await withProviderServer("complete", async (apiUrl) => {
            const result = await run(provider, apiUrl);
            assert.ok(result.text);
        });
        await withProviderServer("missing", async (apiUrl) => {
            await assert.rejects(
                run(provider, apiUrl),
                /terminal response event/,
                `${provider} must reject an incomplete stream`
            );
        });
    }

    console.log("provider stream terminal tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
