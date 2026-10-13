const DEFAULT_MEMORY_CHAR_BUDGET = 6000;
const DEFAULT_MEMORY_MAX_ITEMS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

function memoryBudgetEnabled(value = process.env.MEMORY_BUDGET_ENABLED) {
    if (value === undefined || value === null || value === "") return true;
    return !["0", "false", "off"].includes(
        String(value).trim().toLowerCase()
    );
}

function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function characterSlice(value, maximum) {
    return Array.from(String(value || ""))
        .slice(0, Math.max(0, maximum))
        .join("");
}

function cleanMemoryText(value) {
    return String(value || "")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function memoryTokens(value, maximum = 256) {
    const text = cleanMemoryText(value).toLowerCase();
    const tokens = new Set();
    for (const token of text.match(/[a-z0-9][a-z0-9_-]{1,}/g) || []) {
        tokens.add(token);
        if (tokens.size >= maximum) return tokens;
    }
    for (const span of text.match(/[\u3400-\u9fff]+/g) || []) {
        const characters = Array.from(span);
        for (let index = 0; index < characters.length - 1; index += 1) {
            tokens.add(`${characters[index]}${characters[index + 1]}`);
            if (tokens.size >= maximum) return tokens;
        }
    }
    return tokens;
}

function lexicalRelevance(query, summary) {
    const queryTokens = memoryTokens(query, 48);
    if (queryTokens.size === 0) return 0;
    const summaryTokens = memoryTokens(summary);
    let overlap = 0;
    for (const token of queryTokens) {
        if (summaryTokens.has(token)) overlap += 1;
    }
    return Math.min(
        1,
        overlap /
            Math.sqrt(Math.max(1, queryTokens.size * summaryTokens.size))
    );
}

function memoryHeat(memory, now = new Date()) {
    const updated = new Date(memory?.updated_at || memory?.created_at || 0);
    if (Number.isNaN(updated.getTime())) return 0.35;
    const ageDays = Math.max(0, (now.getTime() - updated.getTime()) / DAY_MS);
    const importance = Math.max(
        1,
        Math.min(10, finiteNumber(memory?.importance, 5))
    );
    const emotionalWeight = Math.max(
        0,
        Math.min(10, finiteNumber(memory?.emotional_weight, 0))
    );
    const halfLifeDays =
        importance >= 8 || emotionalWeight >= 6 ? 90 : 45;
    const initialHeat = Math.min(
        1,
        0.45 + importance * 0.04 + emotionalWeight * 0.02
    );
    const decay = Math.pow(2, -ageDays / halfLifeDays);
    const recallBonus = Math.min(
        0.18,
        finiteNumber(memory?.recall_count, 0) * 0.015
    );
    return Math.max(0, Math.min(1, initialHeat * decay + recallBonus));
}

function truncateMemory(value, maximum) {
    const text = cleanMemoryText(value);
    if (Array.from(text).length <= maximum) return text;
    if (maximum <= 1) return characterSlice(text, maximum);
    return `${characterSlice(text, maximum - 1)}…`;
}

function selectMemoriesForContext(
    memories,
    {
        query = "",
        now = new Date(),
        maxItems = DEFAULT_MEMORY_MAX_ITEMS,
        charBudget = DEFAULT_MEMORY_CHAR_BUDGET
    } = {}
) {
    const safeNow = now instanceof Date ? now : new Date(now);
    const effectiveNow = Number.isNaN(safeNow.getTime())
        ? new Date()
        : safeNow;
    const itemLimit = Math.max(
        1,
        Math.min(
            40,
            Math.round(finiteNumber(maxItems, DEFAULT_MEMORY_MAX_ITEMS))
        )
    );
    const budget = Math.max(
        200,
        Math.min(
            24000,
            Math.round(
                finiteNumber(charBudget, DEFAULT_MEMORY_CHAR_BUDGET)
            )
        )
    );
    const scored = (Array.isArray(memories) ? memories : [])
        .map((memory) => {
            const summary = cleanMemoryText(memory?.summary);
            if (!summary) return null;
            const relevance = lexicalRelevance(query, summary);
            const heat = memoryHeat(memory, effectiveNow);
            const importance = Math.max(
                1,
                Math.min(10, finiteNumber(memory?.importance, 5))
            );
            const score =
                (relevance > 0 ? 0.45 + relevance * 0.4 : 0) +
                heat * 0.12 +
                (importance / 10) * 0.03;
            return {
                ...memory,
                summary,
                relevance,
                heat,
                score
            };
        })
        .filter(Boolean)
        .sort(
            (left, right) =>
                right.score - left.score ||
                Date.parse(right.updated_at || right.created_at || 0) -
                    Date.parse(left.updated_at || left.created_at || 0)
        );

    const selected = [];
    let remaining = budget;
    for (const memory of scored) {
        if (selected.length >= itemLimit || remaining < 24) break;
        const tier =
            memory.relevance >= 0.16 || memory.heat >= 0.7
                ? "full"
                : memory.heat >= 0.3
                  ? "summary"
                  : "cold";
        if (tier === "cold" && memory.relevance === 0) continue;
        const perItemLimit = tier === "full" ? 1200 : 400;
        const summary = truncateMemory(
            memory.summary,
            Math.min(perItemLimit, remaining)
        );
        if (!summary) continue;
        remaining -= Array.from(summary).length;
        selected.push({
            ...memory,
            summary,
            heat: Number(memory.heat.toFixed(4)),
            recall_score: Number(memory.score.toFixed(4)),
            memory_tier: tier,
            original_chars: Array.from(memory.summary).length
        });
    }

    return selected;
}

module.exports = {
    DEFAULT_MEMORY_CHAR_BUDGET,
    DEFAULT_MEMORY_MAX_ITEMS,
    lexicalRelevance,
    memoryBudgetEnabled,
    memoryHeat,
    selectMemoriesForContext
};
