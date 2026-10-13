"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createWorldBookRouter } = require("../routes/v2/world-book");
const {
    createWorldBookEntry,
    deleteWorldBookEntry,
    listWorldBookEntries,
    reorderWorldBookEntries,
    updateWorldBookEntry
} = require("../services/world-book");
const { matchEntry, resolveWorldBookContext } = require("../services/world-book-runtime");
const { buildMainChatPromptPlan, buildPromptReceipt } = require("../services/ai-service");
const { createRequestScope } = require("../services/request-scope");

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const companionA = "33333333-3333-4333-8333-333333333333";
const companionB = "44444444-4444-4444-8444-444444444444";

function memorySupabase(rows = []) {
    let nextId = 1;
    const tables = { world_book_entries: rows };
    return { tables, from(table) {
        let action = "select", payload, countRequested = false;
        const filters = [], orders = [];
        let search = "", first = 0, last = Infinity;
        const builder = {
            select(columns, options = {}) { countRequested = options.count === "exact"; return builder; },
            insert(value) { action = "insert"; payload = value; return builder; },
            update(value) { action = "update"; payload = value; return builder; },
            delete() { action = "delete"; return builder; },
            eq(key, value) { filters.push([key, value]); return builder; },
            or(value) { search = String(value).match(/%([^%]+)%/)?.[1] || ""; return builder; },
            order(key, options = {}) { orders.push([key, options.ascending !== false]); return builder; },
            range(start, end) { first = start; last = end; return builder.run(); },
            single() { return builder.run(true); },
            maybeSingle() { return builder.run(true); },
            then(resolve, reject) { return builder.run().then(resolve, reject); },
            async run(single = false) {
                const source = tables[table];
                const matches = (row) => filters.every(([key, value]) => row[key] === value);
                if (action === "insert") {
                    const values = Array.isArray(payload) ? payload : [payload];
                    const inserted = values.map((value) => ({
                        id: value.id || `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
                        created_at: "2026-08-14T00:00:00.000Z",
                        updated_at: "2026-08-14T00:00:00.000Z",
                        ...value
                    }));
                    source.push(...inserted);
                    return { data: single ? inserted[0] : inserted, error: null };
                }
                if (action === "update") {
                    const found = source.filter(matches);
                    found.forEach((row) => Object.assign(row, payload));
                    return { data: single ? found[0] || null : found, error: null };
                }
                if (action === "delete") {
                    const found = source.filter(matches);
                    for (const row of found) source.splice(source.indexOf(row), 1);
                    return { data: single ? found[0] || null : found, error: null };
                }
                let found = source.filter(matches);
                if (search) found = found.filter((row) => `${row.title}\n${row.content}`.toLowerCase().includes(search.toLowerCase()));
                for (const [key, ascending] of orders.slice().reverse()) {
                    found.sort((a, b) => ascending
                        ? String(a[key]).localeCompare(String(b[key]), undefined, { numeric: true })
                        : String(b[key]).localeCompare(String(a[key]), undefined, { numeric: true }));
                }
                const count = found.length;
                found = found.slice(first, last + 1);
                return { data: single ? found[0] || null : found, error: null, count: countRequested ? count : null };
            }
        };
        return builder;
    }};
}

function identity(userId, companionId, adminSupabase) {
    const companion = { id: companionId, user_id: userId, status: "active" };
    return createRequestScope({
        adminSupabase,
        user: { id: userId },
        profile: { id: userId, role: "owner", status: "active" },
        companions: [companion], companion
    });
}

function runtimeDatabase(entries) {
    return { from(table) {
        assert.equal(table, "world_book_entries");
        return {
            select() { return this; },
            async eq(key, value) {
                assert.deepEqual([key, value], ["enabled", true]);
                return { data: entries.filter((entry) => entry.enabled), error: null };
            }
        };
    }};
}

function entry(index, overrides = {}) {
    return {
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        title: `条目 ${index}`, content: `LORE_${index}_${"x".repeat(1000)}`,
        keywords: ["灯塔"], enabled: true, priority: 100, constant: false,
        match_mode: "any", case_sensitive: false, position: "dynamic_context",
        sort_order: index, updated_at: new Date(2026, 0, 1, 0, 0, index).toISOString(),
        ...overrides
    };
}

async function withServer(app, callback) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try { await callback(`http://127.0.0.1:${server.address().port}`); }
    finally { await new Promise((resolve) => server.close(resolve)); }
}

async function main() {
    const admin = memorySupabase();
    const scopeA = identity(userA, companionA, admin);
    const scopeB = identity(userB, companionB, admin);
    const adultText = "双方均为成年人的自愿情色设定：完整保留亲密行为细节。";
    const created = await createWorldBookEntry(scopeA.db, {
        title: "成人设定", content: adultText, keywords: ["亲密", "亲密"],
        priority: 900, constant: true, match_mode: "all", case_sensitive: true,
        position: "before_memory", sort_order: 7, user_id: userB, companion_id: companionB
    });
    assert.equal(created.content, adultText, "成人正文不得被内容过滤或改写");
    assert.deepEqual(created.keywords, ["亲密"]);
    assert.equal(created.user_id, userA, "RequestScope 必须覆盖客户端 ownership 字段");
    assert.equal(created.companion_id, companionA);
    const defaults = await createWorldBookEntry(scopeA.db, { content: "默认字段正文" });
    assert.deepEqual(
        { enabled: defaults.enabled, priority: defaults.priority, constant: defaults.constant, match_mode: defaults.match_mode, case_sensitive: defaults.case_sensitive, position: defaults.position, sort_order: defaults.sort_order },
        { enabled: true, priority: 100, constant: false, match_mode: "any", case_sensitive: false, position: "dynamic_context", sort_order: 0 }
    );
    for (const [input, code] of [
        [null, "world_book_body_invalid"],
        [{ content: "" }, "world_book_content_required"],
        [{ content: "x", keywords: "x" }, "world_book_keywords_invalid"],
        [{ content: "x", enabled: 1 }, "world_book_enabled_invalid"],
        [{ content: "x", constant: "true" }, "world_book_constant_invalid"],
        [{ content: "x", case_sensitive: null }, "world_book_case_sensitive_invalid"],
        [{ content: "x", priority: 100001 }, "world_book_priority_invalid"],
        [{ content: "x", sort_order: 1.5 }, "world_book_sort_order_invalid"],
        [{ content: "x", match_mode: "none" }, "world_book_match_mode_invalid"],
        [{ content: "x", position: "system" }, "world_book_position_invalid"],
        [{ content: "x", metadata: [] }, "world_book_metadata_invalid"]
    ]) {
        await assert.rejects(createWorldBookEntry(scopeA.db, input), (error) => error.code === code);
    }
    await createWorldBookEntry(scopeA.db, { title: "灯塔城市", content: "海边城市", enabled: false });
    await createWorldBookEntry(scopeB.db, { title: "另一租户", content: "不可见" });

    const listed = await listWorldBookEntries(scopeA.db, { search: "成人", constant: true, limit: 1, offset: 0 });
    assert.equal(listed.pagination.total, 1);
    assert.equal(listed.entries[0].id, created.id);
    assert.equal((await listWorldBookEntries(scopeB.db)).entries.length, 1, "列表必须跨租户隔离");
    await assert.rejects(listWorldBookEntries(scopeA.db, { limit: 101 }), (error) => error.code === "world_book_limit_invalid");
    await assert.rejects(listWorldBookEntries(scopeA.db, { position: "system" }), (error) => error.code === "world_book_position_invalid");

    const updated = await updateWorldBookEntry(scopeA.db, created.id, { priority: -1, content: adultText, user_id: userB });
    assert.equal(updated.priority, -1);
    assert.equal(updated.user_id, userA);
    await assert.rejects(updateWorldBookEntry(scopeA.db, created.id, {}), (error) => error.code === "world_book_update_empty");
    await assert.rejects(updateWorldBookEntry(scopeA.db, "not-a-uuid", { title: "x" }), (error) => error.code === "world_book_id_invalid");
    await assert.rejects(updateWorldBookEntry(scopeB.db, created.id, { title: "越权" }), (error) => error.code === "world_book_entry_not_found");
    const secondA = admin.tables.world_book_entries.find((row) => row.user_id === userA && row.id !== created.id);
    const reordered = await reorderWorldBookEntries(scopeA.db, { entries: [{ id: secondA.id, sort_order: 1 }, { id: created.id, sort_order: 2 }] });
    assert.deepEqual(reordered.map((item) => item.sort_order), [1, 2]);
    await assert.rejects(reorderWorldBookEntries(scopeA.db, { entries: [{ id: created.id }, { id: created.id }] }), (error) => error.code === "world_book_reorder_invalid");
    await assert.rejects(reorderWorldBookEntries(scopeA.db, { entries: [] }), (error) => error.code === "world_book_reorder_invalid");
    assert.equal(await deleteWorldBookEntry(scopeA.db, secondA.id), secondA.id);
    await assert.rejects(deleteWorldBookEntry(scopeB.db, created.id), (error) => error.code === "world_book_entry_not_found");

    assert.deepEqual(matchEntry({ keywords: ["Alpha", "Beta"], match_mode: "all" }, ["alpha one", "beta two"], "beta two"), { matched: true, latestUserMatch: false });
    assert.deepEqual(matchEntry({ keywords: ["Alpha"], match_mode: "any", case_sensitive: true }, ["alpha"], "alpha"), { matched: false, latestUserMatch: false });
    assert.deepEqual(matchEntry({ keywords: ["Alpha"], match_mode: "any", case_sensitive: true }, ["Alpha"], "Alpha"), { matched: true, latestUserMatch: true });
    assert.deepEqual(matchEntry({ keywords: [], match_mode: "any" }, ["anything"], "anything"), { matched: false, latestUserMatch: false });
    assert.deepEqual(matchEntry({ constant: true }, [], ""), { matched: true, latestUserMatch: false });
    assert.deepEqual(matchEntry({ keywords: ["alpha", "beta"], match_mode: "any" }, ["none"], "beta"), { matched: false, latestUserMatch: false });

    await assert.rejects(resolveWorldBookContext(), TypeError);
    await assert.rejects(resolveWorldBookContext({ database: { from() { return { select() { return this; }, async eq() { return { error: new Error("query failed") }; } }; } } }), /query failed/);
    const emptyRuntime = await resolveWorldBookContext({ database: runtimeDatabase([]), messages: null });
    assert.equal(emptyRuntime.receipt.applied_count, 0);

    const sortedRuntime = await resolveWorldBookContext({
        database: runtimeDatabase([
            entry(1, { content: "常驻成人情色原文", constant: true, position: "before_memory", priority: -100 }),
            entry(2, { content: "历史匹配", keywords: ["旧词"], priority: 100, sort_order: 1 }),
            entry(3, { content: "最新用户匹配", keywords: ["新词"], priority: 100, sort_order: 9 }),
            entry(4, { content: "已禁用", enabled: false, constant: true })
        ]),
        settings: { model: "gpt-4o", max_tokens: 512, user_details: "用户详情", unified_system_prompt: "统一提示" },
        messages: [{ role: "user", content: "旧词" }, { role: "assistant", content: "中间回复" }, { role: "user", content: "现在说新词" }]
    });
    assert.match(sortedRuntime.beforeMemoryInstruction, /常驻成人情色原文/);
    assert.ok(sortedRuntime.dynamicContext.indexOf("最新用户匹配") < sortedRuntime.dynamicContext.indexOf("历史匹配"));
    assert.doesNotMatch(JSON.stringify(sortedRuntime.receipt), /成人|新词|标题|正文/);
    assert.deepEqual(Object.keys(sortedRuntime.receipt).sort(), ["applied_count", "chars", "constant_truncated", "constants_dropped", "eligible_count", "positions", "tokens"]);

    const many = Array.from({ length: 180 }, (_, index) => entry(index + 10));
    const counts = [];
    for (const model of ["gpt-4", "gpt-4-32k", "gpt-4o"]) {
        const result = await resolveWorldBookContext({
            database: runtimeDatabase(many), settings: { model, max_tokens: 512 },
            messages: [{ role: "user", content: "灯塔" }]
        });
        counts.push(result.receipt.applied_count);
        for (const selected of many.filter((item) => result.dynamicContext.includes(`LORE_${item.id.slice(-12).replace(/^0+/, "")}_`))) {
            assert.ok(result.dynamicContext.includes(selected.content), "普通条目必须完整装入，不能截断正文");
        }
    }
    assert.ok(counts[0] < counts[1] && counts[1] < counts[2], `预算应随 8K/32K/128K 增长：${counts}`);
    assert.ok(counts[2] > 100, "运行时不得设置固定 100 条上限");
    // Oversized constant entries must never abort the chat turn: they are
    // truncated to fit (with a user-visible notice) or dropped as a last resort.
    const oversized = await resolveWorldBookContext({
        database: runtimeDatabase([entry(999, { constant: true, content: "常驻".repeat(10000) })]),
        settings: { model: "gpt-4", max_tokens: 2048 }, messages: [{ role: "user", content: "灯塔" }]
    });
    assert.ok(
        oversized.receipt.constant_truncated || oversized.receipt.constants_dropped > 0,
        "超长常驻条目必须被截断或让位"
    );
    if (oversized.receipt.constant_truncated) {
        const oversizedText = `${oversized.beforeMemoryInstruction}\n${oversized.dynamicContext}`;
        assert.match(oversizedText, /截断/, "截断必须在正文中告知用户");
        assert.ok(oversizedText.length < "常驻".repeat(10000).length, "截断后正文必须小于原文");
    }

    const worldBookContext = {
        beforeMemoryInstruction: "WORLD_BEFORE_MEMORY",
        dynamicContext: "WORLD_DYNAMIC_ADULT_EROTIC_TEXT",
        receipt: sortedRuntime.receipt
    };
    const plan = buildMainChatPromptPlan({
        settings: { model: "gpt-4o", max_tokens: 512, prompt_mode: "unified", user_details: "USER_DETAILS", unified_system_prompt: "UNIFIED" },
        messages: [{ role: "user", content: "LATEST_USER" }], memories: [{ summary: "STABLE_MEMORY" }],
        runtimeContext: "OTHER_APP", visibleMonologue: true, worldBookContext
    });
    const systemText = plan.systemInstructions.join("\n");
    assert.ok(systemText.indexOf("USER_DETAILS") < systemText.indexOf("UNIFIED"));
    assert.ok(systemText.indexOf("UNIFIED") < systemText.indexOf("OTHER_APP") || !systemText.includes("OTHER_APP"));
    // 记忆详情是最高优先级（紧跟个性化指令），世界书前置标记在其后。
    assert.ok(systemText.indexOf("STABLE_MEMORY") < systemText.indexOf("WORLD_BEFORE_MEMORY"));
    assert.equal(plan.messages.at(-1).content, "LATEST_USER");
    assert.match(plan.messages.at(-2).content, /WORLD_DYNAMIC_ADULT_EROTIC_TEXT/);
    assert.equal(plan.receipt.prompt_contract_version, "dengta-prompt-contract-v8");
    const publicReceipt = buildPromptReceipt(plan.settings || {}, { provider: "together", systemInstructions: plan.systemInstructions, messages: plan.messages, attachments: [], promptPlanReceipt: plan.receipt });
    assert.equal(JSON.stringify(publicReceipt).includes("WORLD_DYNAMIC_ADULT_EROTIC_TEXT"), false, "Together receipt 不得包含世界书正文");
    assert.equal(publicReceipt.world_book.applied_count, sortedRuntime.receipt.applied_count);

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.scope = req.headers.authorization === "Bearer B" ? scopeB : scopeA; next(); });
    app.use("/api/v2/world-book", createWorldBookRouter());
    app.use((error, req, res, next) => { void req; void next; res.status(error.status || 500).json({ code: error.code }); });
    await withServer(app, async (base) => {
        const createdResponse = await fetch(`${base}/api/v2/world-book/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "路由成人条目", content: adultText, user_id: userB }) });
        assert.equal(createdResponse.status, 201);
        const routeEntry = (await createdResponse.json()).entry;
        assert.equal(routeEntry.user_id, userA);
        const page = await fetch(`${base}/api/v2/world-book/?search=路由&limit=100&enabled=true`);
        assert.equal(page.status, 200);
        assert.equal((await page.json()).entries.length, 1);
        assert.equal((await fetch(`${base}/api/v2/world-book/${routeEntry.id}`, { method: "PATCH", headers: { Authorization: "Bearer B", "Content-Type": "application/json" }, body: JSON.stringify({ title: "越权" }) })).status, 404);
        assert.equal((await fetch(`${base}/api/v2/world-book/?limit=101`)).status, 400);
    });

    console.log("world book runtime, CRUD, prompt and tenant tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
