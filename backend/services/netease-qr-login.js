"use strict";

// Built-in NetEase Cloud Music QR-code login for DengTa.
// Users scan a QR with the official NetEase Music app; the resulting login
// cookie (MUSIC_U, __csrf, ...) is stored encrypted per tenant and only used
// to read the user's own playlists, resolve playable audio URLs and fetch
// lyrics. No password is ever handled by DengTa.

const {
    decryptCredential,
    encryptCredential,
    hasCredentialEncryption
} = require("./mcp-device-center");
const {
    cookieHeader,
    csrfFromCookie,
    eapiRequest,
    neteaseApiGet,
    parseSetCookies,
    weapiRequest
} = require("./netease-weapi");

const MAX_IMPORT_TRACKS = 300;
const URL_RESOLVE_BATCH = 100;
const DECIMAL_ID = /^\d{1,20}$/;
const QR_KEY_PATTERN = /^[0-9A-Za-z-]{8,128}$/;

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

function decimalId(value, code = "netease_resource_id_invalid") {
    const id = String(value ?? "").trim();
    if (!DECIMAL_ID.test(id)) {
        throw requestError(400, code, "网易云资源编号格式不正确。");
    }
    return id;
}

function songUrl(id) {
    return `https://music.163.com/#/song?id=${decimalId(id)}`;
}

function normalizeArtists(artists) {
    const list = Array.isArray(artists) ? artists : [];
    return cleanText(
        list.map((artist) => (typeof artist === "string" ? artist : artist?.name)).filter(Boolean).join(" / "),
        300
    );
}

function durationSeconds(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    const seconds = number > 100000 ? Math.round(number / 1000) : Math.round(number);
    return Math.min(604800, seconds);
}

function normalizeTrack(row) {
    const id = String(row?.id ?? row?.song_id ?? row?.track_id ?? "");
    if (!DECIMAL_ID.test(id)) return null;
    const rawCover = String(row?.album?.picUrl ?? row?.al?.picUrl ?? row?.cover ?? row?.cover_url ?? "");
    return {
        provider_track_id: id,
        title: cleanText(row?.name ?? row?.title, 300),
        artist: normalizeArtists(row?.artists ?? row?.ar ?? row?.artist),
        album: cleanText(row?.album?.name ?? row?.al?.name ?? row?.album, 300),
        cover_url: rawCover.startsWith("//") ? `https:${rawCover}` : rawCover.startsWith("http") ? rawCover : "",
        duration_seconds: durationSeconds(row?.duration ?? row?.dt ?? row?.duration_seconds)
    };
}

function createNeteaseQrLoginService({
    database,
    env = process.env,
    fetchImpl = globalThis.fetch,
    cookieSession = null
} = {}) {
    if (!database?.from) {
        throw new Error("netease qr login requires a Supabase database client");
    }

    // 二维码会话与设备绑定：网易云风控要求 unikey 与轮询使用同一个 sDeviceId。
    // 服务端为每个 key 生成并记住 sDeviceId，10 分钟后过期。
    const qrSessions = new Map();
    const pollLedger = new Map(); // key -> 最近轮询记录(诊断用)
    const beginTimes = new Map(); // 每用户发码限速,防止触发频率风控
    function ledgerPush(key, entry) {
        const list = pollLedger.get(String(key)) || [];
        list.push(entry);
        if (list.length > 30) list.shift();
        pollLedger.set(String(key), list);
    }
    function sessionDevice(key, presetId = "") {
        const existing = qrSessions.get(String(key));
        if (existing && Date.now() - existing.createdAt < 10 * 60 * 1000) return existing;
        const device = {
            // 优先使用用户手机真实信息派生的 32 位十六进制设备号;
            // 网页端没有设备信息时退化为随机值。
            sDeviceId:
                presetId ||
                require("crypto").randomBytes(16).toString("hex"),
            cookies: [],
            createdAt: Date.now()
        };
        qrSessions.set(String(key), device);
        return device;
    }

    function deriveRealDeviceId(deviceInfo) {
        const androidId = String(deviceInfo?.android_id || deviceInfo?.androidId || "").trim();
        const model = String(deviceInfo?.model || "").trim();
        if (!androidId) return "";
        return require("crypto")
            .createHash("md5")
            .update(androidId + "|" + model)
            .digest("hex");
    }

    async function connectionRow(scope) {
        const db = scope?.db || database;
        const { data, error } = await db
            .from("netease_qr_connections")
            .select("*")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .maybeSingle();
        if (error?.code === "42P01" || String(error?.message || "").includes("does not exist")) {
            throw requestError(503, "netease_qr_storage_unavailable", "网易云扫码登录存储还未准备好，请先执行数据库迁移。");
        }
        if (error) throw error;
        return data || null;
    }

    async function requireCookie(scope) {
        // 优先使用 App 内一键登录保存的 Cookie 会话；没有时才回退扫码登录凭据。
        if (cookieSession) {
            const session = await cookieSession.read(scope).catch(() => null);
            if (session?.cookie_text) {
                return session.cookie_text;
            }
        }
        const row = await connectionRow(scope);
        if (!row?.cookie_ciphertext) {
            throw requestError(400, "netease_qr_not_connected", "还没有登录网易云，请先在 App 内一键登录。");
        }
        try {
            return decryptCredential(row.cookie_ciphertext, env);
        } catch {
            throw requestError(400, "netease_qr_session_expired", "网易云登录凭据无法解密，请重新登录。");
        }
    }

    function publicConnection(row) {
        if (!row) return null;
        return {
            connected: true,
            nickname: cleanText(row.nickname, 80),
            uid: cleanText(row.netease_uid, 40),
            connected_at: row.updated_at || row.created_at || ""
        };
    }

    async function fetchProfile(cookie) {
        const { json } = await weapiRequest(fetchImpl, "/weapi/w/nuser/account/get", {}, cookie);
        const profile = json?.profile || json?.account || {};
        return {
            uid: String(profile?.userId ?? profile?.id ?? ""),
            nickname: cleanText(profile?.nickname, 80)
        };
    }

    function assertCookieStillValid(cookie, json, status) {
        if (status === 401 || (json && Number(json?.code) === 301)) {
            throw requestError(401, "netease_qr_session_expired", "网易云登录已过期，请重新扫码登录。");
        }
    }

    async function begin(input = {}) {
        // 频率限速:同一用户10分钟内最多发3次二维码,防止触发网易云频率风控。
        if (input?.scope?.userId) {
            const now = Date.now();
            const list = (beginTimes.get(input.scope.userId) || []).filter((t) => now - t < 10 * 60 * 1000);
            if (list.length >= 3) {
                throw requestError(429, "netease_qr_too_frequent", "短时间尝试太多次,已被风控盯上。请等 5-10 分钟再试。");
            }
            list.push(now);
            beginTimes.set(input.scope.userId, list);
        }
        const realDeviceId = deriveRealDeviceId(input?.device);
        const device = sessionDevice("pending", realDeviceId);
        // 对齐网易云官方扫码 API 配方(NeteaseCloudMusicApi):unikey 不携带任何设备 Cookie。
        const { json, setCookies } = await weapiRequest(fetchImpl, "/weapi/login/qrcode/unikey", {
            type: "1"
        }, "");
        if (!json || Number(json.code) !== 200 || !json.unikey) {
            throw requestError(502, "netease_qr_unavailable", "网易云二维码登录暂时不可用，请稍后重试。");
        }
        const key = String(json.unikey);
        // 必须把 unikey 请求用的同一 sDeviceId 绑定到这个 key，
        // 否则轮询时设备不一致会被网易云风控压住（表现为一直 waiting 然后过期）。
        // 同时保留创建二维码时服务端下发的匿名 Cookie,轮询时一并带回。
        device.cookies = parseSetCookies(setCookies);
        qrSessions.set(String(key), device);
        const chainId = `v1_${device.sDeviceId}_web_login_${Date.now()}`;
        return {
            key,
            qr_content: `http://music.163.com/login?codekey=${key}&chainId=${chainId}`,
            login_url: `https://music.163.com/login?codekey=${key}&chainId=${chainId}`,
            expires_in_seconds: 300,
            // 透明诊断:告诉前端是否收到并使用了真实设备信息。
            device_used: Boolean(realDeviceId),
            device_source: realDeviceId ? "real" : "random"
        };
    }

    async function check(scope, key) {
        if (!QR_KEY_PATTERN.test(String(key || ""))) {
            throw requestError(400, "netease_qr_key_invalid", "扫码登录会话编号无效，请重新生成二维码。");
        }
        const device = sessionDevice(String(key));
        // 对齐官方配方:client/login 同样不发送设备 Cookie。
        const { status, json, setCookies } = await weapiRequest(
            fetchImpl,
            "/weapi/login/qrcode/client/login",
            { type: "1", key: String(key) },
            ""
        );
        const code = Number(json?.code ?? status);
        ledgerPush(key, { at: new Date().toISOString(), code, status: code === 803 ? "confirmed" : code === 800 ? "expired" : code === 802 ? "scanned" : code === 8821 ? "risk_blocked" : "waiting", message: String(json?.message || "").slice(0, 120) });
        if (code === 803) {
            let cookies = parseSetCookies(setCookies);
            let cookieText = cookieHeader(cookies);
            if (!cookies.some(([name]) => name === "MUSIC_U")) {
                // 登录已确认但凭据没随响应返回:再访问一次首页让服务端补齐 Cookie。
                const home = await neteaseApiGet(fetchImpl, "/", cookieText);
                const extra = parseSetCookies(home.setCookies);
                if (extra.length > 0) {
                    const merged = new Map(cookies.map(([name, value]) => [name, value]));
                    for (const [name, value] of extra) merged.set(name, value);
                    cookies = Array.from(merged.entries());
                    cookieText = cookieHeader(cookies);
                }
            }
            if (!cookies.some(([name]) => name === "MUSIC_U")) {
                throw requestError(502, "netease_qr_cookie_missing", "登录已确认，但没有收到登录凭据，请重新扫码。");
            }
            if (!hasCredentialEncryption(env)) {
                throw requestError(503, "netease_qr_encryption_unconfigured", "服务器还没有配置凭据加密密钥，暂时不能保存网易云登录。");
            }
            const profile = await fetchProfile(cookieText);
            const ciphertext = encryptCredential(cookieText, env);
            const values = {
                user_id: scope.userId,
                companion_id: scope.companionId,
                netease_uid: profile.uid,
                nickname: profile.nickname,
                cookie_ciphertext: ciphertext,
                updated_at: new Date().toISOString()
            };
            const existing = await connectionRow(scope);
            const db = scope?.db || database;
            let saved = null;
            if (existing?.id) {
                const { data, error } = await db
                    .from("netease_qr_connections")
                    .update(values)
                    .eq("id", existing.id)
                    .select("*")
                    .single();
                if (error) throw error;
                saved = data;
            } else {
                const { data, error } = await db
                    .from("netease_qr_connections")
                    .insert({ ...values, created_at: new Date().toISOString() })
                    .select("*")
                    .single();
                if (error) throw error;
                saved = data;
            }
            return { status: "confirmed", connection: publicConnection(saved) };
        }
        if (code === 800) return { status: "expired" };
        if (code === 802) return { status: "scanned" };
        if (code === 8821) return { status: "risk_blocked", message: "网易云登录风控拦截，请稍后再试。" };
        if (code === 801 || json === null) return { status: "waiting", raw_code: code };
        return { status: "waiting", raw_code: code, message: String(json?.message || "").slice(0, 120) };
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
        if (!profile.uid) return { connected: false, reason: "expired" };
        return {
            connected: true,
            nickname: profile.nickname || cleanText(row.nickname, 80),
            uid: profile.uid || cleanText(row.netease_uid, 40)
        };
    }

    async function disconnect(scope) {
        const row = await connectionRow(scope);
        if (row?.id) {
            const { error } = await (scope?.db || database)
                .from("netease_qr_connections")
                .delete()
                .eq("id", row.id);
            if (error) throw error;
        }
        return { disconnected: true };
    }

    async function playlists(scope) {
        const cookie = await requireCookie(scope);
        const profile = await fetchProfile(cookie);
        if (!profile.uid) throw requestError(401, "netease_qr_session_expired", "网易云登录已过期，请重新登录。");
        const { json, status } = await neteaseApiGet(
            fetchImpl,
            `/api/user/playlist?uid=${encodeURIComponent(profile.uid)}&limit=1000&offset=0`,
            cookie
        );
        assertCookieStillValid(cookie, json, status);
        const rows = Array.isArray(json?.playlist) ? json.playlist : [];
        return rows
            .map((row) => ({
                provider_playlist_id: String(row?.id ?? ""),
                name: cleanText(row?.name, 180) || "未命名歌单",
                item_count: Math.min(2000, Math.max(0, Number(row?.trackCount ?? row?.track_count) || 0)),
                creator_nickname: cleanText(row?.creator?.nickname, 80),
                subscribed: row?.subscribed === true
            }))
            .filter((row) => DECIMAL_ID.test(row.provider_playlist_id));
    }

    async function myPlaylists(scope) {
        const lists = await playlists(scope);
        const owned = lists.filter((row) => row.subscribed !== true);
        const subscribed = lists.filter((row) => row.subscribed === true);
        return { owned, subscribed, total: lists.length };
    }

    async function removeFromPlaylist(scope, input = {}) {
        const cookie = await requireCookie(scope);
        const playlistId = decimalId(input.playlist_id, "netease_playlist_id_invalid");
        const ids = (Array.isArray(input.track_ids) ? input.track_ids : [input.track_ids])
            .map((value) => decimalId(value, "netease_track_id_invalid"))
            .slice(0, 100);
        if (ids.length === 0) throw requestError(400, "netease_track_ids_required", "请提供要移除的歌曲编号。");
        const { json, status } = await weapiRequest(
            fetchImpl,
            "/weapi/v1/playlist/manipulate/tracks",
            {
                trackIds: JSON.stringify(ids.map(Number)),
                pid: String(playlistId),
                op: "del",
                imme: "true"
            },
            cookie
        );
        assertCookieStillValid(cookie, json, status);
        if (Number(json?.code) !== 200) {
            throw requestError(502, "netease_playlist_remove_failed", String(json?.message || "移除失败。"));
        }
        return { removed: ids.length, playlist_id: playlistId };
    }

    async function playlistTracks(cookie, providerPlaylistId) {
        const { json, status } = await neteaseApiGet(
            fetchImpl,
            `/api/v6/playlist/detail?id=${decimalId(providerPlaylistId)}&n=${MAX_IMPORT_TRACKS}`,
            cookie
        );
        assertCookieStillValid(cookie, json, status);
        if (Number(json?.code) === 200 || json?.playlist) {
            const tracks = Array.isArray(json?.playlist?.tracks) ? json.playlist.tracks : [];
            const name = cleanText(json?.playlist?.name, 180) || `网易云歌单 ${providerPlaylistId}`;
            return {
                name,
                tracks: tracks.map(normalizeTrack).filter(Boolean).slice(0, MAX_IMPORT_TRACKS)
            };
        }
        const { json: fallback, status: fallbackStatus } = await neteaseApiGet(
            fetchImpl,
            `/api/playlist/detail?id=${decimalId(providerPlaylistId)}`,
            cookie
        );
        assertCookieStillValid(cookie, fallback, fallbackStatus);
        const tracks = Array.isArray(fallback?.playlist?.tracks) ? fallback.playlist.tracks : [];
        return {
            name: cleanText(fallback?.playlist?.name, 180) || `网易云歌单 ${providerPlaylistId}`,
            tracks: tracks.map(normalizeTrack).filter(Boolean).slice(0, MAX_IMPORT_TRACKS)
        };
    }

    async function resolveTrackUrls(cookie, tracks) {
        const resolved = new Map();
        for (let offset = 0; offset < tracks.length; offset += URL_RESOLVE_BATCH) {
            const batch = tracks.slice(offset, offset + URL_RESOLVE_BATCH);
            const ids = batch.map((track) => track.provider_track_id).join(",");
            const { json, status } = await neteaseApiGet(
                fetchImpl,
                `/api/song/enhance/player/url?ids=[${ids}]&br=320000`,
                cookie
            );
            assertCookieStillValid(cookie, json, status);
            const rows = Array.isArray(json?.data) ? json.data : [];
            rows.forEach((row) => {
                const id = String(row?.id ?? "");
                const url = typeof row?.url === "string" ? row.url : "";
                if (DECIMAL_ID.test(id)) resolved.set(id, url);
            });
        }
        return resolved;
    }

    async function importPlaylist(scope, input = {}) {
        const providerPlaylistId = decimalId(
            input.provider_playlist_id ?? input.id,
            "netease_playlist_id_invalid"
        );
        const cookie = await requireCookie(scope);
        const detail = await playlistTracks(cookie, providerPlaylistId);
        if (detail.tracks.length === 0) {
            throw requestError(400, "netease_playlist_empty", "这个歌单没有可读取的曲目，请换一个歌单。");
        }
        const urls = await resolveTrackUrls(cookie, detail.tracks);

        const items = detail.tracks.map((track, position) => {
            const url = urls.get(track.provider_track_id) || "";
            const playable = url.length > 0;
            return {
                playlist_id: null,
                position,
                provider_track_id: playable ? track.provider_track_id : track.provider_track_id,
                external_url: songUrl(track.provider_track_id),
                playback_mode: playable ? "netease_resolved" : "external_netease",
                url: playable ? url : null,
                title: track.title,
                artist: track.artist,
                album: track.album,
                cover_url: track.cover_url || "",
                duration_seconds: track.duration_seconds,
                lyrics: ""
            };
        });

        const db = scope?.db || database;
        const existing = await db
            .from("music_playlists")
            .select("id")
            .eq("provider", "netease")
            .eq("provider_playlist_id", providerPlaylistId)
            .maybeSingle();
        console.log("STEP existing done", existing.data?.id || "none");
        if (existing.error) { console.log("existing error", JSON.stringify(existing.error)); throw existing.error; }

        const values = {
            name: detail.name,
            provider: "netease",
            provider_playlist_id: providerPlaylistId,
            external_url: `https://music.163.com/#/playlist?id=${providerPlaylistId}`,
            source_format: "netease_mcp",
            item_count: items.length,
            updated_at: new Date().toISOString()
        };

        console.log("STEP before upsert");
        let playlistId = existing.data?.id || null;
        console.error("DBG playlistId", playlistId);
        if (playlistId) {
            console.error("DBG updating item", rows?.[0]?.id);
            const { error } = await db.from("music_playlists").update(values).eq("id", playlistId);
            if (error) throw error;
            const { error: wipeError } = await db
                .from("music_playlist_items")
                .delete()
                .eq("playlist_id", playlistId);
            if (wipeError) throw wipeError;
        } else {
            const { data, error } = await db
                .from("music_playlists")
                .insert(values)
                .select("id")
                .single();
            if (error) throw error;
            playlistId = data.id;
        }

        if (items.length > 0) {
            const { error } = await db
                .from("music_playlist_items")
                .insert(items.map((item) => ({ ...item, playlist_id: playlistId })));
            if (error) throw error;
        }

        const playableCount = items.filter((item) => item.playback_mode === "netease_resolved").length;
        const unavailableCount = items.length - playableCount;
        return {
            playlist_id: playlistId,
            name: detail.name,
            total: items.length,
            playable_count: playableCount,
            unavailable_count: unavailableCount
        };
    }

    async function refreshPlaylist(scope, input = {}) {
        const playlistId = String(input.playlist_id ?? "").trim();
        if (!playlistId) throw requestError(400, "music_playlist_id_required", "缺少歌单编号。");
        const cookie = await requireCookie(scope);
        const db = scope?.db || database;
        const { data: playlist, error } = await db
            .from("music_playlists")
            .select("id, provider_playlist_id")
            .eq("id", playlistId)
            .maybeSingle();
        if (error) throw error;
        if (!playlist?.provider_playlist_id) {
            throw requestError(400, "netease_refresh_not_netease", "只有网易云导入的歌单可以刷新直链。");
        }
        const { data: rows, error: itemsError } = await db
            .from("music_playlist_items")
            .select("id, provider_track_id, playback_mode")
            .eq("playlist_id", playlistId)
            .order("position", { ascending: true });
        if (itemsError) throw itemsError;

        const tracks = (rows || [])
            .filter((row) => DECIMAL_ID.test(String(row.provider_track_id || "")))
            .map((row) => ({ provider_track_id: String(row.provider_track_id), row }));
        const urls = await resolveTrackUrls(cookie, tracks);
        let refreshed = 0;
        let switched = 0;
        for (const { provider_track_id, row } of tracks) {
            const url = urls.get(provider_track_id) || "";
            if (!url) continue;
            const { error: updateError } = await db
                .from("music_playlist_items")
                .update({ url, playback_mode: "netease_resolved" })
                .eq("id", row.id);
            if (updateError) throw updateError;
            refreshed += 1;
            if (row.playback_mode !== "netease_resolved") switched += 1;
        }
        return { playlist_id: playlistId, refreshed, switched };
    }

    async function songUrl(scope, id) {
        const cookie = await requireCookie(scope);
        const { json, status } = await neteaseApiGet(
            fetchImpl,
            `/api/song/enhance/player/url?ids=[${decimalId(id)}]&br=320000`,
            cookie
        );
        assertCookieStillValid(cookie, json, status);
        const url = Array.isArray(json?.data) && typeof json.data[0]?.url === "string"
            ? json.data[0].url
            : "";
        return {
            provider_track_id: decimalId(id),
            url,
            expires_in_seconds: url ? 1200 : null,
            unavailable_reason: url ? null : "vip_or_license"
        };
    }

    // ---------- cloud_music_* 工具箱(对齐开源 MCP 生态,使用扫码登录 cookie) ----------

    async function search(scope, input = {}) {
        const keyword = cleanText(input.keyword, 80);
        if (!keyword) throw requestError(400, "netease_search_keyword_required", "请告诉我要搜什么歌。");
        const category = String(input.category || "song");
        const typeMap = { song: "1", album: "10", artist: "100", playlist: "1000", lyrics: "1006" };
        const type = typeMap[category] || "1";
        const limit = Math.min(30, Math.max(1, Number(input.limit) || 10));
        const { json, status } = await neteaseApiGet(
            fetchImpl,
            `/api/search/get?s=${encodeURIComponent(keyword)}&type=${type}&limit=${limit}`
        );
        assertCookieStillValid(null, json, status);
        const result = json?.result || {};
        if (category === "song") {
            const songs = Array.isArray(result.songs) ? result.songs : [];
            return {
                keyword,
                songs: songs.map(normalizeTrack).filter(Boolean).map((track) => ({
                    ...track,
                    album_id: ""
                }))
            };
        }
        if (category === "album") {
            return { keyword, albums: (Array.isArray(result.albums) ? result.albums : []).slice(0, limit).map((item) => ({
                album_id: String(item.id ?? ""),
                name: cleanText(item.name, 180),
                artist: cleanText(item.artist?.name ?? item.artists?.[0]?.name, 80),
                cover_url: String(item.picUrl || "")
            })) };
        }
        if (category === "artist") {
            return { keyword, artists: (Array.isArray(result.artists) ? result.artists : []).slice(0, limit).map((item) => ({
                artist_id: String(item.id ?? ""),
                name: cleanText(item.name, 80),
                cover_url: String(item.picUrl || "")
            })) };
        }
        return { keyword, playlists: (Array.isArray(result.playlists) ? result.playlists : []).slice(0, limit).map((item) => ({
            playlist_id: String(item.id ?? ""),
            name: cleanText(item.name, 180),
            track_count: Number(item.trackCount) || 0,
            cover_url: String(item.coverImgUrl || "")
        })) };
    }

    async function dailyRecommend(scope) {
        const cookie = await requireCookie(scope);
        const { json, status } = await weapiRequest(
            fetchImpl,
            "/weapi/v1/discovery/recommend/songs",
            {},
            cookie
        );
        assertCookieStillValid(cookie, json, status);
        const songs = Array.isArray(json?.data?.dailySongs) ? json.data.dailySongs : [];
        return {
            daily: songs.slice(0, 20).map(normalizeTrack).filter(Boolean).map((track, index) => ({
                ...track,
                recommend_reason: cleanText(songs[index]?.reason, 120)
            }))
        };
    }

    async function playlistDetail(scope, input = {}) {
        const cookie = await requireCookie(scope);
        const detail = await playlistTracks(cookie, decimalId(input.playlist_id, "netease_playlist_id_invalid"));
        return {
            name: detail.name,
            tracks: detail.tracks.slice(0, 30)
        };
    }

    async function createPlaylist(scope, input = {}) {
        const cookie = await requireCookie(scope);
        const name = cleanText(input.name, 60);
        if (!name) throw requestError(400, "netease_playlist_name_required", "请给歌单起个名字。");
        // EAPI 的 privacy 取值：0=公开，10=私密（1 会被拒，10 为接口约定值）。
        const privacy = input.privacy ? "10" : "0";
        // 明文 GET /api/playlist/create 在部分网络环境会被风控，改用桌面客户端 EAPI。
        const { json, status } = await eapiRequest(
            fetchImpl,
            "/eapi/playlist/create",
            { name, privacy },
            cookie
        );
        assertCookieStillValid(cookie, json, status);
        if (Number(json?.code) !== 200 || !json?.playlist?.id) {
            throw requestError(502, "netease_playlist_create_failed", String(json?.message || "歌单创建失败。"));
        }
        return { playlist_id: String(json.playlist.id), name: cleanText(json.playlist.name, 180) };
    }

    async function addToPlaylist(scope, input = {}) {
        const cookie = await requireCookie(scope);
        const playlistId = decimalId(input.playlist_id, "netease_playlist_id_invalid");
        const ids = (Array.isArray(input.track_ids) ? input.track_ids : [input.track_ids])
            .map((value) => decimalId(value, "netease_track_id_invalid"))
            .slice(0, 100);
        if (ids.length === 0) throw requestError(400, "netease_track_ids_required", "请提供要添加的歌曲编号。");
        // 对齐桌面客户端配方：weapi 加密的 manipulate/tracks。
        const { json, status } = await weapiRequest(
            fetchImpl,
            "/weapi/v1/playlist/manipulate/tracks",
            {
                trackIds: JSON.stringify(ids.map(Number)),
                pid: String(playlistId),
                op: "add",
                imme: "true"
            },
            cookie
        );
        assertCookieStillValid(cookie, json, status);
        if (Number(json?.code) === 502) {
            return { added: 0, note: "歌曲已在歌单中。" };
        }
        if (Number(json?.code) !== 200) {
            throw requestError(502, "netease_playlist_add_failed", String(json?.message || "添加失败。"));
        }
        return { added: ids.length, playlist_id: playlistId };
    }

    async function albumInfo(scope, input = {}) {
        const albumId = decimalId(input.album_id, "netease_album_id_invalid");
        // 旧 /api/album 已下线(404),使用新接口 /api/v1/album/:id。
        const { json } = await neteaseApiGet(
            fetchImpl,
            `/api/v1/album/${albumId}`,
            requireCookie(scope).catch(() => "")
        );
        const album = json?.album || {};
        if (!album?.name) {
            throw requestError(404, "netease_album_not_found", "没有找到这张专辑。");
        }
        return {
            album_id: albumId,
            name: cleanText(album.name, 180),
            artist: normalizeArtists(album.artists),
            publish_time: album.publishTime ? new Date(Number(album.publishTime)).toISOString().slice(0, 10) : "",
            cover_url: String(album.picUrl || ""),
            songs: (Array.isArray(json.songs) ? json.songs : []).map(normalizeTrack).filter(Boolean).slice(0, 30)
        };
    }

    async function artistInfo(scope, input = {}) {
        const artistId = decimalId(input.artist_id, "netease_artist_id_invalid");
        // 旧 /api/artists 已下线(404),使用新接口 /api/v1/artist/:id。
        const { json } = await neteaseApiGet(
            fetchImpl,
            `/api/v1/artist/${artistId}`,
            requireCookie(scope).catch(() => "")
        );
        const artist = json?.artist || {};
        if (!artist?.name) {
            throw requestError(404, "netease_artist_not_found", "没有找到这位歌手。");
        }
        const hotSongs = Array.isArray(json?.hotSongs)
            ? json.hotSongs
            : Array.isArray(artist?.hotSongs)
              ? artist.hotSongs
              : [];
        return {
            artist_id: artistId,
            name: cleanText(artist.name, 80),
            cover_url: String(artist.picUrl || artist.img1v1Url || ""),
            brief: cleanText(artist.briefDesc, 300),
            hot_songs: hotSongs.map(normalizeTrack).filter(Boolean).slice(0, 10)
        };
    }

    async function subscriptions(scope, input = {}) {
        const cookie = await requireCookie(scope);
        const category = input.category === "albums" ? "albums" : "artists";
        if (category === "albums") {
            const { json, status } = await neteaseApiGet(
                fetchImpl,
                "/api/album/sublist/list?limit=30&offset=0",
                cookie
            );
            assertCookieStillValid(cookie, json, status);
            return { albums: (Array.isArray(json?.data) ? json.data : []).map((item) => ({
                album_id: String(item.id ?? ""),
                name: cleanText(item.name, 180),
                artist: normalizeArtists(item.artists),
                cover_url: String(item.picUrl || "")
            })) };
        }
        const { json, status } = await neteaseApiGet(
            fetchImpl,
            "/api/artist/sublist?limit=30&offset=0",
            cookie
        );
        assertCookieStillValid(cookie, json, status);
        return { artists: (Array.isArray(json?.data) ? json.data : []).map((item) => ({
            artist_id: String(item.id ?? ""),
            name: cleanText(item.name, 80),
            cover_url: String(item.picUrl || item.img1v1Url || "")
        })) };
    }

    async function likeSong(scope, input = {}) {
        const cookie = await requireCookie(scope);
        const songId = decimalId(input.song_id, "netease_track_id_invalid");
        const like = input.like !== false;
        // 明文 GET /api/radio/like 从服务器 IP 会被风控拦截（"检测到您的网络环境存在风险"），
        // 改用桌面客户端 EAPI 端点 /eapi/song/like。
        const { json, status } = await eapiRequest(
            fetchImpl,
            "/eapi/song/like",
            {
                trackId: String(songId),
                userid: "0",
                like: String(like).toLowerCase(),
                e_r: "true"
            },
            cookie
        );
        assertCookieStillValid(cookie, json, status);
        if (Number(json?.code) !== 200) {
            throw requestError(502, "netease_like_failed", String(json?.message || "红心操作失败。"));
        }
        return { song_id: songId, liked: like };
    }

    async function playHistory(scope, input = {}) {
        const cookie = await requireCookie(scope);
        const limit = Math.min(50, Math.max(1, Number(input.limit) || 20));
        // 明文 /api/v1/play/record 不带 uid 会返回 400；用 weapi 或带 uid 的明文接口。
        let uid = "";
        try {
            const profile = await fetchProfile(cookie);
            uid = String(profile?.uid || "");
        } catch {
            uid = "";
        }
        const { json, status } = await weapiRequest(
            fetchImpl,
            "/weapi/v1/play/record",
            { uid, type: 0, limit },
            cookie
        );
        assertCookieStillValid(cookie, json, status);
        const records = Array.isArray(json?.allData) ? json.allData : [];
        return { records: records.slice(0, limit).map((row) => ({
            song: normalizeTrack(row.song),
            play_count: Number(row.playCount) || 0
        })).filter((row) => row.song) };
    }

    async function lyric(scope, id) {
        const cookie = await requireCookie(scope);
        const { json, status } = await neteaseApiGet(
            fetchImpl,
            `/api/song/lyric?id=${decimalId(id)}`,
            cookie
        );
        assertCookieStillValid(cookie, json, status);
        return {
            provider_track_id: decimalId(id),
            lyric: String(json?.lrc?.lyric || ""),
            translated_lyric: String(json?.tlyric?.lyric || "")
        };
    }

    async function diagnose(key) {
        return { key: String(key || ""), ledger: pollLedger.get(String(key)) || [] };
    }

    return {
        begin,
        check,
        diagnose,
        disconnect,
        importPlaylist,
        lyric,
        playlists,
        myPlaylists,
        removeFromPlaylist,
        addToPlaylist,
        albumInfo,
        playlistDetail,
        artistInfo,
        createPlaylist,
        dailyRecommend,
        likeSong,
        playHistory,
        refreshPlaylist,
        search,
        songUrl,
        status,
        subscriptions
    };
}

module.exports = {
    createNeteaseQrLoginService,
    decimalId,
    normalizeTrack
};
