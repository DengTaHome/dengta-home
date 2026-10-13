const express = require("express");
const { requireRequestScope } = require("../services/request-scope");
const {
    DEFAULT_CHAT_SKIN_PREFERENCES,
    buildComposerHintPrompt,
    canRefreshComposerHint,
    defaultChatSkinPreferencesForRole,
    hasEnoughComposerHintContext,
    normalizeChatSkinPreferences,
    normalizeComposerHint
} = require("../services/chat-skin");
const {
    applyContextResetCutoff
} = require("../services/context-reset");
const {
    isProviderBoundaryResidue
} = require("../services/persistent-memory-filter");

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function publicPreferences(row) {
    const normalized = normalizeChatSkinPreferences(row || {});
    return {
        ...normalized,
        updated_at: row?.updated_at || null
    };
}

function chinaDateKey(value = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(value);
    const values = Object.fromEntries(
        parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, part.value])
    );
    return `${values.year}-${values.month}-${values.day}`;
}

function safeMoodSummary(value) {
    return String(value || "")
        .replace(/[\r\n]+/g, " ")
        .replace(
            /(?:系统提示词|密钥|token|api[_ -]?key|cookie|authorization)[^，。；;]{0,160}/gi,
            "[敏感内容已省略]"
        )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
}

function createChatSkinRouter({
    getSettings,
    generateReply,
    now = () => new Date()
} = {}) {
    if (typeof getSettings !== "function" || typeof generateReply !== "function") {
        throw new TypeError("Chat skin router requires settings and generation services.");
    }

    const router = express.Router();
    router.use((req, res, next) => {
        try {
            requireRequestScope(req);
            res.set("Cache-Control", "private, no-store");
            next();
        } catch (error) {
            next(error);
        }
    });

    async function readPreferences(database) {
        const { data, error } = await database
            .from("companion_chat_preferences")
            .select("*")
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function writePreferences(database, value) {
        const current = await readPreferences(database);
        const next = normalizeChatSkinPreferences(value);
        if (current) {
            const { data, error } = await database
                .from("companion_chat_preferences")
                .update(next)
                .eq("id", current.id)
                .select("*")
                .single();
            if (error) throw error;
            return data;
        }
        const { data, error } = await database
            .from("companion_chat_preferences")
            .insert(next)
            .select("*")
            .single();
        if (error) throw error;
        return data;
    }

    async function recentMessagesWithBoundaryResidue(database, conversationId, settings) {
        const messagesQuery = applyContextResetCutoff(
            database
                .from("messages")
                .select("role, content, created_at")
                .eq("conversation_id", conversationId)
                .eq("visible", true)
                .eq("context_visible", true),
            settings
        ).order("created_at", { ascending: false }).limit(50);
        const { data, error } = await messagesQuery;
        if (error) throw error;
        const containsResidue = (data || []).some(
            (message) =>
                message?.role === "assistant" &&
                isProviderBoundaryResidue(String(message?.content || ""))
        );
        return { containsResidue, messages: data || [] };
    }

    async function ensureConversation(database, conversationId) {
        if (!UUID_PATTERN.test(conversationId)) {
            throw requestError(400, "invalid_conversation_id", "会话编号格式不正确。");
        }
        const { data, error } = await database
            .from("conversations")
            .select("id")
            .eq("id", conversationId)
            .maybeSingle();
        if (error) throw error;
        if (!data) throw requestError(404, "conversation_not_found", "找不到这段会话。");
        return data;
    }

    router.get("/preferences", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const row = await readPreferences(scope.db);
            res.json({
                ok: true,
                preferences: publicPreferences(
                    row || defaultChatSkinPreferencesForRole(scope.role)
                )
            });
        } catch (error) {
            next(error);
        }
    });

    router.put("/preferences", async (req, res, next) => {
        try {
            const row = await writePreferences(
                requireRequestScope(req).db,
                req.body || {}
            );
            res.json({ ok: true, preferences: publicPreferences(row) });
        } catch (error) {
            next(error);
        }
    });

    router.get("/conversations/:conversationId/hint", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            await ensureConversation(scope.db, req.params.conversationId);
            const settings = await getSettings(scope.db);
            const { containsResidue } = await recentMessagesWithBoundaryResidue(
                scope.db,
                req.params.conversationId,
                settings
            );
            if (containsResidue) {
                // 最近对话含被拒对话：动态输入框提示不读取该内容，并清除可能已污染的旧提示。
                const { error: deleteError } = await scope.db
                    .from("conversation_composer_hints")
                    .delete()
                    .eq("conversation_id", req.params.conversationId);
                if (deleteError) throw deleteError;
                res.json({ ok: true, hint: null, reason: "refusal_present" });
                return;
            }
            const { data, error } = await scope.db
                .from("conversation_composer_hints")
                .select("hint, mood_revision, generated_at, updated_at")
                .eq("conversation_id", req.params.conversationId)
                .maybeSingle();
            if (error) throw error;
            res.json({ ok: true, hint: data || null });
        } catch (error) {
            next(error);
        }
    });

    router.post(
        "/conversations/:conversationId/hint/refresh",
        async (req, res, next) => {
            try {
                const scope = requireRequestScope(req);
                await ensureConversation(scope.db, req.params.conversationId);
                const preferences = await readPreferences(scope.db);
                const normalizedPreferences = normalizeChatSkinPreferences(
                    preferences || DEFAULT_CHAT_SKIN_PREFERENCES
                );
                const { data: currentHint, error: hintError } = await scope.db
                    .from("conversation_composer_hints")
                    .select("*")
                    .eq("conversation_id", req.params.conversationId)
                    .maybeSingle();
                if (hintError) throw hintError;
                if (!normalizedPreferences.dynamic_composer_hint) {
                    res.json({
                        ok: true,
                        updated: false,
                        reason: "disabled",
                        hint: currentHint || null
                    });
                    return;
                }

                const current = now();
                const today = chinaDateKey(current);
                const dailyCount =
                    currentHint?.daily_generation_date === today
                        ? currentHint.daily_generation_count
                        : 0;
                const gate = canRefreshComposerHint({
                    now: current,
                    lastGeneratedAt: currentHint?.generated_at,
                    dailyCount
                });
                if (!gate.allowed) {
                    res.json({
                        ok: true,
                        updated: false,
                        reason: gate.reason,
                        hint: currentHint || null
                    });
                    return;
                }

                const settings = await getSettings(scope.db);
                const messagesQuery = applyContextResetCutoff(
                    scope.db
                        .from("messages")
                        .select("role, content, created_at")
                        .eq(
                            "conversation_id",
                            req.params.conversationId
                        )
                        .eq("visible", true)
                        .eq("context_visible", true),
                    settings
                ).order("created_at", { ascending: true });
                const {
                    data: messages,
                    error: messagesError
                } = await messagesQuery;
                if (messagesError) throw messagesError;
                if (
                    (messages || []).some(
                        (message) =>
                            message?.role === "assistant" &&
                            isProviderBoundaryResidue(
                                String(message?.content || "")
                            )
                    )
                ) {
                    // 含被拒对话：动态输入框提示不允许读取该内容，不生成并清除旧提示。
                    if (currentHint) {
                        const { error: deleteError } = await scope.db
                            .from("conversation_composer_hints")
                            .delete()
                            .eq("id", currentHint.id);
                        if (deleteError) throw deleteError;
                    }
                    res.json({
                        ok: true,
                        updated: false,
                        reason: "refusal_present",
                        hint: null
                    });
                    return;
                }
                if (!hasEnoughComposerHintContext(messages)) {
                    res.json({
                        ok: true,
                        updated: false,
                        reason: "insufficient_context",
                        hint: currentHint || null
                    });
                    return;
                }
                const prompt = buildComposerHintPrompt({
                    companionName: settings.ai_name || "伴侣",
                    stableMood: safeMoodSummary(req.body?.mood_summary),
                    messages: messages || []
                });
                const generated = await generateReply({
                    settings,
                    messages: [
                        {
                            role: "user",
                            content: "只输出一行输入框提示语。"
                        }
                    ],
                    systemInstructionsOverride: prompt
                });
                const hint =
                    generated.mode === "placeholder"
                        ? ""
                        : normalizeComposerHint(generated.text);
                if (!hint) {
                    res.json({
                        ok: true,
                        updated: false,
                        reason: "empty_generation",
                        hint: currentHint || null
                    });
                    return;
                }

                const row = {
                    conversation_id: req.params.conversationId,
                    hint,
                    mood_revision: safeMoodSummary(req.body?.mood_summary),
                    generated_at: current.toISOString(),
                    daily_generation_date: today,
                    daily_generation_count: dailyCount + 1,
                    updated_at: current.toISOString()
                };
                const saved = currentHint
                    ? await scope.db
                          .from("conversation_composer_hints")
                          .update(row)
                          .eq("id", currentHint.id)
                          .select("hint, mood_revision, generated_at, updated_at")
                          .single()
                    : await scope.db
                          .from("conversation_composer_hints")
                          .insert(row)
                          .select("hint, mood_revision, generated_at, updated_at")
                          .single();
                if (saved.error) throw saved.error;
                res.json({ ok: true, updated: true, hint: saved.data });
            } catch (error) {
                if (Number(error?.status) >= 400 && Number(error?.status) < 500) {
                    next(error);
                    return;
                }
                console.error("composer_hint_generation_failed", {
                    name: error?.name || "Error"
                });
                res.json({
                    ok: true,
                    updated: false,
                    reason: "generation_failed",
                    hint: null
                });
            }
        }
    );

    return router;
}

module.exports = { createChatSkinRouter, chinaDateKey, publicPreferences };
