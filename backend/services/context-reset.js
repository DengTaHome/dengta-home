const {
    memoryBudgetEnabled,
    selectMemoriesForContext
} = require("./memory-budget");
const {
    adaptiveMessageLimit,
    resolveContextWindow
} = require("./context-budget");
const { isNurseryRelevant } = require("./nursery-engine");
const { loadNurseryRuntimeSnapshot } = require("./nursery");
const {
    filterMemoriesForContext,
    filterProviderBoundaryMessages
} = require("./persistent-memory-filter");
const { recallMemories } = require("./kiwi-memory-client");
const { readContextHistory, resolveCompressionThreshold } = require("./context-history");

function normalizeContextResetAt(value) {
    const candidate =
        value && typeof value === "object"
            ? value.context_reset_at
            : value;
    if (candidate === null || candidate === undefined || candidate === "") {
        return null;
    }
    const parsed = new Date(candidate);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isContextTimestampCurrent(value, settings) {
    const cutoff = normalizeContextResetAt(settings);
    if (!cutoff) return true;
    const parsed = new Date(value);
    return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.getTime() >= new Date(cutoff).getTime()
    );
}

function applyContextResetCutoff(
    query,
    settings,
    column = "created_at"
) {
    const cutoff = normalizeContextResetAt(settings);
    return cutoff ? query.gte(column, cutoff) : query;
}

function confirmedMemoryQuery(database, settings, limit) {
    const query = database
        .from("memories")
        .select("id, summary, created_at, updated_at, locked")
        .eq("confirmation_status", "confirmed")
        .eq("superseded", false);
    return applyContextResetCutoff(query, settings)
        .order("locked", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(limit);
}

async function loadCalendarSummaries(database, settings, limit = 10) {
    if (!settings?.user_id || !settings?.companion_id) return [];
    try {
        const { data, error } = await database
            .from("memory_calendar")
            .select("id, period_type, period_start, period_end, summary")
            .eq("user_id", settings.user_id)
            .eq("companion_id", settings.companion_id)
            .eq("superseded", false)
            .order("period_start", { ascending: false })
            .limit(limit);
        if (error) return [];
        return data || [];
    } catch {
        // memory_calendar table may not exist yet — graceful fallback
        return [];
    }
}

async function loadMainChatContextRows({
    database,
    conversationId,
    settings
}) {
    const useMemoryBudget = memoryBudgetEnabled();
    const modelContextWindow = resolveContextWindow(settings?.model);
    const windowLimit = adaptiveMessageLimit(modelContextWindow);
    // 用户设置的 context_turns（上下文保留轮数）生效：
    //   目标条数 = 轮数×2 + 20 条缓冲；窗口预算仍作为硬上限（取两者较小值，至少 16 条）。
    const turnLimit = Math.max(
        0,
        Math.round(Number(settings?.context_turns) || 0)
    );
    const messageLimit = turnLimit > 0
        ? Math.max(16, Math.min(windowLimit, turnLimit * 2 + 20))
        : windowLimit;
    const historyQuery = () => applyContextResetCutoff(
        database
            .from("messages")
            .select("id, role, content, created_at, tool_calls")
            .eq("conversation_id", conversationId)
            .eq("visible", true)
            .eq("context_visible", true),
        settings
    );
    const [messages, memoriesResult, calendarSummaries] = await Promise.all([
        readContextHistory({ query: historyQuery, messageLimit, tokenLimit: modelContextWindow }),
        confirmedMemoryQuery(database, settings, useMemoryBudget ? 80 : 12),
        loadCalendarSummaries(database, settings, useMemoryBudget ? 10 : 3)
    ]);
    if (memoriesResult.error) throw memoriesResult.error;
    const latestUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === "user");
    let nursery = null;
    if (isNurseryRelevant(latestUserMessage?.content || "")) {
        nursery = await loadNurseryRuntimeSnapshot({ database }).catch(
            (error) => {
                if (
                    error?.code === "42P01" ||
                    error?.code === "PGRST205" ||
                    /nursery_.*does not exist|could not find.*nursery_/i.test(
                        error?.message || ""
                    )
                ) {
                    return null;
                }
                throw error;
            }
        );
    }
    // kiwi-mem 多租户记忆网关召回（未配置 KIWI_MEM_URL 时为空数组，零开销）。
    // 按当前租户（settings.user_id/companion_id）隔离检索，与其他用户互不可见。
    const kiwiMemories = await recallMemories(
        latestUserMessage?.content || "",
        {
            userId: settings?.user_id,
            companionId: settings?.companion_id
        }
    );
    const allMemoryCandidates = [...kiwiMemories, ...(memoriesResult.data || [])];
    const allMemories = useMemoryBudget
        ? selectMemoriesForContext(
              filterMemoriesForContext(allMemoryCandidates),
              {
                  query: latestUserMessage?.content || "",
                  maxItems: 20,
                  charBudget: 8000
              }
          )
        : filterMemoriesForContext(allMemoryCandidates).slice(0, 12);
    const coreMemories = allMemories.filter((m) => m.locked === true);
    const regularMemories = allMemories.filter((m) => m.locked !== true);
    return {
        messages,
        memories: allMemories,
        coreMemories,
        regularMemories,
        calendarSummaries,
        nursery
    };
}

async function loadCompanionInteractionContextRows({
    database,
    conversationId,
    settings
}) {
    const baseMessageQuery = () =>
        applyContextResetCutoff(
            database
                .from("messages")
                .select(
                    "id, role, content, created_at, tool_calls"
                )
                .eq("conversation_id", conversationId)
                .eq("visible", true)
                .eq("context_visible", true),
            settings
        );
    const [userResult, assistantResult, interactionResult, memoriesResult] =
        await Promise.all([
            baseMessageQuery()
                .eq("role", "user")
                .order("created_at", { ascending: false })
                .limit(8),
            baseMessageQuery()
                .eq("role", "assistant")
                .not(
                    "tool_calls",
                    "cs",
                    JSON.stringify({ is_companion_interaction: true })
                )
                .order("created_at", { ascending: false })
                .limit(8),
            baseMessageQuery()
                .eq("role", "assistant")
                .contains("tool_calls", {
                    is_companion_interaction: true
                })
                .order("created_at", { ascending: false })
                .limit(6),
            confirmedMemoryQuery(database, settings, 1)
        ]);
    for (const result of [
        userResult,
        assistantResult,
        interactionResult,
        memoriesResult
    ]) {
        if (result.error) throw result.error;
    }
    const messagesById = new Map();
    for (const message of [
        ...(userResult.data || []),
        ...(assistantResult.data || []),
        ...(interactionResult.data || [])
    ]) {
        messagesById.set(message.id, message);
    }
    return {
        messages: filterProviderBoundaryMessages(
            [...messagesById.values()].sort(
                (left, right) =>
                    Date.parse(left.created_at) -
                    Date.parse(right.created_at)
            )
        ),
        memories: filterMemoriesForContext(memoriesResult.data)
    };
}

async function loadMemoryCompressionRows({
    database,
    conversationId,
    settings
}) {
    const messagesQuery = () => applyContextResetCutoff(
        database
            .from("messages")
            .select("id, role, content, created_at, tool_calls")
            .eq("conversation_id", conversationId)
            .eq("visible", true)
            .eq("context_visible", true),
        settings
    );
    const capacity = resolveContextWindow(settings?.model);
    const scanBudget = Math.max(capacity, resolveCompressionThreshold(settings, capacity));
    const [messages, memoriesResult] = await Promise.all([
        readContextHistory({ query: messagesQuery, messageLimit: adaptiveMessageLimit(scanBudget),
            tokenLimit: scanBudget, ascending: true }),
        confirmedMemoryQuery(database, settings, 5)
    ]);
    if (memoriesResult.error) throw memoriesResult.error;
    return {
        messages,
        memories: filterMemoriesForContext(memoriesResult.data)
    };
}

module.exports = {
    applyContextResetCutoff,
    isContextTimestampCurrent,
    loadCalendarSummaries,
    loadCompanionInteractionContextRows,
    loadMainChatContextRows,
    loadMemoryCompressionRows,
    normalizeContextResetAt
};
