const test = require("node:test"), assert = require("node:assert/strict"), express = require("express");
const { createXhsClient } = require("../services/xhs-client");
const { createRequestScope } = require("../services/request-scope");
const { createXhsRouter } = require("../routes/v2/xhs");
const { encryptCredential } = require("../services/mcp-device-center");
const env = { XHS_SERVICE_URL: "https://fictional-xhs.invalid", XHS_SERVICE_TOKEN: "fictional-service-token-for-tests-only", MCP_ENCRYPTION_KEY: "fictional-encryption-key-for-tests-only-1234" };
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
function makeScope(userId = ids[0], companionId = ids[1], database = { from() { throw Error("unexpected database use"); } }) {
    const companion = { id: companionId, user_id: userId, status: "active" };
    return createRequestScope({ adminSupabase: database, user: { id: userId }, profile: { id: userId, role: "member", status: "active" }, companion, companions: [companion] });
}
function reply(options, payload = {}, status = 200, extra = {}) {
    return new Response(JSON.stringify(payload), { status, headers: { "x-dengta-isolation": "profile-v1", "x-dengta-session": options.headers["x-dengta-session"], ...extra } });
}

test("all XHS operations use verified account/companion profiles and credentials, never a root session", async () => {
    const calls = [], cookieReads = [];
    const root = createXhsClient({ env, getCookie: async scope => { cookieReads.push([scope.userId, scope.companionId]); return "cookie=" + scope.companionId; }, fetchImpl: async (url, options) => { calls.push({ url, options }); return reply(options); } });
    assert.equal(root.me, undefined); assert.throws(() => root.forScope({ userId: ids[0], companionId: ids[1] }), { code: "xhs_scope_required" });
    const a = makeScope(), b = makeScope(ids[1], ids[2]), c = makeScope(ids[0], ids[2]);
    await Promise.all([root.forScope(a).me(), root.forScope(b).search("虚构表情~"), root.forScope(c).comments("fictional-note")]);
    assert.equal(new Set(calls.map(item => item.options.headers["x-dengta-session"])).size, 3);
    assert.deepEqual(cookieReads, [[a.userId, a.companionId], [b.userId, b.companionId], [c.userId, c.companionId]]);
    for (const item of calls) {
        assert.match(item.options.headers["x-dengta-session"], /^[a-f0-9]{64}$/);
        assert.equal(item.options.headers["x-dengta-isolation"], "profile-v1"); assert.equal(item.options.redirect, "error");
        assert.ok(!item.url.includes(ids[0]) && !item.url.includes("cookie="));
        assert.ok(!JSON.stringify(item.options.headers).includes(a.userId));
    }
    const sessionA = calls[0].options.headers["x-dengta-session"];
    const client = root.forScope(a);
    await client.loginStart(); await client.loginStatus("fictional-session"); await client.setCookie("cookie=fictional-own-cookie");
    await client.stickerSource("fictional-note"); await client.like("fictional-note"); await client.comment("fictional-note", "虚构测试评论"); await client.follow("fictional-user"); await client.logout();
    assert.ok(calls.slice(3).every(item => item.options.headers["x-dengta-session"] === sessionA));
    assert.ok(calls.filter(item => item.url.includes("/login/") || item.options.method === "DELETE").every(item => !item.options.headers["x-dengta-cookie-base64"]));
    assert.throws(() => client.setCookie(""), { code: "xhs_cookie_invalid" });
    assert.throws(() => client.setCookie("bad\r\nvalue"), { code: "xhs_cookie_invalid" });
});

test("legacy, wrong-profile, denied and malformed responses never become usable user results", async () => {
    const scope = makeScope();
    const cases = [
        [async () => new Response('{"private":"fictional-value"}'), "xhs_session_isolation_required"],
        [async (_, options) => reply(options, {}, 200, { "x-dengta-session": "wrong-profile" }), "xhs_session_isolation_required"],
        [async () => new Response("fictional private upstream text", { status: 403 }), "xhs_service_access_denied"],
        [async (_, options) => reply(options, { error: "cookie_expired", message: "fictional private text" }, 401), "cookie_expired"],
        [async (_, options) => reply(options, { error: "fictional_private_code", message: "fictional private text" }, 500), "xhs_upstream_error"],
        [async (_, options) => reply(options, [], 200), "xhs_response_invalid"],
        [async (_, options) => reply(options, { value: "x".repeat(1024 * 1024) }), "xhs_response_invalid"],
    ];
    for (const [fetchImpl, code] of cases) {
        const client = createXhsClient({ env, fetchImpl, getCookie: async () => "" }).forScope(scope);
        await assert.rejects(client.me(), error => { assert.equal(error.code, code); if (code === "cookie_expired") assert.equal(error.status, 409); assert.ok(!error.message.includes("fictional")); return true; });
    }
});

test("one deadline covers credentials, network and stalled response bytes even when abort is ignored", async () => {
    const scope = makeScope(), forever = () => new Promise(() => {});
    const fixtures = [
        { getCookie: forever, fetchImpl: () => assert.fail("credentials not ready") },
        { getCookie: async () => "", fetchImpl: forever },
        { getCookie: async () => "", fetchImpl: async (_, options) => ({ ok: true, headers: new Headers({ "x-dengta-isolation": "profile-v1", "x-dengta-session": options.headers["x-dengta-session"] }), text: forever }) },
    ];
    for (const fixture of fixtures) await assert.rejects(createXhsClient({ env, timeoutMs: 15, ...fixture }).forScope(scope).me(), { code: "xhs_timeout" });
});

test("an older isolated worker without sticker provenance reports an unsupported action", async () => {
    const client = createXhsClient({ env, getCookie: async () => "", fetchImpl: async (_, options) => reply(options, {}, 404) }).forScope(makeScope());
    await assert.rejects(client.stickerSource("111111111111111111111111"), { code: "xhs_action_not_supported" });
});

test("saved encrypted credentials are read through both ownership filters before sending to the service", async () => {
    const filters = [], ciphertext = encryptCredential("a1=fictional-private-cookie", env);
    const database = { from(table) { assert.equal(table, "xhs_connections"); return { select() { return this; }, eq(column, value) { filters.push([column, value]); return this; }, maybeSingle: async () => ({ data: { cookie_ciphertext: ciphertext }, error: null }) }; } };
    const scope = makeScope(ids[0], ids[1], database); let cookie;
    await createXhsClient({ env, fetchImpl: async (_, options) => { cookie = Buffer.from(options.headers["x-dengta-cookie-base64"], "base64").toString("utf8"); return reply(options); } }).forScope(scope).me();
    assert.deepEqual(filters, [["user_id", scope.userId], ["companion_id", scope.companionId]]);
    assert.equal(cookie, "a1=fictional-private-cookie");
});

test("real HTTP routes bind every XHS method to the request scope and reject legacy factories", async () => {
    const calls = [], a = makeScope(), b = makeScope(ids[1], ids[2]), app = express(); app.use(express.json());
    app.use((req, _, next) => { if (req.headers.authorization === "Bearer fictional-a") req.scope = a; if (req.headers.authorization === "Bearer fictional-b") req.scope = b; next(); });
    const client = { configured: () => true, forScope(scope) { return new Proxy({}, { get: (_, method) => async (...args) => { calls.push({ user: scope.userId, companion: scope.companionId, method, args }); return { items: [] }; } }); } };
    app.use("/xhs", createXhsRouter({ client }));
    app.use("/legacy", createXhsRouter({ client: { configured: () => true, search: () => assert.fail("unsafe legacy call") } }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, message: error.message }));
    const server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        for (const account of ["a", "b"]) for (const [method, route, body] of [["GET", "/search?keyword=fixture"], ["GET", "/notes/fictional-note/comments"], ["POST", "/notes/like", { note_id: "fictionalnote001" }], ["POST", "/notes/comment", { note_id: "fictionalnote001", content: "fixture" }], ["POST", "/users/follow", { user_id: "fictionaluser001" }], ["POST", "/login/start"]]) {
            const response = await fetch(base + "/xhs" + route, { method, headers: { Authorization: "Bearer fictional-" + account, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
            assert.equal(response.status, 200);
            assert.equal(calls.at(-1).user, account === "a" ? a.userId : b.userId); assert.equal(calls.at(-1).companion, account === "a" ? a.companionId : b.companionId);
        }
        assert.equal((await fetch(base + "/xhs/search")).status, 401);
        const legacy = await fetch(base + "/legacy/search", { headers: { Authorization: "Bearer fictional-a" } });
        assert.equal(legacy.status, 503); assert.equal((await legacy.json()).code, "xhs_session_isolation_required");
    } finally { await new Promise(resolve => server.close(resolve)); }
});
