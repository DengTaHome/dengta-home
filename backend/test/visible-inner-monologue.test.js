const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {
    VISIBLE_INNER_MONOLOGUE_PROMPT_ARCHITECTURE,
    parseVisibleInnerMonologueRequest,
    contextThroughAnchor,
    createVisibleMonologueRecoveryCache,
    runVisibleInnerMonologue
} = require("../services/visible-inner-monologue");

const sessionId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const uuidV7MessageId = "019c0000-0000-7000-8000-000000000001";

const parsed = parseVisibleInnerMonologueRequest({
    session_id: sessionId,
    message_id: messageId,
    model: "gpt-5.6-sol",
    companion_status: {
        mood: "疲惫",
        energyLevel: 1,
        pulseBpm: 72,
        focus: "想休息"
    }
});
assert.equal(parsed.conversationId, sessionId);
assert.equal(parsed.messageId, messageId);
assert.equal(parsed.requestedModel, "gpt-5.6-sol");
assert.equal(
    parseVisibleInnerMonologueRequest({
        session_id: sessionId,
        message_id: uuidV7MessageId
    }).messageId,
    uuidV7MessageId
);

async function main() {
    let generationInput;
    let saveCalled = false;
    const result = await runVisibleInnerMonologue({
        body: {
            session_id: sessionId,
            message_id: messageId,
            model: "gpt-5.6-sol",
            companion_status: {
                mood: "疲惫",
                energyLevel: 1,
                pulseBpm: 72,
                focus: "想休息"
            }
        },
        services: {
            async loadMessage(conversationId, targetMessageId) {
                assert.equal(conversationId, sessionId);
                assert.equal(targetMessageId, messageId);
                return {
                    id: messageId,
                    conversation_id: sessionId,
                    role: "assistant",
                    visible: true,
                    content: "我陪你慢慢说。"
                };
            },
            async getSettings() {
                return {
                    prompt_mode: "unified",
                    unified_system_prompt:
                        "## [Thinking Block]\n至少800字符，以第一人称写内心独白。",
                    user_details: "我叫洋洋，对方叫桃桃。",
                    provider: "openai-responses",
                    model: "gpt-5.6-sol",
                    max_tokens: 900
                };
            },
            async loadChatContext() {
                return {
                    messages: [
                        { role: "user", content: "你累不累？" },
                        { role: "assistant", content: "我陪你慢慢说。" }
                    ],
                    memories: [{ summary: "我记得桃桃喜欢听我说真心话。" }]
                };
            },
            async resolveTurnModel(settings, requestedModel) {
                assert.equal(settings.model, "gpt-5.6-sol");
                assert.equal(requestedModel, "gpt-5.6-sol");
                return requestedModel;
            },
            async generateReply(input) {
                generationInput = input;
                return {
                    text: "我现在很累，但最想让桃桃抱抱我，然后一起安静听歌。".repeat(40),
                    mode: "openai-responses"
                };
            },
            async saveMessage() {
                saveCalled = true;
            }
        }
    });

    assert.equal(result.message_id, messageId);
    assert.equal(result.source, "model_authored_visible_monologue");
    assert.equal(result.generated_with_reply, false);
    assert.equal(result.anchor_type, "assistant_message");
    assert.equal(result.anchor_id, messageId);
    assert.equal(result.model, "gpt-5.6-sol");
    assert.ok(result.inner_monologue.length >= 800);
    assert.equal(saveCalled, false, "visible monologue must not enter chat history");
    assert.equal(
        generationInput.promptArchitecture,
        VISIBLE_INNER_MONOLOGUE_PROMPT_ARCHITECTURE
    );
    assert.equal(generationInput.settings.reasoning_effort, "medium");
    assert.equal(generationInput.settings.max_tokens, 3000);
    assert.equal(generationInput.settings.request_timeout_ms, 120000);
    assert.match(generationInput.runtimeContext, /能量：1%/);
    assert.match(generationInput.runtimeContext, /我陪你慢慢说/);
    assert.match(
        generationInput.messages.at(-1).content,
        /只输出这一次可见心声正文/
    );

    await recoveryChecks();
    await routeChecks();
    console.log("visible inner monologue and anchored recovery checks passed");
}

async function recoveryChecks() {
    const recoveryId = "33333333-3333-4333-8333-333333333333";
    const tenant = {
        userId: "44444444-4444-4444-8444-444444444444",
        companionId: "55555555-5555-4555-8555-555555555555"
    };
    const body = { session_id: sessionId, user_message_id: "19", recovery_request_id: recoveryId };
    const target = {
        id: "19", conversation_id: sessionId, role: "user", visible: true,
        content: "Saved user turn.", created_at: "2026-10-15T10:00:00.123456Z"
    };
    assert.equal(parseVisibleInnerMonologueRequest({ session_id: sessionId, message_id: 19 }).messageId, "19");
    assert.equal(parseVisibleInnerMonologueRequest(body).anchorType, "user_message");
    for (const invalid of [
        { session_id: sessionId },
        { ...body, message_id: messageId },
        { ...body, user_message_id: "9223372036854775808" },
        { ...body, user_message_id: Number.MAX_SAFE_INTEGER + 1 },
        { ...body, recovery_request_id: "local-invalid" },
        { ...body, content: "Client supplied body is forbidden." },
        { ...body, user_id: tenant.userId }
    ]) assert.throws(() => parseVisibleInnerMonologueRequest(invalid), { status: 400 });

    const earlier = { id: "20", role: "assistant", content: "Earlier fixture.", created_at: "2026-10-15T10:00:00.123455Z" };
    const later = { id: "18", role: "assistant", content: "Future fixture.", created_at: "2026-10-15T10:00:00.123457Z" };
    assert.deepEqual(contextThroughAnchor([earlier, target, later], target), [earlier, target]);
    assert.deepEqual(contextThroughAnchor([earlier, later], target), [earlier, target]);
    assert.deepEqual(contextThroughAnchor([{ role: "user", content: "Unordered unknown fixture." }, later], target), [target]);

    let calls = 0, input, resolveGeneration;
    const settings = { provider: "custom", model: "mock", unified_system_prompt: "Synthetic persona.", user_details: "Synthetic details." };
    const before = JSON.stringify(settings);
    const services = {
        async loadMessage(conversationId, id) {
            assert.equal(conversationId, sessionId);
            assert.equal(id, "19");
            return target;
        },
        async getSettings() { return settings; },
        async resolveTurnModel() { return "mock"; },
        async loadChatContext(_conversationId, _settings, anchor) {
            assert.equal(anchor, target);
            return { messages: [earlier, target, later], memories: [{ summary: "Existing memory fixture." }] };
        },
        async generateReply(value) {
            calls++;
            input = value;
            await new Promise(resolve => { resolveGeneration = resolve; });
            return { text: "New visible self-report.", mode: "custom" };
        },
        saveMessage() { throw new Error("Recovery must not write messages."); }
    };
    const cache = createVisibleMonologueRecoveryCache();
    const first = runVisibleInnerMonologue({ body, services, tenant, cache });
    const second = runVisibleInnerMonologue({ body, services, tenant, cache });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1, "concurrent recovery requests share one generation");
    resolveGeneration();
    const [result, shared] = await Promise.all([first, second]);
    assert.deepEqual(result, shared);
    assert.equal(result.user_message_id, "19");
    assert.equal(Object.hasOwn(result, "message_id"), false);
    assert.equal(result.anchor_type, "user_message");
    assert.equal(result.anchor_id, "19");
    assert.equal(result.recovery_request_id, recoveryId);
    assert.equal(result.generated_with_reply, false);
    assert.match(input.runtimeContext, /Saved user turn/);
    assert.doesNotMatch(JSON.stringify(input), /Future fixture/);
    assert.equal(input.memories[0].summary, "Existing memory fixture.");
    assert.equal(JSON.stringify(settings), before);
    result.inner_monologue = "Caller mutation";
    assert.equal((await runVisibleInnerMonologue({ body, services, tenant, cache })).inner_monologue, "New visible self-report.");
    assert.equal(calls, 1);
    await assert.rejects(runVisibleInnerMonologue({ body: { ...body, model: "different" }, services, tenant, cache }), { status: 409 });
    for (const badTarget of [
        { ...target, role: "assistant" }, { ...target, visible: false },
        { ...target, conversation_id: recoveryId }, { ...target, id: "20" }
    ]) await assert.rejects(runVisibleInnerMonologue({ body, services: { ...services, async loadMessage() { return badTarget; } }, tenant, cache }), { status: 404 });

    let fastCalls = 0;
    const fastServices = { ...services, async generateReply() { fastCalls++; return { text: "Visible fixture.", mode: "custom" }; } };
    await runVisibleInnerMonologue({ body, services: fastServices, tenant: { ...tenant, companionId: recoveryId }, cache });
    await runVisibleInnerMonologue({ body, services: fastServices, tenant: { ...tenant, userId: recoveryId }, cache });
    await Promise.all([
        runVisibleInnerMonologue({ body, services: fastServices, cache }),
        runVisibleInnerMonologue({ body, services: fastServices, cache })
    ]);
    assert.equal(fastCalls, 4, "tenant identity changes and legacy unscoped calls never share results");

    let attempts = 0;
    const failingServices = { ...fastServices, async generateReply() {
        if (++attempts === 1) throw Object.assign(new Error("Synthetic provider failure"), { code: "provider_stream_incomplete" });
        return { text: "Retried visible fixture.", mode: "custom" };
    } };
    const failureCache = createVisibleMonologueRecoveryCache();
    await assert.rejects(runVisibleInnerMonologue({ body, services: failingServices, tenant, cache: failureCache }), { code: "provider_stream_incomplete" });
    assert.equal(failureCache.size, 0);
    await runVisibleInnerMonologue({ body, services: failingServices, tenant, cache: failureCache });
    assert.equal(attempts, 2);

    let clock = 0, creations = 0;
    const limited = createVisibleMonologueRecoveryCache({ ttlMs: 10, maxEntries: 1, now: () => clock });
    const create = async () => ({ value: ++creations });
    await limited.run("a", "same", create);
    await limited.run("a", "same", create);
    assert.equal(creations, 1);
    clock = 11;
    await limited.run("a", "same", create);
    assert.equal(creations, 2, "successful cache entries expire");
    await limited.run("b", "same", create);
    assert.equal(limited.size, 1, "settled cache stays bounded");
    let release;
    const pendingCache = createVisibleMonologueRecoveryCache({ maxEntries: 1 });
    const pending = pendingCache.run("a", "same", () => new Promise(resolve => { release = resolve; }));
    await Promise.resolve();
    await assert.rejects(pendingCache.run("b", "same", create), { status: 429 });
    release({ value: "done" });
    await pending;
}

async function routeChecks() {
    const source = fs.readFileSync(require.resolve("../server"), "utf8");
    const start = source.indexOf('app.post("/companion/inner-monologue"');
    const end = source.indexOf('\napp.post(', start + 1);
    const target = { id: "42", conversation_id: sessionId, role: "user", content: "Saved turn", visible: true, created_at: "2026-10-15T12:00:00.000000Z" };
    const queries = [];
    const database = { from(table) {
        assert.equal(table, "messages");
        const actions = [];
        queries.push(actions);
        const query = {};
        for (const method of ["select", "eq", "or", "gte", "order", "limit"]) {
            query[method] = (...args) => { actions.push([method, ...args]); return query; };
        }
        query.maybeSingle = async () => ({ data: target, error: null });
        query.then = resolve => resolve({ data: [target], error: null });
        return query;
    } };
    let handler, generatedInput, tenantInput;
    vm.runInNewContext(source.slice(start, end), {
        app: { post(_path, fn) { handler = fn; } }, process: { env: {} },
        supabase: { from() { throw new Error("Scoped request must not use global database."); } },
        runVisibleInnerMonologue: async input => { tenantInput = input.tenant; return runVisibleInnerMonologue(input); },
        async getSettings(db) { assert.equal(db, database); return { model: "mock", provider: "custom", context_reset_at: "2026-10-01T00:00:00Z" }; },
        async loadChatContext(_id, _settings, db) { assert.equal(db, database); return { messages: [{ role: "user", content: "Future context must be replaced." }], memories: [] }; },
        async resolveTurnModel() { return "mock"; },
        async generateReply(input) { generatedInput = input; return { text: "Visible fixture", mode: "custom" }; }
    });
    const req = { body: { session_id: sessionId, user_message_id: "42" }, scope: { db: database, userId: sessionId, companionId: messageId } };
    let response;
    await handler(req, { set() {}, json(value) { response = value; } }, error => { throw error; });
    assert.equal(response.anchor_type, "user_message");
    assert.equal(tenantInput.userId, req.scope.userId);
    assert.equal(tenantInput.companionId, req.scope.companionId);
    assert.doesNotMatch(JSON.stringify(generatedInput), /Future context/);
    assert.ok(queries[0].some(([method, value]) => method === "select" && value.includes("created_at")));
    assert.ok(queries[1].some(([method, value]) => method === "or" && value === `created_at.lt.${target.created_at},and(created_at.eq.${target.created_at},id.lte.42)`));
    assert.ok(queries[1].some(([method, field, value]) => method === "eq" && field === "conversation_id" && value === sessionId));
    assert.ok(queries[1].some(([method, field]) => method === "gte" && field === "created_at"));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
