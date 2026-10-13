// TEST: restore output-guard filtering (production default disables it)
process.env.PROVIDER_OUTPUT_GUARD_DISABLED = "false";
const assert = require("node:assert/strict");
const { generateReplyStream } = require("../services/ai-service");

const settings = {
    provider: "custom",
    api_url: "https://provider.example.test/v1",
    runtime_api_key: "local-test-key",
    model: "mock-model",
    temperature: 0.2,
    max_tokens: 120
};

function failedResponse(status, message) {
    return {
        ok: false,
        status,
        async text() {
            return JSON.stringify({ error: { message } });
        }
    };
}

function streamResponse(
    events,
    { failAfterEvents = false, includeDone = true } = {}
) {
    const bytes = new TextEncoder().encode(
        `${events
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join("")}${includeDone ? "data: [DONE]\n\n" : ""}`
    );
    let reads = 0;
    return {
        ok: true,
        status: 200,
        body: {
            getReader() {
                return {
                    async read() {
                        reads += 1;
                        if (reads === 1) return { done: false, value: bytes };
                        if (failAfterEvents) {
                            const error = new TypeError("terminated");
                            error.code = "UND_ERR_SOCKET";
                            throw error;
                        }
                        return { done: true, value: undefined };
                    },
                    releaseLock() {}
                };
            }
        }
    };
}

async function generate(
    events = [],
    onEvent = (event) => events.push(event)
) {
    return generateReplyStream({
        settings,
        messages: [{ role: "user", content: "test" }],
        onEvent
    });
}

async function main() {
    const originalFetch = globalThis.fetch;
    try {
        let requests = 0;
        globalThis.fetch = async () => {
            requests += 1;
            if (requests === 1) {
                return failedResponse(502, "Upstream request failed");
            }
            return streamResponse([
                { choices: [{ delta: { content: "恢复成功" } }] }
            ]);
        };

        const recoveredEvents = [];
        const recovered = await generate(recoveredEvents);
        assert.equal(requests, 2);
        assert.equal(recovered.text, "恢复成功");
        assert.deepEqual(
            recoveredEvents.filter((event) => event.type === "text"),
            [{ type: "text", content: "恢复成功" }]
        );

        for (const status of [408, 429, 500, 502, 503, 504]) {
            requests = 0;
            globalThis.fetch = async () => {
                requests += 1;
                if (requests === 1) {
                    return failedResponse(status, `temporary ${status}`);
                }
                return streamResponse([
                    { choices: [{ delta: { content: "ok" } }] }
                ]);
            };
            assert.equal((await generate()).text, "ok");
            assert.equal(
                requests,
                2,
                `${status} should be retried exactly once`
            );
        }

        for (const status of [400, 401, 403, 404]) {
            requests = 0;
            globalThis.fetch = async () => {
                requests += 1;
                return failedResponse(status, `permanent ${status}`);
            };
            await assert.rejects(
                generate(),
                (error) => error?.upstreamStatus === status
            );
            assert.equal(requests, 1, `${status} must not be retried`);
        }

        requests = 0;
        globalThis.fetch = async () => {
            requests += 1;
            if (requests === 1) {
                const error = new TypeError("fetch failed");
                error.code = "ECONNRESET";
                throw error;
            }
            return streamResponse([
                { choices: [{ delta: { content: "network recovered" } }] }
            ]);
        };
        assert.equal((await generate()).text, "network recovered");
        assert.equal(requests, 2, "connect failures should be retried once");

        requests = 0;
        globalThis.fetch = async () => {
            requests += 1;
            return failedResponse(503, "still unavailable");
        };
        await assert.rejects(generate(), (error) => {
            assert.equal(error?.upstreamStatus, 503);
            assert.equal(error?.providerRetryAttempted, true);
            return true;
        });
        assert.equal(requests, 2, "a second transient failure must be final");

        requests = 0;
        globalThis.fetch = async () => {
            requests += 1;
            return failedResponse(401, "invalid credential");
        };
        await assert.rejects(
            generate(),
            (error) => error?.upstreamStatus === 401
        );
        assert.equal(requests, 1, "configuration errors must not be retried");

        requests = 0;
        globalThis.fetch = async () => {
            requests += 1;
            return streamResponse(
                [{ choices: [{ delta: { content: "partial" } }] }],
                { failAfterEvents: true, includeDone: false }
            );
        };
        const partialEvents = [];
        await assert.rejects(generate(partialEvents), /terminated/);
        assert.equal(
            requests,
            1,
            "a stream must not restart after any provider event was received"
        );
        assert.equal(
            partialEvents.filter((event) => event.type === "text").length,
            0,
            "failed provider streams must not expose partial text"
        );
        assert.equal(partialEvents[0]?.content, undefined);

        requests = 0;
        globalThis.fetch = async () => {
            requests += 1;
            return streamResponse([], {
                failAfterEvents: true,
                includeDone: false
            });
        };
        await assert.rejects(generate(), /terminated/);
        assert.equal(
            requests,
            1,
            "a 200 stream failure must not restart even before its first event"
        );

        requests = 0;
        globalThis.fetch = async () => {
            requests += 1;
            return streamResponse(
                [{ choices: [{ delta: { content: "clean eof" } }] }],
                { includeDone: false }
            );
        };
        await assert.rejects(
            generate(),
            /terminal response event/,
            "a clean EOF without a provider terminal event must fail"
        );
        assert.equal(requests, 1);

        requests = 0;
        globalThis.fetch = async () => {
            requests += 1;
            return streamResponse(
                [
                    { choices: [{ delta: { content: "finish reason" } }] },
                    { choices: [{ delta: {}, finish_reason: "stop" }] }
                ],
                { includeDone: false }
            );
        };
        assert.equal((await generate()).text, "finish reason");
        assert.equal(requests, 1);

        requests = 0;
        globalThis.fetch = async () => {
            requests += 1;
            return streamResponse([
                { choices: [{ delta: { content: "callback" } }] }
            ]);
        };
        const callbackError = new Error("consumer rejected event");
        await assert.rejects(
            generate([], () => {
                throw callbackError;
            }),
            (error) => error === callbackError
        );
        assert.equal(
            requests,
            1,
            "consumer errors must propagate without replaying the request"
        );
    } finally {
        globalThis.fetch = originalFetch;
    }

    console.log("provider stream transient retry tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
