const assert = require("node:assert/strict");
const { createOmbreMcpClient, extractMcpText } = require("../services/ombre-mcp");

function clientFor(handler) {
    const calls = [];
    const client = createOmbreMcpClient({
        env: { NODE_ENV: "test" },
        config: { endpoint: "https://memory.example.test/mcp", protocolVersion: "2025-11-25" },
        fetchImpl: async (_url, options) => {
            const body = JSON.parse(options.body);
            calls.push(body);
            if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture" }, capabilities: { tools: {} } } }, { headers: { "mcp-session-id": "session-fixture" } });
            assert.equal(options.headers["MCP-Protocol-Version"], "2025-06-18");
            if (!body.id) return new Response(null, { status: 202 });
            return handler(body);
        }
    });
    return { client, calls };
}

(async () => {
    const paged = clientFor((body) => Response.json({ jsonrpc: "2.0", id: body.id, result: body.params.cursor
        ? { tools: [{ name: "remember" }] }
        : { tools: [{ name: "recall" }], nextCursor: "page2" } }));
    assert.deepEqual((await paged.client.listTools()).map((tool) => tool.name), ["recall", "remember"]);
    assert.equal(paged.calls.at(-1).params.cursor, "page2");

    const loop = clientFor((body) => Response.json({ id: body.id, result: { tools: [], nextCursor: "same" } }));
    await assert.rejects(loop.client.listTools(), { code: "MCP_PAGINATION_INVALID" });
    assert.equal(loop.calls.filter((call) => call.method === "tools/list").length, 2);
    const oversized = clientFor((body) => Response.json({ id: body.id, result: {
        tools: Array.from({ length: 1001 }, (_, index) => ({ name: `tool_${index}` }))
    } }));
    await assert.rejects(oversized.client.listTools(), { code: "MCP_PAGINATION_INVALID" });

    for (const status of [400, 409, 500]) {
        const failure = clientFor(() => new Response("private body", { status }));
        await assert.rejects(failure.client.callTool("remember", {}));
        assert.equal(failure.calls.filter((call) => call.method === "tools/call").length, 1, "never replay a possibly executed write");
    }
    const rpcFailure = clientFor((body) => Response.json({ id: body.id, error: { code: -32603, message: "write may have completed" } }));
    await assert.rejects(rpcFailure.client.callTool("remember", {}), { code: "OMBRE_MCP_RPC_ERROR" });
    assert.equal(rpcFailure.calls.filter((call) => call.method === "tools/call").length, 1);

    let expired = true;
    const renewal = clientFor((body) => {
        if (expired) { expired = false; return new Response(null, { status: 404 }); }
        return Response.json({ id: body.id, result: { content: [{ type: "text", text: "saved" }] } });
    });
    assert.equal((await renewal.client.callTool("remember", {})).text, "saved");
    assert.equal(renewal.calls.filter((call) => call.method === "initialize").length, 2);

    let cancelled = false;
    const streaming = clientFor((body) => new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: {"jsonrpc":"2.0","method":"notifications/message"}\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { memories: ["fixture"] } } })}\n\n`));
            // Intentionally keep the SSE connection open after its response.
        },
        cancel() { cancelled = true; }
    }), { headers: { "content-type": "text/event-stream" } }));
    assert.equal((await streaming.client.callTool("recall", {})).text, '{"memories":["fixture"]}');
    assert.equal(cancelled, true);
    assert.equal(extractMcpText({ structuredContent: { found: 1 } }), '{"found":1}');

    const mismatch = clientFor(() => Response.json({ id: 99999, result: {} }));
    await assert.rejects(mismatch.client.listTools(), { code: "OMBRE_MCP_RESPONSE_INVALID" });
    console.log("MCP pagination, SSE completion, negotiated headers and no duplicate write tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
