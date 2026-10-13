"use strict";

// 网易云公开元数据（无需登录）：单曲详情 + 专辑封面 + 歌词。
// 用于：分享链接导入的单曲补齐真实歌名/歌手/封面；两档音乐解读在
// 没有扫码连接时兜底拿到歌名、歌手与歌词。

function cleanText(value, maximum) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
        .slice(0, maximum)
        .join("");
}

function picUrl(value) {
    const raw = String(value || "");
    if (!raw) return "";
    return raw.startsWith("//") ? `https:${raw}` : raw.startsWith("http") ? raw : "";
}

function durationSeconds(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    const seconds = number > 100000 ? Math.round(number / 1000) : Math.round(number);
    return Math.min(604800, seconds);
}

async function fetchSongMetadata(id, fetchImpl = globalThis.fetch, cookie = "") {
    const trackId = String(id ?? "").trim();
    if (!/^\d{1,20}$/.test(trackId)) return null;
    try {
        const response = await fetchImpl(
            `https://music.163.com/api/song/detail?ids=[${trackId}]`,
            {
                method: "GET",
                headers: {
                    Referer: "https://music.163.com/",
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    ...(cookie ? { Cookie: cookie } : {})
                },
                signal: AbortSignal.timeout(10000)
            }
        );
        if (!response.ok) return null;
        const json = await response.json().catch(() => null);
        const song = Array.isArray(json?.songs) ? json.songs[0] : null;
        if (!song) return null;
        const artists = Array.isArray(song.ar)
            ? song.ar.map((artist) => cleanText(artist?.name, 120)).filter(Boolean).join(" / ")
            : "";
        return {
            provider_track_id: trackId,
            title: cleanText(song.name, 300),
            artist: artists,
            album: cleanText(song.al?.name, 300),
            cover_url: picUrl(song.al?.picUrl),
            duration_seconds: durationSeconds(song.dt ?? song.duration),
            external_url: `https://music.163.com/#/song?id=${trackId}`
        };
    } catch {
        return null;
    }
}

async function fetchSongLyrics(id, fetchImpl = globalThis.fetch) {
    const trackId = String(id ?? "").trim();
    if (!/^\d{1,20}$/.test(trackId)) return { lyric: "", translated_lyric: "" };
    try {
        const response = await fetchImpl(
            `https://music.163.com/api/song/lyric?id=${trackId}`,
            {
                method: "GET",
                headers: {
                    Referer: "https://music.163.com/",
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    ...(cookie ? { Cookie: cookie } : {})
                },
                signal: AbortSignal.timeout(10000)
            }
        );
        if (!response.ok) return { lyric: "", translated_lyric: "" };
        const json = await response.json().catch(() => null);
        return {
            lyric: String(json?.lrc?.lyric || ""),
            translated_lyric: String(json?.tlyric?.lyric || "")
        };
    } catch {
        return { lyric: "", translated_lyric: "" };
    }
}

module.exports = {
    fetchSongLyrics,
    fetchSongMetadata
};
