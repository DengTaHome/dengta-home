const express = require("express");
const {
    ATTACHMENT_BUCKET,
    findStoredAttachment,
    isSafeMessageId,
    publicMessage,
    storedAttachmentPathsForConversation
} = require("../../services/chat-attachments");
const { cleanModelId } = require("../../services/model-catalog");
const { readStreamPartial } = require("../../services/stream-persistence");
const { requireRequestScope } = require("../../services/request-scope");
const { describeImageWithDebug, visionConfig, visionConfigured } = require("../../services/vision-describe");

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function publicProfile(profile) {
    return {
        id: profile.id,
        email: profile.email,
        display_name: profile.display_name,
        role: profile.role,
        status: profile.status,
        companion_limit: profile.companion_limit,
        storage_used_bytes: profile.storage_used_bytes,
        storage_quota_bytes: profile.storage_quota_bytes,
        created_at: profile.created_at,
        updated_at: profile.updated_at
    };
}

function publicCompanion(companion) {
    return {
        id: companion.id,
        name: companion.name,
        is_default: companion.is_default,
        status: companion.status,
        created_at: companion.created_at,
        updated_at: companion.updated_at
    };
}

function publicAccount(scope) {
    return {
        user: {
            id: scope.user.id,
            email: scope.user.email,
            email_verified: Boolean(
                scope.user.email &&
                    (scope.user.email_confirmed_at ||
                        scope.user.confirmed_at)
            )
        },
        profile: publicProfile(scope.profile),
        companions: scope.companions.map(publicCompanion),
        active_companion: publicCompanion(scope.companion)
    };
}

async function blobBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value && typeof value.arrayBuffer === "function") {
        return Buffer.from(await value.arrayBuffer());
    }
    throw requestError(
        502,
        "attachment_download_failed",
        "附件暂时无法读取。"
    );
}

function createV2CoreRouter({
    storage,
    getSettings,
    resolveTurnModel
} = {}) {
    const router = express.Router();

    async function resolveSessionModel(
        scope,
        requestedModel,
        { required = false } = {}
    ) {
        const modelId = cleanModelId(requestedModel);
        if (requestedModel && !modelId) {
            throw requestError(
                400,
                "invalid_session_model",
                "会话模型格式不正确 / The session model format is invalid."
            );
        }
        if (required && !modelId) {
            throw requestError(
                400,
                "invalid_session_model",
                "会话模型不能为空 / The session model cannot be empty."
            );
        }
        if (
            typeof getSettings !== "function" ||
            typeof resolveTurnModel !== "function"
        ) {
            return modelId || null;
        }
        const settings = await getSettings(scope.db);
        const candidate = modelId || cleanModelId(settings?.model);
        if (!candidate) {
            if (required) {
                throw requestError(
                    400,
                    "invalid_session_model",
                    "会话模型不能为空 / The session model cannot be empty."
                );
            }
            return null;
        }
        return (await resolveTurnModel(settings, candidate)) || null;
    }

    router.use((req, res, next) => {
        try {
            requireRequestScope(req);
            res.set("Cache-Control", "private, no-store");
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get("/account", (req, res, next) => {
        try {
            res.json(publicAccount(requireRequestScope(req)));
        } catch (error) {
            next(error);
        }
    });

    router.post("/vision/models", async (req, res, next) => {
        try {
            requireRequestScope(req);
            if (!visionConfigured()) {
                const error = new Error("视觉服务还没有配置 VISION_API_KEY。");
                error.status = 503;
                error.code = "vision_unconfigured";
                throw error;
            }
            const config = visionConfig();
            const response = await fetch(`${config.baseUrl}/models`, {
                method: "GET",
                headers: { Authorization: `Bearer ${config.apiKey}` },
                signal: AbortSignal.timeout(30000)
            });
            const json = await response.json().catch(() => ({}));
            const ids = Array.isArray(json?.data)
                ? json.data.map((item) => String(item?.id || "")).filter(Boolean).sort()
                : [];
            res.json({ http_status: response.status, count: ids.length, models: ids });
        } catch (error) {
            next(error);
        }
    });
    router.post("/vision/describe", async (req, res, next) => {
        try {
            requireRequestScope(req);
            if (!visionConfigured()) {
                const error = new Error("视觉服务还没有配置 VISION_API_KEY。");
                error.status = 503;
                error.code = "vision_unconfigured";
                throw error;
            }
            const base64 = String(req.body?.image_base64 || "").trim();
            if (!base64) {
                const error = new Error("请提供 image_base64 字段。");
                error.status = 400;
                error.code = "vision_image_missing";
                throw error;
            }
            const buffer = Buffer.from(base64, "base64");
            if (buffer.length === 0 || buffer.length > 12 * 1024 * 1024) {
                const error = new Error("图片数据无效或超过 12MB。");
                error.status = 400;
                error.code = "vision_image_invalid";
                throw error;
            }
            const mimeType = String(req.body?.mime_type || "image/png").trim();
            const overrideModel = String(req.body?.model || "").trim();
            const config = overrideModel && /^[A-Za-z0-9.\/-]{1,80}$/.test(overrideModel)
                ? { ...visionConfig(), model: overrideModel }
                : visionConfig();
            const result = await describeImageWithDebug(buffer, mimeType, config);
            res.json({
                description: result.text,
                ...(result.text ? {} : { vision_debug: result.debug })
            });
        } catch (error) {
            next(error);
        }
    });
    router.get("/sessions", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const { data, error } = await scope.db
                .from("conversations")
                .select("id, title, model_id, created_at, updated_at")
                .order("updated_at", { ascending: false });
            if (error) throw error;
            res.json({ sessions: data ?? [] });
        } catch (error) {
            next(error);
        }
    });

    router.post("/sessions", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            if (
                req.body?.title !== undefined &&
                typeof req.body.title !== "string"
            ) {
                throw requestError(
                    400,
                    "invalid_session_title",
                    "会话名称格式不正确。"
                );
            }
            const title =
                String(req.body?.title || "").trim().slice(0, 60) ||
                "新对话";
            const requestedModel =
                req.body?.model_id ?? req.body?.model ?? "";
            if (
                requestedModel !== "" &&
                typeof requestedModel !== "string"
            ) {
                throw requestError(
                    400,
                    "invalid_session_model",
                    "会话模型格式不正确 / The session model format is invalid."
                );
            }
            const modelId = await resolveSessionModel(scope, requestedModel);
            const { data, error } = await scope.db
                .from("conversations")
                .insert({ title, model_id: modelId || null })
                .select("id, title, model_id, created_at, updated_at")
                .single();
            if (error) throw error;
            res.status(201).json({ session: data });
        } catch (error) {
            next(error);
        }
    });

    router.patch("/sessions/:id", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            if (!UUID_PATTERN.test(req.params.id)) {
                throw requestError(
                    400,
                    "invalid_session_id",
                    "会话编号格式不正确。"
                );
            }
            const hasTitle = Object.prototype.hasOwnProperty.call(
                req.body || {},
                "title"
            );
            const hasModel =
                Object.prototype.hasOwnProperty.call(
                    req.body || {},
                    "model_id"
                ) ||
                Object.prototype.hasOwnProperty.call(
                    req.body || {},
                    "model"
                );
            if (!hasTitle && !hasModel) {
                throw requestError(
                    400,
                    "empty_session_update",
                    "没有需要保存的会话设置。"
                );
            }

            const updates = {};
            if (hasTitle) {
                if (typeof req.body.title !== "string") {
                    throw requestError(
                        400,
                        "invalid_session_title",
                        "会话名称格式不正确。"
                    );
                }
                const title = req.body.title.trim().slice(0, 60);
                if (!title) {
                    throw requestError(
                        400,
                        "invalid_session_title",
                        "会话名称不能为空。"
                    );
                }
                updates.title = title;
                updates.updated_at = new Date().toISOString();
            }
            if (hasModel) {
                const requestedModel =
                    req.body?.model_id ?? req.body?.model ?? "";
                if (typeof requestedModel !== "string") {
                    throw requestError(
                        400,
                        "invalid_session_model",
                        "会话模型格式不正确 / The session model format is invalid."
                    );
                }
                updates.model_id = await resolveSessionModel(
                    scope,
                    requestedModel,
                    { required: true }
                );
            }

            const { data, error } = await scope.db
                .from("conversations")
                .update(updates)
                .eq("id", req.params.id)
                .select("id, title, model_id, created_at, updated_at")
                .maybeSingle();
            if (error) throw error;
            if (!data) {
                throw requestError(
                    404,
                    "session_not_found",
                    "找不到这个会话。"
                );
            }
            res.json({ session: data });
        } catch (error) {
            next(error);
        }
    });

    router.delete("/sessions/:id", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            if (!UUID_PATTERN.test(req.params.id)) {
                throw requestError(
                    400,
                    "invalid_session_id",
                    "会话编号格式不正确。"
                );
            }
            const { data: session, error: sessionError } = await scope.db
                .from("conversations")
                .select("id")
                .eq("id", req.params.id)
                .maybeSingle();
            if (sessionError) throw sessionError;
            if (!session) {
                throw requestError(
                    404,
                    "session_not_found",
                    "找不到这个会话。"
                );
            }

            const { data: messages, error: messagesError } = await scope.db
                .from("messages")
                .select("tool_calls")
                .eq("conversation_id", req.params.id);
            if (messagesError) throw messagesError;
            const attachmentPaths = storedAttachmentPathsForConversation(
                messages,
                req.params.id
            );

            const { error } = await scope.db
                .from("conversations")
                .delete()
                .eq("id", req.params.id);
            if (error) throw error;

            if (
                attachmentPaths.length > 0 &&
                storage &&
                typeof storage.from === "function"
            ) {
                await storage
                    .from(ATTACHMENT_BUCKET)
                    .remove(attachmentPaths)
                    .catch(() => {});
            }
            res.status(204).send();
        } catch (error) {
            next(error);
        }
    });

    router.get("/sessions/:id/messages", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            if (!UUID_PATTERN.test(req.params.id)) {
                throw requestError(
                    400,
                    "invalid_session_id",
                    "会话编号格式不正确。"
                );
            }
            const { data: session, error: sessionError } = await scope.db
                .from("conversations")
                .select("id")
                .eq("id", req.params.id)
                .maybeSingle();
            if (sessionError) throw sessionError;
            if (!session) {
                throw requestError(
                    404,
                    "session_not_found",
                    "找不到这个会话。"
                );
            }

            const { data, error } = await scope.db
                .from("messages")
                .select(
                    "id, role, content, created_at, tool_calls, " +
                        "reply_to_message_id, reply_snapshot"
                )
                .eq("conversation_id", req.params.id)
                .eq("visible", true)
                .order("created_at", { ascending: true });
            if (error) throw error;
            const messages = (data ?? []).map((message) =>
                publicMessage(message, {
                    basePath: "/api/v2/attachments"
                })
            );
            // 断点续看：生成到一半刷新/断线时，把已经落库的部分回复当作
            // 一条临时助手消息接在末尾。前端不需要任何改动就能看到已生成的内容。
            // 正式消息落库后这条缓冲行会被删除，所以下次刷新不会重复。
            const streamingPartial = await readStreamPartial({
                database: scope.db,
                conversationId: req.params.id
            });
            if (streamingPartial?.content) {
                messages.push({
                    id: `streaming-partial:${streamingPartial.clientMessageId || "unknown"}`,
                    role: "assistant",
                    content: streamingPartial.content,
                    created_at: streamingPartial.updatedAt,
                    tool_calls: {}
                });
            }
            res.json({ messages });
        } catch (error) {
            next(error);
        }
    });

    router.get(
        "/attachments/:messageId/:attachmentId",
        async (req, res, next) => {
            try {
                const scope = requireRequestScope(req);
                if (
                    !isSafeMessageId(req.params.messageId) ||
                    !UUID_PATTERN.test(req.params.attachmentId)
                ) {
                    throw requestError(
                        400,
                        "invalid_attachment_id",
                        "附件编号格式不正确。"
                    );
                }
                const { data: message, error } = await scope.db
                    .from("messages")
                    .select("id, conversation_id, tool_calls")
                    .eq("id", req.params.messageId)
                    .maybeSingle();
                if (error) throw error;
                const attachment = findStoredAttachment(
                    message?.tool_calls,
                    req.params.attachmentId
                );
                const expectedPrefix = `${String(
                    message?.conversation_id || ""
                ).toLowerCase()}/`;
                if (
                    !attachment ||
                    !UUID_PATTERN.test(message?.conversation_id || "") ||
                    !String(attachment.storage_path || "")
                        .toLowerCase()
                        .startsWith(expectedPrefix)
                ) {
                    throw requestError(
                        404,
                        "attachment_not_found",
                        "找不到这个附件。"
                    );
                }
                if (!storage || typeof storage.from !== "function") {
                    throw requestError(
                        503,
                        "attachment_storage_unavailable",
                        "附件存储暂时不可用。"
                    );
                }
                const { data: blob, error: downloadError } = await storage
                    .from(ATTACHMENT_BUCKET)
                    .download(attachment.storage_path);
                if (downloadError || !blob) {
                    throw requestError(
                        404,
                        "attachment_not_found",
                        "找不到这个附件。"
                    );
                }
                const buffer = await blobBuffer(blob);
                const filename =
                    String(attachment.name || "attachment")
                        .replace(/[\r\n"]/g, "")
                        .slice(0, 180) || "attachment";
                const disposition = ["image", "text"].includes(
                    attachment.kind
                )
                    ? "inline"
                    : "attachment";
                res.set({
                    "Content-Type":
                        attachment.mime_type || "application/octet-stream",
                    "Content-Length": String(buffer.length),
                    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(
                        filename
                    )}`,
                    "Cache-Control": "private, max-age=300",
                    "X-Content-Type-Options": "nosniff"
                });
                res.send(buffer);
            } catch (error) {
                next(error);
            }
        }
    );

    return router;
}

module.exports = {
    createV2CoreRouter
};
