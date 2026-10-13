"use strict";

// 按用户查 agents.md 注入状态（需登录）：
// 使用同一组装函数提供设置预览；本轮检索和知识文件不在此预览范围内。

const { requireRequestScope } = require("./request-scope");
const { buildUserAgentsMdPlan } = require("./ai-service");
const { applyContextResetCutoff } = require("./context-reset");

async function loadAgentsMdPreview({ database, settings }) {
    const { data: memoryRows, error } = await applyContextResetCutoff(database
        .from("memories")
        .select("summary, updated_at, locked")
        .eq("confirmation_status", "confirmed")
        .eq("superseded", false), settings)
        .order("locked", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(12);
    if (error) throw error;
    const plan = buildUserAgentsMdPlan({ settings, memories: memoryRows || [] });
    return {
        memories: memoryRows || [],
        content: plan.content,
        sources: plan.sources,
        preview_scope: "settings_and_recent_confirmed_memories",
        is_generation_receipt: false,
        note: "设置预览；实际生成还会按本轮查询加载相关记忆、知识文件与动态上下文。"
    };
}

function createAgentsMdStatusHandler({ getSettings, databaseFallback }) {
    return async function agentsMdStatusHandler(req, res, next) {
        try {
            const scope = requireRequestScope(req);
            const database = scope?.db || databaseFallback;
            const settings = await getSettings(database);
            const preview = await loadAgentsMdPreview({ database, settings });
            const agentMd = preview.content;
            res.json({
                user_id: scope.userId,
                preview_scope: preview.preview_scope,
                is_generation_receipt: preview.is_generation_receipt,
                note: preview.note,
                applied: agentMd.length > 0,
                chars: agentMd.length,
                sources: preview.sources,
                preview: agentMd.slice(0, 300)
            });
        } catch (error) {
            next(error);
        }
    };
}

module.exports = { createAgentsMdStatusHandler, loadAgentsMdPreview };
