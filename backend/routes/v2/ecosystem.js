const express = require("express");
const { requireRequestScope } = require("../../services/request-scope");
const {
    listProviders,
    validateProviderOperation
} = require("../../services/companion-ecosystem-providers");

const ERROR_STATUS = Object.freeze({
    PROVIDER_NOT_FOUND: 404,
    PROVIDER_NOT_READY: 409,
    CAPABILITY_NOT_SUPPORTED: 400
});

function createEcosystemRouter() {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try {
            requireRequestScope(req);
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get("/providers", (req, res) => {
        res.json({ providers: listProviders() });
    });

    router.post("/providers/:id/check", (req, res) => {
        const result = validateProviderOperation(
            req.params.id,
            req.body?.capability
        );
        if (!result.ok) {
            return res
                .status(ERROR_STATUS[result.error.code] || 400)
                .json(result);
        }
        return res.json(result);
    });

    return router;
}

module.exports = {
    createEcosystemRouter
};
