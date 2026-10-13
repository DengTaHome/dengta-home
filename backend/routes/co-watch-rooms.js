const express = require("express");
const { requireRequestScope } = require("../services/request-scope");
const {
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
    subscribeRoomEvents
} = require("../services/co-watch-rooms");

/**
 * 放映厅路由（跨租户多人一起看）。
 *
 * 注意：放映厅表（co_watch_rooms / co_watch_room_participants /
 * co_watch_room_messages）是跨租户表，必须用原始 admin Supabase（services.database）
 * 读写，不能走 scope.db（租户白名单表会自动附加 user_id 过滤）。
 * scope 只用于认证与身份（userId / companionId / role）。
 */
function createCoWatchRoomRouter(services = {}) {
    const router = express.Router();
    const rawDatabase = services.database;

    // 创建放映厅（发起人）
    router.post("/rooms", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await createRoom(rawDatabase, scope, req.body || {});
            res.status(result.status === "created" ? 201 : 200).json(result);
        } catch (error) { next(error); }
    });

    // 通过邀请码加入放映厅
    router.post("/rooms/join", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const joinCode = String(req.body?.join_code || req.body?.joinCode || "").trim();
            if (!joinCode) {
                const error = new Error("邀请码不能为空。");
                error.status = 400;
                error.code = "join_code_empty";
                return next(error);
            }
            const result = await joinRoom(rawDatabase, scope, joinCode, req.body || {});
            res.status(result.status === "joined" ? 201 : 200).json(result);
        } catch (error) { next(error); }
    });

    // 查询邀请码对应的放映厅信息（用于邀请链接预览）
    // GET /api/v2/co-watch/rooms/join-info?code=XXXXXX
    // 公开端点（无需登录）：返回发起人显示名、AI 名、片名、人数等
    // ⚠️ 必须放在 /rooms/:roomId 之前，否则会被 :roomId 匹配
    router.get("/rooms/join-info", async (req, res, next) => {
        try {
            const code = String(req.query.code || "").trim().toUpperCase().slice(0, 20);
            if (!code || code.length < 6) {
                const error = new Error("无效的邀请码。");
                error.status = 400;
                error.code = "room_invite_code_invalid";
                return next(error);
            }
            const room = await readRoomByCode(rawDatabase, code);
            if (!room) {
                const error = new Error("邀请码无效或放映厅已结束。");
                error.status = 404;
                error.code = "room_not_found";
                return next(error);
            }
            // 只返回对外展示的信息
            res.json({
                room: {
                    id: room.id,
                    title: room.title,
                    hostName: room.hostDisplayName || "发起人",
                    hostAiName: room.hostAiName || "",
                    hostDisplayId: room.hostDisplayId || "",
                    participantCount: room.participantCount || 1,
                    maxParticipants: room.maxParticipants,
                    createdAt: room.createdAt
                }
            });
        } catch (error) { next(error); }
    });

    // 获取放映厅信息 + 参与者列表
    router.get("/rooms/:roomId", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            await requireRoomParticipant(rawDatabase, req.params.roomId, scope.userId, scope.companionId);
            const room = await readRoom(rawDatabase, req.params.roomId);
            const participants = await readRoomParticipants(rawDatabase, req.params.roomId);
            res.json({ room, participants });
        } catch (error) { next(error); }
    });

    // 离开放映厅
    router.post("/rooms/:roomId/leave", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await leaveRoom(rawDatabase, scope, req.params.roomId);
            res.json(result);
        } catch (error) { next(error); }
    });

    // 发起人更新播放状态（暂停/播放/进度）
    router.patch("/rooms/:roomId/playback", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const room = await updateRoomPlayback(rawDatabase, scope, req.params.roomId, req.body || {});
            res.json({ room });
        } catch (error) { next(error); }
    });

    // 发送群聊消息
    router.post("/rooms/:roomId/messages", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const message = await sendRoomMessage(rawDatabase, scope, req.params.roomId, req.body || {});
            res.status(201).json({ message });
        } catch (error) { next(error); }
    });

    // 读取群聊消息（按时间倒序，支持 before_id 分页）
    router.get("/rooms/:roomId/messages", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            await requireRoomParticipant(rawDatabase, req.params.roomId, scope.userId, scope.companionId);
            const messages = await readRoomMessages(
                rawDatabase,
                req.params.roomId,
                req.query.limit,
                req.query.before_id
            );
            res.json({ messages });
        } catch (error) { next(error); }
    });

    // 本房间参与者的 AI 发一条带归属的群聊消息
    // （发起人/成员的 AI 回复也进入房间群聊，标注 sender_name=AI 名、ai_owner=该用户的 companion）
    router.post("/rooms/:roomId/ai-messages", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const content = String(req.body?.content || "").trim();
            if (!content) {
                const error = new Error("消息不能为空。");
                error.status = 400;
                error.code = "message_empty";
                return next(error);
            }
            // 校验发送者是房间参与者（host 或 member）
            const room = await readRoom(rawDatabase, req.params.roomId);
            if (room.status !== "active") {
                const error = new Error("放映厅已结束。");
                error.status = 409;
                error.code = "room_ended";
                return next(error);
            }
            const message = await sendRoomAiMessage(
                rawDatabase,
                req.params.roomId,
                String(req.body?.ai_name || req.body?.aiName || scope.companion?.name || "伴侣"),
                content,
                Number(req.body?.media_position_seconds) || 0,
                scope
            );
            res.status(201).json({ message });
        } catch (error) { next(error); }
    });

    // 结束放映厅（发起人）
    router.post("/rooms/:roomId/end", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await endRoom(rawDatabase, scope, req.params.roomId);
            res.json(result);
        } catch (error) { next(error); }
    });

    // 放映厅实时事件（SSE 推送——播放同步、聊天、成员进出）
    // 所有参与者打开此连接后，无需轮询即可接收实时事件。
    // 事件格式（event-stream）：
    //   event: playback_sync | message | participant_join | participant_leave | room_ended
    //   data: { ... }
    router.get("/rooms/:roomId/events", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            await requireRoomParticipant(rawDatabase, req.params.roomId, scope.userId, scope.companionId);
            const room = await readRoom(rawDatabase, req.params.roomId);
            if (room.status !== "active") throw Object.assign(new Error("放映厅已结束，请加入新的房间。"), { status: 410, code: "room_ended" });
            subscribeRoomEvents(req.params.roomId, res, scope);
        } catch (error) { next(error); }
    });

    // 获取当前用户的显示 ID 与伴侣显示 ID
    router.get("/display-id", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const { data: ud, error: ue } = await rawDatabase
                .from("user_display_ids")
                .select("display_id")
                .eq("user_id", scope.userId)
                .maybeSingle();
            if (ue) return next(ue);
            const { data: cd, error: ce } = await rawDatabase
                .from("companions")
                .select("display_id, name")
                .eq("user_id", scope.userId)
                .eq("id", scope.companionId)
                .maybeSingle();
            if (ce) return next(ce);
            res.json({
                display_id: ud?.display_id || "",
                companion_display_id: cd?.display_id || "",
                companion_name: cd?.name || ""
            });
        } catch (error) { next(error); }
    });

    return router;
}

/**
 * 公开 join-info 端点（无 auth 中间件）。返回邀请码对应的放映厅摘要信息。
 * 必须在 v2/core 的 auth 中间件之前注册到 app 上。
 */
function createJoinInfoHandler(database) {
    return async (req, res, next) => {
        try {
            const code = String(req.query.code || "").trim().toUpperCase().slice(0, 20);
            if (!code || code.length < 6) {
                const error = new Error("无效的邀请码。");
                error.status = 400;
                error.code = "room_invite_code_invalid";
                return next(error);
            }
            const room = await readRoomByCode(database, code);
            if (!room) {
                const error = new Error("邀请码无效或放映厅已结束。");
                error.status = 404;
                error.code = "room_not_found";
                return next(error);
            }
            res.json({
                room: {
                    id: room.id,
                    title: room.title,
                    hostName: room.hostDisplayName || "发起人",
                    hostAiName: room.hostAiName || "",
                    hostDisplayId: room.hostDisplayId || "",
                    participantCount: room.participantCount || 1,
                    maxParticipants: room.maxParticipants,
                    createdAt: room.createdAt
                }
            });
        } catch (error) { next(error); }
    };
}

module.exports = { createCoWatchRoomRouter, createJoinInfoHandler };
