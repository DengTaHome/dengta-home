const express = require("express");
const { requireRequestScope } = require("../services/request-scope");

/**
 * 心潮 (xinchao) 只读接口。
 *
 * 契约来自生产前端（App chunk）里的实际调用：
 *   const payload = await api("/api/v2/xinchao/state");
 *   payload.configured === true && payload.state ? payload.state : null
 *
 * 所以成功响应必须是 { configured: boolean, state: object|null }，
 * 且 state 里 drives[].value 是 0..1 的小数。
 */
function createXinchaoRouter({ xinchao }) {
    if (!xinchao || typeof xinchao.getState !== "function") {
        throw new Error("createXinchaoRouter requires a xinchao service.");
    }

    const router = express.Router();

    router.get("/state", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const payload = await xinchao.getState({ scope });
            // 状态随时在漂移，且属于私人数据，不允许中间层缓存。
            res.set("Cache-Control", "private, no-store");
            return res.json(payload);
        } catch (error) {
            return next(error);
        }
    });

    return router;
}

module.exports = { createXinchaoRouter };
