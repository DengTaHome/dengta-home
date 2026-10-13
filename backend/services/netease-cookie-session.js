"use strict";

// 网易云 Cookie 会话（一键获取登录态）：
// App 内 WebView 登录后抓取 MUSIC_U/__csrf 存到后端，用网易云明文官方 API
// （参考 Vael-KY/netease-music-mcp 的 Cookie 方案）校验账号，并用于搜歌/取播放地址/导歌单。

function cleanText(value, maximum) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
        .slice(0, maximum)
        .join("");
}

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function plainHeaders(cookie) {
    return {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: "https://music.163.com/",
        ...(cookie ? { Cookie: cookie } : {})
    };
}

async function validateCookie(cookie) {
    try {
        const response = await fetch("https://music.163.com/api/nuser/account/get", {
            headers: plainHeaders(cookie),
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) return null;
        const json = await response.json().catch(() => null);
        const profile = json?.profile;
        if (!profile) return null;
        return {
            account_id: String(profile.userId ?? ""),
            account_name: cleanText(profile.nickname ?? "", 100)
        };
    } catch {
        return null;
    }
}

function normalizeSong(song) {
    if (!song) return null;
    const artist =
        (Array.isArray(song.ar) ? song.ar.map((a) => cleanText(a?.name, 120)).filter(Boolean).join(" / ") : "") ||
        (Array.isArray(song.artists) ? song.artists.map((a) => cleanText(a?.name, 120)).filter(Boolean).join(" / ") : "");
    return {
        id: String(song.id ?? ""),
        title: cleanText(song.name ?? "", 300),
        artist,
        album: cleanText(song.al?.name ?? song.album?.name ?? "", 300),
        // 网易云 dt 单位是毫秒（如 228080ms）；字段按秒存储，统一换算。
        duration_seconds: durationToSeconds(song.dt ?? song.duration),
        cover_url: String(song.al?.picUrl ?? song.album?.picUrl ?? "").replace(/^\/\//, "https:")
    };
}

function durationToSeconds(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    const seconds = number > 100000 ? Math.round(number / 1000) : Math.round(number);
    return Math.min(604800, seconds);
}

async function cookieSearch(cookie, query, limit = 20) {
    const keywords = cleanText(query, 120);
    if (!keywords) throw requestError(400, "netease_cookie_query_required", "请输入搜索关键词。");
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
    const response = await fetch(
        "https://music.163.com/api/search/get?s=" + encodeURIComponent(keywords) + "&type=1&limit=" + safeLimit,
        { headers: plainHeaders(cookie), signal: AbortSignal.timeout(10000) }
    );
    const json = await response.json().catch(() => null);
    const songs = Array.isArray(json?.result?.songs) ? json.result.songs : [];
    return songs.map(normalizeSong).filter(Boolean);
}

async function cookieSongUrl(cookie, id) {
    const songId = String(id ?? "").trim();
    if (!/^\d{1,20}$/.test(songId)) throw requestError(400, "netease_cookie_id_invalid", "歌曲编号格式不正确。");
    const response = await fetch(
        "https://music.163.com/api/song/enhance/player/url?id=" + songId + "&ids=[" + songId + "]&br=320000",
        { headers: plainHeaders(cookie), signal: AbortSignal.timeout(10000) }
    );
    const json = await response.json().catch(() => null);
    const row = Array.isArray(json?.data)
        ? json.data.find((item) => String(item?.id) === songId)
        : null;
    return {
        id: songId,
        url: String(row?.url || ""),
        free_trial: row?.freeTrialInfo != null,
        br: Number(row?.br) || 0
    };
}

async function cookiePlaylistDetail(cookie, playlistId) {
    const id = String(playlistId ?? "").trim();
    if (!/^\d{1,20}$/.test(id)) throw requestError(400, "netease_cookie_id_invalid", "歌单编号格式不正确。");
    let json = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await fetch(
                "https://music.163.com/api/v6/playlist/detail?id=" + id + "&n=1000&s=0",
                { headers: plainHeaders(cookie), signal: AbortSignal.timeout(12000) }
            );
            json = await response.json().catch(() => null);
            if (json?.code === 200 && json?.playlist) break;
        } catch {
            json = null;
        }
        if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 800));
        }
    }
    const result = json?.playlist;
    if (!result) return null;
    let tracks = (Array.isArray(result.tracks) ? result.tracks : [])
        .map(normalizeSong)
        .filter(Boolean);
    const trackIds = Array.isArray(result.trackIds)
        ? result.trackIds.map((row) => String(row?.id ?? row)).filter((value) => /^\d{1,20}$/.test(value))
        : [];
    if (tracks.length < trackIds.length && trackIds.length > 0) {
        // v6/v3 playlist detail 只返回前 20 首完整信息，其余按 trackIds 分批补全
        const found = new Set(tracks.map((track) => track.id));
        const missing = trackIds.filter((trackId) => !found.has(trackId));
        for (let start = 0; start < missing.length; start += 200) {
            const chunk = missing.slice(start, start + 200);
            let songs = [];
            for (let attempt = 0; attempt < 2 && songs.length === 0; attempt += 1) {
                try {
                    const detailResponse = await fetch(
                        "https://music.163.com/api/v3/song/detail",
                        {
                            method: "POST",
                            headers: {
                                ...plainHeaders(cookie),
                                "Content-Type": "application/x-www-form-urlencoded"
                            },
                            body: "c=" + encodeURIComponent(JSON.stringify(chunk.map((trackId) => ({ id: Number(trackId) })))),
                            signal: AbortSignal.timeout(15000)
                        }
                    );
                    const detailJson = await detailResponse.json().catch(() => null);
                    songs = Array.isArray(detailJson?.songs) ? detailJson.songs : [];
                    if (songs.length === 0) {
                        await new Promise((resolve) => setTimeout(resolve, 800));
                    }
                } catch {
                    songs = [];
                    await new Promise((resolve) => setTimeout(resolve, 800));
                }
            }
            tracks = tracks.concat(songs.map(normalizeSong).filter(Boolean));
        }
    }
    return {
        id: String(result.id ?? id),
        name: cleanText(result.name ?? "", 180),
        tracks: tracks.slice(0, 2000)
    };
}

function createNeteaseCookieSessionService({ database } = {}) {
    if (!database?.from) {
        throw new TypeError("netease cookie session requires a Supabase database client");
    }

    async function read(scope) {
        const { data, error } = await database
            .from("netease_cookie_sessions")
            .select("cookie_text, account_name, account_id, updated_at")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function save(scope, cookie, account) {
        const value = cleanText(cookie, 4096);
        if (!value) throw requestError(400, "netease_cookie_required", "缺少网易云登录 Cookie。");
        const { error } = await database
            .from("netease_cookie_sessions")
            .upsert({
                user_id: scope.userId,
                companion_id: scope.companionId,
                cookie_text: value,
                account_name: account?.account_name || "",
                account_id: account?.account_id || "",
                updated_at: new Date().toISOString()
            });
        if (error) throw error;
        return { connected: true, account_name: account?.account_name || "", account_id: account?.account_id || "" };
    }

    async function clear(scope) {
        const { error } = await database
            .from("netease_cookie_sessions")
            .delete()
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId);
        if (error) throw error;
        return { connected: false };
    }

    return { clear, cookiePlaylistDetail, cookieSearch, cookieSongUrl, read, save, validateCookie };
}

module.exports = { createNeteaseCookieSessionService };
