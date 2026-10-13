const MAX_TRACKS = 500;
const DECIMAL_ID = /^\d{1,20}$/;
const NETEASE_PROVIDER_PROFILE = "netease_cloud_music";
const { fetchSongMetadata } = require("./netease-metadata");

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

function playlistUrl(id) {
    return `https://music.163.com/#/playlist?id=${decimalId(id)}`;
}

function songUrl(id) {
    return `https://music.163.com/#/song?id=${decimalId(id)}`;
}

function strictJson(text) {
    const source = String(text || "").trim();
    if (!source || !/^[\[{]/.test(source) || !/[\]}]$/.test(source)) return null;
    try {
        return JSON.parse(source);
    } catch {
        return null;
    }
}

function lineRecords(text) {
    const records = [];
    for (const rawLine of String(text || "").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const columns = line.includes("\t")
            ? line.split("\t")
            : line.includes("|")
              ? line.split("|")
              : line.split(/\s+-\s+/);
        if (columns.length < 2 || !DECIMAL_ID.test(columns[0].trim())) continue;
        records.push({
            id: columns[0].trim(),
            name: cleanText(columns[1], 300),
            artist: cleanText(columns[2], 300),
            album: cleanText(columns[3], 300),
            duration: columns[4]
        });
    }
    return records;
}

function playlistRecords(text) {
    const records = [];
    for (const rawLine of String(text || "").split(/\r?\n/)) {
        const line = rawLine.trim();
        const match = line.match(/^(?:❤️|👤|收藏)?\s*(.+?)\s+\(ID:\s*(\d{1,20}),\s*(\d{1,3})首\)$/u);
        if (!match) continue;
        records.push({ id: match[2], name: cleanText(match[1], 180), trackCount: Number(match[3]) });
    }
    return records;
}

function playlistDetailRecord(text, fallbackId) {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const heading = lines[0]?.match(/^📋\s*歌单:\s*(.+?)\s+\((\d{1,6})首\)$/u);
    if (!heading) return null;
    const tracks = [];
    for (const line of lines.slice(1)) {
        const match = line.match(/^\d{1,3}\.\s+(.+?)\s+-\s+(.+?)\s+\(ID:\s*(\d{1,20})\)$/u);
        if (!match) continue;
        tracks.push({ id: match[3], name: cleanText(match[1], 300), artist: cleanText(match[2], 300) });
    }
    return { id: fallbackId, name: cleanText(heading[1], 180), trackCount: Number(heading[2]), tracks };
}

function resultPayload(result) {
    if (result?.isError) {
        throw requestError(502, "netease_mcp_upstream_error", "网易云 MCP 返回执行失败。");
    }
    if (result?.structuredContent && typeof result.structuredContent === "object") {
        return result.structuredContent;
    }
    return strictJson(result?.text) ?? lineRecords(result?.text);
}

function findArray(value, names) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    for (const name of names) {
        if (Array.isArray(value[name])) return value[name];
    }
    if (value.data && typeof value.data === "object") return findArray(value.data, names);
    return [];
}

function normalizeArtists(value) {
    if (typeof value === "string") return cleanText(value, 300);
    const artists = Array.isArray(value) ? value : [];
    return cleanText(
        artists.map((artist) => typeof artist === "string" ? artist : artist?.name).filter(Boolean).join(" / "),
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
    const id = decimalId(row?.id ?? row?.song_id ?? row?.track_id, "netease_track_id_invalid");
    return {
        provider_track_id: id,
        title: cleanText(row?.name ?? row?.title, 300),
        artist: normalizeArtists(row?.artists ?? row?.ar ?? row?.artist),
        album: cleanText(row?.album?.name ?? row?.al?.name ?? row?.album, 300),
        duration_seconds: durationSeconds(row?.duration ?? row?.dt ?? row?.duration_seconds),
        external_url: songUrl(id),
        playback_mode: "external_netease"
    };
}

function normalizePlaylist(row, includeTracks = false) {
    const id = decimalId(
        row?.id ?? row?.playlist_id ?? row?.provider_playlist_id,
        "netease_playlist_id_invalid"
    );
    const playlist = {
        provider: "netease",
        provider_playlist_id: id,
        name: cleanText(row?.name ?? row?.title, 180) || "网易云歌单",
        item_count: Math.min(500, Math.max(0, Number(row?.trackCount ?? row?.item_count) || 0)),
        external_url: playlistUrl(id),
        source_format: "netease_mcp"
    };
    if (includeTracks) {
        const rows = findArray(row, ["tracks", "songs", "items"]);
        if (rows.length > MAX_TRACKS) {
            throw requestError(400, "music_item_limit", "每个歌单最多导入 500 首歌曲。");
        }
        playlist.items = rows.map(normalizeTrack);
        playlist.item_count = playlist.items.length;
    }
    return playlist;
}

function parseShareUrl(value) {
    const match = String(value || "").match(/https?:\/\/[^\s<>"']+/i);
    let parsed;
    try {
        parsed = new URL(String(match?.[0] || "").replace(/[，。；、!！?？)）\]]+$/, ""));
    } catch {
        throw requestError(400, "netease_share_url_invalid", "网易云歌单分享链接格式不正确。");
    }
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (
        parsed.protocol !== "https:" ||
        !(hostname === "music.163.com" || hostname.endsWith(".music.163.com"))
    ) {
        throw requestError(400, "netease_share_url_invalid", "仅支持网易云官方歌单或单曲分享链接。");
    }
    const hashMatch = parsed.hash.match(/#\/(playlist|song)\?[^#]*\bid=(\d+)/i);
    const pathMatch = parsed.pathname.match(/\/(?:m\/)?(playlist|song)(?:\/|$)/i);
    const resourceType = String(pathMatch?.[1] || hashMatch?.[1] || "").toLowerCase();
    const resourceId = decimalId(parsed.searchParams.get("id") || hashMatch?.[2], "netease_resource_id_invalid");
    if (!new Set(["playlist", "song"]).has(resourceType)) throw requestError(400, "netease_share_url_invalid", "仅支持网易云官方歌单或单曲分享链接。");
    return { resourceType, resourceId };
}

async function resolveShareUrl(value) {
    const match = String(value || "").match(/https?:\/\/[^\s<>"']+/i);
    let parsed;
    try { parsed = new URL(String(match?.[0] || "").replace(/[，。；、!！?？)）\]]+$/, "")); } catch { return parseShareUrl(value); }
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname !== "163cn.tv" && !hostname.endsWith(".163cn.tv")) return parseShareUrl(value);
    for (let redirects = 0; redirects < 5; redirects += 1) {
        let response;
        try { response = await fetch(parsed.href, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5000) }); } catch {
            throw requestError(400, "netease_short_url_unavailable", "网易云短链暂时无法展开，请粘贴展开后的官方链接。");
        }
        const location = response.headers.get("location");
        if (!location) break;
        parsed = new URL(location, parsed);
        const nextHost = parsed.hostname.toLowerCase().replace(/\.$/, "");
        if (!(nextHost === "163cn.tv" || nextHost.endsWith(".163cn.tv") || nextHost === "music.163.com" || nextHost.endsWith(".music.163.com"))) {
            throw requestError(400, "netease_short_url_invalid_redirect", "网易云短链跳转到了非官方地址，已停止导入。");
        }
        if (nextHost === "music.163.com" || nextHost.endsWith(".music.163.com")) return parseShareUrl(parsed.href);
    }
    throw requestError(400, "netease_short_url_unavailable", "网易云短链暂时无法展开，请粘贴展开后的官方链接。");
}

function createNeteaseCloudMusicService({ mcpDeviceCenter, cookieSession } = {}) {
    if (!mcpDeviceCenter?.forDatabase) throw new Error("netease music requires MCP device center");

    async function provision(scope, input = {}) {
        const name = cleanText(input.name, 80);
        if (!name) {
            throw requestError(400, "netease_mcp_name_required", "请填写网易云 MCP 的显示名称。");
        }
        const endpointValue = String(input.endpoint ?? "").trim();
        if (!endpointValue) {
            throw requestError(400, "netease_mcp_endpoint_required", "请填写公开 HTTPS /mcp 地址。");
        }
        let endpoint;
        try {
            endpoint = new URL(endpointValue);
        } catch {
            throw requestError(400, "netease_mcp_endpoint_invalid", "网易云 MCP 地址格式不正确。");
        }
        endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
        if (
            endpoint.protocol !== "https:" ||
            endpoint.username ||
            endpoint.password ||
            endpoint.hash
        ) {
            throw requestError(400, "netease_mcp_endpoint_invalid", "请填写完整的公开 HTTPS MCP 地址。");
        }
        endpoint.search = "";
        const token = String(input.token ?? "").trim();
        if (token.length > 4096) {
            throw requestError(400, "netease_mcp_token_too_long", "Bearer Token 最多 4096 个字符。");
        }
        if (/\b(?:Cookie|MUSIC_U|__csrf|NETEASE_COOKIE)\b/i.test(token)) {
            throw requestError(400, "netease_mcp_cookie_forbidden", "不能提交 Cookie 或网易云会话凭据，请使用自托管包装层的 Bearer Token。");
        }
        const center = mcpDeviceCenter.forDatabase(scope.db);
        const authType = token ? "bearer" : "none";
        const connectionDraft = {
            name,
            endpoint: endpoint.toString(),
            auth_type: authType,
            auth_header: "Authorization",
            credential: token,
            provider_profile: "auto",
            protocol_version: "auto"
        };
        const discovery = await center.discoverDraft(connectionDraft);
        if (discovery.provider_profile !== NETEASE_PROVIDER_PROFILE) {
            throw requestError(400, "netease_mcp_not_recognized", "接口已响应，但没有自动识别到完整的网易云音乐能力。");
        }
        const connection = await center.createConnection({
            ...connectionDraft,
            provider_profile: NETEASE_PROVIDER_PROFILE,
            protocol_version: discovery.protocol_version
        });
        const enabledConnection = await center.updateConnection(connection.id, {
            name,
            enabled: true,
            auth_type: authType,
            auth_header: "Authorization",
            provider_profile: NETEASE_PROVIDER_PROFILE,
            protocol_version: connection.protocol_version || discovery.protocol_version
        });
        return {
            ...enabledConnection,
            provisioning: {
                discovered: true,
                saved: true,
                enabled: enabledConnection.enabled === true,
                adapter_id: enabledConnection.adapter_id || connection.adapter_id || discovery.adapter_id || null,
                protocol_version: enabledConnection.protocol_version || connection.protocol_version || discovery.protocol_version,
                tool_count: Array.isArray(enabledConnection.discovered_tools)
                    ? enabledConnection.discovered_tools.length
                    : 0
            }
        };
    }

    const connect = provision;

    async function call(scope, connectionId, operation, args) {
        return mcpDeviceCenter
            .forDatabase(scope.db)
            .callConnectionTool(connectionId, operation, args);
    }

    async function status(scope, connectionId) {
        const result = await call(scope, connectionId, "status", {});
        const statusText = String(result?.text || "").trim();
        if (statusText.startsWith("已登录，当前用户:")) {
            return {
                available: true,
                logged_in: true,
                account_name: cleanText(statusText.slice("已登录，当前用户:".length), 100),
                account_id: null
            };
        }
        if (statusText.startsWith("未登录，请使用 cloud_music_login")) {
            return { available: true, logged_in: false, account_name: "", account_id: null };
        }
        const payload = resultPayload(result);
        const source = payload?.data && typeof payload.data === "object"
            ? payload.data
            : payload;
        return {
            available: source?.available !== false,
            logged_in: Boolean(source?.logged_in ?? source?.loggedIn ?? source?.authenticated),
            account_name: cleanText(source?.account_name ?? source?.nickname ?? source?.user?.nickname, 100),
            account_id: DECIMAL_ID.test(String(source?.account_id ?? source?.user_id ?? source?.user?.id ?? ""))
                ? String(source?.account_id ?? source?.user_id ?? source?.user?.id)
                : null
        };
    }

    async function playlists(scope, connectionId) {
        const result = await call(scope, connectionId, "my_playlists", {});
        const payload = resultPayload(result);
        const rows = findArray(payload, ["playlists", "items"]);
        const source = rows.length ? rows : playlistRecords(result?.text);
        return source.slice(0, 500).map((row) => normalizePlaylist(row));
    }

    async function playlistDetail(scope, connectionId, providerPlaylistId) {
        const id = decimalId(providerPlaylistId, "netease_playlist_id_invalid");
        const result = await call(scope, connectionId, "playlist_detail", { playlist_id: Number(id) });
        const text = String(result?.text || "").trim();
        if (/^(?:获取失败|未登录|搜索失败|创建失败|失败)/.test(text)) {
            throw requestError(502, "netease_playlist_detail_unavailable", "网易云歌单详情获取失败，请确认网易云 MCP 已登录且账号有效。");
        }
        const payload = resultPayload(result);
        const structured = payload?.playlist ?? payload?.data?.playlist ?? payload?.data;
        const row = structured && typeof structured === "object" && !Array.isArray(structured)
            ? structured
            : playlistDetailRecord(text, id) ?? payload;
        const playlist = normalizePlaylist({ ...row, id }, true);
        if (!playlist.items.length) {
            throw requestError(502, "netease_playlist_detail_empty", "未能从网易云读取到任何曲目，请确认歌单公开可见且网易云 MCP 已登录。");
        }
        return playlist;
    }

    async function search(scope, connectionId, query, limit = 20) {
        const keywords = cleanText(query, 120);
        if (!keywords) throw requestError(400, "netease_search_query_required", "请输入搜索关键词。");
        const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
        const payload = resultPayload(await call(scope, connectionId, "search", { keyword: keywords, category: "song" }));
        return findArray(payload, ["songs", "tracks", "items", "results"])
            .slice(0, safeLimit)
            .map(normalizeTrack);
    }

    async function savePlaylist(database, playlist) {
        let existing = await database
            .from("music_playlists")
            .select("id")
            .eq("provider", "netease")
            .eq("provider_playlist_id", playlist.provider_playlist_id)
            .maybeSingle();
        if (existing.error) throw existing.error;
        let playlistId = existing.data?.id;
        const values = {
            name: playlist.name,
            provider: "netease",
            provider_playlist_id: playlist.provider_playlist_id,
            external_url: playlist.external_url,
            source_format: playlist.source_format || "netease_mcp",
            item_count: playlist.items.length,
            updated_at: new Date().toISOString()
        };
        if (playlistId) {
            const refreshed = await database.rpc("refresh_netease_music_playlist_items", {
                p_playlist_id: playlistId,
                p_items: playlist.items
            });
            if (refreshed.error) throw refreshed.error;
            if (refreshed.data?.error) {
                throw requestError(
                    409,
                    refreshed.data.error.code || "music_playlist_refresh_conflict",
                    refreshed.data.error.message || "网易云歌单暂时无法刷新。"
                );
            }
            values.item_count = Number(refreshed.data?.item_count) || playlist.items.length;
            const updated = await database.from("music_playlists").update(values).eq("id", playlistId);
            if (updated.error) throw updated.error;
        } else {
            const inserted = await database.from("music_playlists").insert(values).select("id").single();
            if (inserted.error) throw inserted.error;
            playlistId = inserted.data.id;
        }
        const items = playlist.items.map((item, position) => ({
            playlist_id: playlistId,
            position,
            provider_track_id: item.provider_track_id,
            external_url: item.external_url,
            playback_mode: "external_netease",
            url: null,
            title: item.title,
            artist: item.artist,
            album: item.album,
            cover_url: item.cover_url || null,
            duration_seconds: item.duration_seconds,
            lyrics: ""
        }));
        if (!existing.data && items.length) {
            // 大歌单分块入库,避免单次插入超限
            for (let start = 0; start < items.length; start += 200) {
                const chunk = items.slice(start, start + 200);
                const insertedItems = await database.from("music_playlist_items").insert(chunk);
                if (insertedItems.error) throw insertedItems.error;
            }
        }
        return { id: playlistId, ...playlist, imported: true };
    }

    async function saveExternalResource(database, resource, cookie = "") {
        const isSong = resource.resourceType === "song";
        let songItem = null;
        let name = isSong ? `网易云单曲 ${resource.resourceId}` : `网易云歌单 ${resource.resourceId}`;
        if (isSong) {
            const meta = await fetchSongMetadata(resource.resourceId, globalThis.fetch, cookie);
            if (meta?.title) {
                name = `${meta.title} · ${meta.artist || "网易云音乐"}`;
                songItem = {
                    provider_track_id: resource.resourceId,
                    title: meta.title,
                    artist: meta.artist || "网易云音乐",
                    album: meta.album || "",
                    cover_url: meta.cover_url || null,
                    duration_seconds: meta.duration_seconds,
                    external_url: songUrl(resource.resourceId)
                };
            }
        }
        return savePlaylist(database, {
            provider_playlist_id: resource.resourceId,
            name,
            external_url: isSong ? songUrl(resource.resourceId) : playlistUrl(resource.resourceId),
            source_format: "netease_mcp",
            items: isSong
                ? [songItem || {
                      provider_track_id: resource.resourceId,
                      title: `网易云单曲 ${resource.resourceId}`,
                      artist: "网易云音乐",
                      album: "",
                      duration_seconds: null,
                      external_url: songUrl(resource.resourceId)
                  }]
                : []
        });
    }

    async function importShare(scope, input = {}) {
        const resource = await resolveShareUrl(input.share_url ?? input.url);
        if (resource.resourceType === "song") {
            const cookie = cookieSession
                ? String((await cookieSession.read(scope))?.cookie_text || "")
                : "";
            return saveExternalResource(scope.db, resource, cookie);
        }
        const connectionId = String(input.connection_id || "").trim();
        if (connectionId) {
            const playlist = await playlistDetail(scope, connectionId, resource.resourceId);
            return savePlaylist(scope.db, playlist);
        }
        if (cookieSession) {
            let session;
            let detail;
            try {
                session = await cookieSession.read(scope);
                if (session?.cookie_text) {
                    detail = await cookieSession.cookiePlaylistDetail(session.cookie_text, resource.resourceId);
                }
            } catch (error) {
                throw requestError(502, "netease_cookie_playlist_fetch_failed", "读取网易云歌单失败：" + String(error?.message || error?.code || "未知错误").slice(0, 200));
            }
            if (session?.cookie_text && detail?.tracks?.length) {
                try {
                    return await savePlaylist(scope.db, {
                        provider_playlist_id: detail.id,
                        name: detail.name || ("网易云歌单 " + detail.id),
                        external_url: playlistUrl(detail.id),
                        source_format: "netease_cookie",
                        items: detail.tracks.map((track) => ({
                            provider_track_id: track.id,
                            title: track.title,
                            artist: track.artist,
                            album: track.album,
                            duration_seconds: track.duration_seconds,
                            cover_url: track.cover_url,
                            external_url: songUrl(track.id)
                        }))
                    });
                } catch (error) {
                    throw requestError(502, "netease_cookie_playlist_save_failed", "歌单保存失败：" + String(error?.message || error?.code || "未知错误").slice(0, 200));
                }
            }
            if (session?.cookie_text) {
                throw requestError(502, "netease_cookie_playlist_unavailable", "歌单读取失败：网易云接口没有返回歌单内容，请稍后重试或换一个公开歌单链接。");
            }
        }
        throw requestError(400, "netease_connection_required", "导入网易云歌单需要先连接网易云 MCP 或完成 App 内一键登录。");
    }

    function externalPlayback(input = {}) {
        const type = cleanText(input.resource_type, 20).toLowerCase();
        if (!new Set(["song", "playlist"]).has(type)) {
            throw requestError(400, "netease_resource_type_invalid", "网易云资源类型不正确。");
        }
        const id = decimalId(input.resource_id);
        const webUrl = type === "song" ? songUrl(id) : playlistUrl(id);
        return {
            resource: { type, id },
            requires_user_gesture: true,
            web_url: webUrl,
            native_action: { type: "open_url", url: webUrl }
        };
    }

    return { connect, externalPlayback, importShare, playlistDetail, playlists, provision, search, status };
}

module.exports = {
    createNeteaseCloudMusicService,
    decimalId,
    parseShareUrl,
    playlistUrl,
    songUrl
};
