const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    createOmbreMcpClient,
    extractMcpText,
    parseMcpPayload,
    publicMcpConfig
} = require("../services/ombre-mcp");

function jsonResponse(value, { status = 200, headers = {} } = {}) {
    return new Response(JSON.stringify(value), { status, headers });
}

assert.deepEqual(parseMcpPayload('{"jsonrpc":"2.0","result":{"ok":true}}'), {
    jsonrpc: "2.0",
    result: { ok: true }
});

const parsedSse = parseMcpPayload(
    [
        "event: message",
        'data: {"jsonrpc":"2.0","result":{"tools":[{"name":"breath"}]}}',
        "",
        "event: ping",
        "data: not-json"
    ].join("\n")
);
assert.equal(parsedSse.result.tools[0].name, "breath");
assert.equal(
    extractMcpText({
        result: {
            content: [
                { type: "text", text: "第一段" },
                { type: "json", json: { remembered: true } }
            ]
        }
    }),
    '第一段\n{"remembered":true}'
);

const routeSource = fs.readFileSync(
    path.join(__dirname, "..", "routes", "ombre-dashboard.js"),
    "utf8"
);
assert.match(routeSource, /router\.get\("\/mcp\/status"/);
assert.doesNotMatch(routeSource, /router\.post\("\/mcp/);

const calls = [];
const responses = [
    jsonResponse(
        {
            jsonrpc: "2.0",
            id: 1,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "Ombre Brain", version: "1.0.0" }
            }
        },
        { headers: { "mcp-session-id": "session-1" } }
    ),
    new Response("", { status: 202 }),
    new Response(
        [
            "event: message",
            'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"breath","description":"recall","inputSchema":{"type":"object","properties":{}}},{"name":"hold","description":"remember","inputSchema":{"type":"object","properties":{}}}]}}',
            ""
        ].join("\n"),
        {
            status: 200,
            headers: { "content-type": "text/event-stream" }
        }
    ),
    jsonResponse({
        jsonrpc: "2.0",
        id: 3,
        result: { content: [{ type: "text", text: "想起一段雨天记忆" }] }
    })
];

const client = createOmbreMcpClient({
    env: {
        NODE_ENV: "test",
        OMBRE_BRAIN_URL: "https://ombre.example.com",
        OMBRE_MCP_TOKEN: "test-token",
        OMBRE_MCP_TIMEOUT_MS: "2000"
    },
    fetchImpl: async (url, options) => {
        calls.push({
            url,
            body: JSON.parse(options.body),
            headers: new Headers(options.headers)
        });
        const response = responses.shift();
        assert.ok(response, "unexpected MCP request");
        return response;
    }
});

(async () => {
    const status = await client.status();
    assert.equal(status.available, true);
    assert.equal(status.session_established, true);
    assert.equal(status.server_name, "Ombre Brain");
    assert.deepEqual(status.tools, ["breath", "hold"]);
    assert.deepEqual(
        calls.slice(0, 3).map((item) => item.body.method),
        ["initialize", "notifications/initialized", "tools/list"]
    );
    assert.equal(calls[0].url, "https://ombre.example.com/mcp");
    assert.equal(calls[0].headers.get("authorization"), "Bearer test-token");
    assert.equal(calls[0].headers.get("mcp-session-id"), null);
    assert.equal(calls[1].headers.get("mcp-session-id"), "session-1");
    assert.equal(calls[2].headers.get("mcp-session-id"), "session-1");

    const toolResult = await client.callTool("breath", { query: "雨天" });
    assert.equal(toolResult.text, "想起一段雨天记忆");
    assert.equal(calls[3].body.method, "tools/call");
    assert.equal(calls[3].body.params.name, "breath");
    assert.deepEqual(calls[3].body.params.arguments, { query: "雨天" });

    let unconfiguredFetches = 0;
    const unconfigured = createOmbreMcpClient({
        env: { NODE_ENV: "test" },
        fetchImpl: async () => {
            unconfiguredFetches += 1;
            throw new Error("must not fetch");
        }
    });
    const waiting = await unconfigured.status();
    assert.equal(waiting.configured, false);
    assert.equal(waiting.available, false);
    assert.equal(unconfiguredFetches, 0);

    const publicConfig = publicMcpConfig({
        OMBRE_BRAIN_URL: "https://ombre.example.com/path",
        OMBRE_MCP_TOKEN: "must-not-be-returned"
    });
    assert.deepEqual(publicConfig, {
        configured: true,
        server: "https://ombre.example.com",
        auth_configured: true,
        protocol_version: "2024-11-05",
        provider_independent: true
    });

    const oversizedToken = "must-never-appear-in-errors";
    const oversizedClient = createOmbreMcpClient({
        env: { NODE_ENV: "test" },
        config: {
            endpoint: "https://ombre.example.com/mcp",
            baseUrl: "https://ombre.example.com/mcp",
            token: oversizedToken,
            maxResponseBytes: 64 * 1024,
            production: false
        },
        fetchImpl: async () =>
            new Response("", {
                status: 200,
                headers: { "content-length": String(65 * 1024) }
            })
    });
    await assert.rejects(
        () => oversizedClient.initialize(),
        (error) =>
            error.code === "OMBRE_MCP_RESPONSE_TOO_LARGE" &&
            !String(error.message).includes(oversizedToken)
    );

    console.log("Ombre MCP client tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
