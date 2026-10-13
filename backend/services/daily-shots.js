"use strict";

// 每日一拍（A2）：每天一张照片 + 一句话备注，AI 在聊天里自然评价。

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

function localDateText(now = new Date()) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
}

function createDailyShotsService({ database } = {}) {
    if (!database?.from) {
        throw new TypeError("daily shots service requires a Supabase database client");
    }

    async function add(scope, values = {}) {
        if (!scope?.userId || !scope?.companionId) {
            throw requestError(401, "daily_shots_auth_required", "每日一拍需要登录态。");
        }
        const today = localDateText();
        const payload = {
            user_id: scope.userId,
            companion_id: scope.companionId,
            shot_date: today,
            image_path: cleanText(values.image_path || values.imagePath, 500),
            note: cleanText(values.note, 300)
        };
        const { data: existing, error: readError } = await database
            .from("daily_shots")
            .select("id, note, image_path")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .eq("shot_date", today)
            .maybeSingle();
        if (readError) throw requestError(503, "daily_shots_read_failed", "每日一拍读取失败，暂未保存新照片，请稍后重试。");
        if (existing) {
            const { data: updated, error } = await database
                .from("daily_shots")
                .update({
                    note: payload.note || existing.note,
                    image_path: payload.image_path || existing.image_path
                })
                .eq("id", existing.id)
                .eq("user_id", scope.userId)
                .eq("companion_id", scope.companionId)
                .eq("shot_date", today)
                .select("*")
                .single();
            if (error) throw requestError(503, "daily_shots_save_failed", "每日一拍更新失败，请稍后重试。");
            if (!updated?.id || updated.user_id !== scope.userId || updated.companion_id !== scope.companionId || updated.shot_date !== today) throw requestError(502, "daily_shots_receipt_invalid", "未收到每日一拍保存回执，请刷新确认，暂勿重复提交。");
            return { ...updated, replaced: true };
        }
        const { data, error } = await database
            .from("daily_shots")
            .insert(payload)
            .select("*")
            .single();
        if (error?.code === "23505") throw requestError(409, "daily_shots_changed", "今天的照片刚刚更新，请刷新后决定是否替换。");
        if (error) throw requestError(503, "daily_shots_save_failed", "每日一拍保存失败，请稍后重试。");
        if (!data?.id || data.user_id !== scope.userId || data.companion_id !== scope.companionId || data.shot_date !== today) throw requestError(502, "daily_shots_receipt_invalid", "未收到每日一拍保存回执，请刷新确认，暂勿重复提交。");
        return data;
    }

    async function today(scope) {
        const { data, error } = await database
            .from("daily_shots")
            .select("*")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .eq("shot_date", localDateText())
            .maybeSingle();
        if (error) throw requestError(503, "daily_shots_read_failed", "今天的照片读取失败，请稍后重试。");
        return data || null;
    }

    async function recent(scope, limit = 14) {
        const { data, error } = await database
            .from("daily_shots")
            .select("*")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .order("shot_date", { ascending: false })
            .limit(Math.max(1, Math.min(60, Number(limit) || 14)));
        if (error) throw requestError(503, "daily_shots_history_read_failed", "照片记录读取失败，请稍后重试。");
        return data || [];
    }

    function buildContext(todayShot) {
        if (!todayShot) return "";
        return [
            "【每日一拍】",
            "用户今天已经拍过一张每日一拍" + (todayShot.note ? "，备注：" + todayShot.note : "。"),
            "用户提到这张照片时可以自然评价；不要没话找话。"
        ].join("");
    }

    return { add, today, recent, buildContext };
}

module.exports = { createDailyShotsService, localDateText };
