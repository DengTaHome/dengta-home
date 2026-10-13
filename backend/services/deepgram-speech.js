const DEEPGRAM_ENDPOINTS = Object.freeze({
    global: "https://api.deepgram.com/v1/speak",
    eu: "https://api.eu.deepgram.com/v1/speak",
    au: "https://api.au.deepgram.com/v1/speak"
});

const DEEPGRAM_MODELS = Object.freeze([
    { id: "aura-2-thalia-en", language: "en", label: "Thalia" },
    { id: "aura-2-andromeda-en", language: "en", label: "Andromeda" },
    { id: "aura-2-helena-en", language: "en", label: "Helena" },
    { id: "aura-2-apollo-en", language: "en", label: "Apollo" },
    { id: "aura-2-arcas-en", language: "en", label: "Arcas" },
    { id: "aura-2-aries-en", language: "en", label: "Aries" },
    { id: "aura-2-saturn-en", language: "en", label: "Saturn" },
    { id: "aura-2-orpheus-en", language: "en", label: "Orpheus" },
    { id: "aura-2-celeste-es", language: "es", label: "Celeste" },
    { id: "aura-2-estrella-es", language: "es", label: "Estrella" },
    { id: "aura-2-nestor-es", language: "es", label: "Nestor" },
    { id: "aura-2-rhea-nl", language: "nl", label: "Rhea" },
    { id: "aura-2-sander-nl", language: "nl", label: "Sander" },
    { id: "aura-2-beatrix-nl", language: "nl", label: "Beatrix" },
    { id: "aura-2-agathe-fr", language: "fr", label: "Agathe" },
    { id: "aura-2-hector-fr", language: "fr", label: "Hector" },
    { id: "aura-2-julius-de", language: "de", label: "Julius" },
    { id: "aura-2-viktoria-de", language: "de", label: "Viktoria" },
    { id: "aura-2-livia-it", language: "it", label: "Livia" },
    { id: "aura-2-dionisio-it", language: "it", label: "Dionisio" },
    { id: "aura-2-fujin-ja", language: "ja", label: "Fujin" },
    { id: "aura-2-izanami-ja", language: "ja", label: "Izanami" },
    { id: "aura-2-uzume-ja", language: "ja", label: "Uzume" },
    { id: "aura-2-ebisu-ja", language: "ja", label: "Ebisu" },
    { id: "aura-2-ama-ja", language: "ja", label: "Ama" }
]);
const DEEPGRAM_MODEL_IDS = new Set(DEEPGRAM_MODELS.map((item) => item.id));
const DEEPGRAM_LANGUAGES = new Set(["en", "es", "de", "fr", "nl", "it", "ja"]);
const MAX_DEEPGRAM_CHARACTERS = 2000;
const MAX_DEEPGRAM_AUDIO_BYTES = 10 * 1024 * 1024;
const ALLOWED_AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/mp3"]);

function deepgramError(message, code, status = 400, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    Object.assign(error, details);
    return error;
}

function clampSpeed(value) {
    const speed = Number(value);
    if (!Number.isFinite(speed)) return 1;
    return Math.min(1.5, Math.max(0.7, Math.round(speed * 100) / 100));
}

function normalizeDeepgramRegion(value) {
    const region = String(value || "global").trim().toLowerCase();
    if (!Object.hasOwn(DEEPGRAM_ENDPOINTS, region)) {
        throw deepgramError(
            "Deepgram 区域只能选择 global、eu 或 au。",
            "DEEPGRAM_REGION_INVALID"
        );
    }
    return region;
}

function normalizeDeepgramModel(value) {
    const model = String(value || "aura-2-helena-en").trim().toLowerCase();
    const language = model.split("-").at(-1);
    if (!DEEPGRAM_MODEL_IDS.has(model) || !DEEPGRAM_LANGUAGES.has(language)) {
        throw deepgramError(
            "请选择 DengTa 已验证的 Deepgram Aura-2 语音模型。",
            "DEEPGRAM_MODEL_INVALID"
        );
    }
    return model;
}

function deepgramModelLanguage(model) {
    return normalizeDeepgramModel(model).split("-").at(-1);
}

function buildDeepgramRequest({ model, region, speed } = {}) {
    const normalizedModel = normalizeDeepgramModel(model);
    const normalizedRegion = normalizeDeepgramRegion(region);
    const url = new URL(DEEPGRAM_ENDPOINTS[normalizedRegion]);
    url.searchParams.set("model", normalizedModel);
    url.searchParams.set("encoding", "mp3");
    url.searchParams.set("speed", String(clampSpeed(speed)));
    return {
        url: url.toString(),
        model: normalizedModel,
        language: deepgramModelLanguage(normalizedModel),
        region: normalizedRegion,
        speed: clampSpeed(speed)
    };
}

function safeUpstreamError(status) {
    const upstreamStatus = Number(status);
    if ([401, 403].includes(upstreamStatus)) {
        return deepgramError(
            "Deepgram 拒绝了 API Key，请重新填写后再试。",
            "DEEPGRAM_AUTH_FAILED",
            502,
            { upstreamStatus }
        );
    }
    if (upstreamStatus === 429) {
        return deepgramError(
            "Deepgram 当前请求过多或额度不可用，请稍后再试。",
            "DEEPGRAM_RATE_LIMITED",
            502,
            { upstreamStatus }
        );
    }
    return deepgramError(
        "Deepgram 暂时没有返回可播放的语音。",
        "DEEPGRAM_UPSTREAM_ERROR",
        502,
        { upstreamStatus: Number.isFinite(upstreamStatus) ? upstreamStatus : null }
    );
}

async function readDeepgramAudio(response) {
    if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = Buffer.from(value || []);
                total += chunk.length;
                if (total > MAX_DEEPGRAM_AUDIO_BYTES) {
                    await reader.cancel().catch(() => {});
                    throw deepgramError(
                        "Deepgram 返回的语音文件过大。",
                        "DEEPGRAM_AUDIO_TOO_LARGE",
                        502
                    );
                }
                chunks.push(chunk);
            }
        } finally {
            reader.releaseLock?.();
        }
        return Buffer.concat(chunks, total);
    }
    return Buffer.from(await response.arrayBuffer());
}

async function synthesizeDeepgramSpeech({
    text,
    apiKey,
    model,
    region,
    speed,
    timeoutMs = 45_000,
    fetchImpl = fetch
} = {}) {
    const credential = String(apiKey || "").trim();
    if (!credential) {
        throw deepgramError(
            "Deepgram API Key 尚未配置。",
            "DEEPGRAM_CREDENTIAL_REQUIRED",
            503
        );
    }
    const speechText = Array.from(String(text || "").trim())
        .slice(0, MAX_DEEPGRAM_CHARACTERS)
        .join("");
    if (!speechText) {
        throw deepgramError(
            "这条回复没有可朗读的文字。",
            "DEEPGRAM_TEXT_REQUIRED"
        );
    }
    const request = buildDeepgramRequest({ model, region, speed });
    const boundedTimeout = Math.min(
        120_000,
        Math.max(5_000, Number(timeoutMs) || 45_000)
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeout);
    try {
        let response;
        try {
            response = await fetchImpl(request.url, {
                method: "POST",
                headers: {
                    Authorization: `Token ${credential}`,
                    "Content-Type": "application/json",
                    Accept: "audio/mpeg"
                },
                body: JSON.stringify({ text: speechText }),
                signal: controller.signal
            });
        } catch (error) {
            if (error?.name === "AbortError") {
                throw deepgramError(
                    "Deepgram 语音生成等待超时，请稍后再试。",
                    "DEEPGRAM_TIMEOUT",
                    504
                );
            }
            throw deepgramError(
                "暂时无法连接 Deepgram 语音服务。",
                "DEEPGRAM_CONNECTION_FAILED",
                502
            );
        }
        if (!response?.ok) throw safeUpstreamError(response?.status);

        const mimeType = String(response.headers?.get?.("content-type") || "")
            .split(";", 1)[0]
            .trim()
            .toLowerCase();
        if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) {
            throw deepgramError(
                "Deepgram 返回的内容不是 MP3 语音。",
                "DEEPGRAM_AUDIO_TYPE_INVALID",
                502
            );
        }
        const contentLength = Number(response.headers?.get?.("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_DEEPGRAM_AUDIO_BYTES) {
            throw deepgramError(
                "Deepgram 返回的语音文件过大。",
                "DEEPGRAM_AUDIO_TOO_LARGE",
                502
            );
        }
        const audio = await readDeepgramAudio(response);
        if (audio.length === 0 || audio.length > MAX_DEEPGRAM_AUDIO_BYTES) {
            throw deepgramError(
                "Deepgram 没有返回大小正确的 MP3 语音。",
                "DEEPGRAM_AUDIO_SIZE_INVALID",
                502
            );
        }
        return {
            audio,
            contentType: "audio/mpeg",
            provider: "deepgram",
            model: request.model,
            language: request.language,
            emotion: "natural"
        };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    ALLOWED_AUDIO_MIME_TYPES,
    DEEPGRAM_ENDPOINTS,
    DEEPGRAM_LANGUAGES,
    DEEPGRAM_MODELS,
    MAX_DEEPGRAM_AUDIO_BYTES,
    MAX_DEEPGRAM_CHARACTERS,
    buildDeepgramRequest,
    clampSpeed,
    deepgramModelLanguage,
    normalizeDeepgramModel,
    normalizeDeepgramRegion,
    readDeepgramAudio,
    safeUpstreamError,
    synthesizeDeepgramSpeech
};
