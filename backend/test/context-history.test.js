const assert = require("node:assert/strict");
const { readContextHistory, resolveCompressionThreshold } = require("../services/context-history");
const { loadMainChatContextRows, loadMemoryCompressionRows } = require("../services/context-reset");
const { createTenantDatabase } = require("../services/request-scope");
const { DEFAULT_SETTINGS, buildSettingsChanges } = require("../services/settings-store");
const { applyGenerationBudget, assertSerializedRequestBudget } = require("../services/generation-budget");
const { buildOpenAiMessages } = require("../services/ai-service");

const userId = "10000000-0000-4000-8000-000000000001";
const companionId = "20000000-0000-4000-8000-000000000002";
const conversationId = "30000000-0000-4000-8000-000000000003";
function fixture(rows, { pageCap = 73, failPage = 0, onPage } = {}) {
    const calls = [];
    const database = { from(table) {
        const filters = [], orders = [];
        let limit = Infinity;
        let cursor;
        const builder = {
            select() { return builder; },
            eq(key, value) { filters.push([key, value]); return builder; },
            gte(key, value) { filters.push([key, value, "gte"]); return builder; },
            order(key, options) { orders.push([key, options]); return builder; },
            limit(value) { limit = value; return builder; },
            or(value) { cursor = value; return builder; },
            then(resolve, reject) {
                if (table !== "messages") return Promise.resolve({ data: [], error: null }).then(resolve, reject);
                calls.push({ filters, orders, cursor, limit });
                onPage?.(calls.length, rows);
                if (calls.length === failPage) return Promise.resolve({ data: null, error: new Error("page unavailable") }).then(resolve, reject);
                let matches = rows.filter(row => filters.every(([key, value, kind]) => kind === "gte" ? row[key] >= value : row[key] === value));
                if (cursor) {
                    const match = cursor.match(/^created_at\.(lt|gt)\.(.+),and\(created_at.eq\..+,id\.(?:lt|gt)\.([^()]+)\)$/);
                    assert.ok(match, cursor);
                    const [, direction, time, id] = match;
                    matches = matches.filter(row => {
                        const cmp = row.created_at.localeCompare(time) || Number(row.id) - Number(id);
                        return direction === "lt" ? cmp < 0 : cmp > 0;
                    });
                }
                matches.sort((a, b) => {
                    for (const [key, { ascending }] of orders) {
                        const cmp = key === "id" ? Number(a.id) - Number(b.id) : String(a[key]).localeCompare(String(b[key]));
                        if (cmp) return ascending ? cmp : -cmp;
                    }
                    return 0;
                });
                return Promise.resolve({ data: matches.slice(0, Math.min(limit, pageCap)), error: null }).then(resolve, reject);
            }
        };
        return builder;
    }};
    return { database, calls };
}
function history(count) {
    return Array.from({ length: count }, (_, i) => ({ id: String(i + 1), user_id: userId, companion_id: companionId,
        conversation_id: conversationId, visible: true, context_visible: true,
        created_at: "2026-09-30T01:00:00.123456+00:00", role: i % 2 ? "assistant" : "user", content: `历史 ${i}`, tool_calls: {} }));
}
async function main() {
    const rows = history(5001);
    const saved = structuredClone(rows);
    const { database: adminSupabase, calls } = fixture(rows, { onPage(page, values) {
        if (page === 2) values.push({ ...values.at(-1), id: "6000", content: "并发新消息" });
    }});
    const database = createTenantDatabase({ adminSupabase, tenant: { userId, companionId } });
    const settings = { ...DEFAULT_SETTINGS, model: "gpt-4.1", user_id: userId, companion_id: companionId };
    const context = await loadMainChatContextRows({ database, conversationId, settings });
    assert.equal(context.messages.length, 5001, "超过 REST 单次行上限的历史完整分页读取");
    assert.deepEqual(context.messages, saved, "同时间戳不漏读，读取中插入不重复，历史原文不改写");
    assert.ok(calls.length > 20);
    for (const call of calls) {
        for (const pair of [["user_id", userId], ["companion_id", companionId], ["conversation_id", conversationId], ["visible", true], ["context_visible", true]]) {
            assert.ok(call.filters.some(([key, value]) => key === pair[0] && value === pair[1]), "每页都必须保留租户和会话隔离");
        }
    }
    const plan = { systemInstructions: ["  保留原始指令\n"], messages: context.messages };
    applyGenerationBudget(plan, { settings });
    assert.equal(plan.messages.length, 5001, "百万窗口不按旧 20／50 轮截断");
    assert.deepEqual(plan.systemInstructions, ["  保留原始指令\n"]);
    const largeHistory = history(4001).map(row => ({ role: row.role, content: "上下文测试".repeat(25) }));
    const largePlan = { systemInstructions: ["保留原文"], messages: largeHistory };
    applyGenerationBudget(largePlan, { settings });
    assert.equal(largePlan.messages.length, 4001, "约七十万 token 的历史可使用百万窗口");
    assert.doesNotThrow(() => assertSerializedRequestBudget("https://fixture.test/v1/chat/completions", { body: JSON.stringify({ model: settings.model, messages: buildOpenAiMessages(largePlan.messages, largePlan.systemInstructions) }) }));
    const smallPlan = { systemInstructions: ["保留原文"], messages: largeHistory };
    applyGenerationBudget(smallPlan, { settings: { ...settings, model: "gpt-4-0613" } });
    assert.ok(smallPlan.messages.length < 60, "小窗口模型仍受真实容量预算保护");
    const recent = await loadMainChatContextRows({ database, conversationId, settings: { ...settings, context_turns: 50 } });
    assert.equal(recent.messages.length, 120, "已有自定义轮数不被静默覆盖");
    const reset = await loadMainChatContextRows({ database, conversationId, settings: { ...settings, context_reset_at: "2026-09-30T02:00:00Z" } });
    assert.deepEqual(reset.messages, []);
    const compression = await loadMemoryCompressionRows({ database, conversationId, settings });
    assert.equal(compression.messages.length, 5002, "压缩读取也不能停在 REST 第一页");
    assert.equal(compression.messages[0].id, "1");
    const bounded = fixture(history(5000));
    const limited = await readContextHistory({ query: () => bounded.database.from("messages").select("*"), messageLimit: 1000000, tokenLimit: 2000 });
    assert.ok(limited.length < 100 && bounded.calls.length < 4, "达到预算即停，避免全库扫描");
    const failed = fixture(history(5000), { failPage: 2 });
    await assert.rejects(readContextHistory({ query: () => failed.database.from("messages").select("*"), messageLimit: 1000000, tokenLimit: 1000000 }), /page unavailable/);
    assert.equal(resolveCompressionThreshold({}, 1047576), 838060);
    assert.equal(resolveCompressionThreshold({ compression_threshold: 0 }, 2000000), 1600000);
    assert.equal(resolveCompressionThreshold({ compression_threshold: 8000 }, 2000000), 1600000);
    assert.equal(resolveCompressionThreshold({ compression_threshold: 200000 }, 2000000), 200000);
    const personalized = { ...DEFAULT_SETTINGS, unified_system_prompt: "  原始内容\n", user_details: "\n原始详情 ", context_turns: 50 };
    const updated = buildSettingsChanges(personalized, { context_turns: 1000000, compression_threshold: 10000000 });
    assert.equal(updated.context_turns, 1000000);
    assert.equal(updated.compression_threshold, 10000000);
    assert.equal(updated.unified_system_prompt, personalized.unified_system_prompt);
    assert.equal(updated.user_details, personalized.user_details);
    assert.equal(buildSettingsChanges(personalized, {}).context_turns, 50);
    assert.equal(buildSettingsChanges(personalized, { context_turns: 0 }).context_turns, 0);
    assert.equal(buildSettingsChanges(personalized, { context_turns: -1 }).context_turns, 0);
    assert.equal(buildSettingsChanges(personalized, { context_turns: 1e30 }).context_turns, 1000000);
    console.log("large context pagination, budgets, reset, tenancy, customization tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
