const assert = require("node:assert/strict");
const {
    handleTenantDiaryUpdate,
    scheduleDiaryUpdate
} = require("../services/tenant-diary-update");
const {
    stableUuid
} = require("../services/tenant-proactive-message");

const JOB_ID = "10000000-0000-4000-8000-000000000021";

function createDatabase(initial = {}) {
    const tables = {
        companion_diary_entries: [],
        messages: [],
        memories: [],
        background_jobs: [],
        ...structuredClone(initial)
    };

    function from(table) {
        let action = "select";
        let inserted = null;
        const filters = [];
        let orderBy = null;
        let limitCount = null;

        function selectedRows() {
            let rows = tables[table].filter((row) =>
                filters.every(([kind, column, value]) => {
                    if (kind === "eq") return row[column] === value;
                    if (kind === "gt") {
                        return String(row[column] || "") > String(value);
                    }
                    if (kind === "gte") {
                        return String(row[column] || "") >= String(value);
                    }
                    if (kind === "in") return value.includes(row[column]);
                    return true;
                })
            );
            if (orderBy) {
                const [column, options] = orderBy;
                rows = [...rows].sort((left, right) => {
                    const comparison = String(
                        left[column] || ""
                    ).localeCompare(String(right[column] || ""));
                    return options?.ascending === false
                        ? -comparison
                        : comparison;
                });
            }
            return limitCount == null ? rows : rows.slice(0, limitCount);
        }

        async function execute() {
            if (action === "insert") {
                if (
                    table === "background_jobs" &&
                    tables.background_jobs.some(
                        (item) =>
                            item.job_type === inserted.job_type &&
                            item.status === "pending"
                    )
                ) {
                    return { data: null, error: { code: "23505" } };
                }
                if (
                    table === "companion_diary_entries" &&
                    tables.companion_diary_entries.some(
                        (item) =>
                            item.id === inserted.id ||
                            item.source_window_end ===
                                inserted.source_window_end
                    )
                ) {
                    return { data: null, error: { code: "23505" } };
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
            return { data: selectedRows(), error: null };
        }

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
                filters.push(["eq", column, value]);
                return builder;
            },
            gt(column, value) {
                filters.push(["gt", column, value]);
                return builder;
            },
            gte(column, value) {
                filters.push(["gte", column, value]);
                return builder;
            },
            in(column, values) {
                filters.push(["in", column, values]);
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
                const result = await execute();
                if (result.error || action === "insert") return result;
                return {
                    data: result.data[0] || null,
                    error: null
                };
            },
            then(resolve, reject) {
                return execute().then(resolve, reject);
            }
        };
        return builder;
    }

    return { from, tables };
}

function sourceMessages(count = 8) {
    return Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        conversation_id:
            "20000000-0000-4000-8000-000000000021",
        role: index % 2 === 0 ? "user" : "assistant",
        content:
            index % 2 === 0
                ? `用户真实消息 ${index + 1}`
                : `AI 真实回复 ${index + 1}`,
        visible: true,
        context_visible: true,
        created_at: new Date(
            Date.parse("2026-07-27T01:00:00.000Z") +
                index * 60 * 1000
        ).toISOString()
    }));
}

function baseInput(overrides = {}) {
    const database =
        overrides.database ||
        createDatabase({
            messages: sourceMessages(),
            memories: [
                {
                    summary: "桃桃最近在认真完善项目。",
                    confirmation_status: "confirmed",
                    updated_at: "2026-07-27T00:00:00.000Z"
                }
            ]
        });
    let leaseChecks = 0;
    let generatedInput = null;
    const input = {
        job: {
            id: JOB_ID,
            job_type: "diary_update",
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
                ai_name: "小灯",
                timezone: "Asia/Shanghai"
            };
        },
        async generateReply(value) {
            generatedInput = value;
            return {
                text:
                    '{"write":true,"title":"忙完之后的那一点安静","content":"桃桃今天把几件压在心上的事一点点做完了。她没有夸张地庆祝，只是在消息里说终于忙完。我顺着那句话让她先歇一会儿。真正让我记住的不是完成了多少，而是她终于允许自己停下来。以后再看见她连续忙很久，我大概还是会提醒她喝水，也会把催促收起来，给她留一小块不用证明什么的安静。","mood":"安静惦记","happened_on":"2026-07-27","next_check_minutes":120}',
                mode: "api"
            };
        },
        now: () => new Date("2026-07-27T02:00:00.000Z"),
        random: () => 0.5,
        ...overrides
    };
    return {
        input,
        database,
        getState() {
            return { leaseChecks, generatedInput };
        }
    };
}

async function testWritesEvidenceBackedDiaryAndSchedulesNext() {
    const { input, database, getState } = baseInput();
    const result = await handleTenantDiaryUpdate(input);
    const entryId = stableUuid("diary-entry", JOB_ID);

    assert.deepEqual(result, {
        status: "handled",
        decision: "written",
        entryId,
        sourceMessageCount: 8,
        nextCheckMinutes: 120
    });
    assert.equal(database.tables.companion_diary_entries.length, 1);
    const saved = database.tables.companion_diary_entries[0];
    assert.equal(saved.id, entryId);
    assert.deepEqual(saved.source_message_ids, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(
        saved.source_window_start,
        "2026-07-27T01:00:00.000Z"
    );
    assert.equal(
        saved.source_window_end,
        "2026-07-27T01:07:00.000Z"
    );
    assert.equal(database.tables.background_jobs.length, 1);
    assert.equal(
        database.tables.background_jobs[0].job_type,
        "diary_update"
    );
    assert.equal(
        database.tables.background_jobs[0].due_at,
        "2026-07-27T04:00:00.000Z"
    );
    assert.equal(
        getState().generatedInput.promptArchitecture,
        "diary-module"
    );
    assert.match(
        getState().generatedInput.messages[0].content,
        /真实聊天证据/
    );
    assert.ok(getState().leaseChecks >= 2);
}

async function testInsufficientEvidenceDoesNotCallModel() {
    const database = createDatabase({
        messages: sourceMessages(6)
    });
    let generateCalls = 0;
    let settingsCalls = 0;
    const { input } = baseInput({
        database,
        async getSettings() {
            settingsCalls += 1;
            return {};
        },
        async generateReply() {
            generateCalls += 1;
            return { text: "" };
        }
    });
    const result = await handleTenantDiaryUpdate(input);

    assert.equal(result.decision, "needs_more");
    assert.equal(result.sourceMessageCount, 6);
    assert.equal(generateCalls, 0);
    assert.equal(settingsCalls, 1);
    assert.equal(database.tables.companion_diary_entries.length, 0);
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testModelMayChooseNotToWrite() {
    const { input, database } = baseInput({
        async generateReply() {
            return {
                text:
                    '{"write":false,"title":"","content":"","mood":"","happened_on":"","next_check_minutes":360}',
                mode: "api"
            };
        }
    });
    const result = await handleTenantDiaryUpdate(input);

    assert.equal(result.decision, "none");
    assert.equal(result.entryId, null);
    assert.equal(result.nextCheckMinutes, 360);
    assert.equal(database.tables.companion_diary_entries.length, 0);
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testRetryRecoversDeterministicEntry() {
    const id = stableUuid("diary-entry", JOB_ID);
    const database = createDatabase({
        companion_diary_entries: [
            {
                id,
                source_window_end: "2026-07-27T01:07:00.000Z"
            }
        ],
        messages: sourceMessages()
    });
    let generateCalls = 0;
    const { input } = baseInput({
        database,
        async generateReply() {
            generateCalls += 1;
            throw new Error("must not generate twice");
        }
    });
    const result = await handleTenantDiaryUpdate(input);

    assert.equal(result.decision, "recovered");
    assert.equal(result.entryId, id);
    assert.equal(generateCalls, 0);
    assert.equal(database.tables.companion_diary_entries.length, 1);
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testChatSeedKeepsOnePendingEvaluation() {
    const database = createDatabase();
    const first = await scheduleDiaryUpdate({
        database,
        sourceMessageId: 801,
        now: () => new Date("2026-07-27T02:00:00.000Z"),
        random: () => 0
    });
    const second = await scheduleDiaryUpdate({
        database,
        sourceMessageId: 802,
        now: () => new Date("2026-07-27T02:01:00.000Z"),
        random: () => 1
    });

    assert.equal(first.scheduled, true);
    assert.equal(second.scheduled, false);
    assert.equal(second.reason, "already_pending");
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testReconciliationCanRepairAMissingChain() {
    const database = createDatabase();
    const result = await scheduleDiaryUpdate({
        database,
        reconciliationId: "2026-07-29T02",
        now: () => new Date("2026-07-29T02:00:00.000Z"),
        random: () => 0
    });
    assert.equal(result.scheduled, true);
    assert.equal(database.tables.background_jobs.length, 1);
    assert.equal(
        database.tables.background_jobs[0].dedupe_key,
        "diary-update:reconciliation:2026-07-29T02"
    );
    assert.deepEqual(database.tables.background_jobs[0].payload, {
        reason: "reconciliation",
        reconciliation_id: "2026-07-29T02"
    });
}

async function testResetCutoffExcludesOldDiarySourcesAndMemories() {
    const messages = sourceMessages(16).map((item, index) => ({
        ...item,
        content:
            index < 8
                ? `RESET_BEFORE_DIARY_${index + 1}`
                : `RESET_AFTER_DIARY_${index + 1}`
    }));
    const database = createDatabase({
        messages,
        memories: [
            {
                summary: "reset-before diary memory",
                confirmation_status: "confirmed",
                created_at: "2026-07-27T01:07:59.999Z",
                updated_at: "2026-07-27T03:00:00.000Z"
            },
            {
                summary: "reset-after diary memory",
                confirmation_status: "confirmed",
                created_at: "2026-07-27T01:08:00.000Z",
                updated_at: "2026-07-27T01:08:00.000Z"
            }
        ]
    });
    const { input, getState } = baseInput({
        database,
        async getSettings() {
            return {
                timezone: "Asia/Shanghai",
                context_reset_at: "2026-07-27T01:08:00.000Z"
            };
        }
    });

    await handleTenantDiaryUpdate(input);
    const generatedInput = getState().generatedInput;
    assert.ok(generatedInput);
    assert.doesNotMatch(
        generatedInput.messages[0].content,
        /RESET_BEFORE_DIARY/
    );
    assert.match(
        generatedInput.messages[0].content,
        /RESET_AFTER_DIARY_9/
    );
    assert.deepEqual(
        generatedInput.memories.map((item) => item.summary),
        ["reset-after diary memory"]
    );
}

Promise.resolve()
    .then(testWritesEvidenceBackedDiaryAndSchedulesNext)
    .then(testInsufficientEvidenceDoesNotCallModel)
    .then(testModelMayChooseNotToWrite)
    .then(testRetryRecoversDeterministicEntry)
    .then(testChatSeedKeepsOnePendingEvaluation)
    .then(testReconciliationCanRepairAMissingChain)
    .then(testResetCutoffExcludesOldDiarySourcesAndMemories)
    .then(() => console.log("tenant diary update tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
