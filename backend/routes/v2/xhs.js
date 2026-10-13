const express = require("express");
const { requireRequestScope } = require("../../services/request-scope");
const { createXhsClient, extractXhsId } = require("../../services/xhs-client");

function createXhsRouter(services = {}) {
    const client = services.client || createXhsClient();
    const database = services.database || null;
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

    // 登录状态本地记录(用于前端展示账号状态)
    async function saveConnection(scope, values) {
        if (!database?.from) throw Object.assign(new Error("服务器登录态存储尚未配置，请稍后重试。"), { status: 503, code: "xhs_storage_unconfigured" });
        const { data: existing, error: readError } = await database
            .from("xhs_connections")
            .select("id")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .maybeSingle();
        if (readError) throw Object.assign(new Error("无法读取当前账号的登录态记录，请稍后重试。"), { status: 503, code: "xhs_storage_read_failed" });
        const receipt = existing?.id
            ? await database.from("xhs_connections").update(values).eq("id", existing.id).eq("user_id", scope.userId).eq("companion_id", scope.companionId).select("id").maybeSingle()
            : await database.from("xhs_connections").insert({ user_id: scope.userId, companion_id: scope.companionId, ...values }).select("id").single();
        if (receipt.error) throw Object.assign(new Error("登录态记录保存失败，请检查连接后重试。"), { status: 503, code: "xhs_storage_write_failed" });
        if (!receipt.data?.id) throw Object.assign(new Error("没有收到登录态保存确认，请刷新后检查，暂勿重复提交。"), { status: 502, code: "xhs_storage_receipt_invalid" });
    }

    async function touchConnection(scope, cookiePresent = true) {
        await saveConnection(scope, {
            status: cookiePresent ? "active" : "expired",
            cookie_present: cookiePresent,
            logged_in_at: cookiePresent ? new Date().toISOString() : null,
            updated_at: new Date().toISOString()
        });
    }

    router.post("/login/start", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const started = await client.loginStart();
            res.json({ login: started, note: "请用小红书 App 扫码;写操作前我们会先征得你的同意。" });
        } catch (error) { next(error); }
    });

    // 内置浏览器导入登录态 Cookie：优先转发给小红书服务；
    // 服务未部署时降级为本地加密存储（拿到登录态也能保存，服务就绪后即可用）。
    router.post("/login/cookie", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const cookie = String(req.body?.cookie || "").trim();
            if (!cookie) {
                const error = new Error("缺少小红书登录 Cookie。");
                error.status = 400;
                error.code = "xhs_cookie_required";
                return next(error);
            }
            let stored = false;
            if (client.configured()) {
                try {
                    const result = await client.setCookie(cookie);
                    stored = true;
                    await touchConnection(scope, true);
                    return res.json({ ok: true, mode: "service", ...(result || {}) });
                } catch (serviceError) {
                    if (serviceError?.code !== "xhs_service_unconfigured") {
                        throw serviceError;
                    }
                }
            }
            // 本地加密存储降级：cookie 先保存，等服务部署后自动可用。
            const { encryptCredential, hasCredentialEncryption } = require("../../services/mcp-device-center");
            if (!hasCredentialEncryption(process.env)) {
                const error = new Error("服务器还没有配置凭据加密密钥，暂时不能保存小红书登录。");
                error.status = 503;
                error.code = "xhs_encryption_unconfigured";
                return next(error);
            }
            const ciphertext = encryptCredential(cookie, process.env);
            await saveConnection(scope, { status: "active", cookie_present: true, cookie_ciphertext: ciphertext,
                logged_in_at: new Date().toISOString(), updated_at: new Date().toISOString() });
            res.json({ ok: true, mode: "local", note: "小红书服务尚未部署，登录态已保存在账号下；服务就绪后即可使用。" });
        } catch (error) { next(error); }
    });

    router.get("/login/status", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const status = await client.loginStatus(String(req.query.session || ""));
            if (status.status === "done") await touchConnection(scope, true);
            res.json({ status });
        } catch (error) { next(error); }
    });

    router.get("/me", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const me = await client.me();
            await touchConnection(scope, true);
            res.json({ me });
        } catch (error) {
            if (error?.code === "cookie_expired") {
                try {
                    await touchConnection(requireRequestScope(req), false);
                } catch (storageError) {
                    return next(storageError);
                }
            }
            next(error);
        }
    });

    router.delete("/logout", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            await client.logout();
            await touchConnection(scope, false);
            res.json({ ok: true, message: "已退出小红书登录。" });
        } catch (error) { next(error); }
    });

    router.get("/search", async (req, res, next) => {
        try {
            const result = await client.search(
                String(req.query.keyword || ""),
                Number(req.query.page) || 1,
                String(req.query.sort || "1")
            );
            res.json({ result });
        } catch (error) { next(error); }
    });

    router.get("/notes/:id/comments", async (req, res, next) => {
        try {
            const result = await client.comments(String(req.params.id || ""));
            res.json({ result });
        } catch (error) { next(error); }
    });

    router.post("/notes/like", async (req, res, next) => {
        try {
            const id = extractXhsId(req.body?.note_url || req.body?.note_id, "note");
            if (!id) {
                const error = new Error("请提供笔记链接。");
                error.status = 400;
                error.code = "xhs_note_id_required";
                return next(error);
            }
            res.json({ result: await client.like(id) });
        } catch (error) { next(error); }
    });

    router.post("/notes/comment", async (req, res, next) => {
        try {
            const id = extractXhsId(req.body?.note_url || req.body?.note_id, "note");
            const content = String(req.body?.content || "").trim().slice(0, 200);
            if (!id || !content) {
                const error = new Error("请提供笔记链接和评论内容。");
                error.status = 400;
                error.code = "xhs_comment_args_required";
                return next(error);
            }
            res.json({ result: await client.comment(id, content) });
        } catch (error) { next(error); }
    });

    router.post("/users/follow", async (req, res, next) => {
        try {
            const uid = extractXhsId(req.body?.user_url || req.body?.user_id, "user");
            if (!uid) {
                const error = new Error("请提供用户主页链接。");
                error.status = 400;
                error.code = "xhs_user_id_required";
                return next(error);
            }
            res.json({ result: await client.follow(uid) });
        } catch (error) { next(error); }
    });

    return router;
}

module.exports = { createXhsRouter };
