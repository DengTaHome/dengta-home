"use strict";

const express = require("express");
const { requireRequestScope } = require("../../services/request-scope");
const worldBook = require("../../services/world-book");

function optionalBoolean(value, field) {
    if (value === undefined) return undefined;
    if (value === "true") return true;
    if (value === "false") return false;
    throw worldBook.worldBookError(400, `world_book_${field}_invalid`, `${field} 无效。`);
}

function createWorldBookRouter(service = worldBook) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try { requireRequestScope(req); next(); } catch (error) { next(error); }
    });
    router.get("/", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ ok: true, ...(await service.listWorldBookEntries(scope.db, {
                search: req.query.search,
                enabled: optionalBoolean(req.query.enabled, "enabled"),
                constant: optionalBoolean(req.query.constant, "constant"),
                position: req.query.position,
                limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
                offset: req.query.offset === undefined ? undefined : Number(req.query.offset)
            })) });
        } catch (error) { next(error); }
    });
    router.post("/", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.status(201).json({ ok: true, entry: await service.createWorldBookEntry(scope.db, req.body) });
        } catch (error) { next(error); }
    });
    router.post("/reorder", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ ok: true, entries: await service.reorderWorldBookEntries(scope.db, req.body) });
        } catch (error) { next(error); }
    });
    router.patch("/:id", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ ok: true, entry: await service.updateWorldBookEntry(scope.db, req.params.id, req.body) });
        } catch (error) { next(error); }
    });
    router.delete("/:id", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ ok: true, deleted: true, id: await service.deleteWorldBookEntry(scope.db, req.params.id) });
        } catch (error) { next(error); }
    });
    return router;
}

module.exports = { createWorldBookRouter };
