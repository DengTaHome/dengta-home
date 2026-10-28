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
const dns = require("node:dns");

const MAX_TEXT_CHARS = 4000;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
const EDGE_DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const EDGE_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const EDGE_TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
// 2026-10-13 起微软 Edge TTS 要求 Sec-MS-GEC v2 + 新版本号（v1 会被拒绝）。
// 算法对齐 rany2/edge-tts v2 与 node-edge-tts(MIT) 的实现。
const EDGE_SEC_MS_GEC_VERSION = "2-143.0.3650.75";
const EDGE_CHROMIUM_MAJOR = "143";
const EDGE_WSS_URL = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1";
const EDGE_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const EDGE_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    `(KHTML, like Gecko) Chrome/${EDGE_CHROMIUM_MAJOR}.0.0.0 Safari/537.36 ` +
    `Edg/${EDGE_CHROMIUM_MAJOR}.0.0.0`;

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
    // 允许厂商后续新增音色：语言[-方言]-名称Neural 的形式
    return /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?(?:-[A-Za-z0-9]{2,40})?Neural$/.test(value);
}

function ipv4Octets(value) {
    const parts = String(value || "").split(".");
    if (parts.length !== 4) return null;
    const octets = [];
    for (const part of parts) {
        if (!/^(?:0x[0-9a-f]+|0[0-7]+|\d{1,3})$/i.test(part)) return null;
        const number = Number(part);
        if (!Number.isFinite(number) || number < 0 || number > 255) return null;
        octets.push(number);
    }
    return octets;
}

function isPrivateIpv4(host) {
    const octets = ipv4Octets(host);
    // 十进制/单数字 IPv4（如 2130706433 = 127.0.0.1）
    if (!octets && /^\d{5,10}$/.test(host)) {
        const value = Number(host);
        return value >>> 24 === 127 || value >>> 24 === 10 ||
            (value >>> 24 === 192 && (value >>> 16) & 0xff === 168) ||
            (value >>> 24 === 172 && (value >>> 16) & 0xff >= 16 && (value >>> 16) & 0xff <= 31) ||
            value >>> 16 === 0xa9fe;
    }
    if (!octets) return false;
    const [a, b] = octets;
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
}

function isPrivateIpAddress(address) {
    const value = String(address || "").toLowerCase();
    if (!value) return true;
    if (value === "::" || value === "::1") return true;
    if (/^fe80:|^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:/.test(value)) return true;
    if (value.startsWith("::ffff:")) {
        const tail = value.slice("::ffff:".length);
        if (isPrivateIpv4(tail)) return true;
        const parts = tail.split(":");
        if (parts.length === 2) {
            const [hi, lo] = parts.map((part) => parseInt(part, 16));
            if (Number.isFinite(hi) && Number.isFinite(lo)) {
                if (isPrivateIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`)) return true;
            }
        }
    }
    // IPv4-compatible / NAT64（::127.0.0.1 / 64:ff9b::7f00:1）
    if (value.startsWith("::") || value.startsWith("64:ff9b::")) {
        const dotted = value.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (dotted && isPrivateIpv4(`${dotted[1]}.${dotted[2]}.${dotted[3]}.${dotted[4]}`)) {
            return true;
        }
        const hexParts = value.split(":").filter(Boolean).slice(-2);
        if (hexParts.length === 2 && /^[0-9a-f]{1,4}$/.test(hexParts[0]) && /^[0-9a-f]{1,4}$/.test(hexParts[1])) {
            const hi = parseInt(hexParts[0], 16);
            const lo = parseInt(hexParts[1], 16);
            if (isPrivateIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`)) return true;
        }
    }
    const mapped = value.match(/^(?:::127\.|::7f00:|64:ff9b::)([0-9a-f:.]+)$/);
    if (mapped) {
        const tail = mapped[1];
        const v4Match = tail.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (v4Match && isPrivateIpv4(`${v4Match[1]}.${v4Match[2]}.${v4Match[3]}.${v4Match[4]}`)) return true;
        const hex = tail.replace(/\./g, "").split(":");
        if (hex.length === 2) {
            const [hi, lo] = hex.map((part) => parseInt(part, 16));
            if (Number.isFinite(hi) && Number.isFinite(lo)) {
                if (isPrivateIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`)) return true;
            }
        }
    }
    return isPrivateIpv4(value);
}

function isPrivateHostname(hostname) {
    let host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    if (host.endsWith(".")) host = host.slice(0, -1);
    if (!host) return true;
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (host === "metadata.google.internal" || host === "metadata") return true;
    if (host === "0.0.0.0" || host === "::" || host === "::1") return true;
    if (host.startsWith("::ffff:")) {
        // IPv4-mapped IPv6：::ffff:127.0.0.1 / ::ffff:a9fe:a9fe
        const tail = host.slice("::ffff:".length);
        if (isPrivateIpv4(tail)) return true;
        if (/^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(tail)) {
            const [hi, lo] = tail.split(":").map((part) => parseInt(part, 16));
            const a = hi >> 8, b = hi & 0xff, c = lo >> 8, d = lo & 0xff;
            if (isPrivateIpv4(`${a}.${b}.${c}.${d}`)) return true;
        }
    }
    if (host.includes(":") && isPrivateIpAddress(host)) return true;
    if (isPrivateIpv4(host)) return true;
    return false;
}

function isIpLiteral(host) {
    const value = String(host || "").replace(/^\[|\]$/g, "");
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(":");
}

/**
 * 解析域名并校验解析结果，降低 DNS 重绑定/域名指向内网的风险。
 * 说明：解析后仍用原域名发请求，理论上有极小的 TOCTOU 窗口；这里至少拦截
 * localtest.me / nip.io / lvh.me 这类"公网域名解析到回环"的场景。
 */
async function resolveSafeHost(rawUrl, env = process.env, lookupImpl = null) {
    const url = assertSafeOutboundUrl(rawUrl, env);
    if (String(env.VOICE_CUSTOM_ALLOW_PRIVATE || "") === "1") return url;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIpLiteral(host)) return url;
    let records;
    try {
        const lookup = lookupImpl || ((name) => dns.promises.lookup(name, { all: true, verbatim: true }));
        records = await lookup(host);
    } catch {
        throw customSpeechError("无法解析语音服务域名。", "CUSTOM_TTS_DNS", 502);
    }
    if (!Array.isArray(records)) records = records?.address ? [records] : [];
    if (!records.length) {
        throw customSpeechError("语音服务域名没有可用地址。", "CUSTOM_TTS_DNS", 502);
    }
    for (const record of records) {
        if (isPrivateIpAddress(record.address)) {
            throw customSpeechError(
                "语音服务域名解析到本机或内网地址，已拒绝。",
                "CUSTOM_TTS_DNS_PRIVATE",
                502
            );
        }
    }
    return url;
}

/**
 * 带重定向校验的 fetch：默认只允许 https 公网，所以重定向目标也必须过同一套校验。
 * 手动处理 301/302/303/307/308，最多 3 跳，禁止跳到私网/http。
 */
async function fetchWithSafeRedirects(fetchImpl, url, options = {}, env = process.env, maxRedirects = 3) {
    let current = String(url);
    let requestOptions = { ...options, redirect: "manual" };
    const firstOrigin = new URL(current).origin;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
        await resolveSafeHost(current, env);
        const response = await fetchImpl(current, requestOptions);
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers?.get?.("location");
        if (!location) {
            throw customSpeechError("语音服务返回了无目标的重定向。", "CUSTOM_TTS_REDIRECT_INVALID", 502);
        }
        const next = new URL(location, current);
        // 先做 URL 安全校验，再判断跨源（这样 http/私网错误码更准确）
        assertSafeOutboundUrl(next.toString(), env);
        // 跨源重定向一律拒绝：否则 Authorization / {{api_key}} 请求体会被带到别的域
        if (next.origin !== firstOrigin) {
            throw customSpeechError(
                "语音服务试图跨域重定向，已拒绝以保护你的密钥。",
                "CUSTOM_TTS_REDIRECT_CROSS_ORIGIN",
                502
            );
        }
        current = next.toString();
        if (response.status === 303) {
            requestOptions = { ...requestOptions, method: "GET", body: undefined };
        }
    }
    throw customSpeechError("语音服务重定向次数过多。", "CUSTOM_TTS_REDIRECT_LOOP", 502);
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

async function readResponseBufferLimited(response, limit) {
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > limit) {
        throw customSpeechError("语音服务返回的音频过大。", "CUSTOM_TTS_AUDIO_TOO_LARGE", 502);
    }
    const body = response.body;
    if (body && typeof body.getReader === "function") {
        const reader = body.getReader();
        const chunks = [];
        let total = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value?.byteLength || 0;
                if (total > limit) {
                    try { await reader.cancel(); } catch { /* ignore */ }
                    throw customSpeechError("语音服务返回的音频过大。", "CUSTOM_TTS_AUDIO_TOO_LARGE", 502);
                }
                chunks.push(Buffer.from(value));
            }
        } finally {
            try { reader.releaseLock?.(); } catch { /* ignore */ }
        }
        return Buffer.concat(chunks);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > limit) {
        throw customSpeechError("语音服务返回的音频过大。", "CUSTOM_TTS_AUDIO_TOO_LARGE", 502);
    }
    return buffer;
}

async function readAudioBytes(response, { limit = MAX_AUDIO_BYTES } = {}) {
    const buffer = await readResponseBufferLimited(response, limit);
    if (!buffer.length) {
        throw customSpeechError("语音服务没有返回音频。", "CUSTOM_TTS_EMPTY_AUDIO", 502);
    }
    return buffer;
}

async function readJsonLimited(response, limit = 2 * 1024 * 1024) {
    const buffer = await readResponseBufferLimited(response, limit);
    try {
        return JSON.parse(buffer.toString("utf8"));
    } catch {
        throw customSpeechError(
            "自定义接口返回的不是合法 JSON。",
            "CUSTOM_TTS_RESPONSE_INVALID",
            502
        );
    }
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

// ---------------------------------------------------------------------------
// Edge TTS v2 token（算法对齐 rany2/edge-tts 与 node-edge-tts，MIT）
// ---------------------------------------------------------------------------

const EDGE_DRM_PREFIX = Buffer.from(
    [
        "Q29weXJpZ2h0IChDKSBNaWNyb3NvZnQg",
        "Q29ycG9yYXRpb24uIEFsbCByaWdodHMgcmVzZXJ2ZWQu"
    ].join(""),
    "base64"
);

const EDGE_DRM_COEFFICIENTS = [
    [0xe82e91b1, 0xb32700d0],
    [0x44de24c6, 0x88dff51d],
    [0x3beb65bc, 0x29514038],
    [0xc89c5933, 0xb328cbdf],
    [0x8d1ec211, 0xd405b4d5],
    [0x314ef5d5, 0x26e55f3c],
    [0xe92491b1, 0x607801c6],
    [0xf0a5b9d5, 0x82b2c1fb],
    [0x06064cf3, 0xfa51a3da],
    [0xda79fa60, 0x207cc464],
    [0xbed20560, 0x3c3c74f3],
    [0x89f9c9f8, 0xd2d14b61],
    [0x35fa38c6, 0xbb04a2c1],
    [0xcb49e3c6, 0xc5626167]
];

function rol16(value) {
    return ((value << 16) | (value >>> 16)) >>> 0;
}

function cs64Digest(data, shaDigest) {
    const mul = Math.imul;
    const keyA = (shaDigest.readUInt32LE(0) | 1) >>> 0;
    const keyB = (shaDigest.readUInt32LE(4) | 1) >>> 0;
    const factors = [mul(keyA, 0x82893933) >>> 0, mul(keyB, 0x82893933) >>> 0];
    const terms = EDGE_DRM_COEFFICIENTS.map(
        ([coefficient], index) => mul(coefficient, factors[index % 2]) >>> 0
    );
    const offsets = EDGE_DRM_COEFFICIENTS.map(([, offset]) => offset);
    const padded = Buffer.alloc(Math.ceil((data.length + 1) / 8) * 8);
    padded.set(data, 1);
    for (let i = 0; i < padded.length / 4; i += 1) {
        const word = padded.readUInt32LE(i * 4);
        let term = mul(word, i % 2 === 0 ? keyA : keyB);
        let offset = mul(rol16(word), i % 2 === 0 ? 0xef0569fb : 0xc31713db);
        if (i === 0) {
            term = (term + mul(0xf2f90b1a, factors[0])) >>> 0;
            offset = (offset + 0x0b1a0000) >>> 0;
        }
        terms.push(term >>> 0);
        offsets.push(offset >>> 0);
    }
    let swapAcc = 0;
    let swapLast = 0;
    let state = 0;
    let acc = 0;
    for (let i = 0; i < terms.length; i += 2) {
        const x = terms[i];
        const y = terms[i + 1];
        let t = rol16((offsets[i] + x) >>> 0);
        let q = mul(t, 0x76f50f34);
        swapAcc += (mul(rol16(q), 0xc3efea97) + q) >>> 0;
        t = rol16((offsets[i + 1] + y) >>> 0);
        q = mul(t, 0x1881ce3c);
        swapLast = (mul(rol16(q), 0x35bd1ec9) + q) >>> 0;
        swapAcc = (swapAcc + swapLast) >>> 0;
        state = (mul(state, keyA) + x) >>> 0;
        for (const k of [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83]) {
            state = mul(rol16(state), k) >>> 0;
        }
        acc += state;
        t = (mul(state, keyB) + y) >>> 0;
        t = mul(rol16(t), 0xa27416f5) >>> 0;
        t = mul(rol16(t), 0xd38396ff) >>> 0;
        state = mul(rol16(mul(rol16(t), 0x7c932b89)), 0xbfa49f69) >>> 0;
        acc = (acc + state) >>> 0;
    }
    const result = Buffer.allocUnsafe(8);
    result.writeUInt32LE((swapLast ^ state) >>> 0, 0);
    result.writeUInt32LE((swapAcc ^ acc) >>> 0, 4);
    return result;
}

/**
 * Sec-MS-GEC v2：16 hex 的 CS64 - 64 hex 的 SHA256。
 * 时间桶为 5 分钟（300s），与微软 Edge 客户端一致；旧 v1 在 2026-10-13 后被拒。
 */
function secMsGecV2(now = Date.now()) {
    const epochSeconds = BigInt(Math.floor(now / 1000)) + 11644473600n;
    const roundedSeconds = epochSeconds - (epochSeconds % 300n);
    const ticks = roundedSeconds * 10000000n;
    const data = Buffer.from(`${ticks}${EDGE_TRUSTED_CLIENT_TOKEN}`, "ascii");
    const sha = crypto
        .createHash("sha256")
        .update(new Uint8Array(EDGE_DRM_PREFIX))
        .update(new Uint8Array(data))
        .digest();
    const cs64 = cs64Digest(data, sha);
    return `${cs64.toString("hex").toUpperCase()}-${sha.toString("hex").toUpperCase()}`;
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
 * 通过 Edge 的真实 WebSocket 合成语音。
 * 使用 `ws` 包而不是 Node 内置 WebSocket：需要自定义 Host/Origin/UA 头，且
 * 内置 WebSocket 的二进制帧默认是 Blob，处理起来更脆弱。
 */
function synthesizeEdgeSpeech({
    text,
    voice = EDGE_DEFAULT_VOICE,
    rate = 0,
    pitch = 0,
    volume = 0,
    timeoutMs = 30000,
    WebSocketImpl = null,
    now = () => Date.now()
} = {}) {
    const speechText = cleanText(text, MAX_TEXT_CHARS);
    if (!speechText) {
        return Promise.reject(customSpeechError("没有可朗读的文字。", "CUSTOM_TTS_EMPTY_TEXT", 400));
    }
    const chosenVoice = String(voice || EDGE_DEFAULT_VOICE).trim();
    if (!edgeVoiceAllowed(chosenVoice)) {
        return Promise.reject(customSpeechError("Edge 音色名称不合法。", "CUSTOM_TTS_VOICE_INVALID", 400));
    }
    let Socket;
    try {
        Socket = WebSocketImpl || require("ws");
    } catch {
        return Promise.reject(
            customSpeechError(
                "服务器缺少 ws 依赖，无法使用免费 Edge 语音。",
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
            `${EDGE_WSS_URL}?Ocp-Apim-Subscription-Key=${EDGE_TRUSTED_CLIENT_TOKEN}` +
            `&Sec-MS-GEC=${secMsGecV2(now())}` +
            `&Sec-MS-GEC-Version=${EDGE_SEC_MS_GEC_VERSION}`;
        const chunks = [];
        let totalBytes = 0;
        let settled = false;
        let socket;
        const timer = setTimeout(
            () => finish(customSpeechError("免费语音合成超时，请稍后重试。", "CUSTOM_TTS_TIMEOUT", 504)),
            clampNumber(timeoutMs, 30000, 5000, 120000)
        );

        function finish(error, audio) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                if (error) socket?.terminate?.();
                else socket?.close?.();
            } catch {
                /* ignore */
            }
            if (error) reject(error);
            else resolve(audio);
        }

        try {
            socket = new Socket(url, {
                headers: {
                    Pragma: "no-cache",
                    "Cache-Control": "no-cache",
                    "User-Agent": EDGE_USER_AGENT,
                    "Accept-Encoding": "gzip, deflate, br, zstd",
                    "Accept-Language": "en-US,en;q=0.9",
                    Host: "speech.platform.bing.com",
                    Origin: EDGE_ORIGIN
                }
            });
        } catch (error) {
            finish(
                customSpeechError(
                    `免费语音合成连接失败：${error?.message || "未知错误"}`,
                    "CUSTOM_TTS_EDGE_CONNECT",
                    502
                )
            );
            return;
        }

        const send = (payload) => socket.send(payload);

        socket.on("open", () => {
            try {
                send(
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
                send(
                    `X-RequestId:${requestId}\r\n` +
                        "Content-Type:application/ssml+xml\r\n" +
                        `X-Timestamp:${timestamp}\r\n` +
                        "Path:ssml\r\n\r\n" +
                        edgeSsml(speechText, { voice: chosenVoice, rate, pitch, volume })
                );
            } catch (error) {
                finish(
                    customSpeechError(
                        `免费语音请求发送失败：${error?.message || "未知错误"}`,
                        "CUSTOM_TTS_EDGE_SEND",
                        502
                    )
                );
            }
        });

        socket.on("message", (data, isBinary) => {
            if (isBinary || Buffer.isBuffer(data)) {
                const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
                if (buffer.length > 2) {
                    const headerLength = buffer.readUInt16BE(0);
                    const body = buffer.subarray(2 + headerLength);
                    if (body.length) {
                        totalBytes += body.length;
                        if (totalBytes > MAX_AUDIO_BYTES) {
                            finish(
                                customSpeechError(
                                    "免费语音返回的音频过大。",
                                    "CUSTOM_TTS_AUDIO_TOO_LARGE",
                                    502
                                )
                            );
                            return;
                        }
                        chunks.push(body);
                    }
                }
                return;
            }
            const message = data.toString();
            if (message.includes("Path:turn.end")) {
                const audio = Buffer.concat(chunks);
                if (!audio.length) {
                    finish(customSpeechError("免费语音没有返回音频。", "CUSTOM_TTS_EDGE_EMPTY", 502));
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
        });

        socket.on("error", () => {
            finish(customSpeechError("免费语音合成连接中断。", "CUSTOM_TTS_EDGE_ERROR", 502));
        });

        socket.on("close", (code) => {
            if (!settled) {
                finish(
                    customSpeechError(
                        `免费语音连接提前关闭（code ${code}）。`,
                        "CUSTOM_TTS_EDGE_CLOSED",
                        502
                    )
                );
            }
        });
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
            response = await fetchWithSafeRedirects(
                fetchImpl,
                endpoint,
                {
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
                },
                env
            );
        } catch (error) {
            if (error?.isCustomSpeechError) throw error;
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
            response = await fetchWithSafeRedirects(
                fetchImpl,
                url.toString(),
                {
                    method: chosenMethod,
                    headers,
                    ...(body !== undefined ? { body } : {}),
                    signal: timer.signal
                },
                env
            );
        } catch (error) {
            if (error?.isCustomSpeechError) throw error;
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

        const data = await readJsonLimited(response);
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
            audioResponse = await fetchWithSafeRedirects(
                fetchImpl,
                audioUrl.toString(),
                { signal: timer.signal },
                env
            );
        } catch (error) {
            if (error?.isCustomSpeechError) throw error;
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
    fetchWithSafeRedirects,
    isPrivateHostname,
    contentTypeForFormat,
    customProviderCatalog,
    customSpeechError,
    edgeVoiceAllowed,
    isCustomProvider,
    normalizeFormat,
    normalizeResponseMode,
    publicCustomSpeechError,
    secMsGecV2,
    resolveSafeHost,
    isPrivateIpAddress,
    synthesizeCustomHttpSpeech,
    synthesizeCustomSpeech,
    synthesizeEdgeSpeech,
    synthesizeOpenAiSpeech
};
