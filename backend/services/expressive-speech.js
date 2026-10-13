const DEFAULT_MINIMAX_ENDPOINT = "https://api.minimax.io/v1/t2a_v2";
const ALLOWED_MINIMAX_ENDPOINTS = new Set([
    DEFAULT_MINIMAX_ENDPOINT,
    "https://api-uw.minimax.io/v1/t2a_v2"
]);
const MINIMAX_MODELS = new Set([
    "speech-2.8-hd",
    "speech-2.8-turbo",
    "speech-2.6-hd",
    "speech-2.6-turbo",
    "speech-02-hd",
    "speech-02-turbo",
    "speech-01-hd",
    "speech-01-turbo"
]);
const MINIMAX_EMOTIONS = new Set([
    "happy",
    "sad",
    "angry",
    "fearful",
    "disgusted",
    "surprised",
    "calm",
    "fluent",
    "whisper"
]);
const MINIMAX_SPEECH_26_MODELS = new Set([
    "speech-2.6-hd",
    "speech-2.6-turbo"
]);
const MINIMAX_MODEL_SPECIFIC_EMOTIONS = new Set(["fluent", "whisper"]);
const MINIMAX_SOUND_EFFECTS = new Set([
    "spacious_echo",
    "auditorium_echo",
    "lofi_telephone",
    "robotic"
]);
const AUTOMATIC_EMOTION_VALUES = new Set([
    "auto",
    "automatic",
    "default",
    "neutral"
]);
const MINIMAX_SOUND_TAGS = [
    "laughs",
    "chuckle",
    "coughs",
    "clear-throat",
    "groans",
    "breath",
    "pant",
    "inhale",
    "exhale",
    "gasps",
    "sniffs",
    "sighs",
    "snorts",
    "burps",
    "lip-smacking",
    "humming",
    "hissing",
    "emm",
    "whistles",
    "sneezes",
    "crying",
    "applause"
];
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const {
    MAX_DEEPGRAM_CHARACTERS,
    deepgramModelLanguage,
    synthesizeDeepgramSpeech
} = require("./deepgram-speech");

function serviceUnavailable(message) {
    const error = new Error(message);
    error.status = 503;
    error.code = "EXPRESSIVE_TTS_NOT_CONFIGURED";
    return error;
}

function voiceLanguageUnsupported() {
    const error = new Error(
        "当前 Deepgram 音色不支持这条回复里的语言，也没有可用的中文语音回退。"
    );
    error.status = 422;
    error.code = "VOICE_LANGUAGE_UNSUPPORTED";
    return error;
}

function analyzeDeepgramSentences(text, modelLanguage) {
    const locale = modelLanguage === "ja" ? "ja" : modelLanguage || "en";
    const segments = Array.from(
        new Intl.Segmenter(locale, { granularity: "sentence" }).segment(text),
        (entry) => entry.segment.trim()
    ).filter(Boolean);
    const compatibleSegments = segments.filter((sentence) => {
        const hasHan = /\p{Script=Han}/u.test(sentence);
        const hasKana =
            /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(sentence);
        const hasLatin = /\p{Script=Latin}/u.test(sentence);
        if (modelLanguage === "ja") return hasKana;
        return hasLatin && !hasHan && !hasKana;
    });
    return {
        compatibleText: compatibleSegments.join(" "),
        needsChineseFallback: segments.some((sentence) => {
            const hasHan = /\p{Script=Han}/u.test(sentence);
            const hasKana =
                /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(sentence);
            return hasHan && !(modelLanguage === "ja" && hasKana);
        })
    };
}

function upstreamError(message, status = 502) {
    const error = new Error(message);
    error.status = status;
    error.code = "EXPRESSIVE_TTS_UPSTREAM_ERROR";
    return error;
}

function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function normalizeMiniMaxEndpoint(value) {
    const endpoint = String(value || DEFAULT_MINIMAX_ENDPOINT)
        .trim()
        .replace(/\/+$/, "");
    if (!ALLOWED_MINIMAX_ENDPOINTS.has(endpoint)) {
        throw serviceUnavailable(
            "MiniMax 语音地址不在允许列表中，请检查服务器环境变量。"
        );
    }
    return endpoint;
}

function normalizedProvider(env = process.env) {
    const requested = String(env.EXPRESSIVE_TTS_PROVIDER || "")
        .trim()
        .toLowerCase();
    if (!requested) return env.MINIMAX_API_KEY ? "minimax" : "disabled";
    return requested === "minimax" ? "minimax" : "disabled";
}

function configuredVoiceId(env = process.env) {
    const voiceId = String(env.MINIMAX_TTS_VOICE_ID || "").trim();
    if (
        !voiceId ||
        voiceId.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(voiceId)
    ) {
        return "";
    }
    return voiceId;
}

function getExpressiveSpeechCapabilities(env = process.env) {
    const provider = normalizedProvider(env);
    const providerConfigured = provider === "minimax";
    const apiKeyConfigured = Boolean(
        String(env.MINIMAX_API_KEY || "").trim()
    );
    const voiceConfigured = Boolean(configuredVoiceId(env));
    const configured =
        providerConfigured && apiKeyConfigured && voiceConfigured;
    return {
        configured,
        provider_configured: providerConfigured,
        api_key_configured: apiKeyConfigured,
        voice_configured: voiceConfigured,
        emotion_supported: providerConfigured,
        device_tts_fallback: false
    };
}

function stripProviderControlTags(text) {
    const escaped = MINIMAX_SOUND_TAGS.map((tag) =>
        tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    ).join("|");
    return text.replace(new RegExp(`\\((?:${escaped})\\)`, "gi"), "");
}

function prepareSpeechText(value, maxCharacters = 3000) {
    const safeLimit = Math.round(
        clampNumber(maxCharacters, 3000, 100, 3000)
    );
    const cleaned = stripProviderControlTags(String(value || ""))
        .replace(/```[\s\S]*?```/g, "（代码内容已省略）")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/https?:\/\/\S+/gi, "链接")
        .replace(/[`*_#>|~]/g, "")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return Array.from(cleaned).slice(0, safeLimit).join("").trim();
}

function normalizeEmotionHint(value) {
    const key = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    if (AUTOMATIC_EMOTION_VALUES.has(key)) return "";
    const aliases = {
        joy: "happy",
        joyful: "happy",
        excited: "happy",
        affectionate: "calm",
        tender: "calm",
        loving: "calm",
        tired: "calm",
        anxious: "fearful",
        nervous: "fearful",
        anger: "angry",
        sadness: "sad",
        surprise: "surprised",
        whispering: "whisper",
        whipser: "whisper"
    };
    const normalized = aliases[key] || key;
    return MINIMAX_EMOTIONS.has(normalized) ? normalized : "";
}

function isSafeSpeechMessageId(value) {
    const id = String(value ?? "").trim();
    if (!/^\d{1,19}$/.test(id)) return false;
    try {
        const number = BigInt(id);
        return number > 0n && number <= 9223372036854775807n;
    } catch {
        return false;
    }
}

function inferSpeechEmotion(text, hint = "") {
    const hinted = normalizeEmotionHint(hint);
    if (hinted) return hinted;

    const value = String(text || "");
    if (/(生气|气死|恼火|愤怒|别闹|够了|讨厌你)/u.test(value)) return "angry";
    if (/(难过|伤心|想哭|心疼|委屈|对不起)/u.test(value)) return "sad";
    if (/(害怕|担心|紧张|不安|别怕)/u.test(value)) return "fearful";
    if (/(哇|居然|真的[吗呀]|没想到|天哪)/u.test(value)) return "surprised";
    if (/(哈哈|嘿嘿|开心|爱你|喜欢你|想你|乖|亲亲|宝贝|小朋友|真好)/u.test(value)) {
        return "happy";
    }
    if (/(慢慢来|安静|晚安|休息|抱抱|靠一会儿|轻轻)/u.test(value)) {
        return "calm";
    }
    return "";
}

function configuredMiniMaxModel(env = process.env) {
    return MINIMAX_MODELS.has(String(env.MINIMAX_TTS_MODEL || ""))
        ? String(env.MINIMAX_TTS_MODEL)
        : "speech-2.8-turbo";
}

function configuredEmotionSetting(env = process.env) {
    const raw = String(env.MINIMAX_TTS_EMOTION || "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    if (!raw) return { mode: "infer", emotion: "" };
    if (AUTOMATIC_EMOTION_VALUES.has(raw)) {
        return { mode: "auto", emotion: "" };
    }
    const emotion = normalizeEmotionHint(raw);
    if (!emotion) {
        throw serviceUnavailable(
            "MINIMAX_TTS_EMOTION 不是 MiniMax 支持的情绪值。"
        );
    }
    return { mode: "fixed", emotion };
}

function compatibleMiniMaxEmotion(model, emotion) {
    if (!emotion) return "";
    if (
        MINIMAX_MODEL_SPECIFIC_EMOTIONS.has(emotion) &&
        !MINIMAX_SPEECH_26_MODELS.has(model)
    ) {
        return "";
    }
    return emotion;
}

function buildMiniMaxRequest(env, text, emotionHint = "") {
    const model = configuredMiniMaxModel(env);
    const voiceId = configuredVoiceId(env);
    if (!voiceId) {
        throw serviceUnavailable("服务器还没有配置有效的 MiniMax voice_id。");
    }

    const emotionSetting = configuredEmotionSetting(env);
    const selectedEmotion =
        emotionSetting.mode === "fixed"
            ? emotionSetting.emotion
            : emotionSetting.mode === "auto"
              ? ""
              : inferSpeechEmotion(text, emotionHint);
    const emotion = compatibleMiniMaxEmotion(model, selectedEmotion);
    const voiceSetting = {
        voice_id: voiceId,
        speed: clampNumber(env.MINIMAX_TTS_SPEED, 1, 0.5, 2),
        vol: clampNumber(env.MINIMAX_TTS_VOLUME, 1, 0.01, 10),
        pitch: Math.round(clampNumber(env.MINIMAX_TTS_PITCH, 0, -12, 12))
    };
    if (emotion) voiceSetting.emotion = emotion;
    const voiceModify = {
        pitch: Math.round(
            clampNumber(env.MINIMAX_TTS_VOICE_MODIFY_PITCH, 0, -100, 100)
        ),
        intensity: Math.round(
            clampNumber(
                env.MINIMAX_TTS_VOICE_MODIFY_INTENSITY,
                0,
                -100,
                100
            )
        ),
        timbre: Math.round(
            clampNumber(env.MINIMAX_TTS_VOICE_MODIFY_TIMBRE, 0, -100, 100)
        )
    };
    const soundEffect = String(
        env.MINIMAX_TTS_VOICE_MODIFY_SOUND_EFFECT || ""
    )
        .trim()
        .toLowerCase();
    if (MINIMAX_SOUND_EFFECTS.has(soundEffect)) {
        voiceModify.sound_effects = soundEffect;
    }
    const hasVoiceModify =
        voiceModify.pitch !== 0 ||
        voiceModify.intensity !== 0 ||
        voiceModify.timbre !== 0 ||
        Boolean(voiceModify.sound_effects);

    return {
        model,
        emotion: emotion || "auto",
        payload: {
            model,
            text,
            stream: false,
            language_boost: "Chinese",
            output_format: "hex",
            voice_setting: voiceSetting,
            audio_setting: {
                sample_rate: 32000,
                bitrate: 128000,
                format: "mp3",
                channel: 1
            },
            ...(hasVoiceModify ? { voice_modify: voiceModify } : {})
        }
    };
}

function decodeMiniMaxAudio(payload) {
    const statusCode = Number(payload?.base_resp?.status_code);
    if (statusCode !== 0) {
        throw upstreamError(
            `MiniMax 语音生成失败（代码 ${Number.isFinite(statusCode) ? statusCode : "未知"}）。`
        );
    }
    const audio = String(payload?.data?.audio || "").trim();
    if (!audio || audio.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(audio)) {
        throw upstreamError("MiniMax 没有返回可播放的语音。" );
    }
    const buffer = Buffer.from(audio, "hex");
    if (buffer.length === 0 || buffer.length > MAX_AUDIO_BYTES) {
        throw upstreamError("MiniMax 返回的语音大小不正确。" );
    }
    return buffer;
}

async function synthesizeExpressiveSpeech({
    text,
    emotionHint = "",
    providerConfig = null,
    env = process.env,
    fetchImpl = fetch
}) {
    const capabilities = getExpressiveSpeechCapabilities(env);
    if (providerConfig?.provider === "disabled") {
        const error = new Error("当前账号已关闭云端发声。");
        error.status = 409;
        error.code = "VOICE_OUTPUT_DISABLED";
        throw error;
    }
    if (providerConfig?.provider === "deepgram") {
        const speechText = prepareSpeechText(text, MAX_DEEPGRAM_CHARACTERS);
        if (!speechText) {
            const error = new Error("这条 AI 回复没有可朗读的文字。");
            error.status = 400;
            throw error;
        }
        const modelLanguage = deepgramModelLanguage(providerConfig.model);
        const languageAnalysis = analyzeDeepgramSentences(
            speechText,
            modelLanguage
        );
        const needsChineseFallback = languageAnalysis.needsChineseFallback;
        if (!needsChineseFallback) {
            return synthesizeDeepgramSpeech({
                text: speechText,
                apiKey: providerConfig.apiKey,
                model: providerConfig.model,
                region: providerConfig.region,
                speed: providerConfig.speed,
                timeoutMs: env.EXPRESSIVE_TTS_TIMEOUT_MS,
                fetchImpl
            });
        }
        if (!capabilities.configured) {
            const compatibleText = languageAnalysis.compatibleText;
            if (!compatibleText) throw voiceLanguageUnsupported();
            return synthesizeDeepgramSpeech({
                text: compatibleText,
                apiKey: providerConfig.apiKey,
                model: providerConfig.model,
                region: providerConfig.region,
                speed: providerConfig.speed,
                timeoutMs: env.EXPRESSIVE_TTS_TIMEOUT_MS,
                fetchImpl
            });
        }
    }
    if (!capabilities.configured) {
        throw serviceUnavailable(
            "服务器尚未同时配置 MiniMax API Key 和 voice_id，本次无法生成自然语音；文字聊天不受影响。"
        );
    }

    const speechText = prepareSpeechText(text, env.EXPRESSIVE_TTS_MAX_CHARS);
    if (!speechText) {
        const error = new Error("这条 AI 回复没有可朗读的文字。" );
        error.status = 400;
        throw error;
    }
    const endpoint = normalizeMiniMaxEndpoint(env.MINIMAX_TTS_URL);
    const request = buildMiniMaxRequest(env, speechText, emotionHint);
    const timeoutMs = clampNumber(
        env.EXPRESSIVE_TTS_TIMEOUT_MS,
        45_000,
        5_000,
        120_000
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        let response;
        try {
            response = await fetchImpl(endpoint, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${String(env.MINIMAX_API_KEY || "").trim()}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(request.payload),
                signal: controller.signal
            });
        } catch (error) {
            if (error?.name === "AbortError") {
                throw upstreamError(
                    "自然语音生成等待超时，本次只显示文字回复。",
                    504
                );
            }
            const connectionError = upstreamError(
                "无法连接自然语音服务，本次只显示文字回复。"
            );
            connectionError.cause = error;
            throw connectionError;
        }

        let payload;
        try {
            payload = await response.json();
        } catch {
            throw upstreamError("自然语音服务返回了无法读取的结果。" );
        }
        if (!response.ok) {
            throw upstreamError(
                `自然语音服务暂时不可用（HTTP ${response.status}）。`
            );
        }

        return {
            audio: decodeMiniMaxAudio(payload),
            contentType: "audio/mpeg",
            provider: "minimax",
            model: request.model,
            emotion: request.emotion
        };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    ALLOWED_MINIMAX_ENDPOINTS,
    MAX_AUDIO_BYTES,
    MINIMAX_EMOTIONS,
    MINIMAX_MODELS,
    MINIMAX_SOUND_EFFECTS,
    buildMiniMaxRequest,
    compatibleMiniMaxEmotion,
    configuredMiniMaxModel,
    decodeMiniMaxAudio,
    getExpressiveSpeechCapabilities,
    inferSpeechEmotion,
    isSafeSpeechMessageId,
    normalizeEmotionHint,
    normalizeMiniMaxEndpoint,
    prepareSpeechText,
    synthesizeExpressiveSpeech
};
