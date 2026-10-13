"use strict";

// 工作区管理 REST 路由：为前端「工作区」页面提供浏览/读取/写入/删除/统计能力。
// 数据源与 AI 工具完全一致（services/workspace.js + Supabase Storage user-workspace 桶），
// 因此用户在手机会话里看到的文件，就是模型通过 workspace_* 工具读写的那份文件。

const express = require("express");
const { requireRequestScope } = require("../../services/request-scope");
const {
    deleteWorkspaceFile,
    isWorkspaceFolder,
    listWorkspace,
    readWorkspaceFile,
    writeWorkspaceFile
} = require("../../services/workspace");
const { buildUserAgentsMd } = require("../../services/ai-service");

const MAX_STATS_WALK_DEPTH = 2;
const MAX_STATS_ITEMS = 500;

function parseJsonBody(value) {
    if (value && typeof value === "object") return value;
    try { return JSON.parse(String(value || "{}")); } catch { return {}; }
}

// 有界递归统计目录（求和文件数/字节，限制遍历深度与条目数防止超时）
async function collectStats(storage, bucket, prefix, depth, counters) {
    if (depth > MAX_STATS_WALK_DEPTH || counters.items >= MAX_STATS_ITEMS) {
        counters.partial = true;
        return;
    }
    let offset = 0;
    while (counters.items < MAX_STATS_ITEMS) {
        const { data, error } = await storage
            .from(bucket)
            .list(prefix.replace(/\/$/, ""), { limit: 200, offset, sortBy: { column: "name", order: "asc" } });
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error("workspace statistics returned an invalid listing");
        for (const item of data) {
            if (counters.items >= MAX_STATS_ITEMS) { counters.partial = true; return; }
            counters.items += 1;
            if (isWorkspaceFolder(item)) {
                await collectStats(storage, bucket, `${prefix.replace(/\/$/, "")}/${item.name.replace(/\/$/, "")}`, depth + 1, counters);
            } else {
                counters.files += 1;
                counters.bytes += Math.max(0, Number(item.metadata?.size || 0));
            }
        }
        if (data.length < 200) return;
        offset += data.length;
    }
    counters.partial = true;
}

function createWorkspaceRouter({ storage, getSettings = null } = {}) {
    if (!storage || typeof storage.from !== "function") {
        throw new Error("workspace router requires storage");
    }
    const router = express.Router();
    router.use((req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try { requireRequestScope(req); next(); } catch (error) { next(error); }
    });

    // 列出目录
    router.get("/tree", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await listWorkspace({
                storage,
                userId: scope.userId,
                path: String(req.query?.path || "")
            });
            res.json(result);
        } catch (error) { next(error); }
    });

    // 读取文件
    router.get("/file", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await readWorkspaceFile({
                storage,
                userId: scope.userId,
                path: String(req.query?.path || "")
            });
            res.json(result);
        } catch (error) { next(error); }
    });

    // 写文件（新建/覆盖/追加；覆盖已存在文件需 confirm=true，与 AI 工具行为一致）
    router.put("/file", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const body = parseJsonBody(req.body);
            const result = await writeWorkspaceFile({
                storage,
                userId: scope.userId,
                path: String(body.path || ""),
                content: String(body.content ?? ""),
                mode: String(body.mode || "overwrite"),
                confirm: body.confirm === true
            });
            res.json(result);
        } catch (error) { next(error); }
    });

    // 删除文件（与 AI 工具一致：必须先确认）
    router.delete("/file", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await deleteWorkspaceFile({
                storage,
                userId: scope.userId,
                path: String(req.query?.path || ""),
                confirm: req.query?.confirm === "true" || req.query?.confirm === true
            });
            res.json(result);
        } catch (error) { next(error); }
    });

    // 统计与位置说明
    router.get("/stats", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const counters = { files: 0, bytes: 0, items: 0, partial: false };
            await collectStats(storage, "user-workspace", `${scope.userId}/`, 0, counters);
            res.json({
                ok: true,
                bucket: "user-workspace",
                prefix: `${scope.userId}/`,
                location: "云端用户工作区（Supabase Storage，user-workspace 桶）",
                files: counters.files,
                bytes: counters.bytes,
                scannedItems: counters.items,
                partial: counters.partial
            });
        } catch (error) { next(error); }
    });

    // agents.md 注入预览（与每轮注入到对话的内容一致）
    if (typeof getSettings === "function") {
        router.get("/agents-md", async (req, res, next) => {
            try {
                const scope = requireRequestScope(req);
                const settings = await getSettings(scope.db);
                const { data: memoryRows, error: memoryError } = await scope.db
                    .from("memories")
                    .select("summary, updated_at")
                    .order("updated_at", { ascending: false })
                    .limit(5);
                if (memoryError) throw memoryError;
                const agentsMd = buildUserAgentsMd({
                    settings,
                    memories: memoryRows || []
                });
                res.json({
                    ok: true,
                    file: "agents.md",
                    chars: agentsMd.length,
                    content: agentsMd
                });
            } catch (error) { next(error); }
        });
    }

    return router;
}

module.exports = { createWorkspaceRouter, collectStats };
