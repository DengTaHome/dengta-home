const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createEcosystemRouter } = require("../routes/v2/ecosystem");
const {
    listProviders,
    providerById,
    validateProviderOperation
} = require("../services/companion-ecosystem-providers");
const { createRequestScope } = require("../services/request-scope");

const providerIds = [
    "custom_sticker",
    "user_avatar",
    "companion_avatar",
    "chat_background",
    "local_playlist",
    "netease",
    "generic_mcp",
    "direct_https",
    "cast_receiver",
    "chromecast",
    "dlna",
    "mcp_generic",
    "xiaohongshu_mcp"
];
const plannedIds = [
    "netease",
    "chromecast",
    "dlna",
    "xiaohongshu_mcp"
];

const providers = listProviders();
assert.deepEqual(providers.map(({ id }) => id), providerIds);
assert.deepEqual(
    providers.filter(({ status }) => status === "planned").map(({ id }) => id),
    plannedIds
);
assert.equal(providers.every(({ userConsentRequired }) => userConsentRequired), true);
assert.equal(providerById("netease").authType, "oauth");
assert.equal(providerById("netease").connectionStatus, "unconnected");
assert.equal(providerById("netease").officialOnly, true);
assert.deepEqual(providerById("netease").capabilities, ["playlists", "player"]);
assert.equal(providerById("local_playlist").status, "ready");
assert.equal(providerById("direct_https").status, "ready");
assert.equal(validateProviderOperation("direct_https", "player").ok, true);
assert.equal(providerById("generic_mcp").authType, "mcp");
assert.equal(providerById("mcp_generic").authType, "mcp");
assert.equal(providerById("missing"), null);
assert.doesNotMatch(JSON.stringify(providers), /secret|token|password/i);

providers[0].capabilities.push("mutated");
assert.equal(providerById("custom_sticker").capabilities.includes("mutated"), false);

assert.deepEqual(validateProviderOperation("unknown", "open"), {
    ok: false,
    error: {
        code: "PROVIDER_NOT_FOUND",
        message: "The requested ecosystem provider does not exist."
    }
});
assert.equal(
    validateProviderOperation("netease", "player").error.code,
    "PROVIDER_NOT_READY"
);
assert.equal(
    validateProviderOperation("generic_mcp", "unsupported").error.code,
    "CAPABILITY_NOT_SUPPORTED"
);
assert.deepEqual(validateProviderOperation("generic_mcp", "player"), {
    ok: true,
    provider: providerById("generic_mcp"),
    capability: "player"
});

function requestScope() {
    const userId = "11111111-1111-4111-8111-111111111111";
    const companionId = "22222222-2222-4222-8222-222222222222";
    const companion = {
        id: companionId,
        user_id: userId,
        status: "active"
    };
    return createRequestScope({
        adminSupabase: { from() {} },
        user: { id: userId },
        profile: { id: userId, role: "member", status: "active" },
        companions: [companion],
        companion
    });
}

async function withServer(callback) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        if (req.headers.authorization === "Bearer valid") {
            req.scope = requestScope();
        }
        next();
    });
    app.use("/api/v2/ecosystem", createEcosystemRouter());
    app.use((error, req, res, next) => {
        void req;
        void next;
        res.status(error.status || 500).json({
            code: error.code,
            message: error.message
        });
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await callback(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

(async () => {
    await withServer(async (baseUrl) => {
        const unauthorized = await fetch(`${baseUrl}/api/v2/ecosystem/providers`);
        assert.equal(unauthorized.status, 401);
        assert.equal((await unauthorized.json()).code, "authentication_required");

        const response = await fetch(`${baseUrl}/api/v2/ecosystem/providers`, {
            headers: { Authorization: "Bearer valid" }
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        const registry = await response.json();
        assert.deepEqual(registry.providers, listProviders());
        assert.doesNotMatch(JSON.stringify(registry), /secret|token|password/i);

        const ready = await fetch(
            `${baseUrl}/api/v2/ecosystem/providers/generic_mcp/check`,
            {
                method: "POST",
                headers: {
                    Authorization: "Bearer valid",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ capability: "player" })
            }
        );
        assert.equal(ready.status, 200);
        assert.equal((await ready.json()).ok, true);

        const planned = await fetch(
            `${baseUrl}/api/v2/ecosystem/providers/netease/check`,
            {
                method: "POST",
                headers: {
                    Authorization: "Bearer valid",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ capability: "player" })
            }
        );
        assert.equal(planned.status, 409);
        assert.equal((await planned.json()).error.code, "PROVIDER_NOT_READY");
    });
    console.log("ecosystem provider tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
