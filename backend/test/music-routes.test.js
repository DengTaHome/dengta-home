const assert = require("node:assert/strict");
const express = require("express");
const { createMusicRouter } = require("../routes/v2/music");
const { createRequestScope } = require("../services/request-scope");

const userId = "11111111-1111-4111-8111-111111111111";
const companionId = "22222222-2222-4222-8222-222222222222";
const playlistId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";

function scope() {
    const companion = { id: companionId, user_id: userId, status: "active" };
    return createRequestScope({
        adminSupabase: { from() { throw new Error("route service is stubbed"); } },
        user: { id: userId },
        profile: { id: userId, role: "owner", status: "active" },
        companions: [companion],
        companion
    });
}

async function main() {
    const calls = [];
    let failOperations = false;
    const failIfRequested = () => {
        if (!failOperations) return;
        throw Object.assign(new Error("music storage unavailable"), {
            status: 503,
            code: "music_storage_unavailable"
        });
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        if (req.headers.authorization === "Bearer valid") req.scope = scope();
        next();
    });
    app.use(
        "/api/v2/music",
        createMusicRouter({
            netease: {
                async connect(requestScope, body) {
                    failIfRequested();
                    calls.push(["connect-netease", requestScope.db, body]);
                    return {
                        id: "55555555-5555-4555-8555-555555555555",
                        name: body.name,
                        endpoint: body.endpoint,
                        enabled: true,
                        provider_profile: "netease_cloud_music",
                        auth_configured: true
                    };
                },
                async provision(requestScope, body) {
                    failIfRequested();
                    calls.push(["provision-netease", requestScope.db, body]);
                    return {
                        id: "66666666-6666-4666-8666-666666666666",
                        name: body.name,
                        enabled: true,
                        provider_profile: "netease_cloud_music",
                        provisioning: { discovered: true, saved: true, enabled: true, tool_count: 4 }
                    };
                },
                async status() { return { available: true }; },
                async playlists() { return []; },
                async playlistDetail() { return { items: [] }; },
                async search() { return []; },
                async importShare() { return { id: playlistId }; },
                externalPlayback() { return { web_url: "https://music.163.com/#/song?id=1" }; }
            },
            async importPlaylist(database, body) {
                failIfRequested();
                calls.push(["import", database, body]);
                return { id: playlistId, name: body.name };
            },
            async listPlaylists(database) {
                failIfRequested();
                calls.push(["list", database]);
                return [{ id: playlistId }];
            },
            async readPlaylist(database, id) {
                failIfRequested();
                calls.push(["read", database, id]);
                return { id, items: [] };
            },
            async deletePlaylist(database, id) {
                failIfRequested();
                calls.push(["delete", database, id]);
                return { id };
            },
            async listFavorites(database) {
                failIfRequested();
                calls.push(["list-favorites", database]);
                return [{ item_id: itemId }];
            },
            async putFavorite(database, id) {
                failIfRequested();
                calls.push(["put-favorite", database, id]);
                return { item_id: id, favorited_at: "2026-08-14T09:00:00Z" };
            },
            async deleteFavorite(database, id) {
                failIfRequested();
                calls.push(["delete-favorite", database, id]);
                return { item_id: id, favorited: false };
            }
        })
    );
    app.use((error, _req, res, _next) =>
        res.status(error.status || 500).json({ code: error.code, message: error.message })
    );
    const server = await new Promise((resolve) => {
        const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const base = `http://127.0.0.1:${server.address().port}/api/v2/music/playlists`;
    try {
        assert.equal((await fetch(base)).status, 401);
        const headers = { Authorization: "Bearer valid", "Content-Type": "application/json" };
        const imported = await fetch(`${base}/import`, {
            method: "POST",
            headers,
            body: JSON.stringify({ name: "歌单", content: "https://audio.example/song" })
        });
        assert.equal(imported.status, 201);
        assert.match(imported.headers.get("cache-control"), /no-store/);
        assert.equal((await fetch(base, { headers })).status, 200);
        assert.equal((await fetch(`${base}/${playlistId}`, { headers })).status, 200);
        assert.equal(
            (await fetch(`${base}/${playlistId}`, { method: "DELETE", headers })).status,
            200
        );
        const favoritesBase = base.replace(/\/playlists$/, "/favorites");
        const favorites = await fetch(favoritesBase, { headers });
        assert.deepEqual(await favorites.json(), { favorites: [{ item_id: itemId }] });
        const favorite = await fetch(`${favoritesBase}/${itemId}`, { method: "PUT", headers });
        assert.equal((await favorite.json()).favorite.item_id, itemId);
        const deletedFavorite = await fetch(`${favoritesBase}/${itemId}`, { method: "DELETE", headers });
        assert.deepEqual(await deletedFavorite.json(), { deleted: { item_id: itemId, favorited: false } });
        const connectionResponse = await fetch(base.replace(/\/playlists$/, "/providers/netease/connections"), {
            method: "POST",
            headers,
            body: JSON.stringify({
                name: "我的网易云 MCP",
                endpoint: "https://music.example.com/mcp",
                token: "wrapper-token"
            })
        });
        assert.equal(connectionResponse.status, 201);
        const connectionBody = await connectionResponse.json();
        assert.equal(connectionBody.connection.name, "我的网易云 MCP");
        assert.equal(connectionBody.connection.provider_profile, "netease_cloud_music");
        assert.equal("token" in connectionBody.connection, false, "响应不得泄露 Token");
        const provisionResponse = await fetch(base.replace(/\/playlists$/, "/providers/netease/connections/provision"), {
            method: "POST",
            headers,
            body: JSON.stringify({ name: "一步连接", endpoint: "https://music.example.com/mcp", token: "wrapper-token" })
        });
        assert.equal(provisionResponse.status, 201);
        assert.deepEqual((await provisionResponse.json()).connection.provisioning, {
            discovered: true, saved: true, enabled: true, tool_count: 4
        });
        assert.deepEqual(calls.map((call) => call[0]), ["import", "list", "read", "delete", "list-favorites", "put-favorite", "delete-favorite", "connect-netease", "provision-netease"]);
        assert.equal(calls.every((call) => typeof call[1].from === "function"), true);

        failOperations = true;
        const failureRequests = [
            [base, { headers }],
            [`${base}/${playlistId}`, { headers }],
            [`${base}/${playlistId}`, { method: "DELETE", headers }],
            [`${base}/import`, { method: "POST", headers, body: "{}" }],
            [favoritesBase, { headers }],
            [`${favoritesBase}/${itemId}`, { method: "PUT", headers, body: "{}" }],
            [`${favoritesBase}/${itemId}`, { method: "DELETE", headers }],
            [base.replace(/\/playlists$/, "/providers/netease/connections"), { method: "POST", headers, body: "{}" }],
            [base.replace(/\/playlists$/, "/providers/netease/connections/provision"), { method: "POST", headers, body: "{}" }]
        ];
        for (const [url, options] of failureRequests) {
            const response = await fetch(url, options);
            assert.equal(response.status, 503);
            assert.deepEqual(await response.json(), {
                code: "music_storage_unavailable",
                message: "music storage unavailable"
            });
        }
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
    console.log("music v2 route and RequestScope tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
