const express = require("express");
const { requireRequestScope } = require("../services/request-scope");

function sendExternalMemoryError(res, error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) {
        // Log only the stable error code. Upstream bodies, URLs and
        // credentials are intentionally excluded.
        console.error(
            "External memory request failed:",
            error?.code || "EXTERNAL_MEMORY_ERROR"
        );
    }
    res.status(status).json({
        ok: false,
        error: error?.code || "EXTERNAL_MEMORY_ERROR",
        code: error?.code || "EXTERNAL_MEMORY_ERROR",
        upstream_status: Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : undefined,
        message:
            error?.message ||
            "外部记忆暂时无法完成请求。 / External memory could not complete the request."
    });
}

function createExternalMemoryRouter({ createCenter } = {}) {
    if (typeof createCenter !== "function") {
        throw new Error("external memory router requires a center factory");
    }
    const router = express.Router();

    router.use((req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            req.externalMemoryCenter = createCenter(scope);
            res.set("Cache-Control", "private, no-store");
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get("/connections", async (req, res) => {
        try {
            res.json({
                ok: true,
                connections:
                    await req.externalMemoryCenter.listConnections()
            });
        } catch (error) {
            sendExternalMemoryError(res, error);
        }
    });

    router.post("/connections/test", async (req, res) => {
        try {
            res.json({
                ok: true,
                result: await req.externalMemoryCenter.testDraft(
                    req.body || {}
                )
            });
        } catch (error) {
            sendExternalMemoryError(res, error);
        }
    });

    router.put("/connections/:connectionType", async (req, res) => {
        try {
            res.json({
                ok: true,
                connection:
                    await req.externalMemoryCenter.upsertConnection(
                        req.params.connectionType,
                        req.body || {}
                    )
            });
        } catch (error) {
            sendExternalMemoryError(res, error);
        }
    });

    router.post("/connections/:connectionType/test", async (req, res) => {
        try {
            res.json({
                ok: true,
                result: await req.externalMemoryCenter.testSaved(
                    req.params.connectionType
                )
            });
        } catch (error) {
            sendExternalMemoryError(res, error);
        }
    });

    router.get(
        "/connections/supabase_memory/preview",
        async (req, res) => {
            try {
                const result =
                    await req.externalMemoryCenter.previewSupabase({
                        limit: req.query.limit,
                        query: req.query.query
                    });
                res.json({
                    ok: true,
                    result,
                    items: result.memories,
                    total: result.record_count
                });
            } catch (error) {
                sendExternalMemoryError(res, error);
            }
        }
    );

    router.post(
        "/connections/supabase_memory/import",
        async (req, res) => {
            try {
                res.json({
                    ok: true,
                    result:
                        await req.externalMemoryCenter.importSupabase(
                            req.body || {}
                        )
                });
            } catch (error) {
                sendExternalMemoryError(res, error);
            }
        }
    );

    router.delete("/connections/:connectionType", async (req, res) => {
        try {
            res.json({
                ok: true,
                ...(await req.externalMemoryCenter.deleteConnection(
                    req.params.connectionType
                ))
            });
        } catch (error) {
            sendExternalMemoryError(res, error);
        }
    });

    return router;
}

module.exports = {
    createExternalMemoryRouter,
    sendExternalMemoryError
};
