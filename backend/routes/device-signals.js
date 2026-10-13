const express = require("express");
const { requireRequestScope } = require("../services/request-scope");
const { digestEvent } = require("../services/device-digester");
const { scheduleProactiveMessageEvaluation } = require("../services/tenant-proactive-message");

const APP_STATES = new Set(["foreground", "background"]);
const TRIGGERS = new Set(["launch", "scene_change", "tab_change", "charging", "probe", "battery"]);

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function boundedNumber(value, field, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
        throw requestError(400, "device_state_invalid", `${field} 超出允许范围。`);
    }
    return Math.round(number);
}

function sanitizeEvent(body = {}) {
    const event = {};
    if (body.battery_pct !== undefined && body.battery_pct !== null && body.battery_pct !== "") {
        event.battery_pct = boundedNumber(body.battery_pct, "battery_pct", 0, 100);
    }
    if (body.charging !== undefined) event.charging = body.charging === true || body.charging === "true";
    if (body.low_power !== undefined) event.low_power = body.low_power === true || body.low_power === "true";
    const appState = String(body.app_state || "").trim().toLowerCase();
    if (appState && !APP_STATES.has(appState)) {
        throw requestError(400, "device_state_invalid", "app_state 只能是 foreground 或 background。");
    }
    if (appState) event.app_state = appState;
    const tab = String(body.tab || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (tab) event.tab = tab;
    const trigger = String(body.trigger || "probe").trim().toLowerCase();
    if (!TRIGGERS.has(trigger)) {
        throw requestError(400, "device_state_invalid", "trigger 不在允许列表。");
    }
    event.trigger = trigger;
    if (body.emulator === true || body.emulator === "true") event.emulator = true;
    if (body.ts) {
        const ts = Date.parse(body.ts);
        if (!Number.isFinite(ts)) throw requestError(400, "device_state_invalid", "ts 时间格式不正确。");
        event.client_ts = new Date(ts).toISOString();
    }
    return event;
}

function createDeviceSignalsRouter(services = {}) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try {
            requireRequestScope(req);
            next();
        } catch (error) {
            next(error);
        }
    });

    router.post("/state", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const event = sanitizeEvent(req.body || {});
            const db = scope.db;
            const now = new Date();

            const { data: latestRow } = await db
                .from("device_latest")
                .select("snapshot")
                .eq("user_id", scope.userId)
                .eq("companion_id", scope.companionId)
                .maybeSingle();
            const latest = latestRow?.snapshot && typeof latestRow.snapshot === "object"
                ? latestRow.snapshot
                : {};

            const lastMessageRole = await db
                .from("messages")
                .select("role")
                .eq("user_id", scope.userId)
                .eq("companion_id", scope.companionId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
                .then((result) => result.data?.role || "")
                .catch(() => "");

            const digested = digestEvent({ latest, event, now, lastMessageRole });
            const nextSnapshot = { ...latest, ...digested.updates };
            const injectedIds = [];
            for (const inject of digested.injects) {
                const { data, error } = await db
                    .from("device_injects")
                    .insert({
                        user_id: scope.userId,
                        companion_id: scope.companionId,
                        tag: inject.tag,
                        text: inject.text
                    })
                    .select("id")
                    .single();
                if (error) throw error;
                injectedIds.push(data.id);
            }

            await db.from("device_events").insert({
                user_id: scope.userId,
                companion_id: scope.companionId,
                event: { ...event, ...(digested.shadow.length ? { shadow: digested.shadow } : {}) }
            });
            const { data, error } = await db
                .from("device_latest")
                .upsert({
                    user_id: scope.userId,
                    companion_id: scope.companionId,
                    snapshot: nextSnapshot,
                    updated_at: now.toISOString()
                }, { onConflict: "user_id,companion_id" });
            if (error) throw error;

            // 通道乙：有注入时排期主动消息评估（AI 自行决定是否开口）。
            let proactive = { scheduled: false, reason: "no_inject" };
            if (digested.injects.length > 0 && typeof services.getSettings === "function") {
                try {
                    const settings = await services.getSettings(db);
                    if (settings?.push_enabled === true) {
                        proactive = await scheduleProactiveMessageEvaluation({
                            database: db,
                            reconciliationId: `device:${digested.injects[0].tag}`,
                            delayMinutes: 1
                        });
                    } else {
                        proactive = { scheduled: false, reason: "push_disabled" };
                    }
                } catch (error) {
                    proactive = { scheduled: false, reason: String(error?.message || "").slice(0, 80) };
                }
            }

            res.status(201).json({
                ok: true,
                injects: digested.injects.map((inject) => inject.tag),
                inject_ids: injectedIds,
                proactive
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/latest", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const { data } = await scope.db
                .from("device_latest")
                .select("snapshot, updated_at")
                .eq("user_id", scope.userId)
                .eq("companion_id", scope.companionId)
                .maybeSingle();
            res.json({ latest: data?.snapshot || null, updated_at: data?.updated_at || null });
        } catch (error) {
            next(error);
        }
    });

    router.get("/injects", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const { data } = await scope.db
                .from("device_injects")
                .select("id, tag, text, created_at")
                .eq("user_id", scope.userId)
                .eq("companion_id", scope.companionId)
                .eq("delivered", false)
                .order("created_at", { ascending: false })
                .limit(10);
            res.json({ injects: data || [] });
        } catch (error) {
            next(error);
        }
    });

    router.post("/injects/ack", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const ids = Array.isArray(req.body?.ids)
                ? req.body.ids.slice(0, 50).map((id) => String(id).trim()).filter(Boolean)
                : [];
            if (!ids.length) {
                const error = new Error("请提供要确认的 inject id 列表。");
                error.status = 400;
                error.code = "device_inject_ids_required";
                throw error;
            }
            const { data, error } = await scope.db
                .from("device_injects")
                .update({ delivered: true, delivered_at: new Date().toISOString() })
                .in("id", ids)
                .eq("user_id", scope.userId)
                .eq("companion_id", scope.companionId)
                .select("id");
            if (error) throw error;
            res.json({ acked: (data || []).length });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = { createDeviceSignalsRouter, sanitizeEvent };
