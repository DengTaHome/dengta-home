"use strict";

// agents.md 按用户注入状态端点测试：
// 需登录（无 scope 401）、实时组装个性化+记忆原文、来源统计、预览、空用户、错误透传

const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createAgentsMdStatusHandler } = require("../services/agents-md-status");
const { createRequestScope } = require("../services/request-scope");

const USER_ID = "3a86a0d7-a3a2-4034-8868-1afd8889e1da";
const COMPANION_ID = "d99ebbd8-5823-4e39-8be4-79a92be965c0";

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
            user_metadata: { display_name: "test" }
        },
        profile: {
            id: userId,
            email,
            display_name: "桃桃",
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

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createMemorySupabase(seed) {
    const tables = clone(seed);
    function from(tableName) {
        if (!Array.isArray(tables[tableName])) {
            throw new Error(`Unknown in-memory table: ${tableName}`);
        }
        const state = { filters: [], orders: [], limit: null, columns: "*" };
        const builder = {
            select(columns = "*") { state.columns = columns; return builder; },
            eq(key, value) { state.filters.push({ key, value }); return builder; },
            order(key, opts) { state.orders.push({ key, ...opts }); return builder; },
            limit(value) { state.limit = value; return builder; },
            async then(resolve, reject) {
                let rows = tables[tableName].slice();
                for (const f of state.filters) {
                    rows = rows.filter((row) => row[f.key] === f.value);
                }
                for (const o of state.orders) {
                    rows.sort((a, b) => (o.ascending === false ? (a[o.key] < b[o.key] ? 1 : -1) : (a[o.key] > b[o.key] ? 1 : -1)));
                }
                if (state.limit) rows = rows.slice(0, state.limit);
                if (state.columns && state.columns !== "*") {
                    const cols = state.columns.split(",").map((c) => c.trim());
                    rows = rows.map((row) => {
                        const out = {};
                        for (const c of cols) if (Object.hasOwn(row, c)) out[c] = row[c];
                        return out;
                    });
                }
                resolve({ data: rows, error: null });
            }
        };
        return builder;
    }
    return { from };
}

function scopeFor(req) {
    const adminSupabase = createMemorySupabase({
        memories: [
            {
                user_id: USER_ID,
                companion_id: COMPANION_ID,
                summary: "桃桃养了一只叫团子的橘猫。",
                confirmation_status: "confirmed", superseded: false,
                updated_at: "2026-08-01T00:00:00Z"
            },
            {
                user_id: USER_ID,
                companion_id: COMPANION_ID,
                summary: "桃桃周三要交季度报告。",
                confirmation_status: "confirmed", superseded: false,
                updated_at: "2026-08-02T00:00:00Z"
            }
        ]
    });
    return createRequestScope({
        adminSupabase,
        ...accountFixture(USER_ID, COMPANION_ID, "owner@example.test", "owner")
    });
}

function listen(app) {
    return new Promise((resolve) => {
        const server = http.createServer(app);
        server.listen(0, () => resolve(server));
    });
}

function request(server, path, token) {
    return new Promise((resolve, reject) => {
        const headers = {};
        if (token) headers.Authorization = "Bearer " + token;
        const req = http.request({
            port: server.address().port,
            path,
            method: "GET",
            headers
        }, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode, body }));
        });
        req.on("error", reject);
        req.end();
    });
}

let passed = 0;
let failed = 0;
function ok(condition, label) {
    if (condition) { passed += 1; } else { failed += 1; console.error("  FAIL:", label); }
}

async function main() {
    const previewSettings = {
        prompt_mode: "unified",
        user_details: "用户：桃桃，喜欢猫，怕黑。",
        unified_system_prompt: "你是小小灯，桃桃的专属伴侣。",
        system_prompt: "legacy-preview-fixture"
    };
    const getSettings = async () => ({ ...previewSettings });
    const app = express();
    // auth-like middleware: require scope (401 without token)
    app.use((req, res, next) => {
        const token = String(req.headers.authorization || "");
        if (!token.startsWith("Bearer ")) {
            return res.status(401).json({ code: "authentication_required" });
        }
        req.scope = scopeFor(req);
        next();
    });
    app.get("/api/v2/agents-md/status", createAgentsMdStatusHandler({ getSettings }));
    app.use((err, req, res, next) => {
        res.status(err?.status || 500).json({ error: String(err?.message || "error") });
    });
    const server = await listen(app);

    // 1) 无 token -> 401
    const anon = await request(server, "/api/v2/agents-md/status");
    ok(anon.status === 401, "无 token 返回 401（需登录）");

    // 2) 正常用户 -> 注入状态 + 来源 + 预览
    const res = await request(server, "/api/v2/agents-md/status", "test-token");
    ok(res.status === 200, "有 token 返回 200");
    const body = JSON.parse(res.body);
    ok(body.user_id === USER_ID, "返回 user_id");
    ok(body.applied === true, "applied=true");
    ok(body.chars > 0, "chars>0");
    ok(body.sources.user_details === true, "来源含 user_details");
    ok(body.sources.unified_system_prompt === true, "来源含 unified_system_prompt");
    ok(body.sources.memories === 2, "来源记忆 2 条");
    ok(body.preview.includes("桃桃") && body.preview.includes("团子"), "预览含个性化与记忆原文");
    ok(!body.preview.includes("【"), "预览无包装标题");
    ok(body.sources.legacy_fields.length === 0, "统一模式的来源不谎报旧字段已投递");
    previewSettings.prompt_mode = " LEGACY ";
    const legacy = JSON.parse((await request(server, "/api/v2/agents-md/status", "test-token")).body);
    ok(legacy.sources.unified_system_prompt === false, "legacy 模式不谎报统一指令已投递");
    ok(legacy.sources.legacy_fields.join() === "system_prompt", "来源与实际 legacy 字段一致");
    ok(legacy.preview.includes("legacy-preview-fixture") && !legacy.preview.includes(previewSettings.unified_system_prompt), "预览按规范化模式选择内容");

    // 3) 空用户 -> applied=false
    const app2 = express();
    app2.use((req, res, next) => {
        if (!String(req.headers.authorization || "").startsWith("Bearer ")) {
            return res.status(401).json({ code: "authentication_required" });
        }
        req.scope = createRequestScope({
            adminSupabase: createMemorySupabase({ memories: [] }),
            ...accountFixture(USER_ID, COMPANION_ID, "owner@example.test", "owner")
        });
        next();
    });
    app2.get("/api/v2/agents-md/status", createAgentsMdStatusHandler({
        getSettings: async () => ({})
    }));
    const server2 = await listen(app2);
    const res2 = await request(server2, "/api/v2/agents-md/status", "t");
    const body2 = JSON.parse(res2.body);
    ok(body2.applied === false && body2.chars === 0, "空用户 applied=false chars=0");
    ok(body2.sources.memories === 0, "空用户记忆 0 条");
    server2.close();
    server.close();

    console.log("PASS:", passed, "FAIL:", failed);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error("TEST CRASH:", error);
    process.exit(1);
});
