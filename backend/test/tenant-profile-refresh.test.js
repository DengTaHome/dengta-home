const assert = require("node:assert/strict");
const {
    applyProfileRefreshDecision,
    handleTenantProfileRefresh,
    normalizeCompanionProfile,
    parseProfileRefreshDecision,
    scheduleProfileRefresh
} = require("../services/tenant-profile-refresh");
const {
    stableUuid
} = require("../services/tenant-proactive-message");

const JOB_ID = "10000000-0000-4000-8000-000000000031";
const CONVERSATION_A =
    "20000000-0000-4000-8000-000000000031";
const CONVERSATION_B =
    "20000000-0000-4000-8000-000000000032";

function sourceMessages() {
    return [
        {
            id: 1,
            conversation_id: CONVERSATION_A,
            role: "assistant",
            content: "我其实很喜欢雨天安静待着。",
            visible: true,
            context_visible: true,
            created_at: "2026-07-27T01:00:00.000Z"
        },
        {
            id: 2,
            conversation_id: CONVERSATION_B,
            role: "assistant",
            content: "下雨的时候我还是更想慢慢说话。",
            visible: true,
            context_visible: true,
            created_at: "2026-07-27T02:00:00.000Z"
        },
        {
            id: 3,
            conversation_id: CONVERSATION_A,
            role: "assistant",
            content: "雨声会让我安静下来，这点一直没变。",
            visible: true,
            context_visible: true,
            created_at: "2026-07-27T03:00:00.000Z"
        },
        {
            id: 4,
            conversation_id: CONVERSATION_B,
            role: "user",
            content: "那今晚一起听雨。",
            visible: true,
            context_visible: true,
            created_at: "2026-07-27T04:00:00.000Z"
        }
    ];
}

function createDatabase(initial = {}) {
    const tables = {
        companion_profile_versions: [],
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
        let rangeValue = null;

        function selectedRows() {
            let rows = tables[table].filter((row) =>
                filters.every(([kind, column, value]) => {
                    if (kind === "eq") return row[column] === value;
                    if (kind === "in") return value.includes(row[column]);
                    if (kind === "gte") {
                        return String(row[column] || "") >= String(value);
                    }
                    return true;
                })
            );
            if (orderBy) {
                const [column, options] = orderBy;
                rows = [...rows].sort((left, right) => {
                    const leftValue = left[column];
                    const rightValue = right[column];
                    const comparison =
                        typeof leftValue === "number" &&
                        typeof rightValue === "number"
                            ? leftValue - rightValue
                            : String(leftValue || "").localeCompare(
                                  String(rightValue || "")
                              );
                    return options?.ascending === false
                        ? -comparison
                        : comparison;
                });
            }
            if (rangeValue) {
                rows = rows.slice(
                    rangeValue[0],
                    rangeValue[1] + 1
                );
            }
            return limitCount == null
                ? rows
                : rows.slice(0, limitCount);
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
                    table === "companion_profile_versions" &&
                    tables.companion_profile_versions.some(
                        (item) =>
                            item.id === inserted.id ||
                            item.version === inserted.version
                    )
                ) {
                    return { data: null, error: { code: "23505" } };
                }
                const saved = {
                    id:
                        inserted.id ||
                        `${table}-${tables[table].length + 1}`,
                    status: inserted.status || "pending",
                    created_at:
                        inserted.created_at ||
                        "2026-07-27T05:00:00.000Z",
                    ...inserted
                };
                tables[table].push(saved);
                return { data: saved, error: null };
            }
            if (action === "delete") {
                const selected = new Set(
                    selectedRows().map((item) => item.id)
                );
                tables[table] = tables[table].filter(
                    (item) => !selected.has(item.id)
                );
                return { data: null, error: null };
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
            delete() {
                action = "delete";
                return builder;
            },
            eq(column, value) {
                filters.push(["eq", column, value]);
                return builder;
            },
            in(column, values) {
                filters.push(["in", column, values]);
                return builder;
            },
            gte(column, value) {
                filters.push(["gte", column, value]);
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
            range(start, end) {
                rangeValue = [start, end];
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

function modelDecision(overrides = {}) {
    return {
        update: true,
        introduction: "我喜欢安静的雨声，也习惯把在意放进慢一点的话里。",
        introduction_evidence_message_ids: ["1", "2", "3"],
        stable_updates: [
            {
                field: "likes",
                values: ["安静的雨天"],
                evidence_message_ids: ["1", "2", "3"]
            }
        ],
        current_mood: {
            label: "安静开心",
            note: "想和桃桃一起听雨",
            evidence_message_ids: ["4"]
        },
        identity_proposals: [
            {
                field: "gender_identity",
                proposed_value: "非二元",
                evidence_message_ids: ["1", "2", "3"]
            }
        ],
        change_reason: "跨会话里反复表达了对雨天的偏爱。",
        next_check_minutes: 240,
        ...overrides
    };
}

function baseInput(overrides = {}) {
    const database =
        overrides.database ||
        createDatabase({
            messages: sourceMessages(),
            memories: [
                {
                    summary: "桃桃和小灯会一起聊夜晚的天气。",
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
            job_type: "profile_refresh",
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
                text: JSON.stringify(modelDecision()),
                mode: "api"
            };
        },
        now: () => new Date("2026-07-27T05:00:00.000Z"),
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

function testEvidenceThresholdAndIdentityConfirmationBoundary() {
    const decision = parseProfileRefreshDecision(
        JSON.stringify(modelDecision())
    );
    const applied = applyProfileRefreshDecision({
        decision,
        previousProfile: {},
        messages: sourceMessages(),
        now: () => new Date("2026-07-27T05:00:00.000Z")
    });

    assert.equal(applied.changed, true);
    assert.deepEqual(applied.profile.stable.likes, ["安静的雨天"]);
    assert.equal(
        applied.profile.identity.gender_identity,
        "",
        "identity proposals must not directly change confirmed identity"
    );
    assert.equal(applied.profile.pending_identity_changes.length, 1);
    assert.equal(
        applied.profile.pending_identity_changes[0].proposed_value,
        "非二元"
    );
    assert.equal(applied.profile.current_mood.label, "安静开心");
    assert.equal(
        applied.profile.current_mood.expires_at,
        "2026-07-28T05:00:00.000Z"
    );
}

function testSameConversationEvidenceCannotChangeStableProfile() {
    const decision = parseProfileRefreshDecision(
        JSON.stringify(
            modelDecision({
                current_mood: {},
                identity_proposals: [],
                introduction_evidence_message_ids: ["1", "3"],
                stable_updates: [
                    {
                        field: "likes",
                        values: ["安静的雨天"],
                        evidence_message_ids: ["1", "3"]
                    }
                ]
            })
        )
    );
    const applied = applyProfileRefreshDecision({
        decision,
        previousProfile: {},
        messages: sourceMessages(),
        now: () => new Date("2026-07-27T05:00:00.000Z")
    });

    assert.equal(applied.changed, false);
    assert.deepEqual(applied.profile.stable.likes, []);
    assert.equal(applied.profile.introduction, "");
}

function testExpiredMoodIsHidden() {
    const profile = normalizeCompanionProfile(
        {
            current_mood: {
                label: "昨天很开心",
                expires_at: "2026-07-26T05:00:00.000Z"
            }
        },
        () => new Date("2026-07-27T05:00:00.000Z")
    );
    assert.equal(profile.current_mood, null);
}

async function testHandlerCreatesVersionAndSchedulesNext() {
    const { input, database, getState } = baseInput();
    const result = await handleTenantProfileRefresh(input);
    const profileVersionId = stableUuid(
        "profile-version",
        JOB_ID
    );

    assert.deepEqual(result, {
        status: "handled",
        decision: "updated",
        profileVersionId,
        version: 1,
        nextCheckMinutes: 240
    });
    assert.equal(database.tables.companion_profile_versions.length, 1);
    const saved = database.tables.companion_profile_versions[0];
    assert.equal(saved.id, profileVersionId);
    assert.equal(saved.confirmed_identity_change, false);
    assert.equal(saved.profile.identity.gender_identity, "");
    assert.equal(saved.profile.pending_identity_changes.length, 1);
    assert.equal(database.tables.background_jobs.length, 1);
    assert.equal(
        database.tables.background_jobs[0].job_type,
        "profile_refresh"
    );
    assert.equal(
        database.tables.background_jobs[0].due_at,
        "2026-07-27T09:00:00.000Z"
    );
    assert.equal(
        getState().generatedInput.promptArchitecture,
        "profile-refresh-module"
    );
    assert.match(
        getState().generatedInput.messages[0].content,
        /message_id=1/
    );
    assert.ok(getState().leaseChecks >= 3);
}

async function testRetryRecoversSavedVersion() {
    const id = stableUuid("profile-version", JOB_ID);
    const database = createDatabase({
        companion_profile_versions: [
            {
                id,
                version: 7,
                profile: { introduction: "已经保存" }
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
    const result = await handleTenantProfileRefresh(input);

    assert.equal(result.decision, "recovered");
    assert.equal(result.profileVersionId, id);
    assert.equal(result.version, 7);
    assert.equal(generateCalls, 0);
    assert.equal(database.tables.companion_profile_versions.length, 1);
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testChatSeedKeepsOnePendingEvaluation() {
    const database = createDatabase();
    const first = await scheduleProfileRefresh({
        database,
        sourceMessageId: 901,
        now: () => new Date("2026-07-27T05:00:00.000Z"),
        random: () => 0
    });
    const second = await scheduleProfileRefresh({
        database,
        sourceMessageId: 902,
        now: () => new Date("2026-07-27T05:01:00.000Z"),
        random: () => 1
    });

    assert.equal(first.scheduled, true);
    assert.equal(second.scheduled, false);
    assert.equal(second.reason, "already_pending");
    assert.equal(database.tables.background_jobs.length, 1);
}

async function testReconciliationCanRepairAMissingChain() {
    const database = createDatabase();
    const result = await scheduleProfileRefresh({
        database,
        reconciliationId: "2026-07-29T02",
        now: () => new Date("2026-07-29T02:00:00.000Z"),
        random: () => 0
    });
    assert.equal(result.scheduled, true);
    assert.equal(database.tables.background_jobs.length, 1);
    assert.equal(
        database.tables.background_jobs[0].dedupe_key,
        "profile-refresh:reconciliation:2026-07-29T02"
    );
    assert.deepEqual(database.tables.background_jobs[0].payload, {
        reason: "reconciliation",
        reconciliation_id: "2026-07-29T02"
    });
}

async function testResetCutoffExcludesOldProfileEvidenceAndMemories() {
    const database = createDatabase({
        messages: sourceMessages(),
        memories: [
            {
                summary: "reset-before profile memory",
                confirmation_status: "confirmed",
                created_at: "2026-07-27T01:30:00.000Z",
                updated_at: "2026-07-27T06:00:00.000Z"
            },
            {
                summary: "reset-after profile memory",
                confirmation_status: "confirmed",
                created_at: "2026-07-27T03:30:00.000Z",
                updated_at: "2026-07-27T03:30:00.000Z"
            }
        ]
    });
    const { input, getState } = baseInput({
        database,
        async getSettings() {
            return {
                ai_name: "小灯",
                timezone: "Asia/Shanghai",
                context_reset_at: "2026-07-27T02:30:00.000Z"
            };
        }
    });

    await handleTenantProfileRefresh(input);
    const generatedInput = getState().generatedInput;
    assert.ok(generatedInput);
    assert.doesNotMatch(
        generatedInput.messages[0].content,
        /\[message_id=(?:1|2);/
    );
    assert.match(generatedInput.messages[0].content, /\[message_id=3;/);
    assert.deepEqual(
        generatedInput.memories.map((item) => item.summary),
        ["reset-after profile memory"]
    );
}

Promise.resolve()
    .then(testEvidenceThresholdAndIdentityConfirmationBoundary)
    .then(testSameConversationEvidenceCannotChangeStableProfile)
    .then(testExpiredMoodIsHidden)
    .then(testHandlerCreatesVersionAndSchedulesNext)
    .then(testRetryRecoversSavedVersion)
    .then(testChatSeedKeepsOnePendingEvaluation)
    .then(testReconciliationCanRepairAMissingChain)
    .then(testResetCutoffExcludesOldProfileEvidenceAndMemories)
    .then(() => console.log("tenant profile refresh tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
