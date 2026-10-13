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

function createPrivateMediaRouter({ storage, service = {} } = {}) {
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
            const content = await operations.downloadAsset(requireRequestScope(req), storage, req.params.id);
            res.set("Content-Type", content.mimeType);
            res.set("Content-Length", String(content.buffer.length));
            res.send(content.buffer);
        } catch (error) { next(error); }
    });
    return router;
}

module.exports = { createPrivateMediaRouter, uploadOne };
