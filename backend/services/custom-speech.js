/**
 * 自定义语音服务商（用户自带语音接口）。
 *
 * 设计目标：让每个 DengTa 用户把**自己的**语音服务接进来，而不是只能等服务器
 * 配置 MiniMax。三种接入方式：
 *
 *   1. edge                微软 Edge Read Aloud 的免费神经语音（无需 Key，音色自然）
 *   2. openai_compatible   OpenAI `/v1/audio/speech` 兼容接口（硅基流动/Fish/自建网关等）
 *   3. custom_http         任意 HTTP API：自定义 URL/方法/请求头/请求体模板，支持
 *                          二进制音频、JSON base64、JSON 里的音频 URL 三种返回
 *
 * 安全边界（用户填的 URL 会被服务端请求，必须防 SSRF）：
 *   - 默认只允许 https 公网地址；
 *   - 默认禁止 localhost/私网/云元数据地址；
 *   - 自托管用户可用环境变量放行：
 *       VOICE_CUSTOM_ALLOW_HTTP=1     允许 http（自建本地 TTS）
 *       VOICE_CUSTOM_ALLOW_PRIVATE=1  允许私网/本机地址
 *   - 音频响应有体积上限与超时，防止打满内存。
 *
 * 只做“合成”，不碰鉴权/租户/加密；这些由 voice-provider-center 负责。
 */
"use strict";

const crypto = require("node:crypto");

const MAX_TEXT_CHARS = 4000;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
const EDGE_DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const EDGE_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const EDGE_TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_SEC_MS_GEC_VERSION = "1-130.0.2849.68";
const EDGE_WSS_URL =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

const CUSTOM_PROVIDER_IDS = Object.freeze(["edge", "openai_compatible", "custom_http"]);

const OUTPUT_FORMATS = Object.freeze([
    { id: "mp3", label: "MP3", contentType: "audio/mpeg" },
    { id: "opus", label: "Opus", contentType: "audio/ogg" },
    { id: "aac", label: "AAC", contentType: "audio/aac" },
    { id: "flac", label: "FLAC", contentType: "audio/flac" },
    { id: "wav", label: "WAV", contentType: "audio/wav" },
    { id: "pcm", label: "PCM", contentType: "audio/L16" }
]);

const RESPONSE_MODES = Object.freeze([
    { id: "binary", label: "直接返回音频二进制" },
    { id: "json_base64", label: "JSON 里返回 base64 音频" },
    { id: "json_url", label: "JSON 里返回音频 URL" }
]);

/**
 * Edge TTS 常用神经音色（不是全集，但覆盖中/英/日/韩/德/法/西最常用的人声）。
 * 音色 ID 仍会做格式校验，厂商新增音色可直接填。
 */
const EDGE_VOICES = Object.freeze([
    { id: "zh-CN-XiaoxiaoNeural", label: "晓晓 · 温柔女声（推荐）", language: "zh-CN", gender: "女" },
    { id: "zh-CN-XiaoyiNeural", label: "晓伊 · 活泼女声", language: "zh-CN", gender: "女" },
    { id: "zh-CN-YunxiNeural", label: "云希 · 少年男声（推荐）", language: "zh-CN", gender: "男" },
    { id: "zh-CN-YunjianNeural", label: "云健 · 沉稳男声", language: "zh-CN", gender: "男" },
    { id: "zh-CN-YunyangNeural", label: "云扬 · 新闻男声", language: "zh-CN", gender: "男" },
    { id: "zh-CN-YunxiaNeural", label: "云夏 · 少年男声", language: "zh-CN", gender: "男" },
    { id: "zh-CN-liaoning-XiaobeiNeural", label: "晓北 · 东北女声", language: "zh-CN", gender: "女" },
    { id: "zh-CN-shaanxi-XiaoniNeural", label: "晓妮 · 陕西女声", language: "zh-CN", gender: "女" },
    { id: "zh-TW-HsiaoChenNeural", label: "曉臻 · 台湾女声", language: "zh-TW", gender: "女" },
    { id: "zh-TW-YunJheNeural", label: "雲哲 · 台湾男声", language: "zh-TW", gender: "男" },
    { id: "zh-HK-HiuGaaiNeural", label: "曉佳 · 粤语女声", language: "zh-HK", gender: "女" },
    { id: "zh-HK-WanLungNeural", label: "雲龍 · 粤语男声", language: "zh-HK", gender: "男" },
    { id: "en-US-AvaNeural", label: "Ava · 美式女声", language: "en-US", gender: "女" },
    { id: "en-US-JennyNeural", label: "Jenny · 美式女声", language: "en-US", gender: "女" },
    { id: "en-US-AriaNeural", label: "Aria · 美式女声", language: "en-US", gender: "女" },
    { id: "en-US-GuyNeural", label: "Guy · 美式男声", language: "en-US", gender: "男" },
    { id: "en-US-AndrewNeural", label: "Andrew · 美式男声", language: "en-US", gender: "男" },
    { id: "en-GB-SoniaNeural", label: "Sonia · 英式女声", language: "en-GB", gender: "女" },
    { id: "en-GB-RyanNeural", label: "Ryan · 英式男声", language: "en-GB", gender: "男" },
    { id: "ja-JP-NanamiNeural", label: "七海 · 日语女声", language: "ja-JP", gender: "女" },
    { id: "ja-JP-KeitaNeural", label: "圭太 · 日语男声", language: "ja-JP", gender: "男" },
    { id: "ko-KR-SunHiNeural", label: "善喜 · 韩语女声", language: "ko-KR", gender: "女" },
    { id: "ko-KR-InJoonNeural", label: "仁俊 · 韩语男声", language: "ko-KR", gender: "男" },
    { id: "de-DE-KatjaNeural", label: "Katja · 德语女声", language: "de-DE", gender: "女" },
    { id: "fr-FR-DeniseNeural", label: "Denise · 法语女声", language: "fr-FR", gender: "女" },
    { id: "es-ES-ElviraNeural", label: "Elvira · 西语女声", language: "es-ES", gender: "女" }
]);

function customSpeechError(message, code, status = 400) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    error.isCustomSpeechError = true;
    return error;
}

function cleanText(value, maxLength) {
    return Array.from(String(value ?? "").trim()).slice(0, maxLength).join("");
}

function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function isCustomProvider(value) {
    return CUSTOM_PROVIDER_IDS.includes(String(value || ""));
}

function contentTypeForFormat(format) {
    const entry = OUTPUT_FORMATS.find((item) => item.id === String(format || "").toLowerCase());
    return entry ? entry.contentType : "audio/mpeg";
}

function normalizeFormat(value) {
    const found = OUTPUT_FORMATS.find((item) => item.id === String(value || "").toLowerCase());
    return found ? found.id : "mp3";
}

function normalizeResponseMode(value) {
    const found = RESPONSE_MODES.find((item) => item.id === String(value || ""));
    return found ? found.id : "binary";
}

function edgeVoiceAllowed(voice) {
    const value = String(voice || "").trim();
    if (EDGE_VOICES.some((item) => item.id === value)) return true;
    // 允许厂商后续新增音色：语言-名称Neural 的形式
    return /^[a-z]{2,3}(-[A-Za-z]{2,4})?-[A-Za-z0-9]{2,40}Neural$/.test(value);
}

function isPrivateHostname(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    if (!host) return true;
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (host === "metadata.google.internal" || host === "metadata") return true;
    if (host === "0.0.0.0" || host === "::" || host === "::1") return true;
    if (/^127\./.test(host)) return true;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return true;
    if (/^169\.254\./.test(host)) return true;
    if (/^fc[0-9a-f]{2}:/i.test(host) || /^fd[0-9a-f]{2}:/i.test(host)) return true;
    if (/^fe80:/i.test(host)) return true;
    return false;
}

/**
 * 校验用户填入的服务地址，返回 URL 对象。默认只允许 https 公网。
 */
function assertSafeOutboundUrl(rawUrl, env = process.env) {
    const value = String(rawUrl || "").trim();
    if (!value) {
        throw customSpeechError("请填写语音服务地址。", "CUSTOM_TTS_URL_REQUIRED");
    }
    let url;
    try {
        url = new URL(value);
    } catch {
        throw customSpeechError("语音服务地址不是合法 URL。", "CUSTOM_TTS_URL_INVALID");
    }
    const allowHttp = String(env.VOICE_CUSTOM_ALLOW_HTTP || "") === "1";
    const allowPrivate = String(env.VOICE_CUSTOM_ALLOW_PRIVATE || "") === "1";
    if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
        throw customSpeechError(
            "语音服务地址必须是 https://（自托管可在服务端设置 VOICE_CUSTOM_ALLOW_HTTP=1 放行 http）。",
            "CUSTOM_TTS_URL_INSECURE"
        );
    }
    if (!allowPrivate && isPrivateHostname(url.hostname)) {
        throw customSpeechError(
            "语音服务地址不能指向本机或内网（自托管可在服务端设置 VOICE_CUSTOM_ALLOW_PRIVATE=1 放行）。",
            "CUSTOM_TTS_URL_PRIVATE"
        );
    }
    return url;
}

async function readAudioBytes(response, { limit = MAX_AUDIO_BYTES } = {}) {
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > limit) {
        throw customSpeechError("语音服务返回的音频过大。", "CUSTOM_TTS_AUDIO_TOO_LARGE", 502);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
        throw customSpeechError("语音服务没有返回音频。", "CUSTOM_TTS_EMPTY_AUDIO", 502);
    }
    if (buffer.length > limit) {
        throw customSpeechError("语音服务返回的音频过大。", "CUSTOM_TTS_AUDIO_TOO_LARGE", 502);
    }
    return buffer;
}

function upstreamFailure(response, label) {
    return customSpeechError(
        `${label}语音服务暂时不可用（HTTP ${response.status}）。`,
        "CUSTOM_TTS_UPSTREAM",
        502
    );
}

function withTimeout(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
        signal: controller.signal,
        done() {
            clearTimeout(timer);
        }
    };
}

// ---------------------------------------------------------------------------
// 1. Edge Read Aloud（免费、免 Key）
// ---------------------------------------------------------------------------

function secMsGec(now = Date.now()) {
    let ticks = (BigInt(Math.floor(now / 1000)) + 11644473600n) * 10000000n;
    ticks -= ticks % 30000000000n;
    return crypto
        .createHash("sha256")
        .update(`${ticks.toString()}${EDGE_TRUSTED_CLIENT_TOKEN}`)
        .digest("hex")
        .toUpperCase();
}

function edgeSsml(text, { voice, rate = 0, pitch = 0, volume = 0 }) {
    const escape = (value) =>
        String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    const signed = (n) => `${n >= 0 ? "+" : ""}${n}%`;
    const language = String(voice).split("-").slice(0, 2).join("-");
    return (
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${language}'>` +
        `<voice name='${escape(voice)}'>` +
        `<prosody rate='${signed(rate)}' pitch='${signed(pitch)}' volume='${signed(volume)}'>` +
        `${escape(text)}</prosody></voice></speak>`
    );
}

/**
 * 通过 Edge 的 WebSocket 合成语音。注入 WebSocketImpl 便于单测。
 */
function synthesizeEdgeSpeech({
    text,
    voice = EDGE_DEFAULT_VOICE,
    rate = 0,
    pitch = 0,
    volume = 0,
    timeoutMs = 30000,
    WebSocketImpl = globalThis.WebSocket,
    now = () => Date.now()
} = {}) {
    const speechText = cleanText(text, MAX_TEXT_CHARS);
    if (!speechText) {
        return Promise.reject(
            customSpeechError("没有可朗读的文字。", "CUSTOM_TTS_EMPTY_TEXT", 400)
        );
    }
    const chosenVoice = String(voice || EDGE_DEFAULT_VOICE).trim();
    if (!edgeVoiceAllowed(chosenVoice)) {
        return Promise.reject(
            customSpeechError("Edge 音色名称不合法。", "CUSTOM_TTS_VOICE_INVALID", 400)
        );
    }
    if (typeof WebSocketImpl !== "function") {
        return Promise.reject(
            customSpeechError(
                "当前 Node 运行时不支持 WebSocket，无法使用免费 Edge 语音。",
                "CUSTOM_TTS_EDGE_UNAVAILABLE",
                503
            )
        );
    }

    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID().replace(/-/g, "");
        const connectionId = crypto.randomUUID().replace(/-/g, "");
        const timestamp = new Date(now()).toISOString();
        const url =
            `${EDGE_WSS_URL}?TrustedClientToken=${EDGE_TRUSTED_CLIENT_TOKEN}` +
            `&ConnectionId=${connectionId}` +
            `&Sec-MS-GEC=${secMsGec(now())}` +
            `&Sec-MS-GEC-Version=${EDGE_SEC_MS_GEC_VERSION}`;
        const chunks = [];
        let settled = false;
        let socket;
        const timer = setTimeout(() => finish(
            customSpeechError("免费语音合成超时，请稍后重试。", "CUSTOM_TTS_TIMEOUT", 504)
        ), clampNumber(timeoutMs, 30000, 5000, 120000));

        function finish(error, audio) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                socket?.close?.();
            } catch {
                /* ignore */
            }
            if (error) reject(error);
            else resolve(audio);
        }

        try {
            socket = new WebSocketImpl(url);
        } catch (error) {
            finish(customSpeechError(
                `免费语音合成连接失败：${error?.message || "未知错误"}`,
                "CUSTOM_TTS_EDGE_CONNECT",
                502
            ));
            return;
        }

        const handleOpen = () => {
            try {
                socket.send(
                    `X-Timestamp:${timestamp}\r\n` +
                        "Content-Type:application/json; charset=utf-8\r\n" +
                        "Path:speech.config\r\n\r\n" +
                        JSON.stringify({
                            context: {
                                synthesis: {
                                    audio: {
                                        metadataoptions: {
                                            sentenceBoundaryEnabled: "false",
                                            wordBoundaryEnabled: "false"
                                        },
                                        outputFormat: EDGE_OUTPUT_FORMAT
                                    }
                                }
                            }
                        })
                );
                socket.send(
                    `X-RequestId:${requestId}\r\n` +
                        "Content-Type:application/ssml+xml\r\n" +
                        `X-Timestamp:${timestamp}Z\r\n` +
                        "Path:ssml\r\n\r\n" +
                        edgeSsml(speechText, { voice: chosenVoice, rate, pitch, volume })
                );
            } catch (error) {
                finish(customSpeechError(
                    `免费语音请求发送失败：${error?.message || "未知错误"}`,
                    "CUSTOM_TTS_EDGE_SEND",
                    502
                ));
            }
        };

        const handleMessage = (event) => {
            const data = event?.data ?? event;
            if (typeof data === "string") {
                if (data.includes("Path:turn.end")) {
                    const audio = Buffer.concat(chunks);
                    if (!audio.length) {
                        finish(customSpeechError(
                            "免费语音没有返回音频。",
                            "CUSTOM_TTS_EDGE_EMPTY",
                            502
                        ));
                        return;
                    }
                    finish(null, {
                        audio,
                        contentType: "audio/mpeg",
                        provider: "edge",
                        model: chosenVoice,
                        emotion: "natural"
                    });
                }
                return;
            }
            const buffer = Buffer.isBuffer(data)
                ? data
                : data instanceof ArrayBuffer
                  ? Buffer.from(data)
                  : Buffer.from(data?.buffer || data);
            // Edge 二进制帧：2 字节头长度 + 头文本 + 音频
            if (buffer.length > 2) {
                const headerLength = buffer.readUInt16BE(0);
                const body = buffer.subarray(2 + headerLength);
                if (body.length) chunks.push(body);
            }
        };

        const handleError = () => {
            finish(customSpeechError(
                "免费语音合成连接中断。",
                "CUSTOM_TTS_EDGE_ERROR",
                502
            ));
        };

        if (typeof socket.addEventListener === "function") {
            socket.addEventListener("open", handleOpen);
            socket.addEventListener("message", handleMessage);
            socket.addEventListener("error", handleError);
        } else {
            socket.onopen = handleOpen;
            socket.onmessage = handleMessage;
            socket.onerror = handleError;
        }
    });
}

// ---------------------------------------------------------------------------
// 2. OpenAI 兼容 /audio/speech
// ---------------------------------------------------------------------------

function normalizeOpenAiEndpoint(rawBase, env = process.env) {
    const value = String(rawBase || OPENAI_DEFAULT_BASE).trim().replace(/\/+$/, "");
    const endpoint = /\/audio\/speech$/i.test(value) ? value : `${value}/audio/speech`;
    assertSafeOutboundUrl(endpoint, env);
    return endpoint;
}

async function synthesizeOpenAiSpeech({
    text,
    apiBaseUrl = OPENAI_DEFAULT_BASE,
    apiKey = "",
    model = "tts-1",
    voice = "alloy",
    format = "mp3",
    speed = 1,
    timeoutMs = 30000,
    env = process.env,
    fetchImpl = fetch
} = {}) {
    const speechText = cleanText(text, MAX_TEXT_CHARS);
    if (!speechText) {
        throw customSpeechError("没有可朗读的文字。", "CUSTOM_TTS_EMPTY_TEXT", 400);
    }
    const endpoint = normalizeOpenAiEndpoint(apiBaseUrl, env);
    const chosenFormat = normalizeFormat(format);
    const chosenModel = cleanText(model, 120) || "tts-1";
    const chosenVoice = cleanText(voice, 120) || "alloy";
    const timer = withTimeout(clampNumber(timeoutMs, 30000, 5000, 120000));
    try {
        let response;
        try {
            response = await fetchImpl(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
                },
                body: JSON.stringify({
                    model: chosenModel,
                    input: speechText,
                    voice: chosenVoice,
                    response_format: chosenFormat,
                    speed: clampNumber(speed, 1, 0.25, 4)
                }),
                signal: timer.signal
            });
        } catch (error) {
            if (error?.name === "AbortError") {
                throw customSpeechError("语音服务响应超时。", "CUSTOM_TTS_TIMEOUT", 504);
            }
            throw customSpeechError(
                "无法连接你配置的语音服务。",
                "CUSTOM_TTS_UNREACHABLE",
                502
            );
        }
        if (!response.ok) throw upstreamFailure(response, "你配置的 ");
        const audio = await readAudioBytes(response);
        const headerType = response.headers?.get?.("content-type") || "";
        return {
            audio,
            contentType: headerType.startsWith("audio/")
                ? headerType.split(";")[0]
                : contentTypeForFormat(chosenFormat),
            provider: "openai_compatible",
            model: chosenModel,
            voice: chosenVoice,
            emotion: "natural"
        };
    } finally {
        timer.done();
    }
}

// ---------------------------------------------------------------------------
// 3. 任意 HTTP 模板
// ---------------------------------------------------------------------------

function renderTemplate(template, variables) {
    return String(template || "").replace(/\{\{([a-z_]+)\}\}/gi, (match, key) => {
        const name = String(key).toLowerCase();
        if (name === "text_json") {
            return JSON.stringify(String(variables.text ?? "")).slice(1, -1);
        }
        if (!(name in variables)) return match;
        return String(variables[name] ?? "");
    });
}

function parseDotPath(data, path) {
    const segments = String(path || "").split(".").filter(Boolean);
    let current = data;
    for (const segment of segments) {
        if (current == null) return undefined;
        current = current[segment];
    }
    return current;
}

async function synthesizeCustomHttpSpeech({
    text,
    apiBaseUrl = "",
    apiKey = "",
    model = "",
    voice = "",
    format = "mp3",
    method = "POST",
    headersTemplate = "",
    bodyTemplate = "",
    responseMode = "binary",
    audioPath = "",
    mimeType = "",
    timeoutMs = 30000,
    env = process.env,
    fetchImpl = fetch
} = {}) {
    const speechText = cleanText(text, MAX_TEXT_CHARS);
    if (!speechText) {
        throw customSpeechError("没有可朗读的文字。", "CUSTOM_TTS_EMPTY_TEXT", 400);
    }
    const url = assertSafeOutboundUrl(apiBaseUrl, env);
    const chosenMethod = String(method || "POST").toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH"].includes(chosenMethod)) {
        throw customSpeechError("自定义接口只支持 GET/POST/PUT/PATCH。", "CUSTOM_TTS_METHOD_INVALID");
    }
    const mode = normalizeResponseMode(responseMode);
    const chosenFormat = normalizeFormat(format);
    const variables = {
        text: speechText,
        text_json: speechText,
        voice: voice || "",
        model: model || "",
        format: chosenFormat,
        api_key: apiKey || ""
    };

    let headers = { "Content-Type": "application/json", Accept: "audio/*, application/json" };
    if (headersTemplate) {
        let parsed;
        try {
            parsed = typeof headersTemplate === "string" ? JSON.parse(headersTemplate) : headersTemplate;
        } catch {
            throw customSpeechError("请求头 JSON 格式不正确。", "CUSTOM_TTS_HEADERS_INVALID");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw customSpeechError("请求头必须是 JSON 对象。", "CUSTOM_TTS_HEADERS_INVALID");
        }
        headers = {};
        for (const [key, value] of Object.entries(parsed).slice(0, 40)) {
            if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) continue;
            headers[key] = renderTemplate(String(value ?? ""), variables);
        }
        headers["Content-Type"] = headers["Content-Type"] || "application/json";
        headers.Accept = headers.Accept || "audio/*, application/json";
    }
    if (apiKey && !Object.keys(headers).some((key) => key.toLowerCase() === "authorization")) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const defaultBody = JSON.stringify({
        text: speechText,
        voice: voice || "",
        model: model || "",
        format: chosenFormat
    });
    let body;
    if (chosenMethod !== "GET") {
        const template = String(bodyTemplate || defaultBody).slice(0, 8000);
        body = renderTemplate(template, variables);
    }

    const timer = withTimeout(clampNumber(timeoutMs, 30000, 5000, 120000));
    try {
        let response;
        try {
            response = await fetchImpl(url.toString(), {
                method: chosenMethod,
                headers,
                ...(body !== undefined ? { body } : {}),
                signal: timer.signal
            });
        } catch (error) {
            if (error?.name === "AbortError") {
                throw customSpeechError("自定义语音接口响应超时。", "CUSTOM_TTS_TIMEOUT", 504);
            }
            throw customSpeechError("无法连接自定义语音接口。", "CUSTOM_TTS_UNREACHABLE", 502);
        }
        if (!response.ok) throw upstreamFailure(response, "自定义 ");

        if (mode === "binary") {
            const audio = await readAudioBytes(response);
            const headerType = response.headers?.get?.("content-type") || "";
            return {
                audio,
                contentType: headerType.startsWith("audio/")
                    ? headerType.split(";")[0]
                    : mimeType || contentTypeForFormat(chosenFormat),
                provider: "custom_http",
                model: model || "",
                voice: voice || "",
                emotion: "natural"
            };
        }

        let data;
        try {
            data = await response.json();
        } catch {
            throw customSpeechError(
                "自定义接口返回的不是 JSON，但响应模式要求 JSON。",
                "CUSTOM_TTS_RESPONSE_INVALID",
                502
            );
        }
        const value = parseDotPath(data, audioPath || (mode === "json_url" ? "data.url" : "data.audio"));
        if (!value || typeof value !== "string") {
            throw customSpeechError(
                `自定义接口的 JSON 里找不到音频字段（${audioPath || "data.audio"}）。`,
                "CUSTOM_TTS_RESPONSE_MISSING",
                502
            );
        }
        if (mode === "json_base64") {
            const base64 = value.replace(/^data:[^;]+;base64,/, "");
            const audio = Buffer.from(base64, "base64");
            if (!audio.length) {
                throw customSpeechError("自定义接口返回的 base64 音频为空。", "CUSTOM_TTS_EMPTY_AUDIO", 502);
            }
            if (audio.length > MAX_AUDIO_BYTES) {
                throw customSpeechError("自定义接口返回的音频过大。", "CUSTOM_TTS_AUDIO_TOO_LARGE", 502);
            }
            return {
                audio,
                contentType: mimeType || contentTypeForFormat(chosenFormat),
                provider: "custom_http",
                model: model || "",
                voice: voice || "",
                emotion: "natural"
            };
        }
        // json_url
        const audioUrl = assertSafeOutboundUrl(value, env);
        let audioResponse;
        try {
            audioResponse = await fetchImpl(audioUrl.toString(), { signal: timer.signal });
        } catch (error) {
            if (error?.name === "AbortError") {
                throw customSpeechError("下载自定义音频超时。", "CUSTOM_TTS_TIMEOUT", 504);
            }
            throw customSpeechError("无法下载自定义接口返回的音频。", "CUSTOM_TTS_UNREACHABLE", 502);
        }
        if (!audioResponse.ok) throw upstreamFailure(audioResponse, "自定义音频 ");
        const audio = await readAudioBytes(audioResponse);
        const headerType = audioResponse.headers?.get?.("content-type") || "";
        return {
            audio,
            contentType: headerType.startsWith("audio/")
                ? headerType.split(";")[0]
                : mimeType || contentTypeForFormat(chosenFormat),
            provider: "custom_http",
            model: model || "",
            voice: voice || "",
            emotion: "natural"
        };
    } finally {
        timer.done();
    }
}

// ---------------------------------------------------------------------------
// 调度 + 目录
// ---------------------------------------------------------------------------

async function synthesizeCustomSpeech({
    providerConfig,
    text,
    env = process.env,
    fetchImpl = fetch,
    WebSocketImpl = globalThis.WebSocket
} = {}) {
    const provider = providerConfig?.provider;
    if (!isCustomProvider(provider)) {
        throw customSpeechError("不是自定义语音服务商。", "CUSTOM_TTS_PROVIDER_INVALID");
    }
    if (providerConfig.enabled === false) {
        throw customSpeechError("当前账号已关闭云端发声。", "VOICE_OUTPUT_DISABLED", 409);
    }
    if (provider === "edge") {
        return synthesizeEdgeSpeech({
            text,
            voice: providerConfig.voiceId || EDGE_DEFAULT_VOICE,
            rate: providerConfig.rate,
            pitch: providerConfig.pitch,
            volume: providerConfig.volume,
            timeoutMs: env.EXPRESSIVE_TTS_TIMEOUT_MS,
            WebSocketImpl
        });
    }
    if (provider === "openai_compatible") {
        return synthesizeOpenAiSpeech({
            text,
            apiBaseUrl: providerConfig.apiBaseUrl,
            apiKey: providerConfig.apiKey,
            model: providerConfig.model,
            voice: providerConfig.voiceId,
            format: providerConfig.outputFormat,
            speed: providerConfig.speed,
            timeoutMs: env.EXPRESSIVE_TTS_TIMEOUT_MS,
            env,
            fetchImpl
        });
    }
    return synthesizeCustomHttpSpeech({
        text,
        apiBaseUrl: providerConfig.apiBaseUrl,
        apiKey: providerConfig.apiKey,
        model: providerConfig.model,
        voice: providerConfig.voiceId,
        format: providerConfig.outputFormat,
        method: providerConfig.method,
        headersTemplate: providerConfig.headersTemplate,
        bodyTemplate: providerConfig.bodyTemplate,
        responseMode: providerConfig.responseMode,
        audioPath: providerConfig.audioPath,
        mimeType: providerConfig.mimeType,
        timeoutMs: env.EXPRESSIVE_TTS_TIMEOUT_MS,
        env,
        fetchImpl
    });
}

function customProviderCatalog() {
    return [
        {
            id: "edge",
            name: "Edge 免费神经语音",
            description: "微软 Edge Read Aloud 免费音色，无需 API Key，中文自然。",
            needs_credential: false,
            voices: EDGE_VOICES
        },
        {
            id: "openai_compatible",
            name: "OpenAI 兼容 TTS",
            description: "任何兼容 /v1/audio/speech 的服务（官方 OpenAI、硅基流动、自建网关等）。",
            needs_credential: true,
            needs_base_url: true,
            formats: OUTPUT_FORMATS
        },
        {
            id: "custom_http",
            name: "自定义 HTTP 接口",
            description: "任意 HTTP 语音 API：自定义请求头/请求体，支持二进制、base64 或音频 URL 返回。",
            needs_credential: false,
            needs_base_url: true,
            response_modes: RESPONSE_MODES,
            formats: OUTPUT_FORMATS
        }
    ];
}

function publicCustomSpeechError(error) {
    if (error?.isCustomSpeechError) {
        return {
            status: Number(error.status) || 400,
            code: String(error.code || "CUSTOM_TTS_ERROR"),
            message: String(error.message || "自定义语音服务暂时不可用。")
        };
    }
    return {
        status: 502,
        code: "CUSTOM_TTS_UPSTREAM",
        message: "自定义语音服务暂时不可用。"
    };
}

module.exports = {
    CUSTOM_PROVIDER_IDS,
    EDGE_DEFAULT_VOICE,
    EDGE_VOICES,
    MAX_AUDIO_BYTES,
    MAX_TEXT_CHARS,
    OPENAI_DEFAULT_BASE,
    OUTPUT_FORMATS,
    RESPONSE_MODES,
    assertSafeOutboundUrl,
    contentTypeForFormat,
    customProviderCatalog,
    customSpeechError,
    edgeVoiceAllowed,
    isCustomProvider,
    normalizeFormat,
    normalizeResponseMode,
    publicCustomSpeechError,
    secMsGec,
    synthesizeCustomHttpSpeech,
    synthesizeCustomSpeech,
    synthesizeEdgeSpeech,
    synthesizeOpenAiSpeech
};
