const assert = require("node:assert/strict");
const {
    countProactiveMessagesForDay,
    handleTenantProactiveMessage,
    proactiveDayWindow,
    scheduleProactiveMessageEvaluation
} = require("../services/tenant-proactive-message");

const JOB_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID =
    "20000000-0000-4000-8000-000000000001";

const shanghaiWindow = proactiveDayWindow(
    new Date("2026-07-26T13:00:00.000Z"),
    "Asia/Shanghai"
);
assert.equal(shanghaiWindow.start.toISOString(), "2026-07-25T16:00:00.000Z");
assert.equal(shanghaiWindow.end.toISOString(), "2026-07-26T16:00:00.000Z");

async function testDailyCountUsesTenantScopedLocalDayWindow() {
    const calls = [];
    const result = { data: [{ id: 1 }, { id: 2 }], error: null };
    const query = {
        select(value) {
            calls.push(["select", value]);
            return query;
        },
        eq(column, value) {
            calls.push(["eq", column, value]);
            return query;
        },
        contains(column, value) {
            calls.push(["contains", column, value]);
            return query;
        },
        gte(column, value) {
            calls.push(["gte", column, value]);
            return query;
        },
        lt(column, value) {
            calls.push(["lt", column, value]);
            return query;
        },
        limit(value) {
            calls.push(["limit", value]);
            return query;
        },
        then(resolve, reject) {
            return Promise.resolve(result).then(resolve, reject);
        }
    };
    const count = await countProactiveMessagesForDay({
        database: {
            from(table) {
                assert.equal(table, "messages");
                return query;
            }
        },
        now: new Date("2026-07-26T13:00:00.000Z"),
        timezone: "Asia/Shanghai",
        limit: 7
    });
    assert.equal(count, 2);
    assert.deepEqual(calls, [
        ["select", "id"],
        ["eq", "role", "assistant"],
        ["eq", "visible", true],
        ["eq", "context_visible", true],
        ["contains", "tool_calls", { is_proactive: true }],
        ["gte", "created_at", "2026-07-25T16:00:00.000Z"],
        ["lt", "created_at", "2026-07-26T16:00:00.000Z"],
        ["limit", 7]
    ]);
}

function valueContains(value, expected) {
    if (!expected || typeof expected !== "object") return value === expected;
    return Object.entries(expected).every(([key, item]) =>
        valueContains(value?.[key], item)
    );
}

function createDatabase(initial = {}) {
    const tables = {
        conversations: [],
        messages: [],
        delivery_events: [],
        background_jobs: [],
        ...structuredClone(initial)
    };

    function from(table) {
        let action = "select";
        let inserted = null;
        const filters = [];
        let containsFilter = null;
        let orderBy = null;
        let limitCount = null;

        const builder = {
            select() {
                return builder;
            },
            insert(values) {
                action = "insert";
                inserted = structuredClone(values);
                return builder;
            },
            eq(column, value) {
                filters.push([column, value]);
                return builder;
            },
            contains(column, value) {
                containsFilter = [column, value];
                return builder;
            },
            order(column, options) {
                orderBy = [column, options];
                return builder;
            },
            limit(value) {
                limitCount = value;
                return builder;
            },
            async maybeSingle() {
                if (action === "insert") {
                    if (
                        table === "background_jobs" &&
                        inserted.status !== "completed" &&
                        tables.background_jobs.some(
                            (item) =>
                                item.job_type === inserted.job_type &&
                                item.status === "pending"
                        )
                    ) {
                        return {
                            data: null,
                            error: { code: "23505" }
                        };
                    }
                    if (
                        table === "delivery_events" &&
                        tables.delivery_events.some(
                            (item) => item.id === inserted.id
                        )
                    ) {
                        return {
                            data: null,
                            error: { code: "23505" }
                        };
                    }
                    const saved = {
                        id:
                            inserted.id ||
                            `${table}-${tables[table].length + 1}`,
                        status: inserted.status || "pending",
                        ...inserted
                    };
                    tables[table].push(saved);
                    return { data: saved, error: null };
                }

                let rows = tables[table].filter((row) =>
                    filters.every(([column, value]) => row[column] === value)
                );
                if (containsFilter) {
                    const [column, expected] = containsFilter;
                    rows = rows.filter((row) =>
                        valueContains(row[column], expected)
                    );
                }
                if (orderBy) {
                    const [column, options] = orderBy;
                    rows.sort((left, right) => {
                        const comparison = String(left[column] || "").localeCompare(
                            String(right[column] || "")
                        );
                        return options?.ascending === false
                            ? -comparison
                            : comparison;
                    });
                }
                if (limitCount != null) rows = rows.slice(0, limitCount);
                return { data: rows[0] || null, error: null };
            }
        };
        return builder;
    }

    return { from, tables };
}

function baseInput(overrides = {}) {
    const database =
        overrides.database ||
        createDatabase({
            conversations: [
                {
                    id: CONVERSATION_ID,
                    updated_at: "2026-07-26T12:00:00.000Z"
                }
            ]
        });
    let leaseChecks = 0;
    let touchCalls = 0;
    let generatedInput = null;
    let nextMessageId = 101;
    const input = {
        job: {
            id: JOB_ID,
            job_type: "proactive_message",
            payload: {}
        },
        database,
        lease: {
            async assertOwned() {
                leaseChecks += 1;
            }
        },
        async getSettings() {
            return {
                push_enabled: true,
                ai_name: "小灯",
                timezone: "Asia/Shanghai"
            };
        },
        async loadChatContext() {
            return {
                messages: [
                    { role: "user", content: "晚饭吃过了。" },
                    { role: "assistant", content: "嗯，记得喝水。" }
                ],
                memories: [{ summary: "桃桃最近在忙项目。" }]
            };
        },
        async generateReply(value) {
            generatedInput = value;
            return {
                text:
                    '{"send":true,"message":"忙完了吗？我刚才想起你。","next_check_minutes":90}',
                mode: "api"
            };
        },
        async saveMessage(conversationId, role, content, options) {
            const saved = {
                id: nextMessageId++,
                conversation_id: conversationId,
                role,
                content,
                tool_calls: options.tool_calls
            };
            database.tables.messages.push(saved);
            return saved;
        },
        async touchConversation() {
            touchCalls += 1;
        },
        async countProactiveMessagesForDay() {
            return 0;
        },
        now: () => new Date("2026-07-26T13:00:00.000Z"),
        random: () => 0.5,
        ...overrides
    };
    return {
        input,
        database,
        getState() {
            return { leaseChecks, touchCalls, generatedInput };
        }
    };
}

async function testSavesMessageBeforeDeliveryAndSchedulesNextEvaluation() {
    const { input, database, getState } = baseInput();
    const result = await handleTenantProactiveMessage(input);

    assert.deepEqual(result, {
        status: "handled",
        decision: "sent",
        messageId: 101,
        nextCheckMinutes: 90
    });
    assert.equal(database.tables.messages.length, 1);
    assert.equal(
        database.tables.messages[0].tool_calls.source_background_job_id,
        JOB_ID
    );
    assert.equal(database.tables.delivery_events.length, 1);
    assert.equal(database.tables.delivery_events[0].message_id, 101);
    assert.equal(database.tables.delivery_events[0].state, "saved");
    assert.equal(database.tables.background_jobs.length, 1);
    assert.equal(
        database.tables.background_jobs[0].job_type,
        "proactive_message"
    );
    assert.equal(
        database.tables.background_jobs[0].due_at,
        "2026-07-26T14:30:00.000Z"
    );
    assert.equal(getState().touchCalls, 1);
    assert.ok(getState().leaseChecks >= 4);
    assert.equal(
        getState().generatedInput.promptArchitecture,
        "proactive-message-module"
    );
}

async function testModelMayChooseNotToSend() {
    const { input, database } = baseInput({
        async generateReply() {
            return {
                text:
                    '{"send":false,"message":"","next_check_minutes":240}',
                mode: "api"
            };
        }
    });

    const result = await handleTenantProactiveMessage(input);
    assert.deepEqual(result, {
        status: "handled",
        decision: "none",
        messageId: null,
        nextCheckMinutes: 240
    });
    assert.equal(database.tables.messages.length, 0);
    assert.equal(database.tables.delivery_events.length, 0);
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testRetryReusesSavedMessageWithoutCallingModelAgain() {
    const existing = {
        id: 88,
        conversation_id: CONVERSATION_ID,
        role: "assistant",
        content: "已经保存过的主动消息。",
        tool_calls: {
            is_proactive: true,
            source_background_job_id: JOB_ID
        },
        created_at: "2026-07-26T12:30:00.000Z"
    };
    const database = createDatabase({
        conversations: [
            {
                id: CONVERSATION_ID,
                updated_at: "2026-07-26T12:30:00.000Z"
            }
        ],
        messages: [existing]
    });
    let generateCalls = 0;
    const { input } = baseInput({
        database,
        async generateReply() {
            generateCalls += 1;
            throw new Error("must not generate twice");
        }
    });

    const result = await handleTenantProactiveMessage(input);
    assert.equal(result.decision, "recovered");
    assert.equal(result.messageId, 88);
    assert.equal(generateCalls, 0);
    assert.equal(database.tables.messages.length, 1);
    assert.equal(database.tables.delivery_events.length, 1);
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testDisabledSettingDoesNotCreateRecurringWork() {
    const { input, database } = baseInput({
        async getSettings() {
            return { push_enabled: false };
        },
        async generateReply() {
            throw new Error("disabled proactive messages must not generate");
        }
    });
    const result = await handleTenantProactiveMessage(input);
    assert.deepEqual(result, {
        status: "skipped",
        reason: "disabled"
    });
    assert.equal(database.tables.messages.length, 0);
    assert.equal(database.tables.delivery_events.length, 0);
    assert.equal(database.tables.background_jobs.length, 0);
}

async function testDailyLimitSkipsModelButKeepsRecurringEvaluation() {
    let generateCalls = 0;
    let quotaCalls = 0;
    const { input, database } = baseInput({
        async getSettings() {
            return {
                push_enabled: true,
                max_push_per_day: 1,
                timezone: "Asia/Shanghai"
            };
        },
        async countProactiveMessagesForDay(options) {
            quotaCalls += 1;
            assert.equal(options.limit, 1);
            assert.equal(options.timezone, "Asia/Shanghai");
            return 1;
        },
        async generateReply() {
            generateCalls += 1;
            throw new Error("daily limit must skip the model call");
        }
    });

    const result = await handleTenantProactiveMessage(input);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "daily_limit");
    assert.equal(result.sentToday, 1);
    assert.equal(result.maxPushPerDay, 1);
    assert.ok(result.nextCheckMinutes >= 1);
    assert.equal(generateCalls, 0);
    assert.equal(quotaCalls, 1);
    assert.equal(database.tables.messages.length, 0);
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testZeroDailyLimitSkipsWithoutCountingOrGenerating() {
    let quotaCalls = 0;
    let generateCalls = 0;
    const { input, database } = baseInput({
        async getSettings() {
            return {
                push_enabled: true,
                max_push_per_day: 0,
                timezone: "Asia/Shanghai"
            };
        },
        async countProactiveMessagesForDay() {
            quotaCalls += 1;
            return 0;
        },
        async generateReply() {
            generateCalls += 1;
            return { text: "{}" };
        }
    });

    const result = await handleTenantProactiveMessage(input);
    assert.equal(result.reason, "daily_limit");
    assert.equal(result.maxPushPerDay, 0);
    assert.equal(quotaCalls, 0);
    assert.equal(generateCalls, 0);
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testChatSeedKeepsAtMostOnePendingEvaluation() {
    const database = createDatabase();
    const first = await scheduleProactiveMessageEvaluation({
        database,
        sourceMessageId: 501,
        now: () => new Date("2026-07-26T13:00:00.000Z"),
        random: () => 0
    });
    const second = await scheduleProactiveMessageEvaluation({
        database,
        sourceMessageId: 502,
        now: () => new Date("2026-07-26T13:01:00.000Z"),
        random: () => 1
    });

    assert.equal(first.scheduled, true);
    assert.equal(second.scheduled, false);
    assert.equal(second.reason, "already_pending");
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testReconciliationCanRepairAMissingChain() {
    const database = createDatabase();
    const result = await scheduleProactiveMessageEvaluation({
        database,
        reconciliationId: "2026-07-29T02",
        now: () => new Date("2026-07-29T02:00:00.000Z"),
        random: () => 0
    });
    assert.equal(result.scheduled, true);
    assert.equal(database.tables.background_jobs.length, 1);
    assert.equal(
        database.tables.background_jobs[0].dedupe_key,
        "proactive:reconciliation:2026-07-29T02"
    );
    assert.deepEqual(database.tables.background_jobs[0].payload, {
        reason: "reconciliation",
        reconciliation_id: "2026-07-29T02"
    });
}

Promise.resolve()
    .then(testDailyCountUsesTenantScopedLocalDayWindow)
    .then(testSavesMessageBeforeDeliveryAndSchedulesNextEvaluation)
    .then(testModelMayChooseNotToSend)
    .then(testRetryReusesSavedMessageWithoutCallingModelAgain)
    .then(testDisabledSettingDoesNotCreateRecurringWork)
    .then(testDailyLimitSkipsModelButKeepsRecurringEvaluation)
    .then(testZeroDailyLimitSkipsWithoutCountingOrGenerating)
    .then(testChatSeedKeepsAtMostOnePendingEvaluation)
    .then(testReconciliationCanRepairAMissingChain)
    .then(() => console.log("tenant proactive message tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
