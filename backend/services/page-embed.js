"use strict";

// Co-watch web-page support: bilibili / iqiyi / generic HTTPS pages.
// Only public hosts are accepted; bilibili resolves to its official embed
// player. No arbitrary URL is fetched — only api.bilibili.com for metadata.

const dns = require("node:dns").promises;
const { isPrivateAddress } = require("./direct-media-url");

const BILIBILI_HOSTS = /(^|\.)(bilibili\.com|b23\.tv)$/i;
const IQIYI_HOSTS = /(^|\.)(iqiyi\.com|71\.am|iq\.com)$/i;
const BILIBILI_BV = /^BV[0-9A-Za-z]{10}$/;
const BILIBILI_AV = /^av\d{1,20}$/i;
const IQIYI_VID = /(?:\/|_)([0-9a-f]{20,}|[a-z0-9]{32})\.html/i;
const BILIBILI_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

async function validateCoWatchPageUrl(value, { lookup = dns.lookup } = {}) {
    let url;
    try {
        url = new URL(String(value || "").trim());
    } catch {
        throw requestError(400, "co_watch_page_url_invalid", "网页链接格式不正确。");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
        throw requestError(400, "co_watch_page_url_invalid", "只支持公开 HTTPS 网页链接。");
    }
    const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw requestError(400, "co_watch_page_url_invalid", "不能打开本机、局域网或私有 IP 的网页。");
    }
    return url.toString();
}

function bilibiliIdFromUrl(url) {
    const path = String(url.pathname || "");
    const videoMatch = path.match(/\/video\/(BV[0-9A-Za-z]{10}|av\d{1,20})/i);
    if (videoMatch) return videoMatch[1];
    const bvid = url.searchParams.get("bvid");
    if (bvid && BILIBILI_BV.test(bvid)) return bvid;
    const aid = url.searchParams.get("aid") || url.searchParams.get("av");
    if (aid && BILIBILI_AV.test("av" + aid)) return "av" + aid;
    return "";
}

async function resolveBilibiliId(value, fetchImpl) {
    let url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host === "b23.tv" || host.endsWith(".b23.tv")) {
        for (let redirects = 0; redirects < 5; redirects += 1) {
            let response;
            try {
                response = await fetchImpl(url.href, {
                    method: "GET",
                    redirect: "manual",
                    headers: { "User-Agent": BILIBILI_USER_AGENT },
                    signal: AbortSignal.timeout(6000)
                });
            } catch {
                throw requestError(400, "co_watch_bilibili_link_unavailable", "哔哩哔哩短链暂时无法展开，请粘贴完整视频链接。");
            }
            const location = response.headers.get("location");
            if (!location) break;
            url = new URL(location, url);
            const nextHost = url.hostname.toLowerCase().replace(/\.$/, "");
            if (!(nextHost === "b23.tv" || nextHost.endsWith(".b23.tv") || nextHost === "bilibili.com" || nextHost.endsWith(".bilibili.com"))) {
                throw requestError(400, "co_watch_bilibili_link_invalid_redirect", "哔哩哔哩短链跳转到了非官方地址，已停止。");
            }
        }
    }
    const id = bilibiliIdFromUrl(url);
    if (!id) {
        throw requestError(400, "co_watch_bilibili_id_invalid", "没有在链接里找到哔哩哔哩视频编号（BV/av）。");
    }
    return id;
}

async function fetchBilibiliView(id, fetchImpl) {
    try {
        const query = BILIBILI_BV.test(id) ? `bvid=${id}` : `aid=${id.replace(/^av/i, "")}`;
        const response = await fetchImpl(`https://api.bilibili.com/x/web-interface/view?${query}`, {
            method: "GET",
            headers: {
                "User-Agent": BILIBILI_USER_AGENT,
                Referer: "https://www.bilibili.com/"
            },
            signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) return { title: "", pic: "" };
        const json = await response.json().catch(() => ({}));
        if (Number(json?.code) !== 0 || !json?.data) return { title: "", pic: "" };
        const pic = String(json.data.pic || "");
        return {
            title: String(json.data.title || "").slice(0, 180),
            pic: pic.startsWith("//") ? `https:${pic}` : pic.startsWith("http") ? pic : ""
        };
    } catch {
        return { title: "", pic: "" };
    }
}

function iqiyiVid(url) {
    const match = String(url.pathname || "").match(IQIYI_VID);
    return match ? match[1] : "";
}

async function resolvePageEmbed(value, { fetchImpl = globalThis.fetch, lookup = dns.lookup } = {}) {
    const pageUrl = await validateCoWatchPageUrl(value, { lookup });
    const url = new URL(pageUrl);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");

    if (BILIBILI_HOSTS.test(host)) {
        const id = await resolveBilibiliId(pageUrl, fetchImpl);
        const info = await fetchBilibiliView(id, fetchImpl);
        return {
            provider: "bilibili",
            page_url: pageUrl,
            bvid: id,
            embed_url: `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(id)}&page=1&danmaku=0&autoplay=0`,
            title: info.title,
            poster: info.pic,
            embed_likely_blocked: false,
            message: info.title
                ? `已解析：《${info.title}》。可以在 DengTa 里一起看了。`
                : "哔哩哔哩播放器已就绪，可以在 DengTa 里一起看。"
        };
    }

    if (IQIYI_HOSTS.test(host)) {
        void iqiyiVid(url);
        return {
            provider: "iqiyi",
            page_url: pageUrl,
            embed_url: pageUrl,
            title: "",
            poster: "",
            embed_likely_blocked: true,
            message: "已载入爱奇艺官方页面。DengTa 不做任何内嵌限制，若该网站自身不支持外部内嵌导致画面空白，可改用视频直链或哔哩哔哩链接。"
        };
    }

    return {
        provider: "web_page",
        page_url: pageUrl,
        embed_url: pageUrl,
        title: "",
        poster: "",
        embed_likely_blocked: true,
        message: "已载入网页。DengTa 不做任何内嵌限制，若该网站自身不支持外部内嵌导致画面空白，可改用视频直链。"
    };
}

module.exports = {
    bilibiliIdFromUrl,
    resolvePageEmbed,
    validateCoWatchPageUrl
};
