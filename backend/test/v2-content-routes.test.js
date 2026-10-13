const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createAiProvidersRouter } = require("../routes/ai-providers");
const {
    createMcpConnectionsRouter
} = require("../routes/mcp-connections");
const { createV2ContentRouter } = require("../routes/v2/content");
const {
    createAiProviderCenter
} = require("../services/ai-provider-center");
const {
    createMcpDeviceCenter
} = require("../services/mcp-device-center");
const { createRequestScope } = require("../services/request-scope");
const {
    publicStoredSettings,
    updateStoredSettings
} = require("../services/settings-store");

const userAId = "11111111-1111-4111-8111-111111111111";
const companionAId = "22222222-2222-4222-8222-222222222222";
const userBId = "33333333-3333-4333-8333-333333333333";
const companionBId = "44444444-4444-4444-8444-444444444444";
const sessionAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const momentAUserId = "a1000000-0000-4000-8000-000000000001";
const momentAAiId = "a1000000-0000-4000-8000-000000000002";
const momentBAiId = "b1000000-0000-4000-8000-000000000001";
const profileAId = "c1000000-0000-4000-8000-000000000001";
const profileBId = "c1000000-0000-4000-8000-000000000002";
const profileProposalAId =
    "d1000000-0000-4000-8000-000000000001";

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
            limit: null,
            range: null,
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
                state.filters.push({
                    kind: "eq",
                    column,
                    value
                });
                return builder;
            },
            contains(column, value) {
                state.filters.push({
                    kind: "contains",
                    column,
                    value
                });
                return builder;
            },
            gte(column, value) {
                state.filters.push({
                    kind: "gte",
                    column,
                    value
                });
                return builder;
            },
            in(column, values) {
                state.filters.push({
                    kind: "in",
                    column,
                    values: [...values]
                });
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
            range(start, end) {
                state.range = [Number(start), Number(end)];
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
                if (filter.kind === "gte") {
                    return (
                        new Date(row[filter.column]).getTime() >=
                        new Date(filter.value).getTime()
                    );
                }
                return row[filter.column] === filter.value;
            });
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
                            : Object.assign(
                                  new Error("Expected one row"),
                                  { code: "PGRST116" }
                              )
                };
            }
            if (state.cardinality === "maybeSingle") {
                return {
                    data: projected[0] || null,
                    error:
                        projected.length <= 1
                            ? null
                            : Object.assign(
                                  new Error("Expected zero or one row"),
                                  { code: "PGRST116" }
                              )
                };
            }
            return { data: projected, error: null };
        }

        function generatedId() {
            sequence += 1;
            return `90000000-0000-4000-8000-${String(
                sequence
            ).padStart(12, "0")}`;
        }

        function execute() {
            let rows = tables[tableName].filter(matches);
            if (state.operation === "insert") {
                const timestamp = "2026-07-26T12:00:00.000Z";
                const values = Array.isArray(state.values)
                    ? state.values
                    : [state.values];
                rows = values.map((value) => {
                    const row = {
                        id: value.id || generatedId(),
                        created_at: value.created_at || timestamp,
                        updated_at: value.updated_at || timestamp,
                        ...clone(value)
                    };
                    tables[tableName].push(row);
                    return row;
                });
                return finish(rows);
            }
            if (state.operation === "update") {
                for (const row of rows) {
                    Object.assign(row, clone(state.values));
                }
                return finish(rows);
            }
            if (state.operation === "delete") {
                tables[tableName] = tables[tableName].filter(
                    (row) => !matches(row)
                );
                return finish(rows);
            }
            for (const [column, ascending] of [
                ...state.orders
            ].reverse()) {
                rows.sort((left, right) => {
                    const compared = String(
                        left[column] ?? ""
                    ).localeCompare(String(right[column] ?? ""));
                    return ascending ? compared : -compared;
                });
            }
            if (Number.isInteger(state.limit) && state.limit >= 0) {
                rows = rows.slice(0, state.limit);
            }
            if (
                Array.isArray(state.range) &&
                state.range.every(Number.isInteger)
            ) {
                rows = rows.slice(
                    state.range[0],
                    state.range[1] + 1
                );
            }
            return finish(rows);
        }

        return builder;
    }

    return { from, tables };
}

function createMemoryStorage(seed = {}) {
    const objects = new Map(
        Object.entries(seed).map(([key, value]) => [
            key,
            Buffer.from(value)
        ])
    );
    return {
        objects,
        from(bucket) {
            return {
                async upload(storagePath, bytes) {
                    const key = `${bucket}/${storagePath}`;
                    if (objects.has(key)) {
                        return {
                            data: null,
                            error: new Error("object already exists")
                        };
                    }
                    objects.set(key, Buffer.from(bytes));
                    return { data: { path: storagePath }, error: null };
                },
                async remove(paths) {
                    for (const storagePath of paths || []) {
                        objects.delete(`${bucket}/${storagePath}`);
                    }
                    return { data: [], error: null };
                },
                async download(storagePath) {
                    const value = objects.get(
                        `${bucket}/${storagePath}`
                    );
                    return value
                        ? { data: Buffer.from(value), error: null }
                        : {
                              data: null,
                              error: new Error("object not found")
                          };
                }
            };
        }
    };
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
            email_confirmed_at: "2026-07-26T00:00:00.000Z"
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

function settingsRow(id, userId, companionId, aiName) {
    return {
        id,
        user_id: userId,
        companion_id: companionId,
        ai_name: aiName,
        system_prompt: `${aiName} 的系统提示词`,
        additional_prompt: "",
        personality: "自然",
        prompt_mode: "unified",
        unified_system_prompt: `${aiName} 的统一提示词`,
        intimate_expression_enabled: false,
        provider: "custom",
        api_url: "",
        model: "test-model",
        reasoning_effort: "",
        temperature: 0.7,
        context_turns: 20,
        max_tokens: 2048,
        compression_threshold: 12000,
        compression_keep: 20,
        timezone: "Asia/Shanghai",
        push_enabled: false,
        max_push_per_day: 7,
        created_at: "2026-07-26T00:00:00.000Z",
        updated_at: "2026-07-26T00:00:00.000Z"
    };
}

function createErrorHandler() {
    return (error, req, res, next) => {
        void req;
        void next;
        res.status(error.status || 500).json({
            message: error.status
                ? error.message
                : "服务器处理请求失败。",
            ...(error.code ? { code: error.code } : {})
        });
    };
}

function createApp(
    scopesByToken,
    storage,
    { mcpCenter, providerCenter }
) {
    const app = express();
    app.use(express.json({ limit: "30mb" }));
    app.use((req, res, next) => {
        const token = String(
            req.headers.authorization || ""
        ).replace(/^Bearer\s+/i, "");
        if (scopesByToken[token]) req.scope = scopesByToken[token];
        next();
    });
    app.use(
        "/api/v2",
        createV2ContentRouter({
            storage,
            readSettings: (scope) =>
                publicStoredSettings(scope.db, {
                    NODE_ENV: "test"
                }),
            saveSettings: async (scope, body) =>
                updateStoredSettings(scope.db, body, {
                    NODE_ENV: "test"
                }),
            now: () => Date.parse("2026-07-26T12:00:00.000Z"),
            random: () => 0,
            installationTokenFactory: () =>
                "local-installation-token-0000000000000001"
        })
    );
    app.use(
        "/api/mcp/connections",
        createMcpConnectionsRouter({ center: mcpCenter })
    );
    app.use(
        "/api/ai-providers",
        createAiProvidersRouter({ center: providerCenter })
    );
    app.use(createErrorHandler());
    return app;
}

async function withServer(app, callback) {
    const server = http.createServer(app);
    await new Promise((resolve) =>
        server.listen(0, "127.0.0.1", resolve)
    );
    const { port } = server.address();
    try {
        await callback(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) =>
                error ? reject(error) : resolve()
            )
        );
    }
}

function authHeaders(token, json = false) {
    return {
        Authorization: `Bearer ${token}`,
        ...(json ? { "Content-Type": "application/json" } : {})
    };
}

async function main() {
    const imageAPath = `${userAId}/${companionAId}/2026-07-26/a.png`;
    const imageBPath = `${userBId}/${companionBId}/2026-07-26/b.png`;
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
    const database = createMemorySupabase({
        user_profiles: [accountA.profile, accountB.profile],
        companions: [...accountA.companions, ...accountB.companions],
        companion_runtime_states: [],
        settings: [
            settingsRow(
                "10000000-0000-4000-8000-000000000001",
                userAId,
                companionAId,
                "小灯"
            ),
            settingsRow(
                "10000000-0000-4000-8000-000000000002",
                userBId,
                companionBId,
                "阿岚"
            )
        ],
        conversations: [
            {
                id: sessionAId,
                user_id: userAId,
                companion_id: companionAId,
                title: "A 会话"
            },
            {
                id: sessionBId,
                user_id: userBId,
                companion_id: companionBId,
                title: "B 会话"
            }
        ],
        messages: [
            {
                id: 101,
                user_id: userAId,
                companion_id: companionAId,
                conversation_id: sessionAId,
                role: "assistant",
                content: "A 的主动消息",
                visible: true,
                context_visible: true,
                tool_calls: { is_push: true },
                created_at: "2026-07-26T10:00:00.000Z"
            },
            {
                id: 102,
                user_id: userBId,
                companion_id: companionBId,
                conversation_id: sessionBId,
                role: "assistant",
                content: "B 的主动消息",
                visible: true,
                context_visible: true,
                tool_calls: { is_push: true },
                created_at: "2026-07-26T10:01:00.000Z"
            },
            {
                id: 103,
                user_id: userAId,
                companion_id: companionAId,
                conversation_id: sessionAId,
                role: "assistant",
                content: "A 的普通回复",
                visible: true,
                context_visible: true,
                tool_calls: {},
                created_at: "2026-07-26T10:02:00.000Z"
            }
        ],
        memories: [
            {
                id: "20000000-0000-4000-8000-000000000001",
                user_id: userAId,
                companion_id: companionAId,
                summary: "A 的稳定记忆",
                confirmation_status: "confirmed",
                updated_at: "2026-07-26T02:00:00.000Z"
            },
            {
                id: "20000000-0000-4000-8000-000000000002",
                user_id: userAId,
                companion_id: companionAId,
                summary: "A 的候选记忆",
                confirmation_status: "candidate",
                updated_at: "2026-07-26T03:00:00.000Z"
            },
            {
                id: "20000000-0000-4000-8000-000000000003",
                user_id: userBId,
                companion_id: companionBId,
                summary: "B 的稳定记忆",
                confirmation_status: "confirmed",
                updated_at: "2026-07-26T04:00:00.000Z"
            }
        ],
        companion_diary_entries: [
            {
                id: "30000000-0000-4000-8000-000000000001",
                user_id: userAId,
                companion_id: companionAId,
                title: "A 的日记",
                content: "只属于 A 的内容",
                mood: "安静",
                happened_on: "2026-07-25",
                source_message_ids: [1, 2, 3],
                source_window_start: "2026-07-25T01:00:00.000Z",
                source_window_end: "2026-07-25T02:00:00.000Z",
                created_at: "2026-07-25T03:00:00.000Z"
            },
            {
                id: "30000000-0000-4000-8000-000000000002",
                user_id: userBId,
                companion_id: companionBId,
                title: "B 的日记",
                content: "只属于 B 的内容",
                mood: "晴",
                happened_on: "2026-07-25",
                source_message_ids: [4, 5],
                source_window_start: "2026-07-25T01:00:00.000Z",
                source_window_end: "2026-07-25T02:00:00.000Z",
                created_at: "2026-07-25T04:00:00.000Z"
            }
        ],
        companion_profile_versions: [
            {
                id: profileAId,
                user_id: userAId,
                companion_id: companionAId,
                version: 1,
                profile: {
                    introduction: "A 的角色档案",
                    stable: {
                        personality_traits: ["慢热"],
                        likes: [],
                        dislikes: [],
                        habits: [],
                        communication_style: []
                    },
                    identity: {
                        gender_identity: "",
                        pronouns: "",
                        relationship_position: ""
                    },
                    pending_identity_changes: [
                        {
                            id: profileProposalAId,
                            field: "pronouns",
                            proposed_value: "祂",
                            evidence_message_ids: ["1", "2", "3"],
                            proposed_at:
                                "2026-07-26T11:00:00.000Z"
                        }
                    ],
                    current_mood: null
                },
                evidence: [],
                change_reason: "A 的证据",
                confirmed_identity_change: false,
                created_at: "2026-07-26T11:00:00.000Z"
            },
            {
                id: profileBId,
                user_id: userBId,
                companion_id: companionBId,
                version: 1,
                profile: {
                    introduction: "B 的角色档案",
                    stable: {},
                    identity: {},
                    pending_identity_changes: [],
                    current_mood: null
                },
                evidence: [],
                change_reason: "B 的证据",
                confirmed_identity_change: false,
                created_at: "2026-07-26T11:00:00.000Z"
            }
        ],
        moments: [
            {
                id: momentAUserId,
                user_id: userAId,
                companion_id: companionAId,
                author: "user",
                content: "A 的用户动态",
                images: [
                    {
                        storage_path: imageAPath,
                        mime_type: "image/png",
                        byte_size: 8
                    }
                ],
                reply_due_at: "2026-07-26T13:00:00.000Z",
                reply_status: "pending",
                liked: false,
                user_liked: false,
                created_at: "2026-07-26T01:00:00.000Z"
            },
            {
                id: momentAAiId,
                user_id: userAId,
                companion_id: companionAId,
                author: "assistant",
                content: "A 的 AI 动态",
                images: [],
                reply_due_at: "2026-07-26T01:00:00.000Z",
                reply_status: "done",
                liked: false,
                user_liked: false,
                created_at: "2026-07-26T02:00:00.000Z"
            },
            {
                id: momentBAiId,
                user_id: userBId,
                companion_id: companionBId,
                author: "assistant",
                content: "B 的 AI 动态",
                images: [
                    {
                        storage_path: imageBPath,
                        mime_type: "image/png",
                        byte_size: 8
                    }
                ],
                reply_due_at: "2026-07-26T01:00:00.000Z",
                reply_status: "done",
                liked: false,
                user_liked: false,
                created_at: "2026-07-26T03:00:00.000Z"
            }
        ],
        moment_comments: [
            {
                id: "50000000-0000-4000-8000-000000000001",
                user_id: userAId,
                companion_id: companionAId,
                moment_id: momentAAiId,
                author: "user",
                content: "A 的评论",
                reply_status: "pending",
                created_at: "2026-07-26T02:10:00.000Z"
            },
            {
                id: "50000000-0000-4000-8000-000000000002",
                user_id: userBId,
                companion_id: companionBId,
                moment_id: momentBAiId,
                author: "user",
                content: "B 的评论",
                reply_status: "pending",
                created_at: "2026-07-26T03:10:00.000Z"
            }
        ],
        background_jobs: [],
        push_installations: [],
        mcp_connections: [
            {
                id: "60000000-0000-4000-8000-000000000001",
                user_id: userAId,
                companion_id: companionAId,
                name: "A 的空调",
                slug: "a-air-conditioner",
                endpoint: "https://a-device.example.test/mcp",
                auth_type: "none",
                auth_header: "Authorization",
                secret_ciphertext: null,
                protocol_version: "2025-03-26",
                enabled: false,
                discovered_tools: [],
                tool_policies: {},
                last_status: "connected",
                last_error: null,
                last_checked_at: "2026-07-26T01:00:00.000Z",
                created_at: "2026-07-26T01:00:00.000Z",
                updated_at: "2026-07-26T01:00:00.000Z"
            },
            {
                id: "60000000-0000-4000-8000-000000000002",
                user_id: userBId,
                companion_id: companionBId,
                name: "B 的灯",
                slug: "b-light",
                endpoint: "https://b-device.example.test/mcp",
                auth_type: "bearer",
                auth_header: "Authorization",
                secret_ciphertext: "must-not-leak",
                protocol_version: "2025-03-26",
                enabled: false,
                discovered_tools: [],
                tool_policies: {},
                last_status: "connected",
                last_error: null,
                last_checked_at: "2026-07-26T01:00:00.000Z",
                created_at: "2026-07-26T01:00:00.000Z",
                updated_at: "2026-07-26T01:00:00.000Z"
            }
        ],
        ai_provider_profiles: [
            {
                id: "70000000-0000-4000-8000-000000000001",
                user_id: userAId,
                companion_id: companionAId,
                name: "A 的模型",
                slug: "a-model",
                protocol: "openai-chat",
                base_url: "https://a-model.example.test/v1",
                auth_type: "bearer",
                secret_ciphertext: "a-secret",
                default_model: "model-a",
                enabled: true,
                is_default: true,
                priority: 100,
                billing_url: "",
                expires_at: null,
                notes: "",
                discovered_models: [],
                last_status: "untested",
                last_error: null,
                last_checked_at: null,
                created_at: "2026-07-26T01:00:00.000Z",
                updated_at: "2026-07-26T01:00:00.000Z"
            },
            {
                id: "70000000-0000-4000-8000-000000000002",
                user_id: userBId,
                companion_id: companionBId,
                name: "B 的模型",
                slug: "b-model",
                protocol: "anthropic",
                base_url: "https://b-model.example.test",
                auth_type: "bearer",
                secret_ciphertext: "b-secret-must-not-leak",
                default_model: "model-b",
                enabled: true,
                is_default: true,
                priority: 100,
                billing_url: "",
                expires_at: null,
                notes: "",
                discovered_models: [],
                last_status: "untested",
                last_error: null,
                last_checked_at: null,
                created_at: "2026-07-26T01:00:00.000Z",
                updated_at: "2026-07-26T01:00:00.000Z"
            }
        ]
    });
    const storage = createMemoryStorage({
        [`moments/${imageAPath}`]: Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
        ]),
        [`moments/${imageBPath}`]: Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
        ])
    });
    const scopeA = createRequestScope({
        adminSupabase: database,
        ...accountA
    });
    const scopeB = createRequestScope({
        adminSupabase: database,
        ...accountB
    });
    const centerEnv = {
        NODE_ENV: "test",
        MCP_ENCRYPTION_KEY:
            "tenant-test-encryption-key-that-is-long-enough"
    };
    const mcpCenter = createMcpDeviceCenter({
        supabase: database,
        env: centerEnv,
        lookup: async () => [
            { address: "203.0.113.10", family: 4 }
        ]
    });
    const providerCenter = createAiProviderCenter({
        supabase: database,
        env: centerEnv,
        lookup: async () => [
            { address: "203.0.113.11", family: 4 }
        ]
    });
    const app = createApp(
        { "token-a": scopeA, "token-b": scopeB },
        storage,
        { mcpCenter, providerCenter }
    );

    await withServer(app, async (baseUrl) => {
        const anonymous = await fetch(`${baseUrl}/api/v2/moments`);
        assert.equal(anonymous.status, 401);

        const bootstrapA = await (
            await fetch(`${baseUrl}/api/v2/bootstrap`, {
                headers: authHeaders("token-a")
            })
        ).json();
        assert.equal(bootstrapA.settings.ai_name, "小灯");
        assert.equal(bootstrapA.settings.user_display_name, "桃桃");
        assert.deepEqual(
            bootstrapA.sessions.map((session) => session.id),
            [sessionAId],
            "the startup payload must remain tenant scoped"
        );
        assert.equal(typeof bootstrapA.state, "object");

        const settingsA = await (
            await fetch(`${baseUrl}/api/v2/settings`, {
                headers: authHeaders("token-a")
            })
        ).json();
        assert.equal(settingsA.settings.ai_name, "小灯");
        assert.equal(settingsA.settings.user_display_name, "桃桃");
        assert.equal(settingsA.settings.account_role, "owner");
        assert.doesNotMatch(JSON.stringify(settingsA), /阿岚/);

        const updateA = await fetch(`${baseUrl}/api/v2/settings`, {
            method: "PUT",
            headers: authHeaders("token-a", true),
            body: JSON.stringify({
                ai_name: "灯灯",
                user_display_name: "新桃桃",
                provider: "openai-responses",
                reasoning_effort: "xhigh",
                user_id: userBId,
                companion_id: companionBId
            })
        });
        assert.equal(updateA.status, 200);
        const updatedSettingsA = (await updateA.json()).settings;
        assert.equal(updatedSettingsA.ai_name, "灯灯");
        assert.equal(updatedSettingsA.user_display_name, "新桃桃");
        assert.equal(updatedSettingsA.provider, "custom");
        assert.equal(updatedSettingsA.api_url, "");
        assert.equal(updatedSettingsA.model, "");
        assert.equal(updatedSettingsA.reasoning_effort, "");
        assert.equal(
            database.tables.settings.find(
                (row) => row.user_id === userAId
            ).ai_name,
            "灯灯"
        );
        assert.equal(
            database.tables.settings.find(
                (row) => row.user_id === userAId
            ).reasoning_effort,
            ""
        );
        assert.equal(
            database.tables.settings.find(
                (row) => row.user_id === userBId
            ).ai_name,
            "阿岚"
        );
        assert.equal(
            database.tables.user_profiles.find(
                (row) => row.id === userAId
            ).display_name,
            "新桃桃"
        );
        assert.equal(
            database.tables.companions.find(
                (row) => row.id === companionAId
            ).name,
            "灯灯"
        );
        assert.equal(
            database.tables.user_profiles.find(
                (row) => row.id === userBId
            ).display_name,
            "朋友"
        );

        const savedRuntimeA = await fetch(
            `${baseUrl}/api/v2/companion-state`,
            {
                method: "PUT",
                headers: authHeaders("token-a", true),
                body: JSON.stringify({
                    status: { mood: "开心", energyLevel: 81 },
                    interaction_stats: { counts: { hug: 4 } }
                })
            }
        );
        assert.equal(savedRuntimeA.status, 200);
        await fetch(`${baseUrl}/api/v2/companion-state`, {
            method: "PUT",
            headers: authHeaders("token-b", true),
            body: JSON.stringify({
                status: { mood: "安静", energyLevel: 48 },
                interaction_stats: { counts: { hug: 1 } }
            })
        });
        const runtimeA = await (
            await fetch(`${baseUrl}/api/v2/companion-state`, {
                headers: authHeaders("token-a")
            })
        ).json();
        const runtimeB = await (
            await fetch(`${baseUrl}/api/v2/companion-state`, {
                headers: authHeaders("token-b")
            })
        ).json();
        assert.equal(runtimeA.state.status.mood, "开心");
        assert.equal(runtimeB.state.status.mood, "安静");

        const pushMessagesA = await (
            await fetch(
                `${baseUrl}/api/v2/push/messages?since=2026-07-26T09%3A00%3A00.000Z&limit=50`,
                { headers: authHeaders("token-a") }
            )
        ).json();
        assert.deepEqual(
            pushMessagesA.messages.map((item) => item.content),
            ["A 的主动消息"]
        );
        assert.doesNotMatch(
            JSON.stringify(pushMessagesA),
            /B 的主动消息|A 的普通回复/
        );

        const registerInstallation = await fetch(
            `${baseUrl}/api/v2/notification-installations/register`,
            {
                method: "POST",
                headers: authHeaders("token-a", true),
                body: JSON.stringify({
                    device_id:
                        "80000000-0000-4000-8000-000000000001",
                    platform: "android",
                    app_version: "2.0.0"
                })
            }
        );
        assert.equal(registerInstallation.status, 201);
        const installationBody =
            await registerInstallation.json();
        assert.equal(
            installationBody.installation_token,
            "local-installation-token-0000000000000001"
        );
        assert.equal(
            installationBody.companion_id,
            companionAId
        );
        assert.equal(
            database.tables.push_installations.length,
            1
        );
        assert.equal(
            database.tables.push_installations[0].user_id,
            userAId
        );
        assert.equal(
            database.tables.push_installations[0].companion_id,
            companionAId
        );
        assert.equal(
            database.tables.push_installations[0]
                .token_ciphertext,
            null
        );
        assert.doesNotMatch(
            JSON.stringify(database.tables.push_installations),
            /local-installation-token-0000000000000001/
        );

        const mcpA = await (
            await fetch(
                `${baseUrl}/api/mcp/connections/manage`,
                { headers: authHeaders("token-a") }
            )
        ).json();
        assert.deepEqual(
            mcpA.connections.map((item) => item.name),
            ["A 的空调"]
        );
        assert.doesNotMatch(
            JSON.stringify(mcpA),
            /B 的灯|must-not-leak|secret_ciphertext/
        );
        const deleteForeignMcp = await fetch(
            `${baseUrl}/api/mcp/connections/manage/60000000-0000-4000-8000-000000000002`,
            {
                method: "DELETE",
                headers: authHeaders("token-a")
            }
        );
        assert.equal(deleteForeignMcp.status, 404);
        assert.equal(
            database.tables.mcp_connections.length,
            2
        );

        const anonymousProviderStatus = await fetch(
            `${baseUrl}/api/ai-providers/status`
        );
        assert.equal(anonymousProviderStatus.status, 401);
        assert.equal(
            (await anonymousProviderStatus.json()).code,
            "authentication_required"
        );

        const providerStatusAResponse = await fetch(
            `${baseUrl}/api/ai-providers/status`,
            { headers: authHeaders("token-a") }
        );
        assert.equal(providerStatusAResponse.status, 200);
        const providerStatusA = await providerStatusAResponse.json();
        assert.equal(providerStatusA.profiles, 1);
        assert.equal(providerStatusA.enabled_profiles, 1);
        assert.equal(
            providerStatusA.active_profile.id,
            "70000000-0000-4000-8000-000000000001"
        );
        assert.equal(providerStatusA.active_profile.default_model, "model-a");
        assert.doesNotMatch(
            JSON.stringify(providerStatusA),
            /model-b|70000000-0000-4000-8000-000000000002|b-secret-must-not-leak/
        );

        const providerStatusBResponse = await fetch(
            `${baseUrl}/api/ai-providers/status`,
            { headers: authHeaders("token-b") }
        );
        assert.equal(providerStatusBResponse.status, 200);
        const providerStatusB = await providerStatusBResponse.json();
        assert.equal(providerStatusB.profiles, 1);
        assert.equal(providerStatusB.enabled_profiles, 1);
        assert.equal(
            providerStatusB.active_profile.id,
            "70000000-0000-4000-8000-000000000002"
        );
        assert.equal(providerStatusB.active_profile.default_model, "model-b");
        assert.doesNotMatch(
            JSON.stringify(providerStatusB),
            /model-a|70000000-0000-4000-8000-000000000001|a-secret/
        );

        const providersA = await (
            await fetch(`${baseUrl}/api/ai-providers/manage`, {
                headers: authHeaders("token-a")
            })
        ).json();
        assert.deepEqual(
            providersA.profiles.map((item) => item.name),
            ["A 的模型"]
        );
        assert.doesNotMatch(
            JSON.stringify(providersA),
            /B 的模型|b-secret-must-not-leak|secret_ciphertext/
        );
        const deleteForeignProvider = await fetch(
            `${baseUrl}/api/ai-providers/manage/70000000-0000-4000-8000-000000000002`,
            {
                method: "DELETE",
                headers: authHeaders("token-a")
            }
        );
        assert.equal(deleteForeignProvider.status, 404);
        assert.equal(
            database.tables.ai_provider_profiles.length,
            2
        );

        const memoriesA = await (
            await fetch(`${baseUrl}/api/v2/memories`, {
                headers: authHeaders("token-a")
            })
        ).json();
        assert.deepEqual(
            memoriesA.memories.map((item) => item.summary),
            ["A 的稳定记忆"]
        );

        const updatedMemoryResponse = await fetch(
            `${baseUrl}/api/v2/memories/20000000-0000-4000-8000-000000000001`,
            {
                method: "PATCH",
                headers: authHeaders("token-a", true),
                body: JSON.stringify({ summary: "A 自己修改后的记忆" })
            }
        );
        assert.equal(updatedMemoryResponse.status, 200);
        const updatedMemory = await updatedMemoryResponse.json();
        assert.equal(updatedMemory.memory.summary, "A 自己修改后的记忆");

        const editForeignMemory = await fetch(
            `${baseUrl}/api/v2/memories/20000000-0000-4000-8000-000000000003`,
            {
                method: "PATCH",
                headers: authHeaders("token-a", true),
                body: JSON.stringify({ summary: "不应修改到 B" })
            }
        );
        assert.equal(editForeignMemory.status, 404);

        const deleteOwnMemory = await fetch(
            `${baseUrl}/api/v2/memories/20000000-0000-4000-8000-000000000001`,
            {
                method: "DELETE",
                headers: authHeaders("token-a")
            }
        );
        assert.equal(deleteOwnMemory.status, 204);
        assert.equal(
            database.tables.memories.some(
                (item) =>
                    item.id === "20000000-0000-4000-8000-000000000001"
            ),
            false
        );
        assert.equal(
            database.tables.memories.some(
                (item) =>
                    item.id === "20000000-0000-4000-8000-000000000003" &&
                    item.summary === "B 的稳定记忆"
            ),
            true
        );

        const diaryA = await (
            await fetch(`${baseUrl}/api/v2/diary`, {
                headers: authHeaders("token-a")
            })
        ).json();
        assert.deepEqual(
            diaryA.entries.map((item) => item.title),
            ["A 的日记"]
        );
        assert.equal(diaryA.entries[0].source_message_count, 3);
        assert.equal(
            Object.hasOwn(diaryA.entries[0], "source_message_ids"),
            false
        );

        const profileA = await (
            await fetch(`${baseUrl}/api/v2/companion-profile`, {
                headers: authHeaders("token-a")
            })
        ).json();
        assert.equal(profileA.latest_version, 1);
        assert.equal(profileA.profile.introduction, "A 的角色档案");
        assert.doesNotMatch(
            JSON.stringify(profileA),
            /B 的角色档案|B 的证据/
        );

        const confirmProfileA = await fetch(
            `${baseUrl}/api/v2/companion-profile/identity/confirm`,
            {
                method: "POST",
                headers: authHeaders("token-a", true),
                body: JSON.stringify({
                    proposal_ids: [profileProposalAId],
                    client_action_id:
                        "e1000000-0000-4000-8000-000000000001"
                })
            }
        );
        assert.equal(confirmProfileA.status, 201);
        const confirmedProfileA = (
            await confirmProfileA.json()
        ).version;
        assert.equal(confirmedProfileA.version, 2);
        assert.equal(confirmedProfileA.profile.identity.pronouns, "祂");
        assert.equal(
            database.tables.companion_profile_versions.filter(
                (item) => item.user_id === userBId
            ).length,
            1
        );

        const momentsA = await (
            await fetch(`${baseUrl}/api/v2/moments`, {
                headers: authHeaders("token-a")
            })
        ).json();
        assert.deepEqual(
            momentsA.entries.map((item) => item.content),
            ["A 的 AI 动态", "A 的用户动态"]
        );
        assert.equal(
            momentsA.entries.some((item) =>
                Object.hasOwn(item, "reply_due_at")
            ),
            false
        );
        assert.equal(
            momentsA.entries.some((item) =>
                Object.hasOwn(item, "reply_status")
            ),
            false
        );
        assert.deepEqual(
            momentsA.entries
                .flatMap((item) => item.comments)
                .map((item) => item.content),
            ["A 的评论"]
        );

        const ownImage = await fetch(
            `${baseUrl}/api/v2/moments/${momentAUserId}/images/0`,
            { headers: authHeaders("token-a") }
        );
        assert.equal(ownImage.status, 200);
        assert.equal(
            ownImage.headers.get("content-type"),
            "image/png"
        );
        const foreignImage = await fetch(
            `${baseUrl}/api/v2/moments/${momentBAiId}/images/0`,
            { headers: authHeaders("token-a") }
        );
        assert.equal(foreignImage.status, 404);

        const likeOwn = await fetch(
            `${baseUrl}/api/v2/moments/${momentAAiId}/like`,
            {
                method: "POST",
                headers: authHeaders("token-a", true),
                body: JSON.stringify({ liked: true })
            }
        );
        assert.equal(likeOwn.status, 200);
        assert.equal((await likeOwn.json()).moment.user_liked, true);
        const likeForeign = await fetch(
            `${baseUrl}/api/v2/moments/${momentBAiId}/like`,
            {
                method: "POST",
                headers: authHeaders("token-a", true),
                body: JSON.stringify({ liked: true })
            }
        );
        assert.equal(likeForeign.status, 404);

        const commentOwn = await fetch(
            `${baseUrl}/api/v2/moments/${momentAAiId}/comments`,
            {
                method: "POST",
                headers: authHeaders("token-a", true),
                body: JSON.stringify({ content: "新的 A 评论" })
            }
        );
        assert.equal(commentOwn.status, 201);
        assert.equal(
            (await commentOwn.json()).comment.content,
            "新的 A 评论"
        );
        const savedComment = database.tables.moment_comments.find(
            (item) => item.content === "新的 A 评论"
        );
        assert.equal(savedComment.user_id, userAId);
        assert.equal(savedComment.companion_id, companionAId);

        const png = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
        ]);
        const createMoment = await fetch(
            `${baseUrl}/api/v2/moments`,
            {
                method: "POST",
                headers: authHeaders("token-a", true),
                body: JSON.stringify({
                    content: "A 的新动态",
                    session_id: sessionAId,
                    images: [
                        {
                            type: "image/png",
                            data: png.toString("base64")
                        }
                    ],
                    user_id: userBId,
                    companion_id: companionBId
                })
            }
        );
        assert.equal(createMoment.status, 201);
        const createdMoment = (await createMoment.json()).moment;
        assert.equal(
            Object.hasOwn(createdMoment, "reply_due_at"),
            false
        );
        assert.equal(
            Object.hasOwn(createdMoment, "reply_status"),
            false
        );
        const storedMoment = database.tables.moments.find(
            (item) => item.id === createdMoment.id
        );
        assert.equal(storedMoment.user_id, userAId);
        assert.equal(storedMoment.companion_id, companionAId);
        assert.match(
            storedMoment.images[0].storage_path,
            new RegExp(`^${userAId}/${companionAId}/`)
        );
        assert.equal(
            database.tables.background_jobs.filter(
                (item) => item.user_id === userAId
            ).length,
            2
        );
        assert.equal(
            database.tables.background_jobs.some(
                (item) => item.user_id === userBId
            ),
            false
        );

        const objectCountBeforeForeignPost = storage.objects.size;
        const foreignSessionPost = await fetch(
            `${baseUrl}/api/v2/moments`,
            {
                method: "POST",
                headers: authHeaders("token-a", true),
                body: JSON.stringify({
                    content: "不应写入",
                    session_id: sessionBId,
                    images: [
                        {
                            type: "image/png",
                            data: png.toString("base64")
                        }
                    ]
                })
            }
        );
        assert.equal(foreignSessionPost.status, 404);
        assert.equal(storage.objects.size, objectCountBeforeForeignPost);
    });

    console.log(
        "strict v2 settings, memory, diary, moment and media isolation tests passed"
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
