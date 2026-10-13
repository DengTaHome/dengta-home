const assert = require("node:assert/strict");
const {
    MAX_IMPORT_BYTES,
    deleteFavorite,
    deletePlaylist,
    importPlaylist,
    listFavorites,
    listPlaylists,
    normalizePublicHttpsUrl,
    parsePlaylistImport,
    putFavorite,
    readPlaylist
} = require("../services/music-listening");
const { createNeteaseCloudMusicService } = require("../services/netease-cloud-music");

const json = parsePlaylistImport({
    format: "json",
    name: "深夜歌单",
    content: {
        items: [
            {
                url: "https://cdn.example.com/audio?id=1#ignored",
                title: "成人歌曲标题：欲望午夜",
                artist: "某歌手",
                album: "现场版",
                duration: 189.4,
                lyrics: "这是成人歌词元数据，fuck 与性爱字样必须原样保留。"
            }
        ]
    }
});
assert.equal(json.name, "深夜歌单");
assert.equal(json.items[0].url, "https://cdn.example.com/audio?id=1");
assert.equal(json.items[0].duration_seconds, 189);
assert.match(json.items[0].title, /欲望午夜/);
assert.match(json.items[0].lyrics, /fuck 与性爱/);

const m3u = parsePlaylistImport({
    format: "m3u8",
    content: "#EXTM3U\n#EXTINF:123,歌手甲 - 歌曲甲\nhttps://media.example.org/play/one\n"
});
assert.equal(m3u.source_format, "m3u");
assert.deepEqual(m3u.items[0], {
    url: "https://media.example.org/play/one",
    title: "歌曲甲",
    artist: "歌手甲",
    album: "",
    duration_seconds: 123,
    lyrics: ""
});

const tab = parsePlaylistImport({
    format: "tab",
    content: "https://audio.example.net/stream\t歌名\t歌手\t专辑\t42\t歌词"
});
assert.equal(tab.items[0].title, "歌名");
assert.equal(tab.items[0].artist, "歌手");
assert.equal(tab.items[0].lyrics, "歌词");
assert.equal(
    parsePlaylistImport({ content: "https://audio.example.net/no-extension" }).items[0].url,
    "https://audio.example.net/no-extension"
);

for (const url of [
    "http://audio.example.com/song",
    "https://user:pass@audio.example.com/song",
    "https://localhost/song",
    "https://127.0.0.1/song",
    "https://10.0.0.1/song",
    "https://192.168.1.2/song",
    "https://[::1]/song",
    "https://host.local/song",
    "https://host.lan/song",
    "https://music.163.com/song?id=1",
    "https://www.youtube.com/watch?v=1"
]) {
    assert.throws(() => normalizePublicHttpsUrl(url), /URL|地址|HTTPS|网页/);
}
assert.equal(
    normalizePublicHttpsUrl("https://203.0.113.20/live?id=1"),
    "https://203.0.113.20/live?id=1"
);
assert.throws(
    () => parsePlaylistImport({ content: "x".repeat(MAX_IMPORT_BYTES + 1) }),
    (error) => error?.status === 413 && error?.code === "music_import_too_large"
);
assert.throws(
    () =>
        parsePlaylistImport({
            format: "json",
            content: Array.from({ length: 501 }, (_, index) =>
                `https://audio.example.com/${index}`
            )
        }),
    (error) => error?.code === "music_item_limit"
);

const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "services", "music-listening.js"),
    "utf8"
);
assert.doesNotMatch(source, /\bfetch\s*\(/);
assert.doesNotMatch(source, /https?\.request\s*\(/);

function resultBuilder(result, log = []) {
    const builder = {
        select(columns) { log.push(["select", columns]); return builder; },
        eq(column, value) { log.push(["eq", column, value]); return builder; },
        order(column, options) { log.push(["order", column, options]); return Promise.resolve(result); },
        in(column, values) { log.push(["in", column, values]); return Promise.resolve(result); },
        maybeSingle() { return Promise.resolve(result); },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); }
    };
    return builder;
}

async function testFavorites() {
    const itemId = "11111111-1111-4111-8111-111111111111";
    const playlistId = "22222222-2222-4222-8222-222222222222";
    const queryLog = [];
    const database = {
        from(table) {
            if (table === "music_favorites") {
                return {
                    select(columns) {
                        queryLog.push([table, "select", columns]);
                        return resultBuilder({
                            data: [{ item_id: itemId, created_at: "2026-08-14T09:00:00Z" }],
                            error: null
                        }, queryLog);
                    }
                };
            }
            assert.equal(table, "music_playlist_items");
            return resultBuilder({
                data: [{ id: itemId, playlist_id: playlistId, title: "夜航", artist: "桃桃", album: "灯塔", duration_seconds: "188" }],
                error: null
            }, queryLog);
        }
    };
    assert.deepEqual(await listFavorites(database), [{
        item_id: itemId,
        playlist_id: playlistId,
        title: "夜航",
        artist: "桃桃",
        album: "灯塔",
        duration_seconds: 188,
        favorited_at: "2026-08-14T09:00:00Z"
    }]);
    assert.deepEqual(queryLog.find((entry) => entry[0] === "in"), ["in", "id", [itemId]]);

    const emptyDatabase = {
        from(table) {
            assert.equal(table, "music_favorites");
            return { select() { return resultBuilder({ data: [], error: null }); } };
        }
    };
    assert.deepEqual(await listFavorites(emptyDatabase), []);

    let favoriteInsert = { data: { item_id: itemId, created_at: "2026-08-14T10:00:00Z" }, error: null };
    const writeDatabase = {
        from(table) {
            if (table === "music_playlist_items") {
                return resultBuilder({ data: { id: itemId, playlist_id: playlistId, title: "夜航", artist: "桃桃", album: "", duration_seconds: null }, error: null });
            }
            assert.equal(table, "music_favorites");
            return {
                insert(value) {
                    assert.deepEqual(value, { item_id: itemId });
                    return resultBuilder(favoriteInsert);
                },
                select() {
                    return resultBuilder({ data: { item_id: itemId, created_at: "2026-08-14T08:00:00Z" }, error: null });
                },
                delete() {
                    return resultBuilder({ data: null, error: null });
                }
            };
        }
    };
    const created = await putFavorite(writeDatabase, itemId);
    assert.equal(created.favorited_at, "2026-08-14T10:00:00Z");
    assert.equal(created.duration_seconds, null);

    favoriteInsert = { data: null, error: { code: "23505" } };
    const replayed = await putFavorite(writeDatabase, itemId);
    assert.equal(replayed.favorited_at, "2026-08-14T08:00:00Z");
    assert.deepEqual(await deleteFavorite(writeDatabase, itemId), { item_id: itemId, favorited: false });

    await assert.rejects(
        () => putFavorite({ from() { return resultBuilder({ data: null, error: null }); } }, itemId),
        (error) => error?.status === 404 && error?.code === "music_item_not_found"
    );
    await assert.rejects(
        () => deleteFavorite(writeDatabase, "not-a-uuid"),
        (error) => error?.status === 400 && error?.code === "music_item_id_invalid"
    );

    const storageError = Object.assign(new Error("storage failed"), { code: "storage_failed" });
    await assert.rejects(
        () => listFavorites({ from() { return { select() { return resultBuilder({ data: null, error: storageError }); } }; } }),
        storageError
    );
    await assert.rejects(
        () => listFavorites({
            from(table) {
                if (table === "music_favorites") return { select() { return resultBuilder({ data: [{ item_id: itemId, created_at: "2026-08-14T09:00:00Z" }], error: null }); } };
                return resultBuilder({ data: null, error: storageError });
            }
        }),
        storageError
    );
    await assert.rejects(
        () => putFavorite({ from() { return resultBuilder({ data: null, error: storageError }); } }, itemId),
        storageError
    );
    await assert.rejects(
        () => putFavorite({
            from(table) {
                if (table === "music_playlist_items") return resultBuilder({ data: { id: itemId, playlist_id: playlistId }, error: null });
                return { insert() { return resultBuilder({ data: null, error: storageError }); } };
            }
        }, itemId),
        storageError
    );
    await assert.rejects(
        () => putFavorite({
            from(table) {
                if (table === "music_playlist_items") return resultBuilder({ data: { id: itemId, playlist_id: playlistId }, error: null });
                return {
                    insert() { return resultBuilder({ data: null, error: { code: "23505" } }); },
                    select() { return resultBuilder({ data: null, error: storageError }); }
                };
            }
        }, itemId),
        storageError
    );
    await assert.rejects(
        () => deleteFavorite({ from() { return { delete() { return resultBuilder({ data: null, error: storageError }); } }; } }, itemId),
        storageError
    );
}

async function testPlaylistPersistence() {
    const playlistId = "22222222-2222-4222-8222-222222222222";
    const itemId = "11111111-1111-4111-8111-111111111111";
    const calls = [];
    const playlist = {
        id: playlistId,
        name: "夜航歌单",
        source_format: "text",
        item_count: 1,
        created_at: "2026-08-14T08:00:00Z",
        updated_at: "2026-08-14T09:00:00Z"
    };
    const item = {
        id: itemId,
        position: 0,
        url: "https://audio.example.com/night.mp3",
        title: "夜航",
        artist: "桃桃",
        album: "灯塔",
        duration_seconds: 188,
        lyrics: "向着灯塔",
        created_at: "2026-08-14T08:00:00Z"
    };

    function terminal(result) {
        const builder = {
            select(columns) { calls.push(["select", columns]); return builder; },
            eq(column, value) { calls.push(["eq", column, value]); return builder; },
            order(column, options) { calls.push(["order", column, options]); return Promise.resolve(result); },
            maybeSingle() { return Promise.resolve(result); },
            single() { return Promise.resolve(result); },
            then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); }
        };
        return builder;
    }

    let itemInsertError = null;
    let playlistSelectCount = 0;
    const database = {
        from(table) {
            calls.push(["from", table]);
            if (table === "music_playlist_items") {
                return {
                    insert(values) {
                        calls.push(["insert-items", values]);
                        return Promise.resolve({ data: null, error: itemInsertError });
                    },
                    select() {
                        return terminal({ data: [item], error: null });
                    }
                };
            }
            if (table === "co_watch_sessions") {
                return {
                    select() {
                        const builder = terminal({ data: [], error: null });
                        builder.limit = (value) => {
                            calls.push(["limit", value]);
                            return Promise.resolve({ data: [], error: null });
                        };
                        return builder;
                    },
                    update(value) {
                        calls.push(["detach", value]);
                        return terminal({ data: null, error: null });
                    }
                };
            }
            if (table === "music_playback_queue_items") {
                return {
                    select() {
                        const builder = terminal({ data: [], error: null });
                        builder.limit = (value) => {
                            calls.push(["queue-limit", value]);
                            return Promise.resolve({ data: [], error: null });
                        };
                        return builder;
                    }
                };
            }
            assert.equal(table, "music_playlists");
            return {
                insert(value) {
                    calls.push(["insert-playlist", value]);
                    return terminal({ data: playlist, error: null });
                },
                select() {
                    playlistSelectCount += 1;
                    return terminal({ data: playlistSelectCount === 1 ? [{ ...playlist, music_playlist_items: [{ count: 1 }] }] : playlist, error: null });
                },
                delete() {
                    calls.push(["delete-playlist"]);
                    return terminal({ data: { id: playlistId }, error: null });
                }
            };
        }
    };

    const imported = await importPlaylist(database, {
        name: "夜航歌单",
        format: "text",
        content: "https://audio.example.com/night.mp3\t夜航\t桃桃\t灯塔\t188\t向着灯塔"
    });
    assert.equal(imported.id, playlistId);
    assert.deepEqual(imported.items, [{
        position: 0,
        url: "https://audio.example.com/night.mp3",
        title: "夜航",
        artist: "桃桃",
        album: "灯塔",
        duration_seconds: 188,
        lyrics: "向着灯塔"
    }]);
    assert.equal(calls.find((entry) => entry[0] === "insert-playlist")[1].item_count, 1);

    assert.deepEqual(await listPlaylists(database), [{ ...playlist, saved_item_count: 1, save_state: "ready" }]);
    const read = await readPlaylist(database, playlistId.toUpperCase());
    assert.equal(read.id, playlistId);
    assert.deepEqual(read.items, [item]);
    assert.deepEqual(await deletePlaylist(database, playlistId), { id: playlistId });
    assert.deepEqual(calls.find((entry) => entry[0] === "detach"), ["detach", { playlist_id: null, playlist_item_id: null }]);

    const storageError = new Error("item insert failed");
    itemInsertError = storageError;
    await assert.rejects(
        () => importPlaylist(database, { content: "https://audio.example.com/fail.mp3" }),
        storageError
    );
    assert.ok(calls.filter((entry) => entry[0] === "delete-playlist").length >= 2, "失败导入应清理已创建歌单");

    await assert.rejects(
        () => readPlaylist({ from() { return { select() { return resultBuilder({ data: null, error: null }); } }; } }, playlistId),
        (error) => error?.status === 404 && error?.code === "music_playlist_not_found"
    );
    await assert.rejects(
        () => deletePlaylist({
            from(table) {
                assert.equal(table, "co_watch_sessions");
                return {
                    select() {
                        const builder = resultBuilder({ data: [{ id: "active-session" }], error: null });
                        builder.limit = () => Promise.resolve({ data: [{ id: "active-session" }], error: null });
                        return builder;
                    }
                };
            }
        }, playlistId),
        (error) => error?.status === 409 && error?.code === "music_playlist_active"
    );
    await assert.rejects(
        () => deletePlaylist({
            from(table) {
                const rows = table === "music_playback_queue_items" ? [{ id: "queued-item" }] : [];
                return {
                    select() {
                        const builder = resultBuilder({ data: rows, error: null });
                        builder.limit = () => Promise.resolve({ data: rows, error: null });
                        return builder;
                    }
                };
            }
        }, playlistId),
        (error) => error?.status === 409 && error?.code === "music_playlist_queued"
    );
}

async function testCustomNeteaseMcpConnection() {
    const calls = [];
    const center = {
        async discoverDraft(input) {
            calls.push(["discover", input]);
            return {
                provider_profile: "netease_cloud_music",
                adapter_id: "cloud_music_mcp",
                protocol_version: "2024-11-05"
            };
        },
        async createConnection(input) {
            calls.push(["create", input]);
            return {
                id: "55555555-5555-4555-8555-555555555555",
                provider_profile: "netease_cloud_music",
                adapter_id: "cloud_music_mcp",
                protocol_version: "2024-11-05"
            };
        },
        async updateConnection(id, input) {
            calls.push(["update", id, input]);
            return {
                id,
                name: input.name,
                endpoint: "https://music.example.com/mcp",
                enabled: input.enabled,
                provider_profile: input.provider_profile,
                adapter_id: "cloud_music_mcp",
                protocol_version: "2024-11-05",
                auth_configured: true
            };
        }
    };
    const service = createNeteaseCloudMusicService({
        mcpDeviceCenter: {
            forDatabase(database) {
                assert.equal(database.marker, "tenant-database");
                return center;
            }
        }
    });
    const connected = await service.connect(
        { db: { marker: "tenant-database" } },
        {
            name: "  我的   网易云 MCP  ",
            endpoint: "https://music.example.com/custom/mcp/?ignored=yes",
            token: "wrapper-token"
        }
    );
    assert.deepEqual(connected, {
        id: "55555555-5555-4555-8555-555555555555",
        name: "我的 网易云 MCP",
        endpoint: "https://music.example.com/mcp",
        enabled: true,
        provider_profile: "netease_cloud_music",
        adapter_id: "cloud_music_mcp",
        protocol_version: "2024-11-05",
        auth_configured: true,
        provisioning: { discovered: true, saved: true, enabled: true, adapter_id: "cloud_music_mcp", protocol_version: "2024-11-05", tool_count: 0 }
    });
    assert.deepEqual(calls[0], ["discover", {
        name: "我的 网易云 MCP",
        endpoint: "https://music.example.com/custom/mcp",
        auth_type: "bearer",
        auth_header: "Authorization",
        credential: "wrapper-token",
        provider_profile: "auto",
        protocol_version: "auto"
    }]);
    assert.equal(calls[1][0], "create");
    assert.equal(calls[1][1].provider_profile, "netease_cloud_music");
    assert.equal(calls[1][1].protocol_version, "2024-11-05");
    assert.equal(calls[2][0], "update");
    assert.equal(calls[2][2].enabled, true);
    assert.equal(calls[2][2].provider_profile, "netease_cloud_music");
    assert.equal(calls[2][2].protocol_version, "2024-11-05");

    const noAuthCalls = [];
    const noAuthService = createNeteaseCloudMusicService({
        mcpDeviceCenter: {
            forDatabase() {
                return {
                    async discoverDraft(input) {
                        noAuthCalls.push(["discover", input]);
                        return { provider_profile: "netease_cloud_music", adapter_id: "netease_music_compatible", protocol_version: "2025-03-26" };
                    },
                    async createConnection(input) {
                        noAuthCalls.push(["create", input]);
                        return { id: "no-auth", provider_profile: "netease_cloud_music", protocol_version: "2025-03-26" };
                    },
                    async updateConnection(id, input) {
                        noAuthCalls.push(["update", id, input]);
                        return { id, name: input.name, enabled: true, provider_profile: "netease_cloud_music", protocol_version: input.protocol_version, discovered_tools: [] };
                    }
                };
            }
        }
    });
    const noAuth = await noAuthService.provision({ db: {} }, { name: "无鉴权接口", endpoint: "https://music.example.com/custom" });
    assert.equal(noAuth.provisioning.adapter_id, "netease_music_compatible");
    assert.equal(noAuthCalls[0][1].auth_type, "none");
    assert.equal(noAuthCalls[1][1].credential, "");

    const unrecognizedService = createNeteaseCloudMusicService({
        mcpDeviceCenter: { forDatabase() { return { async discoverDraft() { return { provider_profile: null }; } }; } }
    });
    await assert.rejects(
        () => unrecognizedService.provision({ db: {} }, { name: "通用接口", endpoint: "https://generic.example.com/api" }),
        (error) => error?.code === "netease_mcp_not_recognized"
    );

    const invalidCases = [
        [{ endpoint: "https://music.example.com/mcp", token: "token" }, "netease_mcp_name_required"],
        [{ name: "MCP", token: "token" }, "netease_mcp_endpoint_required"],
        [{ name: "MCP", endpoint: "not-a-url", token: "token" }, "netease_mcp_endpoint_invalid"],
        [{ name: "MCP", endpoint: "http://music.example.com/mcp", token: "token" }, "netease_mcp_endpoint_invalid"],
        [{ name: "MCP", endpoint: "https://user:password@music.example.com/mcp", token: "token" }, "netease_mcp_endpoint_invalid"],
        [{ name: "MCP", endpoint: "https://music.example.com/mcp#secret", token: "token" }, "netease_mcp_endpoint_invalid"],
        [{ name: "MCP", endpoint: "https://music.example.com/mcp", token: "x".repeat(4097) }, "netease_mcp_token_too_long"],
        [{ name: "MCP", endpoint: "https://music.example.com/mcp", token: "NETEASE_COOKIE=secret" }, "netease_mcp_cookie_forbidden"]
    ];
    for (const [input, code] of invalidCases) {
        await assert.rejects(
            () => service.connect({ db: { marker: "tenant-database" } }, input),
            (error) => error?.status === 400 && error?.code === code,
            code
        );
    }
    assert.equal(calls.length, 3, "非法输入不得进入 MCP 设备中心");
}

async function testCustomNeteaseMcpOperations() {
    const toolCalls = [];
    let toolResult = null;
    const database = { marker: "tenant-database" };
    const service = createNeteaseCloudMusicService({
        mcpDeviceCenter: {
            forDatabase(selectedDatabase) {
                assert.equal(selectedDatabase, database);
                return {
                    async callConnectionTool(connectionId, operation, args) {
                        toolCalls.push({ connectionId, operation, args });
                        return toolResult;
                    }
                };
            }
        }
    });
    const scope = { db: database };

    toolResult = { text: "已登录，当前用户: 桃桃" };
    assert.deepEqual(await service.status(scope, "connection-1"), {
        available: true,
        logged_in: true,
        account_name: "桃桃",
        account_id: null
    });
    toolResult = { text: "未登录，请使用 cloud_music_login 完成授权" };
    assert.equal((await service.status(scope, "connection-1")).logged_in, false);
    toolResult = { structuredContent: { data: { available: true, authenticated: true, nickname: "小灯", user_id: "12345" } } };
    assert.deepEqual(await service.status(scope, "connection-1"), {
        available: true,
        logged_in: true,
        account_name: "小灯",
        account_id: "12345"
    });
    toolResult = { text: "{invalid-json}" };
    assert.deepEqual(await service.status(scope, "connection-1"), {
        available: true,
        logged_in: false,
        account_name: "",
        account_id: null
    });

    toolResult = { structuredContent: { playlists: [{ id: "88", name: "夜航", trackCount: 2 }] } };
    assert.deepEqual(await service.playlists(scope, "connection-1"), [{
        provider: "netease",
        provider_playlist_id: "88",
        name: "夜航",
        item_count: 2,
        external_url: "https://music.163.com/#/playlist?id=88",
        source_format: "netease_mcp"
    }]);
    toolResult = { text: "❤️ 我的收藏 (ID: 99, 12首)" };
    assert.equal((await service.playlists(scope, "connection-1"))[0].provider_playlist_id, "99");
    toolResult = { structuredContent: { data: { items: [{ playlist_id: "100", title: "清晨", item_count: 3 }] } } };
    assert.equal((await service.playlists(scope, "connection-1"))[0].name, "清晨");

    toolResult = { structuredContent: { playlist: {
        id: "88",
        name: "夜航",
        tracks: [{ id: "101", name: "星海", artists: [{ name: "桃桃" }], album: { name: "灯塔" }, duration_seconds: 188 }]
    } } };
    const detail = await service.playlistDetail(scope, "connection-1", "88");
    assert.equal(detail.items[0].provider_track_id, "101");
    assert.equal(detail.items[0].artist, "桃桃");
    assert.equal(detail.items[0].duration_seconds, 188);
    assert.equal(detail.items[0].playback_mode, "external_netease");
    toolResult = { text: "📋 歌单: 文本歌单 (1首)\n1. 晚风 - 小灯 (ID: 103)" };
    const textDetail = await service.playlistDetail(scope, "connection-1", "89");
    assert.equal(textDetail.name, "文本歌单");
    assert.equal(textDetail.items[0].provider_track_id, "103");
    assert.equal(textDetail.items[0].duration_seconds, null);

    toolResult = { text: "获取失败: 未登录，请先调用 login 工具" };
    await assert.rejects(
        () => service.playlistDetail(scope, "connection-1", "91"),
        (error) => error?.status === 502 && error?.code === "netease_playlist_detail_unavailable"
    );
    toolResult = { text: "📋 歌单: 空歌单 (0首)" };
    await assert.rejects(
        () => service.playlistDetail(scope, "connection-1", "92"),
        (error) => error?.status === 502 && error?.code === "netease_playlist_detail_empty"
    );

    toolResult = { structuredContent: { playlist: {
        id: "90",
        tracks: Array.from({ length: 501 }, (_, index) => ({ id: String(index + 1), name: `歌曲 ${index + 1}` }))
    } } };
    await assert.rejects(
        () => service.playlistDetail(scope, "connection-1", "90"),
        (error) => error?.code === "music_item_limit"
    );

    toolResult = { text: "102\t海风\t小灯\t夏夜\t201" };
    const searched = await service.search(scope, "connection-1", "  海风  ", 100);
    assert.equal(searched.length, 1);
    assert.equal(searched[0].title, "海风");
    assert.deepEqual(toolCalls.at(-1), {
        connectionId: "connection-1",
        operation: "search",
        args: { keyword: "海风", category: "song" }
    });
    await assert.rejects(
        () => service.search(scope, "connection-1", "   "),
        (error) => error?.code === "netease_search_query_required"
    );
    toolResult = { isError: true };
    await assert.rejects(
        () => service.playlists(scope, "connection-1"),
        (error) => error?.status === 502 && error?.code === "netease_mcp_upstream_error"
    );

    assert.deepEqual(service.externalPlayback({ resource_type: "song", resource_id: "101" }), {
        resource: { type: "song", id: "101" },
        requires_user_gesture: true,
        web_url: "https://music.163.com/#/song?id=101",
        native_action: { type: "open_url", url: "https://music.163.com/#/song?id=101" }
    });
    assert.equal(service.externalPlayback({ resource_type: "playlist", resource_id: "88" }).resource.type, "playlist");
    assert.throws(
        () => service.externalPlayback({ resource_type: "album", resource_id: "88" }),
        (error) => error?.code === "netease_resource_type_invalid"
    );
    assert.throws(
        () => service.externalPlayback({ resource_type: "song", resource_id: "not-decimal" }),
        (error) => error?.code === "netease_resource_id_invalid"
    );
}

async function testCustomNeteaseMcpImport() {
    const writes = [];
    let existingPlaylistId = null;
    let rpcResponse = null;
    let toolResult = { structuredContent: { playlist: {
        id: "88",
        name: "夜航",
        tracks: [{ id: "101", name: "星海", artist: "桃桃", album: "灯塔", duration_seconds: 188 }]
    } } };
    function terminal(result) {
        const chain = {
            select() { return chain; },
            eq() { return chain; },
            maybeSingle() { return Promise.resolve(result); },
            single() { return Promise.resolve(result); },
            then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); }
        };
        return chain;
    }
    const database = {
        async rpc(name, parameters) {
            writes.push(["rpc", name, parameters]);
            return rpcResponse || { data: { item_count: toolResult.structuredContent.playlist.tracks.length }, error: null };
        },
        from(table) {
            if (table === "music_playlists") return {
                select() { return terminal({ data: existingPlaylistId ? { id: existingPlaylistId } : null, error: null }); },
                insert(values) {
                    writes.push(["insert-playlist", values]);
                    return terminal({ data: { id: "66666666-6666-4666-8666-666666666666" }, error: null });
                },
                update(values) {
                    writes.push(["update-playlist", values]);
                    return terminal({ data: null, error: null });
                }
            };
            assert.equal(table, "music_playlist_items");
            return {
                insert(values) { writes.push(["insert-items", values]); return Promise.resolve({ data: null, error: null }); },
                delete() { writes.push(["delete-items"]); return terminal({ data: null, error: null }); }
            };
        }
    };
    const service = createNeteaseCloudMusicService({
        mcpDeviceCenter: {
            forDatabase(selectedDatabase) {
                assert.equal(selectedDatabase, database);
                return { async callConnectionTool(connectionId, operation, args) {
                    assert.equal(connectionId, "connection-1");
                    assert.equal(operation, "playlist_detail");
                    assert.deepEqual(args, { playlist_id: 88 });
                    return toolResult;
                } };
            }
        }
    });
    const imported = await service.importShare({ db: database }, {
        connection_id: "connection-1",
        share_url: "https://music.163.com/playlist?id=88"
    });
    assert.equal(imported.id, "66666666-6666-4666-8666-666666666666");
    assert.equal(imported.imported, true);
    assert.equal(writes.find((entry) => entry[0] === "insert-items")[1][0].url, null);
    assert.equal(writes.find((entry) => entry[0] === "insert-items")[1][0].playback_mode, "external_netease");

    existingPlaylistId = null;
    const song = await service.importShare({ db: database }, {
        share_url: "分享单曲 https://music.163.com/song?id=364757&uct2=tracking"
    });
    assert.equal(song.provider_playlist_id, "364757");
    assert.equal(song.items[0].provider_track_id, "364757");
    assert.equal(song.items[0].external_url, "https://music.163.com/#/song?id=364757");

    await assert.rejects(
        () => service.importShare({ db: database }, { share_url: "https://music.163.com/playlist?id=88" }),
        (error) => error?.status === 400 && error?.code === "netease_connection_required"
    );

    existingPlaylistId = "77777777-7777-4777-8777-777777777777";
    await service.importShare({ db: database }, {
        connection_id: "connection-1",
        share_url: "https://m.music.163.com/m/playlist?id=88"
    });
    assert.ok(writes.some((entry) => entry[0] === "update-playlist"));
    assert.deepEqual(writes.find((entry) => entry[0] === "rpc").slice(1, 3), [
        "refresh_netease_music_playlist_items",
        {
            p_playlist_id: "77777777-7777-4777-8777-777777777777",
            p_items: [{
                provider_track_id: "101", title: "星海", artist: "桃桃", album: "灯塔",
                duration_seconds: 188, external_url: "https://music.163.com/#/song?id=101",
                playback_mode: "external_netease"
            }]
        }
    ]);
    rpcResponse = { data: { error: {} }, error: null };
    await assert.rejects(
        () => service.importShare({ db: database }, { connection_id: "connection-1", share_url: "https://music.163.com/playlist?id=88" }),
        (error) => error?.status === 409 && error?.code === "music_playlist_refresh_conflict" && error?.message === "网易云歌单暂时无法刷新。"
    );
    rpcResponse = { data: null, error: new Error("rpc unavailable") };
    await assert.rejects(
        () => service.importShare({ db: database }, { connection_id: "connection-1", share_url: "https://music.163.com/playlist?id=88" }),
        /rpc unavailable/
    );
    rpcResponse = null;
    await assert.rejects(
        () => service.importShare({ db: database }, { connection_id: "connection-1", share_url: "https://evil.example/playlist?id=88" }),
        (error) => error?.code === "netease_share_url_invalid"
    );
    await assert.rejects(
        () => service.importShare({ db: database }, { connection_id: "connection-1", share_url: "not-a-url" }),
        (error) => error?.code === "netease_share_url_invalid"
    );
}

testPlaylistPersistence()
    .then(testFavorites)
    .then(testCustomNeteaseMcpConnection)
    .then(testCustomNeteaseMcpOperations)
    .then(testCustomNeteaseMcpImport)
    .then(() => {
    console.log("music listening parser, URL safety and favorites tests passed");
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
