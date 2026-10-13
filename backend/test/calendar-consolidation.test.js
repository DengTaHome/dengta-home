const assert = require("node:assert/strict");
const {
    runCalendarConsolidation
} = require("../services/calendar-consolidation");

const NOW = Date.parse("2026-08-13T00:00:00.000Z");

function dayRows({ userId, companionId, conversationId = null }) {
    return Array.from({ length: 7 }, (_, index) => ({
        id: `${userId}-${companionId}-${conversationId || "none"}-${index}`,
        user_id: userId,
        companion_id: companionId,
        conversation_id: conversationId,
        period_type: "day",
        period_start: new Date(NOW - (10 - index) * 86400000).toISOString(),
        period_end: new Date(NOW - (9 - index) * 86400000).toISOString(),
        superseded: false,
        summary: `${userId} ${companionId} ${index}`
    }));
}

function createDatabase(rows, loadError = null) {
    const inserted = [];
    const superseded = [];
    let selectedColumns = [];
    return {
        inserted,
        superseded,
        get selectedColumns() {
            return selectedColumns;
        },
        from() {
            return {
                select(columns) {
                    selectedColumns = columns.split(",").map((column) => column.trim());
                    return this;
                },
                eq() {
                    return this;
                },
                order() {
                    return this;
                },
                async limit() {
                    if (loadError) return { data: null, error: loadError };
                    return {
                        data: rows.map((row) => Object.fromEntries(
                            selectedColumns.map((column) => [column, row[column]])
                        )),
                        error: null
                    };
                },
                async insert(row) {
                    inserted.push(row);
                    return { error: null };
                },
                update() {
                    return this;
                },
                async in(column, ids) {
                    assert.equal(column, "id");
                    superseded.push([...ids]);
                    return { error: null };
                }
            };
        }
    };
}

async function consolidate(database) {
    return runCalendarConsolidation({
        database,
        force: true,
        now: () => NOW,
        logger: { info() {}, error() {} }
    });
}

async function testSeparatesTenants() {
    const tenantA = dayRows({ userId: "user-a", companionId: "companion-a" });
    const tenantB = dayRows({ userId: "user-b", companionId: "companion-b" });
    const database = createDatabase([...tenantA, ...tenantB]);
    const result = await consolidate(database);

    assert.equal(result.completed, 2);
    assert.equal(database.inserted.length, 2);
    assert.ok(database.selectedColumns.includes("user_id"));
    assert.ok(database.selectedColumns.includes("companion_id"));
    assert.deepEqual(
        database.inserted.map(({ user_id, companion_id }) => ({ user_id, companion_id })),
        [
            { user_id: "user-a", companion_id: "companion-a" },
            { user_id: "user-b", companion_id: "companion-b" }
        ]
    );
    for (const inserted of database.inserted) {
        assert.equal(inserted.source_ids.length, 7);
        assert.ok(inserted.source_ids.every((id) => id.startsWith(inserted.user_id)));
    }
    assert.deepEqual(database.superseded, [
        tenantA.map((row) => row.id),
        tenantB.map((row) => row.id)
    ]);
}

async function testSeparatesConversations() {
    const conversationA = dayRows({
        userId: "user-a",
        companionId: "companion-a",
        conversationId: "conversation-a"
    });
    const conversationB = dayRows({
        userId: "user-a",
        companionId: "companion-a",
        conversationId: "conversation-b"
    });
    const database = createDatabase([...conversationA, ...conversationB]);
    await consolidate(database);

    assert.deepEqual(
        database.inserted.map((row) => row.conversation_id),
        ["conversation-a", "conversation-b"]
    );
    assert.ok(database.inserted.every((row) =>
        row.source_ids.every((id) => id.includes(row.conversation_id))
    ));
}

async function testLoadErrorsAreSkipped() {
    for (const error of [
        Object.assign(new Error("relation does not exist"), { code: "42P01" }),
        Object.assign(new Error("query failed"), { code: "XX000" })
    ]) {
        const result = await consolidate(createDatabase([], error));
        assert.equal(result.skipped, true);
        assert.equal(result.reason, "load_error");
    }
}

Promise.resolve()
    .then(testSeparatesTenants)
    .then(testSeparatesConversations)
    .then(testLoadErrorsAreSkipped)
    .then(() => console.log("calendar consolidation tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
