const express = require("express");
const { requireRequestScope } = require("../../services/request-scope");

function createFunLabsRouter(services = {}) {
    const dailies = services.dailies || null;
    const achievements = services.achievements || null;
    const funLabs = services.funLabs || null;
    const interestEngine = services.interestEngine || null;
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

    router.get("/daily-shots", async (req, res, next) => {
        try {
            if (!dailies) throw new Error("每日一拍服务还没启用。");
            const scope = requireRequestScope(req);
            const [todayShot, recentShots] = await Promise.all([
                dailies.today(scope),
                dailies.recent(scope, 14)
            ]);
            res.json({ today: todayShot, recent: recentShots });
        } catch (error) { next(error); }
    });

    router.get("/achievements", async (req, res, next) => {
        try {
            if (!achievements) throw new Error("成就服务还没启用。");
            const scope = requireRequestScope(req);
            await achievements.check(scope, new Date(), { refresh: true });
            res.json({ achievements: await achievements.list(scope) });
        } catch (error) { next(error); }
    });

    router.post("/achievements/custom", async (req, res, next) => {
        try {
            if (!achievements) throw new Error("成就服务还没启用。");
            const scope = requireRequestScope(req);
            res.json({ achievement: await achievements.define(scope, req.body || {}) });
        } catch (error) { next(error); }
    });

    router.delete("/achievements/custom/:id", async (req, res, next) => {
        try {
            if (!achievements) throw new Error("成就服务还没启用。");
            const scope = requireRequestScope(req);
            res.json({ ...(await achievements.removeCustom(scope, req.params.id)) });
        } catch (error) { next(error); }
    });

    router.post("/achievements/:code/unlock", async (req, res, next) => {
        try {
            if (!achievements) throw new Error("成就服务还没启用。");
            const scope = requireRequestScope(req);
            res.json({ unlocked: await achievements.unlock(scope, req.params.code) });
        } catch (error) { next(error); }
    });

    router.post("/onboarding", async (req, res, next) => {
        try {
            if (!achievements) throw new Error("成就服务还没启用。");
            const scope = requireRequestScope(req);
            const progress = await achievements.check(scope, new Date(), { refresh: true });
            if (!progress.unlocked.includes("first_chat")) {
                return res.status(409).json({ error: "完成第一次对话后，就可以收下入门纪念。", code: "onboarding_first_chat_required" });
            }
            const unlocked = await achievements.unlock(scope, "onboarding_1");
            res.json({ unlocked, achievements: await achievements.list(scope) });
        } catch (error) { next(error); }
    });

    router.get("/danmaku", async (req, res, next) => {
        try {
            if (!funLabs) throw new Error("弹幕共读服务还没启用。");
            res.json({ danmaku: await funLabs.readDanmaku(String(req.query.bvid || "")) });
        } catch (error) { next(error); }
    });

    router.post("/watch", async (req, res, next) => {
        try {
            if (!interestEngine) {
                const error = new Error("兴趣引擎还没启用。");
                error.status = 503;
                error.code = "interest_unavailable";
                return next(error);
            }
            const scope = requireRequestScope(req);
            res.json({ recorded: await interestEngine.recordWatch(scope, req.body || {}) });
        } catch (error) { next(error); }
    });

    router.get("/interests", async (req, res, next) => {
        try {
            if (!interestEngine) {
                const error = new Error("兴趣引擎还没启用。");
                error.status = 503;
                error.code = "interest_unavailable";
                return next(error);
            }
            const scope = requireRequestScope(req);
            res.json({ profile: await interestEngine.interests(scope) });
        } catch (error) { next(error); }
    });

    router.get("/recommend", async (req, res, next) => {
        try {
            if (!interestEngine) {
                const error = new Error("兴趣引擎还没启用。");
                error.status = 503;
                error.code = "interest_unavailable";
                return next(error);
            }
            const scope = requireRequestScope(req);
            res.json({
                recommend: await interestEngine.recommendBili(scope, {
                    keyword: String(req.query.keyword || ""),
                    limit: Number(req.query.limit) || 4,
                    exclude: String(req.query.exclude || "").split(",").filter(Boolean)
                })
            });
        } catch (error) { next(error); }
    });

    router.get("/compatibility", async (req, res, next) => {
        try {
            if (!funLabs) throw new Error("默契度服务还没启用。");
            const scope = requireRequestScope(req);
            res.json({ records: await funLabs.listCompatibility(scope) });
        } catch (error) { next(error); }
    });

    return router;
}

module.exports = { createFunLabsRouter };
