const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path");
const { createXhsProfileGateway, createBrowserProfileFactory } = require("../services/xhs-profile-gateway");
const { createEncryptedXhsProfileStore } = require("../services/xhs-profile-store");
const sessions = ["a".repeat(64), "b".repeat(64)], token = "fictional-gateway-service-token-for-tests-only";
const start = app => new Promise(resolve => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function client(server, session = sessions[0], key = token) {
    return (route, options = {}) => fetch(`http://127.0.0.1:${server.address().port}` + route, { ...options, headers: { "x-api-key": key, "x-dengta-isolation": "profile-v1", "x-dengta-session": session, "Content-Type": "application/json", ...options.headers } });
}

test("gateway serializes one profile, runs different profiles independently and rejects unauthenticated access", async () => {
    const first = deferred(), calls = [], profiles = [];
    const gateway = createXhsProfileGateway({ token, createProfile: async session => {
        const profile = { async execute(operation, input) { calls.push([session, operation]); if (input.keyword === "wait") await first.promise; return { items: [session] }; }, async importCookie() {}, async close() {} };
        profiles.push(profile); return profile;
    } });
    const server = await start(gateway.app);
    try {
        const a = client(server), b = client(server, sessions[1]);
        assert.equal((await client(server, sessions[0], "wrong")("/me")).status, 403); assert.equal(profiles.length, 0);
        const waiting = a("/search?keyword=wait");
        for (let i = 0; i < 50 && !calls.length; i++) await new Promise(resolve => setTimeout(resolve, 2));
        const queued = a("/me"); const independent = await b("/me");
        assert.equal(independent.headers.get("x-dengta-session"), sessions[1]);
        assert.deepEqual((await independent.json()).items, [sessions[1]]); assert.equal(calls.filter(item => item[0] === sessions[0]).length, 1);
        first.resolve(); assert.equal((await waiting).status, 200); assert.equal((await queued).status, 200); assert.equal(profiles.length, 2);
    } finally { first.resolve(); await new Promise(resolve => server.close(resolve)); await gateway.close(); }
});

test("hung profile work times out and a fresh profile can recover without closing another user's profile", async () => {
    let created = 0, closed = 0;
    const gateway = createXhsProfileGateway({ token, timeoutMs: 20, createProfile: async () => { const id = ++created; return { execute: async () => id === 1 ? new Promise(() => {}) : { items: [id] }, close: async () => { closed++; } }; } });
    const server = await start(gateway.app);
    try {
        const request = client(server); const failure = await request("/me"); assert.equal(failure.status, 504); assert.equal((await failure.json()).error, "xhs_timeout");
        const recovered = await request("/me"); assert.equal(recovered.status, 200); assert.deepEqual((await recovered.json()).items, [2]); assert.equal(closed, 1);
    } finally { await new Promise(resolve => server.close(resolve)); await gateway.close(); }
});

test("a timed-out session waits for its old snapshot to close before reopening", async () => {
    const disposal = deferred(); let created = 0, closing = false;
    const gateway = createXhsProfileGateway({ token, timeoutMs: 150, createProfile: async () => {
        const id = ++created;
        return { execute: async () => id === 1 ? new Promise(() => {}) : { id }, close: async () => { if (id === 1) { closing = true; await disposal.promise; } } };
    } });
    const server = await start(gateway.app);
    try {
        assert.equal((await client(server)("/me")).status, 504);
        assert.equal(closing, true);
        const reopened = client(server)("/me");
        await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(created, 1);
        disposal.resolve(); assert.equal((await reopened).status, 200); assert.equal(created, 2);
    } finally { disposal.resolve(); await new Promise(resolve => server.close(resolve)); await gateway.close(); }
});

test("browser profile factory separates contexts and logout clears all origin state without reviving the saved cookie", async () => {
    const saved = new Map(), contexts = [];
    const browser = { async newContext(options = {}) {
        const context = { state: structuredClone(options.storageState || { cookies: [], origins: [] }), closed: false,
            async storageState() { return structuredClone(this.state); }, async clearCookies() { this.state.cookies = []; }, async addCookies(cookies) { this.state.cookies = structuredClone(cookies); }, async close() { this.closed = true; } };
        contexts.push(context); return context;
    } };
    const factory = createBrowserProfileFactory({ browser, store: { read: async key => saved.get(key), write: async (key, value) => saved.set(key, structuredClone(value)) }, operations: { me: async context => ({ cookies: (await context.storageState()).cookies.map(cookie => cookie.value) }) } });
    const a = await factory(sessions[0]), b = await factory(sessions[1]);
    await a.importCookie("a1=fictional-a"); await b.importCookie("a1=fictional-b");
    assert.deepEqual((await a.execute("me", {})).cookies, ["fictional-a"]); assert.deepEqual((await b.execute("me", {})).cookies, ["fictional-b"]);
    contexts[2].state.origins = [{ origin: "https://www.xiaohongshu.com", localStorage: [{ name: "fixture", value: "old-login" }] }];
    await a.execute("logout", {}); await a.importCookie("a1=fictional-a");
    assert.deepEqual((await a.execute("me", {})).cookies, []); assert.deepEqual(contexts.at(-1).state.origins, []);
    await a.close(); await b.close();
    const reopened = await factory(sessions[0]); await reopened.importCookie("a1=fictional-a"); assert.deepEqual((await reopened.execute("me", {})).cookies, []); await reopened.close();
});

test("encrypted browser snapshots retain raw values privately, bind ciphertext to its profile and preserve corrupt files", async () => {
    const root = require("node:os").tmpdir();
    const directory = await fs.mkdtemp(path.join(root, "profile-store-test-"));
    assert.ok(directory.startsWith(root + path.sep));
    const store = createEncryptedXhsProfileStore({ directory, secret: token });
    const value = { browserState: { cookies: [{ name: "a1", value: "fictional-private-cookie" }], origins: [] }, cookieHash: "fixture" };
    try {
        assert.equal(await store.read(sessions[0]), null); await store.write(sessions[0], value); assert.deepEqual(await store.read(sessions[0]), value);
        const original = await fs.readFile(path.join(directory, sessions[0] + ".json"), "utf8"); assert.ok(!original.includes("fictional-private-cookie"));
        await fs.writeFile(path.join(directory, sessions[1] + ".json"), original);
        await assert.rejects(store.read(sessions[1]), { code: "xhs_profile_storage_failed" });
        assert.equal(await fs.readFile(path.join(directory, sessions[1] + ".json"), "utf8"), original);
        await assert.rejects(store.write("../other", value), { code: "xhs_profile_storage_failed" });
    } finally {
        for (const name of await fs.readdir(directory)) { assert.match(name, /^[a-f0-9]{64}\.json$/); await fs.unlink(path.join(directory, name)); }
        await fs.rmdir(directory);
    }
});
