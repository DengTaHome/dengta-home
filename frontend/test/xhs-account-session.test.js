import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { backendTestRoot } from "./helpers/backend-test-root.js";
const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const requireBackend = createRequire(path.join(backendTestRoot({ frontendRoot, requiredFiles: ["package.json", "test/helpers/xhs-sticker-fixture.js", "services/xhs-sticker-import.js", "routes/v2/private-media.js"] }), "package.json"));
const express = requireBackend("express");
const { fixture } = requireBackend("./test/helpers/xhs-sticker-fixture.js");
const { createXhsStickerImportService } = requireBackend("./services/xhs-sticker-import.js");
const { createPrivateMediaRouter } = requireBackend("./routes/v2/private-media.js");
test("an external XHS login failure crosses the real API layer without expiring the DengTa session", async () => {
  const saved = new Map(["window", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])), fetcher = globalThis.fetch;
  const f = await fixture(); let server;
  const vite = await createServer({ envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  try {
    const service = createXhsStickerImportService({ ...f.options, xhsClient: { forScope: () => ({ stickerSource: async () => { throw Object.assign(Error("fictional-private-credential"), { code: "cookie_expired", status: 401 }); } }) } });
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.scope = f.scope(); next(); });
    app.use("/api/v2/private-media", createPrivateMediaRouter({ storage: f.storage, xhsStickerImports: service }));
    app.use((error, _req, res, next) => { void next; res.status(error.status || 500).json({ code: error.code, message: "fixture external login expired" }); });
    server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    let invalidations = 0, genuineFailure = false;
    const auth = { getSnapshot: () => ({ user: { id: "fictional-user" }, activeCompanionId: "fictional-companion" }), getRequestContext: async () => ({}), captureCompanionFromResponse() {}, invalidateSession() { invalidations++; } };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url, options) => {
      if (genuineFailure) return new Response(JSON.stringify({ code: "invalid_session", message: "fixture auth expired" }), { status: 401 });
      const target = new URL(url); return fetcher(`http://127.0.0.1:${server.address().port}${target.pathname}${target.search}`, options);
    } });
    const { apiRequest } = await vite.ssrLoadModule("/src/api.js");
    const { readOperationFailures } = await vite.ssrLoadModule("/src/operation-diagnostics.js");
    await assert.rejects(apiRequest("/api/v2/private-media/sticker-import/xhs", { method: "POST", retry: false, authSession: auth, body: JSON.stringify({ note_id: "111111111111111111111111", client_request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) }), error => error.code === "cookie_expired" && error.status === 409);
    assert.equal(invalidations, 0);
    const diagnostics = readOperationFailures(JSON.stringify(["fictional-user", "fictional-companion"]));
    assert.equal(diagnostics[0].code, "DT-STICKER-IMPORT"); assert.equal(diagnostics[0].reasonCode, "cookie_expired"); assert.ok(!JSON.stringify(diagnostics).includes("fictional-private-credential"));
    genuineFailure = true;
    await assert.rejects(apiRequest("/api/v2/private-media/sticker-import/xhs", { retry: false, authSession: auth }), error => error.code === "invalid_session" && error.status === 401);
    assert.ok(invalidations > 0, "real DengTa auth failures must still invalidate the app session");
  } finally {
    for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    await vite.close(); if (server) await new Promise(resolve => server.close(resolve)); await f.db.close();
  }
});
