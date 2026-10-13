const express = require("express");
const { requireRequestScope } = require("../services/request-scope");
const {
    publicCreativeError
} = require("../services/companion-creative");
const {
    planCreativeArtwork,
    publishArtworkMessage,
    scheduleCreativeCheck
} = require("../services/tenant-companion-creative");
const {
    deleteCreativeInspiration,
    listCreativeInspirations,
    saveCreativeInspiration,
    updateCreativeInspiration
} = require("../services/creative-inspiration");

function sendCreativeError(res, error) {
    const safe = publicCreativeError(error);
    if (safe.status >= 500) {
        console.error("creative_studio_request_failed", {
            code: safe.code,
            status: safe.status,
            ...(safe.upstream_status
                ? { upstreamStatus: safe.upstream_status }
                : {})
        });
    }
    res.status(safe.status).json({
        ok: false,
        error: safe.code,
        code: safe.code,
        message: safe.message,
        ...(safe.credential_state
            ? { credential_state: safe.credential_state }
            : {}),
        ...(safe.credential_reentry_required === true
            ? { credential_reentry_required: true }
            : {}),
        ...(safe.credential_scope
            ? { credential_scope: safe.credential_scope }
            : {}),
        ...(safe.metadata_state
            ? { metadata_state: safe.metadata_state }
            : {}),
        ...(safe.metadata_reentry_required === true
            ? { metadata_reentry_required: true }
            : {}),
        ...(safe.upstream_status
            ? { upstream_status: safe.upstream_status }
            : {})
    });
}

function createCompanionCreativeRouter({
    createCenter,
    getSettings,
    generateReply,
    now = () => new Date(),
    random = Math.random
} = {}) {
    if (
        typeof createCenter !== "function" ||
        typeof getSettings !== "function" ||
        typeof generateReply !== "function"
    ) {
        throw new TypeError(
            "Creative router requires center, settings, and generation services."
        );
    }
    const router = express.Router();
    router.use((req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            req.creativeScope = scope;
            req.creativeCenter = createCenter(scope);
            res.set("Cache-Control", "private, no-store");
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get("/status", async (req, res) => {
        try {
            res.json(await req.creativeCenter.status());
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    router.put("/settings", async (req, res) => {
        try {
            const settings = await req.creativeCenter.saveSettings(
                req.body || {}
            );
            if (settings.generation_mode === "autonomous") {
                await scheduleCreativeCheck({
                    database: req.creativeScope.db,
                    delayMinutes: 5 + Math.floor(random() * 56),
                    now,
                    random
                });
            }
            res.json({ ok: true, settings });
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    router.put("/provider", async (req, res) => {
        try {
            const provider = await req.creativeCenter.saveProvider(
                req.body || {}
            );
            res.json({
                ok: true,
                provider,
                message:
                    "配置格式和公网地址检查已通过；尚未调用图片模型，也没有产生生成费用。"
            });
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    router.get("/artworks", async (req, res) => {
        try {
            const artworks = await req.creativeCenter.listArtworks();
            const metadataRequiringReentry = artworks.filter(
                (artwork) => artwork.metadata_state === "needs_reentry"
            ).length;
            res.json({
                ok: true,
                artworks,
                metadata_reentry_required: metadataRequiringReentry > 0,
                metadata_requiring_reentry: metadataRequiringReentry
            });
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    router.get("/inspirations", async (req, res) => {
        try {
            res.json({
                ok: true,
                inspirations: await listCreativeInspirations(
                    req.creativeScope.db
                )
            });
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    router.post("/inspirations", async (req, res) => {
        try {
            const inspiration = await saveCreativeInspiration(
                req.creativeScope.db,
                req.body || {},
                now
            );
            res.status(201).json({ ok: true, inspiration });
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    router.patch("/inspirations/:id", async (req, res) => {
        try {
            const inspiration = await updateCreativeInspiration(
                req.creativeScope.db,
                req.params.id,
                req.body || {},
                now
            );
            res.json({ ok: true, inspiration });
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    router.delete("/inspirations/:id", async (req, res) => {
        try {
            res.json({
                ok: true,
                ...(await deleteCreativeInspiration(
                    req.creativeScope.db,
                    req.params.id
                ))
            });
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    router.post("/artworks/upload", async (req, res) => {
        try {
            const encoded = String(req.body?.data || "")
                .replace(/^data:[^;]+;base64,/, "")
                .replace(/\s/g, "");
            if (
                !encoded ||
                encoded.length > 17_000_000 ||
                !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
            ) {
                res.status(400).json({
                    ok: false,
                    code: "creative_upload_invalid",
                    error: "creative_upload_invalid",
                    message: "上传图片的数据无法读取。"
                });
                return;
            }
            const artwork = await req.creativeCenter.uploadArtwork({
                bytes: Buffer.from(encoded, "base64"),
                mimeType: req.body?.mime_type,
                kind: req.body?.kind,
                title: req.body?.title,
                description: req.body?.description,
                altText: req.body?.alt_text
            });
            res.status(201).json({
                ok: true,
                artwork: req.creativeCenter.publicArtwork(artwork)
            });
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    router.post("/ideas", async (req, res) => {
        try {
            const creativeSettings =
                await req.creativeCenter.getSettingsRow();
            const decision = await planCreativeArtwork({
                database: req.creativeScope.db,
                getSettings,
                generateReply,
                requestedKind: req.body?.kind || "doodle",
                autonomous: false,
                allowSurprise: false,
                maxSurpriseDays: creativeSettings.max_surprise_days,
                now,
                random
            });
            if (!decision.create) {
                res.json({
                    ok: true,
                    created: false,
                    reason:
                        decision.reason === "needs_more_context"
                            ? "最近聊天还不够形成真实构思，这次先不乱画。"
                            : "这次没有形成想画的内容。"
                });
                return;
            }
            const generateImmediately =
                creativeSettings.generation_mode === "autonomous" &&
                req.body?.acknowledge_cost === true;
            const created = await req.creativeCenter.createIdea(decision, {
                allowSurprise: false,
                generateImmediately
            });
            let artwork = created.row;
            let message = null;
            if (generateImmediately) {
                artwork = await req.creativeCenter.generateArtwork(
                    artwork.id
                );
                if (
                    artwork.visibility === "ordinary" &&
                    artwork.state === "ready" &&
                    artwork.storage_path
                ) {
                    message = await publishArtworkMessage({
                        database: req.creativeScope.db,
                        center: req.creativeCenter,
                        artwork,
                        now
                    });
                }
            }
            res.status(201).json({
                ok: true,
                created: true,
                requires_confirmation: !generateImmediately,
                message_id: message?.id || null,
                artwork: req.creativeCenter.publicArtwork(artwork)
            });
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    router.post("/artworks/:id/generate", async (req, res) => {
        try {
            if (req.body?.acknowledge_cost !== true) {
                res.status(409).json({
                    ok: false,
                    error: "creative_cost_confirmation_required",
                    message:
                        "这一步会真实调用你配置的图片接口。请确认后再生成。"
                });
                return;
            }
            const artwork = await req.creativeCenter.generateArtwork(
                req.params.id
            );
            let message = null;
            if (
                ((artwork.visibility === "ordinary" &&
                    artwork.state === "ready") ||
                    (artwork.visibility === "surprise" &&
                        artwork.state === "revealed")) &&
                artwork.storage_path
            ) {
                message = await publishArtworkMessage({
                    database: req.creativeScope.db,
                    center: req.creativeCenter,
                    artwork,
                    surpriseReveal:
                        artwork.visibility === "surprise" &&
                        artwork.state === "revealed",
                    now
                });
            }
            res.json({
                ok: true,
                message_id: message?.id || null,
                artwork: req.creativeCenter.publicArtwork(artwork)
            });
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    router.get("/artworks/:id/image", async (req, res) => {
        try {
            const image = await req.creativeCenter.downloadArtwork(
                req.params.id
            );
            res.set("Content-Type", image.mimeType);
            res.set("Content-Length", String(image.bytes.length));
            res.set("Content-Disposition", "inline");
            res.set("X-Content-Type-Options", "nosniff");
            res.send(image.bytes);
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    router.delete("/artworks/:id", async (req, res) => {
        try {
            res.json({
                ok: true,
                ...(await req.creativeCenter.deleteArtwork(req.params.id))
            });
        } catch (error) {
            sendCreativeError(res, error);
        }
    });

    return router;
}

module.exports = { createCompanionCreativeRouter };
