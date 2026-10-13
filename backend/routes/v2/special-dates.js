const express = require("express");
const { requireRequestScope } = require("../../services/request-scope");

function createSpecialDatesRouter(services = {}) {
    const dates = services.dates || null;
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
    const requireService = (req, res, next) => {
        if (!dates) {
            const error = new Error("特殊日子服务还没有启用。");
            error.status = 503;
            error.code = "special_dates_unavailable";
            return next(error);
        }
        next();
    };

    router.get("/", requireService, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ dates: await dates.list(scope, req.query.kind) });
        } catch (error) { next(error); }
    });

    router.post("/", requireService, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ date: await dates.add(scope, req.body || {}) });
        } catch (error) { next(error); }
    });

    router.delete("/:id", requireService, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ ...(await dates.remove(scope, req.params.id)) });
        } catch (error) { next(error); }
    });

    router.get("/upcoming", requireService, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ upcoming: await dates.upcoming(scope, req.query.days) });
        } catch (error) { next(error); }
    });

    return router;
}

module.exports = { createSpecialDatesRouter };
