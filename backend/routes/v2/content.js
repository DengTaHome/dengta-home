const express = require("express");
const {
    randomBytes,
    randomUUID
} = require("node:crypto");
const { requireRequestScope } = require("../../services/request-scope");
const {
    installationToken,
    installationTokenHash
} = require("../../services/auth-context");
const {
    confirmIdentityProposals,
    listProfileVersions,
    restoreProfileVersion
} = require("../../services/companion-profile-versions");
const {
    filterMemoriesForContext,
    isProviderBoundaryResidue
} = require("../../services/persistent-memory-filter");

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOMENT_BUCKET = "moments";
const MAX_MOMENT_IMAGES = 4;
const MAX_MOMENT_IMAGE_BYTES = 5 * 1024 * 1024;
const MOMENT_FIELDS = [
    "id",
    "author",
    "content",
    "images",
    "reply_due_at",
    "reply_status",
    "liked",
    "reply_content",
    "replied_at",
    "reply_seen_at",
    "user_liked",
    "created_at"
].join(",");
const MOMENT_COMMENT_FIELDS = [
    "id",
    "moment_id",
    "author",
    "content",
    "reply_status",
    "seen_at",
    "created_at"
].join(",");
const DIARY_FIELDS = [
    "id",
    "title",
    "content",
    "mood",
    "happened_on",
    "source_message_ids",
    "source_window_start",
    "source_window_end",
    "created_at"
].join(",");
const PUSH_MESSAGE_FIELDS = [
    "id",
    "conversation_id",
    "role",
    "content",
    "created_at",
    "tool_calls"
].join(",");
const IMAGE_TYPES = Object.freeze({
    "image/jpeg": {
        extension: "jpg",
        signature(buffer) {
            return (
                buffer[0] === 0xff &&
                buffer[1] === 0xd8 &&
                buffer[2] === 0xff
            );
        }
    },
    "image/png": {
        extension: "png",
        signature(buffer) {
            return buffer
                .subarray(0, 8)
                .equals(
                    Buffer.from([
                        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a,
                        0x0a
                    ])
                );
        }
    },
    "image/webp": {
        extension: "webp",
        signature(buffer) {
            return (
                buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
                buffer.subarray(8, 12).toString("ascii") === "WEBP"
            );
        }
    },
    "image/gif": {
        extension: "gif",
        signature(buffer) {
            return ["GIF87a", "GIF89a"].includes(
                buffer.subarray(0, 6).toString("ascii")
            );
        }
    }
});

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function cleanText(value, maxLength) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function publicAccountSettings(scope, value, overrides = {}) {
    const settings = value && typeof value === "object" ? value : {};
    const userDisplayName = Object.hasOwn(overrides, "userDisplayName")
        ? overrides.userDisplayName
        : cleanText(scope.profile?.display_name, 80);
    const companionName = Object.hasOwn(overrides, "companionName")
        ? overrides.companionName
        : cleanText(settings.ai_name, 50) ||
          cleanText(scope.companion?.name, 50) ||
          "伴侣";
    return {
        ...settings,
        ai_name: companionName,
        user_display_name: userDisplayName,
        account_role: scope.role,
        account_status: scope.profile?.status || "active",
        storage_used_bytes: Number(scope.profile?.storage_used_bytes || 0),
        storage_quota_bytes: Number(scope.profile?.storage_quota_bytes || 0)
    };
}

async function updateAccountIdentity(scope, body = {}) {
    const has = (field) => Object.hasOwn(body, field);
    const identity = {
        userDisplayName: cleanText(scope.profile?.display_name, 80)
    };
    if (has("user_display_name")) {
        identity.userDisplayName = cleanText(body.user_display_name, 80);
        const { error } = await scope.db
            .from("user_profiles")
            .update({
                display_name: identity.userDisplayName,
                updated_at: new Date().toISOString()
            });
        if (error) throw error;
    }
    if (has("ai_name")) {
        identity.companionName =
            cleanText(body.ai_name, 50) ||
            cleanText(scope.companion?.name, 50) ||
            "伴侣";
        const { error } = await scope.db
            .from("companions")
            .update({
                name: identity.companionName,
                updated_at: new Date().toISOString()
            })
            .eq("id", scope.companionId);
        if (error) throw error;
    }
    return identity;
}

function runtimeStateObject(value, field) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw requestError(
            400,
            "runtime_state_invalid",
            `${field} 必须是对象。`
        );
    }
    let serialized;
    try {
        serialized = JSON.stringify(value);
    } catch {
        serialized = "";
    }
    if (!serialized || Buffer.byteLength(serialized, "utf8") > 64 * 1024) {
        throw requestError(
            413,
            "runtime_state_too_large",
            `${field} 不能超过 64KB。`
        );
    }
    return JSON.parse(serialized);
}

async function readCompanionRuntimeState(scope) {
    const { data, error } = await scope.db
        .from("companion_runtime_states")
        .select("status, interaction_stats, updated_at")
        .maybeSingle();
    if (error) throw error;
    return {
        status: data?.status || null,
        interaction_stats: data?.interaction_stats || null,
        updated_at: data?.updated_at || null
    };
}

async function saveCompanionRuntimeState(scope, body = {}) {
    const hasStatus = Object.hasOwn(body, "status");
    const hasInteractionStats = Object.hasOwn(body, "interaction_stats");
    if (!hasStatus && !hasInteractionStats) {
        throw requestError(
            400,
            "runtime_state_empty",
            "请提供需要保存的伴侣状态。"
        );
    }
    const current = await readCompanionRuntimeState(scope);
    const next = {
        status: hasStatus
            ? runtimeStateObject(body.status, "status")
            : current.status || {},
        interaction_stats: hasInteractionStats
            ? runtimeStateObject(body.interaction_stats, "interaction_stats")
            : current.interaction_stats || {},
        updated_at: new Date().toISOString()
    };
    const query = current.updated_at
        ? scope.db.from("companion_runtime_states").update(next)
        : scope.db.from("companion_runtime_states").insert(next);
    const { data, error } = await query
        .select("status, interaction_stats, updated_at")
        .single();
    if (error) throw error;
    return {
        status: data.status,
        interaction_stats: data.interaction_stats,
        updated_at: data.updated_at
    };
}

function positiveInteger(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
}

function isMissingRelationError(error) {
    return (
        error?.code === "42P01" ||
        error?.code === "PGRST205" ||
        /could not find the table|relation .* does not exist/i.test(
            error?.message || ""
        )
    );
}

function randomDelaySeconds(min, max, random = Math.random) {
    return min + Math.floor(random() * (max - min + 1));
}

function decodeMomentImages(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_MOMENT_IMAGES).map((item) => {
        const mimeType = cleanText(
            item?.type || item?.mime_type,
            80
        ).toLowerCase();
        const type = IMAGE_TYPES[mimeType];
        if (!type) {
            throw requestError(
                400,
                "moment_image_type_invalid",
                "动态图片只支持 JPG、PNG、WebP 或 GIF。"
            );
        }
        const rawData = String(item?.data || "")
            .replace(/^data:[^;]+;base64,/, "")
            .replace(/\s/g, "");
        if (!rawData || !/^[A-Za-z0-9+/]+={0,2}$/.test(rawData)) {
            throw requestError(
                400,
                "moment_image_invalid",
                "有一张动态图片无法读取。"
            );
        }
        const bytes = Buffer.from(rawData, "base64");
        if (
            !bytes.length ||
            bytes.length > MAX_MOMENT_IMAGE_BYTES
        ) {
            throw requestError(
                413,
                "moment_image_too_large",
                "每张动态图片必须小于 5MB。"
            );
        }
        if (!type.signature(bytes)) {
            throw requestError(
                400,
                "moment_image_signature_invalid",
                "图片扩展类型与真实文件内容不一致。"
            );
        }
        return {
            mimeType,
            extension: type.extension,
            bytes
        };
    });
}

function storedMomentImage(item) {
    if (
        item &&
        typeof item === "object" &&
        typeof item.storage_path === "string" &&
        item.storage_path
    ) {
        return {
            storagePath: item.storage_path,
            mimeType: cleanText(
                item.mime_type || "application/octet-stream",
                100
            ),
            byteSize: Math.max(0, Number(item.byte_size) || 0)
        };
    }
    if (typeof item !== "string" || !item) return null;
    try {
        const parsed = new URL(item);
        const marker = "/storage/v1/object/public/moments/";
        const index = parsed.pathname.indexOf(marker);
        if (index < 0) return null;
        const storagePath = decodeURIComponent(
            parsed.pathname.slice(index + marker.length)
        );
        if (!storagePath) return null;
        return {
            storagePath,
            mimeType: mimeTypeFromPath(storagePath),
            byteSize: 0
        };
    } catch {
        return null;
    }
}

function mimeTypeFromPath(storagePath) {
    const extension = String(storagePath || "")
        .split(".")
        .pop()
        .toLowerCase();
    return (
        {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            webp: "image/webp",
            gif: "image/gif"
        }[extension] || "application/octet-stream"
    );
}

function publicMoment(moment) {
    const images = Array.isArray(moment?.images) ? moment.images : [];
    return {
        id: moment.id,
        author: moment.author,
        content: moment.content,
        images: images
            .map((item, index) =>
                storedMomentImage(item)
                    ? `/api/v2/moments/${encodeURIComponent(
                          moment.id
                      )}/images/${index}`
                    : null
            )
            .filter(Boolean),
        liked: moment.liked === true,
        reply_content: moment.reply_content || null,
        replied_at: moment.replied_at || null,
        reply_seen_at: moment.reply_seen_at || null,
        user_liked: moment.user_liked === true,
        created_at: moment.created_at
    };
}

function publicMomentComment(comment) {
    return {
        id: comment.id,
        moment_id: comment.moment_id,
        author: comment.author,
        content: comment.content,
        seen_at: comment.seen_at || null,
        created_at: comment.created_at
    };
}

function publicDiaryEntry(entry) {
    const sourceIds = Array.isArray(entry?.source_message_ids)
        ? entry.source_message_ids
        : [];
    return {
        id: entry.id,
        title: entry.title,
        content: entry.content,
        mood: entry.mood,
        happened_on: entry.happened_on,
        source_window_start: entry.source_window_start,
        source_window_end: entry.source_window_end,
        created_at: entry.created_at,
        source_message_count: sourceIds.length
    };
}

async function requireMoment(scope, momentId, author) {
    if (!UUID_PATTERN.test(String(momentId || ""))) {
        throw requestError(
            400,
            "invalid_moment_id",
            "动态编号格式不正确。"
        );
    }
    const { data, error } = await scope.db
        .from("moments")
        .select("id, author, images")
        .eq("id", momentId)
        .maybeSingle();
    if (error) throw error;
    if (!data) {
        throw requestError(
            404,
            "moment_not_found",
            "找不到这条动态。"
        );
    }
    if (author && data.author !== author) {
        throw requestError(
            400,
            "moment_author_invalid",
            "这个操作只能用于 AI 发布的动态。"
        );
    }
    return data;
}

async function uploadMomentImages(
    storage,
    scope,
    images,
    now = () => Date.now()
) {
    const stored = [];
    const dateFolder = new Date(now()).toISOString().slice(0, 10);
    try {
        for (const image of images) {
            const storagePath = [
                scope.userId,
                scope.companionId,
                dateFolder,
                `${randomUUID()}.${image.extension}`
            ].join("/");
            const { error } = await storage
                .from(MOMENT_BUCKET)
                .upload(storagePath, image.bytes, {
                    contentType: image.mimeType,
                    upsert: false,
                    cacheControl: "3600"
                });
            if (error) throw error;
            stored.push({
                storage_path: storagePath,
                mime_type: image.mimeType,
                byte_size: image.bytes.length
            });
        }
        return stored;
    } catch (error) {
        await removeMomentImages(storage, stored);
        throw error;
    }
}

async function removeMomentImages(storage, images) {
    const paths = (images || [])
        .map((item) => storedMomentImage(item)?.storagePath)
        .filter(Boolean);
    if (!paths.length) return;
    try {
        await storage.from(MOMENT_BUCKET).remove(paths);
    } catch {
        // Database rollback remains the authoritative failure signal.
    }
}

async function blobBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value && typeof value.arrayBuffer === "function") {
        return Buffer.from(await value.arrayBuffer());
    }
    throw requestError(
        502,
        "moment_image_download_failed",
        "动态图片暂时无法读取。"
    );
}

function createV2ContentRouter({
    storage,
    readSettings,
    saveSettings,
    now = () => Date.now(),
    random = Math.random,
    installationTokenFactory = () =>
        randomBytes(32).toString("base64url")
} = {}) {
    if (!storage || typeof storage.from !== "function") {
        throw new Error("v2 content router requires storage");
    }
    if (
        typeof readSettings !== "function" ||
        typeof saveSettings !== "function"
    ) {
        throw new Error("v2 content router requires settings services");
    }

    const router = express.Router();
    router.use((req, res, next) => {
        try {
            requireRequestScope(req);
            res.set("Cache-Control", "private, no-store");
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get("/bootstrap", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const [storedSettings, sessionsResult, state] = await Promise.all([
                readSettings(scope),
                scope.db
                    .from("conversations")
                    .select("id, title, model_id, created_at, updated_at")
                    .order("updated_at", { ascending: false }),
                readCompanionRuntimeState(scope)
            ]);
            if (sessionsResult.error) throw sessionsResult.error;
            res.json({
                settings: publicAccountSettings(scope, storedSettings),
                sessions: sessionsResult.data ?? [],
                state
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/settings", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({
                settings: publicAccountSettings(
                    scope,
                    await readSettings(scope)
                )
            });
        } catch (error) {
            next(error);
        }
    });

    router.put("/settings", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const body = req.body || {};
            const identity = await updateAccountIdentity(scope, body);
            const settingsBody = Object.hasOwn(
                identity,
                "companionName"
            )
                ? { ...body, ai_name: identity.companionName }
                : body;
            res.json({
                settings: publicAccountSettings(
                    scope,
                    await saveSettings(scope, settingsBody),
                    identity
                )
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/companion-state", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({
                state: await readCompanionRuntimeState(scope)
            });
        } catch (error) {
            next(error);
        }
    });

    router.put("/companion-state", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({
                state: await saveCompanionRuntimeState(
                    scope,
                    req.body || {}
                )
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/push/messages", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const sinceText = cleanText(req.query.since, 64);
            const since = new Date(sinceText);
            if (!sinceText || Number.isNaN(since.getTime())) {
                throw requestError(
                    400,
                    "push_cursor_invalid",
                    "请提供正确的主动消息查询时间。"
                );
            }
            const limit = positiveInteger(
                req.query.limit,
                50,
                1,
                100
            );
            const { data, error } = await scope.db
                .from("messages")
                .select(PUSH_MESSAGE_FIELDS)
                .eq("role", "assistant")
                .eq("visible", true)
                .eq("context_visible", true)
                .contains("tool_calls", { is_push: true })
                .gte("created_at", since.toISOString())
                .order("created_at", { ascending: true })
                .limit(limit);
            if (error) throw error;
            res.json({
                messages: (data || []).map((message) => ({
                    id: message.id,
                    conversation_id: message.conversation_id,
                    role: "assistant",
                    content: message.content,
                    created_at: message.created_at,
                    is_push: true
                }))
            });
        } catch (error) {
            next(error);
        }
    });

    router.post(
        "/notification-installations/register",
        async (req, res, next) => {
            try {
                const scope = requireRequestScope(req);
                const deviceId = cleanText(req.body?.device_id, 80);
                if (!UUID_PATTERN.test(deviceId)) {
                    throw requestError(
                        400,
                        "notification_device_id_invalid",
                        "Android 安装编号格式不正确。"
                    );
                }
                if (
                    req.body?.platform &&
                    req.body.platform !== "android"
                ) {
                    throw requestError(
                        400,
                        "notification_platform_invalid",
                        "当前只支持 Android 后台通知。"
                    );
                }
                const token = installationToken(
                    installationTokenFactory()
                );
                if (!token) {
                    throw requestError(
                        500,
                        "notification_token_generation_failed",
                        "无法创建后台通知安装凭据。"
                    );
                }
                const createdAt = new Date(now());
                const expiresAt = new Date(
                    createdAt.getTime() +
                        30 * 24 * 60 * 60 * 1000
                ).toISOString();
                const lookup = await scope.db
                    .from("push_installations")
                    .select("id")
                    .eq("companion_id", scope.companionId)
                    .eq("installation_id", deviceId)
                    .eq("provider", "local_poll")
                    .maybeSingle();
                if (lookup.error) throw lookup.error;
                const values = {
                    companion_id: scope.companionId,
                    installation_id: deviceId,
                    provider: "local_poll",
                    platform: "android",
                    app_version: cleanText(
                        req.body?.app_version,
                        40
                    ),
                    token_ciphertext: null,
                    token_hash: installationTokenHash(token),
                    enabled: true,
                    last_seen_at: createdAt.toISOString(),
                    revoked_at: null,
                    expires_at: expiresAt,
                    updated_at: createdAt.toISOString()
                };
                const stored = lookup.data
                    ? await scope.db
                          .from("push_installations")
                          .update(values)
                          .eq("id", lookup.data.id)
                          .eq(
                              "companion_id",
                              scope.companionId
                          )
                    : await scope.db
                          .from("push_installations")
                          .insert(values);
                if (stored.error) throw stored.error;
                res.status(201).json({
                    installation_id: deviceId,
                    companion_id: scope.companionId,
                    installation_token: token,
                    expires_at: expiresAt
                });
            } catch (error) {
                next(error);
            }
        }
    );

    router.get("/memories", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const { data, error } = await scope.db
                .from("memories")
                .select(
                    "id, summary, confirmation_status, created_at, updated_at"
                )
                .eq("confirmation_status", "confirmed")
                .order("updated_at", { ascending: false });
            if (error) throw error;
            res.json({ memories: filterMemoriesForContext(data) });
        } catch (error) {
            next(error);
        }
    });

    router.patch("/memories/:id", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const memoryId = cleanText(req.params.id, 80);
            if (!UUID_PATTERN.test(memoryId)) {
                throw requestError(400, "invalid_memory_id", "记忆 ID 无效。");
            }
            const summary = cleanText(req.body?.summary, 4000);
            if (!summary) {
                throw requestError(
                    400,
                    "memory_summary_required",
                    "记忆内容不能为空。"
                );
            }
            if (isProviderBoundaryResidue(summary)) {
                const removed = await scope.db
                    .from("memories")
                    .delete()
                    .eq("id", memoryId)
                    .select("id")
                    .maybeSingle();
                if (removed.error) throw removed.error;
                if (!removed.data) {
                    throw requestError(404, "memory_not_found", "找不到这条记忆。");
                }
                res.json({ deleted: true, reason: "memory_summary_rejected" });
                return;
            }
            const { data, error } = await scope.db
                .from("memories")
                .update({
                    summary,
                    confirmation_status: "confirmed",
                    updated_at: new Date(now()).toISOString()
                })
                .eq("id", memoryId)
                .select(
                    "id, summary, confirmation_status, created_at, updated_at"
                )
                .maybeSingle();
            if (error) throw error;
            if (!data) {
                throw requestError(404, "memory_not_found", "找不到这条记忆。");
            }
            // 同步更新 memory_calendar 中的摘要（如果该记忆曾在压缩时写入日历）
            try {
                await scope.db
                    .from("memory_calendar")
                    .update({
                        summary,
                        updated_at: new Date(now()).toISOString()
                    })
                    .contains("source_ids", [memoryId]);
            } catch {
                // memory_calendar 表可能还不存在，日历同步是非必需的补充
            }
            res.json({ memory: data });
        } catch (error) {
            next(error);
        }
    });

    router.delete("/memories/:id", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const memoryId = cleanText(req.params.id, 80);
            if (!UUID_PATTERN.test(memoryId)) {
                throw requestError(400, "invalid_memory_id", "记忆 ID 无效。");
            }
            const { data, error } = await scope.db
                .from("memories")
                .delete()
                .eq("id", memoryId)
                .select("id")
                .maybeSingle();
            if (error) throw error;
            if (!data) {
                throw requestError(404, "memory_not_found", "找不到这条记忆。");
            }
            res.status(204).end();
        } catch (error) {
            next(error);
        }
    });

    router.get("/diary", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const { data, error } = await scope.db
                .from("companion_diary_entries")
                .select(DIARY_FIELDS)
                .order("created_at", { ascending: false })
                .limit(40);
            if (error) {
                if (isMissingRelationError(error)) {
                    res.json({
                        available: false,
                        entries: [],
                        message: "日记数据库还没有升级。"
                    });
                    return;
                }
                throw error;
            }
            res.json({
                available: true,
                entries: (data || []).map(publicDiaryEntry)
            });
        } catch (error) {
            next(error);
        }
    });

    router.get(
        "/companion-profile",
        async (req, res, next) => {
            try {
                const scope = requireRequestScope(req);
                res.json(
                    await listProfileVersions(scope.db, {
                        now: () => new Date(now())
                    })
                );
            } catch (error) {
                next(error);
            }
        }
    );

    router.post(
        "/companion-profile/identity/confirm",
        async (req, res, next) => {
            try {
                const scope = requireRequestScope(req);
                res.status(201).json({
                    version: await confirmIdentityProposals({
                        database: scope.db,
                        proposalIds: req.body?.proposal_ids,
                        clientActionId: req.body?.client_action_id,
                        now: () => new Date(now())
                    })
                });
            } catch (error) {
                next(error);
            }
        }
    );

    router.post(
        "/companion-profile/versions/:version/restore",
        async (req, res, next) => {
            try {
                const scope = requireRequestScope(req);
                res.status(201).json({
                    version: await restoreProfileVersion({
                        database: scope.db,
                        targetVersion: req.params.version,
                        clientActionId: req.body?.client_action_id,
                        now: () => new Date(now())
                    })
                });
            } catch (error) {
                next(error);
            }
        }
    );

    router.get("/moments", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const { data: moments, error } = await scope.db
                .from("moments")
                .select(MOMENT_FIELDS)
                .order("created_at", { ascending: false })
                .limit(30);
            if (error) {
                if (isMissingRelationError(error)) {
                    res.json({
                        available: false,
                        entries: [],
                        message: "朋友圈数据库还没有升级。"
                    });
                    return;
                }
                throw error;
            }

            const ids = (moments || []).map((item) => item.id);
            let comments = [];
            if (ids.length) {
                const result = await scope.db
                    .from("moment_comments")
                    .select(MOMENT_COMMENT_FIELDS)
                    .in("moment_id", ids)
                    .order("created_at", { ascending: true });
                if (result.error) throw result.error;
                comments = result.data || [];
            }
            res.json({
                available: true,
                entries: (moments || []).map((moment) => ({
                    ...publicMoment(moment),
                    comments: comments
                        .filter(
                            (comment) =>
                                comment.moment_id === moment.id
                        )
                        .map(publicMomentComment)
                }))
            });
        } catch (error) {
            next(error);
        }
    });

    router.post("/moments", async (req, res, next) => {
        const scope = requireRequestScope(req);
        let storedImages = [];
        let savedMoment = null;
        try {
            const content = cleanText(req.body?.content, 2000);
            const images = decodeMomentImages(req.body?.images);
            if (!content && !images.length) {
                throw requestError(
                    400,
                    "empty_moment",
                    "动态文字和图片不能同时为空。"
                );
            }

            const sessionId = cleanText(req.body?.session_id, 80);
            if (sessionId) {
                if (!UUID_PATTERN.test(sessionId)) {
                    throw requestError(
                        400,
                        "invalid_session_id",
                        "会话编号格式不正确。"
                    );
                }
                const result = await scope.db
                    .from("conversations")
                    .select("id")
                    .eq("id", sessionId)
                    .maybeSingle();
                if (result.error) throw result.error;
                if (!result.data) {
                    throw requestError(
                        404,
                        "session_not_found",
                        "找不到这个会话。"
                    );
                }
            }

            storedImages = await uploadMomentImages(
                storage,
                scope,
                images,
                now
            );
            const dueAt = new Date(
                now() +
                    randomDelaySeconds(60, 10 * 60 * 60, random) *
                        1000
            ).toISOString();
            const { data, error } = await scope.db
                .from("moments")
                .insert({
                    author: "user",
                    content,
                    context_note: sessionId
                        ? `active_session_id:${sessionId}`
                        : null,
                    images: storedImages,
                    reply_due_at: dueAt,
                    reply_status: "pending"
                })
                .select(MOMENT_FIELDS)
                .single();
            if (error) throw error;
            savedMoment = data;

            const job = await scope.db
                .from("background_jobs")
                .insert({
                    job_type: "moment_interaction",
                    due_at: dueAt,
                    dedupe_key: `moment:${data.id}:initial`,
                    payload: {
                        moment_id: data.id,
                        reason: "new_user_moment"
                    }
                })
                .select("id")
                .single();
            if (job.error) throw job.error;

            res.status(201).json({
                moment: {
                    ...publicMoment(data),
                    comments: []
                }
            });
        } catch (error) {
            if (savedMoment?.id) {
                await scope.db
                    .from("moments")
                    .delete()
                    .eq("id", savedMoment.id);
            }
            await removeMomentImages(storage, storedImages);
            next(error);
        }
    });

    router.post("/moments/:id/like", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            await requireMoment(scope, req.params.id, "assistant");
            const { data, error } = await scope.db
                .from("moments")
                .update({
                    user_liked: req.body?.liked === true
                })
                .eq("id", req.params.id)
                .select(MOMENT_FIELDS)
                .maybeSingle();
            if (error) throw error;
            if (!data) {
                throw requestError(
                    404,
                    "moment_not_found",
                    "找不到这条动态。"
                );
            }
            res.json({ moment: publicMoment(data) });
        } catch (error) {
            next(error);
        }
    });

    router.post(
        "/moments/:id/comments",
        async (req, res, next) => {
            const scope = requireRequestScope(req);
            let savedComment = null;
            try {
                await requireMoment(
                    scope,
                    req.params.id,
                    "assistant"
                );
                const content = cleanText(req.body?.content, 1000);
                if (!content) {
                    throw requestError(
                        400,
                        "empty_moment_comment",
                        "评论内容不能为空。"
                    );
                }
                const dueAt = new Date(
                    now() +
                        randomDelaySeconds(
                            60,
                            10 * 60 * 60,
                            random
                        ) *
                            1000
                ).toISOString();
                const { data, error } = await scope.db
                    .from("moment_comments")
                    .insert({
                        moment_id: req.params.id,
                        author: "user",
                        content,
                        reply_due_at: dueAt,
                        reply_status: "pending"
                    })
                    .select(MOMENT_COMMENT_FIELDS)
                    .single();
                if (error) throw error;
                savedComment = data;

                const job = await scope.db
                    .from("background_jobs")
                    .insert({
                        job_type: "moment_interaction",
                        due_at: dueAt,
                        dedupe_key: `moment-comment:${data.id}`,
                        payload: {
                            moment_id: req.params.id,
                            comment_id: data.id,
                            reason: "new_user_comment"
                        }
                    })
                    .select("id")
                    .single();
                if (job.error) throw job.error;

                res.status(201).json({
                    comment: publicMomentComment(data)
                });
            } catch (error) {
                if (savedComment?.id) {
                    await scope.db
                        .from("moment_comments")
                        .delete()
                        .eq("id", savedComment.id);
                }
                next(error);
            }
        }
    );

    router.get(
        "/moments/:id/images/:index",
        async (req, res, next) => {
            try {
                const scope = requireRequestScope(req);
                const moment = await requireMoment(
                    scope,
                    req.params.id
                );
                const index = Number(req.params.index);
                if (
                    !Number.isInteger(index) ||
                    index < 0 ||
                    index >= MAX_MOMENT_IMAGES
                ) {
                    throw requestError(
                        404,
                        "moment_image_not_found",
                        "找不到这张动态图片。"
                    );
                }
                const descriptor = storedMomentImage(
                    Array.isArray(moment.images)
                        ? moment.images[index]
                        : null
                );
                if (!descriptor) {
                    throw requestError(
                        404,
                        "moment_image_not_found",
                        "找不到这张动态图片。"
                    );
                }
                const { data, error } = await storage
                    .from(MOMENT_BUCKET)
                    .download(descriptor.storagePath);
                if (error || !data) {
                    throw requestError(
                        404,
                        "moment_image_not_found",
                        "找不到这张动态图片。"
                    );
                }
                const buffer = await blobBuffer(data);
                res.set({
                    "Content-Type": descriptor.mimeType,
                    "Content-Length": String(buffer.length),
                    "Cache-Control": "private, max-age=300",
                    "X-Content-Type-Options": "nosniff",
                    "Content-Disposition": "inline"
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
    createV2ContentRouter,
    decodeMomentImages,
    publicAccountSettings,
    publicDiaryEntry,
    publicMoment,
    publicMomentComment,
    readCompanionRuntimeState,
    saveCompanionRuntimeState,
    storedMomentImage,
    updateAccountIdentity
};
