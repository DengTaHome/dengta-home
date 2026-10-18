const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { sanitizeCompanionStatusSnapshot } = require("../services/companion-status");

test("identical recovery retries survive a ticking and expired countdown without another generation", async () => {
    const filename = require.resolve("../services/visible-inner-monologue");
    const localRequire = createRequire(filename);
    let clock = Date.parse("2026-10-18T08:00:00Z");
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
        module, exports: module.exports,
        require(name) {
            if (name === "./companion-status") return {
                sanitizeCompanionStatusSnapshot: value =>
                    sanitizeCompanionStatusSnapshot(value, new Date(clock))
            };
            return localRequire(name);
        }
    }, { filename });
    const { runVisibleInnerMonologue, parseVisibleInnerMonologueRequest, createVisibleMonologueRecoveryCache } = module.exports;
    const tenant = {
        userId: "11111111-1111-4111-8111-111111111111",
        companionId: "22222222-2222-4222-8222-222222222222"
    };
    const body = {
        session_id: "33333333-3333-4333-8333-333333333333",
        message_id: "19",
        recovery_request_id: "44444444-4444-4444-8444-444444444444",
        model: "synthetic-model",
        companion_status: {
            mood: "放松", energyLevel: 75, focus: "听音乐", microState: "在听",
            countdown: { totalSeconds: 30, remainingSeconds: 30, isRunning: true, endsAt: "2026-10-18T08:00:30Z" }
        }
    };
    const originalBody = JSON.stringify(body);
    const settings = { provider: "custom", model: "synthetic-model", user_details: "Private synthetic profile." };
    const originalSettings = JSON.stringify(settings);
    let calls = 0;
    const services = {
        async loadMessage() { return { id: "19", conversation_id: body.session_id, role: "assistant", content: "Synthetic saved reply.", visible: true }; },
        async getSettings() { return settings; },
        async resolveTurnModel(_settings, model) { return model; },
        async loadChatContext() { return { messages: [], memories: [] }; },
        async generateReply() { calls++; return { text: "Synthetic visible monologue.", mode: "custom" }; }
    };
    const cache = createVisibleMonologueRecoveryCache({ now: () => clock });
    const run = nextBody => runVisibleInnerMonologue({ body: nextBody, services, tenant, cache });
    const first = await run(body);
    assert.equal(parseVisibleInnerMonologueRequest(body).companionStatus.countdown.remainingSeconds, 30);
    clock += 10_000;
    assert.equal(parseVisibleInnerMonologueRequest(body).companionStatus.countdown.remainingSeconds, 20);
    assert.equal(JSON.stringify(await run(body)), JSON.stringify(first));
    clock += 25_000;
    assert.equal(parseVisibleInnerMonologueRequest(body).companionStatus.countdown.isRunning, false);
    assert.equal(JSON.stringify(await run(body)), JSON.stringify(first));
    assert.equal(calls, 1, "normal wall time must not invalidate an unchanged recovery request");
    for (const [field, value] of [["mood", "期待"], ["energyLevel", 45], ["focus", "散步"], ["microState", "在走"]]) {
        await assert.rejects(run({ ...body, companion_status: { ...body.companion_status, [field]: value } }), {
            code: "inner_monologue_request_conflict", status: 409
        });
    }
    await assert.rejects(run({ ...body, model: "changed-model" }), { code: "inner_monologue_request_conflict" });
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(body), originalBody);
    assert.equal(JSON.stringify(settings), originalSettings);
});
