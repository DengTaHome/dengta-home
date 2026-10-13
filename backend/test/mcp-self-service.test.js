const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const express = require("express");
const { createRequestScope } = require("../services/request-scope");
const { createMcpDeviceCenter } = require("../services/mcp-device-center");
const { createMcpConnectionsRouter } = require("../routes/mcp-connections");

const rows = [];
const database = { from(table) {
    assert.equal(table, "mcp_connections");
    let operation = "select", values, single = false;
    const filters = [];
    const query = {
        select() { return query; }, order() { return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        insert(value) { operation = "insert"; values = value; return query; },
        update(value) { operation = "update"; values = value; return query; },
        delete() { operation = "delete"; return query; },
        single() { single = true; return query; }, maybeSingle() { single = true; return query; },
        then(resolve, reject) {
            return Promise.resolve().then(() => {
                let selected = rows.filter((row) => filters.every(([key, value]) => row[key] === value));
                if (operation === "insert") { const row = { id: randomUUID(), ...values }; rows.push(row); selected = [row]; }
                if (operation === "update") selected.forEach((row) => Object.assign(row, values));
                if (operation === "delete") selected.forEach((row) => rows.splice(rows.indexOf(row), 1));
                return { data: structuredClone(single ? selected[0] || null : selected), error: null };
            }).then(resolve, reject);
        }
    };
    return query;
} };
function makeScope(userId, companionId = randomUUID()) {
    const companion = { id: companionId, user_id: userId, status: "active" };
    return createRequestScope({ adminSupabase: database, user: { id: userId }, profile: { id: userId, status: "active", role: "member" }, companion, companions: [companion] });
}
const scopes = { a: makeScope(randomUUID()), b: makeScope(randomUUID()) };
scopes.c = makeScope(scopes.a.userId);
let toolCalls = 0;
const tool = { name: "search_memory", description: "Search saved memories by query", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } };
const center = createMcpDeviceCenter({
    supabase: database, env: { NODE_ENV: "production", MCP_ENCRYPTION_KEY: "fixture-encryption-key-that-is-long-enough" },
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (body.method === "initialize") return Response.json({ id: body.id, result: { protocolVersion: "2025-11-25", serverInfo: { name: "Memory fixture" } } });
        if (body.method === "tools/list") return Response.json({ id: body.id, result: { tools: [tool] } });
        assert.equal(body.method, "tools/call");
        toolCalls++;
        return Response.json({ id: body.id, result: { structuredContent: { memories: ["A fixture memory"] } } });
    }
});

(async () => {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.scope = scopes[req.headers.authorization]; next(); });
    app.use("/mcp", createMcpConnectionsRouter({ center }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.code }));
    const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    async function request(path, method = "GET", body, account = "a") {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp${path}`, { method, headers: { Authorization: account, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, data: await response.json() };
    }
    try {
        assert.equal((await request("/manage", "GET", null, "anonymous")).status, 401);
        const created = await request("/manage", "POST", { name: "My memory", endpoint: "https://memory.example.test/mcp", provider_profile: "memory_mcp", auth_type: "bearer", credential: "private-fixture-token", user_id: scopes.b.userId });
        assert.equal(created.status, 201);
        const connection = created.data.connection;
        assert.equal(connection.provider_profile, "memory_mcp");
        assert.equal(connection.enabled, false);
        assert.equal(connection.tool_policies.search_memory, "disabled");
        assert.equal(rows[0].user_id, scopes.a.userId, "body cannot change ownership");
        assert.ok(!JSON.stringify(created).includes("private-fixture-token"));
        assert.ok(!JSON.stringify(created).includes("secret_ciphertext"));
        assert.equal((await center.forDatabase(scopes.a.db).createRuntime()).tools.length, 0);
        assert.equal((await request(`/manage/${connection.id}`, "PUT", { enabled: true })).status, 400, "enabling needs explicit tool authorization");
        for (const account of ["b", "c"]) {
            assert.deepEqual((await request("/manage", "GET", null, account)).data.connections, []);
            assert.equal((await request(`/manage/${connection.id}`, "PUT", { enabled: true }, account)).status, 404);
            assert.equal((await request(`/manage/${connection.id}/test`, "POST", {}, account)).status, 404);
            assert.equal((await request(`/manage/${connection.id}`, "DELETE", null, account)).status, 404);
        }
        const updated = await request(`/manage/${connection.id}`, "PUT", { enabled: true, tool_policies: { search_memory: "auto" } });
        assert.equal(updated.status, 200);
        const runtime = await center.forDatabase(scopes.a.db).createRuntime();
        assert.equal(runtime.tools.length, 1);
        assert.match(runtime.tools[0].description, /Search saved memories by query/);
        const result = await runtime.execute({ name: runtime.tools[0].name, arguments: JSON.stringify({ query: "fixture" }) });
        assert.equal(result.ok, true);
        assert.equal(result.untrusted_external_result, true);
        assert.match(result.output, /A fixture memory/);
        assert.equal(toolCalls, 1);
        assert.equal((await request(`/manage/${connection.id}`, "DELETE")).status, 200);
        assert.equal(rows.length, 0);
        console.log("MCP member self-service HTTP CRUD, scoped runtime and cross-account/companion isolation passed");
    } finally { await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
