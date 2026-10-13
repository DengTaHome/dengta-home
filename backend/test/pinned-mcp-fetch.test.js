const assert = require("node:assert/strict");
const http = require("node:http");
const { createPinnedMcpFetch } = require("../services/pinned-mcp-fetch");
const { isPrivateIp } = require("../services/mcp-device-center");

(async () => {
    const guarded = createPinnedMcpFetch({ lookup: async () => [{ address: "127.0.0.1", family: 4 }], isPrivateIp });
    await assert.rejects(guarded("http://127.0.0.1/mcp"), { code: "MCP_ENDPOINT_PRIVATE" });
    await assert.rejects(guarded("http://[::1]/mcp"), { code: "MCP_ENDPOINT_PRIVATE" });
    await assert.rejects(guarded("file:///mcp"), { code: "MCP_ENDPOINT_INVALID" });
    await assert.rejects(guarded("http://rebound.example.test/mcp"), { code: "MCP_ENDPOINT_PRIVATE" });
    const mixed = createPinnedMcpFetch({ lookup: async () => [{ address: "8.8.8.8", family: 4 }, { address: "::1", family: 6 }], isPrivateIp });
    await assert.rejects(mixed("http://mixed.example.test/mcp"), { code: "MCP_ENDPOINT_PRIVATE" });
    let lookupCount = 0;
    const server = await new Promise((resolve) => {
        const value = http.createServer((req, res) => {
            if (req.url === "/redirect") { res.writeHead(302, { Location: "http://private.internal" }); res.end(); return; }
            res.setHeader("content-type", "application/json"); res.end('{"fixture":true}');
        }).listen(0, "127.0.0.1", () => resolve(value));
    });
    try {
        // Only the transport fixture permits loopback; production uses isPrivateIp above.
        const local = createPinnedMcpFetch({ lookup: async () => { lookupCount++; return [{ address: "127.0.0.1", family: 4 }]; }, isPrivateIp: () => false });
        assert.deepEqual(await (await local(`http://fixture.test:${server.address().port}/mcp`)).json(), { fixture: true });
        assert.equal(lookupCount, 1, "one DNS resolution directly supplies the socket");
        await assert.rejects(local(`http://fixture.test:${server.address().port}/redirect`), { code: "MCP_REDIRECT_BLOCKED" });
        console.log("MCP socket DNS pinning, private-address rejection and redirect blocking passed");
    } finally { await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
