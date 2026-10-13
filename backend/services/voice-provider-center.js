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

function publicVoiceProfile(row) {
    if (!row) return null;
    const credentialConfigured = Boolean(row.secret_ciphertext);
    const enabled = row.enabled === true;
    const provider = row.provider === "deepgram" ? "deepgram" : "server_default";
    return {
        provider,
        enabled,
        region: normalizeDeepgramRegion(row.region),
        model: normalizeDeepgramModel(row.model),
        speed: clampSpeed(row.speed),
        credential_configured: credentialConfigured,
        configured:
            provider === "deepgram"
                ? enabled && credentialConfigured
                : enabled,
        last_status: ["untested", "connected", "error"].includes(row.last_status)
            ? row.last_status
            : "untested",
        last_error: row.last_status === "error" ? "Deepgram 连接测试未通过。" : null,
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
            speed: 1,
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
            region_options: ["global", "eu", "au"]
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
        const provider = cleanText(input.provider ?? existing?.provider ?? "server_default", 32)
            .toLowerCase();
        if (!["server_default", "deepgram"].includes(provider)) {
            throw voiceProviderError(
                "发声来源只能选择服务器默认语音或 Deepgram。",
                "VOICE_PROVIDER_UNSUPPORTED"
            );
        }
        return {
            provider,
            enabled:
                input.enabled === undefined
                    ? existing
                        ? existing.enabled === true
                        : true
                    : input.enabled === true,
            region: normalizeDeepgramRegion(input.region ?? existing?.region),
            model: normalizeDeepgramModel(input.model ?? existing?.model),
            speed: clampSpeed(input.speed ?? existing?.speed)
        };
    }

    async function saveProfile(input = {}) {
        const existing = await readRow();
        const draft = normalizeDraft(input, existing);
        const credential = cleanText(input.api_key ?? input.credential, 8000);
        let secretCiphertext = existing?.secret_ciphertext || null;
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
        if (row.enabled !== true) {
            return {
                provider: "disabled",
                updatedAt: row.updated_at || ""
            };
        }
        if (row.provider !== "deepgram") return null;
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
                }
            ]
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
