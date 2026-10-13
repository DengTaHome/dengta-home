const { randomBytes } = require("node:crypto");
const { cleanText, boundedNumber, requestError } = require("./co-watch-sessions");

/**
 * 放映厅实时事件（SSE 推送）。
 *
 * 参考 niknight / B站放映厅：创建房间后，所有成员通过 SSE 长连接接收
 * 播放同步（play/pause/seek）、聊天消息、成员进出等实时事件。
 * 相比 WebSocket 无额外依赖、兼容现有鉴权中间件。
 */
const roomEventHub = {
    clients: new Map(), // roomId -> Set<express.Response>
    scopes: new WeakMap(),
    subscribe(roomId, res, scope) {
        let set = roomEventHub.clients.get(roomId);
        if (!set) {
            set = new Set();
            roomEventHub.clients.set(roomId, set);
        }
        set.add(res);
        roomEventHub.scopes.set(res, scope);
        const done = () => {
            set.delete(res);
            if (set.size === 0 && roomEventHub.clients.get(roomId) === set) roomEventHub.clients.delete(roomId);
        };
        res.on("close", done);
        res.on("finish", done);
        // 防止客户端断开后 write 触发未捕获的 'error' 事件导致进程崩溃
        res.on("error", () => done());
    },
    close(roomId, scope = null) {
        const set = roomEventHub.clients.get(roomId);
        if (!set) return;
        for (const res of [...set]) {
            const owner = roomEventHub.scopes.get(res);
            if (scope && (owner?.userId !== scope.userId || owner?.companionId !== scope.companionId)) continue;
            set.delete(res);
            try { if (!res.writableEnded) res.end(); }
            catch { res.emit("close"); }
        }
        if (set.size === 0) roomEventHub.clients.delete(roomId);
    },
    publish(roomId, event) {
        const set = roomEventHub.clients.get(roomId);
        if (!set || set.size === 0) return;
        const payload = `event: ${event.event || "message"}\ndata: ${JSON.stringify(event.data || {})}\n\n`;
        for (const res of set) {
            try {
                if (!res.writableEnded) {
                    res.write(payload);
                } else {
                    set.delete(res);
                }
            } catch (ignored) {
                set.delete(res);
                res.emit("close");
            }
        }
    }
};

function writeSseHeaders(res) {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
    });
    res.write("retry: 5000\n\n");
}

/** 订阅放映厅实时事件（SSE）。调用方负责鉴权校验。 */
function subscribeRoomEvents(roomId, res, scope) {
    writeSseHeaders(res);
    roomEventHub.subscribe(roomId, res, scope);
    // 定期心跳（注释行），防止 Render Free 等代理空闲超时断开 SSE
    const heartbeat = setInterval(() => {
        try {
            if (res.writableEnded) {
                clearInterval(heartbeat);
                return;
            }
            res.write(": keepalive\n\n");
        } catch (ignored) {
            clearInterval(heartbeat);
        }
    }, 20_000);
    res.on("close", () => clearInterval(heartbeat));
    res.on("finish", () => clearInterval(heartbeat));
    res.on("error", () => clearInterval(heartbeat));
}

function emitRoomEvent(type, roomId, data) {
    roomEventHub.publish(roomId, { event: type, data });
}

const ROOM_FIELDS = [
    "id", "host_user_id", "host_companion_id", "status", "title",
    "source_app", "media_url", "media_duration_seconds", "media_position_seconds",
    "playback_state", "playback_revision", "join_code", "max_participants",
    "session_id", "started_at", "ended_at", "created_at", "updated_at"
].join(", ");

const PARTICIPANT_FIELDS = [
    "id", "room_id", "user_id", "companion_id", "display_name", "ai_name",
    "role", "joined_at", "last_seen_at", "left_at"
].join(", ");

const MESSAGE_FIELDS = [
    "id", "room_id", "sender_type", "sender_name", "sender_user_id",
    "sender_companion_id", "ai_owner_companion_id", "content",
    "media_position_seconds", "created_at"
].join(", ");

function generateJoinCode() {
    const bytes = randomBytes(4);
    const code = bytes.toString("base64url").toUpperCase().slice(0, 8);
    return code.replace(/[^A-Z0-9]/g, "X").slice(0, 8);
}

function requireRoomDatabase(database) {
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A raw database is required for cross-tenant room tables.");
    }
}

function publicRoom(row) {
    if (!row) return null;
    return Object.freeze({
        id: row.id,
        hostUserId: row.host_user_id,
        hostCompanionId: row.host_companion_id,
        status: row.status,
        title: row.title || "",
        sourceApp: row.source_app || "",
        mediaUrl: row.media_url || "",
        mediaDurationSeconds: Number(row.media_duration_seconds) || 0,
        mediaPositionSeconds: Number(row.media_position_seconds) || 0,
        playbackState: row.playback_state || "paused",
        playbackRevision: Number(row.playback_revision) || 0,
        joinCode: row.join_code,
        maxParticipants: Number(row.max_participants) || 50,
        sessionId: row.session_id || null,
        startedAt: row.started_at,
        endedAt: row.ended_at || null,
        createdAt: row.created_at || row.started_at,
        updatedAt: row.updated_at || row.started_at
    });
}

async function createRoom(database, scope, input = {}) {
    requireRoomDatabase(database);
    const title = cleanText(input.title, 180);
    const sourceApp = cleanText(input.source_app || input.sourceApp, 100);
    const mediaUrl = cleanText(input.media_url || input.mediaUrl, 4096);
    const mediaDuration = boundedNumber(input.media_duration_seconds || input.mediaDurationSeconds, 0, 604800, 0);
    const maxParticipants = boundedNumber(input.max_participants || input.maxParticipants, 1, 50, 50);

    let joinCode = generateJoinCode();
    let attempts = 0;
    while (attempts < 5) {
        const { data: existing } = await database
            .from("co_watch_rooms")
            .select("id")
            .eq("join_code", joinCode)
            .eq("status", "active")
            .maybeSingle();
        if (!existing) break;
        joinCode = generateJoinCode();
        attempts++;
    }

    const { data, error } = await database
        .from("co_watch_rooms")
        .insert({
            host_user_id: scope.userId,
            host_companion_id: scope.companionId,
            title,
            source_app: sourceApp,
            media_url: mediaUrl,
            media_duration_seconds: mediaDuration,
            max_participants: maxParticipants,
            join_code: joinCode,
            session_id: input.session_id || null
        })
        .select(ROOM_FIELDS)
        .single();
    if (error) throw error;

    await database
        .from("co_watch_room_participants")
        .insert({
            room_id: data.id,
            user_id: scope.userId,
            companion_id: scope.companionId,
            display_name: cleanText(input.display_name || input.userName || "我", 100),
            ai_name: cleanText(input.ai_name || input.aiName || "伴侣", 100),
            role: "host"
        });

    return { status: "created", room: publicRoom(data) };
}

async function joinRoom(database, scope, joinCode, input = {}) {
    requireRoomDatabase(database);
    const code = cleanText(joinCode, 20).toUpperCase();
    const { data: room, error: roomError } = await database
        .from("co_watch_rooms")
        .select(ROOM_FIELDS)
        .eq("join_code", code)
        .eq("status", "active")
        .maybeSingle();
    if (roomError) throw roomError;
    if (!room) throw requestError(404, "room_not_found", "找不到这个放映厅，邀请码可能已失效。");

    const { data: existing } = await database
        .from("co_watch_room_participants")
        .select("id, left_at")
        .eq("room_id", room.id)
        .eq("user_id", scope.userId)
        .eq("companion_id", scope.companionId)
        .maybeSingle();
    if (existing && !existing.left_at) {
        return { status: "already_joined", room: publicRoom(room) };
    }
    if (existing && existing.left_at) {
        await database
            .from("co_watch_room_participants")
            .update({ left_at: null, last_seen_at: new Date().toISOString() })
            .eq("id", existing.id);
        return { status: "rejoined", room: publicRoom(room) };
    }

    const { count } = await database
        .from("co_watch_room_participants")
        .select("id", { count: "exact", head: true })
        .eq("room_id", room.id)
        .is("left_at", null);
    if (count >= room.max_participants) {
        throw requestError(409, "room_full", "放映厅已满员（最多 " + room.max_participants + " 人）。");
    }

    const { error: insertError } = await database
        .from("co_watch_room_participants")
        .insert({
            room_id: room.id,
            user_id: scope.userId,
            companion_id: scope.companionId,
            display_name: cleanText(input.display_name || input.userName || "我", 100),
            ai_name: cleanText(input.ai_name || input.aiName || "伴侣", 100),
            role: "member"
        });
    if (insertError) throw insertError;

    // 记录社交认识：新加入者与已有参与者互相认识（非关键路径）
    try {
        const { recordRoomMeeting } = require("./social-memory");
        const { data: existingParticipants } = await database
            .from("co_watch_room_participants")
            .select("user_id, companion_id, display_name, ai_name")
            .eq("room_id", room.id)
            .is("left_at", null)
            .neq("user_id", scope.userId);
        const joinerName = cleanText(input.display_name || input.userName || "我", 100);
        const joinerAiName = cleanText(input.ai_name || input.aiName || "伴侣", 100);
        for (const p of (existingParticipants || [])) {
            await recordRoomMeeting({ database, ownerCompanionId: scope.companionId,
                targetCompanionId: p.companion_id, targetUserId: p.user_id,
                targetDisplayName: p.display_name, targetAiName: p.ai_name, roomId: room.id });
            await recordRoomMeeting({ database, ownerCompanionId: p.companion_id,
                targetCompanionId: scope.companionId, targetUserId: scope.userId,
                targetDisplayName: joinerName, targetAiName: joinerAiName, roomId: room.id });
        }
    } catch (_) { /* 社交记录非关键路径，静默失败 */ }

    emitRoomEvent("participant_join", room.id, {
        userId: scope.userId,
        companionId: scope.companionId,
        displayName: cleanText(input.display_name || input.userName || "我", 100),
        role: "member"
    });
    return { status: "joined", room: publicRoom(room) };
}

async function leaveRoom(database, scope, roomId) {
    requireRoomDatabase(database);
    const { error } = await database
        .from("co_watch_room_participants")
        .update({ left_at: new Date().toISOString() })
        .eq("room_id", roomId)
        .eq("user_id", scope.userId)
        .eq("companion_id", scope.companionId)
        .is("left_at", null);
    if (error) throw error;
    roomEventHub.close(roomId, scope);
    emitRoomEvent("participant_leave", roomId, {
        userId: scope.userId,
        companionId: scope.companionId
    });
    return { status: "left" };
}

async function readRoom(database, roomId) {
    requireRoomDatabase(database);
    const { data: room, error } = await database
        .from("co_watch_rooms")
        .select(ROOM_FIELDS)
        .eq("id", roomId)
        .maybeSingle();
    if (error) throw error;
    if (!room) throw requestError(404, "room_not_found", "找不到这个放映厅。");
    return publicRoom(room);
}

/** 通过邀请码查询放映厅，附带发起人显示信息（用于邀请链接预览）。 */
async function readRoomByCode(database, code) {
    requireRoomDatabase(database);
    const { data: room, error } = await database
        .from("co_watch_rooms")
        .select(ROOM_FIELDS)
        .eq("join_code", code)
        .eq("status", "active")
        .maybeSingle();
    if (error) throw error;
    if (!room) return null;
    const pub = publicRoom(room);
    // 查询发起人参与者信息
    const { data: participants } = await database
        .from("co_watch_room_participants")
        .select("display_name, ai_name, user_id, companion_id")
        .eq("room_id", room.id)
        .eq("role", "host")
        .is("left_at", null)
        .limit(1);
    const host = participants?.[0];
    let hostDisplayId = "";
    if (host?.user_id) {
        try {
            const { data: ud } = await database
                .from("user_display_ids")
                .select("display_id")
                .eq("user_id", host.user_id)
                .maybeSingle();
            if (ud?.display_id) hostDisplayId = ud.display_id;
        } catch (_) { /* 非关键路径 */ }
    }
    const { count: participantCount, error: countError } = await database
        .from("co_watch_room_participants")
        .select("id", { count: "exact", head: true })
        .eq("room_id", room.id)
        .is("left_at", null);
    if (countError) throw countError;
    return Object.freeze({
        ...pub,
        hostDisplayName: host?.display_name || "发起人",
        hostAiName: host?.ai_name || "",
        hostDisplayId: hostDisplayId,
        participantCount: participantCount ?? 1
    });
}

async function readRoomParticipants(database, roomId) {
    requireRoomDatabase(database);
    const { data, error } = await database
        .from("co_watch_room_participants")
        .select(PARTICIPANT_FIELDS)
        .eq("room_id", roomId)
        .is("left_at", null)
        .order("joined_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => Object.freeze({
        id: row.id,
        displayName: row.display_name || "",
        aiName: row.ai_name || "",
        role: row.role || "member",
        joinedAt: row.joined_at
    }));
}

/** 校验 userId+companionId 是否为 roomId 的活跃参与者，是则返回参与者行，否则抛出 403。 */
async function requireRoomParticipant(database, roomId, userId, companionId) {
    requireRoomDatabase(database);
    if (!userId || !companionId) throw requestError(401, "auth_required", "需要登录。");
    const { data, error } = await database
        .from("co_watch_room_participants")
        .select("id, role, display_name")
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .eq("companion_id", companionId)
        .is("left_at", null)
        .maybeSingle();
    if (error) throw error;
    if (!data) throw requestError(403, "not_participant", "你不是该放映厅的参与者。");
    return data;
}

// 在修改播放状态或发送消息等函数中，调用 emitRoomEvent 通知 SSE 订阅者

async function updateRoomPlayback(database, scope, roomId, input = {}) {
    requireRoomDatabase(database);
    const { data: room, error: roomError } = await database
        .from("co_watch_rooms")
        .select("host_user_id, host_companion_id, status, playback_revision, media_position_seconds")
        .eq("id", roomId)
        .maybeSingle();
    if (roomError) throw roomError;
    if (!room) throw requestError(404, "room_not_found", "找不到这个放映厅。");
    if (room.host_user_id !== scope.userId || room.host_companion_id !== scope.companionId) {
        throw requestError(403, "room_not_host", "只有放映厅发起人可以控制播放。");
    }
    if (room.status !== "active") throw requestError(409, "room_ended", "放映厅已结束，请加入新的房间。");

    const expectedRevision = Number(input.revision ?? input.playback_revision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw requestError(400, "playback_revision_invalid", "播放状态更新需要有效的 revision。");
    }

    const values = {
        playback_state: input.playback_state === "playing" ? "playing" : "paused",
        media_position_seconds: boundedNumber(input.position_seconds ?? input.media_position_seconds, 0, 604800, Number(room.media_position_seconds) || 0),
        playback_revision: expectedRevision + 1,
        updated_at: new Date().toISOString()
    };
    const { data: updated, error } = await database
        .from("co_watch_rooms")
        .update(values)
        .eq("id", roomId)
        .eq("status", "active")
        .eq("playback_revision", expectedRevision)
        .select(ROOM_FIELDS)
        .maybeSingle();
    if (error) throw error;
    if (!updated) throw requestError(409, "playback_conflict", "播放状态已被其他客户端更新，请刷新后重试。");
    // 参照 Bili-SyncPlay：播放事件携带操作者归属（谁暂停/谁跳转），供客户端展示。
    const roomEvent = publicRoom(updated);
    emitRoomEvent("playback_sync", roomId, {
        ...roomEvent,
        actorId: scope.userId,
        actorName: cleanText(input.actor_name || (scope.companion?.name || "发起人"), 100),
        intent: input.intent || "update" // "explicit-seek" | "explicit-ratechange" | "update"
    });
    return publicRoom(updated);
}

async function sendRoomMessage(database, scope, roomId, input = {}) {
    requireRoomDatabase(database);
    const content = cleanText(input.content, 2000);
    if (!content) throw requestError(400, "message_empty", "消息不能为空。");

    const { data: room } = await database
        .from("co_watch_rooms")
        .select("id, status")
        .eq("id", roomId)
        .eq("status", "active")
        .maybeSingle();
    if (!room) throw requestError(404, "room_not_found", "放映厅未找到或已结束。");

    // 校验发送者是房间参与者
    const participant = await requireRoomParticipant(database, roomId, scope.userId, scope.companionId);

    const { data, error } = await database
        .from("co_watch_room_messages")
        .insert({
            room_id: roomId,
            sender_type: "user",
            sender_name: cleanText(input.sender_name || input.display_name || participant.display_name || "我", 100),
            sender_user_id: scope.userId,
            sender_companion_id: scope.companionId,
            ai_owner_companion_id: scope.companionId,
            content,
            media_position_seconds: boundedNumber(input.media_position_seconds, 0, 604800, 0)
        })
        .select(MESSAGE_FIELDS)
        .single();
    if (error) throw error;
    emitRoomEvent("message", roomId, Object.freeze({
        id: data.id,
        senderType: "user",
        senderName: data.sender_name,
        senderUserId: data.sender_user_id,
        senderCompanionId: data.sender_companion_id,
        aiOwner: data.ai_owner_companion_id,
        content: data.content,
        mediaPositionSeconds: Number(data.media_position_seconds) || 0,
        createdAt: data.created_at
    }));
    return Object.freeze({
        id: data.id,
        senderType: "user",
        senderName: data.sender_name,
        senderUserId: data.sender_user_id,
        senderCompanionId: data.sender_companion_id,
        aiOwner: data.ai_owner_companion_id,
        content: data.content,
        mediaPositionSeconds: Number(data.media_position_seconds) || 0,
        createdAt: data.created_at
    });
}

async function sendRoomAiMessage(database, roomId, aiName, content, mediaPositionSeconds = 0, ownerScope = null) {
    requireRoomDatabase(database);
    await requireRoomParticipant(database, roomId, ownerScope?.userId, ownerScope?.companionId);
    const { data, error } = await database
        .from("co_watch_room_messages")
        .insert({
            room_id: roomId,
            sender_type: "ai",
            sender_name: cleanText(aiName, 100),
            sender_user_id: ownerScope?.userId || null,
            sender_companion_id: ownerScope?.companionId || null,
            ai_owner_companion_id: ownerScope?.companionId || null,
            content: cleanText(content, 2000),
            media_position_seconds: boundedNumber(mediaPositionSeconds, 0, 604800, 0)
        })
        .select(MESSAGE_FIELDS)
        .single();
    if (error) throw error;
    const message = Object.freeze({
        id: data.id,
        senderType: "ai",
        senderName: data.sender_name,
        senderUserId: data.sender_user_id,
        senderCompanionId: data.sender_companion_id,
        aiOwnerCompanionId: data.ai_owner_companion_id,
        content: data.content,
        mediaPositionSeconds: Number(data.media_position_seconds) || 0,
        createdAt: data.created_at
    });
    // 实时推送给房间所有在线成员（SSE）
    emitRoomEvent("message", roomId, message);
    return message;
}

async function readRoomMessages(database, roomId, limit = 50, beforeId = null) {
    requireRoomDatabase(database);
    let builder = database
        .from("co_watch_room_messages")
        .select(MESSAGE_FIELDS)
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(Math.min(100, Math.max(1, Number(limit) || 50)));
    if (beforeId) {
        builder = builder.lt("id", Number(beforeId));
    }
    const { data, error } = await builder;
    if (error) throw error;
    return (data || []).reverse().map((row) => Object.freeze({
        id: row.id,
        senderType: row.sender_type,
        senderName: row.sender_name,
        senderUserId: row.sender_user_id,
        senderCompanionId: row.sender_companion_id,
        aiOwnerCompanionId: row.ai_owner_companion_id,
        content: row.content,
        mediaPositionSeconds: Number(row.media_position_seconds) || 0,
        createdAt: row.created_at
    }));
}

async function endRoom(database, scope, roomId) {
    requireRoomDatabase(database);
    const { data: room } = await database
        .from("co_watch_rooms")
        .select("id, host_user_id, host_companion_id")
        .eq("id", roomId)
        .maybeSingle();
    if (!room) throw requestError(404, "room_not_found", "找不到这个放映厅。");
    if (room.host_user_id !== scope.userId || room.host_companion_id !== scope.companionId) {
        throw requestError(403, "room_not_host", "只有放映厅发起人可以结束放映。");
    }
    const timestamp = new Date().toISOString();
    const { data, error } = await database
        .from("co_watch_rooms")
        .update({ status: "ended", ended_at: timestamp, updated_at: timestamp })
        .eq("id", roomId)
        .select(ROOM_FIELDS)
        .single();
    if (error) throw error;
    emitRoomEvent("room_ended", roomId, { roomId, endedAt: timestamp });
    roomEventHub.close(roomId);
    return { status: "ended", room: publicRoom(data) };
}

module.exports = {
    createRoom,
    joinRoom,
    leaveRoom,
    readRoom,
    readRoomByCode,
    readRoomParticipants,
    requireRoomParticipant,
    updateRoomPlayback,
    sendRoomMessage,
    sendRoomAiMessage,
    readRoomMessages,
    endRoom,
    publicRoom,
    subscribeRoomEvents
};
