const express = require("express");
const multer = require("multer");
const { createHash } = require("node:crypto");
const path = require("node:path");
const { requireRequestScope } = require("../../services/request-scope");
const {
    deleteFavorite,
    deletePlaylist,
    importPlaylist,
    listFavorites,
    listPlaylists,
    putFavorite,
    readPlaylist
} = require("../../services/music-listening");
const { createNeteaseCloudMusicService } = require("../../services/netease-cloud-music");

function createMusicRouter(service = {}) {
    const netease = service.netease || (service.mcpDeviceCenter
        ? createNeteaseCloudMusicService({ mcpDeviceCenter: service.mcpDeviceCenter, cookieSession: service.neteaseCookie })
        : null);
    const neteaseQr = service.neteaseQr || null;
    const musicUnderstanding = service.musicUnderstanding || null;
    const storage = service.storage || null;
    const audioUpload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 20 * 1024 * 1024, files: 1 }
    });
    const operations = {
        deleteFavorite,
        deletePlaylist,
        importPlaylist,
        listFavorites,
        listPlaylists,
        putFavorite,
        readPlaylist,
        ...service
    };
    const router = express.Router();
    router.use((req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try {
            requireRequestScope(req);
            next();
        } catch (error) {
            next(error);
        }
    });

    const requireQr = (req, res, next) => {
        if (!neteaseQr) {
            const error = new Error("网易云扫码登录还没有启用。");
            error.status = 503;
            error.code = "netease_qr_unavailable";
            return next(error);
        }
        next();
    };
    const requireUnderstanding = (req, res, next) => {
        if (!musicUnderstanding) {
            const error = new Error("音乐理解服务还没有启用。");
            error.status = 503;
            error.code = "music_understanding_unavailable";
            return next(error);
        }
        next();
    };

    router.get("/favorites", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ favorites: await operations.listFavorites(scope.db) });
        } catch (error) {
            next(error);
        }
    });
    router.put("/favorites/:itemId", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ favorite: await operations.putFavorite(scope.db, req.params.itemId) });
        } catch (error) {
            next(error);
        }
    });
    router.delete("/favorites/:itemId", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ deleted: await operations.deleteFavorite(scope.db, req.params.itemId) });
        } catch (error) {
            next(error);
        }
    });
    const AUDIO_TYPES = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg", ".opus": "audio/ogg" };

    const uploadOne = (req, res, next) => audioUpload.single("file")(req, res, error => {
        if (!error) return next();
        next(Object.assign(new Error(error.code === "LIMIT_FILE_SIZE" ? "单个音频不能超过 20MB。" : "请选择一个音频文件，重新上传。"), {
            status: error.code === "LIMIT_FILE_SIZE" ? 413 : 400,
            code: error.code === "LIMIT_FILE_SIZE" ? "music_audio_too_large" : "music_audio_form_invalid"
        }));
    });
    router.post("/upload-audio", uploadOne, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            if (!storage || typeof storage.from !== "function") {
                const error = new Error("音频存储还没有准备好。");
                error.status = 503;
                error.code = "music_storage_unavailable";
                throw error;
            }
            const file = req.file;
            if (!file || !file.buffer || file.buffer.length === 0) {
                const error = new Error("请选择一个音频文件。");
                error.status = 400;
                error.code = "music_audio_required";
                throw error;
            }
            const extension = path.extname(String(file.originalname || "")).toLowerCase();
            const mime = AUDIO_TYPES[extension];
            if (!AUDIO_TYPES[extension]) {
                const error = new Error("只支持 MP3 / M4A / AAC / WAV / FLAC / OGG / OPUS 音频。");
                error.status = 415;
                error.code = "music_audio_type_invalid";
                throw error;
            }
            const base = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
            if (!/^https:\/\/[^/]+$/.test(base)) {
                throw Object.assign(new Error("服务器音频存储地址未配置，请联系管理员。"), { status: 503, code: "music_supabase_url_missing" });
            }
            const digest = createHash("sha256").update(JSON.stringify([scope.userId, scope.companionId, extension])).update(file.buffer).digest("hex");
            const objectPath = `public/${digest}${extension}`;
            let uploadResult;
            try {
                uploadResult = await storage.from("music-uploads").upload(objectPath, file.buffer, {
                    contentType: mime, upsert: false, cacheControl: "3600"
                });
            } catch {
                throw Object.assign(new Error("音频上传连接中断，请重试同一文件。"), { status: 503, code: "music_audio_storage_failed" });
            }
            const error = uploadResult?.error;
            if (!uploadResult) throw Object.assign(new Error("未收到音频存储回执，请重试同一文件。"), { status: 503, code: "music_audio_storage_failed" });
            const duplicate = error && [400, 409].includes(Number(error.statusCode || error.status)) && (
                ["ResourceAlreadyExists", "KeyAlreadyExists", "Duplicate"].includes(error.code || error.error)
                || /^(?:The resource already exists|Asset Already Exists|The object already exists)\.?$/i.test(error.message || "")
            );
            if (error && !duplicate) {
                const status = Number(error.statusCode || error.status);
                const code = error.code || error.error;
                if (status === 403 || code === "AccessDenied") throw Object.assign(new Error("服务器无权写入音频存储，请联系管理员检查存储权限。"), { status: 403, code: "music_audio_storage_permission" });
                if (status === 413 || ["EntityTooLarge", "SizeLimitExceeded"].includes(code)) throw Object.assign(new Error("音频超过存储容量限制，请选择较小文件或仅本机播放。"), { status: 413, code: "music_audio_too_large" });
                if (status === 415 || code === "InvalidMimeType") throw Object.assign(new Error("服务器存储不支持该音频格式，请仅本机播放或换成 MP3/M4A。"), { status: 415, code: "music_audio_mime_rejected" });
                if (status === 429) throw Object.assign(new Error("音频存储请求过于频繁，请稍后重试同一文件。"), { status: 429, code: "music_audio_storage_rate_limited" });
                throw Object.assign(new Error("音频存储上传失败，请检查网络或存储配置后重试。"), { status: 503, code: "music_audio_storage_failed" });
            }
            const url = `${base}/storage/v1/object/public/music-uploads/${objectPath}`;
            const title = String(file.originalname || "本机音频")
                .replace(/\.[^.]+$/, "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 180) || "本机音频";
            res.status(201).json({
                audio: { url, title, size: file.buffer.length, mime_type: mime }
            });
        } catch (error) {
            next(error);
        }
    });

    router.post("/playlists/import", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.status(201).json({
                playlist: await operations.importPlaylist(scope.db, req.body || {}, scope)
            });
        } catch (error) {
            next(error);
        }
    });
    router.get("/playlists", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ playlists: await operations.listPlaylists(scope.db) });
        } catch (error) {
            next(error);
        }
    });
    router.get("/playlists/:id", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ playlist: await operations.readPlaylist(scope.db, req.params.id) });
        } catch (error) {
            next(error);
        }
    });
    router.delete("/playlists/:id", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ deleted: await operations.deletePlaylist(scope.db, req.params.id) });
        } catch (error) {
            next(error);
        }
    });
    router.post("/providers/netease/connections", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.status(201).json({ connection: await netease.connect(scope, req.body || {}) });
        } catch (error) {
            next(error);
        }
    });
    router.post("/providers/netease/connections/provision", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.status(201).json({ connection: await netease.provision(scope, req.body || {}) });
        } catch (error) {
            next(error);
        }
    });
    router.get("/providers/netease/connections/:id/status", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ status: await netease.status(scope, req.params.id) });
        } catch (error) {
            next(error);
        }
    });
    router.get("/providers/netease/playlists", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ playlists: await netease.playlists(scope, req.query.connection_id) });
        } catch (error) {
            next(error);
        }
    });
    router.get("/providers/netease/playlists/:providerPlaylistId", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({
                playlist: await netease.playlistDetail(
                    scope,
                    req.query.connection_id,
                    req.params.providerPlaylistId
                )
            });
        } catch (error) {
            next(error);
        }
    });
    router.get("/providers/netease/search", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({
                tracks: await netease.search(
                    scope,
                    req.query.connection_id,
                    req.query.q,
                    req.query.limit
                )
            });
        } catch (error) {
            next(error);
        }
    });
    router.post("/providers/netease/imports/share", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.status(201).json({ playlist: await netease.importShare(scope, req.body || {}) });
        } catch (error) {
            next(error);
        }
    });
    router.post("/providers/netease/external-playback", async (req, res, next) => {
        try {
            requireRequestScope(req);
            res.json({ playback: netease.externalPlayback(req.body || {}) });
        } catch (error) {
            next(error);
        }
    });

    // --- Built-in NetEase QR-code login (no MCP required) ---
    router.post("/providers/netease/qr/begin", requireQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.status(201).json({
                session: await neteaseQr.begin({ ...(req.body || {}), scope })
            });
        } catch (error) {
            next(error);
        }
    });
    router.get("/providers/netease/qr/check", requireQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ result: await neteaseQr.check(scope, req.query.key) });
        } catch (error) {
            next(error);
        }
    });
    router.get("/providers/netease/qr/status", requireQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ connection: await neteaseQr.status(scope) });
        } catch (error) {
            next(error);
        }
    });
    router.delete("/providers/netease/qr/status", requireQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ ...(await neteaseQr.disconnect(scope)) });
        } catch (error) {
            next(error);
        }
    });
    router.get("/providers/netease/qr/playlists", requireQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ playlists: await neteaseQr.playlists(scope) });
        } catch (error) {
            next(error);
        }
    });
    router.post("/providers/netease/qr/import", requireQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.status(201).json({ import: await neteaseQr.importPlaylist(scope, req.body || {}) });
        } catch (error) {
            next(error);
        }
    });
    router.post("/providers/netease/qr/refresh", requireQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ refresh: await neteaseQr.refreshPlaylist(scope, req.body || {}) });
        } catch (error) {
            next(error);
        }
    });
    router.get("/providers/netease/qr/song-url", requireQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ playback: await neteaseQr.songUrl(scope, req.query.id) });
        } catch (error) {
            next(error);
        }
    });
    router.get("/providers/netease/qr/lyric", requireQr, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ lyrics: await neteaseQr.lyric(scope, req.query.id) });
        } catch (error) {
            next(error);
        }
    });

    // --- Music understanding (casual / expert tiers) ---
    router.post("/understanding/analyze", requireUnderstanding, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ understanding: await musicUnderstanding.analyze(scope, req.body || {}) });
        } catch (error) {
            next(error);
        }
    });
    router.post("/understanding/narration", requireUnderstanding, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ result: await musicUnderstanding.narrate(scope, req.body || {}) });
        } catch (error) {
            next(error);
        }
    });
    router.get("/understanding/tracks/:trackId", requireUnderstanding, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ understanding: await musicUnderstanding.read(scope, req.params.trackId) });
        } catch (error) {
            next(error);
        }
    });
    router.get("/understanding/tracks/:trackId/status", requireUnderstanding, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            if (typeof musicUnderstanding.readStatus !== "function") {
                throw Object.assign(new Error("暂时无法核对音乐分析进度，请稍后重新读取状态。"), { status: 503, code: "music_understanding_status_unavailable" });
            }
            res.json({ status: await musicUnderstanding.readStatus(scope, req.params.trackId) });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = { createMusicRouter };
