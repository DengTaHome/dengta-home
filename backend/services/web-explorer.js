"use strict";

// 网络探索工具箱:网页阅读(Jina)/RSS/V2EX/B站搜索与字幕/Exa 语义搜索。

const { createHash } = require("node:crypto");

const WBI_MIXIN_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5,
    49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55,
    40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57,
    62, 11, 36, 20, 34, 44, 52
];

function wbiSignedQuery(params, mixinKey) {
    const signed = { ...params, wts: String(Math.floor(Date.now() / 1000)) };
    const query = Object.keys(signed)
        .sort()
        .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(String(signed[key])))
        .join("&");
    const wRid = createHash("md5").update(query + mixinKey, "utf8").digest("hex");
    return query + "&w_rid=" + wRid;
}

async function deriveWbiMixinKey(fetcher) {
    try {
        const response = await fetcher("https://api.bilibili.com/x/web-interface/nav", {
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        const json = await response.json().catch(() => null);
        const img = String(json?.data?.wbi_img?.img_url || "");
        const sub = String(json?.data?.wbi_img?.sub_url || "");
        const key1 = (img.match(/\/([0-9a-f]{32})\./) || [])[1] || "";
        const key2 = (sub.match(/\/([0-9a-f]{32})\./) || [])[1] || "";
        if (key1.length !== 32 || key2.length !== 32) return "";
        return WBI_MIXIN_TAB.map((index) => (key1 + key2)[index]).join("").slice(0, 32);
    } catch {
        return "";
    }
}

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function cleanText(value, maximum) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
        .slice(0, maximum)
        .join("");
}

function stripTags(value) {
    return String(value ?? "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, String.fromCharCode(39))
        .replace(/\s+/g, " ")
        .trim();
}

const URL_PATTERN = /^https?:\/\//i;
const BVID_PATTERN = /^BV[0-9A-Za-z]{6,12}$/i;

function createWebExplorer({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
    const fetcher = fetchImpl;

    async function fetchText(url, options = {}, timeoutMs = 30000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetcher(url, { ...options, signal: controller.signal });
            if (!response.ok) {
                throw requestError(502, "explorer_upstream_error", "目标服务返回 " + response.status + "。");
            }
            return await response.text();
        } catch (error) {
            if (error?.code) throw error;
            throw requestError(502, "explorer_unreachable", "目标服务暂时无法访问。");
        } finally {
            clearTimeout(timer);
        }
    }

    async function webRead(url) {
        const target = String(url || "").trim();
        if (!URL_PATTERN.test(target)) {
            throw requestError(400, "explorer_url_invalid", "请提供以 http(s):// 开头的链接。");
        }
        const text = await fetchText("https://r.jina.ai/" + target, {}, 45000);
        return { url: target, text: cleanText(text, 8000) };
    }

    async function rssRead(url, limit = 10) {
        const target = String(url || "").trim();
        if (!URL_PATTERN.test(target)) {
            throw requestError(400, "explorer_url_invalid", "请提供以 http(s):// 开头的 RSS 链接。");
        }
        const xml = await fetchText(target, {}, 30000);
        const max = Math.min(20, Math.max(1, Number(limit) || 10));
        const items = [];
        const matcher = /<item[\s>][\s\S]*?<\/item>/gi;
        let match;
        while ((match = matcher.exec(xml)) !== null && items.length < max) {
            const block = match[0];
            const grab = (tag) => {
                const found = block.match(new RegExp("<" + tag + "[^>]*>([\s\S]*?)<\/" + tag + ">", "i"));
                return found ? stripTags(found[1]).slice(0, 300) : "";
            };
            const title = grab("title");
            const linkMatch = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
            const link = (linkMatch ? linkMatch[1] : "").trim();
            if (!title) continue;
            items.push({ title, link, pub_date: grab("pubDate"), description: grab("description") });
        }
        if (items.length === 0) {
            throw requestError(400, "explorer_rss_empty", "没有从这个源里读到条目，链接可能不是 RSS。");
        }
        return { url: target, items };
    }

    async function v2exHot() {
        const json = JSON.parse(await fetchText("https://www.v2ex.com/api/topics/hot.json", { headers: { "User-Agent": "DengTa/1.0" } }));
        return { topics: (Array.isArray(json) ? json : []).slice(0, 15).map((row) => ({
            id: row.id,
            title: cleanText(row.title, 200),
            url: String(row.url || ""),
            created: cleanText(row.created, 40)
        })) };
    }

    async function v2exNode(node) {
        const name = cleanText(node, 40);
        if (!name) throw requestError(400, "explorer_node_required", "请提供 V2EX 节点名。");
        const json = JSON.parse(await fetchText(
            "https://www.v2ex.com/api/topics/show.json?node_name=" + encodeURIComponent(name),
            { headers: { "User-Agent": "DengTa/1.0" } }
        ));
        return { node: name, topics: (Array.isArray(json) ? json : []).slice(0, 15).map((row) => ({
            id: row.id,
            title: cleanText(row.title, 200),
            url: String(row.url || ""),
            replies: Number(row.replies) || 0
        })) };
    }

    async function v2exTopic(id) {
        const topicId = String(id || "").trim();
        if (!/^\d{1,12}$/.test(topicId)) throw requestError(400, "explorer_topic_invalid", "帖子编号格式不正确。");
        const json = JSON.parse(await fetchText(
            "https://www.v2ex.com/api/replies/show.json?topic_id=" + topicId,
            { headers: { "User-Agent": "DengTa/1.0" } }
        ));
        const rows = Array.isArray(json) ? json : [];
        return {
            topic_id: topicId,
            content: cleanText(stripTags(rows[0]?.content || ""), 1500),
            replies: rows.slice(1, 21).map((row) => ({
                member: cleanText(row.member?.username, 40),
                content: cleanText(stripTags(row.content || ""), 800)
            }))
        };
    }

    async function biliSearch(keyword, limit = 5) {
        const word = cleanText(keyword, 60);
        if (!word) throw requestError(400, "explorer_keyword_required", "请告诉我要搜什么。");
        const mixinKey = await deriveWbiMixinKey(fetcher);
        const query = mixinKey
            ? wbiSignedQuery({ search_type: "video", keyword: word, page: 1 }, mixinKey)
            : "search_type=video&keyword=" + encodeURIComponent(word) + "&page=1";
        const json = JSON.parse(await fetchText(
            "https://api.bilibili.com/x/web-interface/search/type?" + query,
            { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.bilibili.com/" } }
        ));
        const results = Array.isArray(json?.data?.result) ? json.data.result : [];
        return {
            keyword: word,
            videos: results.slice(0, Math.min(10, Number(limit) || 5)).map((row) => ({
                bvid: String(row.bvid || ""),
                title: cleanText(String(row.title || "").replace(/<[^>]+>/g, ""), 160),
                author: cleanText(row.author, 60),
                play: Number(row.play) || 0,
                danmaku: Number(row.video_review) || 0,
                duration: String(row.duration || ""),
                cover: String(row.pic || "").replace(/^\/\//, "https://").replace(/^http:\/\//, "https://")
            }))
        };
    }

    async function biliVideo(bvid, cookie = "", { includeSubtitles = true } = {}) {
        const id = String(bvid || "").trim();
        if (!BVID_PATTERN.test(id)) throw requestError(400, "explorer_bvid_invalid", "视频编号格式不正确。");
        const headers = {
            "User-Agent": "Mozilla/5.0",
            Referer: "https://www.bilibili.com/",
            ...(cookie ? { Cookie: cookie } : {})
        };
        const view = JSON.parse(await fetchText(
            "https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(id),
            { headers }
        ));
        const data = view?.data || {};
        if (!data.cid) throw requestError(404, "explorer_video_not_found", "没有找到这个视频。");
        let subtitles = [];
        try {
            if (includeSubtitles) {
            // 字幕接口需要 WBI 签名,否则返回空(之前漏签导致字幕永远为空)。
            const mixinKey = await deriveWbiMixinKey(fetcher);
            const playerQuery = mixinKey
                ? wbiSignedQuery({ bvid: id, cid: String(data.cid) }, mixinKey)
                : "bvid=" + encodeURIComponent(id) + "&cid=" + encodeURIComponent(data.cid);
            const player = JSON.parse(await fetchText(
                "https://api.bilibili.com/x/player/wbi/v2?" + playerQuery,
                { headers }
            ));
            const list = Array.isArray(player?.data?.subtitle?.subtitles) ? player.data.subtitle.subtitles : [];
            for (const item of list.slice(0, 1)) {
                if (!item.subtitle_url) continue;
                const subJson = JSON.parse(await fetchText(
                    item.subtitle_url.startsWith("//") ? "https:" + item.subtitle_url : item.subtitle_url,
                    { headers }
                ));
                subtitles = (Array.isArray(subJson?.body) ? subJson.body : [])
                    .slice(0, 80)
                    .map((line) => cleanText(line.content, 200))
                    .filter(Boolean);
            }
            }
        } catch {
            // 字幕可选,失败不影响主信息。
        }
        return {
            bvid: id,
            title: cleanText(data.title, 200),
            desc: cleanText(data.desc, 800),
            owner: cleanText(data.owner?.name, 60),
            duration_seconds: Number(data.duration) || null,
            view: Number(data.stat?.view) || 0,
            danmaku: Number(data.stat?.danmaku) || 0,
            like: Number(data.stat?.like) || 0,
            pubdate: data.pubdate ? new Date(Number(data.pubdate) * 1000).toISOString().slice(0, 10) : "",
            cover: String(data.pic || "").replace(/^\/\//, "https://").replace(/^http:\/\//, "https://"),
            subtitles
        };
    }

    async function exaSearch(query) {
        const apiKey = String(env.EXA_API_KEY || "").trim();
        if (!apiKey) {
            throw requestError(503, "explorer_exa_unconfigured", "语义搜索还没配置 EXA_API_KEY。");
        }
        const word = cleanText(query, 200);
        if (!word) throw requestError(400, "explorer_keyword_required", "请告诉我要搜什么。");
        const response = await fetcher("https://api.exa.ai/search", {
            method: "POST",
            headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
                query: word,
                numResults: 5,
                contents: { text: { maxCharacters: 1200 } }
            })
        });
        const json = await response.json().catch(() => null);
        if (!response.ok) {
            throw requestError(502, "explorer_exa_failed", String(json?.error || "语义搜索暂时失败。"));
        }
        return {
            query: word,
            results: (Array.isArray(json?.results) ? json.results : []).map((row) => ({
                title: cleanText(row.title, 160),
                url: String(row.url || ""),
                text: cleanText(row.text, 1500)
            }))
        };
    }

    // 全网搜索(DDG Lite,无需密钥,稳定无 JS)。
    async function webSearch(query, limit = 8) {
        const word = cleanText(query, 200);
        if (!word) throw requestError(400, "explorer_keyword_required", "请告诉我要搜什么。");
        const html = await fetchText(
            "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(word),
            { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" } },
            30000
        );
        const max = Math.min(10, Math.max(1, Number(limit) || 8));
        const results = [];
        const matcher = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = matcher.exec(html)) !== null && results.length < max) {
            const rawUrl = String(match[1] || "");
            const urlMatch = rawUrl.match(/uddg=([^&]+)/);
            const url = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
            if (!/^https?:\/\//i.test(url)) continue;
            results.push({
                title: cleanText(stripTags(match[2]), 160),
                url,
                snippet: cleanText(stripTags(match[3]), 300)
            });
        }
        if (results.length === 0) {
            throw requestError(502, "explorer_search_empty", "这次搜索没有拿到结果，请换个关键词再试。");
        }
        return { query: word, results };
    }

    return { biliSearch, biliVideo, exaSearch, rssRead, v2exHot, v2exNode, v2exTopic, webRead, webSearch };
}

module.exports = { createWebExplorer };
