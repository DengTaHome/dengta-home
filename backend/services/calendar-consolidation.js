"use strict";

const {
    consolidateCalendar
} = require("./context-budget");

const DAY_MS = 24 * 60 * 60 * 1000;
const CONSOLIDATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;

let lastConsolidationAt = 0;

async function loadActiveCalendarRows(database, limit = 500) {
    const { data, error } = await database
        .from("memory_calendar")
        .select("id, user_id, companion_id, conversation_id, period_type, period_start, period_end, superseded, summary")
        .eq("superseded", false)
        .order("period_start", { ascending: true })
        .limit(limit);
    if (error) throw error;
    return data || [];
}

async function markSuperseded(database, ids, sourceRow) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    let query = database
        .from("memory_calendar")
        .update({ superseded: true, updated_at: new Date().toISOString() })
        .eq("user_id", sourceRow.user_id)
        .eq("companion_id", sourceRow.companion_id);
    if (sourceRow.conversation_id) {
        query = query.eq("conversation_id", sourceRow.conversation_id);
    }
    query = query.in("id", ids);
    const { error } = await query;
    if (error) throw error;
}

async function insertCalendarSummary(database, row) {
    const { error } = await database
        .from("memory_calendar")
        .insert(row);
    if (error) throw error;
}

function periodBounds(target, sourceRows) {
    if (!sourceRows.length) return null;
    const starts = sourceRows.map((r) => Date.parse(r.period_start)).filter(Number.isFinite);
    const ends = sourceRows.map((r) => Date.parse(r.period_end)).filter(Number.isFinite);
    if (!starts.length || !ends.length) return null;
    return {
        period_start: new Date(Math.min(...starts)).toISOString(),
        period_end: new Date(Math.max(...ends)).toISOString()
    };
}

function mergeSummaries(sourceRows) {
    return sourceRows
        .map((r) => String(r.summary || "").trim())
        .filter(Boolean)
        .join("\n\n");
}

function groupRowsByTenant(rows) {
    const groups = new Map();
    for (const row of rows) {
        const key = JSON.stringify([
            row.user_id,
            row.companion_id,
            row.conversation_id || null
        ]);
        const group = groups.get(key) || [];
        group.push(row);
        groups.set(key, group);
    }
    return groups.values();
}

async function runCalendarConsolidation({
    database,
    logger = console,
    now = Date.now,
    force = false
} = {}) {
    if (!database) return { skipped: true, reason: "no_database" };

    const currentTime = typeof now === "function" ? now() : now;
    if (!force && currentTime - lastConsolidationAt < CONSOLIDATION_COOLDOWN_MS) {
        return { skipped: true, reason: "cooldown" };
    }
    lastConsolidationAt = currentTime;

    let activeRows;
    try {
        activeRows = await loadActiveCalendarRows(database);
    } catch (error) {
        logger?.error?.("calendar_consolidation_load_error", {
            errorCode: String(error?.code || "unknown")
        });
        return { skipped: true, reason: "load_error", error: error?.message };
    }

    if (activeRows.length === 0) {
        return { skipped: true, reason: "no_active_rows" };
    }

    const jobs = [];
    for (const tenantRows of groupRowsByTenant(activeRows)) {
        for (const job of consolidateCalendar(tenantRows, new Date(currentTime))) {
            jobs.push({ ...job, sourceRows: tenantRows });
        }
    }
    if (jobs.length === 0) {
        return { skipped: true, reason: "no_jobs", activeRows: activeRows.length };
    }

    const results = [];
    for (const job of jobs) {
        const sourceRows = job.sourceRows.filter((r) => job.sourceIds.includes(r.id));
        const bounds = periodBounds(job.target, sourceRows);
        if (!bounds) continue;

        const mergedSummary = mergeSummaries(sourceRows);
        if (!mergedSummary) continue;

        try {
            await insertCalendarSummary(database, {
                user_id: sourceRows[0]?.user_id,
                companion_id: sourceRows[0]?.companion_id,
                conversation_id: sourceRows[0]?.conversation_id || null,
                period_type: job.target,
                period_start: bounds.period_start,
                period_end: bounds.period_end,
                summary: mergedSummary,
                importance: 5,
                source_ids: job.sourceIds
            });
            await markSuperseded(database, job.sourceIds, sourceRows[0]);
            results.push({
                target: job.target,
                sourceCount: job.sourceIds.length,
                summaryChars: mergedSummary.length
            });
        } catch (error) {
            logger?.error?.("calendar_consolidation_job_error", {
                target: job.target,
                errorCode: String(error?.code || "unknown")
            });
        }
    }

    logger?.info?.("calendar_consolidation_complete", {
        jobs: jobs.length,
        completed: results.length
    });

    return {
        skipped: false,
        jobs: jobs.length,
        completed: results.length,
        results
    };
}

module.exports = {
    CONSOLIDATION_COOLDOWN_MS,
    runCalendarConsolidation
};
