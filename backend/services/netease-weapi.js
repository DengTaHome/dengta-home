"use strict";

// NetEase Cloud Music weapi request layer.
// Implements the same AES-128-CBC + textbook-RSA scheme used by the official
// web client (see pyncm/utils/crypto.py and Binaryify/NeteaseCloudMusicApi).
// Only fixed music.163.com paths are ever requested.

const crypto = require("node:crypto");

const NETEASE_BASE = "https://music.163.com";
const WEAPI_AES_KEY = "0CoJUm6Qyw8W8jud";
const WEAPI_AES_IV = "0102030405060708";
const WEAPI_RSA_N = BigInt(
    "0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7"
);
const WEAPI_RSA_E = BigInt(0x10001);
const NETEASE_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function aesCbcBase64(text, key) {
    const cipher = crypto.createCipheriv(
        "aes-128-cbc",
        Buffer.from(String(key), "utf8"),
        Buffer.from(WEAPI_AES_IV, "utf8")
    );
    return Buffer.concat([
        cipher.update(String(text), "utf8"),
        cipher.final()
    ]).toString("base64");
}

function randomSecretKey() {
    return crypto.randomBytes(16).toString("hex").slice(0, 16);
}

function weapiParams(payload) {
    const text = JSON.stringify(payload || {});
    const secret = randomSecretKey();
    const first = aesCbcBase64(text, WEAPI_AES_KEY);
    const params = aesCbcBase64(first, secret);
    const reversed = Buffer.from(secret, "utf8").reverse();
    const message = BigInt("0x" + reversed.toString("hex"));
    const encrypted = message ** WEAPI_RSA_E % WEAPI_RSA_N;
    const encSecKey = encrypted.toString(16).padStart(256, "0");
    return { params, encSecKey };
}

function csrfFromCookie(cookie) {
    const match = String(cookie || "").match(/(?:^|;\s*)__csrf=([^;]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
}

function parseSetCookies(setCookies) {
    const result = [];
    for (const header of Array.isArray(setCookies) ? setCookies : []) {
        const pair = String(header || "").split(";")[0].trim();
        const index = pair.indexOf("=");
        if (index <= 0) continue;
        result.push([pair.slice(0, index), pair.slice(index + 1)]);
    }
    return result;
}

// 兼容不同 Node/undici 版本的 Set-Cookie 捕获:
// getSetCookie() 不可用或为空时,回退到解析 headers.get("set-cookie")。
function rawSetCookies(headers) {
    if (headers && typeof headers.getSetCookie === "function") {
        try {
            const list = headers.getSetCookie();
            if (Array.isArray(list) && list.length > 0) return list;
        } catch {
            // 回退到下面的解析。
        }
    }
    const joined = headers && typeof headers.get === "function"
        ? String(headers.get("set-cookie") || "")
        : "";
    if (!joined) return [];
    // 按 "名称=" 边界切分,避免 Expires 里的逗号被误切。
    return joined
        .split(/,(?=\s*[A-Za-z0-9_%-]+=)/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function cookieHeader(cookies) {
    return cookies
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
}

async function weapiRequest(fetchImpl, path, payload = {}, cookie = "") {
    const form = new URLSearchParams(
        weapiParams({ ...payload, csrf_token: csrfFromCookie(cookie) })
    );
    const response = await fetchImpl(`${NETEASE_BASE}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: `${NETEASE_BASE}/`,
            "User-Agent": NETEASE_USER_AGENT,
            Origin: NETEASE_BASE,
            ...(cookie ? { Cookie: cookie } : {})
        },
        body: form.toString()
    });
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = null;
    }
    const setCookies = rawSetCookies(response.headers);
    return { status: response.status, json, text, setCookies };
}

async function neteaseApiGet(fetchImpl, path, cookie = "") {
    const response = await fetchImpl(`${NETEASE_BASE}${path}`, {
        method: "GET",
        headers: {
            Referer: `${NETEASE_BASE}/`,
            "User-Agent": NETEASE_USER_AGENT,
            ...(cookie ? { Cookie: cookie } : {})
        }
    });
    const text = await response.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = null;
    }
    return { status: response.status, json, text };
}

// ---------- EAPI（新版客户端 API）----------
// 参考 pyncm（EapiEncrypt / EapiDecrypt）与 Binaryify/NeteaseCloudMusicApi。
// EAPI 用于 /eapi/* 端点：AES-ECB + md5 盐值摘要，请求与响应都走 params 字段。
const EAPI_AES_KEY = "e82ckenh8dichen8";
const EAPI_DIGEST_SALT = "nobody%{url}suse%{text}smd5forencrypt";
const EAPI_DATA_SALT = "%{url}s-36cd479b6b5-%{text}s-36cd479b6b5-%{digest}s";
const EAPI_UA =
    "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154";

function aesEcbEncryptHex(text, key) {
    const cipher = crypto.createCipheriv("aes-128-ecb", Buffer.from(String(key), "utf8"), null);
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()])
        .toString("hex");
}

function aesEcbDecryptUtf8(hex, key) {
    const decipher = crypto.createDecipheriv("aes-128-ecb", Buffer.from(String(key), "utf8"), null);
    decipher.setAutoPadding(true);
    return Buffer.concat([
        decipher.update(Buffer.from(String(hex), "hex")),
        decipher.final()
    ]).toString("utf8");
}

function eapiDigest(urlPath, text) {
    const source = EAPI_DIGEST_SALT
        .replace("%{url}s", urlPath)
        .replace("%{text}s", text);
    return crypto.createHash("md5").update(source, "utf8").digest("hex");
}

function eapiParams(urlPath, payload) {
    const text = JSON.stringify(payload || {});
    const digest = eapiDigest(urlPath, text);
    const salted = EAPI_DATA_SALT
        .replace("%{url}s", urlPath)
        .replace("%{text}s", text)
        .replace("%{digest}s", digest);
    return { params: aesEcbEncryptHex(salted, EAPI_AES_KEY) };
}

function eapiConfig(deviceId = "") {
    return {
        os: "iPhone OS",
        appver: "10.0.0",
        osver: "16.2",
        channel: "distribution",
        deviceId: String(deviceId || "DengTa-Web-01")
    };
}

// eapiPath 形如 "/eapi/song/like"（内部换算摘要用的 /api/ 路径）。
async function eapiRequest(fetchImpl, eapiPath, payload = {}, cookie = "", deviceId = "") {
    const apiPath = String(eapiPath || "").replace(/^\/eapi\//, "/api/");
    const body = {
        ...(payload || {}),
        header: JSON.stringify({
            ...eapiConfig(deviceId),
            requestId: String(Math.floor(20000000 + Math.random() * 10000000))
        })
    };
    const form = new URLSearchParams(eapiParams(apiPath, body));
    // EAPI 校验要求把客户端配置（os/appver/osver/channel/deviceId）作为 Cookie 一并发送。
    const config = eapiConfig(deviceId);
    const configCookie = Object.entries(config)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    const response = await fetchImpl(`${NETEASE_BASE}${eapiPath}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: "",
            "User-Agent": EAPI_UA,
            ...(cookie ? { Cookie: [cookie, configCookie].filter(Boolean).join("; ") } : { Cookie: configCookie })
        },
        body: form.toString()
    });
    // EAPI 响应体通常是 AES-ECB 加密的原始字节；部分端点直接返回明文 JSON。
    const buffer = Buffer.from(await response.arrayBuffer());
    const rawText = buffer.toString("utf8");
    let json = null;
    if (rawText.trim().startsWith("{")) {
        try {
            json = JSON.parse(rawText);
        } catch {
            json = null;
        }
    } else {
        try {
            const decipher = crypto.createDecipheriv("aes-128-ecb", Buffer.from(EAPI_AES_KEY, "utf8"), null);
            decipher.setAutoPadding(true);
            const decrypted = Buffer.concat([decipher.update(buffer), decipher.final()]).toString("utf8");
            json = JSON.parse(decrypted);
        } catch {
            json = null;
        }
    }
    return { status: response.status, json, text: rawText };
}

module.exports = {
    NETEASE_BASE,
    cookieHeader,
    csrfFromCookie,
    eapiRequest,
    neteaseApiGet,
    parseSetCookies,
    weapiParams,
    weapiRequest
};
