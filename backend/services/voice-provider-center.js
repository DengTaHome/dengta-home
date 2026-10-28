const {
    decryptCredential,
    encryptCredential,
    hasCredentialEncryption
} = require("./mcp-device-center");
const {
    DEEPGRAM_MODELS,
    clampSpeed,
    normalizeDeepgramModel,
    normalizeDeepgramRegion,
    synthesizeDeepgramSpeech
} = require("./deepgram-speech");
const {
    getExpressiveSpeechCapabilities,
    synthesizeExpressiveSpeech
} = require("./expressive-speech");
const {
    EDGE_DEFAULT_VOICE,
    OUTPUT_FORMATS,
    assertSafeOutboundUrl,
    customProviderCatalog,
    edgeVoiceAllowed,
    customSpeechError,
    isCustomProvider,
    normalizeFormat,
    normalizeResponseMode,
    publicCustomSpeechError,
    synthesizeCustomSpeech
} = require("./custom-speech");

function voiceProviderError(message, code, status = 400) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    error.isVoiceProviderError = true;
    return error;
}

function cleanText(value, maxLength) {
    return Array.from(String(value || "").trim()).slice(0, maxLength).join("");
}

function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeProvider(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return "server_default";
    if (["server_default", "deepgram", "edge", "openai_compatible", "custom_http"].includes(raw)) {
        return raw;
    }
    return "unsupported";
}

function publicVoiceProfile(row) {
    if (!row) return null;
    const provider = normalizeProvider(row.provider);
    const credentialConfigured = Boolean(row.secret_ciphertext);
    const enabled = row.enabled === true;
    const baseUrl = String(row.api_base_url || "").trim();
    const voiceId = String(row.voice_id || "").trim();
    let configured;
    if (provider === "server_default") configured = enabled;
    else if (provider === "deepgram") configured = enabled && credentialConfigured;
    else if (provider === "edge") configured = enabled;
    else configured = enabled && Boolean(baseUrl);
    return {
        provider,
        enabled,
        region: normalizeDeepgramRegion(row.region),
        model: String(row.model || (provider === "openai_compatible" ? "tts-1" : "")).trim(),
        voice_id: voiceId || (provider === "edge" ? EDGE_DEFAULT_VOICE : ""),
        api_base_url: baseUrl,
        output_format: normalizeFormat(row.output_format),
        rate: clampNumber(row.rate, 0, -50, 50),
        pitch: clampNumber(row.pitch, 0, -50, 50),
        volume: clampNumber(row.volume, 0, -50, 50),
        speed: provider === "deepgram" || provider === "openai_compatible"
            ? clampSpeed(row.speed)
            : clampNumber(row.speed, 1, 0.25, 4),
        method: String(row.method || "POST").toUpperCase(),
        headers_template: String(row.headers_template || ""),
        body_template: String(row.body_template || ""),
        response_mode: normalizeResponseMode(row.response_mode),
        audio_path: String(row.audio_path || ""),
        mime_type: String(row.mime_type || ""),
        credential_configured: credentialConfigured,
        configured,
        last_status: ["untested", "connected", "error"].includes(row.last_status)
            ? row.last_status
            : "untested",
        last_error: row.last_status === "error" ? "语音连接测试未通过。" : null,
        last_checked_at: row.last_checked_at || null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null
    };
}

function publicVoiceProviderError(error) {
    if (error?.isVoiceProviderError) {
        return {
            status: Number(error.status) || 400,
            code: String(error.code || "VOICE_PROVIDER_ERROR"),
            message: String(error.message || "语音接口配置无效。")
        };
    }
    if (String(error?.code || "").startsWith("DEEPGRAM_")) {
        return {
            status: Number(error.status) || 502,
            code: String(error.code),
            message: String(error.message || "Deepgram 语音服务暂时不可用。")
        };
    }
    if (String(error?.code || "").startsWith("CUSTOM_TTS_") || error?.isCustomSpeechError) {
        const safe = publicCustomSpeechError(error);
        return { ...safe, status: safe.status || 502 };
    }
    if (String(error?.code || "").startsWith("EXPRESSIVE_TTS_")) {
        return {
            status: Number(error.status) || 503,
            code: String(error.code),
            message: String(error.message || "服务器默认语音暂时不可用。")
        };
    }
    return {
        status: 500,
        code: "VOICE_PROVIDER_CENTER_ERROR",
        message: "语音接口设置暂时不可用，请稍后再试。"
    };
}

function safeStoredError(error) {
    const safe = publicVoiceProviderError(error);
    return `${safe.code}${safe.status ? ` (HTTP ${safe.status})` : ""}`.slice(0, 160);
}

function createVoiceProviderCenter({
    database,
    env = process.env,
    fetchImpl = fetch
} = {}) {
    if (!database || typeof database.from !== "function") {
        throw new TypeError("Voice provider center requires a scoped database.");
    }

    async function readRow() {
        const { data, error } = await database
            .from("voice_provider_profiles")
            .select("*")
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    function publicRow(row) {
        const fallback = getExpressiveSpeechCapabilities(env);
        const profile = publicVoiceProfile(row) || {
            provider: "server_default",
            enabled: true,
            region: "global",
            model: "aura-2-helena-en",
            voice_id: "",
            api_base_url: "",
            output_format: "mp3",
            rate: 0,
            pitch: 0,
            volume: 0,
            speed: 1,
            method: "POST",
            headers_template: "",
            body_template: "",
            response_mode: "binary",
            audio_path: "",
            mime_type: "",
            credential_configured: false,
            configured: fallback.configured,
            last_status: "untested",
            last_error: null,
            last_checked_at: null,
            created_at: null,
            updated_at: null
        };
        if (profile.provider === "server_default") {
            profile.configured =
                profile.enabled && fallback.configured;
        }
        return {
            ...profile,
            chinese_fallback_available: fallback.configured,
            model_options: DEEPGRAM_MODELS,
            region_options: ["global", "eu", "au"],
            custom_providers: customProviderCatalog(),
            output_formats: OUTPUT_FORMATS
        };
    }

    async function writeStatus(row, status, errorValue = null) {
        if (!row) return;
        const { error } = await database
            .from("voice_provider_profiles")
            .update({
                last_status: status,
                last_error: errorValue,
                last_checked_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
        if (error) throw error;
    }

    function normalizeDraft(input = {}, existing = null) {
        const provider = normalizeProvider(input.provider ?? existing?.provider ?? "server_default");
        if (provider === "unsupported") {
            throw voiceProviderError("发声来源不受支持。", "VOICE_PROVIDER_UNSUPPORTED");
        }
        const enabled =
            input.enabled === undefined
                ? existing
                    ? existing.enabled === true
                    : true
                : input.enabled === true;
        const baseUrl = cleanText(input.api_base_url ?? existing?.api_base_url ?? "", 500);
        const voiceId = cleanText(input.voice_id ?? input.voice ?? existing?.voice_id ?? "", 120);
        const model = cleanText(input.model ?? existing?.model ?? "", 120);
        const outputFormat = normalizeFormat(input.output_format ?? existing?.output_format);
        const draft = {
            provider,
            enabled,
            region: normalizeDeepgramRegion(input.region ?? existing?.region),
            model: model || (provider === "openai_compatible" ? "tts-1" : ""),
            voice_id:
                voiceId ||
                (provider === "edge" ? EDGE_DEFAULT_VOICE : provider === "deepgram" ? "" : ""),
            api_base_url: baseUrl,
            output_format: outputFormat,
            rate: clampNumber(input.rate ?? existing?.rate, 0, -50, 50),
            pitch: clampNumber(input.pitch ?? existing?.pitch, 0, -50, 50),
            volume: clampNumber(input.volume ?? existing?.volume, 0, -50, 50),
            speed:
                provider === "deepgram"
                    ? clampSpeed(input.speed ?? existing?.speed)
                    : provider === "openai_compatible"
                      ? clampNumber(input.speed ?? existing?.speed, 1, 0.25, 4)
                      : clampNumber(input.speed ?? existing?.speed, 1, 0.25, 4),
            method: String(input.method ?? existing?.method ?? "POST").toUpperCase(),
            headers_template: cleanText(input.headers_template ?? existing?.headers_template ?? "", 4000),
            body_template: cleanText(input.body_template ?? existing?.body_template ?? "", 8000),
            response_mode: normalizeResponseMode(input.response_mode ?? existing?.response_mode),
            audio_path: cleanText(input.audio_path ?? existing?.audio_path ?? "", 200),
            mime_type: cleanText(input.mime_type ?? existing?.mime_type ?? "", 120)
        };
        if (provider === "deepgram") {
            draft.speed = clampSpeed(draft.speed);
            draft.model = normalizeDeepgramModel(draft.model);
        }
        if (provider === "edge") {
            if (!draft.voice_id) draft.voice_id = EDGE_DEFAULT_VOICE;
            if (!edgeVoiceAllowed(draft.voice_id)) {
                throw voiceProviderError("Edge 音色名称不合法。", "VOICE_PROVIDER_VOICE_INVALID");
            }
        }
        if (provider === "custom_http") {
            if (!["GET", "POST", "PUT", "PATCH"].includes(draft.method)) {
                throw voiceProviderError("自定义接口方法不受支持。", "VOICE_PROVIDER_METHOD_INVALID");
            }
        }
        if (provider === "openai_compatible" || provider === "custom_http") {
            if (!draft.api_base_url) {
                throw voiceProviderError(
                    "请填写语音服务地址。",
                    "VOICE_PROVIDER_BASE_URL_REQUIRED"
                );
            }
            try {
                assertSafeOutboundUrl(draft.api_base_url, env);
            } catch (error) {
                throw voiceProviderError(error.message, error.code || "VOICE_PROVIDER_BASE_URL_INVALID");
            }
        }
        if (provider === "custom_http" && draft.headers_template) {
            let parsed;
            try {
                parsed = JSON.parse(draft.headers_template);
            } catch {
                throw voiceProviderError(
                    "自定义请求头必须是合法 JSON 对象。",
                    "VOICE_PROVIDER_HEADERS_INVALID"
                );
            }
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw voiceProviderError(
                    "自定义请求头必须是合法 JSON 对象。",
                    "VOICE_PROVIDER_HEADERS_INVALID"
                );
            }
            if (Object.keys(parsed).length > 40) {
                throw voiceProviderError("自定义请求头过多。", "VOICE_PROVIDER_HEADERS_INVALID");
            }
        }
        return draft;
    }

    function toCustomRuntime(draft, apiKey) {
        return {
            provider: draft.provider,
            enabled: draft.enabled,
            apiBaseUrl: draft.api_base_url,
            voiceId: draft.voice_id,
            model: draft.model,
            outputFormat: draft.output_format,
            rate: draft.rate,
            pitch: draft.pitch,
            volume: draft.volume,
            speed: draft.speed,
            method: draft.method,
            headersTemplate: draft.headers_template,
            bodyTemplate: draft.body_template,
            responseMode: draft.response_mode,
            audioPath: draft.audio_path,
            mimeType: draft.mime_type,
            apiKey: apiKey || ""
        };
    }

    async function saveProfile(input = {}) {
        const existing = await readRow();
        const draft = normalizeDraft(input, existing);
        const credential = cleanText(input.api_key ?? input.credential, 8000);
        let secretCiphertext = existing?.secret_ciphertext || null;
        if (
            existing &&
            !credential &&
            normalizeProvider(existing.provider) !== draft.provider
        ) {
            // 不同服务商的 Key 不通用：切换时默认清空，避免旧 Key 被发给新地址
            secretCiphertext = null;
        }
        if (credential) {
            if (!hasCredentialEncryption(env)) {
                throw voiceProviderError(
                    "服务器尚未配置凭据加密密钥，暂时不能保存 Deepgram API Key。",
                    "VOICE_PROVIDER_ENCRYPTION_NOT_CONFIGURED",
                    503
                );
            }
            secretCiphertext = encryptCredential(credential, env);
        }
        if (draft.provider === "deepgram" && draft.enabled && !secretCiphertext) {
            throw voiceProviderError(
                "启用 Deepgram 前请先填写 API Key。",
                "VOICE_PROVIDER_CREDENTIAL_REQUIRED"
            );
        }
        const now = new Date().toISOString();
        const values = {
            ...draft,
            secret_ciphertext: secretCiphertext,
            last_status:
                credential ||
                draft.model !== existing?.model ||
                draft.region !== existing?.region ||
                draft.speed !== Number(existing?.speed)
                    ? "untested"
                    : existing?.last_status || "untested",
            last_error: null,
            last_checked_at: credential ? null : existing?.last_checked_at || null,
            updated_at: now
        };
        let query;
        if (existing) {
            query = database
                .from("voice_provider_profiles")
                .update(values)
                .select("*")
                .single();
        } else {
            query = database
                .from("voice_provider_profiles")
                .insert({ ...values, created_at: now })
                .select("*")
                .single();
        }
        const { data, error } = await query;
        if (error) throw error;
        return publicRow(data);
    }

    async function deleteProfile() {
        const existing = await readRow();
        if (!existing) return { deleted: false };
        const { error } = await database.from("voice_provider_profiles").delete();
        if (error) throw error;
        return { deleted: true };
    }

    async function resolveRuntimeProfile() {
        const row = await readRow();
        if (!row) return null;
        const provider = normalizeProvider(row.provider);
        if (row.enabled !== true) {
            return {
                provider: "disabled",
                updatedAt: row.updated_at || ""
            };
        }
        if (!isCustomProvider(provider)) {
            if (provider !== "deepgram") return null;
            if (!row.secret_ciphertext) {
                throw voiceProviderError(
                    "Deepgram 已启用，但 API Key 尚未配置。",
                    "VOICE_PROVIDER_CREDENTIAL_REQUIRED",
                    503
                );
            }
            let apiKey;
            try {
                apiKey = decryptCredential(row.secret_ciphertext, env);
            } catch {
                throw voiceProviderError(
                    "Deepgram API Key 无法解密，请重新填写。",
                    "VOICE_PROVIDER_CREDENTIAL_INVALID",
                    503
                );
            }
            return {
                ...normalizeDraft(row, row),
                apiKey,
                updatedAt: row.updated_at || ""
            };
        }
        let apiKey = "";
        if (provider !== "edge" && row.secret_ciphertext) {
            try {
                apiKey = decryptCredential(row.secret_ciphertext, env);
            } catch {
                throw voiceProviderError(
                    "语音 API Key 无法解密，请重新填写。",
                    "VOICE_PROVIDER_CREDENTIAL_INVALID",
                    503
                );
            }
        }
        const draft = normalizeDraft(row, row);
        if (draft.provider !== "edge" && !draft.api_base_url) {
            throw voiceProviderError(
                "语音服务地址尚未配置。",
                "VOICE_PROVIDER_BASE_URL_REQUIRED",
                503
            );
        }
        return {
            ...toCustomRuntime(draft, apiKey),
            updatedAt: row.updated_at || ""
        };
    }

    async function testProfile(input = {}) {
        const existing = await readRow();
        const draft = normalizeDraft(input, existing);
        if (!draft.enabled) {
            throw voiceProviderError(
                "当前账号已关闭云端发声。",
                "VOICE_OUTPUT_DISABLED",
                409
            );
        }
        const text = cleanText(input.text, 400) || "Hello. This is your DengTa voice test.";
        if (draft.provider === "server_default") {
            try {
                const speech = await synthesizeExpressiveSpeech({
                    text,
                    env,
                    fetchImpl
                });
                if (existing) await writeStatus(existing, "connected");
                return speech;
            } catch (error) {
                if (existing) {
                    await writeStatus(existing, "error", safeStoredError(error));
                }
                throw error;
            }
        }
        if (isCustomProvider(draft.provider)) {
            const suppliedCredential = cleanText(input.api_key ?? input.credential, 8000);
            let apiKey = suppliedCredential;
            if (!apiKey && existing?.secret_ciphertext) {
                try {
                    apiKey = decryptCredential(existing.secret_ciphertext, env);
                } catch {
                    throw voiceProviderError(
                        "语音 API Key 无法解密，请重新填写。",
                        "VOICE_PROVIDER_CREDENTIAL_INVALID",
                        503
                    );
                }
            }
            try {
                const speech = await synthesizeCustomSpeech({
                    providerConfig: toCustomRuntime(draft, apiKey),
                    text,
                    env,
                    fetchImpl
                });
                if (existing) await writeStatus(existing, "connected");
                return speech;
            } catch (error) {
                if (existing) {
                    await writeStatus(existing, "error", safeStoredError(error));
                }
                throw error;
            }
        }
        const suppliedCredential = cleanText(input.api_key ?? input.credential, 8000);
        let apiKey = suppliedCredential;
        if (!apiKey && existing?.secret_ciphertext) {
            try {
                apiKey = decryptCredential(existing.secret_ciphertext, env);
            } catch {
                throw voiceProviderError(
                    "Deepgram API Key 无法解密，请重新填写。",
                    "VOICE_PROVIDER_CREDENTIAL_INVALID",
                    503
                );
            }
        }
        if (!apiKey) {
            throw voiceProviderError(
                "测试 Deepgram 前请先填写 API Key。",
                "VOICE_PROVIDER_CREDENTIAL_REQUIRED"
            );
        }
        try {
            const speech = await synthesizeDeepgramSpeech({
                text,
                apiKey,
                model: draft.model,
                region: draft.region,
                speed: draft.speed,
                timeoutMs: env.EXPRESSIVE_TTS_TIMEOUT_MS,
                fetchImpl
            });
            if (existing) await writeStatus(existing, "connected");
            return speech;
        } catch (error) {
            if (existing) {
                await writeStatus(existing, "error", safeStoredError(error));
            }
            throw error;
        }
    }

    async function status() {
        const row = await readRow();
        const profile = publicRow(row);
        return {
            ok: true,
            available: hasCredentialEncryption(env),
            profile,
            providers: [
                {
                    id: "deepgram",
                    name: "Deepgram Aura-2",
                    regions: Object.freeze(["global", "eu", "au"]),
                    models: DEEPGRAM_MODELS
                },
                ...customProviderCatalog()
            ],
            output_formats: OUTPUT_FORMATS,
            base_url_public_allowed: String(env.VOICE_CUSTOM_ALLOW_PRIVATE || "") === "1",
            http_allowed: String(env.VOICE_CUSTOM_ALLOW_HTTP || "") === "1"
        };
    }

    return {
        deleteProfile,
        readProfile: async () => publicRow(await readRow()),
        resolveRuntimeProfile,
        saveProfile,
        status,
        testProfile
    };
}

module.exports = {
    createVoiceProviderCenter,
    publicVoiceProfile,
    publicVoiceProviderError,
    safeStoredError,
    voiceProviderError
};
