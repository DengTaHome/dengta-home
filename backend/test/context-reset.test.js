const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    isContextTimestampCurrent,
    loadCompanionInteractionContextRows,
    loadMainChatContextRows,
    loadMemoryCompressionRows
} = require("../services/context-reset");
const {
    planCreativeArtwork
} = require("../services/tenant-companion-creative");

const RESET_AT = "2026-07-29T02:00:00.000Z";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000099";

function createDatabase(initial = {}) {
    const tables = {
        messages: [],
        memories: [],
        companion_profile_versions: [],
        companion_creative_inspirations: [],
        ...structuredClone(initial)
    };

    function from(table) {
        const filters = [];
        const orderBy = [];
        let limitCount = null;

        function selectedRows() {
            let rows = tables[table].filter((row) =>
                filters.every(([kind, column, value]) => {
                    if (kind === "eq") {
                        return ["context_visible", "visible"].includes(column)
                            ? row[column] !== false
                            : row[column] === value;
                    }
                    if (kind === "in") return value.includes(row[column]);
                    if (kind === "gte") {
                        return String(row[column] || "") >= String(value);
                    }
                    if (kind === "cursor") {
                        const match = value.match(/^created_at\.(lt|gt)\.(.+),and\(created_at.eq\..+,id\.(?:lt|gt)\.([^()]+)\)$/);
                        assert.ok(match, value);
                        const [, direction, time, id] = match;
                        const comparison = String(row.created_at).localeCompare(time) || Number(row.id) - Number(id);
                        return direction === "lt" ? comparison < 0 : comparison > 0;
                    }
                    if (kind === "not_contains") {
                        return !Object.entries(value).every(
                            ([key, expected]) =>
                                row[column]?.[key] === expected
                        );
                    }
                    if (kind === "contains") {
                        return Object.entries(value).every(
                            ([key, expected]) =>
                                row[column]?.[key] === expected
                        );
                    }
                    return true;
                })
            );
            if (orderBy.length) {
                rows = [...rows].sort((left, right) => {
                    for (const [column, options] of orderBy) {
                    const comparison = String(
                        left[column] || ""
                    ).localeCompare(String(right[column] || ""));
                    if (comparison) return options?.ascending === false
                        ? -comparison
                        : comparison;
                    }
                    return 0;
                });
            }
            return limitCount == null ? rows : rows.slice(0, limitCount);
        }

        const builder = {
            select() {
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
            not(column, operator, value) {
                assert.equal(operator, "cs");
                filters.push([
                    "not_contains",
                    column,
                    JSON.parse(value)
                ]);
                return builder;
            },
            contains(column, value) {
                filters.push(["contains", column, value]);
                return builder;
            },
            order(column, options) {
                orderBy.push([column, options]);
                return builder;
            },
            or(value) {
                filters.push(["cursor", null, value]);
                return builder;
            },
            limit(value) {
                limitCount = value;
                return builder;
            },
            async maybeSingle() {
                return {
                    data: selectedRows()[0] || null,
                    error: null
                };
            },
            then(resolve, reject) {
                return Promise.resolve({
                    data: selectedRows(),
                    error: null
                }).then(resolve, reject);
            }
        };
        return builder;
    }

    return { from, tables };
}

function sourceRows() {
    return {
        messages: [
            {
                id: 1,
                conversation_id: CONVERSATION_ID,
                role: "user",
                content: "reset-before user message",
                visible: true,
                context_visible: false,
                tool_calls: {},
                created_at: "2026-07-29T01:59:59.999Z"
            },
            {
                id: 2,
                conversation_id: CONVERSATION_ID,
                role: "assistant",
                content: "reset-boundary assistant message",
                visible: true,
                context_visible: true,
                tool_calls: {},
                created_at: RESET_AT
            },
            {
                id: 3,
                conversation_id: CONVERSATION_ID,
                role: "user",
                content: "reset-after user message",
                visible: true,
                context_visible: true,
                tool_calls: {},
                created_at: "2026-07-29T02:00:01.000Z"
            },
            {
                id: 4,
                conversation_id: CONVERSATION_ID,
                role: "assistant",
                content: "reset-after interaction",
                visible: true,
                context_visible: true,
                tool_calls: { is_companion_interaction: true },
                created_at: "2026-07-29T02:00:02.000Z"
            }
        ],
        memories: [
            {
                summary: "reset-before memory",
                confirmation_status: "confirmed",
                superseded: false,
                locked: false,
                created_at: "2026-07-29T01:59:59.999Z",
                updated_at: "2026-07-29T03:00:00.000Z"
            },
            {
                summary: "reset-after memory",
                confirmation_status: "confirmed",
                superseded: false,
                locked: false,
                created_at: "2026-07-29T02:00:01.000Z",
                updated_at: "2026-07-29T02:00:01.000Z"
            },
            {
                summary: "rejected memory",
                confirmation_status: "rejected",
                superseded: false,
                locked: false,
                created_at: "2026-07-29T02:00:02.000Z",
                updated_at: "2026-07-29T02:00:02.000Z"
            }
        ]
    };
}

async function testMainChatExcludesResetBeforeContext() {
    const database = createDatabase(sourceRows());
    const context = await loadMainChatContextRows({
        database,
        conversationId: CONVERSATION_ID,
        settings: {
            context_turns: 20,
            context_reset_at: RESET_AT
        }
    });

    assert.deepEqual(
        context.messages.map((item) => item.id),
        [2, 3, 4]
    );
    assert.deepEqual(
        context.memories.map((item) => item.summary),
        ["reset-after memory"]
    );
}

async function testInteractionExcludesResetBeforeContext() {
    const database = createDatabase(sourceRows());
    const context = await loadCompanionInteractionContextRows({
        database,
        conversationId: CONVERSATION_ID,
        settings: { context_reset_at: RESET_AT }
    });

    assert.deepEqual(
        context.messages.map((item) => item.id),
        [2, 3, 4]
    );
    assert.deepEqual(
        context.memories.map((item) => item.summary),
        ["reset-after memory"]
    );
}

async function testCompressionCannotResummarizeResetBeforeRows() {
    const database = createDatabase(sourceRows());
    const context = await loadMemoryCompressionRows({
        database,
        conversationId: CONVERSATION_ID,
        settings: { context_reset_at: RESET_AT }
    });

    assert.deepEqual(
        context.messages.map((item) => item.id),
        [2, 3, 4]
    );
    assert.deepEqual(
        context.memories.map((item) => item.summary),
        ["reset-after memory"]
    );
}

async function testContextVisibilityExcludesCompressedHistoryOnlyFromModels() {
    const database = createDatabase(sourceRows());
    const context = await loadMainChatContextRows({
        database,
        conversationId: CONVERSATION_ID,
        settings: { context_turns: 20 }
    });

    assert.deepEqual(context.messages.map((item) => item.id), [2, 3, 4]);
    assert.equal(database.tables.messages[0].visible, true);
    assert.equal(database.tables.messages[0].context_visible, false);
}

function testClientStatusSnapshotsRespectResetBoundary() {
    assert.equal(isContextTimestampCurrent(null, {}), true);
    assert.equal(
        isContextTimestampCurrent(null, { context_reset_at: RESET_AT }),
        false
    );
    assert.equal(
        isContextTimestampCurrent("2026-07-29T01:59:59.999Z", {
            context_reset_at: RESET_AT
        }),
        false
    );
    assert.equal(
        isContextTimestampCurrent(RESET_AT, { context_reset_at: RESET_AT }),
        true
    );
    assert.equal(
        isContextTimestampCurrent("2026-07-29T02:00:00.001Z", {
            context_reset_at: RESET_AT
        }),
        true
    );
}

function testCreativeLeaseIsRecheckedBeforePersistingIdea() {
    const source = fs.readFileSync(
        path.join(
            __dirname,
            "..",
            "services",
            "tenant-companion-creative.js"
        ),
        "utf8"
    );
    assert.match(
        source,
        /await lease[.]assertOwned\(\);\s*const created = await center[.]createIdea\(/
    );
}

function testMigrationAddsNullableCutoffWithoutRewritingSettings() {
    const migration = fs.readFileSync(
        path.join(
            __dirname,
            "..",
            "supabase",
            "022_context_reset_cutoff.sql"
        ),
        "utf8"
    );
    assert.match(
        migration,
        /add column if not exists context_reset_at timestamptz/i
    );
    assert.doesNotMatch(migration, /context_reset_at\s+timestamptz\s+not null/i);
    assert.match(
        migration,
        /create or replace function public\.reset_dengta_persona_memory\s*\(\s*p_auth_uid uuid,\s*p_companion_id uuid\s*\)/i
    );
    assert.match(migration, /security invoker/i);
    assert.match(migration, /clock_timestamp\s*\(\s*\)/i);
    for (const table of [
        "stable_memory_candidates",
        "companion_profile_versions",
        "memories",
        "conversation_composer_hints",
        "background_jobs"
    ]) {
        assert.match(
            migration,
            new RegExp(
                `delete\\s+from\\s+public[.]${table}[\\s\\S]*?user_id\\s*=\\s*p_auth_uid[\\s\\S]*?companion_id\\s*=\\s*p_companion_id`,
                "i"
            )
        );
    }
    for (const jobType of [
        "proactive_message",
        "profile_refresh",
        "diary_update",
        "moment_post",
        "creative_check",
        "moment_interaction",
        "surprise_reveal"
    ]) {
        assert.match(migration, new RegExp(`'${jobType}'`, "i"));
    }
    assert.match(migration, /'context_jobs'/i);
    assert.match(migration, /'context_jobs_by_type'/i);
    assert.match(
        migration,
        /revoke all on function public\.reset_dengta_persona_memory\s*\(\s*uuid,\s*uuid\s*\)\s*from public,\s*anon,\s*authenticated/i
    );
    assert.match(
        migration,
        /grant execute on function public\.reset_dengta_persona_memory\s*\(\s*uuid,\s*uuid\s*\)\s*to service_role/i
    );
    assert.match(migration, /notify pgrst,\s*'reload schema'/i);
}

function testChatHistoryEndpointRemainsOutsideModelCutoff() {
    const serverSource = fs.readFileSync(
        path.join(__dirname, "..", "server.js"),
        "utf8"
    );
    const start = serverSource.indexOf(
        'app.get("/sessions/:id/messages"'
    );
    const end = serverSource.indexOf("app.", start + 1);
    const historyRoute = serverSource.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(historyRoute, /\.from\("messages"\)/);
    assert.doesNotMatch(
        historyRoute,
        /applyContextResetCutoff|context_reset_at|\.gte\("created_at"/
    );

    const modelContextSection = serverSource.slice(
        serverSource.indexOf("async function loadChatContext"),
        serverSource.indexOf("async function touchConversation")
    );
    assert.match(
        modelContextSection,
        /loadMainChatContextRows\(\{[\s\S]*?settings/
    );
    assert.match(
        modelContextSection,
        /loadCompanionInteractionContextRows\(\{[\s\S]*?settings/
    );
    const compressionSection = serverSource.slice(
        serverSource.indexOf("async function compressMemoryIfNeeded"),
        serverSource.indexOf("async function tryCompressMemory")
    );
    assert.match(
        compressionSection,
        /loadMemoryCompressionRows\(\{[\s\S]*?settings/
    );
}

async function testCreativePlanningCannotReuseResetBeforeSources() {
    const database = createDatabase({
        messages: [
            {
                id: 10,
                role: "user",
                content: "RESET_BEFORE_CREATIVE_USER",
                created_at: "2026-07-29T01:00:00.000Z"
            },
            {
                id: 11,
                role: "assistant",
                content: "RESET_BEFORE_CREATIVE_ASSISTANT",
                created_at: "2026-07-29T01:01:00.000Z"
            },
            {
                id: 12,
                role: "user",
                content: "RESET_AFTER_CREATIVE_USER",
                created_at: RESET_AT
            },
            {
                id: 13,
                role: "assistant",
                content: "RESET_AFTER_CREATIVE_ASSISTANT",
                created_at: "2026-07-29T02:01:00.000Z"
            }
        ],
        companion_profile_versions: [
            {
                version: 99,
                profile: { introduction: "RESET_BEFORE_PROFILE" },
                created_at: "2026-07-29T01:30:00.000Z"
            },
            {
                version: 1,
                profile: { introduction: "RESET_AFTER_PROFILE" },
                created_at: "2026-07-29T02:00:01.000Z"
            }
        ],
        memories: [
            {
                summary: "RESET_BEFORE_CREATIVE_MEMORY",
                confirmation_status: "confirmed",
                superseded: false,
                locked: false,
                created_at: "2026-07-29T01:00:00.000Z",
                updated_at: "2026-07-29T03:00:00.000Z"
            },
            {
                summary: "RESET_AFTER_CREATIVE_MEMORY",
                confirmation_status: "confirmed",
                superseded: false,
                locked: false,
                created_at: "2026-07-29T02:00:01.000Z",
                updated_at: "2026-07-29T02:00:01.000Z"
            }
        ]
    });
    let generatedInput = null;
    await planCreativeArtwork({
        database,
        async getSettings() {
            return { context_reset_at: RESET_AT };
        },
        async generateReply(input) {
            generatedInput = input;
            return {
                text: JSON.stringify({
                    create: false,
                    next_check_minutes: 180
                })
            };
        },
        now: () => new Date("2026-07-29T03:00:00.000Z")
    });

    assert.ok(generatedInput);
    const prompt = generatedInput.messages[0].content;
    assert.doesNotMatch(prompt, /RESET_BEFORE_CREATIVE/);
    assert.doesNotMatch(prompt, /RESET_BEFORE_PROFILE/);
    assert.match(prompt, /RESET_AFTER_CREATIVE_USER/);
    assert.match(prompt, /RESET_AFTER_PROFILE/);
    assert.deepEqual(generatedInput.memories, [
        "RESET_AFTER_CREATIVE_MEMORY"
    ]);
}

Promise.resolve()
    .then(testMainChatExcludesResetBeforeContext)
    .then(testInteractionExcludesResetBeforeContext)
    .then(testCompressionCannotResummarizeResetBeforeRows)
    .then(testContextVisibilityExcludesCompressedHistoryOnlyFromModels)
    .then(testClientStatusSnapshotsRespectResetBoundary)
    .then(testCreativeLeaseIsRecheckedBeforePersistingIdea)
    .then(testMigrationAddsNullableCutoffWithoutRewritingSettings)
    .then(testChatHistoryEndpointRemainsOutsideModelCutoff)
    .then(testCreativePlanningCannotReuseResetBeforeSources)
    .then(() => console.log("context reset cutoff tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
