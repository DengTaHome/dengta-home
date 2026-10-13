const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const express = require("express");
const { createAuthContextMiddleware } = require("../services/auth-context");
const { createRequestScope } = require("../services/request-scope");
const { createV2CoreRouter } = require("../routes/v2/core");

const userAId = "11111111-1111-4111-8111-111111111111";
const companionAId = "22222222-2222-4222-8222-222222222222";
const userBId = "33333333-3333-4333-8333-333333333333";
const companionBId = "44444444-4444-4444-8444-444444444444";
const sessionAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const attachmentAId = "55555555-5555-4555-8555-555555555555";
const attachmentBId = "66666666-6666-4666-8666-666666666666";

const serverSource = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8"
);
const authMountIndex = serverSource.indexOf(
    "createAuthContextMiddleware({",
    serverSource.indexOf("app.use(")
);
const v2MountIndex = serverSource.indexOf(
    "createV2CoreRouter({"
);
assert.equal(authMountIndex >= 0, true);
assert.equal(v2MountIndex > authMountIndex, true);
assert.match(
    serverSource.slice(v2MountIndex, v2MountIndex + 300),
    /storage: supabase\.storage[\s\S]*?getSettings:[\s\S]*?resolveTurnModel/
);
assert.match(
    serverSource,
    /exposedHeaders:\s*\[[\s\S]*?"X-DengTa-Companion-Id"[\s\S]*?\]/
);
assert.match(
    serverSource,
    /status >= 400[\s\S]*?status < 500[\s\S]*?error\.code[\s\S]*?publicChatErrorCode\(error\) \|\| clientErrorCode/
);

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function selectedColumns(row, columns) {
    if (!columns || columns.trim() === "*") return clone(row);
    const result = {};
    for (const column of columns.split(",").map((item) => item.trim())) {
        if (column && Object.hasOwn(row, column)) {
            result[column] = clone(row[column]);
        }
    }
    return result;
}

function createMemorySupabase(seed) {
    const tables = clone(seed);
    const queryCounts = {};
    let sequence = 0;

    function from(tableName) {
        if (!Array.isArray(tables[tableName])) {
            throw new Error(`Unknown in-memory table: ${tableName}`);
        }
        const state = {
            operation: "",
            columns: "*",
            values: null,
            filters: [],
            orders: [],
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
                state.filters.push([column, value]);
                return builder;
            },
            order(column, { ascending = true } = {}) {
                state.orders.push([column, ascending]);
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
            return state.filters.every(
                ([column, value]) => row[column] === value
            );
        }

        function finish(rows) {
            const projected = rows.map((row) =>
                selectedColumns(row, state.columns)
            );
            if (state.cardinality === "single") {
                return {
                    data: projected[0] || null,
                    error:
                        projected.length === 1
                            ? null
                            : new Error("Expected one row")
                };
            }
            if (state.cardinality === "maybeSingle") {
                return {
                    data: projected[0] || null,
                    error:
                        projected.length <= 1
                            ? null
                            : new Error("Expected zero or one row")
                };
            }
            return { data: projected, error: null };
        }

        function execute() {
            queryCounts[tableName] = (queryCounts[tableName] || 0) + 1;
            let rows = tables[tableName].filter(matches);
            if (state.operation === "insert") {
                const now = "2026-07-26T08:00:00.000Z";
                const values = Array.isArray(state.values)
                    ? state.values
                    : [state.values];
                rows = values.map((value) => {
                    sequence += 1;
                    const row = {
                        id:
                            value.id ||
                            `90000000-0000-4000-8000-${String(
                                sequence
                            ).padStart(12, "0")}`,
                        created_at: value.created_at || now,
                        updated_at: value.updated_at || now,
                        ...clone(value)
                    };
                    tables[tableName].push(row);
                    return row;
                });
                return finish(rows);
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
                    const compared = String(left[column] ?? "").localeCompare(
                        String(right[column] ?? "")
                    );
                    return ascending ? compared : -compared;
                });
            }
            return finish(rows);
        }

        return builder;
    }

    return { from, tables, queryCounts };
}

function accountFixture(userId, companionId, email, role = "member") {
    const companion = {
        id: companionId,
        user_id: userId,
        name: role === "owner" ? "小灯" : "我的伴侣",
        is_default: true,
        status: "active",
        created_at: "2026-07-26T00:00:00.000Z",
        updated_at: "2026-07-26T00:00:00.000Z"
    };
    return {
        user: {
            id: userId,
            email,
            email_confirmed_at: "2026-07-26T00:00:00.000Z",
            user_metadata: {
                display_name: "private metadata",
                access_token: "must-not-leak"
            }
        },
        profile: {
            id: userId,
            email,
            display_name: role === "owner" ? "桃桃" : "朋友",
            role,
            status: "active",
            companion_limit: 1,
            storage_used_bytes: 0,
            storage_quota_bytes: 262144000
        },
        companions: [companion],
        companion
    };
}

function createErrorHandler() {
    return (error, req, res, next) => {
        void req;
        void next;
        res.status(error.status || 500).json({
            message: error.status ? error.message : "服务器处理请求失败。",
            ...(error.code ? { code: error.code } : {})
        });
    };
}

function createScopedApp(scopesByToken, storage, coreServices = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        const token = String(req.headers.authorization || "").replace(
            /^Bearer\s+/i,
            ""
        );
        if (scopesByToken[token]) {
            req.scope = scopesByToken[token];
            res.setHeader(
                "X-DengTa-Companion-Id",
                req.scope.companionId
            );
        }
        next();
    });
    app.use(
        "/api/v2",
        createV2CoreRouter({ storage, ...coreServices })
    );
    app.use(createErrorHandler());
    return app;
}

async function withServer(app, callback) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
        await callback(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

async function testStrictAuthenticationWhenGlobalAuthIsOptional() {
    const app = express();
    app.use(express.json());
    app.use(
        createAuthContextMiddleware({
            adminSupabase: {
                auth: {
                    async getUser() {
                        throw new Error("anonymous requests must not call auth");
                    }
                }
            },
            authRequired: false,
            initialOwnerEmail: ""
        })
    );
    app.post("/api/push/trigger", (req, res) => {
        res.status(401).json({ reason: "missing_push_secret" });
    });
    app.use("/api/v2", createV2CoreRouter());
    app.use(createErrorHandler());

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v2/account`);
        assert.equal(response.status, 401);
        assert.equal(
            (await response.json()).code,
            "authentication_required"
        );

        const internalTrigger = await fetch(
            `${baseUrl}/api/push/trigger`,
            { method: "POST" }
        );
        assert.equal(internalTrigger.status, 401);
        assert.equal(
            (await internalTrigger.json()).reason,
            "missing_push_secret",
            "internal push trigger must reach its own secret check before user auth"
        );
    });
}

async function testAuthMiddlewareBuildsOwnedScope() {
    const account = accountFixture(
        userAId,
        companionAId,
        "owner@example.test",
        "member"
    );
    const adminSupabase = createMemorySupabase({
        user_profiles: [account.profile],
        companions: account.companions,
        conversations: [],
        messages: []
    });
    adminSupabase.auth = {
        async getUser(token) {
            assert.equal(token, "valid-token");
            return { data: { user: account.user }, error: null };
        }
    };
    const app = express();
    app.use(express.json());
    app.use(
        createAuthContextMiddleware({
            adminSupabase,
            authRequired: false,
            initialOwnerEmail: ""
        })
    );
    app.use("/api/v2", createV2CoreRouter());
    app.use(createErrorHandler());

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/v2/account`, {
            headers: { Authorization: "Bearer valid-token" }
        });
        assert.equal(response.status, 200);
        assert.equal(
            response.headers.get("x-dengta-companion-id"),
            companionAId
        );
        assert.equal((await response.json()).active_companion.id, companionAId);
        assert.equal(
            adminSupabase.queryCounts.user_profiles,
            1,
            "existing accounts should not refetch the same profile"
        );
    });
}

async function testTenantScopedCoreRoutes() {
    const adminSupabase = createMemorySupabase({
        conversations: [
            {
                id: sessionAId,
                user_id: userAId,
                companion_id: companionAId,
                title: "A 的会话",
                model_id: "model-a",
                created_at: "2026-07-26T01:00:00.000Z",
                updated_at: "2026-07-26T03:00:00.000Z"
            },
            {
                id: sessionBId,
                user_id: userBId,
                companion_id: companionBId,
                title: "B 的会话",
                model_id: "model-b",
                created_at: "2026-07-26T02:00:00.000Z",
                updated_at: "2026-07-26T04:00:00.000Z"
            }
        ],
        messages: [
            {
                id: "1",
                user_id: userAId,
                companion_id: companionAId,
                conversation_id: sessionAId,
                role: "user",
                content: "A 的消息",
                created_at: "2026-07-26T01:01:00.000Z",
                visible: true,
                context_visible: false,
                tool_calls: {
                    attachments: [
                        {
                            id: attachmentAId,
                            name: "private-a.txt",
                            mime_type: "text/plain",
                            size: 9,
                            kind: "text",
                            storage_path: `${sessionAId}/${attachmentAId}.txt`
                        }
                    ]
                }
            },
            {
                id: "2",
                user_id: userAId,
                companion_id: companionAId,
                conversation_id: sessionAId,
                role: "assistant",
                content: "隐藏消息",
                created_at: "2026-07-26T01:02:00.000Z",
                visible: false,
                tool_calls: {}
            },
            {
                id: "3",
                user_id: userBId,
                companion_id: companionBId,
                conversation_id: sessionBId,
                role: "assistant",
                content: "B 的消息",
                created_at: "2026-07-26T02:01:00.000Z",
                visible: true,
                tool_calls: {
                    attachments: [
                        {
                            id: attachmentBId,
                            name: "private-b.txt",
                            mime_type: "text/plain",
                            size: 9,
                            kind: "text",
                            storage_path: `${sessionBId}/${attachmentBId}.txt`
                        }
                    ]
                }
            }
        ]
    });
    const accountA = accountFixture(
        userAId,
        companionAId,
        "owner@example.test",
        "owner"
    );
    const accountB = accountFixture(
        userBId,
        companionBId,
        "friend@example.test"
    );
    const scopeA = createRequestScope({ adminSupabase, ...accountA });
    const scopeB = createRequestScope({ adminSupabase, ...accountB });
    const storageCalls = { downloads: [], removals: [] };
    const storage = {
        from(bucket) {
            assert.equal(bucket, "chat-attachments");
            return {
                async download(storagePath) {
                    storageCalls.downloads.push(storagePath);
                    return {
                        data: new Blob([storagePath]),
                        error: null
                    };
                },
                async remove(storagePaths) {
                    storageCalls.removals.push(storagePaths);
                    return { error: null };
                }
            };
        }
    };
    const app = createScopedApp(
        {
            "token-a": scopeA,
            "token-b": scopeB
        },
        storage
    );

    await withServer(app, async (baseUrl) => {
        const accountResponse = await fetch(
            `${baseUrl}/api/v2/account`,
            { headers: { Authorization: "Bearer token-a" } }
        );
        assert.equal(accountResponse.status, 200);
        assert.equal(
            accountResponse.headers.get("x-dengta-companion-id"),
            companionAId
        );
        assert.equal(
            accountResponse.headers.get("cache-control"),
            "private, no-store"
        );
        const accountBody = await accountResponse.json();
        assert.equal(accountBody.user.id, userAId);
        assert.equal(accountBody.user.email_verified, true);
        assert.equal(accountBody.active_companion.id, companionAId);
        assert.equal(accountBody.profile.display_name, "桃桃");
        assert.doesNotMatch(
            JSON.stringify(accountBody),
            /access_token|user_metadata|must-not-leak|\"db\"/
        );

        const sessionsAResponse = await fetch(
            `${baseUrl}/api/v2/sessions`,
            { headers: { Authorization: "Bearer token-a" } }
        );
        assert.equal(sessionsAResponse.status, 200);
        assert.deepEqual(
            (await sessionsAResponse.json()).sessions.map(({ id }) => id),
            [sessionAId]
        );
        const sessionsA = await (
            await fetch(`${baseUrl}/api/v2/sessions`, {
                headers: { Authorization: "Bearer token-a" }
            })
        ).json();
        assert.equal(sessionsA.sessions[0].model_id, "model-a");

        const sessionsBResponse = await fetch(
            `${baseUrl}/api/v2/sessions`,
            { headers: { Authorization: "Bearer token-b" } }
        );
        assert.equal(sessionsBResponse.status, 200);
        assert.deepEqual(
            (await sessionsBResponse.json()).sessions.map(({ id }) => id),
            [sessionBId]
        );

        const createResponse = await fetch(
            `${baseUrl}/api/v2/sessions`,
            {
                method: "POST",
                headers: {
                    Authorization: "Bearer token-a",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    title: "新会话",
                    model_id: "model-new",
                    user_id: userBId,
                    companion_id: companionBId
                })
            }
        );
        assert.equal(createResponse.status, 201);
        const created = (await createResponse.json()).session;
        assert.equal(created.title, "新会话");
        assert.equal(created.model_id, "model-new");
        const stored = adminSupabase.tables.conversations.find(
            (item) => item.id === created.id
        );
        assert.equal(stored.user_id, userAId);
        assert.equal(stored.companion_id, companionAId);
        assert.equal(stored.model_id, "model-new");

        const updateModelResponse = await fetch(
            `${baseUrl}/api/v2/sessions/${sessionAId}`,
            {
                method: "PATCH",
                headers: {
                    Authorization: "Bearer token-a",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model_id: "model-switched",
                    user_id: userBId,
                    companion_id: companionBId
                })
            }
        );
        assert.equal(updateModelResponse.status, 200);
        assert.equal(
            (await updateModelResponse.json()).session.model_id,
            "model-switched"
        );
        const updatedStoredSession = adminSupabase.tables.conversations.find(
            (item) => item.id === sessionAId
        );
        assert.equal(updatedStoredSession.user_id, userAId);
        assert.equal(updatedStoredSession.companion_id, companionAId);
        assert.equal(updatedStoredSession.model_id, "model-switched");

        const foreignUpdateResponse = await fetch(
            `${baseUrl}/api/v2/sessions/${sessionBId}`,
            {
                method: "PATCH",
                headers: {
                    Authorization: "Bearer token-a",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ model_id: "not-allowed" })
            }
        );
        assert.equal(foreignUpdateResponse.status, 404);
        assert.equal(
            (await foreignUpdateResponse.json()).code,
            "session_not_found"
        );

        const ownMessagesResponse = await fetch(
            `${baseUrl}/api/v2/sessions/${sessionAId}/messages`,
            { headers: { Authorization: "Bearer token-a" } }
        );
        assert.equal(ownMessagesResponse.status, 200);
        const ownMessages = (await ownMessagesResponse.json()).messages;
        assert.deepEqual(
            ownMessages.map(({ id, content }) => [id, content]),
            [["1", "A 的消息"]]
        );
        assert.equal(
            ownMessages[0].attachments[0].url,
            `/api/v2/attachments/1/${attachmentAId}`
        );

        const ownAttachmentResponse = await fetch(
            `${baseUrl}/api/v2/attachments/1/${attachmentAId}`,
            { headers: { Authorization: "Bearer token-a" } }
        );
        assert.equal(ownAttachmentResponse.status, 200);
        assert.equal(
            await ownAttachmentResponse.text(),
            `${sessionAId}/${attachmentAId}.txt`
        );

        const foreignAttachmentResponse = await fetch(
            `${baseUrl}/api/v2/attachments/3/${attachmentBId}`,
            { headers: { Authorization: "Bearer token-a" } }
        );
        assert.equal(foreignAttachmentResponse.status, 404);
        assert.equal(
            (await foreignAttachmentResponse.json()).code,
            "attachment_not_found"
        );

        const foreignMessagesResponse = await fetch(
            `${baseUrl}/api/v2/sessions/${sessionBId}/messages`,
            { headers: { Authorization: "Bearer token-a" } }
        );
        assert.equal(foreignMessagesResponse.status, 404);
        assert.equal(
            (await foreignMessagesResponse.json()).code,
            "session_not_found"
        );

        const invalidIdResponse = await fetch(
            `${baseUrl}/api/v2/sessions/not-a-uuid/messages`,
            { headers: { Authorization: "Bearer token-a" } }
        );
        assert.equal(invalidIdResponse.status, 400);
        assert.equal(
            (await invalidIdResponse.json()).code,
            "invalid_session_id"
        );

        const foreignDeleteResponse = await fetch(
            `${baseUrl}/api/v2/sessions/${sessionBId}`,
            {
                method: "DELETE",
                headers: { Authorization: "Bearer token-a" }
            }
        );
        assert.equal(foreignDeleteResponse.status, 404);

        const ownDeleteResponse = await fetch(
            `${baseUrl}/api/v2/sessions/${sessionAId}`,
            {
                method: "DELETE",
                headers: { Authorization: "Bearer token-a" }
            }
        );
        assert.equal(ownDeleteResponse.status, 204);
        assert.equal(
            adminSupabase.tables.conversations.some(
                (item) => item.id === sessionAId
            ),
            false
        );
        assert.equal(
            adminSupabase.tables.conversations.some(
                (item) => item.id === sessionBId
            ),
            true
        );
        assert.deepEqual(storageCalls.removals, [
            [`${sessionAId}/${attachmentAId}.txt`]
        ]);
    });
}

async function testTenantSessionModelResolution() {
    const account = accountFixture(
        userAId,
        companionAId,
        "owner@example.test",
        "owner"
    );
    const adminSupabase = createMemorySupabase({
        conversations: [
            {
                id: sessionAId,
                user_id: userAId,
                companion_id: companionAId,
                title: "Existing",
                model_id: "model-current",
                created_at: "2026-07-26T01:00:00.000Z",
                updated_at: "2026-07-26T01:00:00.000Z"
            }
        ],
        messages: []
    });
    const scope = createRequestScope({ adminSupabase, ...account });
    const calls = [];
    const app = createScopedApp(
        { "token-a": scope },
        undefined,
        {
            async getSettings(database) {
                calls.push(["settings", database]);
                return { model: "model-default" };
            },
            async resolveTurnModel(settings, requestedModel) {
                calls.push(["resolve", settings.model, requestedModel]);
                if (requestedModel === "model-rejected") {
                    throw requestErrorForTest(
                        400,
                        "MODEL_NOT_AVAILABLE",
                        "model unavailable"
                    );
                }
                return requestedModel;
            }
        }
    );

    await withServer(app, async (baseUrl) => {
        const defaultResponse = await fetch(`${baseUrl}/api/v2/sessions`, {
            method: "POST",
            headers: {
                Authorization: "Bearer token-a",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ title: "Default model" })
        });
        assert.equal(defaultResponse.status, 201);
        assert.equal(
            (await defaultResponse.json()).session.model_id,
            "model-default"
        );

        const rejectedResponse = await fetch(
            `${baseUrl}/api/v2/sessions/${sessionAId}`,
            {
                method: "PATCH",
                headers: {
                    Authorization: "Bearer token-a",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ model_id: "model-rejected" })
            }
        );
        assert.equal(rejectedResponse.status, 400);
        assert.equal(
            (await rejectedResponse.json()).code,
            "MODEL_NOT_AVAILABLE"
        );
        assert.equal(
            adminSupabase.tables.conversations.find(
                (item) => item.id === sessionAId
            ).model_id,
            "model-current"
        );
    });

    assert.equal(calls.filter(([kind]) => kind === "resolve").length, 2);
    assert.equal(calls[0][1], scope.db);
    assert.deepEqual(calls[1], [
        "resolve",
        "model-default",
        "model-default"
    ]);
}

function requestErrorForTest(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}

async function main() {
    await testStrictAuthenticationWhenGlobalAuthIsOptional();
    await testAuthMiddlewareBuildsOwnedScope();
    await testTenantScopedCoreRoutes();
    await testTenantSessionModelResolution();
    console.log("strict v2 account, session and message route tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
