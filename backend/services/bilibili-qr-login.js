"use strict";

// Built-in Bilibili QR-code login for 一起看 (Watch Together).
// Users scan a QR with the official Bilibili app; the login cookie is stored
// encrypted per tenant and only used to read the user's own profile and
// favorite folders, so they can load videos into the web-page co-watch.

const { createHash } = require("node:crypto");
const {
    decryptCredential,
    encryptCredential,
    hasCredentialEncryption
} = require("./mcp-device-center");

// WBI signature (bilibili risk-control signing). Derives the mixin key from
// the nav endpoint's wbi_img keys and appends a signed w_rid to favorite
// requests, so user favorites avoid the -352 risk-control rejection.
const WBI_MIXIN_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5,
    49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55,
    40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57,
    62, 11, 36, 20, 34, 44, 52
];

function md5Hex(value) {
    return createHash("md5").update(String(value), "utf8").digest("hex");
}

function wbiKeyFromUrl(value) {
    const match = String(value || "").match(/\/([0-9a-f]{32})\.(?:png|jpg|jpeg|webp)/i);
    return match ? match[1] : "";
}

function deriveMixinKey(wbiImgUrl, wbiSubUrl) {
    const combined = wbiKeyFromUrl(wbiImgUrl) + wbiKeyFromUrl(wbiSubUrl);
    if (combined.length !== 64) return "";
    return WBI_MIXIN_TAB.map((index) => combined[index]).join("").slice(0, 32);
}

function wbiSignedQuery(params, mixinKey) {
    const signed = { ...params, wts: String(Math.floor(Date.now() / 1000)) };
    const sortedKeys = Object.keys(signed).sort();
    const query = sortedKeys
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(signed[key]))}`)
        .join("&");
    const wRid = md5Hex(query + mixinKey);
    return `${query}&w_rid=${wRid}`;
}

const QR_KEY_PATTERN = /^[0-9a-f-]{8,128}$/i;
const MEDIA_ID_PATTERN = /^\d{1,20}$/;
const BILIBILI_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function cleanText(value, maximum) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
        .slice(0, maximum)
        .join("");
}

function cookieHeader(cookies) {
    return cookies
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
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

// 兼容不同 Node/undici 版本的 Set-Cookie 捕获。
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
    return joined
        .split(/,(?=\s*[A-Za-z0-9_%-]+=)/)
        .map((item) => item.trim())
        .filter(Boolean);
}

async function biliGet(fetchImpl, url, cookie = "", referer = "https://www.bilibili.com/") {
    const response = await fetchImpl(url, {
        method: "GET",
        signal: AbortSignal.timeout(12_000),
        headers: {
            "User-Agent": BILIBILI_USER_AGENT,
            Referer: referer,
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
    const setCookies = rawSetCookies(response.headers);
    return { status: response.status, json, setCookies };
}

function createBilibiliQrLoginService({
    database,
    env = process.env,
    fetchImpl = globalThis.fetch
} = {}) {
    if (!database?.from) {
        throw new Error("bilibili qr login requires a Supabase database client");
    }

    // 二维码会话 Cookie 关联：generate 阶段返回的 buvid3 等匿名 Cookie
    // 必须随 poll 一起发送，否则轮询一直 waiting（扫码后无反应）。
    // 按 (user, companion, qr_key) 持久化到数据库，避免 Render 重启/多实例丢 jar。
    const QR_SESSION_TTL_MS = 10 * 60 * 1000;
    async function jarFor(scope, key) {
        const db = scope?.db || database;
        const { data, error } = await db
            .from("bilibili_qr_sessions")
            .select("cookies, created_at")
            .eq("qr_key", String(key))
            .maybeSingle();
        if (error) throw error;
        if (
            data?.cookies &&
            Array.isArray(data.cookies) &&
            Date.now() - new Date(data.created_at).getTime() < QR_SESSION_TTL_MS
        ) {
            return { cookies: data.cookies, createdAt: new Date(data.created_at).getTime() };
        }
        return { cookies: [], createdAt: Date.now() };
    }
    async function saveJar(scope, key, cookies) {
        const db = scope?.db || database;
        const values = {
            cookies: cookies.map(([name, value]) => [String(name), String(value)]),
            updated_at: new Date().toISOString()
        };
        const { data: existing, error: findError } = await db
            .from("bilibili_qr_sessions")
            .select("id")
            .eq("qr_key", String(key))
            .maybeSingle();
        if (findError) throw findError;
        if (existing?.id) {
            const { error } = await db
                .from("bilibili_qr_sessions")
                .update(values)
                .eq("id", existing.id);
            if (error) throw error;
        } else {
            const { error } = await db
                .from("bilibili_qr_sessions")
                .insert({ ...values, qr_key: String(key) });
            if (error) throw error;
        }
    }
    async function clearJar(scope, key) {
        const db = scope?.db || database;
        const { error } = await db
            .from("bilibili_qr_sessions")
            .delete()
            .eq("qr_key", String(key));
        if (error) throw error;
    }

    async function connectionRow(scope) {
        const db = scope?.db || database;
        const { data, error } = await db
            .from("bilibili_qr_connections")
            .select("*")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .maybeSingle();
        if (error?.code === "42P01" || String(error?.message || "").includes("does not exist")) {
            throw requestError(503, "bilibili_qr_storage_unavailable", "哔哩哔哩扫码登录存储还未准备好，请先执行数据库迁移。");
        }
        if (error) throw error;
        return data || null;
    }

    async function requireCookie(scope) {
        const row = await connectionRow(scope);
        if (!row?.cookie_ciphertext) {
            throw requestError(400, "bilibili_qr_not_connected", "还没有扫码登录哔哩哔哩，请先扫码。");
        }
        try {
            return decryptCredential(row.cookie_ciphertext, env);
        } catch {
            throw requestError(400, "bilibili_qr_session_expired", "哔哩哔哩登录凭据无法解密，请重新扫码登录。");
        }
    }

    // 供视频解析等场景复用登录 Cookie;未登录时返回空串而不报错。
    async function cookieText(scope) {
        try {
            return await requireCookie(scope);
        } catch {
            return "";
        }
    }

    function publicConnection(row) {
        if (!row) return null;
        return {
            connected: true,
            nickname: cleanText(row.nickname, 80),
            uid: cleanText(row.bilibili_uid, 40),
            face_url: cleanText(row.face_url, 4096),
            connected_at: row.updated_at || row.created_at || ""
        };
    }

    async function fetchProfile(cookie) {
        const { json } = await biliGet(fetchImpl, "https://api.bilibili.com/x/web-interface/nav", cookie);
        const data = json?.data || {};
        if (Number(json?.code) === -101 || data.isLogin === false) return null;
        return {
            mid: String(data.mid ?? ""),
            uname: cleanText(data.uname, 80),
            face: cleanText(data.face, 4096),
            wbi_mixin_key: deriveMixinKey(
                String(data.wbi_img?.img_url || ""),
                String(data.wbi_img?.sub_url || "")
            )
        };
    }

    async function begin(scope) {
        const { json, setCookies } = await biliGet(fetchImpl, "https://passport.bilibili.com/x/passport-login/web/qrcode/generate");
        const data = json?.data || {};
        if (Number(json?.code) !== 0 || !data.url || !data.qrcode_key) {
            throw requestError(502, "bilibili_qr_unavailable", "哔哩哔哩二维码登录暂时不可用，请稍后重试。");
        }
        await saveJar(scope, String(data.qrcode_key), parseSetCookies(setCookies));
        return {
            key: String(data.qrcode_key),
            qr_content: String(data.url),
            expires_in_seconds: 180
        };
    }

    async function check(scope, key) {
        if (!QR_KEY_PATTERN.test(String(key || ""))) {
            throw requestError(400, "bilibili_qr_key_invalid", "扫码登录会话编号无效，请重新生成二维码。");
        }
        const jar = await jarFor(scope, String(key));
        const jarCookie = cookieHeader(jar.cookies);
        const { json, setCookies } = await biliGet(
            fetchImpl,
            `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(String(key))}`,
            jarCookie
        );
        // 轮询接口的真实状态在 data.code 里:
        // 86101=等待扫码 86090=已扫码待确认 0=已确认 86038=过期。
        // 顶层 code 恒为 0(HTTP 成功),绝不能当作登录状态。
        const code = Number(json?.data?.code ?? json?.code ?? -1);
        if (code === 0) {
            const pollCookies = parseSetCookies(setCookies);
            let merged = [...jar.cookies, ...pollCookies];
            let cookieText = cookieHeader(merged);
            if (!merged.some(([name]) => name === "SESSDATA")) {
                // 登录已确认但 SESSDATA 没随轮询响应返回:
                // 优先跟随轮询返回的跳转链接(passport 域)换取登录 Cookie,
                // 再兜底访问主页与 nav 接口。
                const jumpUrl =
                    typeof json?.data?.url === "string" &&
                    /^https:\/\//i.test(json.data.url)
                        ? json.data.url
                        : "https://www.bilibili.com/";
                const steps = [jumpUrl, "https://www.bilibili.com/", "https://api.bilibili.com/x/web-interface/nav"];
                for (const step of steps) {
                    if (merged.some(([name]) => name === "SESSDATA")) break;
                    const follow = await biliGet(fetchImpl, step, cookieText);
                    const extra = parseSetCookies(follow.setCookies);
                    if (extra.length === 0) continue;
                    const map = new Map(merged.map(([name, value]) => [name, value]));
                    for (const [name, value] of extra) map.set(name, value);
                    merged = Array.from(map.entries());
                    cookieText = cookieHeader(merged);
                }
            }
            if (!merged.some(([name]) => name === "SESSDATA")) {
                throw requestError(502, "bilibili_qr_cookie_missing", "登录已确认，但服务器没有收到登录凭据（SESSDATA），请再试一次。");
            }
            // 把最新匿名 Cookie 写回会话（多实例轮询安全），登录凭据只加密存 connections。
            await saveJar(
                scope,
                key,
                merged.filter(([name]) => !["SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5"].includes(name))
            );
            if (!hasCredentialEncryption(env)) {
                throw requestError(503, "bilibili_qr_encryption_unconfigured", "服务器还没有配置凭据加密密钥，暂时不能保存哔哩哔哩登录。");
            }
            const profile = (await fetchProfile(cookieText)) || { mid: "", uname: "", face: "" };
            const ciphertext = encryptCredential(cookieText, env);
            const db = scope?.db || database;
            const values = {
                user_id: scope.userId,
                companion_id: scope.companionId,
                bilibili_uid: profile.mid,
                nickname: profile.uname,
                face_url: profile.face,
                cookie_ciphertext: ciphertext,
                updated_at: new Date().toISOString()
            };
            const existing = await connectionRow(scope);
            let saved = null;
            if (existing?.id) {
                const { data, error } = await db
                    .from("bilibili_qr_connections")
                    .update(values)
                    .eq("id", existing.id)
                    .select("*")
                    .single();
                if (error) throw error;
                saved = data;
            } else {
                const { data, error } = await db
                    .from("bilibili_qr_connections")
                    .insert({ ...values, created_at: new Date().toISOString() })
                    .select("*")
                    .single();
                if (error) throw error;
                saved = data;
            }
            await clearJar(scope, key).catch(() => {});
            return { status: "confirmed", connection: publicConnection(saved) };
        }
        if (code === 86038) return { status: "expired" };
        if (code === 86090) return { status: "scanned" };
        if (code === 86101) return { status: "waiting" };
        if (code === 86086 || code === 86085) return { status: "risk_blocked", message: "哔哩哔哩登录风控拦截，请稍后再试。" };
        return { status: "waiting", raw_code: code };
    }

    async function status(scope) {
        const row = await connectionRow(scope);
        if (!row?.cookie_ciphertext) return { connected: false };
        let cookie;
        try {
            cookie = decryptCredential(row.cookie_ciphertext, env);
        } catch {
            return { connected: false, reason: "credential_unreadable" };
        }
        const profile = await fetchProfile(cookie);
        if (!profile) return { connected: false, reason: "expired" };
        return {
            connected: true,
            nickname: profile.uname || cleanText(row.nickname, 80),
            uid: profile.mid || cleanText(row.bilibili_uid, 40),
            face_url: profile.face || cleanText(row.face_url, 4096)
        };
    }

    async function disconnect(scope) {
        const row = await connectionRow(scope);
        if (row?.id) {
            const { error } = await (scope?.db || database)
                .from("bilibili_qr_connections")
                .delete()
                .eq("id", row.id);
            if (error) throw error;
        }
        return { disconnected: true };
    }

    async function favoriteFolders(scope) {
        const cookie = await requireCookie(scope);
        const profile = await fetchProfile(cookie);
        if (!profile) throw requestError(401, "bilibili_qr_session_expired", "哔哩哔哩登录已过期，请重新扫码登录。");
        const query = profile.wbi_mixin_key
            ? wbiSignedQuery({ up_mid: profile.mid }, profile.wbi_mixin_key)
            : `up_mid=${encodeURIComponent(profile.mid)}`;
        const { json } = await biliGet(
            fetchImpl,
            `https://api.bilibili.com/x/v3/fav/folder/created/list-all?${query}`,
            cookie
        );
        if (Number(json?.code) !== 0) {
            if (Number(json?.code) === -352) {
                throw requestError(502, "bilibili_wbi_required", "哔哩哔哩接口要求更新签名算法，收藏夹暂时无法读取。");
            }
            throw requestError(502, "bilibili_favorites_unavailable", "哔哩哔哩收藏夹暂时无法读取，请稍后重试。");
        }
        const list = Array.isArray(json?.data?.list) ? json.data.list : [];
        return list
            .map((row) => ({
                media_id: String(row?.id ?? row?.media_id ?? ""),
                title: cleanText(row?.title, 180) || "未命名收藏夹",
                media_count: Math.min(1000, Math.max(0, Number(row?.media_count ?? row?.mediaCount) || 0))
            }))
            .filter((row) => MEDIA_ID_PATTERN.test(row.media_id));
    }

    async function favoriteVideos(scope, mediaId, page = 1) {
        if (!MEDIA_ID_PATTERN.test(String(mediaId || ""))) {
            throw requestError(400, "bilibili_media_id_invalid", "收藏夹编号格式不正确。");
        }
        const safePage = Math.min(50, Math.max(1, Number(page) || 1));
        const cookie = await requireCookie(scope);
        const profile = await fetchProfile(cookie);
        if (!profile) throw requestError(401, "bilibili_qr_session_expired", "哔哩哔哩登录已过期，请重新扫码登录。");
        const base = { media_id: mediaId, pn: String(safePage), ps: "20", platform: "web" };
        const query = profile.wbi_mixin_key
            ? wbiSignedQuery(base, profile.wbi_mixin_key)
            : Object.entries(base).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
        const { json } = await biliGet(
            fetchImpl,
            `https://api.bilibili.com/x/v3/fav/resource/list?${query}`,
            cookie
        );
        if (Number(json?.code) !== 0) {
            if (Number(json?.code) === -352) {
                throw requestError(502, "bilibili_wbi_required", "哔哩哔哩接口要求更新签名算法，收藏夹内容暂时无法读取。");
            }
            throw requestError(502, "bilibili_favorites_unavailable", "收藏夹内容暂时无法读取，请稍后重试。");
        }
        const rows = Array.isArray(json?.data?.medias) ? json.data.medias : Array.isArray(json?.data) ? json.data : [];
        return rows
            .map((row) => {
                const bvid = String(row?.bvid ?? row?.bvid_id ?? "");
                if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return null;
                return {
                    bvid,
                    title: cleanText(row?.title, 300),
                    cover: cleanText(row?.cover, 4096),
                    page_url: `https://www.bilibili.com/video/${bvid}`
                };
            })
            .filter(Boolean);
    }

    async function recommendations(scope, requestedLimit = 6) {
        const limit = Number.isFinite(Number(requestedLimit)) ? Math.min(12, Math.max(1, Math.round(Number(requestedLimit)))) : 6;
        const cookie = await requireCookie(scope);
        const profile = await fetchProfile(cookie);
        if (!profile) throw requestError(401, "bilibili_qr_session_expired", "哔哩哔哩登录已过期，请重新登录。");
        if (!profile.wbi_mixin_key) throw requestError(502, "bilibili_wbi_required", "B站首页推荐签名暂时不可用，请稍后重试。");
        const query = wbiSignedQuery({ fresh_type: "3", ps: String(limit), version: "1", feed_version: "V8" }, profile.wbi_mixin_key);
        const { status, json } = await biliGet(fetchImpl, `https://api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd?${query}`, cookie);
        if (Number(json?.code) === -101) throw requestError(401, "bilibili_qr_session_expired", "B站登录已过期，请重新登录后获取推荐。");
        if (status === 412 || [-352, -412].includes(Number(json?.code))) throw requestError(502, "bilibili_recommendations_risk_blocked", "B站暂时拦截了推荐请求，请稍后重试或在B站完成验证。");
        if (status !== 200 || Number(json?.code) !== 0 || !Array.isArray(json?.data?.item)) throw requestError(502, "bilibili_recommendations_unavailable", "B站首页推荐暂时无法读取，请稍后重试。");
        const seen = new Set();
        const videos = json.data.item.flatMap(row => {
            const bvid = String(row?.bvid || "");
            if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || seen.has(bvid) || row?.goto && row.goto !== "av") return [];
            seen.add(bvid);
            return [{ bvid, title: cleanText(row.title, 300), creator: cleanText(row.owner?.name, 100), page_url: `https://www.bilibili.com/video/${bvid}` }];
        }).slice(0, limit);
        if (!videos.length) throw requestError(502, "bilibili_recommendations_unavailable", "这次B站首页没有返回可播放的视频，请稍后换一批。");
        return { source: "bilibili_homepage", fetched_at: new Date().toISOString(), videos };
    }

    // 内置浏览器导入登录态：直接保存用户从内置浏览器提取的 Cookie。
    async function importCookie(scope, cookie) {
        const text = String(cookie || "").trim();
        if (!text) {
            throw requestError(400, "bilibili_cookie_required", "缺少哔哩哔哩登录 Cookie。");
        }
        if (!hasCredentialEncryption(env)) {
            throw requestError(503, "bilibili_qr_encryption_unconfigured", "服务器还没有配置凭据加密密钥，暂时不能保存哔哩哔哩登录。");
        }
        const profile = (await fetchProfile(text)) || null;
        if (!profile) {
            throw requestError(401, "bilibili_cookie_invalid", "这个登录状态已经失效，请重新登录后提取。");
        }
        const ciphertext = encryptCredential(text, env);
        const db = scope?.db || database;
        const values = {
            user_id: scope.userId,
            companion_id: scope.companionId,
            bilibili_uid: profile.mid,
            nickname: profile.uname,
            face_url: profile.face,
            cookie_ciphertext: ciphertext,
            updated_at: new Date().toISOString()
        };
        const existing = await connectionRow(scope);
        let saved = null;
        if (existing?.id) {
            const { data, error } = await db
                .from("bilibili_qr_connections")
                .update(values)
                .eq("id", existing.id)
                .select("*")
                .single();
            if (error) throw error;
            saved = data;
        } else {
            const { data, error } = await db
                .from("bilibili_qr_connections")
                .insert({ ...values, created_at: new Date().toISOString() })
                .select("*")
                .single();
            if (error) throw error;
            saved = data;
        }
        return { connected: true, connection: publicConnection(saved) };
    }

    return {
        begin,
        check,
        cookieText,
        disconnect,
        favoriteFolders,
        favoriteVideos,
        recommendations,
        importCookie,
        status
    };
}

module.exports = {
    createBilibiliQrLoginService,
    deriveMixinKey,
    md5Hex,
    wbiKeyFromUrl,
    wbiSignedQuery
};
