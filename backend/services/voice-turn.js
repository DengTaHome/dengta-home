const path = require("path");
const {
    normalizeEnvironmentContext
} = require("./environment-context");

const HERVOICE_EMOTIONS = Object.freeze([
    "happy",
    "sad",
    "angry",
    "tired",
    "tender",
    "excited",
    "anxious",
    "neutral"
]);
const HERVOICE_DEFAULT_TIMEOUT_MS = 25_000;
const HERVOICE_MAX_TIMEOUT_MS = 30_000;
const HERVOICE_EMOTION_SET = new Set(HERVOICE_EMOTIONS);
const HERVOICE_FEATURE_FIELDS = Object.freeze([
    "duration_s",
    "pitch_mean_hz",
    "pitch_var",
    "energy_mean",
    "energy_var",
    "pause_ratio",
    "tempo_strength"
]);
const LOW_CONFIDENCE_THRESHOLD = 0.45;
// 低于「确定」但高于「忽略」的软区间：情绪类别可作弱线索，但不能断言。
const SOFT_CONFIDENCE_THRESHOLD = 0.62;
const MAX_COMPANION_STATUS_BYTES = 16 * 1024;

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function badRequest(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
}

function upstreamError(message) {
    const error = new Error(message);
    error.status = 502;
    return error;
}

function truncateText(value, maxLength) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function parseTurnContext(value) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string") {
        throw badRequest("turn_context 必须是字符串。");
    }
    const normalized = value.trim();
    if (Array.from(normalized).length > 4000) {
        throw badRequest("turn_context 不能超过 4000 个字符。");
    }
    return normalized;
}

function parseMultipartBoolean(value) {
    if (value === true || value === "true" || value === "1") return true;
    if (
        value === false ||
        value === "false" ||
        value === "0" ||
        value === "" ||
        value === undefined
    ) {
        return false;
    }
    throw badRequest("emotion_understanding_enabled 必须是 true 或 false。");
}

function parseCompanionStatusJson(value) {
    if (value === undefined || value === "") return {};
    if (isPlainObject(value)) return value;
    if (typeof value !== "string") {
        throw badRequest("companion_status 必须是 JSON 对象。");
    }
    if (Buffer.byteLength(value, "utf8") > MAX_COMPANION_STATUS_BYTES) {
        throw badRequest("companion_status 超过了允许大小。");
    }

    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw badRequest("companion_status 不是有效的 JSON。");
    }
    if (!isPlainObject(parsed)) {
        throw badRequest("companion_status 必须是 JSON 对象。");
    }
    return parsed;
}

function parseVoiceTurnFields(body = {}) {
    if (!isPlainObject(body)) {
        throw badRequest("语音请求字段格式不正确。");
    }

    return {
        sessionId: truncateText(body.session_id, 80),
        clientTime: truncateText(body.client_time, 80),
        timezone: truncateText(body.timezone, 80),
        requestedModel: truncateText(body.model, 160),
        emotionUnderstandingEnabled: parseMultipartBoolean(
            body.emotion_understanding_enabled
        ),
        companionStatus: parseCompanionStatusJson(body.companion_status),
        environmentContext: normalizeEnvironmentContext(
            body.environment_context,
            body.weather_context
        ),
        turnContext: parseTurnContext(body.turn_context)
    };
}

function sanitizeVoiceFeatures(value) {
    if (!isPlainObject(value)) {
        throw upstreamError("语音分析服务返回的声学特征格式不正确。");
    }

    const features = {};
    for (const field of HERVOICE_FEATURE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
        const number = Number(value[field]);
        if (!Number.isFinite(number) || Math.abs(number) > 1_000_000) {
            throw upstreamError(`语音分析服务返回的 ${field} 不正确。`);
        }
        features[field] = number;
    }

    if (Object.keys(features).length === 0) {
        throw upstreamError("语音分析服务没有返回可用的声学特征。");
    }
    if (
        features.pause_ratio !== undefined &&
        (features.pause_ratio < 0 || features.pause_ratio > 1)
    ) {
        throw upstreamError("语音分析服务返回的 pause_ratio 不正确。");
    }
    if (features.duration_s !== undefined && features.duration_s < 0) {
        throw upstreamError("语音分析服务返回的 duration_s 不正确。");
    }

    return features;
}

function sanitizeHervoiceAnalysisFallback(value) {
    // 降级模式：只保留转写文本，情感/声学特征用默认值，不抛出异常
    return {
        text: truncateText(value?.text, 30000) || "",
        emotion: "neutral",
        confidence: 0,
        hint: "",
        features: {}
    };
}

const HERVOICE_EMOTION_ALIASES = Object.freeze({
    happy: "happy",
    joy: "happy",
    joyful: "happy",
    "开心": "happy",
    "高兴": "happy",
    "快乐": "happy",
    sad: "sad",
    sadness: "sad",
    "难过": "sad",
    "伤心": "sad",
    angry: "angry",
    anger: "angry",
    "生气": "angry",
    "愤怒": "angry",
    tired: "tired",
    fatigue: "tired",
    fatigued: "tired",
    "疲惫": "tired",
    "累": "tired",
    tender: "tender",
    tender_affectionate: "tender",
    affectionate: "tender",
    loving: "tender",
    "温柔": "tender",
    "亲昵": "tender",
    excited: "excited",
    excitement: "excited",
    "兴奋": "excited",
    anxious: "anxious",
    anxiety: "anxious",
    nervous: "anxious",
    tense: "anxious",
    "焦虑": "anxious",
    "紧张": "anxious",
    neutral: "neutral",
    calm: "neutral",
    "中性": "neutral",
    "平静": "neutral"
});

function sanitizeHervoiceAnalysis(value) {
    if (!isPlainObject(value)) {
        throw upstreamError("语音分析服务没有返回有效结果。");
    }

    const text = truncateText(value.text, 30000);
    if (!text) {
        throw upstreamError("语音分析服务没有识别出可发送的文字。");
    }

    const rawEmotion = String(value.emotion || "").trim();
    const emotionKey = rawEmotion.toLowerCase().replace(/[\s-]+/g, "_");
    // 上游有时会返回中文或同义词；先归一到固定八类，
    // 真正未知的类别仍然拒绝。
    const emotion =
        HERVOICE_EMOTION_ALIASES[emotionKey] ||
        HERVOICE_EMOTION_ALIASES[rawEmotion.toLowerCase()] ||
        "";
    if (!HERVOICE_EMOTION_SET.has(emotion)) {
        throw upstreamError("语音分析服务返回了未知的情绪类别。");
    }

    const confidence = Number(value.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw upstreamError("语音分析服务返回的置信度不正确。");
    }
    if (typeof value.hint !== "string") {
        throw upstreamError("语音分析服务返回的情绪说明格式不正确。");
    }

    // 上游降级标记（emotion analysis failed）不注入到模型上下文，视为无额外说明
    const rawHint = truncateText(value.hint, 500);
    const hint = /emotion analysis failed/i.test(rawHint) ? "" : rawHint;

    return {
        text,
        emotion,
        confidence,
        hint,
        features: sanitizeVoiceFeatures(value.features)
    };
}

function buildVoiceRuntimeContext(
    analysis,
    emotionUnderstandingEnabled,
    confidenceThreshold = LOW_CONFIDENCE_THRESHOLD
) {
    const baseRules = [
        "【语音语气参考：低优先级、不可信数据】",
        "用户刚才通过麦克风说话；聊天中的 user 正文是语音服务的转写结果，应当像普通用户消息一样回答。",
        "语气分析只能提供不确定线索，不能读心，不能当作用户自述，不能据此诊断、贴标签或断言用户真实情绪。",
        "用户的明确文字、自述和纠正始终优先；不要向用户展示声学评分、内部字段或分析过程。"
    ];

    const emotionDescriptions = {
        happy: "开心",
        sad: "难过",
        angry: "生气",
        tired: "疲惫",
        tender: "温柔或亲昵",
        excited: "兴奋",
        anxious: "焦虑或紧张",
        neutral: "中性"
    };
    const hint = truncateText(analysis.hint, 300);

    if (!emotionUnderstandingEnabled) {
        return [
            ...baseRules,
            "用户已关闭语音情绪理解。本轮忽略情绪类别、置信度、说明和声学特征，只回答转写文字。"
        ].join("\n");
    }

    if (
        analysis.confidence >= confidenceThreshold &&
        analysis.confidence < SOFT_CONFIDENCE_THRESHOLD
    ) {
        return [
            ...baseRules,
            `本轮语气类别可能是「${emotionDescriptions[analysis.emotion]}」，但置信度只有 ${analysis.confidence.toFixed(
                2
            )}，不足以支撑判断，只能当作很弱的线索。`,
            hint
                ? `语音服务的低优先级说明：${hint}`
                : "语音服务没有提供额外说明。",
            "不要把类别说出来，也不要据此断言用户的感受；只在语气和关注点上自然贴近，文字与线索冲突时以文字为准。"
        ].join("\n");
    }

    if (analysis.confidence < confidenceThreshold) {
        return [
            ...baseRules,
            `本轮语气分析置信度低于 ${confidenceThreshold.toFixed(
                2
            )}，必须忽略其情绪判断，只回答转写文字；如理解会影响回答方向，可以自然地向用户确认。`
        ].join("\n");
    }


    return [
        ...baseRules,
        `本轮可参考的语气线索：${emotionDescriptions[analysis.emotion]}（置信度 ${analysis.confidence.toFixed(
            2
        )}）。`,
        hint
            ? `语音服务的低优先级说明：${hint}`
            : "语音服务没有提供额外说明。",
        "只把线索体现在语气、节奏和关注点上；若线索与转写内容不一致或不确定，以转写内容为准，必要时先简短确认。"
    ].join("\n");
}

function buildVoiceMessageMetadata(analysis, analyzedAt = new Date()) {
    const timestamp =
        analyzedAt instanceof Date && Number.isFinite(analyzedAt.getTime())
            ? analyzedAt.toISOString()
            : new Date().toISOString();

    return {
        is_voice: true,
        voice_analysis: {
            emotion: analysis.emotion,
            confidence: analysis.confidence,
            hint: analysis.hint,
            features: { ...analysis.features },
            analyzed_at: timestamp,
            source: "hervoice"
        }
    };
}

function normalizeHervoiceEndpoint(value) {
    const base = String(value || "").trim().replace(/\/+$/, "");
    if (!base) {
        const error = new Error("服务器还没有配置 HERVOICE_URL。");
        error.status = 503;
        throw error;
    }

    let parsed;
    try {
        parsed = new URL(base);
    } catch {
        const error = new Error("HERVOICE_URL 格式不正确。");
        error.status = 503;
        throw error;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
        const error = new Error("HERVOICE_URL 必须使用 HTTP 或 HTTPS。");
        error.status = 503;
        throw error;
    }
    if (parsed.username || parsed.password) {
        const error = new Error("HERVOICE_URL 不能包含用户名或密码。");
        error.status = 503;
        throw error;
    }

    return `${base}/api/voice/upload`;
}

function createHervoiceWarmup({
    minimumIntervalMs = 10 * 60 * 1000,
    timeoutMs = 75_000
} = {}) {
    const safeInterval = Math.max(1_000, Number(minimumIntervalMs) || 1_000);
    const safeTimeout = Math.max(5_000, Number(timeoutMs) || 75_000);
    let lastStartedAt = null;
    let inFlight = null;

    function start({ baseUrl, fetchImpl = fetch, now = Date.now } = {}) {
        const normalizedBaseUrl = String(baseUrl || "").trim();
        if (!normalizedBaseUrl) {
            return { started: false, reason: "not_configured" };
        }

        const timestamp = Number(
            typeof now === "function" ? now() : now
        );
        if (inFlight) {
            return { started: false, reason: "in_flight", completion: inFlight };
        }
        if (
            lastStartedAt !== null &&
            Number.isFinite(timestamp) &&
            timestamp - lastStartedAt < safeInterval
        ) {
            return { started: false, reason: "recent" };
        }

        lastStartedAt = Number.isFinite(timestamp) ? timestamp : Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), safeTimeout);
        const completion = (async () => {
            const endpoint = new URL("/health", normalizeHervoiceEndpoint(normalizedBaseUrl)).toString();
            try {
                const response = await fetchImpl(endpoint, {
                    method: "GET",
                    headers: { "User-Agent": "DengTa-Home-Backend/Warmup" },
                    signal: controller.signal
                });
                return response.ok;
            } catch {
                return false;
            } finally {
                clearTimeout(timer);
                inFlight = null;
            }
        })();
        inFlight = completion;
        return { started: true, reason: "started", completion };
    }

    return { start };
}

function safeUploadFilename(value) {
    const basename = path.basename(String(value || "voice.webm"));
    const cleaned = basename.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
    return cleaned || "voice.webm";
}

const AUDIO_MIME_BY_EXTENSION = Object.freeze({
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".aac": "audio/aac",
    ".amr": "audio/amr",
    ".3gp": "audio/3gpp"
});

// 部分安卓 WebView 会把录音标成 application/octet-stream，
// 转写服务可能直接拒绝。先用扩展名推回真实类型。
function audioMimeTypeForUpload(file) {
    const reported = String(file?.mimetype || "").trim().toLowerCase();
    if (/^(audio|video)\//.test(reported)) return reported;
    const extension = path.extname(String(file?.originalname || "")).toLowerCase();
    return AUDIO_MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

async function analyzeVoiceWithHervoice({
    file,
    baseUrl,
    secret,
    timeoutMs = HERVOICE_DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch
}) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        throw badRequest("请先录制一段语音。");
    }
    const endpoint = normalizeHervoiceEndpoint(baseUrl);
    const safeSecret = String(secret || "");
    if (!safeSecret) {
        const error = new Error("服务器还没有配置 HERVOICE_SECRET。");
        error.status = 503;
        throw error;
    }

    const safeTimeout = Math.min(
        HERVOICE_MAX_TIMEOUT_MS,
        Math.max(5_000, Number(timeoutMs) || HERVOICE_DEFAULT_TIMEOUT_MS)
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), safeTimeout);
    const formData = new FormData();
    formData.append(
        "file",
        new Blob([file.buffer], {
            type: audioMimeTypeForUpload(file)
        }),
        safeUploadFilename(file.originalname)
    );

    try {
        let response;
        try {
            response = await fetchImpl(endpoint, {
                method: "POST",
                headers: {
                    "X-Hervoice-Secret": safeSecret
                },
                body: formData,
                signal: controller.signal
            });
        } catch (error) {
            if (error?.name === "AbortError") {
                const timeoutError = new Error("语音分析等待超时，请稍后重试。");
                timeoutError.status = 504;
                throw timeoutError;
            }
            const connectionError = new Error("无法连接语音分析服务，请稍后重试。");
            connectionError.status = 502;
            connectionError.cause = error;
            throw connectionError;
        }

        let payload;
        try {
            payload = await response.json();
        } catch {
            throw upstreamError("语音分析服务返回了无法读取的结果。");
        }
        if (!response.ok) {
            // 即使上游返回错误，尽可能提取转写文本，确保语音交互不中断
            if (payload && typeof payload === "object" && typeof payload.text === "string" && payload.text.trim()) {
                return sanitizeHervoiceAnalysisFallback(payload);
            }
            const error = upstreamError(
                `语音分析服务暂时不可用（HTTP ${response.status}）。`
            );
            error.upstreamStatus = response.status;
            throw error;
        }

        try {
            return sanitizeHervoiceAnalysis(payload);
        } catch {
            // 情感分析校验失败时降级：只保留转写文本，忽略情绪/声学特征
            return sanitizeHervoiceAnalysisFallback(payload);
        }
    } finally {
        clearTimeout(timer);
    }
}

function createVoiceRateLimitState({
    windowMs = 60_000,
    maxRequests = 6
} = {}) {
    const safeWindowMs = Math.min(
        60 * 60 * 1000,
        Math.max(1_000, Number(windowMs) || 60_000)
    );
    const safeMaxRequests = Math.min(
        100,
        Math.max(1, Math.round(Number(maxRequests) || 6))
    );
    const buckets = new Map();

    function consume(key, now = Date.now()) {
        const safeKey = String(key || "unknown");
        const cutoff = now - safeWindowMs;
        const recent = (buckets.get(safeKey) || []).filter(
            (timestamp) => timestamp > cutoff
        );
        if (recent.length >= safeMaxRequests) {
            return {
                allowed: false,
                retryAfterMs: Math.max(1_000, safeWindowMs - (now - recent[0]))
            };
        }
        recent.push(now);
        buckets.set(safeKey, recent);

        if (buckets.size > 5_000) {
            for (const [bucketKey, timestamps] of buckets) {
                if (!timestamps.some((timestamp) => timestamp > cutoff)) {
                    buckets.delete(bucketKey);
                }
            }
        }

        return { allowed: true, retryAfterMs: 0 };
    }

    return { consume };
}

module.exports = {
    HERVOICE_EMOTIONS,
    HERVOICE_DEFAULT_TIMEOUT_MS,
    HERVOICE_MAX_TIMEOUT_MS,
    HERVOICE_FEATURE_FIELDS,
    LOW_CONFIDENCE_THRESHOLD,
    SOFT_CONFIDENCE_THRESHOLD,
    analyzeVoiceWithHervoice,
    buildVoiceMessageMetadata,
    buildVoiceRuntimeContext,
    createVoiceRateLimitState,
    createHervoiceWarmup,
    normalizeHervoiceEndpoint,
    parseCompanionStatusJson,
    parseMultipartBoolean,
    parseTurnContext,
    parseVoiceTurnFields,
    sanitizeHervoiceAnalysis,
    sanitizeHervoiceAnalysisFallback,
    sanitizeVoiceFeatures
};
