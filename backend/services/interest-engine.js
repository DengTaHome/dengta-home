"use strict";

const { createHash, randomUUID } = require("node:crypto");

// 兴趣引擎(差距清单第 1+2+3 项):一起看行为采集 → 兴趣画像 → 主动推荐。
// 推荐复用 web-explorer 的 B 站搜索,理由来自用户真实观看记录。

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

const STOP_WORDS = new Set([
    "的", "了", "是", "和", "与", "在", "我", "你", "他", "她", "它", "们", "这", "那",
    "有", "就", "都", "而", "及", "或", "一个", "这个", "那个", "什么", "怎么", "视频",
    "第", "集", "上", "中", "下", "版", "官方", "合集", "完整", "高清", "电影", "歌曲",
    "音乐", "MV", "Live", "纯享", "片段", "预告", "解读", "盘点", "混剪"
]);

function extractTopics(title) {
    const text = String(title || "").toLowerCase();
    // 常见 B 站标题分隔符
    const parts = text.split(/[【】\[\]()（）:：|\-—\/\\]/).filter(Boolean);
    const tokens = [];
    for (const part of parts) {
        for (const token of part.split(/[\s,，。;；!！?？]+/)) {
            const cleaned = token.replace(/[^\u4e00-\u9fa5a-z0-9+]/g, "").trim();
            if (cleaned.length < 2 || cleaned.length > 14) continue;
            if (STOP_WORDS.has(cleaned)) continue;
            if (/^\d+$/.test(cleaned)) continue;
            tokens.push(cleaned);
        }
    }
    return tokens;
}

function createInterestEngine({ database, explorer } = {}) {
    if (!database?.from) throw new TypeError("interest engine requires a Supabase database client");
    const profileJobs = new Map();

    async function refreshInOrder(scope) {
        const key = JSON.stringify([scope.userId, scope.companionId]);
        const previous = profileJobs.get(key) || Promise.resolve();
        const current = previous.catch(() => {}).then(() => refreshProfile(scope));
        profileJobs.set(key, current);
        try { return await current; }
        finally { if (profileJobs.get(key) === current) profileJobs.delete(key); }
    }

    async function recordWatch(scope, input = {}) {
        if (!scope?.userId || !scope?.companionId) throw requestError(401, "watch_auth_required", "保存观看记录需要登录。");
        const requestId = input.request_id == null ? randomUUID() : String(input.request_id).trim().toLowerCase();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) {
            throw requestError(400, "watch_request_id_invalid", "观看请求编号无效，请重新操作。");
        }
        const title = cleanText(input.title, 300);
        if (!title) throw requestError(400, "watch_title_required", "请先提供影片或歌曲名称。");
        const kind = input.kind === "music" ? "music" : "video";
        // The existing primary key gives retries durable, account/companion-scoped deduplication.
        const digest = createHash("sha256").update(JSON.stringify(["watch-v1", scope.userId, scope.companionId, requestId])).digest("hex");
        const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
        const payload = {
            id, user_id: scope.userId, companion_id: scope.companionId, kind, title,
            source_url: cleanText(input.source_url, 1000),
            watched_seconds: Math.max(0, Math.min(86400, Math.round(Number(input.watched_seconds) || 0)))
        };
        const { data: inserted, error: insertError } = await database
            .from("watch_events")
            .upsert(payload, { onConflict: "id", ignoreDuplicates: true }).select("*").maybeSingle();
        if (insertError) throw requestError(503, "watch_save_failed", "观看记录保存失败，请使用同一请求重试。");
        let saved = inserted;
        if (!saved) {
            const { data, error } = await database.from("watch_events").select("*")
                .eq("id", id).eq("user_id", scope.userId).eq("companion_id", scope.companionId).maybeSingle();
            if (error) throw requestError(503, "watch_receipt_read_failed", "无法确认观看记录是否保存，请使用同一请求重试。");
            saved = data;
        }
        if (!saved?.id || saved.id !== id || saved.user_id !== scope.userId || saved.companion_id !== scope.companionId) {
            throw requestError(502, "watch_receipt_invalid", "未收到有效观看记录回执，请使用同一请求重试。");
        }
        if (["kind", "title", "source_url", "watched_seconds"].some(field => saved[field] !== payload[field])) {
            throw requestError(409, "watch_request_conflict", "这次请求编号已保存其他观看内容，请为新内容创建新请求。");
        }
        try {
            await refreshInOrder(scope);
            return { recorded: true, event_id: id, request_id: requestId, replayed: !inserted, profile_updated: true };
        } catch (error) {
            return { recorded: true, event_id: id, request_id: requestId, replayed: !inserted, profile_updated: false,
                warning: { code: /^interest_[a-z_]{1,60}$/.test(error.code || "") ? error.code : "interest_profile_refresh_failed", message: "观看记录已保存，但兴趣推荐尚未更新。可用同一请求重试，不会重复记录。" } };
        }
    }

    async function refreshProfile(scope) {
        const { data: events, error } = await database
            .from("watch_events")
            .select("title")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .order("created_at", { ascending: false })
            .limit(60);
        if (error) throw requestError(503, "interest_events_read_failed", "无法读取观看记录，请稍后重试。");
        const weights = new Map();
        for (const event of events || []) {
            for (const token of extractTopics(event.title)) {
                weights.set(token, (weights.get(token) || 0) + 1);
            }
        }
        const interests = Array.from(weights.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([term, count]) => ({ term, count }));
        const values = {
            user_id: scope.userId,
            companion_id: scope.companionId,
            interests,
            updated_at: new Date().toISOString()
        };
        const { data: receipt, error: profileError } = await database.from("interest_profiles")
            .upsert(values, { onConflict: "user_id,companion_id" }).select("id").single();
        if (profileError) throw requestError(503, "interest_profile_save_failed", "兴趣推荐更新失败，请稍后重试。");
        if (!receipt?.id) throw requestError(502, "interest_profile_receipt_invalid", "未收到兴趣推荐保存回执，请稍后重试。");
        return values;
    }

    async function interests(scope) {
        const { data, error } = await database
            .from("interest_profiles")
            .select("interests, updated_at")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .maybeSingle();
        if (error) throw requestError(503, "interest_profile_read_failed", "兴趣档案读取失败，请稍后重试。");
        const { data: recent, error: recentError } = await database
            .from("watch_events")
            .select("title, source_url, kind, watched_seconds, created_at")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .order("created_at", { ascending: false })
            .limit(10);
        if (recentError) throw requestError(503, "interest_history_read_failed", "最近观看记录读取失败，请稍后重试。");
        return {
            interests: Array.isArray(data?.interests) ? data.interests : [],
            recent: recent || [],
            updated_at: data?.updated_at || null
        };
    }

    function buildContext(result) {
        const terms = (result?.interests || []).map((item) => item.term).slice(0, 6);
        const recent = (result?.recent || []).slice(0, 3).map((item) => item.title).filter(Boolean);
        if (terms.length === 0 && recent.length === 0) return "";
        const lines = ["【用户兴趣画像(来自一起看观看记录,可信参考)】"];
        if (terms.length) lines.push("近期兴趣关键词:" + terms.join("、"));
        if (recent.length) lines.push("最近在看:" + recent.join(";"));
        lines.push("聊天时可自然呼应这些兴趣;主动推荐内容前可先用 bili_recommend 工具。");
        return lines.join("\n");
    }

    // 基于画像主动推荐 B 站视频,带推荐理由。
    // 换一批：每次随机轮换兴趣关键词 + 排除已展示过的视频 + 打乱顺序,保证点"换一批"真的会换。
    async function recommendBili(scope, input = {}) {
        const profile = await interests(scope);
        const terms = profile.interests.map((item) => item.term).filter(Boolean);
        if (terms.length === 0) {
            throw requestError(400, "interest_profile_empty", "还没有足够的观看记录来了解你的口味,先一起看几个视频吧。");
        }
        const limit = Math.min(6, Math.max(1, Number(input.limit) || 4));
        const exclude = Array.isArray(input.exclude)
            ? input.exclude.filter((value) => /^BV[0-9A-Za-z]{10}$/.test(String(value)))
            : [];
        const keywordPool = terms.slice(0, 6);
        const requested = String(input.keyword || "").trim();
        const keyword = requested || keywordPool[Math.floor(Math.random() * keywordPool.length)];
        const search = explorer?.biliSearch
            ? await explorer.biliSearch(keyword, Math.max(10, limit * 2))
            : { videos: [] };
        const fresh = (search.videos || []).filter((video) => !exclude.includes(String(video.bvid || "")));
        const shuffled = fresh
            .slice()
            .sort(() => Math.random() - 0.5)
            .slice(0, limit);
        return {
            based_on: terms,
            keyword,
            reason: "因为你最近在看" + terms.slice(0, 3).join("、") + ",所以为你找这些。",
            videos: shuffled
        };
    }

    return { recordWatch, interests, recommendBili, buildContext };
}

module.exports = { createInterestEngine, extractTopics };
