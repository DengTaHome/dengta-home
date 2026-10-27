const express = require("express");
const { requireRequestScope } = require("../services/request-scope");
const { createDeepHealthProbe } = require("../services/health-deep");

/**
 * GET /api/v2/health/deep —— 需要登录的深度健康检查。
 *
 * 探针逻辑在 services/health-deep.js，这里只负责鉴权与转发。
 * 公开的 /health 不做数据库查询，也不应该做。
 */
function createHealthDeepRouter({ database, probe, cacheMs, now } = {}) {
    const resolvedProbe =
        probe ||
        createDeepHealthProbe({
            database,
            ...(cacheMs ? { cacheMs } : {}),
            ...(now ? { now } : {})
        });

    const router = express.Router();

    router.get("/deep", async (req, res, next) => {
        try {
            requireRequestScope(req);
            const { status, body } = await resolvedProbe.check();
            res.set("Cache-Control", "private, no-store");
            return res.status(status).json(body);
        } catch (error) {
            return next(error);
        }
    });

    return router;
}

module.exports = { createHealthDeepRouter };
