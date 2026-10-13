const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const { publicMessage } = require("../services/chat-attachments");
const { COMPANION_ACTIVITY_TOOL, createCompanionActivities } = require("../services/companion-activities");
const scope = { userId: "fixture-user", companionId: "fixture-companion" };
const call = value => ({ name: COMPANION_ACTIVITY_TOOL.name, arguments: JSON.stringify(value) });

test("activity requests are per turn, per scope and do not execute purchases", async () => {
    const first = createCompanionActivities({ scope });
    const result = await first.execute(call({ activity: "takeout", query: "一碗面" }));
    assert.equal(result.ok, true);
    assert.equal(result.action.kind, "takeout");
    assert.equal(result.action.query, "一碗面");
    assert.equal(Object.hasOwn(result.action, "order_id"), false);
    const again = await first.execute(call({ activity: "takeout", query: "一碗面" }));
    assert.equal(again.action.id, result.action.id); assert.equal(first.getActions().length, 1);
    assert.deepEqual(createCompanionActivities({ scope: { userId: "other", companionId: "other" } }).getActions(), []);
    assert.equal((await createCompanionActivities().execute(call({ activity: "music" }))).code, "activity_scope_required");
    assert.equal((await first.execute(call({ activity: "payment", query: "" }))).code, "activity_arguments_invalid");
    assert.equal((await first.execute(call({ activity: "music", query: {}, extra: true }))).code, "activity_arguments_invalid");
    assert.equal((await first.execute({ arguments: "{broken" })).code, "activity_arguments_invalid");
    await first.execute(call({ activity: "music" }));
    assert.equal((await first.execute(call({ activity: "watch" }))).code, "activity_turn_limit");
});

test("concurrent recommendations share one authenticated read and return canonical cards", async () => {
    let calls = 0;
    const runtime = createCompanionActivities({ scope, recommendations: async tenant => {
        assert.equal(tenant, scope); calls++;
        return { fetched_at: "2026-10-01T00:00:00Z", videos: [{ bvid: "BV1234567890", title: "虚构视频", page_url: "https://www.bilibili.com/video/BV1234567890" }] };
    } });
    const results = await Promise.all([runtime.execute(call({ activity: "bilibili" })), runtime.execute(call({ activity: "bilibili" }))]);
    assert.equal(calls, 1); assert.equal(results[0].action.id, results[1].action.id);
    assert.equal(runtime.getActions()[0].source, "bilibili_homepage");
});

test("art activity is an allowlisted, deduplicated module receipt without generation or settings writes", async () => {
    assert.ok(COMPANION_ACTIVITY_TOOL.input_schema.properties.activity.enum.includes("art"));
    let externalReads = 0;
    const runtime = createCompanionActivities({ scope, recommendations: async () => { externalReads++; throw new Error("unexpected external call"); } });
    const [first, second] = await Promise.all([runtime.execute(call({ activity: "art", query: "想看看你的涂鸦" })), runtime.execute(call({ activity: "art", query: "想看看你的涂鸦" }))]);
    assert.equal(first.ok, true); assert.equal(first.action.kind, "art"); assert.equal(first.action.title, "涂鸦画室");
    assert.equal(first.action.id, second.action.id); assert.equal(runtime.getActions().length, 1); assert.equal(externalReads, 0);
    const receipt = publicMessage({ id: "fictional-art-message", role: "assistant", content: "虚构回复", tool_calls: { activity_actions: runtime.getActions() } });
    assert.equal(receipt.tool_calls.activity_actions[0].kind, "art");
    assert.equal((await runtime.execute(call({ activity: "art", acknowledge_cost: true }))).code, "activity_arguments_invalid");
});

test("failed recommendations remain failure and cannot masquerade as prepared cards", async () => {
    const runtime = createCompanionActivities({ scope, recommendations: async () => { throw Object.assign(new Error("private cookie=fixture"), { code: "bilibili_qr_not_connected" }); } });
    const result = await runtime.execute(call({ activity: "bilibili" }));
    assert.equal(result.code, "bilibili_qr_not_connected"); assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes("cookie=")); assert.equal(runtime.getActions().length, 0);
});

test("real server tool dispatcher receipts survive the public message boundary without credentials", async () => {
    const source = fs.readFileSync(require.resolve("../server"), "utf8");
    const start = source.indexOf("function createChatToolExecutor(");
    const end = source.indexOf("function previousReplySuggestionsFromMessages", start);
    assert.ok(start >= 0 && end > start);
    const context = { createCompanionActivities, COMPANION_ACTIVITY_TOOL, supabase: {},
        createCompanionStickerSelector: () => ({}), createCompanionStickerTool: () => ({}),
        createReplySuggestionSelector: () => ({}), sanitizeCompanionStatusSnapshot: value => value,
        bilibiliQrLogin: { recommendations: async tenant => { assert.equal(tenant, scope); return { videos: [{ bvid: "BV1234567890", title: "虚构视频", cookie: "fictional-private-value", page_url: "javascript:alert(1)" }] }; } }
    };
    vm.runInNewContext(source.slice(start, end), context);
    const runtime = context.createChatToolExecutor("conversation", {}, "request", null, {}, "", [], scope);
    assert.equal((await runtime.executeTool(call({ activity: "bilibili" }))).ok, true);
    const receipt = publicMessage({ id: "message", role: "assistant", content: "虚构正常回复", tool_calls: { activity_actions: runtime.getActivityActions(), private_field: "fictional-secret" } });
    assert.equal(receipt.tool_calls.activity_actions.length, 1);
    assert.equal(receipt.tool_calls.activity_actions[0].videos[0].page_url, "https://www.bilibili.com/video/BV1234567890");
    assert.ok(!JSON.stringify(receipt).includes("fictional-private-value"));
    assert.ok(!JSON.stringify(receipt).includes("fictional-secret"));
    const second = context.createChatToolExecutor("conversation-b", {}, "request-b", null, {}, "", [], { userId: "b", companionId: "cb" });
    assert.equal(second.getActivityActions().length, 0);
    assert.equal(publicMessage({ role: "user", tool_calls: { activity_actions: runtime.getActivityActions() } }).tool_calls, undefined);
});

test("recommendations HTTP route requires a validated scope and preserves retryable errors", async () => {
    const express = require("express");
    const http = require("node:http");
    const { createRequestScope } = require("../services/request-scope");
    const { createCoWatchRouter } = require("../routes/co-watch");
    const userId = "8f4a99b7-338a-4d31-a207-093ec58ac866", companionId = "70aa0a6a-bb20-44ca-b8f4-73f9c547a6d6";
    const companion = { id: companionId, user_id: userId, status: "active" };
    const currentScope = createRequestScope({ adminSupabase: { from() {} }, user: { id: userId }, profile: { id: userId, status: "active", role: "member" }, companions: [companion], companion });
    let called = 0;
    const app = express();
    app.use((req, _res, next) => { if (req.headers['x-fixture-auth'] === 'yes') req.scope = currentScope; next(); });
    app.use('/co-watch', createCoWatchRouter({ bilibiliQr: { recommendations: async (tenant, limit) => {
        assert.equal(tenant, currentScope); called++;
        if (limit === 'fail') throw Object.assign(new Error('fixture error'), { code: 'bilibili_recommendations_risk_blocked', status: 502 });
        return { videos: [] };
    } } }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/co-watch/bilibili-qr/recommendations';
    try {
        assert.equal((await fetch(url)).status, 401); assert.equal(called, 0);
        const response = await fetch(url, { headers: { 'x-fixture-auth': 'yes' } });
        assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
        const failure = await fetch(url + '?limit=fail', { headers: { 'x-fixture-auth': 'yes' } });
        assert.equal(failure.status, 502); assert.equal((await failure.json()).code, 'bilibili_recommendations_risk_blocked');
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
