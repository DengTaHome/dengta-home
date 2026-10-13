"use strict";

// 特殊日子日历：纪念日（A1）+ 追番/追剧日历（B1）。
// 供聊天工具增删查、以及构建聊天上下文时注入"今天/临近"的日子。

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function cleanText(value, maximum) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
        .slice(0, maximum)
        .join("");
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseLocalDate(value) {
    let text = String(value ?? "").trim();
    // 宽容解析常见格式：2025-12-29 / 2025/12/29 / 2025.12.29 / 2025年12月29日 / ISO 时间串
    const chinese = text.match(/^(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?$/);
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    const match = chinese || iso;
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }
    text = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    return { year, month, day, text };
}

function startOfToday(now = new Date()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysBetween(a, b) {
    return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function createSpecialDatesService({ database } = {}) {
    if (!database?.from) {
        throw new TypeError("special dates service requires a Supabase database client");
    }

    async function add(scope, values = {}) {
        if (!scope?.userId || !scope?.companionId) {
            throw requestError(401, "special_dates_auth_required", "保存特殊日子需要登录态。");
        }
        const kind = ["anniversary", "show"].includes(String(values.kind)) ? String(values.kind) : "anniversary";
        const title = cleanText(values.title, 60);
        if (!title) throw requestError(400, "special_dates_title_required", "请写明日子名称。");
        const parsed = parseLocalDate(values.date);
        if (!parsed) throw requestError(400, "special_dates_date_invalid", "日期格式应为 YYYY-MM-DD。");
        const { data, error } = await database
            .from("special_dates")
            .insert({
                user_id: scope.userId,
                companion_id: scope.companionId,
                kind,
                title,
                event_date: parsed.text,
                description: cleanText(values.description, 300),
                recur_yearly: kind === "anniversary" ? values.recur_yearly !== false : false,
                next_episode: kind === "show" ? cleanText(values.next_episode, 40) : "",
                reminder_days: Number.isFinite(Number(values.reminder_days))
                    ? Math.max(0, Math.min(30, Math.round(Number(values.reminder_days))))
                    : 0
            })
            .select("*")
            .single();
        if (error) throw error;
        return data;
    }

    async function list(scope, kind = "") {
        let query = database
            .from("special_dates")
            .select("*")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId);
        if (kind === "anniversary" || kind === "show") query = query.eq("kind", kind);
        const { data, error } = await query.order("event_date", { ascending: true }).limit(100);
        if (error) throw error;
        return data || [];
    }

    async function remove(scope, id) {
        const { data, error } = await database
            .from("special_dates")
            .delete()
            .eq("id", id)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .select("id")
            .maybeSingle();
        if (error) throw error;
        if (!data) throw requestError(404, "special_dates_missing", "没有找到这条特殊日子。");
        return { removed: data.id };
    }

    // 返回 { anniversaries_today, anniversaries_soon, shows_today, shows_soon }
    async function upcoming(scope, days = 7, now = new Date()) {
        const rows = await list(scope);
        const today = startOfToday(now);
        const horizon = Math.max(1, Math.min(30, Number(days) || 7));
        const result = {
            anniversaries_today: [],
            anniversaries_soon: [],
            shows_today: [],
            shows_soon: []
        };
        for (const row of rows) {
            const parsed = parseLocalDate(String(row.event_date || ""));
            if (!parsed) continue;
            const base = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
            if (row.kind === "show") {
                const distance = daysBetween(base, today);
                const entry = {
                    id: row.id,
                    title: row.title,
                    event_date: row.event_date,
                    description: row.description,
                    next_episode: row.next_episode,
                    days_away: distance
                };
                if (distance === 0) result.shows_today.push(entry);
                else if (distance > 0 && distance <= horizon) result.shows_soon.push(entry);
                continue;
            }
            // 纪念日：按"今年的月-日"重算，过期则顺延到明年。
            let candidate = new Date(Date.UTC(today.getUTCFullYear(), parsed.month - 1, parsed.day));
            if (daysBetween(candidate, today) < 0) {
                candidate = new Date(Date.UTC(today.getUTCFullYear() + 1, parsed.month - 1, parsed.day));
            }
            const distance = daysBetween(candidate, today);
            const entry = {
                id: row.id,
                title: row.title,
                event_date: row.event_date,
                description: row.description,
                days_away: distance
            };
            if (distance === 0) result.anniversaries_today.push(entry);
            else if (distance <= horizon) result.anniversaries_soon.push(entry);
        }
        return result;
    }

    function buildContext(upcomingResult) {
        const lines = [];
        for (const item of upcomingResult.anniversaries_today) {
            lines.push(`纪念日·今天：${item.title}${item.description ? "（" + item.description + "）" : ""}`);
        }
        for (const item of upcomingResult.anniversaries_soon) {
            lines.push(`纪念日·${item.days_away}天后：${item.title}${item.description ? "（" + item.description + "）" : ""}`);
        }
        for (const item of upcomingResult.shows_today) {
            lines.push(`追番·今天更新：${item.title}${item.next_episode ? " " + item.next_episode : ""}${item.description ? "（" + item.description + "）" : ""}`);
        }
        for (const item of upcomingResult.shows_soon) {
            lines.push(`追番·${item.days_away}天后：${item.title}${item.next_episode ? " " + item.next_episode : ""}${item.description ? "（" + item.description + "）" : ""}`);
        }
        if (lines.length === 0) return "";
        return [
            "【特殊日子日历（今天与最近，来自用户保存的纪念日/追番日历）】",
            "今天是纪念日或发生日时要主动、自然地为用户庆祝/提醒；用户没提这些日子时不要生硬插入，"
            + "只有日子就在今天（或用户主动问起）时才热情庆祝；追番今天更新可以提醒并提议一起看。",
            ...lines
        ].join("\n");
    }

    return { add, list, remove, upcoming, buildContext };
}

module.exports = { createSpecialDatesService };
