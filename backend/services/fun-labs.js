"use strict";

// 弹幕共读（B2）+ 默契度挑战存档（A3）。

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

const BVID_PATTERN = /^BV[0-9A-Za-z]{6,12}$/i;

function createFunLabsService({ database, fetchImpl } = {}) {
    if (!database?.from) {
        throw new TypeError("fun labs service requires a Supabase database client");
    }
    const fetcher = fetchImpl || ((url, options) => fetch(url, options));

    async function readDanmaku(bvid, { sampleLimit = 80 } = {}) {
        const id = cleanText(bvid, 16);
        if (!BVID_PATTERN.test(id)) {
            throw requestError(400, "danmaku_bvid_invalid", "视频编号（bvid）格式不正确。");
        }
        const viewResponse = await fetcher(
            "https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(id),
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                    Referer: "https://www.bilibili.com/"
                }
            }
        );
        if (!viewResponse.ok) {
            throw requestError(502, "danmaku_view_unavailable", "B站视频信息暂时获取失败。");
        }
        const viewJson = await viewResponse.json().catch(() => null);
        const data = viewJson?.data || {};
        const cid = Number(data.cid);
        if (!cid || viewJson?.code !== 0) {
            throw requestError(404, "danmaku_video_not_found", "没有找到这个视频。");
        }
        const dmResponse = await fetcher(
            "https://api.bilibili.com/x/v1/dm/list.so?oid=" + cid,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                    Referer: "https://www.bilibili.com/"
                }
            }
        );
        const xml = await dmResponse.text().catch(() => "");
        const texts = [];
        const matcher = /<d\s+p="[^"]*">([^<]*)<\/d>/g;
        let match;
        while ((match = matcher.exec(xml)) !== null && texts.length < sampleLimit) {
            const text = cleanText(match[1], 120);
            if (text) texts.push(text);
        }
        return {
            bvid: id,
            title: cleanText(data.title, 200),
            cid,
            danmaku_sample: texts,
            note: "弹幕样本按时间顺序截取前 " + sampleLimit + " 条。"
        };
    }

    async function saveCompatibility(scope, values = {}) {
        if (!scope?.userId || !scope?.companionId) {
            throw requestError(401, "compatibility_auth_required", "默契度挑战需要登录态。");
        }
        const score = Number(values.score);
        if (!Number.isFinite(score)) {
            throw requestError(400, "compatibility_score_invalid", "默契分必须是 0-100 的数字。");
        }
        const clamped = Math.max(0, Math.min(100, Math.round(score)));
        const { data, error } = await database
            .from("compatibility_records")
            .insert({
                user_id: scope.userId,
                companion_id: scope.companionId,
                score: clamped,
                comment: cleanText(values.comment, 300)
            })
            .select("*")
            .single();
        if (error) throw error;
        const { data: history, error: historyError } = await database
            .from("compatibility_records")
            .select("score, comment, created_at")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .order("created_at", { ascending: false })
            .limit(5);
        if (historyError) throw historyError;
        const scores = (history || []).map((row) => row.score);
        const best = scores.length ? Math.max(...scores) : clamped;
        const average = scores.length
            ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
            : clamped;
        return { record: data, history: history || [], best, average, times: scores.length };
    }

    async function listCompatibility(scope) {
        const { data, error } = await database
            .from("compatibility_records")
            .select("*")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .order("created_at", { ascending: false })
            .limit(30);
        if (error) throw error;
        return data || [];
    }

    return { readDanmaku, saveCompatibility, listCompatibility };
}

module.exports = { createFunLabsService };
