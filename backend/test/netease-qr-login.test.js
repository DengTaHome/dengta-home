"use strict";

const assert = require("node:assert");
const test = require("node:test");
const { createRequestScope } = require("../services/request-scope");
const {
    cookieHeader,
    csrfFromCookie,
    parseSetCookies,
    weapiParams
} = require("../services/netease-weapi");
const {
    createNeteaseQrLoginService,
    normalizeTrack
} = require("../services/netease-qr-login");

test("weapiParams produces base64 params and 256-hex encSecKey", () => {
    const payload = { type: "1", noCheckToken: true };
    const first = weapiParams(payload);
    assert.match(first.params, /^[A-Za-z0-9+/=]+$/);
    assert.match(first.encSecKey, /^[0-9a-f]{256}$/);
    const second = weapiParams(payload);
    assert.notEqual(first.params, second.params, "each call uses a fresh secret key");
});

test("csrfFromCookie reads __csrf", () => {
    assert.equal(csrfFromCookie("MUSIC_U=abc; __csrf=hello%20world; os=pc"), "hello world");
    assert.equal(csrfFromCookie("MUSIC_U=abc"), "");
});

test("parseSetCookies and cookieHeader round-trip", () => {
    const cookies = parseSetCookies([
        "MUSIC_U=abcd; Max-Age=1296000; Path=/; HttpOnly",
        "__csrf=xyz; Path=/"
    ]);
    assert.equal(cookies.length, 2);
    assert.equal(cookieHeader(cookies), "MUSIC_U=abcd; __csrf=xyz");
});

test("normalizeTrack maps artists and duration", () => {
    const track = normalizeTrack({
        id: "123456",
        name: "测试歌",
        ar: [{ name: "甲" }, { name: "乙" }],
        al: { name: "专辑" },
        dt: 245000
    });
    assert.deepEqual(track, {
        provider_track_id: "123456",
        title: "测试歌",
        artist: "甲 / 乙",
        album: "专辑",
        cover_url: "",
        duration_seconds: 245
    });
    assert.equal(normalizeTrack({ id: "abc" }), null);
});

test("begin returns qr session with unikey", async () => {
    const fetchImpl = async () => ({
        status: 200,
        text: async () => JSON.stringify({ code: 200, unikey: "unikey-12345678" }),
        headers: { getSetCookie: () => [] }
    });
    const service = createNeteaseQrLoginService({ database: { from: () => { throw new Error("unused"); } }, fetchImpl });
    const session = await service.begin();
    assert.equal(session.key, "unikey-12345678");
    const qrUrl = new URL(session.qr_content);
    const loginUrl = new URL(session.login_url);
    assert.equal(qrUrl.searchParams.get("codekey"), session.key);
    assert.match(qrUrl.searchParams.get("chainId"), /^v1_[a-f0-9]{32}_web_login_\d+$/);
    assert.equal(loginUrl.protocol, "https:");
    assert.equal(loginUrl.search, qrUrl.search);
});

test("check maps waiting / scanned / expired", async () => {
    const codes = [801, 802, 800];
    for (const code of codes) {
        const fetchImpl = async () => ({
            status: 200,
            text: async () => JSON.stringify({ code, message: "ok" }),
            headers: { getSetCookie: () => [] }
        });
        const service = createNeteaseQrLoginService({ database: { from: () => { throw new Error("unused"); } }, fetchImpl });
        const result = await service.check({ userId: "u", companionId: "c" }, "key-12345678");
        assert.equal(result.status, code === 801 ? "waiting" : code === 802 ? "scanned" : "expired");
    }
});

test("check rejects invalid keys", async () => {
    const service = createNeteaseQrLoginService({ database: { from: () => { throw new Error("unused"); } } });
    await assert.rejects(
        () => service.check({ userId: "u", companionId: "c" }, "<script>"),
        (error) => error.code === "netease_qr_key_invalid"
    );
});

test("confirmed check stores an encrypted cookie", async () => {
    const rows = new Map();
    const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: (values) => {
            rows.set("row", { id: "row-1", ...values });
            return chain;
        },
        single: async () => ({ data: rows.get("row"), error: null })
    };
    const database = { from: () => chain };
    const fetchImpl = async (url, options) => {
        if (url.includes("/weapi/login/qrcode/client/login")) {
            return {
                status: 200,
                text: async () => JSON.stringify({ code: 803, message: "授权登录成功" }),
                headers: {
                    getSetCookie: () => ["MUSIC_U=token-abc; Path=/", "__csrf=csrf-1; Path=/"]
                }
            };
        }
        return {
            status: 200,
            text: async () => JSON.stringify({ profile: { userId: 42, nickname: "测试用户" } }),
            headers: { getSetCookie: () => [] }
        };
    };
    const service = createNeteaseQrLoginService({ database, fetchImpl, env: { MCP_ENCRYPTION_KEY: "x".repeat(48) } });
    const result = await service.check({ userId: "u", companionId: "c" }, "key-12345678");
    assert.equal(result.status, "confirmed");
    assert.equal(result.connection.uid, "42");
    assert.equal(result.connection.nickname, "测试用户");
    const stored = rows.get("row");
    assert.ok(stored.cookie_ciphertext.startsWith("v1."), "cookie must be stored encrypted");
    assert.ok(!stored.cookie_ciphertext.includes("MUSIC_U"), "plain cookie must never be stored");
});

test("status without connection returns disconnected", async () => {
    const database = {
        from: () => ({
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) })
        })
    };
    const service = createNeteaseQrLoginService({ database, env: { MCP_ENCRYPTION_KEY: "x".repeat(48) } });
    const result = await service.status({ userId: "u", companionId: "c" });
    assert.deepEqual(result, { connected: false });
});

function scopedQrFixture() {
    const rows = [];
    const ledger = [];
    let providerUid = "42";
    const userId = "11111111-1111-4111-8111-111111111111";
    const companionId = "22222222-2222-4222-8222-222222222222";
    const otherUserId = "33333333-3333-4333-8333-333333333333";
    const otherCompanionId = "44444444-4444-4444-8444-444444444444";
    const database = { from(table) {
        assert.equal(table, "netease_qr_connections");
        const query = { action: "", filters: [], values: null };
        const builder = {
            select() { query.action ||= "select"; return builder; },
            eq(key, value) { query.filters.push([key, value]); return builder; },
            insert(values) { query.action = "insert"; query.values = { ...values }; return builder; },
            update(values) { query.action = "update"; query.values = { ...values }; return builder; },
            delete() { query.action = "delete"; return builder; },
            maybeSingle: async () => finish(), single: async () => finish(),
            then(resolve, reject) { return Promise.resolve(finish()).then(resolve, reject); }
        };
        function finish() {
            ledger.push(query);
            const index = rows.findIndex(row => query.filters.every(([key, value]) => row[key] === value));
            if (query.action === "insert") {
                const row = { id: `fictional-row-${rows.length + 1}`, ...query.values };
                rows.push(row);
                return { data: { ...row }, error: null };
            }
            if (query.action === "update" && index >= 0) Object.assign(rows[index], query.values);
            if (query.action === "delete" && index >= 0) rows.splice(index, 1);
            return { data: query.action === "delete" || index < 0 ? null : { ...rows[index] }, error: null };
        }
        return builder;
    } };
    const scopeFor = (user = userId, companion = companionId) => {
        const selected = { id: companion, user_id: user, status: "active" };
        return createRequestScope({ adminSupabase: database, user: { id: user }, profile: { id: user, status: "active", role: "member" }, companions: [selected], companion: selected });
    };
    const service = createNeteaseQrLoginService({ database, env: { MCP_ENCRYPTION_KEY: "FICTIONAL_ONLY".padEnd(48, "x") }, fetchImpl: async url => {
        if (url.endsWith("/weapi/login/qrcode/client/login")) return {
            status: 200, text: async () => JSON.stringify({ code: 803 }),
            headers: { getSetCookie: () => ["MUSIC_U=fictional-cookie-only; Path=/"] }
        };
        assert(url.endsWith("/weapi/w/nuser/account/get"));
        return { status: 200, text: async () => JSON.stringify({ code: 200, profile: { userId: providerUid, nickname: "虚构名称" } }), headers: { getSetCookie: () => [] } };
    } });
    return { rows, ledger, service, scopeFor, userId, companionId, otherUserId, otherCompanionId, setUid: value => { providerUid = value; } };
}

test("real RequestScope QR confirmed insert/update, status and disconnect retain tenant ownership", async () => {
    const fixture = scopedQrFixture();
    const own = fixture.scopeFor();
    const otherAccount = fixture.scopeFor(fixture.otherUserId, fixture.otherCompanionId);
    const otherCompanion = fixture.scopeFor(fixture.userId, fixture.otherCompanionId);
    assert.equal(own.db.from("netease_qr_connections").upsert, undefined);
    assert.deepEqual(await fixture.service.status(own), { connected: false });
    fixture.setUid("88");
    assert.equal((await fixture.service.check(otherAccount, "fictional-qr-key-b")).status, "confirmed");
    fixture.setUid("99");
    assert.equal((await fixture.service.check(otherCompanion, "fictional-qr-key-c")).status, "confirmed");
    const foreignBefore = structuredClone(fixture.rows);
    assert.deepEqual(await fixture.service.status(own), { connected: false }, "other account and companion connections must not be borrowed");
    fixture.setUid("42");
    const inserted = await fixture.service.check(own, "fictional-qr-key-a");
    assert.equal(inserted.status, "confirmed");
    assert.equal(inserted.connection.uid, "42");
    assert.equal(fixture.rows.length, 3);
    const ownRow = fixture.rows.find(row => row.user_id === fixture.userId && row.companion_id === fixture.companionId);
    assert(ownRow.cookie_ciphertext.startsWith("v1."));
    assert(!ownRow.cookie_ciphertext.includes("fictional-cookie-only"));
    assert.deepEqual(fixture.rows.slice(0, 2), foreignBefore);
    fixture.setUid("43");
    const updated = await fixture.service.check(own, "fictional-qr-key-a");
    assert.equal(updated.connection.uid, "43");
    assert.equal(fixture.rows.length, 3, "an existing own connection is updated rather than duplicated");
    assert.equal((await fixture.service.status(own)).connected, true);
    assert.deepEqual(fixture.rows.slice(0, 2), foreignBefore);
    assert.deepEqual(await fixture.service.disconnect(own), { disconnected: true });
    assert.deepEqual(fixture.rows, foreignBefore, "disconnect must leave both foreign tenant rows intact");
    assert.deepEqual(await fixture.service.status(own), { connected: false });
    for (const entry of fixture.ledger) {
        if (["select", "update", "delete"].includes(entry.action)) {
            assert(entry.filters.some(([key]) => key === "user_id"));
            assert(entry.filters.some(([key]) => key === "companion_id"));
        }
    }
    for (const entry of fixture.ledger.filter(row => row.action === "update" || row.action === "delete")) {
        assert(entry.filters.some(([key, value]) => key === "id" && value === ownRow.id));
        assert(entry.filters.some(([key, value]) => key === "user_id" && value === fixture.userId));
        assert(entry.filters.some(([key, value]) => key === "companion_id" && value === fixture.companionId));
    }
});

test("real RequestScope QR writes cannot target a foreign row or reassign its ownership", async () => {
    const fixture = scopedQrFixture();
    const own = fixture.scopeFor();
    const foreign = fixture.scopeFor(fixture.otherUserId, fixture.otherCompanionId);
    await fixture.service.check(foreign, "fictional-qr-key-b");
    const before = structuredClone(fixture.rows);
    await own.db.from("netease_qr_connections").update({ user_id: fixture.otherUserId, companion_id: fixture.otherCompanionId, nickname: "forged" }).eq("id", before[0].id).select("*").single();
    await own.db.from("netease_qr_connections").delete().eq("id", before[0].id);
    assert.deepEqual(fixture.rows, before);
    const attempted = fixture.ledger.find(entry => entry.action === "update");
    assert.equal(attempted.values.user_id, fixture.userId);
    assert.equal(attempted.values.companion_id, fixture.companionId);
});
