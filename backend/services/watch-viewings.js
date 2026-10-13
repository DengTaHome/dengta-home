// 观看记录与票根服务：记录 watcher 进度、完成状态，并签发稳定票根。
// 对应 Lean_In viewing/ticket 概念，使用 DengTa 自己的表结构与语义独立实现。
// 所有表都是跨租户表（watch_viewings / watch_receipts），需用 admin 原始 Supabase。

const TICKET_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 无 0/O/1/I 易混淆字符

function randomTicketNo() {
    let out = "";
    for (let i = 0; i < 6; i++) {
        out += TICKET_CHARS[Math.floor(Math.random() * TICKET_CHARS.length)];
    }
    return out;
}

function normalizeViewingInput(value = {}) {
    return {
        userId: String(value.userId || ""),
        companionId: String(value.companionId || ""),
        sessionId: String(value.watchSessionId || value.sessionId || ""),
        mediaUrl: String(value.mediaUrl || "").slice(0, 2000),
        mediaTitle: String(value.mediaTitle || value.title || "").slice(0, 200),
        durationSeconds: Math.max(0, Math.round(Number(value.durationSeconds) || 0)),
        positionSeconds: Math.max(0, Math.round(Number(value.positionSeconds) || 0)),
        watchedSeconds: Math.max(0, Math.round(Number(value.watchedSeconds) || 0))
    };
}

/**
 * 记录/更新一次观看进度。
 * - 同一 user+watch_session_id 视为同一观看：按 last_position 推进 watched_seconds。
 * - 进度 ≥98% 或触底时标记 completed 并签发票根（一次性）。
 */
async function recordViewingProgress(database, value = {}) {
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A raw admin database is required.");
    }
    const v = normalizeViewingInput(value);
    if (!v.userId) return null;
    const now = new Date().toISOString();

    // 查找现有观看（同一用户 + 同一会话）
    const { data: existing, error: queryError } = await database
        .from("watch_viewings")
        .select("*")
        .eq("user_id", v.userId)
        .eq("watch_session_id", v.sessionId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (queryError) throw queryError;

    const duration = v.durationSeconds || existing?.media_duration_seconds || 0;
    const position = v.positionSeconds;
    const isCompleted = duration > 0 && position >= duration * 0.98;
    const ratio = duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0;

    let viewing;
    if (existing) {
        const watchedSeconds = Math.max(
            Number(existing.watched_seconds || 0),
            v.watchedSeconds || 0
        );
        const { data: updated, error } = await database
            .from("watch_viewings")
            .update({
                last_position_seconds: position,
                watched_seconds: watchedSeconds,
                status: isCompleted ? "completed" : "in_progress",
                is_completed: isCompleted || undefined,
                completed_at: isCompleted ? now : undefined,
                last_watched_at: now,
                media_title: v.mediaTitle || existing.media_title,
                media_duration_seconds: duration || existing.media_duration_seconds
            })
            .eq("id", existing.id)
            .select()
            .single();
        if (error) throw error;
        viewing = updated;
    } else {
        const { data: created, error } = await database
            .from("watch_viewings")
            .insert({
                user_id: v.userId,
                companion_id: v.companionId || null,
                watch_session_id: v.sessionId || null,
                media_url: v.mediaUrl,
                media_title: v.mediaTitle,
                media_duration_seconds: duration,
                last_position_seconds: position,
                watched_seconds: v.watchedSeconds || Math.min(position, duration || Number.MAX_SAFE_INTEGER),
                status: isCompleted ? "completed" : "in_progress",
                is_completed: isCompleted,
                completed_at: isCompleted ? now : null
            })
            .select()
            .single();
        if (error) throw error;
        viewing = created;
    }

    // 完成时才签发票根（一次性）
    let receipt = null;
    if (isCompleted && !existing?.is_completed) {
        const { data: receiptRow, error: receiptError } = await database
            .from("watch_receipts")
            .insert({
                viewing_id: viewing.id,
                user_id: v.userId,
                companion_id: v.companionId || null,
                media_title: viewing.media_title || v.mediaTitle,
                watched_seconds: viewing.watched_seconds || 0,
                duration_seconds: duration,
                completion_ratio: ratio,
                ticket_no: randomTicketNo()
            })
            .select()
            .single();
        if (!receiptError) receipt = receiptRow;
    }

    return { viewing, receipt, isCompleted, ratio };
}

/** 读取用户最近观看列表。 */
async function listRecentViewings(database, userId, limit = 20) {
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A raw admin database is required.");
    }
    const { data, error } = await database
        .from("watch_viewings")
        .select("*")
        .eq("user_id", userId)
        .order("last_watched_at", { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data || [];
}

/** 读取一个观看对应的票根。 */
async function readReceipt(database, viewingId) {
    const { data, error } = await database
        .from("watch_receipts")
        .select("*")
        .eq("viewing_id", viewingId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

module.exports = {
    recordViewingProgress,
    listRecentViewings,
    readReceipt
};