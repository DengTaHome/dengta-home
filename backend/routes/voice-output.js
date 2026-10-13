const express = require("express");
const { requireRequestScope } = require("../services/request-scope");
const {
    createVoiceProviderCenter,
    publicVoiceProviderError
} = require("../services/voice-provider-center");

function sendError(res, error) {
    const safe = publicVoiceProviderError(error);
    if (safe.status >= 500) {
        console.error("voice_provider_request_failed", {
            code: safe.code,
            status: safe.status
        });
    }
    res.status(safe.status).json({
        ok: false,
        error: safe.code,
        message: safe.message
    });
}

function createVoiceOutputRouter({ env = process.env, fetchImpl = fetch } = {}) {
    const router = express.Router();
    router.use((req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            req.voiceProviderCenter = createVoiceProviderCenter({
                database: scope.db,
                env,
                fetchImpl
            });
            res.set("Cache-Control", "private, no-store");
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get("/status", async (req, res) => {
        try {
            res.json(await req.voiceProviderCenter.status());
        } catch (error) {
            sendError(res, error);
        }
    });

    router.get("/", async (req, res) => {
        try {
            res.json({
                ok: true,
                voice_output: await req.voiceProviderCenter.readProfile()
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.put("/", async (req, res) => {
        try {
            res.json({
                ok: true,
                voice_output: await req.voiceProviderCenter.saveProfile(req.body || {})
            });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.delete("/", async (req, res) => {
        try {
            res.json({ ok: true, ...(await req.voiceProviderCenter.deleteProfile()) });
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post("/test", async (req, res) => {
        try {
            const speech = await req.voiceProviderCenter.testProfile(req.body || {});
            res.set({
                "Content-Type": speech.contentType,
                "Content-Length": String(speech.audio.length),
                "X-DengTa-Voice-Provider": speech.provider,
                "X-DengTa-Voice-Model": speech.model,
                "X-Content-Type-Options": "nosniff"
            });
            res.send(speech.audio);
        } catch (error) {
            sendError(res, error);
        }
    });

    router.post("/", async (req, res) => {
        try {
            const speech = await req.voiceProviderCenter.testProfile(req.body || {});
            res.set({
                "Content-Type": speech.contentType,
                "Content-Length": String(speech.audio.length),
                "X-DengTa-Voice-Provider": speech.provider,
                "X-DengTa-Voice-Model": speech.model,
                "X-Content-Type-Options": "nosniff"
            });
            res.send(speech.audio);
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}

module.exports = { createVoiceOutputRouter, sendError };
