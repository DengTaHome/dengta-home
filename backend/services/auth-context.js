const { createHash } = require("node:crypto");
const { createRequestScope } = require("./request-scope");

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function bearerToken(value) {
    const match = String(value || "").match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : "";
}

function installationToken(value) {
    const token = String(value || "").trim();
    return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : "";
}

function installationTokenHash(token) {
    return createHash("sha256").update(token).digest("hex");
}

function booleanEnv(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function authError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function verifiedUser(user) {
    return Boolean(user?.email && (user.email_confirmed_at || user.confirmed_at));
}

async function ensureAccount({
    adminSupabase,
    user,
    requestedCompanionId,
    initialOwnerEmail
}) {
    const isInitialOwner =
        Boolean(cleanEmail(initialOwnerEmail)) &&
        cleanEmail(user.email) === cleanEmail(initialOwnerEmail);
    const { data: existing, error: existingError } = await adminSupabase
        .from("user_profiles")
        .select(
            "id, email, display_name, role, status, companion_limit, storage_used_bytes, storage_quota_bytes"
        )
        .eq("id", user.id)
        .maybeSingle();
    if (existingError) throw existingError;

    let profile = existing;
    let profileChanged = false;

    if (!existing) {
        const { error } = await adminSupabase.from("user_profiles").insert({
            id: user.id,
            email: cleanEmail(user.email),
            display_name: String(
                user.user_metadata?.display_name || ""
            ).slice(0, 80),
            role: isInitialOwner ? "owner" : "member"
        });
        if (error) throw error;
        profileChanged = true;
    }

    if (isInitialOwner && existing?.role !== "owner") {
        const { error } = await adminSupabase.rpc(
            "finalize_legacy_owner_migration",
            { p_owner_user_id: user.id }
        );
        if (error) throw error;
        profileChanged = true;
    }

    if (profileChanged) {
        const { data, error } = await adminSupabase
            .from("user_profiles")
            .select(
                "id, email, display_name, role, status, companion_limit, storage_used_bytes, storage_quota_bytes"
            )
            .eq("id", user.id)
            .single();
        if (error) throw error;
        profile = data;
    }
    if (profile.status !== "active") {
        throw authError(
            403,
            "account_inactive",
            "这个账号当前不能使用，请联系管理员。"
        );
    }

    let { data: companions, error: companionsError } = await adminSupabase
        .from("companions")
        .select(
            "id, user_id, name, is_default, status, created_at, updated_at"
        )
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
    if (companionsError) throw companionsError;

    if (!companions?.length) {
        const { data: created, error } = await adminSupabase
            .from("companions")
            .insert({
                user_id: user.id,
                name: "我的伴侣",
                is_default: true
            })
            .select(
                "id, user_id, name, is_default, status, created_at, updated_at"
            )
            .single();
        if (error) throw error;
        companions = [created];
    }

    const requested = String(requestedCompanionId || "").trim();
    if (requested && !UUID_PATTERN.test(requested)) {
        throw authError(
            400,
            "invalid_companion_id",
            "伴侣编号格式不正确。"
        );
    }
    const companion = requested
        ? companions.find((item) => item.id === requested)
        : companions.find((item) => item.is_default) || companions[0];
    if (!companion) {
        throw authError(
            404,
            "companion_not_found",
            "找不到这个伴侣，或它不属于当前账号。"
        );
    }
    return { profile, companions, companion };
}

async function installationRequestScope({
    adminSupabase,
    token,
    path,
    method = "GET",
    now = () => new Date()
}) {
    const normalizedMethod = String(method).toUpperCase();
    const coWatchSessionMatch = String(path || "").match(
        /^\/api\/v2\/co-watch\/sessions\/([^/]+)$/i
    );
    const coWatchReplyMatch = String(path || "").match(
        /^\/api\/v2\/co-watch\/sessions\/([^/]+)\/reply$/i
    );
    const coWatchPlaybackMatch = String(path || "").match(
        /^\/api\/v2\/co-watch\/sessions\/([^/]+)\/playback$/i
    );
    const coWatchMessagesMatch = String(path || "").match(
        /^\/api\/v2\/co-watch\/sessions\/([^/]+)\/messages$/i
    );
    const coWatchSessionIdPath = UUID_PATTERN.test(
        coWatchSessionMatch?.[1] || ""
    );
    const coWatchSessionReadPath =
        coWatchSessionIdPath || coWatchSessionMatch?.[1] === "active";
    const coWatchReplyPath = UUID_PATTERN.test(
        coWatchReplyMatch?.[1] || ""
    );
    const coWatchPlaybackPath = UUID_PATTERN.test(
        coWatchPlaybackMatch?.[1] || ""
    );
    const coWatchMessagesPath = UUID_PATTERN.test(
        coWatchMessagesMatch?.[1] || ""
    );
    const permitted =
        (normalizedMethod === "GET" &&
            (["/api/v2/settings", "/api/v2/push/messages"].includes(path) ||
                coWatchSessionReadPath ||
                coWatchMessagesPath)) ||
        (normalizedMethod === "POST" &&
            ([
                "/api/v2/co-watch/frame",
                "/api/v2/co-watch/sessions"
            ].includes(path) ||
                coWatchReplyPath)) ||
        (normalizedMethod === "PATCH" &&
            (coWatchSessionIdPath || coWatchPlaybackPath));
    if (!permitted) {
        throw authError(
            403,
            "installation_scope_forbidden",
            "这个安装凭据不能访问该接口。"
        );
    }
    const { data: installation, error: installationError } =
        await adminSupabase
            .from("push_installations")
            .select(
                "id, user_id, companion_id, installation_id, provider, enabled, expires_at, revoked_at"
            )
            .eq("token_hash", installationTokenHash(token))
            .eq("provider", "local_poll")
            .maybeSingle();
    if (installationError) throw installationError;
    const expiresAt = Date.parse(installation?.expires_at || "");
    if (
        !installation ||
        installation.enabled !== true ||
        installation.revoked_at ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= new Date(now()).getTime()
    ) {
        throw authError(
            401,
            "installation_token_invalid",
            "后台通知安装凭据已失效，请重新打开 App。"
        );
    }
    const [profileResult, companionResult] = await Promise.all([
        adminSupabase
            .from("user_profiles")
            .select(
                "id, email, display_name, role, status, companion_limit, storage_used_bytes, storage_quota_bytes"
            )
            .eq("id", installation.user_id)
            .maybeSingle(),
        adminSupabase
            .from("companions")
            .select(
                "id, user_id, name, is_default, status, created_at, updated_at"
            )
            .eq("id", installation.companion_id)
            .eq("user_id", installation.user_id)
            .maybeSingle()
    ]);
    if (profileResult.error) throw profileResult.error;
    if (companionResult.error) throw companionResult.error;
    const profile = profileResult.data;
    const companion = companionResult.data;
    if (
        !profile ||
        profile.status !== "active" ||
        !companion ||
        companion.status !== "active"
    ) {
        throw authError(
            403,
            "installation_account_inactive",
            "这个后台通知安装已不再属于可用账号。"
        );
    }
    const user = {
        id: profile.id,
        email: profile.email || "",
        email_confirmed_at: true
    };
    return createRequestScope({
        adminSupabase,
        user,
        profile,
        companions: [companion],
        companion
    });
}

function createAuthContextMiddleware({
    adminSupabase,
    authRequired,
    initialOwnerEmail,
    publicPaths = [
        "/",
        "/health",
        "/api/weather/current",
        "/api/push/trigger",
        "/api/v2/co-watch/bilibili-resolve",
        "/api/v2/co-watch/bilibili-stream"
    ]
}) {
    const publicPathSet = new Set(publicPaths);
    return async function authContextMiddleware(req, res, next) {
        if (publicPathSet.has(req.path)) {
            next();
            return;
        }
        const token = bearerToken(req.headers.authorization);
        const backgroundToken = installationToken(
            req.headers["x-dengta-installation-token"]
        );
        if (!token && backgroundToken) {
            try {
                req.scope = await installationRequestScope({
                    adminSupabase,
                    token: backgroundToken,
                    path: req.path,
                    method: req.method
                });
                req.authKind = "notification_installation";
                res.setHeader(
                    "X-DengTa-Companion-Id",
                    req.scope.companionId
                );
                next();
            } catch (error) {
                next(error);
            }
            return;
        }
        if (!token && !authRequired) {
            next();
            return;
        }
        if (!token) {
            next(
                authError(
                    401,
                    "authentication_required",
                    "请先登录 DengTa Home。"
                )
            );
            return;
        }

        try {
            const { data, error } = await adminSupabase.auth.getUser(token);
            if (error || !data?.user) {
                throw authError(
                    401,
                    "invalid_session",
                    "登录状态已失效，请重新登录。"
                );
            }
            if (!verifiedUser(data.user)) {
                throw authError(
                    403,
                    "email_not_verified",
                    "请先完成邮箱验证。"
                );
            }
            const account = await ensureAccount({
                adminSupabase,
                user: data.user,
                requestedCompanionId:
                    req.headers["x-dengta-companion-id"],
                initialOwnerEmail
            });
            req.scope = createRequestScope({
                adminSupabase,
                user: data.user,
                ...account
            });
            res.setHeader("X-DengTa-Companion-Id", req.scope.companionId);
            next();
        } catch (error) {
            next(error);
        }
    };
}

module.exports = {
    authError,
    bearerToken,
    booleanEnv,
    cleanEmail,
    createAuthContextMiddleware,
    ensureAccount,
    installationRequestScope,
    installationToken,
    installationTokenHash,
    verifiedUser
};
