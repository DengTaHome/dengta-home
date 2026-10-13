const express = require("express");
const { requireRequestScope } = require("../services/request-scope");
const { resolvePageEmbed } = require("../services/page-embed");
const { createBilibiliQrLoginService } = require("../services/bilibili-qr-login");
const { runCoWatchFrame } = require("../services/co-watch");
const {
    endCoWatchSession,
    listCoWatchSessionMessages,
    readActiveCoWatchSession,
    readCoWatchSession,
    startCoWatchSession,
    updateListeningPlayback
} = require("../services/co-watch-sessions");
const { runCoWatchQuickReply } = require("../services/co-watch-replies");
const {
    applyMusicQueueOperation,
    readMusicQueue
} = require("../services/music-queue");

const MAX_FRAME_BYTES = 1_500_000;

function createCoWatchRouter(services = {}) {
    const router = express.Router();
    router.post("/sessions", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await startCoWatchSession({
                database: scope.db,
                input: req.body || {},
                validateMediaUrl: services.validateMediaUrl,
                validatePageUrl: services.validatePageUrl,
                encryptMediaUrl: services.encryptMediaUrl
            });
            // 兴趣引擎:一起看行为自动进入画像(推荐理由的数据来源)。
            if (services.interestEngine && result?.session?.title) {
                services.interestEngine.recordWatch(scope, {
                    request_id: result.session.id,
                    title: String(result.session.title),
                    source_url: String(result.session.media_url || req.body?.media_url || req.body?.page_url || ""),
                    kind: result.session.session_mode === "listening" ? "music" : "video",
                    watched_seconds: 0
                }).then(receipt => {
                    if (receipt.warning) console.warn("co_watch_interest", { code: receipt.warning.code, recorded: receipt.recorded });
                }).catch(error => console.warn("co_watch_interest", { code: /^watch_[a-z_]{1,60}$/.test(error?.code || "") ? error.code : "watch_save_failed", recorded: false }));
            }
            res.set("Cache-Control", "private, no-store");
            res.status(result.status === "created" ? 201 : 200).json(result);
        } catch (error) {
            next(error);
        }
    });
    router.get("/sessions/active", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.set("Cache-Control", "private, no-store");
            res.json({
                session: await readActiveCoWatchSession({
                    database: scope.db,
                    sessionMode: String(req.query?.mode || "").trim()
                })
            });
        } catch (error) {
            next(error);
        }
    });
    router.get("/sessions/:sessionId", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.set("Cache-Control", "private, no-store");
            res.json({
                session: await readCoWatchSession({
                    database: scope.db,
                    sessionId: req.params.sessionId
                })
            });
        } catch (error) {
            next(error);
        }
    });
    const bilibiliQr = services.bilibiliQr || (services.database
        ? createBilibiliQrLoginService({ database: services.database, fetchImpl: services.fetchImpl })
        : null);
    const requireBilibiliQr = (req, res, next) => {
        if (!bilibiliQr) {
            const error = new Error("哔哩哔哩扫码登录还没有启用。");
            error.status = 503;
            error.code = "bilibili_qr_unavailable";
            return next(error);
        }
        next();
    };
    // 公开的 B 站视频流代理:服务器带 Referer 取到 MP4 直链后转发给 App 播放器,
    // 解决内嵌播放器在 WebView 里黑屏的问题。
    router.get("/bilibili-stream", async (req, res, next) => {
        try {
            const bvid = String(req.query.bvid || "").trim().slice(0, 20);
            if (!/^BV[0-9A-Za-z]{6,12}$/i.test(bvid)) {
                const error = new Error("视频编号格式不正确。");
                error.status = 400;
                error.code = "bilibili_bvid_invalid";
                return next(error);
            }
            const headers = {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                Referer: "https://www.bilibili.com/"
            };
            const view = await fetch(
                "https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(bvid),
                { headers }
            ).then((r) => r.json()).catch(() => null);
            const cid = view?.data?.cid;
            if (!cid) {
                const error = new Error("没有找到这个视频。");
                error.status = 404;
                error.code = "bilibili_video_not_found";
                return next(error);
            }
            const play = await fetch(
                "https://api.bilibili.com/x/player/playurl?bvid=" +
                    encodeURIComponent(bvid) +
                    "&cid=" +
                    encodeURIComponent(cid) +
                    "&qn=64&fnval=1&fourk=1",
                { headers }
            ).then((r) => r.json()).catch(() => null);
            const streamUrl = play?.data?.durl?.[0]?.url || "";
            if (!streamUrl) {
                const error = new Error("没有拿到可播放的视频流。");
                error.status = 502;
                error.code = "bilibili_stream_unavailable";
                return next(error);
            }
            const range = String(req.headers.range || "").trim().slice(0, 120);
            const upstream = await fetch(streamUrl, {
                headers: {
                    Referer: "https://www.bilibili.com/",
                    "User-Agent": headers["User-Agent"],
                    ...(range ? { Range: range } : {})
                }
            });
            if (!upstream.ok || !upstream.body) {
                const error = new Error("视频流转发失败。");
                error.status = 502;
                error.code = "bilibili_stream_failed";
                return next(error);
            }
            res.status(upstream.status);
            for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
                const value = upstream.headers.get(name);
                if (value) res.set(name, value);
            }
            res.set("Cache-Control", "private, no-store");
            // 流式转发给 App 播放器（支持 Range 拖动与进度条）。
            const reader = upstream.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
            }
            res.end();
        } catch (error) {
            next(error);
        }
    });

    // 公开的 B 站视频解析:拿到标题/封面/清晰度直链,供一起看或后续下载播放器使用。
    router.get("/bilibili-resolve", async (req, res, next) => {
        try {
            const bvid = String(req.query.bvid || "").trim().slice(0, 20);
            if (!/^BV[0-9A-Za-z]{6,12}$/i.test(bvid)) {
                const error = new Error("视频编号格式不正确。");
                error.status = 400;
                error.code = "bilibili_bvid_invalid";
                return next(error);
            }
            const headers = {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                Referer: "https://www.bilibili.com/"
            };
            const viewResponse = await fetch(
                "https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(bvid),
                { headers }
            );
            const viewJson = await viewResponse.json().catch(() => null);
            const data = viewJson?.data || {};
            if (!data.cid) {
                const error = new Error("没有找到这个视频。");
                error.status = 404;
                error.code = "bilibili_video_not_found";
                return next(error);
            }
            const playResponse = await fetch(
                "https://api.bilibili.com/x/player/playurl?bvid=" +
                    encodeURIComponent(bvid) +
                    "&cid=" +
                    encodeURIComponent(data.cid) +
                    "&qn=80&fnval=4048&fourk=1",
                { headers }
            );
            const playJson = await playResponse.json().catch(() => null);
            const dash = playJson?.data?.dash || {};
            res.json({
                bvid,
                cid: data.cid,
                title: String(data.title || "").slice(0, 200),
                cover: String(data.pic || ""),
                duration_seconds: Number(data.duration) || null,
                videos: (Array.isArray(dash.video) ? dash.video : [])
                    .slice(0, 3)
                    .map((item) => ({
                        quality: item.id,
                        width: item.width,
                        height: item.height,
                        codecs: item.codecs,
                        base_url: item.baseUrl
                    })),
                audios: (Array.isArray(dash.audio) ? dash.audio : [])
                    .slice(0, 2)
                    .map((item) => ({ id: item.id, codecs: item.codecs, base_url: item.baseUrl })),
                fallback_url:
                    Array.isArray(playJson?.data?.durl) && playJson.data.durl[0]?.url
                        ? String(playJson.data.durl[0].url)
                        : "",
                note: "直链约两小时有效且需带 Referer 请求;播放建议继续使用网页模式。"
            });
        } catch (error) {
            next(error);
        }
    });

    router.post("/bilibili-qr/begin", requireBilibiliQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.status(201).json({ session: await bilibiliQr.begin(scope) });
        } catch (error) { next(error); }
    });
    router.get("/bilibili-qr/check", requireBilibiliQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ result: await bilibiliQr.check(scope, req.query.key) });
        } catch (error) { next(error); }
    });
    router.get("/bilibili-qr/status", requireBilibiliQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ connection: await bilibiliQr.status(scope) });
        } catch (error) { next(error); }
    });
    router.post("/bilibili-qr/cookie", requireBilibiliQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json(await bilibiliQr.importCookie(scope, req.body?.cookie));
        } catch (error) { next(error); }
    });
    router.delete("/bilibili-qr/status", requireBilibiliQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ ...(await bilibiliQr.disconnect(scope)) });
        } catch (error) { next(error); }
    });
    router.get("/bilibili-qr/favorites", requireBilibiliQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ folders: await bilibiliQr.favoriteFolders(scope) });
        } catch (error) { next(error); }
    });
    router.get("/bilibili-qr/favorites/:mediaId", requireBilibiliQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ videos: await bilibiliQr.favoriteVideos(scope, req.params.mediaId, req.query.page) });
        } catch (error) { next(error); }
    });
    router.get("/bilibili-qr/recommendations", requireBilibiliQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.set("Cache-Control", "private, no-store");
            res.json({ recommendations: await bilibiliQr.recommendations(scope, req.query.limit) });
        } catch (error) { next(error); }
    });
    router.get("/page-resolve", async (req, res, next) => {
        try {
            requireRequestScope(req);
            res.set("Cache-Control", "private, no-store");
            res.json({ page: await resolvePageEmbed(req.query.url) });
        } catch (error) {
            next(error);
        }
    });
    router.get("/sessions/:sessionId/queue", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.set("Cache-Control", "private, no-store");
            res.json({
                queue: await readMusicQueue({
                    database: scope.db,
                    sessionId: req.params.sessionId
                })
            });
        } catch (error) {
            next(error);
        }
    });
    router.post("/sessions/:sessionId/queue/operations", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.set("Cache-Control", "private, no-store");
            res.json(await applyMusicQueueOperation({
                database: scope.db,
                sessionId: req.params.sessionId,
                input: req.body || {}
            }));
        } catch (error) {
            next(error);
        }
    });
    router.get("/sessions/:sessionId/messages", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.set("Cache-Control", "private, no-store");
            res.json({
                messages: await listCoWatchSessionMessages({
                    database: scope.db,
                    sessionId: req.params.sessionId,
                    limit: req.query.limit
                })
            });
        } catch (error) {
            next(error);
        }
    });
    router.patch("/sessions/:sessionId", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            if (req.body?.status !== "ended") {
                const error = new Error("当前只支持结束共看会话。");
                error.status = 400;
                error.code = "co_watch_session_update_invalid";
                throw error;
            }
            const result = await endCoWatchSession({
                database: scope.db,
                sessionId: req.params.sessionId,
                input: req.body || {}
            });
            res.set("Cache-Control", "private, no-store");
            res.json(result);
        } catch (error) {
            next(error);
        }
    });
    router.patch("/sessions/:sessionId/playback", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await updateListeningPlayback({
                database: scope.db,
                sessionId: req.params.sessionId,
                input: req.body || {}
            });
            res.set("Cache-Control", "private, no-store");
            res.json({ session });
        } catch (error) {
            next(error);
        }
    });
    if (services.receiver) {
        router.post("/sessions/:sessionId/pairing-code", async (req, res, next) => {
            try {
                const scope = requireRequestScope(req);
                const session = await readCoWatchSession({ database: scope.db, sessionId: req.params.sessionId });
                if (session.session_mode !== "direct_media" || session.status !== "active") {
                    const error = new Error("该会话不可配对。"); error.status = 409; error.code = "cast_pair_unavailable"; throw error;
                }
                res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
                res.json({ pairing_code: services.receiver.pairingCode(session.id), session_id: session.id, expires_at: services.receiver.pairingExpiresAt() });
            } catch (error) { next(error); }
        });
    }
    router.post("/sessions/:sessionId/reply", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await runCoWatchQuickReply({
                database: scope.db,
                sessionId: req.params.sessionId,
                input: req.body || {},
                ...services
            });
            res.set("Cache-Control", "private, no-store");
            res.status(result.status === "created" ? 201 : 200).json(result);
        } catch (error) {
            next(error);
        }
    });
    router.post(
        "/frame",
        express.raw({
            type: ["image/jpeg", "image/png"],
            limit: MAX_FRAME_BYTES
        }),
        async (req, res, next) => {
            let requestActive = !req.aborted && !res.destroyed;
            const deactivateRequest = () => {
                requestActive = false;
            };
            const deactivateOnEarlyResponseClose = () => {
                if (!res.writableFinished) deactivateRequest();
            };
            req.once("aborted", deactivateRequest);
            res.once("close", deactivateOnEarlyResponseClose);
            try {
                const scope = requireRequestScope(req);
                const result = await runCoWatchFrame({
                    database: scope.db,
                    frame: {
                        sessionId: req.query.session_id,
                        mode: req.query.mode,
                        minimumMinutes: req.query.minimum_minutes,
                        maximumMinutes: req.query.maximum_minutes,
                        epoch: req.query.epoch,
                        sequence: req.query.sequence,
                        capturedAt: req.query.captured_at,
                        mimeType: req.headers["content-type"]
                    },
                    image: req.body,
                    ...services,
                    isRequestActive: () => requestActive
                });
                res.set("Cache-Control", "private, no-store");
                res.status(result.status === "created" ? 201 : 200).json({
                    status: result.status,
                    reaction: result.reaction,
                    message_id: result.messageId,
                    conversation_id: result.conversationId,
                    ai_name: result.aiName || "",
                    session: result.session || null,
                    next_check_minutes: result.nextCheckMinutes || null,
                    notification: result.notification || null,
                    prompt_receipt: result.promptReceipt || null
                });
            } catch (error) {
                next(error);
            } finally {
                req.removeListener("aborted", deactivateRequest);
                res.removeListener("close", deactivateOnEarlyResponseClose);
            }
        }
    );
    // 观看进度记录（票根系统）
    const { recordViewingProgress, listRecentViewings, readReceipt } = require("../services/watch-viewings");
    router.post("/viewings", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await recordViewingProgress(scope.db, {
                userId: scope.userId,
                companionId: scope.companionId,
                watchSessionId: req.body?.session_id || req.body?.watch_session_id,
                mediaUrl: req.body?.media_url || req.body?.mediaUrl,
                mediaTitle: req.body?.title || req.body?.media_title,
                durationSeconds: req.body?.duration_seconds || req.body?.duration,
                positionSeconds: req.body?.position_seconds || req.body?.position,
                watchedSeconds: req.body?.watched_seconds || req.body?.watchedSeconds
            });
            res.status(200).json(result);
        } catch (error) { next(error); }
    });
    router.get("/viewings", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const viewings = await listRecentViewings(scope.db, scope.userId, Math.min(Number(req.query.limit) || 20, 50));
            res.json({ viewings });
        } catch (error) { next(error); }
    });
    router.get("/viewings/:viewingId/receipt", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const receipt = await readReceipt(scope.db, req.params.viewingId);
            if (!receipt) return res.status(404).json({ error: "票根未找到" });
            res.json({ receipt });
        } catch (error) { next(error); }
    });
    return router;
}

module.exports = { MAX_FRAME_BYTES, createCoWatchRouter };
