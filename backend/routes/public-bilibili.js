"use strict";

// 公开的 B 站解析/流代理路由：挂在认证中间件之前注册，
// 使 <video> 等无法携带 Bearer 头的请求也能直接取流。
// 加固：buvid3/buvid4 + WBI 签名播放接口 + 失败重试，降低机房 IP 风控导致的空返回。

const express = require("express");
const { createHash } = require("node:crypto");
const { mediaError, mediaRequestLifetime, relayMediaBody } = require("../services/media-stream-relay");

const WBI_MIXIN_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5,
    49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55,
    40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57,
    62, 11, 36, 20, 34, 44, 52
];

const FULL_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BASE_HEADERS = Object.freeze({
    "User-Agent": FULL_UA,
    Referer: "https://www.bilibili.com/"
});

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function wbiSignedQuery(params, mixinKey) {
    const signed = { ...params, wts: String(Math.floor(Date.now() / 1000)) };
    const query = Object.keys(signed)
        .sort()
        .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(String(signed[key])))
        .join("&");
    const wRid = createHash("md5").update(query + mixinKey, "utf8").digest("hex");
    return query + "&w_rid=" + wRid;
}

async function deriveWbiMixinKey(context) {
    try {
        const response = await context.fetch("https://api.bilibili.com/x/web-interface/nav", {
            signal: context.signal,
            headers: { "User-Agent": FULL_UA }
        });
        const json = await response.json().catch(() => null);
        const img = String(json?.data?.wbi_img?.img_url || "");
        const sub = String(json?.data?.wbi_img?.sub_url || "");
        const key1 = (img.match(/\/([0-9a-f]{32})\./) || [])[1] || "";
        const key2 = (sub.match(/\/([0-9a-f]{32})\./) || [])[1] || "";
        if (key1.length !== 32 || key2.length !== 32) return "";
        return WBI_MIXIN_TAB.map((index) => (key1 + key2)[index]).join("").slice(0, 32);
    } catch {
        context.signal.throwIfAborted();
        return "";
    }
}

let buvidCookie = "";
async function ensureBuvidCookie(context) {
    if (buvidCookie) return buvidCookie;
    try {
        const json = await fetchJson("https://api.bilibili.com/x/frontend/finger/spi", BASE_HEADERS, context);
        const b3 = String(json?.data?.b_3 || "");
        const b4 = String(json?.data?.b_4 || "");
        if (b3) buvidCookie = "buvid3=" + b3 + (b4 ? "; buvid4=" + b4 : "");
    } catch {
        context.signal.throwIfAborted();
    }
    return buvidCookie;
}

function biliHeaders() {
    return buvidCookie
        ? { ...BASE_HEADERS, Cookie: buvidCookie }
        : { ...BASE_HEADERS };
}

async function fetchJson(url, headers, context) {
    let response;
    try { response = await context.fetch(url, { headers, signal: context.signal }); }
    catch {
        context.signal.throwIfAborted();
        throw mediaError(502, "bilibili_network_failed", "无法连接视频平台，请检查网络后重试。");
    }
    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw mediaError(502, "bilibili_http_failed", "视频平台接口暂时不可用，请稍后重试。");
    }
    let json;
    try { json = await response.json(); }
    catch {
        context.signal.throwIfAborted();
        throw mediaError(502, "bilibili_response_invalid", "视频平台返回了无法读取的数据，请重试。");
    }
    if (json?.code === -404) throw mediaError(404, "bilibili_video_not_found", "视频平台表示该视频不存在或已下架。");
    if ([-403, -412, -352].includes(json?.code)) throw mediaError(502, "bilibili_platform_restricted", "视频平台限制了本次访问，请稍后重试或在官方页面播放。");
    if (json?.code !== 0) throw mediaError(502, "bilibili_api_failed", "视频平台未成功返回结果，请稍后重试。");
    return json;
}

async function bilibiliView(bvid, context) {
    return fetchJson(
        "https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(bvid),
        biliHeaders(), context
    );
}

async function bilibiliPlayUrl(bvid, cid, context) {
    const mixinKey = await deriveWbiMixinKey(context);
    const params = { bvid, cid: String(cid), qn: "64", fnval: "1", fourk: "1", platform: "pc" };
    const query = mixinKey
        ? wbiSignedQuery(params, mixinKey)
        : new URLSearchParams(params).toString();
    return fetchJson("https://api.bilibili.com/x/player/wbi/playurl?" + query, biliHeaders(), context);
}

async function bilibiliStreamHandler(req, res, next, options = {}) {
    const lifetime = mediaRequestLifetime(req, res, options.metadataTimeoutMs);
    const context = { fetch: options.fetchImpl || fetch, signal: lifetime.signal };
    try {
        const bvid = String(req.query.bvid || "").trim().slice(0, 20);
        if (!/^BV[0-9A-Za-z]{6,12}$/i.test(bvid)) {
            throw requestError(400, "bilibili_bvid_invalid", "视频编号格式不正确。");
        }
        await ensureBuvidCookie(context);
        let view = await bilibiliView(bvid, context);
        if (!view?.data?.cid) {
            await sleep(800);
            context.signal.throwIfAborted();
            view = await bilibiliView(bvid, context);
        }
        const cid = view?.data?.cid;
        if (!cid) {
            throw requestError(502, "bilibili_response_invalid", "视频平台没有返回完整的视频信息，请重试。");
        }
        let play = await bilibiliPlayUrl(bvid, cid, context);
        if (!play?.data?.durl?.length) {
            await sleep(800);
            context.signal.throwIfAborted();
            play = await bilibiliPlayUrl(bvid, cid, context);
        }
        const streamUrl = play?.data?.durl?.[0]?.url || "";
        if (!streamUrl) {
            throw requestError(502, "bilibili_stream_unavailable", "没有拿到可播放的视频流。");
        }
        const range = String(req.headers.range || "").trim().slice(0, 120);
        const upstream = await context.fetch(streamUrl, {
            signal: context.signal,
            headers: {
                Referer: "https://www.bilibili.com/",
                "User-Agent": FULL_UA,
                ...(range ? { Range: range } : {})
            }
        });
        if (upstream.status === 416) {
            res.status(416);
            const contentRange = upstream.headers.get("content-range");
            if (contentRange) res.set("Content-Range", contentRange);
            res.set("Cache-Control", "private, no-store");
            await upstream.body?.cancel().catch(() => {});
            return res.end();
        }
        if (!upstream.ok || !upstream.body) {
            await upstream.body?.cancel().catch(() => {});
            throw requestError(502, "bilibili_stream_failed", "视频流转发失败。");
        }
        res.status(upstream.status);
        for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
            const value = upstream.headers.get(name);
            if (value) res.set(name, value);
        }
        res.set("Cache-Control", "private, no-store");
        lifetime.ready();
        await relayMediaBody(upstream, res, lifetime, options.idleTimeoutMs);
    } catch (error) {
        const failure = lifetime.signal.aborted ? lifetime.signal.reason : error;
        if (res.destroyed || req.aborted) return;
        if (res.headersSent) { res.destroy(); return; }
        for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) res.removeHeader(name);
        next(/^bilibili_/.test(failure?.code || "") ? failure : mediaError(502, "bilibili_stream_failed", "视频传输失败，请重新载入播放器。"));
    } finally { lifetime.dispose(); }

}

async function bilibiliResolveHandler(req, res, next, options = {}) {
    const lifetime = mediaRequestLifetime(req, res, options.metadataTimeoutMs);
    const context = { fetch: options.fetchImpl || fetch, signal: lifetime.signal };
    try {
        const bvid = String(req.query.bvid || "").trim().slice(0, 20);
        if (!/^BV[0-9A-Za-z]{6,12}$/i.test(bvid)) {
            throw requestError(400, "bilibili_bvid_invalid", "视频编号格式不正确。");
        }
        await ensureBuvidCookie(context);
        let view = await bilibiliView(bvid, context);
        if (!view?.data) {
            await sleep(800);
            context.signal.throwIfAborted();
            view = await bilibiliView(bvid, context);
        }
        if (!view?.data) {
            throw requestError(502, "bilibili_response_invalid", "视频平台没有返回完整的视频信息，请重试。");
        }
        const pic = String(view.data.pic || "");
        res.set("Cache-Control", "private, no-store");
        res.json({
            provider: "bilibili",
            bvid,
            title: String(view.data.title || "").slice(0, 180),
            poster: pic.startsWith("//") ? "https:" + pic : pic,
            duration_seconds: Number(view.data.duration) || 0,
            author: String(view.data.owner?.name || "")
        });
    } catch (error) {
        if (!res.destroyed && !req.aborted) next(lifetime.signal.aborted ? lifetime.signal.reason : error);
    } finally { lifetime.dispose(); }
}

function createPublicBilibiliRouter(options = {}) {
    const router = express.Router();
    router.get("/bilibili-stream", (req, res, next) => bilibiliStreamHandler(req, res, next, options));
    router.get("/bilibili-resolve", (req, res, next) => bilibiliResolveHandler(req, res, next, options));
    return router;
}

module.exports = { createPublicBilibiliRouter };
