const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createNurseryRouter } = require("../routes/nursery");
const { createRequestScope } = require("../services/request-scope");
const {
    handleNurseryEvent,
    scheduleNextNurseryEvent
} = require("../services/nursery-events");
const {
    applyNurseryAction,
    nameNurseryChild
} = require("../services/nursery");

const userAId = "11111111-1111-4111-8111-111111111111";
const companionAId = "22222222-2222-4222-8222-222222222222";
const userBId = "33333333-3333-4333-8333-333333333333";
const companionBId = "44444444-4444-4444-8444-444444444444";
const nowIso = "2026-08-02T04:00:00.000Z";

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function selectedColumns(row, columns) {
    if (!columns || columns.trim() === "*") return clone(row);
    const output = {};
    for (const column of columns.split(",").map((item) => item.trim())) {
        if (column && Object.hasOwn(row, column)) {
            output[column] = clone(row[column]);
        }
    }
    return output;
}

function tableDefaults(tableName) {
    const defaults = {
        nursery_children: {
            name: null,
            paused_at: null,
            total_paused_seconds: 0,
            celebrated_stage: null,
            runaway_at: null,
            ending: null,
            appearance: ""
        },
        nursery_child_state: {
            mood: 70,
            health: 85,
            intimacy: 20,
            nutrition: 65,
            fatigue: 20,
            darkness: 0,
            digest_load: 0,
            last_fed_at: null,
            last_interaction_at: null
        },
        nursery_caregiver_bonds: {
            attachment: 20,
            trust: 20,
            predictability: 20,
            resentment: 0
        },
        nursery_utterances: {
            accepted: true,
            rejection_reason: null
        },
        messages: {
            visible: true,
            tool_calls: {}
        }
    };
    return clone(defaults[tableName] || {});
}

function duplicateRow(tableName, rows, candidate) {
    const same = (row, fields) =>
        fields.every((field) => row[field] === candidate[field]);
    if (candidate.id !== undefined && rows.some((row) => row.id === candidate.id)) {
        return true;
    }
    const uniqueFields = {
        nursery_child_state: ["user_id", "companion_id", "child_id"],
        nursery_caregiver_bonds: [
            "user_id",
            "companion_id",
            "child_id",
            "caregiver_kind"
        ],
        nursery_actions: [
            "user_id",
            "companion_id",
            "child_id",
            "idempotency_key"
        ],
        nursery_corpus: [
            "user_id",
            "companion_id",
            "child_id",
            "content_sha256"
        ],
        nursery_milestones: [
            "user_id",
            "companion_id",
            "child_id",
            "dedupe_key"
        ]
    }[tableName];
    if (uniqueFields && rows.some((row) => same(row, uniqueFields))) {
        return true;
    }
    return (
        tableName === "nursery_children" &&
        ["active", "runaway"].includes(candidate.status) &&
        rows.some(
            (row) =>
                row.user_id === candidate.user_id &&
                row.companion_id === candidate.companion_id &&
                ["active", "runaway"].includes(row.status)
        )
    );
}

function createMemorySupabase(seed = {}) {
    const tableNames = [
        "nursery_children",
        "nursery_child_state",
        "nursery_actions",
        "nursery_corpus",
        "nursery_utterances",
        "nursery_events",
        "nursery_milestones",
        "nursery_caregiver_bonds",
        "background_jobs",
        "conversations",
        "messages"
    ];
    const tables = Object.fromEntries(
        tableNames.map((name) => [name, clone(seed[name] || [])])
    );
    let sequence = 100;

    function from(tableName) {
        if (!tables[tableName]) throw new Error(`Unknown table ${tableName}`);
        const state = {
            operation: "",
            columns: "*",
            values: null,
            filters: [],
            orders: [],
            limit: null,
            cardinality: "many"
        };
        const builder = {
            select(columns = "*") {
                if (!state.operation) state.operation = "select";
                state.columns = columns;
                return builder;
            },
            insert(values) {
                state.operation = "insert";
                state.values = values;
                return builder;
            },
            update(values) {
                state.operation = "update";
                state.values = values;
                return builder;
            },
            delete() {
                state.operation = "delete";
                return builder;
            },
            eq(column, value) {
                state.filters.push({ kind: "eq", column, value });
                return builder;
            },
            is(column, value) {
                state.filters.push({ kind: "is", column, value });
                return builder;
            },
            in(column, values) {
                state.filters.push({ kind: "in", column, values: [...values] });
                return builder;
            },
            gte(column, value) {
                state.filters.push({ kind: "gte", column, value });
                return builder;
            },
            contains(column, value) {
                state.filters.push({ kind: "contains", column, value });
                return builder;
            },
            order(column, { ascending = true } = {}) {
                state.orders.push([column, ascending]);
                return builder;
            },
            limit(value) {
                state.limit = Number(value);
                return builder;
            },
            single() {
                state.cardinality = "single";
                return builder;
            },
            maybeSingle() {
                state.cardinality = "maybeSingle";
                return builder;
            },
            then(resolve, reject) {
                return Promise.resolve(execute()).then(resolve, reject);
            }
        };

        function matches(row) {
            return state.filters.every((filter) => {
                if (filter.kind === "in") {
                    return filter.values.includes(row[filter.column]);
                }
                if (filter.kind === "gte") {
                    return Date.parse(row[filter.column]) >= Date.parse(filter.value);
                }
                if (filter.kind === "contains") {
                    const source = row[filter.column];
                    return (
                        source &&
                        typeof source === "object" &&
                        Object.entries(filter.value).every(
                            ([key, value]) => source[key] === value
                        )
                    );
                }
                if (filter.kind === "is") {
                    return row[filter.column] === filter.value;
                }
                return row[filter.column] === filter.value;
            });
        }

        function finish(rows) {
            const projected = rows.map((row) =>
                selectedColumns(row, state.columns)
            );
            if (state.cardinality === "single") {
                return projected.length === 1
                    ? { data: projected[0], error: null }
                    : {
                          data: null,
                          error: Object.assign(new Error("Expected one row"), {
                              code: "PGRST116"
                          })
                      };
            }
            if (state.cardinality === "maybeSingle") {
                return projected.length <= 1
                    ? { data: projected[0] || null, error: null }
                    : {
                          data: null,
                          error: Object.assign(
                              new Error("Expected zero or one row"),
                              { code: "PGRST116" }
                          )
                      };
            }
            return { data: projected, error: null };
        }

        function execute() {
            let rows = tables[tableName].filter(matches);
            if (state.operation === "insert") {
                const values = Array.isArray(state.values)
                    ? state.values
                    : [state.values];
                const inserted = [];
                for (const value of values) {
                    sequence += 1;
                    const row = {
                        ...tableDefaults(tableName),
                        id: value.id ?? sequence,
                        created_at: value.created_at || nowIso,
                        updated_at: value.updated_at || nowIso,
                        ...clone(value)
                    };
                    if (duplicateRow(tableName, tables[tableName], row)) {
                        return {
                            data: null,
                            error: Object.assign(new Error("duplicate"), {
                                code: "23505"
                            })
                        };
                    }
                    tables[tableName].push(row);
                    inserted.push(row);
                }
                return finish(inserted);
            }
            if (state.operation === "update") {
                for (const row of rows) Object.assign(row, clone(state.values));
                return finish(rows);
            }
            if (state.operation === "delete") {
                tables[tableName] = tables[tableName].filter(
                    (row) => !matches(row)
                );
                return finish(rows);
            }
            for (const [column, ascending] of [...state.orders].reverse()) {
                rows.sort((left, right) => {
                    const result = String(left[column] ?? "").localeCompare(
                        String(right[column] ?? "")
                    );
                    return ascending ? result : -result;
                });
            }
            if (Number.isInteger(state.limit)) rows = rows.slice(0, state.limit);
            return finish(rows);
        }

        return builder;
    }

    return { from, tables };
}

function scopeFixture(adminSupabase, userId, companionId, name) {
    const companion = {
        id: companionId,
        user_id: userId,
        name,
        is_default: true,
        status: "active"
    };
    return createRequestScope({
        adminSupabase,
        user: {
            id: userId,
            email: `${name}@example.test`,
            email_confirmed_at: nowIso
        },
        profile: {
            id: userId,
            role: "owner",
            status: "active"
        },
        companions: [companion],
        companion
    });
}

function createApp(scopes) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.scope = scopes[req.headers.authorization];
        next();
    });
    app.use(
        "/api/v2/nursery",
        createNurseryRouter({ now: () => new Date(nowIso) })
    );
    app.use((error, req, res, next) => {
        void req;
        void next;
        res.status(error.status || 500).json({
            code: error.code || "server_error",
            message: error.status ? error.message : "服务器处理失败。"
        });
    });
    return app;
}

async function withServer(app, callback) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await callback(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

async function jsonRequest(baseUrl, path, token, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            Authorization: token,
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
    return { response, data: await response.json().catch(() => ({})) };
}

async function main() {
    const admin = createMemorySupabase({
        conversations: [
            {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                user_id: userAId,
                companion_id: companionAId,
                title: "A 的家",
                created_at: nowIso,
                updated_at: nowIso
            },
            {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                user_id: userBId,
                companion_id: companionBId,
                title: "B 的家",
                created_at: nowIso,
                updated_at: nowIso
            }
        ],
        messages: [
            {
                id: 1,
                user_id: userAId,
                companion_id: companionAId,
                role: "assistant",
                content: "我们慢慢来，今天也一起看窗外的云。",
                visible: true,
                context_visible: true,
                created_at: "2026-08-02T03:59:00.000Z"
            },
            {
                id: 2,
                user_id: userBId,
                companion_id: companionBId,
                role: "assistant",
                content: "B 租户的私密消息",
                visible: true,
                context_visible: true,
                created_at: "2026-08-02T03:59:30.000Z"
            }
        ]
    });
    const scopeA = scopeFixture(admin, userAId, companionAId, "a");
    const scopeB = scopeFixture(admin, userBId, companionBId, "b");
    const app = createApp({ "token-a": scopeA, "token-b": scopeB });

    await withServer(app, async (baseUrl) => {
        let result = await jsonRequest(
            baseUrl,
            "/api/v2/nursery",
            "token-a"
        );
        assert.equal(result.response.status, 200);
        assert.equal(result.data.child, null);

        result = await jsonRequest(
            baseUrl,
            "/api/v2/nursery/children",
            "token-a",
            {
                method: "POST",
                body: JSON.stringify({
                    client_action_id: "birth-action-0001",
                    user_id: userBId,
                    companion_id: companionBId
                })
            }
        );
        assert.equal(result.response.status, 201);
        assert.equal(result.data.child.name, null);
        assert.equal(result.data.child.stage.id, "infant");
        assert.equal(result.data.provider_calls, 0);
        const childId = result.data.child.id;
        assert.equal(result.data.next_event.status, "pending");
        assert.equal(admin.tables.nursery_events.length, 1);
        assert.equal(admin.tables.background_jobs.length, 1);
        assert.equal(admin.tables.background_jobs[0].job_type, "nursery_event");

        const birthJob = admin.tables.background_jobs.shift();
        const repairedSchedule = await scheduleNextNurseryEvent({
            database: scopeA.db,
            childId,
            sourceKey: "birth",
            now: () => new Date(nowIso)
        });
        assert.equal(repairedSchedule.reason, "already_scheduled");
        assert.equal(admin.tables.background_jobs.length, 1);
        assert.equal(admin.tables.background_jobs[0].id, birthJob.id);

        const storedChild = admin.tables.nursery_children[0];
        assert.equal(storedChild.user_id, userAId);
        assert.equal(storedChild.companion_id, companionAId);

        const repeatedBirth = await jsonRequest(
            baseUrl,
            "/api/v2/nursery/children",
            "token-a",
            {
                method: "POST",
                body: JSON.stringify({ client_action_id: "birth-action-0001" })
            }
        );
        assert.equal(repeatedBirth.response.status, 200);
        assert.equal(admin.tables.nursery_children.length, 1);
        assert.equal(admin.tables.nursery_events.length, 1);
        assert.equal(admin.tables.background_jobs.length, 1);

        const foreign = await jsonRequest(
            baseUrl,
            `/api/v2/nursery/children/${childId}/actions`,
            "token-b",
            {
                method: "POST",
                body: JSON.stringify({
                    action: "talk",
                    text: "不应该写入",
                    client_action_id: "foreign-action-0001"
                })
            }
        );
        assert.equal(foreign.response.status, 404);

        result = await jsonRequest(
            baseUrl,
            `/api/v2/nursery/children/${childId}/actions`,
            "token-a",
            {
                method: "POST",
                body: JSON.stringify({
                    action: "talk",
                    actor: "companion",
                    text: "你好呀，欢迎来到我们的小家。",
                    client_action_id: "talk-action-0001"
                })
            }
        );
        assert.equal(result.response.status, 200);
        assert.equal(result.data.action.actor, "user");
        assert.ok(result.data.child_utterance.text);
        assert.equal(admin.tables.nursery_corpus[0].speaker, "user");
        const stateVersion = result.data.child.state_version;

        const concurrentActions = await Promise.all([
            applyNurseryAction({
                database: scopeA.db,
                childId,
                actor: "user",
                action: "play",
                clientActionId: "concurrent-action-0001",
                now: () => new Date(nowIso)
            }),
            applyNurseryAction({
                database: scopeA.db,
                childId,
                actor: "companion",
                action: "soothe",
                clientActionId: "concurrent-action-0002",
                now: () => new Date(nowIso)
            })
        ]);
        assert.equal(concurrentActions.length, 2);
        assert.equal(
            admin.tables.nursery_children[0].state_version,
            stateVersion + 2
        );

        const repeatedAction = await jsonRequest(
            baseUrl,
            `/api/v2/nursery/children/${childId}/actions`,
            "token-a",
            {
                method: "POST",
                body: JSON.stringify({
                    action: "talk",
                    text: "你好呀，欢迎来到我们的小家。",
                    client_action_id: "talk-action-0001"
                })
            }
        );
        assert.equal(repeatedAction.data.idempotent, true);
        assert.equal(
            repeatedAction.data.child.state_version,
            stateVersion + 2
        );

        result = await jsonRequest(
            baseUrl,
            `/api/v2/nursery/children/${childId}/companion-actions`,
            "token-a",
            {
                method: "POST",
                body: JSON.stringify({ client_action_id: "companion-action-0001" })
            }
        );
        assert.equal(result.response.status, 200);
        assert.equal(result.data.action.actor, "companion");
        assert.ok(
            admin.tables.nursery_corpus.some(
                (item) =>
                    item.speaker === "companion" &&
                    item.text.includes("窗外的云")
            )
        );
        assert.ok(
            admin.tables.nursery_corpus.every(
                (item) => !item.text.includes("B 租户")
            )
        );

        const naming = await Promise.allSettled([
            nameNurseryChild({
                database: scopeA.db,
                childId,
                candidates: ["星星", "云云"],
                clientActionId: "name-action-0001",
                now: () => new Date(nowIso)
            }),
            nameNurseryChild({
                database: scopeA.db,
                childId,
                candidates: "月月",
                clientActionId: "name-action-0002",
                now: () => new Date(nowIso)
            })
        ]);
        assert.equal(naming.filter((item) => item.status === "fulfilled").length, 1);
        assert.equal(naming.filter((item) => item.status === "rejected").length, 1);
        assert.ok(["星星", "云云"].includes(admin.tables.nursery_children[0].name));

        const rename = await jsonRequest(
            baseUrl,
            `/api/v2/nursery/children/${childId}/name`,
            "token-a",
            {
                method: "POST",
                body: JSON.stringify({
                    name: "另一个名字",
                    client_action_id: "name-action-0003"
                })
            }
        );
        assert.equal(rename.response.status, 409);

        const snapshot = await jsonRequest(
            baseUrl,
            "/api/v2/nursery",
            "token-a"
        );
        assert.equal(snapshot.data.provider_calls, 0);
        assert.equal(snapshot.data.embedding_calls, 0);
        assert.equal(snapshot.data.portrait, null);
        assert.ok(snapshot.data.milestones.length >= 3);

        const portrait = await jsonRequest(
            baseUrl,
            `/api/v2/nursery/children/${childId}/portrait`,
            "token-a"
        );
        assert.equal(portrait.response.status, 200);
        assert.equal(portrait.data.portrait.provider_calls, 0);
        assert.equal(portrait.data.portrait.embedding_calls, 0);

        const firstJob = clone(admin.tables.background_jobs[0]);
        const firstEvent = admin.tables.nursery_events.find(
            (event) => event.id === firstJob.payload.event_id
        );
        const eventNow = new Date(Date.parse(firstEvent.due_at) + 60 * 1000);
        let leaseChecks = 0;
        const saveMessage = async (
            conversationId,
            role,
            content,
            options = {}
        ) => {
            const saved = await options.database
                .from("messages")
                .insert({
                    conversation_id: conversationId,
                    role,
                    content,
                    visible: true,
                    tool_calls: options.tool_calls || {}
                })
                .select("id, conversation_id, content, created_at, tool_calls")
                .single();
            if (saved.error) throw saved.error;
            return saved.data;
        };
        const touchConversation = async (conversationId, database) => {
            const touched = await database
                .from("conversations")
                .update({ updated_at: eventNow.toISOString() })
                .eq("id", conversationId);
            if (touched.error) throw touched.error;
        };
        const eventResult = await handleNurseryEvent({
            job: firstJob,
            database: scopeA.db,
            lease: {
                async assertOwned() {
                    leaseChecks += 1;
                }
            },
            saveMessage,
            touchConversation,
            now: () => eventNow
        });
        assert.equal(eventResult.status, "fired");
        assert.ok(eventResult.messageId);
        assert.ok(leaseChecks >= 3);
        assert.equal(firstEvent.status, "fired");
        const eventMessages = admin.tables.messages.filter(
            (message) => message.tool_calls?.is_nursery_event === true
        );
        assert.equal(eventMessages.length, 1);
        assert.equal(eventMessages[0].user_id, userAId);
        assert.equal(eventMessages[0].companion_id, companionAId);
        assert.equal(eventMessages[0].tool_calls.response_mode, "local_nursery_event");
        const stateVersionAfterEvent = admin.tables.nursery_children[0].state_version;

        const replayedEvent = await handleNurseryEvent({
            job: firstJob,
            database: scopeA.db,
            lease: { async assertOwned() {} },
            saveMessage,
            touchConversation,
            now: () => eventNow
        });
        assert.equal(replayedEvent.status, "fired");
        assert.equal(
            admin.tables.messages.filter(
                (message) => message.tool_calls?.is_nursery_event === true
            ).length,
            1
        );
        assert.equal(
            admin.tables.nursery_children[0].state_version,
            stateVersionAfterEvent
        );
        assert.equal(
            admin.tables.background_jobs.filter(
                (job) => job.job_type === "nursery_event"
            ).length,
            2
        );

        const nextJob = clone(admin.tables.background_jobs[1]);
        const nextEvent = admin.tables.nursery_events.find(
            (event) => event.id === nextJob.payload.event_id
        );
        nextEvent.status = "expired";
        const recoveredExpired = await handleNurseryEvent({
            job: nextJob,
            database: scopeA.db,
            lease: { async assertOwned() {} },
            saveMessage,
            touchConversation,
            now: () => eventNow
        });
        assert.equal(recoveredExpired.status, "expired");
        assert.equal(
            admin.tables.background_jobs.filter(
                (job) => job.job_type === "nursery_event"
            ).length,
            3
        );

        const tenantB = await jsonRequest(
            baseUrl,
            "/api/v2/nursery",
            "token-b"
        );
        assert.equal(tenantB.data.child, null);
    });
}

main()
    .then(() => console.log("tenant nursery API and persistence tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
