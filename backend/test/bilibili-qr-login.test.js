"use strict";

const assert = require("node:assert");
const test = require("node:test");
const { createHash } = require("node:crypto");
const {
    createBilibiliQrLoginService,
    deriveMixinKey,
    md5Hex,
    wbiKeyFromUrl,
    wbiSignedQuery
} = require("../services/bilibili-qr-login");

const IMG_URL = "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png";
const SUB_URL = "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png";

test("md5Hex matches a known vector", () => {
    assert.equal(md5Hex("abc"), "900150983cd24fb0d6963f7d28e17f72");
});

test("wbiKeyFromUrl extracts the 32-hex key", () => {
    assert.equal(wbiKeyFromUrl(IMG_URL), "7cd084941338484aae1ad9425b84077c");
    assert.equal(wbiKeyFromUrl("no-key"), "");
});

test("deriveMixinKey returns a deterministic 32-char hex key", () => {
    const mixin = deriveMixinKey(IMG_URL, SUB_URL);
    assert.match(mixin, /^[0-9a-f]{32}$/);
    assert.equal(mixin, deriveMixinKey(IMG_URL, SUB_URL));
    assert.equal(deriveMixinKey("bad", SUB_URL), "");
});

test("wbiSignedQuery sorts keys and signs with md5(query + mixinKey)", () => {
    const mixin = deriveMixinKey(IMG_URL, SUB_URL);
    const query = wbiSignedQuery({ up_mid: "12345", x: "1" }, mixin);
    const parts = new URLSearchParams(query);
    assert.equal(parts.get("up_mid"), "12345");
    assert.equal(parts.get("x"), "1");
    assert.ok(parts.get("wts"), "wts must be present");
    assert.ok(parts.get("w_rid"), "w_rid must be present");
    const unsigned = query.replace(/&w_rid=[0-9a-f]{32}$/, "");
    assert.equal(
        parts.get("w_rid"),
        createHash("md5").update(unsigned + mixin, "utf8").digest("hex"),
        "w_rid must be md5(sorted query + mixinKey)"
    );
});

const KEY = "9f6d7c2b-4a5e-4b6d-8c7f-000000000001";

test("homepage recommendations use the active tenant cookie, signed query and precise failure", async () => {
    const { encryptCredential } = require("../services/mcp-device-center");
    const env = { MCP_ENCRYPTION_KEY: "fixture-private-key-for-test-only-12345678" };
    const cookies = { "alice/ca": encryptCredential("SESSDATA=fictional-alice", env), "bob/cb": encryptCredential("SESSDATA=fictional-bob", env) };
    let failed = false;
    const selected = {};
    const chain = { select() { return chain; }, eq(name, value) { selected[name] = value; return chain; }, async maybeSingle() { const cookie = cookies[selected.user_id + "/" + selected.companion_id]; return { data: cookie ? { cookie_ciphertext: cookie } : null, error: null }; } };
    const received = [];
    const service = createBilibiliQrLoginService({ env, database: { from: () => chain }, fetchImpl: async (url, options) => {
        received.push({ url, cookie: options.headers.Cookie });
        const data = url.includes("/nav") ? { code: 0, data: { isLogin: true, mid: "123", wbi_img: { img_url: IMG_URL, sub_url: SUB_URL } } } : failed ? { code: -352 } : { code: 0, data: { item: [{ bvid: "BV1234567890", title: "虚构推荐", goto: "av", owner: { name: "虚构作者" } }, { bvid: "BV1234567890", title: "重复" }, { bvid: "malformed", uri: "https://evil.test" }] } };
        return { status: 200, headers: { getSetCookie: () => [] }, text: async () => JSON.stringify(data) };
    } });
    const result = await service.recommendations({ userId: "alice", companionId: "ca" }, 6);
    assert.equal(result.source, "bilibili_homepage"); assert.equal(result.videos.length, 1);
    assert.equal(result.videos[0].page_url, "https://www.bilibili.com/video/BV1234567890");
    assert.ok(received.every(item => item.cookie === "SESSDATA=fictional-alice"));
    assert.ok(received.find(item => item.url.includes("/rcmd?")).url.includes("w_rid="));
    received.length = 0;
    await service.recommendations({ userId: "bob", companionId: "cb" }, "invalid");
    assert.ok(received.every(item => item.cookie === "SESSDATA=fictional-bob"));
    await assert.rejects(service.recommendations({ userId: "unknown", companionId: "c" }), error => error.code === "bilibili_qr_not_connected");
    await assert.rejects(service.recommendations({ userId: "alice", companionId: "other" }), error => error.code === "bilibili_qr_not_connected");
    failed = true;
    await assert.rejects(service.recommendations({ userId: "alice", companionId: "ca" }), error => error.code === "bilibili_recommendations_risk_blocked");
});

test("begin returns qr session with content", async () => {
    const fetchImpl = async () => ({
        status: 200,
        text: async () => JSON.stringify({ code: 0, data: { url: "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=" + KEY, qrcode_key: KEY } }),
        headers: { getSetCookie: () => [] }
    });
    const rows = new Map();
    const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows.get("session") || null, error: null }),
        insert: (values) => { rows.set("session", { id: "s1", ...values }); return chain; },
        update: () => chain,
        delete: () => chain,
        single: async () => ({ data: rows.get("session"), error: null })
    };
    const service = createBilibiliQrLoginService({ database: { from: () => chain }, fetchImpl });
    const session = await service.begin({ userId: "u", companionId: "c" });
    assert.equal(session.key, KEY);
    assert.match(session.qr_content, /qrcode_key=/);
    assert.deepEqual(rows.get("session").cookies, [], "begin persists empty jar cookies");
});

test("check maps waiting / scanned / expired", async () => {
    const cases = [[86101, "waiting"], [86090, "scanned"], [86038, "expired"]];
    for (const [code, status] of cases) {
        const fetchImpl = async () => ({
            status: 200,
            text: async () => JSON.stringify({ code, message: "x" }),
            headers: { getSetCookie: () => [] }
        });
        const chain = {
            select: () => chain,
            eq: () => chain,
            maybeSingle: async () => ({ data: null, error: null })
        };
        const service = createBilibiliQrLoginService({ database: { from: () => chain }, fetchImpl });
        const result = await service.check({ userId: "u", companionId: "c" }, KEY);
        assert.equal(result.status, status);
    }
});

test("confirmed check stores encrypted cookie and profile", async () => {
    const sessionRows = new Map();
    const connectionRows = new Map();
    const sessionChain = {
        select: () => sessionChain,
        eq: () => sessionChain,
        maybeSingle: async () => ({ data: sessionRows.get("s") || null, error: null }),
        insert: (values) => { sessionRows.set("s", { id: "s-1", ...values }); return sessionChain; },
        update: () => sessionChain,
        delete: () => { sessionRows.delete("s"); return sessionChain; },
        single: async () => ({ data: sessionRows.get("s"), error: null })
    };
    const connectionChain = {
        select: () => connectionChain,
        eq: () => connectionChain,
        maybeSingle: async () => ({ data: connectionRows.get("c") || null, error: null }),
        insert: (values) => { connectionRows.set("c", { id: "c-1", ...values }); return connectionChain; },
        update: () => connectionChain,
        delete: () => connectionChain,
        single: async () => ({ data: connectionRows.get("c"), error: null })
    };
    const database = { from: (table) => table === "bilibili_qr_connections" ? connectionChain : sessionChain };
    const fetchImpl = async (url) => {
        if (url.includes("/web/qrcode/poll")) {
            return {
                status: 200,
                text: async () => JSON.stringify({ code: 0 }),
                headers: {
                    getSetCookie: () => ["SESSDATA=sess-abc; Path=/", "bili_jct=csrf-1; Path=/"]
                }
            };
        }
        return {
            status: 200,
            text: async () => JSON.stringify({ code: 0, data: { isLogin: true, mid: 12345, uname: "测试用户", face: "https://face.jpg" } }),
            headers: { getSetCookie: () => [] }
        };
    };
    const service = createBilibiliQrLoginService({ database, fetchImpl, env: { MCP_ENCRYPTION_KEY: "x".repeat(48) } });
    const result = await service.check({ userId: "u", companionId: "c" }, KEY);
    assert.equal(result.status, "confirmed");
    assert.equal(result.connection.uid, "12345");
    assert.equal(result.connection.nickname, "测试用户");
    const stored = connectionRows.get("c");
    assert.ok(stored.cookie_ciphertext.startsWith("v1."));
    assert.ok(!stored.cookie_ciphertext.includes("SESSDATA"), "plain cookie must never be stored");
    assert.ok(!sessionRows.has("s"), "qr session jar must be cleared after confirmed");
});

test("favoriteFolders rejects invalid responses", async () => {
    const fetchImpl = async () => ({
        status: 200,
        text: async () => JSON.stringify({ code: -352, message: "risk control" }),
        headers: { getSetCookie: () => [] }
    });
    const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
            data: {
                id: "r1",
                cookie_ciphertext: "v1." + Buffer.from("fake").toString("base64url") + ".AAAA." + Buffer.from("x").toString("base64url")
            },
            error: null
        })
    };
    const service = createBilibiliQrLoginService({ database: { from: () => chain }, fetchImpl, env: { MCP_ENCRYPTION_KEY: "x".repeat(48) } });
    // decrypt will fail because ciphertext is fake -> session_expired before the API call
    await assert.rejects(
        () => service.favoriteFolders({ userId: "u", companionId: "c" }),
        (error) => error.code === "bilibili_qr_session_expired"
    );
});
