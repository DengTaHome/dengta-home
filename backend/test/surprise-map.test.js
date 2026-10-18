const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const express = require("express");
const { PGlite } = require("@electric-sql/pglite");
const { createRequestScope } = require("../services/request-scope");
const { createSurpriseMapRouter } = require("../services/surprise-map");
const { generateSurpriseMapDraft } = require("../services/surprise-map-draft");
const userA = "11111111-1111-4111-8111-111111111111", userB = "22222222-2222-4222-8222-222222222222";
const companionA = "33333333-3333-4333-8333-333333333333", companionB = "44444444-4444-4444-8444-444444444444", companionC = "55555555-5555-4555-8555-555555555555";
const time = Date.parse("2026-10-16T00:00:00Z");
const sql = fs.readFileSync(require.resolve("../supabase/drafts/surprise_map.sql"), "utf8");

function client(db) {
    const safe = value => { assert.match(value, /^[a-z_]+$/u); return `"${value}"`; };
    return { from(table) {
        const filters = [], params = []; let action = "select", payload, columns = "*", sort = "", limit = "", one = false;
        const bind = value => { params.push(value); return `$${params.length}`; };
        const query = {
            select(value = "*") { columns = value; return query; },
            insert(value) { action = "insert"; payload = value; return query; },
            update(value) { action = "update"; payload = value; return query; },
            eq(key, value) { filters.push([key, "eq", value]); return query; },
            gte(key, value) { filters.push([key, "gte", value]); return query; },
            in(key, value) { filters.push([key, "in", value]); return query; },
            order(key, options) { sort = ` order by ${safe(key)} ${options?.ascending === false ? "desc" : "asc"}`; return query; },
            limit(value) { assert.ok(Number.isInteger(value) && value >= 0); limit = ` limit ${value}`; return query; },
            single() { one = true; return query; }, maybeSingle() { one = true; return query; },
            then(resolve, reject) {
                const run = async () => {
                    try {
                        const projection = columns === "*" ? "*" : columns.split(",").map(key => safe(key.trim())).join(",");
                        let command;
                        if (action === "insert") {
                            const keys = Object.keys(payload);
                            command = `insert into ${safe(table)} (${keys.map(safe).join(",")}) values (${keys.map(key => bind(payload[key])).join(",")}) returning ${projection}`;
                        } else {
                            const change = action === "update" ? Object.entries(payload).map(([key, value]) => `${safe(key)}=${bind(value)}`).join(",") : "";
                            const where = filters.map(([key, op, value]) => op === "in" ? `${safe(key)} in (${value.map(bind).join(",")})` : `${safe(key)} ${op === "eq" ? "=" : ">="} ${bind(value)}`).join(" and ");
                            command = action === "select" ? `select ${projection} from ${safe(table)}` : `update ${safe(table)} set ${change}`;
                            command += where ? ` where ${where}` : "";
                            command += action === "select" ? sort + limit : ` returning ${projection}`;
                        }
                        const data = (await db.query(command, params)).rows;
                        return { data: one ? data[0] || null : data, error: null };
                    } catch (error) { return { data: null, error }; }
                };
                return run().then(resolve, reject);
            },
        };
        return query;
    } };
}

test("actual map router and SQL isolate private letters, public snapshots and individual claims", { timeout: 30000 }, async () => {
    const db = new PGlite(); let server;
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
          create table companions(user_id uuid not null, id uuid not null, primary key(user_id,id));
          insert into companions values ('${userA}','${companionA}'),('${userB}','${companionB}'),('${userA}','${companionC}');`);
        await db.exec(sql); await db.exec(sql);
        for (const role of ["anon", "authenticated"]) {
            await db.exec(`set role ${role}`);
            for (const table of ["surprise_map_letters", "surprise_map_claims", "surprise_map_publications"]) {
                await assert.rejects(db.query(`select * from ${table}`), error => error.code === "42501");
            }
            await db.exec("reset role");
        }
        const raw = client(db);
        const scope = (user, companion) => createRequestScope({ adminSupabase: raw, user: { id: user }, profile: { id: user, role: "member", status: "active" },
            companions: [{ id: companion, user_id: user, status: "active" }], companion: { id: companion, user_id: user, status: "active" } });
        const scopes = { A: scope(userA, companionA), B: scope(userB, companionB), C: scope(userA, companionC) };
        const app = express(); app.use(express.json()); app.use((req, res, next) => { req.scope = scopes[req.get("x-fixture")]; next(); });
        app.use(createSurpriseMapRouter({ publicationDatabase: raw, now: () => time, random: () => .5,
            draftLetter: async () => ({ title: "虚构来信", body: "星星在等你" }) }));
        server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
        const call = async (method, path, body, who = "A") => {
            const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "Content-Type": "application/json", "x-fixture": who }, body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: response.status, ...(await response.json()) };
        };
        assert.equal((await call("GET", "/letters", undefined, "unknown")).status, 401);
        const position = { latitude: 0, longitude: 0, accuracy: 5, captured_at: new Date(time).toISOString() };
        const create = { ...position, title: "虚构私信", body: "PRIVATE_FICTIONAL_BODY", place_label: "虚构公共公园", radius_m: 100, client_request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
        const made = await call("POST", "/letters", create); assert.equal(made.status, 201);
        const id = made.letter.id;
        assert.equal(made.letter.body, undefined); assert.equal(made.letter.latitude, undefined);
        assert.equal((await call("POST", "/letters", create)).replayed, true);
        assert.equal((await call("POST", "/letters", { ...create, body: "different" })).status, 409);
        assert.equal((await call("POST", "/letters", { ...create, latitude: 1, longitude: 1 })).status, 409);
        assert.equal((await db.query("select count(*)::int as total from surprise_map_letters")).rows[0].total, 1);
        for (const who of ["B", "C"]) {
            assert.deepEqual((await call("GET", "/letters", undefined, who)).letters, []);
            assert.equal((await call("POST", `/letters/${id}/claim`, position, who)).status, 404);
            assert.equal((await call("POST", `/letters/${id}/publish`, {}, who)).status, 404);
        }
        const sealed = await call("GET", "/letters");
        assert.doesNotMatch(JSON.stringify(sealed), /PRIVATE_FICTIONAL_BODY|client_request_id/);
        assert.equal(sealed.letters[0].latitude, undefined); assert.equal(sealed.letters[0].longitude, undefined);
        assert.notDeepEqual(sealed.letters[0].area, { latitude: 0, longitude: 0, radius_m: 100 });
        assert.equal((await call("POST", `/letters/${id}/claim`, { ...position, longitude: 1 })).code, "surprise_map_out_of_range");
        assert.equal((await call("POST", `/letters/${id}/claim`, { ...position, accuracy: 200 })).code, "surprise_map_location_inaccurate");
        assert.equal((await call("POST", `/letters/${id}/claim`, { ...position, captured_at: new Date(time - 130000).toISOString() })).code, "surprise_map_location_stale");
        assert.equal((await call("POST", `/letters/${id}/claim`, position)).letter.body, create.body);
        assert.equal((await call("POST", `/letters/${id}/claim`, {})).already, true);
        const publication = { public_title: "路过的问候", public_text: "PUBLIC_FICTIONAL_BODY", public_place: "虚构广场", public_latitude: 0, public_longitude: 0 };
        assert.equal((await call("POST", `/letters/${id}/publish`, publication)).status, 400);
        const published = await call("POST", `/letters/${id}/publish`, { ...publication, confirm_publication: true });
        assert.equal(published.status, 201); const pubId = published.publication.id;
        const shared = await call("GET", "/public", undefined, "B");
        assert.equal(shared.letters[0].owned, false);
        assert.doesNotMatch(JSON.stringify(shared), /PRIVATE_FICTIONAL_BODY|PUBLIC_FICTIONAL_BODY|user_id|companion_id|claim_latitude|claim_longitude/);
        assert.equal((await call("GET", "/public")).letters[0].owned, true);
        assert.equal((await call("POST", `/public/${pubId}/claim`, position, "B")).letter.body, publication.public_text);
        assert.equal((await call("POST", `/public/${pubId}/claim`, position, "C")).already, false);
        assert.equal((await call("POST", `/public/${pubId}/claim`, {}, "B")).already, true);
        assert.equal((await db.query("select count(*)::int as total from surprise_map_claims")).rows[0].total, 3);
        assert.equal((await call("DELETE", `/public/${pubId}`, undefined, "B")).status, 404);
        assert.equal((await call("DELETE", `/public/${pubId}`)).status, 200);
        assert.deepEqual((await call("GET", "/public", undefined, "B")).letters, []);
        assert.equal((await call("POST", `/public/${pubId}/claim`, {}, "B")).status, 404);
        const draft = await call("POST", "/draft", { place_label: "虚构公园", mood: "开心" });
        assert.equal(draft.draft.body, "星星在等你"); assert.equal(draft.saved, false); assert.equal(draft.published, false);
        assert.equal((await db.query("select count(*)::int as total from surprise_map_letters")).rows[0].total, 1);
    } finally { if (server) await new Promise(resolve => server.close(resolve)); await db.close(); }
});

test("map drafting uses scoped settings and unchanged confirmed memories and performs no write", async () => {
    const settings = { unified_system_prompt: "FICTIONAL_PERSONA", user_details: "FICTIONAL_DETAILS", model: "fixture-model", max_tokens: 5000 };
    const memories = [{ summary: "FICTIONAL_MEMORY", created_at: "2026-10-16", updated_at: "2026-10-16" }];
    const original = JSON.stringify({ settings, memories }); let received;
    const query = { select() { return query; }, eq() { return query; }, order() { return query; }, limit: async () => ({ data: memories }) };
    const database = { from(table) { assert.equal(table, "memories"); return query; } };
    const value = await generateSurpriseMapDraft({ db: database }, { place_label: "虚构公园", mood: "平静" }, {
        getSettings: async db => { assert.equal(db, database); return settings; },
        generateReply: async input => { received = input; return { mode: "custom", text: '{"title":"风来的时候","body":"愿你有一个好心情。"}' }; },
    });
    assert.equal(value.title, "风来的时候"); assert.equal(received.settings.unified_system_prompt, settings.unified_system_prompt);
    assert.equal(received.settings.user_details, settings.user_details); assert.deepEqual(received.memories, memories);
    assert.equal(JSON.stringify({ settings, memories }), original);
    await assert.rejects(generateSurpriseMapDraft({ db: database }, { place_label: "虚构公园" }, {
        getSettings: async () => settings, generateReply: async () => ({ mode: "placeholder", text: "anything" }),
    }));
});
