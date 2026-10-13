const dns = require("node:dns").promises;
const {
    assertPublicMcpEndpoint,
    decryptCredential,
    encryptCredential,
    slugify
} = require("./mcp-device-center");
const { fetchProviderModels } = require("./model-catalog");
const {
    normalizeReasoningEffort
} = require("./provider-reasoning-effort");

const MAX_PROFILES = 24;
const PROTOCOLS = new Set([
    "openai-chat",
    "openai-responses",
    "anthropic",
    "gemini"
]);
const PROVIDER_PROBE_ERROR_MESSAGES = Object.freeze({
    AI_PROVIDER_CATALOG_CHECK_FAILED:
        "接口模型目录检查失败，请重新测试。",
    AI_PROVIDER_CREDENTIAL_INVALID:
        "接口凭据无法解密，请重新填写 API Key。",
    AI_PROVIDER_MODEL_CATALOG_UNAVAILABLE:
        "供应商没有提供可读取的模型目录，请确认 Base URL 和接口类型。",
    AI_PROVIDER_UPSTREAM_AUTH_FAILED:
        "供应商拒绝了接口凭据，请检查 API Key 和权限。",
    AI_PROVIDER_UPSTREAM_RATE_LIMITED:
        "供应商暂时限制了请求，请稍后重试或检查额度。",
    AI_PROVIDER_UPSTREAM_REJECTED:
        "供应商拒绝了模型目录检查，请核对接口配置。",
    AI_PROVIDER_UPSTREAM_TIMEOUT:
        "供应商接口响应超时，请稍后重试。",
    AI_PROVIDER_UPSTREAM_UNAVAILABLE:
        "供应商接口暂时不可用，请稍后重试。"
});

function createProviderError(message, code, status = 400, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    Object.assign(error, details);
    error.isPublicProviderError = true;
    return error;
}

function cleanText(value, maxLength) {
    return Array.from(String(value || "").trim()).slice(0, maxLength).join("");
}

function normalizeUpstreamStatus(value) {
    const status = Number(value);
    return Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : null;
}

function upstreamStatusFromError(error) {
    const direct = normalizeUpstreamStatus(
        error?.upstream_status ?? error?.upstreamStatus
    );
    if (direct) return direct;
    const match = String(error?.message || "").match(/\bHTTP\s+(\d{3})\b/i);
    return normalizeUpstreamStatus(match?.[1]);
}

function providerProbeError(error) {
    if (error?.code === "MCP_CREDENTIAL_INVALID") {
        return createProviderError(
            PROVIDER_PROBE_ERROR_MESSAGES.AI_PROVIDER_CREDENTIAL_INVALID,
            "AI_PROVIDER_CREDENTIAL_INVALID",
            503
        );
    }

    const upstreamStatus = upstreamStatusFromError(error);
    let code = "AI_PROVIDER_UPSTREAM_UNAVAILABLE";
    let status = 502;

    if (
        error?.name === "AbortError" ||
        ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(error?.code) ||
        upstreamStatus === 408 ||
        upstreamStatus === 504
    ) {
        code = "AI_PROVIDER_UPSTREAM_TIMEOUT";
        status = 504;
    } else if ([401, 403].includes(upstreamStatus)) {
        code = "AI_PROVIDER_UPSTREAM_AUTH_FAILED";
    } else if (upstreamStatus === 404) {
        code = "AI_PROVIDER_MODEL_CATALOG_UNAVAILABLE";
    } else if (upstreamStatus === 429) {
        code = "AI_PROVIDER_UPSTREAM_RATE_LIMITED";
    } else if (upstreamStatus && upstreamStatus < 500) {
        code = "AI_PROVIDER_UPSTREAM_REJECTED";
    }

    return createProviderError(
        PROVIDER_PROBE_ERROR_MESSAGES[code],
        code,
        status,
        upstreamStatus ? { upstream_status: upstreamStatus } : {}
    );
}

function providerErrorDiagnostic(error) {
    const code = Object.hasOwn(
        PROVIDER_PROBE_ERROR_MESSAGES,
        String(error?.code || "")
    )
        ? String(error.code)
        : "AI_PROVIDER_CATALOG_CHECK_FAILED";
    const upstreamStatus = upstreamStatusFromError(error);
    return [
        code,
        upstreamStatus ? `HTTP ${upstreamStatus}` : "",
        PROVIDER_PROBE_ERROR_MESSAGES[code]
    ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 300);
}

function safeStoredProviderError(value) {
    const text = cleanText(value, 300);
    if (!text) return null;
    const code = text.match(/^(AI_PROVIDER_[A-Z0-9_]{1,80})\b/)?.[1];
    if (!Object.hasOwn(PROVIDER_PROBE_ERROR_MESSAGES, code || "")) {
        return providerErrorDiagnostic({
            code: "AI_PROVIDER_CATALOG_CHECK_FAILED"
        });
    }
    const upstreamStatus = normalizeUpstreamStatus(
        text.match(/\bHTTP\s+(\d{3})\b/i)?.[1]
    );
    return providerErrorDiagnostic({ code, upstream_status: upstreamStatus });
}

function providerHealthSummary(row) {
    const checkedAt = row?.last_checked_at || null;
    if (isExpired(row)) {
        return {
            state: "expired",
            summary: "接口已到期",
            detail: "该接口已到期，不会参与模型选择。",
            checked_at: checkedAt
        };
    }
    if (row?.last_status === "connected") {
        return {
            state: "catalog_ok",
            summary: "模型目录可读取",
            detail:
                "已验证连接、凭据和模型目录；这不代表聊天生成请求一定成功。",
            checked_at: checkedAt
        };
    }
    if (row?.last_status === "error") {
        return {
            state: "catalog_error",
            summary: "模型目录检查失败",
            detail:
                safeStoredProviderError(row?.last_error) ||
                providerErrorDiagnostic({
                    code: "AI_PROVIDER_CATALOG_CHECK_FAILED"
                }),
            checked_at: checkedAt
        };
    }
    return {
        state: "untested",
        summary: "尚未检查模型目录",
        detail: "尚未执行供应商模型目录检查。",
        checked_at: checkedAt
    };
}

function publicProviderError(error) {
    if (error?.isPublicProviderError === true) {
        const status = Number(error.status) || 500;
        const upstreamStatus = upstreamStatusFromError(error);
        return {
            status,
            code: cleanText(error.code || "AI_PROVIDER_CENTER_ERROR", 100),
            message: cleanText(
                error.message || "多接口控制台暂时无法完成请求。",
                300
            ),
            ...(upstreamStatus ? { upstream_status: upstreamStatus } : {})
        };
    }
    return {
        status: 500,
        code: "AI_PROVIDER_CENTER_ERROR",
        message: "多接口控制台暂时无法完成请求。"
    };
}

function vaultEnv(env = process.env) {
    return {
        ...env,
        MCP_ENCRYPTION_KEY:
            env.AI_PROVIDER_ENCRYPTION_KEY || env.MCP_ENCRYPTION_KEY || ""
    };
}

function encryptionConfigured(env = process.env) {
    return String(
        env.AI_PROVIDER_ENCRYPTION_KEY || env.MCP_ENCRYPTION_KEY || ""
    ).trim().length >= 32;
}

function inspectProviderCredential(row, env = process.env) {
    if (row?.auth_type === "none") {
        return {
            state: "not_required",
            usable: true,
            credential: "__NO_AUTH__"
        };
    }
    if (!row?.secret_ciphertext) {
        return { state: "missing", usable: false, credential: "" };
    }
    try {
        return {
            state: "ready",
            usable: true,
            credential: decryptCredential(
                row.secret_ciphertext,
                vaultEnv(env)
            )
        };
    } catch (error) {
        return {
            state:
                error?.code === "MCP_CREDENTIAL_INVALID"
                    ? "needs_reentry"
                    : "unavailable",
            usable: false,
            credential: ""
        };
    }
}

function protocolProvider(protocol) {
    if (protocol === "anthropic") return "anthropic";
    if (protocol === "gemini") return "gemini";
    if (protocol === "openai-responses") return "openai-responses";
    return "openai-compatible";
}

function normalizeProtocol(value) {
    const protocol = cleanText(value, 40).toLowerCase();
    if (!PROTOCOLS.has(protocol)) {
        throw createProviderError(
            "接口协议不受支持。",
            "AI_PROVIDER_PROTOCOL_INVALID"
        );
    }
    return protocol;
}

function normalizeAuthType(value) {
    return value === "none" ? "none" : "bearer";
}

function normalizePriority(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 100;
    return Math.max(1, Math.min(9999, Math.round(parsed)));
}

function normalizeExpiry(value) {
    if (!value) return null;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
        throw createProviderError(
            "接口到期时间格式不正确。",
            "AI_PROVIDER_EXPIRY_INVALID"
        );
    }
    return new Date(parsed).toISOString();
}

function normalizeBillingUrl(value) {
    const text = cleanText(value, 1000);
    if (!text) return "";
    let parsed;
    try {
        parsed = new URL(text);
    } catch {
        throw createProviderError(
            "付款或控制台地址格式不正确。",
            "AI_PROVIDER_BILLING_URL_INVALID"
        );
    }
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
        throw createProviderError(
            "付款或控制台地址只能使用 HTTP 或 HTTPS。",
            "AI_PROVIDER_BILLING_URL_INVALID"
        );
    }
    parsed.hash = "";
    return parsed.toString().slice(0, 1000);
}

async function normalizeBaseUrl(
    value,
    { production = process.env.NODE_ENV === "production", lookup = dns.lookup } = {}
) {
    try {
        return await assertPublicMcpEndpoint(value, { production, lookup });
    } catch (error) {
        throw createProviderError(
            cleanText(
                String(error?.message || "接口地址不可用")
                    .replaceAll("MCP", "API")
                    .replaceAll("设备", "接口"),
                400
            ),
            String(error?.code || "AI_PROVIDER_URL_INVALID")
                .replace(/^MCP_/, "AI_PROVIDER_"),
            Number(error?.status) || 400
        );
    }
}

function normalizeModels(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(
        value
            .map((item) => cleanText(item?.id || item, 160))
            .filter(Boolean)
    )].slice(0, 300);
}

function publicProfile(row, credentialInspection = null) {
    const lastError = safeStoredProviderError(row.last_error);
    const credentialState =
        credentialInspection?.state ||
        (row.auth_type === "none"
            ? "not_required"
            : row.secret_ciphertext
              ? "stored"
              : "missing");
    const credentialUsable =
        typeof credentialInspection?.usable === "boolean"
            ? credentialInspection.usable
            : row.auth_type === "none" || Boolean(row.secret_ciphertext);
    return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        protocol: row.protocol,
        base_url: row.base_url,
        auth_type: row.auth_type || "bearer",
        auth_configured: credentialUsable,
        credential_state: credentialState,
        credential_reentry_required: credentialState === "needs_reentry",
        default_model: row.default_model || "",
        reasoning_effort: normalizeReasoningEffort(
            row.reasoning_effort,
            row.protocol
        ),
        enabled: row.enabled === true,
        is_default: row.is_default === true,
        priority: Number(row.priority) || 100,
        billing_url: row.billing_url || "",
        expires_at: row.expires_at || null,
        notes: cleanText(row.notes, 1000),
        discovered_models: normalizeModels(row.discovered_models),
        last_status: row.last_status || "untested",
        last_error: lastError,
        last_checked_at: row.last_checked_at || null,
        health: providerHealthSummary({ ...row, last_error: lastError }),
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

function isMissingTableError(error) {
    return (
        error?.code === "42P01" ||
        /ai_provider_profiles/i.test(String(error?.message || ""))
    );
}

function mapDatabaseError(error) {
    if (isMissingTableError(error)) {
        return createProviderError(
            "多接口控制台还没有完成数据库迁移。",
            "AI_PROVIDER_MIGRATION_REQUIRED",
            503
        );
    }
    return error;
}

function isExpired(row, now = Date.now()) {
    if (!row?.expires_at) return false;
    const timestamp = Date.parse(row.expires_at);
    return Number.isFinite(timestamp) && timestamp <= now;
}

function runtimeSettings(row, baseSettings, credential) {
    return {
        ...baseSettings,
        provider: protocolProvider(row.protocol),
        api_url: row.base_url,
        model: row.default_model || baseSettings.model || "",
        reasoning_effort: normalizeReasoningEffort(
            row.reasoning_effort,
            row.protocol
        ),
        runtime_api_key: credential,
        provider_profile_id: row.id,
        provider_profile_name: row.name,
        provider_protocol: row.protocol
    };
}

function unconfiguredRuntimeSettings(baseSettings = {}) {
    return {
        ...baseSettings,
        provider: "custom",
        api_url: "",
        model: "",
        reasoning_effort: "",
        runtime_api_key: "",
        provider_profile_id: null,
        provider_profile_name: "",
        provider_protocol: ""
    };
}

function publicRuntimeSettings(settings = {}) {
    const { runtime_api_key: _runtimeApiKey, ...safeSettings } = settings;
    return { ...safeSettings, companion_gender_available: ["ai_gender", "ai_pronouns", "ai_gender_label"].every(field => Object.hasOwn(settings, field)) };
}

function createAiProviderCenter({
    supabase,
    env = process.env,
    fetchImpl = fetch,
    lookup = dns.lookup
} = {}) {
    if (!supabase) throw new Error("ai provider center requires supabase");

    async function listRows({ enabledOnly = false } = {}) {
        let query = supabase
            .from("ai_provider_profiles")
            .select("*")
            .order("is_default", { ascending: false })
            .order("priority", { ascending: true })
            .order("created_at", { ascending: true });
        if (enabledOnly) query = query.eq("enabled", true);
        const { data, error } = await query;
        if (error) throw mapDatabaseError(error);
        return data || [];
    }

    async function getRow(id) {
        const { data, error } = await supabase
            .from("ai_provider_profiles")
            .select("*")
            .eq("id", id)
            .maybeSingle();
        if (error) throw mapDatabaseError(error);
        if (!data) {
            throw createProviderError(
                "找不到这个接口配置。",
                "AI_PROVIDER_NOT_FOUND",
                404
            );
        }
        return data;
    }

    async function normalizeDraft(input = {}, existing = null) {
        const name = cleanText(input.name ?? existing?.name, 80);
        if (!name) {
            throw createProviderError(
                "请填写接口名称。",
                "AI_PROVIDER_NAME_REQUIRED"
            );
        }
        const protocol = normalizeProtocol(
            input.protocol ?? existing?.protocol ?? "openai-chat"
        );
        const baseUrl = await normalizeBaseUrl(
            input.base_url ?? existing?.base_url,
            { production: env.NODE_ENV === "production", lookup }
        );
        const authType = normalizeAuthType(
            input.auth_type ?? existing?.auth_type
        );
        const defaultModel = cleanText(
            input.default_model ?? existing?.default_model,
            160
        );
        let reasoningEffort;
        try {
            reasoningEffort = normalizeReasoningEffort(
                input.reasoning_effort ?? existing?.reasoning_effort,
                protocol,
                { strict: true }
            );
        } catch (error) {
            throw createProviderError(
                error.message,
                error.code || "AI_PROVIDER_REASONING_EFFORT_INVALID"
            );
        }
        const credential = String(input.credential || "").trim();
        const existingCredential = existing
            ? inspectProviderCredential(existing, env)
            : null;
        const credentialConfigured =
            authType === "none" ||
            Boolean(credential) ||
            (existing?.auth_type === authType &&
                existingCredential?.usable === true);
        const enabled =
            input.enabled === undefined
                ? existing?.enabled === true
                : input.enabled === true;
        if (enabled && !credentialConfigured) {
            throw createProviderError(
                "启用接口前必须填写 API Key。",
                "AI_PROVIDER_CREDENTIAL_REQUIRED"
            );
        }
        if (enabled && !defaultModel) {
            throw createProviderError(
                "启用接口前必须填写默认模型。",
                "AI_PROVIDER_MODEL_REQUIRED"
            );
        }
        const expiresAt = normalizeExpiry(
            input.expires_at ?? existing?.expires_at
        );
        const requestedDefault =
            input.is_default === undefined
                ? existing?.is_default === true
                : input.is_default === true;
        return {
            name,
            slug: existing?.slug || slugify(name),
            protocol,
            base_url: baseUrl,
            auth_type: authType,
            credential,
            default_model: defaultModel,
            reasoning_effort: reasoningEffort,
            enabled,
            is_default: enabled && requestedDefault && !isExpired({
                expires_at: expiresAt
            }),
            priority: normalizePriority(input.priority ?? existing?.priority),
            billing_url: normalizeBillingUrl(
                input.billing_url ?? existing?.billing_url
            ),
            expires_at: expiresAt,
            notes: cleanText(input.notes ?? existing?.notes, 1000)
        };
    }

    async function testDraft(input = {}) {
        const draft = await normalizeDraft(
            { ...input, enabled: false },
            null
        );
        if (draft.auth_type !== "none" && !draft.credential) {
            throw createProviderError(
                "测试接口前请填写 API Key。",
                "AI_PROVIDER_CREDENTIAL_REQUIRED"
            );
        }
        let models;
        try {
            models = await fetchProviderModels(
                {
                    provider: protocolProvider(draft.protocol),
                    provider_protocol: draft.protocol,
                    api_url: draft.base_url,
                    model: draft.default_model,
                    runtime_api_key:
                        draft.auth_type === "none"
                            ? "__NO_AUTH__"
                            : draft.credential
                },
                fetchImpl
            );
        } catch (error) {
            throw providerProbeError(error);
        }
        return {
            ok: true,
            models: normalizeModels(models),
            protocol: draft.protocol,
            base_url: draft.base_url
        };
    }

    async function createProfile(input = {}) {
        const rows = await listRows();
        if (rows.length >= MAX_PROFILES) {
            throw createProviderError(
                "最多保存 24 个接口。",
                "AI_PROVIDER_LIMIT_REACHED"
            );
        }
        const draft = await normalizeDraft(input);
        if (draft.is_default) {
            const { error: clearDefaultError } = await supabase
                .from("ai_provider_profiles")
                .update({ is_default: false, updated_at: new Date().toISOString() })
                .eq("is_default", true);
            if (clearDefaultError) throw mapDatabaseError(clearDefaultError);
        }
        const values = {
            name: draft.name,
            slug: draft.slug,
            protocol: draft.protocol,
            base_url: draft.base_url,
            auth_type: draft.auth_type,
            secret_ciphertext:
                draft.auth_type === "none"
                    ? null
                    : encryptCredential(draft.credential, vaultEnv(env)),
            default_model: draft.default_model,
            reasoning_effort: draft.reasoning_effort,
            enabled: draft.enabled,
            is_default: draft.is_default,
            priority: draft.priority,
            billing_url: draft.billing_url,
            expires_at: draft.expires_at,
            notes: draft.notes,
            updated_at: new Date().toISOString()
        };
        const { data, error } = await supabase
            .from("ai_provider_profiles")
            .insert(values)
            .select("*")
            .single();
        if (error) throw mapDatabaseError(error);
        return publicProfile(data, inspectProviderCredential(data, env));
    }

    async function updateProfile(id, input = {}) {
        const existing = await getRow(id);
        const draft = await normalizeDraft(input, existing);
        if (draft.is_default) {
            const { error: clearDefaultError } = await supabase
                .from("ai_provider_profiles")
                .update({ is_default: false, updated_at: new Date().toISOString() })
                .eq("is_default", true)
                .neq("id", id);
            if (clearDefaultError) throw mapDatabaseError(clearDefaultError);
        }
        const values = {
            name: draft.name,
            protocol: draft.protocol,
            base_url: draft.base_url,
            auth_type: draft.auth_type,
            default_model: draft.default_model,
            reasoning_effort: draft.reasoning_effort,
            enabled: draft.enabled,
            is_default: draft.is_default,
            priority: draft.priority,
            billing_url: draft.billing_url,
            expires_at: draft.expires_at,
            notes: draft.notes,
            updated_at: new Date().toISOString()
        };
        if (draft.auth_type === "none") {
            values.secret_ciphertext = null;
        } else if (draft.credential) {
            values.secret_ciphertext = encryptCredential(
                draft.credential,
                vaultEnv(env)
            );
        }
        const { data, error } = await supabase
            .from("ai_provider_profiles")
            .update(values)
            .eq("id", id)
            .select("*")
            .single();
        if (error) throw mapDatabaseError(error);
        return publicProfile(data, inspectProviderCredential(data, env));
    }

    async function testProfile(id) {
        const row = await getRow(id);
        let models;
        try {
            const credential =
                row.auth_type === "none"
                    ? "__NO_AUTH__"
                    : decryptCredential(row.secret_ciphertext, vaultEnv(env));
            models = normalizeModels(
                await fetchProviderModels(
                    runtimeSettings(row, {}, credential),
                    fetchImpl
                )
            );
        } catch (error) {
            const safeError = providerProbeError(error);
            const now = new Date().toISOString();
            const { error: healthError } = await supabase
                .from("ai_provider_profiles")
                .update({
                    last_status: "error",
                    last_error: providerErrorDiagnostic(safeError),
                    last_checked_at: now,
                    updated_at: now
                })
                .eq("id", id);
            if (healthError) {
                const mapped = mapDatabaseError(healthError);
                if (mapped?.isPublicProviderError === true) throw mapped;
                throw createProviderError(
                    "接口检查失败，且健康状态未能保存，请稍后重试。",
                    "AI_PROVIDER_HEALTH_UPDATE_FAILED",
                    500
                );
            }
            throw safeError;
        }
        const now = new Date().toISOString();
        const { data, error } = await supabase
            .from("ai_provider_profiles")
            .update({
                discovered_models: models,
                last_status: "connected",
                last_error: null,
                last_checked_at: now,
                updated_at: now
            })
            .eq("id", id)
            .select("*")
            .single();
        if (error) throw mapDatabaseError(error);
        return {
            profile: publicProfile(data, inspectProviderCredential(data, env)),
            models
        };
    }

    async function setDefault(id) {
        const row = await getRow(id);
        if (!row.enabled) {
            throw createProviderError(
                "请先启用这个接口，再设为默认。",
                "AI_PROVIDER_NOT_ENABLED"
            );
        }
        if (isExpired(row)) {
            throw createProviderError(
                "这个接口已经到期，不能设为默认。",
                "AI_PROVIDER_EXPIRED"
            );
        }
        const now = new Date().toISOString();
        const { error: clearDefaultError } = await supabase
            .from("ai_provider_profiles")
            .update({ is_default: false, updated_at: now })
            .eq("is_default", true)
            .neq("id", id);
        if (clearDefaultError) throw mapDatabaseError(clearDefaultError);
        const { data, error } = await supabase
            .from("ai_provider_profiles")
            .update({ is_default: true, updated_at: now })
            .eq("id", id)
            .select("*")
            .single();
        if (error) throw mapDatabaseError(error);
        return publicProfile(data, inspectProviderCredential(data, env));
    }

    async function deleteProfile(id) {
        await getRow(id);
        const { error } = await supabase
            .from("ai_provider_profiles")
            .delete()
            .eq("id", id);
        if (error) throw mapDatabaseError(error);
        return { deleted: true, id };
    }

    async function runtimeProfiles(baseSettings, { limit } = {}) {
        let rows;
        try {
            rows = await listRows({ enabledOnly: true });
        } catch (error) {
            if (error.code === "AI_PROVIDER_MIGRATION_REQUIRED") return [];
            throw error;
        }
        const usable = rows.filter((row) => !isExpired(row));
        const selected = Number.isInteger(limit) && limit >= 0
            ? usable.slice(0, limit)
            : usable;
        return selected.flatMap((row) => {
            const inspection = inspectProviderCredential(row, env);
            return inspection.usable
                ? [runtimeSettings(row, baseSettings, inspection.credential)]
                : [];
        });
    }

    async function resolveDefaultSettings(baseSettings) {
        // Routing currently uses exactly one profile. Decrypting unused
        // profiles would let a damaged backup credential break the healthy
        // default route even though automatic failover is disabled.
        const profiles = await runtimeProfiles(baseSettings, { limit: 1 });
        return profiles[0] || unconfiguredRuntimeSettings(baseSettings);
    }

    async function status() {
        const configured = encryptionConfigured(env);
        try {
            const rows = await listRows();
            const credentialInspections = new Map(
                rows.map((row) => [
                    row.id,
                    inspectProviderCredential(row, env)
                ])
            );
            const active = rows.find(
                (row) => row.enabled && row.is_default && !isExpired(row)
            ) || rows.find((row) => row.enabled && !isExpired(row));
            const routableProfiles = rows.filter(
                (row) =>
                    row.enabled &&
                    !isExpired(row) &&
                    credentialInspections.get(row.id)?.usable === true
            );
            const credentialsRequiringReentry = rows.filter(
                (row) =>
                    credentialInspections.get(row.id)?.state ===
                    "needs_reentry"
            ).length;
            const activeCredential = active
                ? credentialInspections.get(active.id)
                : null;
            return {
                available: true,
                configured,
                profiles: rows.length,
                enabled_profiles: rows.filter((row) => row.enabled).length,
                routable_profiles: routableProfiles.length,
                credentials_requiring_reentry: credentialsRequiringReentry,
                credential_reentry_required:
                    credentialsRequiringReentry > 0,
                active_profile: active
                    ? {
                          id: active.id,
                          name: active.name,
                          protocol: active.protocol,
                          default_model: active.default_model,
                          reasoning_effort: normalizeReasoningEffort(
                              active.reasoning_effort,
                              active.protocol
                          ),
                          routable: activeCredential?.usable === true,
                          credential_state:
                              activeCredential?.state || "unavailable",
                          credential_reentry_required:
                              activeCredential?.state === "needs_reentry",
                          last_status: active.last_status,
                          health: providerHealthSummary(active)
                      }
                    : null,
                message: credentialsRequiringReentry
                    ? "部分接口凭据由旧密钥加密，请重新填写 API Key；其他设置仍可使用。"
                    : configured
                      ? "多接口控制台可以使用。"
                    : "还需配置接口管理口令和加密密钥。"
            };
        } catch (error) {
            if (error.code === "AI_PROVIDER_MIGRATION_REQUIRED") {
                return {
                    available: false,
                    configured,
                    profiles: 0,
                    enabled_profiles: 0,
                    routable_profiles: 0,
                    active_profile: null,
                    error: error.code,
                    message: error.message
                };
            }
            throw error;
        }
    }

    const center = {
        createProfile,
        deleteProfile,
        listProfiles: async () =>
            (await listRows()).map((row) =>
                publicProfile(row, inspectProviderCredential(row, env))
            ),
        resolveDefaultSettings,
        runtimeProfiles,
        setDefault,
        status,
        testDraft,
        testProfile,
        updateProfile
    };
    center.forDatabase = (database) =>
        database === supabase
            ? center
            : createAiProviderCenter({
                  supabase: database,
                  env,
                  fetchImpl,
                  lookup
              });
    return center;
}

module.exports = {
    PROTOCOLS,
    createAiProviderCenter,
    createProviderError,
    isExpired,
    normalizeBaseUrl,
    providerErrorDiagnostic,
    providerHealthSummary,
    providerProbeError,
    protocolProvider,
    publicProviderError,
    publicProfile,
    publicRuntimeSettings,
    safeStoredProviderError,
    runtimeSettings,
    unconfiguredRuntimeSettings
};
