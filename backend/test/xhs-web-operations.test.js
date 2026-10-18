const test = require("node:test"), assert = require("node:assert/strict");
const { createXhsWebOperations, safeImage, noteLink } = require("../services/xhs-web-operations");
const { startWorker } = require("../scripts/xhs-profile-worker");
const { createBrowserProfileFactory } = require("../services/xhs-profile-gateway");
const note = "111111111111111111111111";
test("webpage results retain only official source links and supported public image hosts", () => {
    assert.deepEqual(noteLink(`/search_result/${note}?xsec_token=fictional-note-token&secret=fictional-private`), { id: note, url: `https://www.xiaohongshu.com/explore/${note}?xsec_token=fictional-note-token` });
    for (const value of [undefined, `https://untrusted.invalid/explore/${note}`, `https://www.xiaohongshu.com.untrusted.invalid/explore/${note}`, `/explore/${note}/more`, `/explore/not-a-note`]) assert.equal(noteLink(value), null);
    assert.equal(safeImage("https://sns-webpic-qc.xhscdn.com/fictional.webp"), "https://sns-webpic-qc.xhscdn.com/fictional.webp");
    for (const value of ["http://sns-webpic-qc.xhscdn.com/pic", "https://127.0.0.1/pic", "https://user:pass@example.test/pic", "https://xhscdn.com.untrusted.invalid/pic", "data:image/png;base64,YQ=="]) assert.equal(safeImage(value), "");
});
test("read-only webpage adapter rejects unsupported pagination before opening a browser", async () => {
    const adapter = createXhsWebOperations(), context = { newPage() { assert.fail("invalid request must not open a page"); } };
    assert.deepEqual(Object.keys(adapter).sort(), ["comments", "loginStart", "loginStatus", "me", "search", "stickerSource"]);
    for (const input of [{ keyword: "" }, { keyword: "虚构~", page: 2 }, { keyword: "虚构", sort: "new" }]) await assert.rejects(adapter.search(context, input), { code: "xhs_search_request_invalid" });
    await assert.rejects(adapter.comments(context, { noteId: "../private" }), { code: "xhs_search_request_invalid" });
    await assert.rejects(adapter.comments(context, { noteId: note }), { code: "xhs_note_lookup_required" });
});
test("worker startup rejects incomplete encryption configuration before starting a browser", async () => {
    let launches = 0;
    await assert.rejects(startWorker({ env: {}, playwright: { chromium: { launch() { launches++; } } } }), { code: "xhs_worker_configuration_required" });
    assert.equal(launches, 0);
});

function searchContext() {
    const state = { cards: [], expired: false };
    const self = { isVisible: async () => true, getAttribute: async () => "/user/profile/aaaaaaaaaaaaaaaaaaaaaaaa" };
    const context = { async newPage() {
        let url = "https://www.xiaohongshu.com/explore";
        return {
            url: () => url,
            async goto(value) { url = value; return { status: () => 200 }; },
            async waitForSelector() {}, async close() {},
            locator(selector) {
                const locator = {
                    filter: () => locator,
                    all: async () => selector.startsWith('a[href*=') ? (state.expired ? [] : [self])
                        : selector.startsWith('.login-container,') && state.expired ? [self] : [],
                    evaluateAll: async () => state.cards
                };
                return locator;
            }
        };
    } };
    return { state, context };
}
const noteId = value => value.toString(16).padStart(24, "0");
function cards(start, length = 1) {
    return Array.from({ length }, (_, i) => ({ href: `/explore/${noteId(start + i)}`, title: `Fixture ${start + i}`,
        author: "Fixture author", image: "https://sns-webpic-qc.xhscdn.com/fixture.webp" }));
}
test("recent sources survive later searches only inside their originating context", async () => {
    const operations = createXhsWebOperations(), a = searchContext(), b = searchContext();
    a.state.cards = cards(1); await operations.search(a.context, { keyword: "first" });
    a.state.cards = cards(2); await operations.search(a.context, { keyword: "second" });
    assert.equal((await operations.stickerSource(a.context, { noteId: noteId(1) })).note_id, noteId(1));
    assert.equal((await operations.stickerSource(a.context, { noteId: noteId(2) })).note_id, noteId(2));
    await assert.rejects(operations.stickerSource(b.context, { noteId: noteId(1) }), { code: "xhs_note_lookup_required" });
});
test("reading a source does not extend its ten-minute lifetime", async () => {
    let time = 0;
    const operations = createXhsWebOperations({ now: () => time }), a = searchContext();
    a.state.cards = cards(1); await operations.search(a.context, { keyword: "first" });
    time = 599999; assert.equal((await operations.stickerSource(a.context, { noteId: noteId(1) })).note_id, noteId(1));
    time = 600000;
    await assert.rejects(operations.stickerSource(a.context, { noteId: noteId(1) }), { code: "xhs_note_lookup_required" });
    await assert.rejects(operations.comments(a.context, { noteId: noteId(1) }), { code: "xhs_note_lookup_required" });
    await operations.search(a.context, { keyword: "first again" });
    assert.equal((await operations.stickerSource(a.context, { noteId: noteId(1) })).note_id, noteId(1));
});
test("a profile keeps at most its one hundred most recently observed sources", async () => {
    const operations = createXhsWebOperations(), a = searchContext();
    for (let batch = 0; batch < 6; batch++) {
        a.state.cards = cards(batch * 20 + 1, 20); await operations.search(a.context, { keyword: `batch ${batch}` });
    }
    await assert.rejects(operations.stickerSource(a.context, { noteId: noteId(20) }), { code: "xhs_note_lookup_required" });
    assert.equal((await operations.stickerSource(a.context, { noteId: noteId(21) })).note_id, noteId(21));
    assert.equal((await operations.stickerSource(a.context, { noteId: noteId(120) })).note_id, noteId(120));
});
test("confirmed login expiry and starting a new login clear old source provenance", async () => {
    const operations = createXhsWebOperations(), a = searchContext();
    a.state.cards = cards(1); await operations.search(a.context, { keyword: "first" });
    a.state.expired = true; await assert.rejects(operations.me(a.context), { code: "cookie_expired" });
    a.state.expired = false;
    await assert.rejects(operations.stickerSource(a.context, { noteId: noteId(1) }), { code: "xhs_note_lookup_required" });
    await operations.search(a.context, { keyword: "first again" });
    assert.equal((await operations.loginStart(a.context)).status, "done");
    await assert.rejects(operations.stickerSource(a.context, { noteId: noteId(1) }), { code: "xhs_note_lookup_required" });
});
test("actual profile logout replaces the context and discards old source access", async () => {
    const operations = createXhsWebOperations();
    let contexts = 0;
    const browser = { async newContext() {
        contexts++;
        const a = searchContext(); a.state.cards = cards(1);
        a.context.close = async () => {};
        return a.context;
    } };
    const profile = await createBrowserProfileFactory({ browser, operations })("fixture-session");
    try {
        await profile.execute("search", { keyword: "first" });
        assert.equal((await profile.execute("stickerSource", { noteId: noteId(1) })).note_id, noteId(1));
        await profile.execute("logout", {});
        assert.equal(contexts, 2);
        await assert.rejects(profile.execute("stickerSource", { noteId: noteId(1) }), { code: "xhs_note_lookup_required" });
    } finally { await profile.close(); }
});
