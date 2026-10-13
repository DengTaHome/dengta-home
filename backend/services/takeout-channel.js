"use strict";

// 外卖点餐命令通道：AI 聊天工具写入命令，手机 App 轮询执行并回传结果，
// 工具调用在超时窗口内等待结果，以便 AI 在同一轮对话里给出自然回应。

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

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createTakeoutChannel({ database } = {}) {
    if (!database?.from) {
        throw new TypeError("takeout channel requires a Supabase database client");
    }

    async function readCommand(scope, commandId) {
        if (!isUuid(commandId)) {
            throw requestError(400, "takeout_command_id_invalid", "点餐命令编号格式不正确。");
        }
        const { data, error } = await database
            .from("takeout_commands")
            .select("*")
            .eq("id", commandId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function createCommand(scope, command = {}) {
        if (!scope?.userId || !scope?.companionId) {
            throw requestError(401, "takeout_auth_required", "点餐命令需要登录态。");
        }
        const requirement = cleanText(command.requirement, 1000);
        if (!requirement) {
            throw requestError(400, "takeout_requirement_required", "请说明要买什么（口味/预算/评分等要求）。");
        }
        const payload = {
            action: ["search", "order"].includes(String(command.action)) ? String(command.action) : "order",
            requirement,
            shop_name: cleanText(command.shop_name, 120),
            quantity: Number.isFinite(Number(command.quantity)) ? Math.max(1, Math.min(20, Math.round(Number(command.quantity)))) : 1,
            budget_max: Number.isFinite(Number(command.budget_max)) ? Math.max(0, Number(command.budget_max)) : null,
            note: cleanText(command.note, 500)
        };
        const { data, error } = await database
            .from("takeout_commands")
            .insert({
                user_id: scope.userId,
                companion_id: scope.companionId,
                status: "pending",
                command: payload
            })
            .select("id, status, created_at")
            .single();
        if (error) throw error;
        return { command_id: data.id, status: data.status, created_at: data.created_at };
    }

    async function waitForResult(scope, commandId, { timeoutMs = 120000, pollMs = 2000 } = {}) {
        const deadline = Date.now() + Math.min(300000, Math.max(5000, Number(timeoutMs) || 120000));
        while (Date.now() < deadline) {
            const row = await readCommand(scope, commandId);
            if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
            if (row.status === "done" || row.status === "failed" || row.status === "cancelled") {
                return { status: row.status, result: row.result || null };
            }
            await sleep(Math.min(5000, Math.max(500, Number(pollMs) || 2000)));
        }
        return { status: "pending", result: null, timed_out: true };
    }

    async function pendingCommands(scope) {
        const { data, error } = await database
            .from("takeout_commands")
            .select("id, command, progress, created_at")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            // 只下发尚未被领取的命令;卡在 executing 的命令不再重复下发,
            // 避免 App 启动即执行导致原生页面反复崩溃。
            .eq("status", "pending")
            .order("created_at", { ascending: true })
            .limit(10);
        if (error) throw error;
        return data || [];
    }

    async function ackCommand(scope, commandId) {
        const row = await readCommand(scope, commandId);
        if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
        if (row.status !== "pending") {
            throw requestError(409, "takeout_command_not_pending", "这条命令已经处理过了。");
        }
        const { data, error } = await database
            .from("takeout_commands")
            .update({
                status: "executing",
                ack_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq("id", commandId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .eq("status", "pending")
            .select("id, status")
            .maybeSingle();
        if (error) throw error;
        if (!data) throw requestError(409, "takeout_command_not_pending", "这条命令已被领取或取消，请勿重复执行。");
        return { command_id: data.id, status: data.status };
    }

    async function postProgress(scope, commandId, progress) {
        const text = cleanText(progress, 500);
        const row = await readCommand(scope, commandId);
        if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
        const { data, error } = await database
            .from("takeout_commands")
            .update({ progress: text, updated_at: new Date().toISOString() })
            .eq("id", commandId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .eq("status", "executing")
            .select("id")
            .maybeSingle();
        if (error) throw error;
        if (!data) throw requestError(409, "takeout_command_not_executing", "命令已结束，不能更新进度。");
        return { ok: true };
    }

    async function postResult(scope, commandId, result) {
        const row = await readCommand(scope, commandId);
        if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
        if (!result || typeof result !== "object" || Array.isArray(result)) {
            throw requestError(400, "takeout_result_invalid", "执行结果必须是 JSON 对象。");
        }
        if (row.status === "done") return { command_id: row.id, status: row.status };
        const { data, error } = await database
            .from("takeout_commands")
            .update({
                status: "done",
                result,
                done_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq("id", commandId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .eq("status", "executing")
            .select("id, status")
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            const current = await readCommand(scope, commandId);
            if (current?.status === "done") return { command_id: current.id, status: current.status };
            throw requestError(409, "takeout_command_not_executing", "命令已取消或结束，结果未覆盖原记录。");
        }
        return { command_id: data.id, status: data.status };
    }

    async function postFailure(scope, commandId, message) {
        const row = await readCommand(scope, commandId);
        if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
        if (row.status === "failed") return { command_id: row.id, status: row.status };
        const { data, error } = await database
            .from("takeout_commands")
            .update({
                status: "failed",
                result: { error: cleanText(message, 500) || "点餐执行失败。" },
                done_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq("id", commandId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .eq("status", "executing")
            .select("id, status")
            .maybeSingle();
        if (error) throw error;
        if (!data) throw requestError(409, "takeout_command_already_finished", "命令已结束，失败回执未覆盖执行结果。");
        return { command_id: data.id, status: data.status };
    }

    async function cancelCommand(scope, commandId) {
        const row = await readCommand(scope, commandId);
        if (!row) throw requestError(404, "takeout_command_missing", "点餐命令不存在。");
        if (!["pending", "executing"].includes(row.status)) {
            throw requestError(409, "takeout_command_not_pending", "这条命令已经处理过了。");
        }
        const { data, error } = await database
            .from("takeout_commands")
            .update({
                status: "cancelled",
                updated_at: new Date().toISOString()
            })
            .eq("id", commandId)
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .in("status", ["pending", "executing"])
            .select("id, status")
            .maybeSingle();
        if (error) throw error;
        if (!data) throw requestError(409, "takeout_command_already_finished", "命令已结束，不能再取消。");
        return { command_id: data.id, status: data.status };
    }

    return {
        ackCommand,
        cancelCommand,
        createCommand,
        pendingCommands,
        postFailure,
        postProgress,
        postResult,
        readCommand,
        waitForResult
    };
}

module.exports = { createTakeoutChannel };
