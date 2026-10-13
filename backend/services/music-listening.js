const { isIP } = require("node:net");
const { recoverPlaylistImport } = require("./music-import-recovery");
const { playlistSaveState, requireCompletePlaylist } = require("./music-playlist-integrity");

const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_PLAYLIST_ITEMS = 500;
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLATFORM_PAGE_HOSTS = [
    "youtube.com",
    "youtu.be",
    "bilibili.com",
    "music.163.com",
    "y.qq.com",
    "kugou.com",
    "kuwo.cn",
    "spotify.com",
    "music.apple.com",
    "soundcloud.com"
];

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

function cleanLyrics(value) {
    return Array.from(String(value ?? "").replace(/\r\n?/g, "\n").trim())
        .slice(0, 20000)
        .join("");
}

function privateIpv4(hostname) {
    const parts = hostname.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
    return (
        parts[0] === 0 ||
        parts[0] === 10 ||
        parts[0] === 127 ||
        parts[0] >= 224 ||
        (parts[0] === 169 && parts[1] === 254) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    );
}

function privateIpv6(hostname) {
    const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
        normalized === "::" ||
        normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        /^fe[89ab]/.test(normalized) ||
        normalized.startsWith("::ffff:127.") ||
        normalized.startsWith("::ffff:10.") ||
        normalized.startsWith("::ffff:192.168.")
    );
}

function isPlatformPageHost(hostname) {
    return PLATFORM_PAGE_HOSTS.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`)
    );
}

function normalizePublicHttpsUrl(value) {
    const source = String(value ?? "").trim();
    let parsed;
    try {
        parsed = new URL(source);
    } catch {
        throw requestError(400, "music_url_invalid", "歌曲 URL 格式不正确。");
    }
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    const ipHostname = hostname.replace(/^\[|\]$/g, "");
    if (parsed.protocol !== "https:") {
        throw requestError(400, "music_url_https_required", "歌曲 URL 必须使用 HTTPS。");
    }
    if (parsed.username || parsed.password) {
        throw requestError(400, "music_url_userinfo_forbidden", "歌曲 URL 不能包含用户凭据。");
    }
    if (
        !hostname ||
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        hostname.endsWith(".lan") ||
        (isIP(ipHostname) === 4 && privateIpv4(ipHostname)) ||
        (isIP(ipHostname) === 6 && privateIpv6(ipHostname))
    ) {
        throw requestError(400, "music_url_not_public", "歌曲 URL 必须指向公开网络地址。");
    }
    if (isPlatformPageHost(hostname)) {
        throw requestError(
            400,
            "music_platform_page_unsupported",
            "不支持导入音乐平台网页，请提供可由客户端直接播放的 HTTPS URL。"
        );
    }
    parsed.hash = "";
    const normalized = parsed.toString();
    if (normalized.length > 4096) {
        throw requestError(400, "music_url_too_long", "歌曲 URL 过长。");
    }
    return normalized;
}

function normalizeDuration(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number)
        ? Math.min(604800, Math.max(0, Math.round(number)))
        : null;
}

function normalizeItem(value, fallback = {}) {
    const source = typeof value === "string" ? { url: value } : value || {};
    return {
        url: normalizePublicHttpsUrl(source.url || source.src),
        title: cleanText(source.title ?? source.name ?? fallback.title, 300),
        artist: cleanText(source.artist ?? source.singer ?? fallback.artist, 300),
        album: cleanText(source.album, 300),
        duration_seconds: normalizeDuration(
            source.duration_seconds ?? source.duration ?? fallback.duration_seconds
        ),
        lyrics: cleanLyrics(source.lyrics ?? source.lyric)
    };
}

function parseJson(value) {
    let parsed = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            throw requestError(400, "music_json_invalid", "歌单 JSON 格式不正确。");
        }
    }
    const items = Array.isArray(parsed)
        ? parsed
        : parsed?.items || parsed?.tracks || parsed?.songs;
    if (!Array.isArray(items)) {
        throw requestError(400, "music_items_missing", "歌单中没有可导入的歌曲列表。");
    }
    return {
        name: cleanText(parsed?.name ?? parsed?.title, 180),
        items: items.map((item) => normalizeItem(item))
    };
}

function parseExtInf(line) {
    const match = line.match(/^#EXTINF:\s*(-?\d+)\s*,\s*(.*)$/i);
    if (!match) return {};
    const label = cleanText(match[2], 600);
    const separator = label.indexOf(" - ");
    return {
        duration_seconds: Number(match[1]) >= 0 ? Number(match[1]) : null,
        artist: separator >= 0 ? label.slice(0, separator) : "",
        title: separator >= 0 ? label.slice(separator + 3) : label
    };
}

function parseM3u(text) {
    const items = [];
    let metadata = {};
    for (const rawLine of String(text).replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (/^#EXTINF:/i.test(line)) {
            metadata = parseExtInf(line);
            continue;
        }
        if (line.startsWith("#")) continue;
        items.push(normalizeItem({ url: line }, metadata));
        metadata = {};
    }
    return { name: "", items };
}

function parseText(text) {
    const items = [];
    for (const rawLine of String(text).replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const columns = line.split("\t");
        items.push(
            normalizeItem({
                url: columns[0],
                title: columns[1],
                artist: columns[2],
                album: columns[3],
                duration_seconds: columns[4],
                lyrics: columns[5]
            })
        );
    }
    return { name: "", items };
}

function importByteLength(input) {
    if (typeof input.content === "string") return Buffer.byteLength(input.content, "utf8");
    try {
        return Buffer.byteLength(JSON.stringify(input.content ?? input), "utf8");
    } catch {
        return MAX_IMPORT_BYTES + 1;
    }
}

function parsePlaylistImport(input = {}) {
    if (importByteLength(input) > MAX_IMPORT_BYTES) {
        throw requestError(413, "music_import_too_large", "歌单导入内容不能超过 1 MiB。");
    }
    const content = input.content ?? input.playlist ?? input;
    const requestedFormat = cleanText(input.format, 20).toLowerCase();
    const format = requestedFormat === "m3u8" ? "m3u" : requestedFormat;
    let parsed;
    let sourceFormat;
    if (format === "json" || (!format && typeof content !== "string")) {
        parsed = parseJson(content);
        sourceFormat = "json";
    } else if (format === "m3u" || (!format && /^\s*#EXTM3U/i.test(content))) {
        parsed = parseM3u(content);
        sourceFormat = "m3u";
    } else if (!format || format === "text" || format === "url" || format === "tab") {
        parsed = parseText(content);
        sourceFormat = "text";
    } else {
        throw requestError(400, "music_format_unsupported", "不支持该歌单格式。");
    }
    if (parsed.items.length === 0) {
        throw requestError(400, "music_items_missing", "歌单中没有可导入的歌曲。");
    }
    if (parsed.items.length > MAX_PLAYLIST_ITEMS) {
        throw requestError(400, "music_item_limit", "每个歌单最多导入 500 首歌曲。");
    }
    return {
        name: cleanText(input.name, 180) || parsed.name || "导入歌单",
        source_format: sourceFormat,
        items: parsed.items
    };
}

function requireUuid(value, code = "music_playlist_id_invalid") {
    const id = String(value || "").trim().toLowerCase();
    if (!UUID_PATTERN.test(id)) throw requestError(400, code, "歌单编号格式不正确。");
    return id;
}

async function importPlaylist(database, input, identity = {}) {
    const parsed = parsePlaylistImport(input);
    if (input.request_id !== undefined) return recoverPlaylistImport(database, parsed, input.request_id, identity);
    const inserted = await database
        .from("music_playlists")
        .insert({
            name: parsed.name,
            provider: "local",
            source_format: parsed.source_format,
            item_count: parsed.items.length
        })
        .select("id, name, provider, provider_playlist_id, external_url, source_format, item_count, created_at, updated_at")
        .single();
    if (inserted.error) throw inserted.error;
    const values = parsed.items.map((item, position) => ({
        playlist_id: inserted.data.id,
        position,
        ...item
    }));
    const itemInsert = await database.from("music_playlist_items").insert(values);
    if (itemInsert.error) {
        await database.from("music_playlists").delete().eq("id", inserted.data.id);
        throw itemInsert.error;
    }
    return { ...inserted.data, items: values.map(({ playlist_id, ...item }) => item) };
}

async function listPlaylists(database) {
    const { data, error } = await database
        .from("music_playlists")
        .select("id, name, provider, provider_playlist_id, external_url, source_format, item_count, created_at, updated_at, music_playlist_items(count)")
        .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(({ music_playlist_items: counts, ...playlist }) => ({
        ...playlist,
        ...playlistSaveState(playlist, Array.isArray(counts) ? counts.length === 0 ? 0 : counts[0]?.count : -1)
    }));
}

async function readPlaylist(database, playlistId) {
    const id = requireUuid(playlistId);
    const playlistResult = await database
        .from("music_playlists")
        .select("id, name, provider, provider_playlist_id, external_url, source_format, item_count, created_at, updated_at")
        .eq("id", id)
        .maybeSingle();
    if (playlistResult.error) throw playlistResult.error;
    if (!playlistResult.data) throw requestError(404, "music_playlist_not_found", "找不到该歌单。");
    const itemsResult = await database
        .from("music_playlist_items")
        .select("id, position, url, provider_track_id, external_url, playback_mode, title, artist, album, cover_url, duration_seconds, lyrics, created_at")
        .eq("playlist_id", id)
        .order("position", { ascending: true });
    if (itemsResult.error) throw itemsResult.error;
    const items = itemsResult.data || [];
    return { ...playlistResult.data, ...requireCompletePlaylist(playlistResult.data, items), items };
}

async function deletePlaylist(database, playlistId) {
    const id = requireUuid(playlistId);
    const active = await database
        .from("co_watch_sessions")
        .select("id")
        .eq("status", "active")
        .eq("session_mode", "listening")
        .eq("playlist_id", id)
        .limit(1);
    if (active.error) throw active.error;
    if (active.data?.length) {
        throw requestError(409, "music_playlist_active", "正在一起听的歌单不能删除。");
    }
    const queued = await database
        .from("music_playback_queue_items")
        .select("id")
        .eq("playlist_id", id)
        .limit(1);
    if (queued.error) throw queued.error;
    if (queued.data?.length) {
        throw requestError(409, "music_playlist_queued", "播放队列仍在引用该歌单，暂时不能删除。");
    }
    const detached = await database
        .from("co_watch_sessions")
        .update({ playlist_id: null, playlist_item_id: null })
        .eq("status", "ended")
        .eq("playlist_id", id);
    if (detached.error) throw detached.error;
    const result = await database
        .from("music_playlists")
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw requestError(404, "music_playlist_not_found", "找不到该歌单。");
    return result.data;
}

function publicFavorite(row) {
    const favorite = {
        item_id: row.id,
        playlist_id: row.playlist_id,
        title: row.title || "",
        artist: row.artist || "",
        album: row.album || "",
        duration_seconds: row.duration_seconds == null
            ? null
            : Number(row.duration_seconds),
        favorited_at: row.favorited_at
    };
    if (row.playback_mode === "external_netease") {
        favorite.provider_track_id = row.provider_track_id;
        favorite.external_url = row.external_url;
        favorite.playback_mode = "external_netease";
    }
    return favorite;
}

async function favoriteItems(database, favoriteRows) {
    const ids = favoriteRows.map((row) => row.item_id);
    if (ids.length === 0) return [];
    const items = await database
        .from("music_playlist_items")
        .select("id, playlist_id, provider_track_id, external_url, playback_mode, title, artist, album, duration_seconds")
        .in("id", ids);
    if (items.error) throw items.error;
    const favoritedAt = new Map(
        favoriteRows.map((row) => [row.item_id, row.created_at])
    );
    return (items.data || [])
        .map((row) => publicFavorite({
            ...row,
            favorited_at: favoritedAt.get(row.id)
        }))
        .sort((left, right) =>
            String(right.favorited_at).localeCompare(String(left.favorited_at))
        );
}

async function listFavorites(database) {
    const result = await database
        .from("music_favorites")
        .select("item_id, created_at")
        .order("created_at", { ascending: false });
    if (result.error) throw result.error;
    return favoriteItems(database, result.data || []);
}

async function putFavorite(database, itemId) {
    const id = requireUuid(itemId, "music_item_id_invalid");
    const item = await database
        .from("music_playlist_items")
        .select("id, playlist_id, provider_track_id, external_url, playback_mode, title, artist, album, duration_seconds")
        .eq("id", id)
        .maybeSingle();
    if (item.error) throw item.error;
    if (!item.data) {
        throw requestError(404, "music_item_not_found", "找不到该歌曲。");
    }
    const inserted = await database
        .from("music_favorites")
        .insert({ item_id: id })
        .select("item_id, created_at")
        .maybeSingle();
    if (inserted.error && String(inserted.error.code) !== "23505") {
        throw inserted.error;
    }
    let favorite = inserted.data;
    if (!favorite) {
        const existing = await database
            .from("music_favorites")
            .select("item_id, created_at")
            .eq("item_id", id)
            .maybeSingle();
        if (existing.error) throw existing.error;
        favorite = existing.data;
    }
    return publicFavorite({
        ...item.data,
        favorited_at: favorite?.created_at || null
    });
}

async function deleteFavorite(database, itemId) {
    const id = requireUuid(itemId, "music_item_id_invalid");
    const result = await database
        .from("music_favorites")
        .delete()
        .eq("item_id", id);
    if (result.error) throw result.error;
    return { item_id: id, favorited: false };
}

module.exports = {
    MAX_IMPORT_BYTES,
    MAX_PLAYLIST_ITEMS,
    deleteFavorite,
    deletePlaylist,
    importPlaylist,
    listFavorites,
    listPlaylists,
    normalizePublicHttpsUrl,
    parsePlaylistImport,
    putFavorite,
    readPlaylist
};
