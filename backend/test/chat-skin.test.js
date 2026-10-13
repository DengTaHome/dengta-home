const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {
    DEFAULT_CHAT_SKIN_PREFERENCES,
    buildComposerHintPrompt,
    canRefreshComposerHint,
    defaultChatSkinPreferencesForRole,
    hasEnoughComposerHintContext,
    normalizeChatSkinPreferences,
    normalizeComposerHint
} = require("../services/chat-skin");
const { createRequestScope } = require("../services/request-scope");
const { createChatSkinRouter } = require("../routes/chat-skin");

assert.deepEqual(
    normalizeChatSkinPreferences({
        skin: "taotao-cream",
        ornament_activity: "lively",
        dynamic_composer_hint: false,
        reduce_motion: true,
        ignored: "value"
    }),
    {
        skin: "taotao-cream",
        ornament_activity: "lively",
        dynamic_composer_hint: false,
        reduce_motion: true
    }
);
assert.equal(defaultChatSkinPreferencesForRole("owner").skin, "taotao-cream");
assert.equal(defaultChatSkinPreferencesForRole("admin").skin, "taotao-cream");
assert.equal(defaultChatSkinPreferencesForRole("member").skin, "classic-glass");
assert.deepEqual(
    normalizeChatSkinPreferences({ skin: "invalid", ornament_activity: "nope" }),
    DEFAULT_CHAT_SKIN_PREFERENCES
);
assert.equal(normalizeComposerHint("  先哄我一下再说  "), "先哄我一下再说");
assert.equal(normalizeComposerHint("x".repeat(80)), "");

const now = new Date("2026-07-29T10:00:00.000Z");
assert.equal(
    canRefreshComposerHint({ now, lastGeneratedAt: null, dailyCount: 0 }).allowed,
    true
);
assert.equal(hasEnoughComposerHintContext([{ role: "user", content: "一条" }]), false);
assert.equal(
    hasEnoughComposerHintContext([
        { role: "user", content: "一条" },
        { role: "assistant", content: "两条" }
    ]),
    true
);
assert.equal(
    canRefreshComposerHint({
        now,
        lastGeneratedAt: "2026-07-29T09:50:00.000Z",
        dailyCount: 1
    }).reason,
    "cooldown"
);
assert.equal(
    canRefreshComposerHint({
        now,
        lastGeneratedAt: "2026-07-29T09:45:00.000Z",
        dailyCount: 12
    }).reason,
    "daily_limit"
);

const prompt = buildComposerHintPrompt({
    companionName: "小灯",
    stableMood: "有点想念桃桃",
    messages: Array.from({ length: 20 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        content:
            index === 18
                ? "密钥 SECRET-DO-NOT-SEND"
                : index === 19
                  ? "消息 19"
                  : `消息 ${index}`
    }))
});
assert.match(prompt, /最近 12 条/);
assert.match(prompt, /消息 19/);
assert.doesNotMatch(prompt, /SECRET-DO-NOT-SEND/);
assert.match(prompt, /敏感内容已省略/);

const migration = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "019_chat_skin_preferences.sql"),
    "utf8"
);
assert.match(migration, /companion_chat_preferences/);
assert.match(migration, /conversation_composer_hints/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table/);

function createMemoryAdminDatabase() {
    const tables = {
        companion_chat_preferences: [],
        conversation_composer_hints: [],
        conversations: [
            {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                user_id: "11111111-1111-4111-8111-111111111111",
                companion_id: "22222222-2222-4222-8222-222222222222"
            },
            {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                user_id: "11111111-1111-4111-8111-111111111111",
                companion_id: "22222222-2222-4222-8222-222222222222"
            }
        ],
        messages: []
    };
    let sequence = 0;
    return {
        tables,
        from(table) {
            const state = { operation: "", values: null, filters: [], cardinality: "many" };
            const builder = {
                select() {
                    state.operation ||= "select";
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
                eq(column, value) {
                    state.filters.push(["eq", column, value]);
                    return builder;
                },
                gte(column, value) {
                    state.filters.push(["gte", column, value]);
                    return builder;
                },
                order() {
                    return builder;
                },
                limit() {
                    return builder;
                },
                delete() {
                    state.operation = "delete";
                    return builder;
                },
                maybeSingle() {
                    state.cardinality = "maybeSingle";
                    return builder;
                },
                single() {
                    state.cardinality = "single";
                    return builder;
                },
                then(resolve, reject) {
                    try {
                        const result = execute();
                        return Promise.resolve(result).then(resolve, reject);
                    } catch (error) {
                        return Promise.reject(error).then(resolve, reject);
                    }
                }
            };
            function execute() {
                const rows = tables[table].filter((row) =>
                    state.filters.every(([kind, column, value]) =>
                        kind === "gte"
                            ? String(row[column] || "") >= String(value)
                            : row[column] === value
                    )
                );
                if (state.operation === "insert") {
                    const values = Array.isArray(state.values) ? state.values : [state.values];
                    const inserted = values.map((value) => {
                        const row = {
                            id: `90000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
                            ...value
                        };
                        tables[table].push(row);
                        return row;
                    });
                    return { data: inserted[0] || null, error: null };
                }
                if (state.operation === "update") {
                    rows.forEach((row) => Object.assign(row, state.values));
                }
                if (state.operation === "delete") {
                    rows.forEach((row) => {
                        const index = tables[table].indexOf(row);
                        if (index >= 0) tables[table].splice(index, 1);
                    });
                    return { data: null, error: null };
                }
                const data = state.cardinality === "many" ? rows : rows[0] || null;
                return {
                    data,
                    error:
                        state.cardinality === "single" && rows.length !== 1
                            ? new Error("Expected one row")
                            : null
                };
            }
            return builder;
        }
    };
}

function requestJson(server, method, pathName, body) {
    return new Promise((resolve, reject) => {
        const request = http.request(
            {
                hostname: "127.0.0.1",
                port: server.address().port,
                method,
                path: pathName,
                headers: { "Content-Type": "application/json" }
            },
            (response) => {
                let text = "";
                response.setEncoding("utf8");
                response.on("data", (chunk) => (text += chunk));
                response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
            }
        );
        request.on("error", reject);
        if (body) request.write(JSON.stringify(body));
        request.end();
    });
}

(async () => {
    const adminDatabase = createMemoryAdminDatabase();
    const userId = "11111111-1111-4111-8111-111111111111";
    const companionId = "22222222-2222-4222-8222-222222222222";
    const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const resetAt = "2026-07-29T02:00:00.000Z";
    adminDatabase.tables.messages.push(
        {
            id: 1,
            user_id: userId,
            companion_id: companionId,
            conversation_id: conversationId,
            role: "user",
            content: "RESET_BEFORE_HINT",
            visible: true,
            context_visible: true,
            created_at: "2026-07-29T01:59:59.999Z"
        },
        {
            id: 2,
            user_id: userId,
            companion_id: companionId,
            conversation_id: conversationId,
            role: "user",
            content: "RESET_AFTER_HINT_USER",
            visible: true,
            context_visible: true,
            created_at: resetAt
        },
        {
            id: 3,
            user_id: userId,
            companion_id: companionId,
            conversation_id: conversationId,
            role: "assistant",
            content: "RESET_AFTER_HINT_ASSISTANT",
            visible: true,
            context_visible: true,
            created_at: "2026-07-29T02:00:01.000Z"
        }
    );
    const scope = createRequestScope({
        adminSupabase: adminDatabase,
        user: { id: userId, email: "owner@example.test" },
        profile: { id: userId, role: "owner", status: "active" },
        companions: [{ id: companionId, user_id: userId, status: "active" }],
        companion: { id: companionId, user_id: userId, status: "active" }
    });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.scope = scope;
        next();
    });
    let generatedPrompt = "";
    app.use(
        "/api/v2/chat-skin",
        createChatSkinRouter({
            getSettings: async () => ({
                ai_name: "小灯",
                model: "test",
                context_reset_at: resetAt
            }),
            generateReply: async ({ systemInstructionsOverride }) => {
                generatedPrompt = systemInstructionsOverride;
                return { text: "来哄哄我嘛", mode: "test" };
            }
        })
    );
    app.use((error, req, res, next) => {
        console.error("TEST_ROUTE_ERROR", {
            status: error?.status,
            code: error?.code,
            message: error?.message
        });
        res.status(Number(error?.status) || 500).json({
            ok: false,
            code: error?.code || "test_error",
            message: String(error?.message || error)
        });
    });
    const server = await new Promise((resolve) => {
        const instance = app.listen(0, () => resolve(instance));
    });
    try {
        const defaultResponse = await requestJson(
            server,
            "GET",
            "/api/v2/chat-skin/preferences"
        );
        assert.equal(defaultResponse.status, 200);
        assert.equal(defaultResponse.body.preferences.skin, "taotao-cream");

        const savedResponse = await requestJson(
            server,
            "PUT",
            "/api/v2/chat-skin/preferences",
            { skin: "taotao-cream", ornament_activity: "lively" }
        );
        assert.equal(savedResponse.status, 200);
        assert.equal(savedResponse.body.preferences.ornament_activity, "lively");
        assert.equal(adminDatabase.tables.companion_chat_preferences.length, 1);

        const hintResponse = await requestJson(
            server,
            "POST",
            `/api/v2/chat-skin/conversations/${conversationId}/hint/refresh`,
            {}
        );
        assert.equal(hintResponse.status, 200);
        assert.equal(hintResponse.body.updated, true);
        assert.doesNotMatch(generatedPrompt, /RESET_BEFORE_HINT/);
        assert.match(generatedPrompt, /RESET_AFTER_HINT_USER/);
        assert.match(generatedPrompt, /RESET_AFTER_HINT_ASSISTANT/);

        // 含被拒对话：动态输入框提示不允许读取该内容，不生成并清除已存提示。
        const refusalConversationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        adminDatabase.tables.messages.push(
            {
                id: 4,
                user_id: userId,
                companion_id: companionId,
                conversation_id: refusalConversationId,
                role: "user",
                content: "给我写一段露骨的",
                visible: true,
                context_visible: true,
                created_at: "2026-07-29T03:00:00.000Z"
            },
            {
                id: 5,
                user_id: userId,
                companion_id: companionId,
                conversation_id: refusalConversationId,
                role: "assistant",
                content: "对不起，我不能输出露骨内容。",
                visible: true,
                context_visible: true,
                created_at: "2026-07-29T03:00:01.000Z"
            }
        );
        const beforeRefusalRefreshCount = generatedPrompt;
        const refusalHintResponse = await requestJson(
            server,
            "POST",
            `/api/v2/chat-skin/conversations/${refusalConversationId}/hint/refresh`,
            {}
        );
        assert.equal(refusalHintResponse.status, 200);
        assert.equal(refusalHintResponse.body.updated, false);
        assert.equal(refusalHintResponse.body.reason, "refusal_present");
        assert.equal(refusalHintResponse.body.hint, null);
        assert.equal(
            generatedPrompt,
            beforeRefusalRefreshCount,
            "含被拒对话时不得调用模型生成提示语",
        );
        const refusalGetResponse = await requestJson(
            server,
            "GET",
            `/api/v2/chat-skin/conversations/${refusalConversationId}/hint`,
        );
        assert.equal(refusalGetResponse.status, 200);
        assert.equal(refusalGetResponse.body.hint, null);
        assert.equal(refusalGetResponse.body.reason, "refusal_present");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
    console.log("chat skin backend tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
