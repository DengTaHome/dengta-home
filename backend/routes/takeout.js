const express = require("express");
const { requireRequestScope } = require("../services/request-scope");

function createTakeoutRouter(services = {}) {
    const channel = services.channel || null;
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
    const requireChannel = (req, res, next) => {
        if (!channel) {
            const error = new Error("点餐通道还没有启用。");
            error.status = 503;
            error.code = "takeout_unavailable";
            return next(error);
        }
        next();
    };

    router.get("/pending", requireChannel, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ commands: await channel.pendingCommands(scope) });
        } catch (error) { next(error); }
    });

    router.post("/:id/ack", requireChannel, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ command: await channel.ackCommand(scope, req.params.id) });
        } catch (error) { next(error); }
    });

    router.post("/:id/progress", requireChannel, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ ...(await channel.postProgress(scope, req.params.id, req.body?.progress)) });
        } catch (error) { next(error); }
    });

    router.post("/:id/result", requireChannel, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ command: await channel.postResult(scope, req.params.id, req.body?.result) });
        } catch (error) { next(error); }
    });

    router.post("/:id/failure", requireChannel, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ command: await channel.postFailure(scope, req.params.id, req.body?.message) });
        } catch (error) { next(error); }
    });

    router.post("/:id/cancel", requireChannel, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ command: await channel.cancelCommand(scope, req.params.id) });
        } catch (error) { next(error); }
    });

    return router;
}

module.exports = { createTakeoutRouter };
