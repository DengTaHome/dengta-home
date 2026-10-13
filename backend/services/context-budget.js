"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;

const MODEL_CONTEXT_WINDOWS = {
    "gpt-5": 256000,
    "gpt-5.6": 256000,
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    "gpt-4": 8192,
    // Official GPT-4.1 family inference windows; do not match these as GPT-4.
    "gpt-4.1": 1047576,
    "gpt-4.1-mini": 1047576,
    "gpt-4.1-nano": 1047576,
    "gpt-4-32k": 32768,
    "gpt-3.5-turbo": 16385,
    "o1": 200000,
    "o1-mini": 128000,
    "o1-preview": 128000,
    "o3": 200000,
    "o3-mini": 200000,
    "o4-mini": 200000,
    "claude-3-opus": 200000,
    "claude-3-sonnet": 200000,
    "claude-3-haiku": 200000,
    "claude-3-5-sonnet": 200000,
    "claude-3-5-haiku": 200000,
    "claude-sonnet-4": 200000,
    "claude-opus-4": 200000,
    "claude-3-7-sonnet": 200000,
    "gemini-1.5-pro": 2000000,
    "gemini-1.5-flash": 1000000,
    "gemini-2.0-flash": 1000000,
    "gemini-2.5-pro": 2000000,
    "gemini-2.5-flash": 1000000,
    "deepseek-chat": 128000,
    "deepseek-v3": 128000,
    "deepseek-v4": 128000,
    "deepseek-r1": 64000,
    "deepseek-reasoner": 64000,
    "qwen-max": 256000,
    "qwen3": 256000,
    "qwen-plus": 131072,
    "qwen-turbo": 8192,
    "qwen2.5-72b-instruct": 131072,
    "qwen2.5-32b-instruct": 131072,
    "qwen2.5-14b-instruct": 131072,
    "qwen2.5-7b-instruct": 131072,
    "llama-3.1-405b-instruct": 131072,
    "llama-3.1-70b-instruct": 131072,
    "llama-3.1-8b-instruct": 131072,
    "llama-3.3-70b-instruct": 131072,
    "mistral-large-latest": 131072,
    "mistral-medium-latest": 32000,
    "mistral-small-latest": 32000,
    "grok-2": 256000,
    "grok-2-mini": 256000,
    "kimi-k2": 256000,
    "kimi-k2.5": 256000,
    "kimi-k2.6": 256000,
    "kimi-k3": 256000,
    "glm-4-plus": 131072,
    "glm-4-air": 131072,
    "glm-4-long": 1000000,
    "dots-3-note-preview": 65536,
    "dots-3-note": 65536,
    "dots-studio": 65536,
    "gemma": 131072,
    "auto": 65536,
    "gpt-oss": 256000,
    "llama-4": 1000000,
    "minimax-m3": 200000,
    "nemotron": 256000,
    "step": 256000
};

const DEFAULT_CONTEXT_WINDOW = 32768;
// 未知模型按 64k 兜底：现代模型普遍 ≥64k，16384 会把历史消息全部裁掉导致"AI 失忆"。
const FALLBACK_CONTEXT_WINDOW = 65536;

function estimateTokens(text) {
    const value = String(text || "");
    if (!value) return 0;
    const cjk = (value.match(/[\u3400-\u9fff\uff00-\uffef]/g) || []).length;
    return Math.ceil(cjk * 1.5 + (value.length - cjk) * 0.35);
}

// Multimodal reserves are estimates; provider tokenizers and image/page costs vary.
function estimateRequestValue(value, key = "") {
    if (value === undefined || value === null) return 0;
    if (["image_url", "imageUrl", "inlineData", "inline_data", "input_audio", "file_data"].includes(key)) return 4096;
    if (typeof value === "string") return estimateTokens(value);
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + estimateRequestValue(item) + 8, 0);
    if (typeof value === "object") {
        if (value.type === "image" || value.kind === "image") return 4096;
        return Object.entries(value).reduce((sum, [name, item]) => sum + estimateTokens(name) + estimateRequestValue(item, name) + 4, 0);
    }
    return 1;
}

function resolveContextWindow(model) {
    const id = String(model || "").trim().toLowerCase();
    if (!id) return DEFAULT_CONTEXT_WINDOW;
    if (MODEL_CONTEXT_WINDOWS[id]) return MODEL_CONTEXT_WINDOWS[id];
    for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS).sort(([a], [b]) => b.length - a.length)) {
        // A dotted/newer version is not the legacy 8K GPT-4 model.
        if (key === "gpt-4" && !/(?:^|[/\s:])gpt-4(?:$|-(?:\d{4}|32k)(?:$|[-:]))/.test(id)) continue;
        if (id.includes(key)) return value;
    }
    if (/gpt-4o/.test(id)) return 128000;
    if (/claude.*sonnet/.test(id)) return 200000;
    if (/claude.*opus/.test(id)) return 200000;
    if (/claude.*haiku/.test(id)) return 200000;
    if (/gemini/.test(id)) return 1000000;
    if (/deepseek/.test(id)) return 64000;
    if (/qwen3/.test(id)) return 256000;
    if (/qwen/.test(id)) return 131072;
    if (/llama-3/.test(id)) return 131072;
    if (/mistral-large/.test(id)) return 131072;
    if (/glm-4/.test(id)) return 131072;
    if (/kimi|moonshot/.test(id)) return 256000;
    if (/dots|note-preview/.test(id)) return 65536;
    if (/gemma/.test(id)) return 131072;
    if (/grok/.test(id)) return 256000;
    if (/step/.test(id)) return 256000;
    if (/gpt-oss/.test(id)) return 256000;
    if (/llama-4/.test(id)) return 1000000;
    if (/minimax/.test(id)) return 200000;
    if (/nemotron/.test(id)) return 256000;
    return FALLBACK_CONTEXT_WINDOW;
}

function allocateContextBudget({
    contextWindow,
    maxOutputTokens = 2048,
    systemPrompt = "",
    coreMemoryBlock = [],
    retrievedMemories = [],
    calendarSummaries = [],
    messages = [],
    protectedFromIndex = Math.max(0, messages.length - 1),
    extraTokens = 0
}) {
    const capacity = Math.max(2048, Number(contextWindow) || DEFAULT_CONTEXT_WINDOW);
    // 输出上限 <= 0 / 空 = 不限制输出：为输出预留窗口的一小部分（10%，256~32000），
    // 其余全部留给输入，避免"无上限"设置把输入预算挤光。
    const configuredOutput = Number(maxOutputTokens);
    const reserved = configuredOutput > 0
        ? Math.max(256, Math.round(configuredOutput))
        : Math.min(32000, Math.max(256, Math.floor(capacity * 0.1)));

    const protectedStart = Math.max(0, Math.min(messages.length - 1, protectedFromIndex));
    const protectedMessages = messages.slice(protectedStart);
    const systemTokens = estimateTokens(systemPrompt);
    const latestTokens = protectedMessages.reduce((sum, message) => sum + estimateRequestValue(message.content) + 24, 0);
    const guaranteed = systemTokens + latestTokens + reserved + extraTokens;

    if (guaranteed >= capacity) {
        return {
            ok: false,
            reason: "compress_required",
            messages: protectedMessages,
            memoryBlocks: [],
            calendarBlocks: [],
            droppedOlderMessages: protectedStart,
            usage: {
                capacity,
                guaranteed,
                system: systemTokens,
                latest: latestTokens,
                extra: extraTokens,
                reservedOutput: reserved,
                historyIncluded: 0,
                history: 0
            }
        };
    }

    let remaining = capacity - guaranteed;

    const pushBlock = (label, text, pool) => {
        const tokens = estimateTokens(text);
        if (tokens <= 0 || tokens > pool.remaining) return false;
        pool.remaining -= tokens;
        pool.blocks.push({ label, text, tokens });
        return true;
    };

    const memoryBudget = Math.floor(capacity * 0.2);
    const memPool = {
        remaining: Math.min(memoryBudget, remaining),
        blocks: []
    };
    for (const memory of coreMemoryBlock) {
        pushBlock("core", memory.summary || memory.content || "", memPool);
    }
    for (const memory of retrievedMemories) {
        pushBlock("retrieved", memory.summary || memory.content || "", memPool);
    }
    const memorySpent = memPool.blocks.reduce((sum, b) => sum + b.tokens, 0);
    remaining -= memorySpent;

    const calendarCap = Math.floor(remaining * 0.3);
    const calPool = { remaining: calendarCap, blocks: [] };
    for (const day of calendarSummaries) {
        pushBlock("calendar", day.summary || day.content || "", calPool);
    }
    const calendarSpent = calPool.blocks.reduce((sum, b) => sum + b.tokens, 0);
    remaining -= calendarSpent;

    const history = [];
    for (let i = protectedStart - 1; i >= 0; i -= 1) {
        const tokens = estimateRequestValue(messages[i].content) + 24;
        if (tokens > remaining) break;
        remaining -= tokens;
        history.push(messages[i]);
    }
    history.reverse();

    return {
        ok: true,
        messages: [...history, ...protectedMessages],
        memoryBlocks: memPool.blocks,
        calendarBlocks: calPool.blocks,
        droppedOlderMessages: protectedStart - history.length,
        usage: {
            capacity,
            system: systemTokens,
            memory: memorySpent,
            calendar: calendarSpent,
            history: history.reduce((sum, m) => sum + estimateRequestValue(m.content) + 24, 0),
            latest: latestTokens,
            extra: extraTokens,
            reservedOutput: reserved
        }
    };
}

function consolidateCalendar(rows, now = new Date()) {
    const active = (Array.isArray(rows) ? rows : []).filter((r) => !r.superseded);
    const jobs = [];

    const days = active
        .filter((r) => r.period_type === "day")
        .sort((a, b) => Date.parse(a.period_start) - Date.parse(b.period_start));
    const completedDays = days.filter(
        (r) => now.getTime() - Date.parse(r.period_end) >= DAY_MS
    );
    if (completedDays.length >= 7) {
        jobs.push({
            target: "week",
            sourceIds: completedDays.slice(0, completedDays.length - (completedDays.length % 7)).map((r) => r.id)
        });
    }

    const mergeLevel = (type, unitMs, need, target) => {
        const items = active
            .filter((r) => r.period_type === type)
            .sort((a, b) => Date.parse(a.period_start) - Date.parse(b.period_start))
            .filter((r) => now.getTime() - Date.parse(r.period_end) >= unitMs);
        if (items.length >= need) {
            jobs.push({
                target,
                sourceIds: items.slice(0, items.length - (items.length % need)).map((r) => r.id)
            });
        }
    };
    mergeLevel("week", 7 * DAY_MS, 4, "month");
    mergeLevel("month", 28 * DAY_MS, 12, "year");

    return jobs;
}

function adaptiveMessageLimit(contextWindow) {
    const capacity = Math.max(8192, Number(contextWindow) || DEFAULT_CONTEXT_WINDOW);
    // Every message already reserves 24 tokens; actual token costs stop paging.
    return Math.max(10000, Math.ceil(capacity / 24) + 20);
}

module.exports = {
    DEFAULT_CONTEXT_WINDOW,
    FALLBACK_CONTEXT_WINDOW,
    MODEL_CONTEXT_WINDOWS,
    adaptiveMessageLimit,
    allocateContextBudget,
    consolidateCalendar,
    estimateTokens,
    estimateRequestValue,
    resolveContextWindow
};
