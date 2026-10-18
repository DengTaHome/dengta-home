const express = require("express");
const multer = require("multer");
const { requireRequestScope } = require("../../services/request-scope");
const {
    MAX_PRIVATE_MEDIA_BYTES,
    archiveAsset,
    catalog,
    deleteAssetPermanently,
    downloadAsset,
    setPreference,
    updateAsset,
    uploadAsset
} = require("../../services/private-media");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fields: 8, parts: 9, fileSize: MAX_PRIVATE_MEDIA_BYTES }
});

function uploadOne(req, res, next) {
    upload.single("file")(req, res, (error) => {
        if (!error) return next();
        error.status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        error.code = error.code === "LIMIT_FILE_SIZE" ? "private_media_too_large" : "private_media_multipart_invalid";
        next(error);
    });
}

function createPrivateMediaRouter({ storage, service = {}, stickerImports = null, xhsStickerImports = null, xhsClient = null } = {}) {
    if (!storage || typeof storage.from !== "function") throw new Error("private media router requires storage");
    const operations = { uploadAsset, catalog, setPreference, updateAsset, archiveAsset, deleteAssetPermanently, downloadAsset, ...service };
    const router = express.Router();
    router.use((req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try { requireRequestScope(req); next(); } catch (error) { next(error); }
    });

    router.get("/catalog", async (req, res, next) => {
        try { res.json({ ok: true, ...(await operations.catalog(requireRequestScope(req))) }); } catch (error) { next(error); }
    });
    router.post("/assets", uploadOne, async (req, res, next) => {
        try {
            const asset = await operations.uploadAsset({
                scope: requireRequestScope(req), storage, file: req.file,
                purpose: req.body?.purpose,
                metadata: { display_name: req.body?.display_name, alt_text: req.body?.alt_text, mood_tags: req.body?.mood_tags }
            });
            res.status(201).json({ ok: true, asset });
        } catch (error) { next(error); }
    });
    if (stickerImports) {
        router.get("/sticker-import/preferences", async (req, res, next) => {
            try { res.json({ ok: true, ...await stickerImports.preferences(requireRequestScope(req)) }); } catch (error) { next(error); }
        });
        router.put("/sticker-import/preferences", async (req, res, next) => {
            try { res.json({ ok: true, ...await stickerImports.savePreferences(requireRequestScope(req), req.body) }); } catch (error) { next(error); }
        });
        router.post("/sticker-import/bilibili", async (req, res, next) => {
            try { res.status(201).json({ ok: true, ...await stickerImports.importBilibili(requireRequestScope(req), req.body) }); } catch (error) { next(error); }
        });
    }
    if (xhsStickerImports) {
        router.get("/sticker-import/xhs/preferences", async (req, res, next) => {
            try { res.json({ ok: true, ...await xhsStickerImports.preferences(requireRequestScope(req)) }); } catch (error) { next(error); }
        });
        router.put("/sticker-import/xhs/preferences", async (req, res, next) => {
            try { res.json({ ok: true, ...await xhsStickerImports.savePreferences(requireRequestScope(req), req.body) }); } catch (error) { next(error); }
        });
        router.get("/sticker-import/xhs/search", async (req, res, next) => {
            try {
                const scope = requireRequestScope(req);
                if (typeof xhsClient?.forScope !== "function") throw Object.assign(new Error("小红书独立服务尚未配置。"), { status: 503, code: "xhs_service_unconfigured" });
                const result = await xhsClient.forScope(scope).search(String(req.query.keyword || ""));
                res.json({ ok: true, result });
            } catch (error) { next(error); }
        });
        router.post("/sticker-import/xhs", async (req, res, next) => {
            try { res.status(201).json({ ok: true, ...await xhsStickerImports.importXhs(requireRequestScope(req), req.body) }); } catch (error) { next(error); }
        });
    }
    if (stickerImports || xhsStickerImports) router.get("/assets/:id/source", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const readers = [stickerImports, xhsStickerImports].filter(Boolean);
            for (const [index, reader] of readers.entries()) {
                try { return res.json({ ok: true, source: await reader.readSource(scope, req.params.id) }); }
                catch (error) { if (error?.code !== "sticker_import_source_not_found" || index === readers.length - 1) throw error; }
            }
        } catch (error) { next(error); }
    });
    router.put("/preferences", async (req, res, next) => {
        try { res.json({ ok: true, preference: await operations.setPreference(requireRequestScope(req), req.body?.purpose, req.body?.asset_id) }); } catch (error) { next(error); }
    });
    router.patch("/assets/:id", async (req, res, next) => {
        try { res.json({ ok: true, asset: await operations.updateAsset(requireRequestScope(req), req.params.id, req.body) }); } catch (error) { next(error); }
    });
    router.delete("/assets/:id", async (req, res, next) => {
        try {
            if (req.query?.permanent === "true" || req.query?.permanent === true) {
                res.json({ ok: true, asset: await operations.deleteAssetPermanently(requireRequestScope(req), storage, req.params.id) });
            } else {
                res.json({ ok: true, asset: await operations.archiveAsset(requireRequestScope(req), req.params.id) });
            }
        } catch (error) { next(error); }
    });
    router.get("/assets/:id/content", async (req, res, next) => {
        try {
            const content = await operations.downloadAsset(requireRequestScope(req), storage, req.params.id, { poster: req.query.poster === "1" });
            res.set("Content-Type", content.mimeType);
            res.set("Content-Length", String(content.buffer.length));
            res.send(content.buffer);
        } catch (error) { next(error); }
    });
    return router;
}

module.exports = { createPrivateMediaRouter, uploadOne };
