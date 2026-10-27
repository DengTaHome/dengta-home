const express = require("express");
const { requireRequestScope } = require("../services/request-scope");
const { normalizeSessionId } = require("../services/co-watch-sessions");

function error(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
function noStore(res) { res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }); }
function receiverToken(req) {
    const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    return bearer || String(req.headers["x-dengta-receiver-token"] || "").trim();
}
function receiverPosition(row, now = Date.now()) {
    const position = Math.max(0, Number(row?.media_position_seconds) || 0);
    if (row?.playback_state !== "playing") return position;
    const updatedAt = Date.parse(row?.updated_at || "");
    return Number.isFinite(updatedAt) ? position + Math.max(0, now - updatedAt) / 1000 : position;
}
function createCastReceiverRouter({ receiver, database, limiter, includeControl = true } = {}) {
    if (!receiver) throw new Error("receiver service is required");
    const router = express.Router();
    const limit = limiter || (() => true);
    const ackSequences = new Map();
    router.post("/pair", async (req, res, next) => {
        try {
            noStore(res);
            if (!limit(req)) throw error(429, "cast_pair_unavailable", "配对暂不可用。");
            const body = req.body || {};
            const id = normalizeSessionId(body.session_id);
            const code = String(body.pairing_code || "").toUpperCase();
            const db = database;
            const found = await db.from("co_watch_sessions").select("id, user_id, companion_id, status, session_mode, receiver_pairing_used, receiver_pairing_failed_attempts, receiver_pairing_locked_until").eq("id", id).maybeSingle();
            if (found.error) throw found.error;
            const locked = Date.parse(found.data?.receiver_pairing_locked_until || "") > Date.now();
            const valid = found.data && found.data.status === "active" && found.data.session_mode === "direct_media" && !found.data.receiver_pairing_used && !locked && code === receiver.pairingCode(id);
            if (!valid) {
                if (found.data && !found.data.receiver_pairing_used && !locked) {
                    const failures = Number(found.data.receiver_pairing_failed_attempts) + 1;
                    await db.from("co_watch_sessions").update({ receiver_pairing_failed_attempts: failures, receiver_pairing_locked_until: failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null }).eq("id", id).eq("receiver_pairing_used", false);
                }
                throw error(400, "cast_pair_invalid", "配对失败。");
            }
            const token = receiver.createToken();
            const marked = await db.from("co_watch_sessions").update({ receiver_pairing_used: true }).eq("id", id).eq("receiver_pairing_used", false).select("id").maybeSingle();
            if (marked.error) throw marked.error;
            if (!marked.data) throw error(400, "cast_pair_invalid", "配对失败。");
            const grant = await db.from("co_watch_receiver_grants").insert({ user_id: found.data.user_id, companion_id: found.data.companion_id, session_id: id, token_hash: token.tokenHash, expires_at: new Date(Date.now() + receiver.tokenTtl).toISOString() }).select("id, expires_at").single();
            if (grant.error) throw grant.error;
            res.json({ receiver_token: token.token, expires_at: grant.data.expires_at });
        } catch (e) { next(e); }
    });
    router.get("/session", async (req, res, next) => {
        try {
            noStore(res);
            const hash = receiver.hashToken(receiverToken(req));
            const grant = await database.from("co_watch_receiver_grants").select("session_id, expires_at, revoked_at").eq("token_hash", hash).maybeSingle();
            if (grant.error) throw grant.error;
            if (!grant.data || grant.data.revoked_at || Date.parse(grant.data.expires_at) <= Date.now()) throw error(401, "cast_token_invalid", "接收端凭据无效。");
            const session = await database.from("co_watch_sessions").select("id, status, session_mode, title, playback_revision, playback_state, media_position_seconds, media_url_ciphertext, updated_at, receiver_state, receiver_acknowledged, receiver_position_seconds, receiver_reported_at").eq("id", grant.data.session_id).maybeSingle();
            if (session.error) throw session.error;
            if (!session.data || session.data.status !== "active") throw error(401, "cast_token_invalid", "接收端凭据无效。");
            res.json({ session: { id: session.data.id, status: session.data.status, session_mode: session.data.session_mode, title: session.data.title || "", playback_revision: Number(session.data.playback_revision) || 0, playback_state: session.data.playback_state, media_position_seconds: receiverPosition(session.data), media_url: receiver.decryptMediaUrl(session.data.media_url_ciphertext), receiver: receiver.publicReceiverState(session.data) } });
        } catch (e) { next(e); }
    });
    router.post("/ack", async (req, res, next) => {
        try {
            noStore(res);
            const hash = receiver.hashToken(receiverToken(req));
            const grant = await database.from("co_watch_receiver_grants").select("session_id, expires_at, revoked_at").eq("token_hash", hash).maybeSingle();
            if (grant.error) throw grant.error;
            if (!grant.data || grant.data.revoked_at || Date.parse(grant.data.expires_at) <= Date.now()) throw error(401, "cast_token_invalid", "接收端凭据无效。");
            const body = req.body || {};
            const position = Math.max(0, Number(body.position_seconds ?? body.media_position_seconds) || 0);
            const sequenceValue = Number(body.sequence);
            const sequence = Number.isSafeInteger(sequenceValue) && sequenceValue >= 0 ? sequenceValue : null;
            const current = await database.from("co_watch_sessions").select("receiver_state, receiver_acknowledged, receiver_position_seconds, receiver_reported_at").eq("id", grant.data.session_id).eq("status", "active").maybeSingle();
            if (current.error) throw current.error;
            if (!current.data) throw error(401, "cast_token_invalid", "接收端凭据无效。");
            const previousSequence = ackSequences.get(hash) ?? -1;
            if (sequence !== null && sequence <= previousSequence) {
                return res.json({ receiver: receiver.publicReceiverState(current.data) });
            }
            if (sequence !== null) ackSequences.set(hash, sequence);
            const updated = await database.from("co_watch_sessions").update({ receiver_state: String(body.state ?? body.playback_state ?? "idle").slice(0, 20), receiver_acknowledged: true, receiver_position_seconds: position, receiver_reported_at: new Date().toISOString() }).eq("id", grant.data.session_id).eq("status", "active").select("receiver_state, receiver_acknowledged, receiver_position_seconds, receiver_reported_at").single();
            if (updated.error && sequence !== null && ackSequences.get(hash) === sequence) {
                if (previousSequence < 0) ackSequences.delete(hash);
                else ackSequences.set(hash, previousSequence);
            }
            if (updated.error) throw updated.error;
            res.json({ receiver: receiver.publicReceiverState(updated.data) });
        } catch (e) { next(e); }
    });
    // 注意：server.js 以 includeControl: false 挂载本路由，这段控制端接口在
// 线上进程里不会被注册。配对码的真实入口是
// POST /api/v2/co-watch/sessions/:sessionId/pairing-code（routes/co-watch.js）。
// 保留代码是为了将来可能切回 receiver-only 之外的用法；改动前先确认调用方。
if (includeControl) router.post("/sessions/:sessionId/pairing-code", async (req, res, next) => {
        try { const scope = requireRequestScope(req); const id = normalizeSessionId(req.params.sessionId); const found = await scope.db.from("co_watch_sessions").select("id, status, session_mode").eq("id", id).maybeSingle(); if (found.error) throw found.error; if (!found.data || found.data.status !== "active" || found.data.session_mode !== "direct_media") throw error(409, "cast_pair_unavailable", "该会话不可配对。"); noStore(res); res.json({ pairing_code: receiver.pairingCode(id), session_id: id, expires_at: receiver.pairingExpiresAt() }); } catch (e) { next(e); }
        });
    return router;
}
module.exports = { createCastReceiverRouter, receiverPosition, receiverToken };
