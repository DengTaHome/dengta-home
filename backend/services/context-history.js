const { estimateRequestValue } = require("./context-budget");
const { filterProviderBoundaryMessages } = require("./persistent-memory-filter");

const HISTORY_PAGE_SIZE = 256;

// Keyset pagination avoids the REST row ceiling and offset shifts during a reply.
async function readContextHistory({ query, messageLimit, tokenLimit, ascending = false }) {
    const messages = [];
    let tokens = 0;
    let scanned = 0;
    let cursor = null;
    const direction = ascending ? "gt" : "lt";
    while (scanned < messageLimit && tokens < tokenLimit) {
        let page = query()
            .order("created_at", { ascending })
            .order("id", { ascending })
            .limit(Math.min(HISTORY_PAGE_SIZE, messageLimit - scanned));
        if (cursor) {
            page = page.or(`created_at.${direction}.${cursor.time},and(created_at.eq.${cursor.time},id.${direction}.${cursor.id})`);
        }
        const { data, error } = await page;
        if (error) throw error;
        const rows = data || [];
        if (!rows.length) break;
        scanned += rows.length;
        for (const row of filterProviderBoundaryMessages(rows)) {
            messages.push(row);
            tokens += estimateRequestValue(row.content) + estimateRequestValue(row.tool_calls) + 24;
            if (messages.length >= messageLimit || tokens >= tokenLimit) break;
        }
        if (scanned >= messageLimit || tokens >= tokenLimit) break;
        const last = rows.at(-1);
        const time = String(last.created_at || "");
        const id = String(last.id || "");
        if (!/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(time) || !Number.isFinite(Date.parse(time)) ||
            !/^(?:[1-9]\d*|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(id) ||
            (cursor?.time === time && cursor?.id === id)) {
            throw Object.assign(new Error("聊天历史分页位置无效，请重试并查看诊断日志。"), { code: "context_history_cursor_invalid" });
        }
        cursor = { time, id };
    }
    return ascending ? messages : messages.reverse();
}

function resolveCompressionThreshold(settings, capacity) {
    const configured = Number(settings?.compression_threshold);
    return Number.isFinite(configured) && configured > 0 && configured !== 8000
        ? Math.max(4000, configured)
        : Math.max(1024, Math.floor(capacity * 0.8));
}

module.exports = { readContextHistory, resolveCompressionThreshold, HISTORY_PAGE_SIZE };
