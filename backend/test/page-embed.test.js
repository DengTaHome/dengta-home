"use strict";

const assert = require("node:assert");
const test = require("node:test");
const {
    bilibiliIdFromUrl,
    resolvePageEmbed
} = require("../services/page-embed");

test("bilibiliIdFromUrl parses BV and av links", () => {
    assert.equal(bilibiliIdFromUrl(new URL("https://www.bilibili.com/video/BV1GJ411x7h7/?spm_id_from=333")), "BV1GJ411x7h7");
    assert.equal(bilibiliIdFromUrl(new URL("https://b23.tv/abcde")), "");
    assert.equal(bilibiliIdFromUrl(new URL("https://www.bilibili.com/video/av170001")), "av170001");
});

test("resolvePageEmbed builds the official bilibili embed player", async () => {
    const fetchImpl = async (url) => {
        if (url.includes("api.bilibili.com")) {
            return {
                ok: true,
                json: async () => ({ code: 0, data: { title: "测试视频", pic: "//i0.hdslb.com/x.jpg" } })
            };
        }
        return { ok: false };
    };
    const lookup = async () => [{ address: "203.107.1.1" }];
    const page = await resolvePageEmbed(
        "https://www.bilibili.com/video/BV1GJ411x7h7/",
        { fetchImpl, lookup }
    );
    assert.equal(page.provider, "bilibili");
    assert.equal(page.title, "测试视频");
    assert.equal(page.poster, "https://i0.hdslb.com/x.jpg");
    assert.match(page.embed_url, /player\.bilibili\.com\/player\.html\?bvid=BV1GJ411x7h7/);
    assert.equal(page.embed_likely_blocked, false);
});

test("resolvePageEmbed flags iqiyi as likely blocked", async () => {
    const lookup = async () => [{ address: "203.107.1.1" }];
    const page = await resolvePageEmbed(
        "https://www.iqiyi.com/v_19rr1abcde.html",
        { fetchImpl: async () => ({ ok: false }), lookup }
    );
    assert.equal(page.provider, "iqiyi");
    assert.equal(page.embed_likely_blocked, true);
});

test("resolvePageEmbed rejects private hosts", async () => {
    const lookup = async () => [{ address: "192.168.1.10" }];
    await assert.rejects(
        () => resolvePageEmbed("https://example.com/watch", { fetchImpl: async () => ({}), lookup }),
        (error) => error.code === "co_watch_page_url_invalid"
    );
});

test("resolvePageEmbed rejects non-https and credential links", async () => {
    const lookup = async () => [{ address: "203.107.1.1" }];
    await assert.rejects(
        () => resolvePageEmbed("http://www.bilibili.com/video/BV1GJ411x7h7/", { fetchImpl: async () => ({}), lookup }),
        (error) => error.code === "co_watch_page_url_invalid"
    );
    await assert.rejects(
        () => resolvePageEmbed("https://user:pass@example.com/watch", { fetchImpl: async () => ({}), lookup }),
        (error) => error.code === "co_watch_page_url_invalid"
    );
});

test("generic public page is accepted as web_page", async () => {
    const lookup = async () => [{ address: "203.107.1.1" }];
    const page = await resolvePageEmbed("https://example.com/watch", { fetchImpl: async () => ({}), lookup });
    assert.equal(page.provider, "web_page");
    assert.equal(page.embed_url, "https://example.com/watch");
});
