"use strict";

// 隐藏成就（D1 升级版）：
// - 系统成就目录（规则引擎自动解锁）+ 用户/AI 自定义成就（一起完成）
// - 新手引导成就 onboarding_1（前端引导完成后通过接口解锁）
// - 连续聊天 streak 成就

const ACHIEVEMENT_CATALOG = Object.freeze([
    { code: "first_chat", title: "初次相遇", description: "完成第一次对话", emoji: "💌", category: "旅程", rule: { conversations: 1 } },
    { code: "onboarding_1", title: "新手毕业", description: "完成接入引导，点亮灯塔", emoji: "🎓", category: "旅程", rule: { onboarding: 1 } },
    { code: "chat_10", title: "渐入佳境", description: "对话达到 10 轮", emoji: "🌱", category: "旅程", rule: { conversations: 10 } },
    { code: "chat_100", title: "百次心动", description: "对话达到 100 轮", emoji: "💯", category: "旅程", rule: { conversations: 100 } },
    { code: "streak_3", title: "三天小别胜新婚", description: "连续 3 天聊天", emoji: "🔥", category: "陪伴", rule: { streak: 3 } },
    { code: "streak_7", title: "七日之约", description: "连续 7 天聊天", emoji: "📅", category: "陪伴", rule: { streak: 7 } },
    { code: "night_owl", title: "夜猫子同盟", description: "深夜（23:00-05:00）仍保持 20 轮以上对话", emoji: "🦉", category: "陪伴", rule: { conversations: 20, lateHour: true } },
    { code: "moment_1", title: "心事分享者", description: "发布第一条动态", emoji: "📮", category: "分享", rule: { moments: 1 } },
    { code: "music_1", title: "音乐知己", description: "保存第一次音乐理解", emoji: "🎵", category: "一起", rule: { music: 1 } },
    { code: "music_10", title: "金曲收藏家", description: "音乐理解达到 10 次", emoji: "🎼", category: "一起", rule: { music: 10 } },
    { code: "watch_1", title: "第一次一起看", description: "开始第一次一起听/一起看", emoji: "🍿", category: "一起", rule: { watch: 1 } },
    { code: "art_1", title: "第一幅为你作的画", description: "AI 为你画出第一幅画", emoji: "🎨", category: "一起", rule: { art: 1 } },
    { code: "takeout_1", title: "深夜食堂合伙人", description: "第一次让 AI 帮忙点外卖", emoji: "🍜", category: "一起", rule: { takeout: 1 } },
    { code: "date_1", title: "日历管理员", description: "保存第一条纪念日或追番", emoji: "🗓️", category: "收藏", rule: { dates: 1 } },
    { code: "shot_1", title: "每日一拍首拍", description: "完成第一次每日一拍", emoji: "📸", category: "分享", rule: { shots: 1 } },
    { code: "compat_1", title: "默契初测", description: "完成第一次默契度挑战", emoji: "🧩", category: "陪伴", rule: { compatibility: 1 } },
    { code: "diy_1", title: "成就设计师", description: "自定义第一条属于你们的成就", emoji: "🛠️", category: "收藏", rule: { custom: 1 } },
    { code: "explorer_1", title: "玩法探索者", description: "解锁 5 个以上成就", emoji: "🧭", category: "旅程", rule: { unlockedAny: 5 } }
]);

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function createAchievementsService({ database } = {}) {
    if (!database?.from) {
        throw new TypeError("achievements service requires a Supabase database client");
    }

    async function countRows(table, scope, extra = {}) {
        try {
            let query = database
                .from(table)
                .select("id", { count: "exact", head: true });
            if (table === "moments") {
                query = query.eq("companion_id", scope.companionId).eq("author", "user");
            } else if (table === "companion_artworks") {
                query = query.eq("user_id", scope.userId).eq("companion_id", scope.companionId);
            } else if (table === "co_watch_sessions") {
                query = query.eq("user_id", scope.userId).eq("companion_id", scope.companionId);
            } else if (table === "user_achievements") {
                query = query.eq("user_id", scope.userId).eq("companion_id", scope.companionId);
            } else {
                query = query.eq("user_id", scope.userId).eq("companion_id", scope.companionId);
            }
            for (const [column, value] of Object.entries(extra)) {
                query = query.eq(column, value);
            }
            const { count, error } = await query;
            if (error) throw error;
            return Number(count) || 0;
        } catch (error) {
            console.error("成就统计失败（" + table + "）：", error?.message || "unknown");
            return 0;
        }
    }

    // 连续聊天天数：按 messages.created_at 的本地日期去重后计算以今天/昨天为结尾的最长连续段。
    async function computeStreak(scope) {
        try {
            const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
            const { data, error } = await database
                .from("messages")
                .select("created_at")
                .eq("user_id", scope.userId)
                .eq("companion_id", scope.companionId)
                .gte("created_at", since)
                .order("created_at", { ascending: false })
                .limit(400);
            if (error) throw error;
            const days = new Set();
            for (const row of data || []) {
                const date = new Date(row.created_at);
                days.add(
                    date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0")
                );
            }
            const has = (text) => days.has(text);
            const today = new Date();
            let streak = 0;
            const cursor = new Date(today);
            if (!has(toDateText(cursor))) cursor.setDate(cursor.getDate() - 1); // 今天没聊也算，从昨天起算
            while (has(toDateText(cursor))) {
                streak += 1;
                cursor.setDate(cursor.getDate() - 1);
            }
            return streak;
        } catch (error) {
            console.error("连续聊天统计失败：", error?.message || "unknown");
            return 0;
        }
    }

    function toDateText(date) {
        return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    }

    async function check(scope, now = new Date(), { refresh = false } = {}) {
        const key = scope.userId + ":" + scope.companionId;
        const cached = cache.get(key);
        if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
            return { newly: cached.newly, unlocked: cached.codes };
        }
        const [
            conversations, moments, music, takeout, dates, shots, compatibility,
            watch, art, customCount
        ] = await Promise.all([
            countRows("messages", scope, { role: "assistant", visible: true }),
            countRows("moments", scope),
            countRows("music_understandings", scope),
            countRows("takeout_commands", scope),
            countRows("special_dates", scope),
            countRows("daily_shots", scope),
            countRows("compatibility_records", scope),
            countRows("co_watch_sessions", scope),
            countRows("companion_artworks", scope),
            countRows("user_achievements", scope)
        ]);
        const streak = await computeStreak(scope);
        const { data: unlockedRows, error } = await database
            .from("achievements")
            .select("code")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId);
        if (error) {
            console.error("读取已解锁成就失败：", error?.message || "unknown");
            return { newly: [], unlocked: [] };
        }
        const unlockedCodes = new Set((unlockedRows || []).map((row) => row.code));
        const hour = now.getHours();
        const isLate = hour >= 23 || hour < 5;
        const stats = {
            conversations, moments, music, takeout, dates, shots, compatibility,
            watch, art, custom: customCount,
            streak,
            onboarding: unlockedCodes.has("onboarding_1") ? 1 : 0,
            unlockedAny: unlockedCodes.size
        };
        const qualified = ACHIEVEMENT_CATALOG.filter((item) => {
            const rule = item.rule || {};
            for (const [metric, threshold] of Object.entries(rule)) {
                if (metric === "lateHour") {
                    if (!isLate) return false;
                    continue;
                }
                if ((stats[metric] || 0) < threshold) return false;
            }
            return true;
        });
        let newly = qualified.filter((item) => !unlockedCodes.has(item.code));
        if (newly.length > 0) {
            const { error: insertError } = await database.from("achievements").insert(
                newly.map((item) => ({
                    user_id: scope.userId,
                    companion_id: scope.companionId,
                    code: item.code
                }))
            );
            if (!insertError) {
                for (const item of newly) unlockedCodes.add(item.code);
            } else {
                newly = [];
            }
        }
        cache.set(key, { at: Date.now(), newly: [], codes: Array.from(unlockedCodes) });
        return { newly, unlocked: Array.from(unlockedCodes) };
    }

    // 合并系统目录与用户自定义成就。
    async function list(scope) {
        const { data: systemRows, error } = await database
            .from("achievements")
            .select("code, unlocked_at")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId);
        if (error) throw error;
        const unlocked = new Map((systemRows || []).map((row) => [row.code, row.unlocked_at]));
        const { data: customRows, error: customError } = await database
            .from("user_achievements")
            .select("*")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .order("created_at", { ascending: true });
        if (customError) throw customError;
        const system = ACHIEVEMENT_CATALOG.map((item) => ({
            ...item,
            custom: false,
            unlocked: unlocked.has(item.code),
            unlocked_at: unlocked.get(item.code) || null
        }));
        const custom = (customRows || []).map((row) => ({
            code: row.code || "custom:" + row.id,
            id: row.id,
            title: row.title,
            description: row.description,
            emoji: row.emoji || "🏆",
            category: row.category || "自定义",
            custom: true,
            created_by: row.created_by,
            unlocked: row.unlocked === true,
            unlocked_at: row.unlocked_at || null
        }));
        return [...system, ...custom];
    }

    async function define(scope, values = {}) {
        const title = Array.from(String(values.title || "").replace(/\s+/g, " ").trim()).slice(0, 40).join("");
        if (!title) {
            const error = new Error("请给成就起个名字。");
            error.status = 400;
            error.code = "achievement_title_required";
            throw error;
        }
        const { data, error } = await database
            .from("user_achievements")
            .insert({
                user_id: scope.userId,
                companion_id: scope.companionId,
                code: "custom:" + require("crypto").randomUUID(),
                title,
                description: Array.from(String(values.description || "").replace(/\s+/g, " ").trim()).slice(0, 120).join(""),
                emoji: Array.from(String(values.emoji || "🏆").trim()).slice(0, 4).join("") || "🏆",
                category: Array.from(String(values.category || "自定义").trim()).slice(0, 20).join("") || "自定义",
                created_by: values.created_by === "ai" ? "ai" : "user"
            })
            .select("*")
            .single();
        if (error) throw error;
        return data;
    }

    async function unlock(scope, code) {
        const id = String(code || "").trim();
        if (!id) {
            const error = new Error("缺少成就编号。");
            error.status = 400;
            error.code = "achievement_code_required";
            throw error;
        }
        const catalogItem = ACHIEVEMENT_CATALOG.find((item) => item.code === id);
        if (catalogItem) {
            const { data: existing } = await database
                .from("achievements")
                .select("id")
                .eq("user_id", scope.userId)
                .eq("companion_id", scope.companionId)
                .eq("code", id)
                .maybeSingle();
            if (existing) return { code: id, already: true };
            const { data, error } = await database
                .from("achievements")
                .insert({ user_id: scope.userId, companion_id: scope.companionId, code: id })
                .select("*")
                .single();
            if (error) throw error;
            return { code: id, unlocked: true };
        }
        const { data: custom, error: findError } = await database
            .from("user_achievements")
            .select("*")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .eq("code", id)
            .maybeSingle();
        if (findError) throw findError;
        if (!custom) {
            const error = new Error("没有找到这条成就。");
            error.status = 404;
            error.code = "achievement_missing";
            throw error;
        }
        if (custom.unlocked) return { code: id, already: true };
        const { data, error } = await database
            .from("user_achievements")
            .update({ unlocked: true, unlocked_at: new Date().toISOString() })
            .eq("id", custom.id)
            .select("*")
            .single();
        if (error) throw error;
        return { code: id, unlocked: true, custom: data };
    }

    async function removeCustom(scope, achievementId) {
        const { data, error } = await database
            .from("user_achievements")
            .delete()
            .eq("id", achievementId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .select("id")
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            const error = new Error("没有找到这条自定义成就。");
            error.status = 404;
            error.code = "achievement_missing";
            throw error;
        }
        return { removed: data.id };
    }

    function buildContext(result) {
        const parts = [];
        const newly = Array.isArray(result?.newly) ? result.newly : [];
        if (newly.length > 0) {
            parts.push(
                "【新解锁隐藏成就（刚刚达成）】",
                ...newly.map((item) => item.emoji + " " + item.title + "：" + item.description),
                "在合适时机轻描淡写地恭喜用户（比如“悄悄说，我们解锁了一个新成就”），不要生硬播报。"
            );
        }
        const unlockedCodes = Array.isArray(result?.unlocked) ? result.unlocked : [];
        if (unlockedCodes.length > 0) {
            const titles = unlockedCodes
                .map((code) => {
                    const catalog = ACHIEVEMENT_CATALOG.find((item) => item.code === code);
                    return catalog ? catalog.emoji + " " + catalog.title : "";
                })
                .filter(Boolean);
            if (titles.length > 0) {
                parts.push(
                    "【成就墙（你们一起达成的目标）】共 " + titles.length + " 个：" + titles.join("、") + "。",
                    "用户提到成就、里程碑或回忆时，可以自然呼应这些共同经历，但不要主动频繁播报。"
                );
            }
        }
        return parts.join("\n");
    }

    return { check, list, define, unlock, removeCustom, buildContext };
}

module.exports = { createAchievementsService, ACHIEVEMENT_CATALOG };
