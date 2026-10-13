const assert = require("node:assert/strict");
const express = require("express");
const { createPrivateMediaRouter } = require("../routes/v2/private-media");
const { createRequestScope } = require("../services/request-scope");

const userId = "11111111-1111-4111-8111-111111111111";
const companionId = "22222222-2222-4222-8222-222222222222";
const assetId = "33333333-3333-4333-8333-333333333333";

function scope() {
    const admin = { from() { throw new Error("service stub should handle route call"); } };
    const companion = { id: companionId, user_id: userId, status: "active" };
    return createRequestScope({
        adminSupabase: admin,
        user: { id: userId },
        profile: { id: userId, role: "owner", status: "active" },
        companions: [companion], companion
    });
}

async function main() {
    const seen = [];
    const service = {
        async catalog(requestScope) { seen.push(["catalog", requestScope.userId]); return { assets: [], preferences: {} }; },
        async setPreference(requestScope, purpose, id) { seen.push(["preference", requestScope.companionId, purpose, id]); return { purpose, asset_id: id }; },
        async updateAsset(requestScope, id, body) { seen.push(["update", id, body.alt_text]); return { id, alt_text: body.alt_text }; },
        async archiveAsset(requestScope, id) { seen.push(["archive", id]); return { id, status: "archived" }; },
        async deleteAssetPermanently(requestScope, passedStorage, id) {
            assert.equal(requestScope.userId, userId); assert.equal(passedStorage, storage);
            seen.push(["permanent", id]); return { id, deleted: true };
        },
        async downloadAsset(requestScope, storage, id) { seen.push(["content", id]); return { buffer: Buffer.from("webp"), mimeType: "image/webp", etag: "abc" }; }
    };
    const storage = { from() { return {}; } };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.scope = scope(); next(); });
    app.use("/api/v2/private-media", createPrivateMediaRouter({ storage, service }));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ code: error.code, message: error.message }));
    const server = await new Promise((resolve) => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
    const base = `http://127.0.0.1:${server.address().port}/api/v2/private-media`;
    try {
        const catalog = await fetch(`${base}/catalog`);
        assert.equal(catalog.status, 200);
        assert.match(catalog.headers.get("cache-control"), /no-store/);
        assert.deepEqual(await catalog.json(), { ok: true, assets: [], preferences: {} });
        const preference = await fetch(`${base}/preferences`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose: "chat_background", asset_id: assetId }) });
        assert.equal(preference.status, 200);
        const patched = await fetch(`${base}/assets/${assetId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ alt_text: "背景" }) });
        assert.equal((await patched.json()).asset.alt_text, "背景");
        const archived = await fetch(`${base}/assets/${assetId}`, { method: "DELETE" });
        assert.equal((await archived.json()).asset.status, "archived");
        const deleted = await fetch(`${base}/assets/${assetId}?permanent=true`, { method: "DELETE" });
        assert.equal(deleted.status, 200);
        assert.equal((await deleted.json()).asset.deleted, true);
        const content = await fetch(`${base}/assets/${assetId}/content`);
        assert.equal(content.headers.get("content-type"), "image/webp");
        assert.equal(await content.text(), "webp");
        assert.deepEqual(seen.map((item) => item[0]), ["catalog", "preference", "update", "archive", "permanent", "content"]);
    } finally { await new Promise((resolve) => server.close(resolve)); }
    console.log("private media v2 route contract tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
