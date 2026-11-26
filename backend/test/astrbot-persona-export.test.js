const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createRequestScope } = require("../services/request-scope");
const { createAstrBotPersonaRouter } = require("../services/astrbot-persona-export");

test("AstrBot persona export uses the authenticated account and selected companion", async (t) => {
    const records = [
        { user_id: "me", companion_id: "current", ai_name: "Current", prompt_mode: "unified", unified_system_prompt: "  hello\n你好  ", system_prompt: "ignored", user_details: "Private details" },
        { user_id: "me", companion_id: "other", unified_system_prompt: "Wrong companion" },
        { user_id: "other", companion_id: "current", unified_system_prompt: "Wrong account" },
    ];
    let selectedFields;
    const database = {
        from(table) {
            assert.equal(table, "settings");
            const filters = [];
            const query = {
                select(fields) { selectedFields = fields.split(","); return query; },
                eq(field, value) { filters.push([field, value]); return query; },
                order() { return query; },
                limit() { return query; },
                async maybeSingle() {
                    const matches = records.filter((row) => filters.every(([key, value]) => row[key] === value));
                    assert.equal(matches.length, 1);
                    return { data: Object.fromEntries(selectedFields.map((field) => [field, matches[0][field]])) };
                },
            };
            return query;
        }
    };
    const app = express();
    app.use((req, _res, next) => {
        if (req.get("authorization") === "Bearer fixture") {
            const companion = { id: "current", user_id: "me", status: "active" };
            req.scope = createRequestScope({
                adminSupabase: database, user: { id: "me" }, profile: { id: "me", role: "owner", status: "active" },
                companions: [companion], companion,
            });
        }
        next();
    });
    app.use("/settings/astrbot-persona", createAstrBotPersonaRouter());
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
    const server = await new Promise((resolve) => {
        const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const endpoint = `http://127.0.0.1:${server.address().port}/settings/astrbot-persona`;
    assert.equal((await fetch(endpoint)).status, 401);
    const headers = { authorization: "Bearer fixture" };
    const normal = await fetch(endpoint + "?companion_id=other&user_id=other", { headers });
    assert.equal(normal.status, 200);
    assert.equal(normal.headers.get("cache-control"), "private, no-store");
    assert.deepEqual((await normal.json()).persona, { unified_system_prompt: "  hello\n你好  " });
    assert.ok(!selectedFields.includes("user_details"));
    const opted = await fetch(endpoint + "?include_user_details=true", { headers });
    assert.equal((await opted.json()).persona.user_details, "Private details");
});
