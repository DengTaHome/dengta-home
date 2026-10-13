const { createHash, randomUUID } = require("node:crypto");
const { publicMessage } = require("./chat-attachments");
const { validateDirectMediaUrl } = require("./direct-media-url");
const { validateCoWatchPageUrl } = require("./page-embed");
const { requireCompletePlaylist } = require("./music-playlist-integrity");

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_SESSION_PATTERN = /^(?=.{16,80}$)(?=.*[0-9a-f])[0-9a-f-]+$/i;
const SESSION_FIELDS = [
    "id",
    "conversation_id",
    "status",
    "session_mode",
    "playlist_id",
    "playlist_item_id",
    "playback_state",
    "playback_revision",
    "receiver_state",
    "receiver_acknowledged",
    "receiver_position_seconds",
    "receiver_reported_at",
    "title",
    "source_app",
    "cadence_seconds",
    "media_position_seconds",
    "media_duration_seconds",
    "frame_count",
    "reaction_count",
    "last_frame_at",
    "last_reaction_at",
    "last_reaction_message_id",
    "started_at",
    "ended_at",
    "created_at",
    "updated_at"
].join(", ");

function cleanText(value, maximum) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maximum)
        .join("");
}

function boundedNumber(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function normalizeSessionId(value, idFactory = randomUUID) {
    const id = cleanText(value, 80) || idFactory();
    if (UUID_PATTERN.test(id)) return id.toLowerCase();
    if (LEGACY_SESSION_PATTERN.test(id)) {
        const bytes = createHash("sha256")
            .update(`dengta:legacy-co-watch-session:${id.toLowerCase()}`, "utf8")
            .digest()
            .subarray(0, 16);
        bytes[6] = (bytes[6] & 0x0f) | 0x50;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = bytes.toString("hex");
        return [
            hex.slice(0, 8),
            hex.slice(8, 12),
            hex.slice(12, 16),
            hex.slice(16, 20),
            hex.slice(20)
        ].join("-");
    }
    throw requestError(
        400,
        "co_watch_session_invalid",
        "共看会话编号格式不正确。"
    );
}

async function reserveCoWatchFrameSession({
    database,
    frame,
    conversationId,
    now = () => new Date(),
    findSession = findCoWatchSession,
    findActiveSession = findActiveCoWatchSession,
    insertSession = insertCoWatchSession
} = {}) {
    requireDatabase(database);
    const id = normalizeSessionId(frame?.sessionId);
    const existing = await findSession(database, id);
    if (existing) {
        if (existing.status !== "active") {
            throw requestError(
                409,
                "co_watch_session_finished",
                "这场一起看已经结束，请开始一场新的共看。"
            );
        }
        return existing;
    }
    const active = await findActiveSession(database);
    if (active) return active;

    const capturedAt = new Date(frame?.capturedAt);
    const timestamp = Number.isFinite(capturedAt.getTime())
        ? capturedAt.toISOString()
        : new Date(now()).toISOString();
    try {
        return await insertSession(database, {
            id,
            conversation_id: conversationId,
            status: "active",
            title: "",
            source_app: "",
            cadence_seconds: 60,
            media_position_seconds: 0,
            media_duration_seconds: 0,
            frame_count: 0,
            reaction_count: 0,
            started_at: timestamp,
            updated_at: timestamp
        });
    } catch (error) {
        if (String(error?.code || "") !== "23505") throw error;
        const winner =
            (await findSession(database, id)) ||
            (await findActiveSession(database));
        if (!winner) throw error;
        return winner;
    }
}

function publicCoWatchSession(row) {
    if (!row) return null;
    return Object.freeze({
        id: row.id,
        conversation_id: row.conversation_id,
        status: row.status,
        session_mode: row.session_mode || "screen",
        playlist_id: row.playlist_id || null,
        playlist_item_id: row.playlist_item_id || null,
        playback_state: row.playback_state || "stopped",
        playback_revision: Number(row.playback_revision) || 0,
        receiver: {
            state: row.receiver_state || "idle",
            acknowledged: Boolean(row.receiver_acknowledged),
            position_seconds: Number(row.receiver_position_seconds) || 0,
            reported_at: row.receiver_reported_at || null
        },
        title: row.title || "",
        source_app: row.source_app || "",
        cadence_seconds: Number(row.cadence_seconds) || 90,
        media_position_seconds: Number(row.media_position_seconds) || 0,
        media_duration_seconds: Number(row.media_duration_seconds) || 0,
        frame_count: Number(row.frame_count) || 0,
        reaction_count: Number(row.reaction_count) || 0,
        last_frame_at: row.last_frame_at || null,
        last_reaction_at: row.last_reaction_at || null,
        last_reaction_message_id: row.last_reaction_message_id || null,
        started_at: row.started_at,
        ended_at: row.ended_at || null,
        created_at: row.created_at || row.started_at,
        updated_at: row.updated_at || row.started_at
    });
}

async function findLatestConversation(database) {
    const { data, error } = await database
        .from("conversations")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1);
    if (error) throw error;
    return data?.[0] || null;
}

async function findCoWatchSession(database, sessionId) {
    const { data, error } = await database
        .from("co_watch_sessions")
        .select(SESSION_FIELDS)
        .eq("id", sessionId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function findActiveCoWatchSession(database, options = {}) {
    let builder = database
        .from("co_watch_sessions")
        .select(SESSION_FIELDS)
        .eq("status", "active");
    const mode = cleanText(options?.sessionMode, 30);
    if (mode) {
        builder = builder.eq("session_mode", mode);
    }
    const { data, error } = await builder
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function insertCoWatchSession(database, values) {
    const { data, error } = await database
        .from("co_watch_sessions")
        .insert(values)
        .select(SESSION_FIELDS)
        .single();
    if (error) throw error;
    return data;
}

async function updateCoWatchSession(database, sessionId, values) {
    const { data, error } = await database
        .from("co_watch_sessions")
        .update(values)
        .eq("id", sessionId)
        .select(SESSION_FIELDS)
        .single();
    if (error) throw error;
    return data;
}

async function findListeningItem(database, playlistId, itemId) {
    const { data, error } = await database
        .from("music_playlist_items")
        .select("id, playlist_id, title, artist, music_playlists(item_count,provider,external_url,provider_playlist_id,music_playlist_items(position))")
        .eq("playlist_id", playlistId)
        .eq("id", itemId)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { music_playlists: playlist, ...item } = data;
    const positions = [...(playlist?.music_playlist_items || [])].sort((a, b) => a.position - b.position);
    requireCompletePlaylist(playlist, positions);
    return item;
}

function normalizeSessionMode(value) {
    const mode = cleanText(value, 30) || "screen";
    if (!["screen", "direct_media", "listening", "web_page"].includes(mode)) {
        throw requestError(400, "co_watch_session_mode_invalid", "一起看会话模式不正确。");
    }
    return mode;
}

function normalizePlaybackState(value, fallback = "stopped") {
    const state = cleanText(value, 20) || fallback;
    if (!["playing", "paused", "stopped"].includes(state)) {
        throw requestError(400, "co_watch_playback_state_invalid", "播放状态不正确。");
    }
    return state;
}

function requiredUuid(value, code, message) {
    const id = cleanText(value, 80).toLowerCase();
    if (!UUID_PATTERN.test(id)) throw requestError(400, code, message);
    return id;
}

async function findCoWatchSessionMessages(
    database,
    conversationId,
    sessionId,
    limit = 50
) {
    const { data, error } = await database
        .from("messages")
        .select("id, role, content, created_at, tool_calls")
        .eq("conversation_id", conversationId)
        .contains("tool_calls", {
            is_co_watch: true,
            co_watch_session_id: sessionId
        })
        .order("created_at", { ascending: false })
        .limit(Math.min(100, Math.max(1, Number(limit) || 50)));
    if (error) throw error;
    return (data || []).reverse();
}

function requireDatabase(database) {
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A tenant-scoped database is required.");
    }
}

async function startCoWatchSession({
    database,
    input = {},
    now = () => new Date(),
    idFactory = randomUUID,
    findConversation = findLatestConversation,
    findSession = findCoWatchSession,
    findActiveSession = findActiveCoWatchSession,
    insertSession = insertCoWatchSession,
    updateSession = updateCoWatchSession,
    findItem = findListeningItem
    , validateMediaUrl = validateDirectMediaUrl
    , validatePageUrl = validateCoWatchPageUrl
    , encryptMediaUrl
} = {}) {
    requireDatabase(database);
    const id = normalizeSessionId(input.session_id, idFactory);
    const existing = await findSession(database, id);
    if (existing) {
        if (existing.status !== "active") {
            throw requestError(
                409,
                "co_watch_session_finished",
                "这场一起看已经结束，请开始一场新的共看。"
            );
        }
        return { status: "resumed", session: publicCoWatchSession(existing) };
    }


    const conversation = await findConversation(database);
    if (!conversation?.id) {
        throw requestError(
            409,
            "co_watch_conversation_missing",
            "请先开始一段聊天，再邀请伴侣一起看。"
        );
    }
    const timestamp = new Date(now()).toISOString();
    const sessionMode = normalizeSessionMode(input.session_mode);
    let playlistId = null;
    let playlistItemId = null;
    let mediaUrl = null;
    if (sessionMode === "direct_media") {
        if (typeof encryptMediaUrl !== "function") {
            throw requestError(500, "cast_encryption_not_configured", "投屏媒体加密未配置。");
        }
        mediaUrl = await validateMediaUrl(input.media_url);
    } else if (sessionMode === "web_page") {
        if (typeof encryptMediaUrl !== "function") {
            throw requestError(500, "cast_encryption_not_configured", "投屏媒体加密未配置。");
        }
        mediaUrl = await validatePageUrl(input.media_url);
    } else if (sessionMode === "listening") {
        playlistId = requiredUuid(
            input.playlist_id,
            "music_playlist_id_invalid",
            "一起听需要有效的歌单编号。"
        );
        playlistItemId = requiredUuid(
            input.item_id ?? input.playlist_item_id,
            "music_playlist_item_id_invalid",
            "一起听需要有效的歌曲编号。"
        );
        if (!(await findItem(database, playlistId, playlistItemId))) {
            throw requestError(
                400,
                "music_playlist_item_mismatch",
                "歌曲不属于当前租户的指定歌单。"
            );
        }
    }
    const values = {
        id,
        conversation_id: conversation.id,
        status: "active",
        session_mode: sessionMode,
        playlist_id: playlistId,
        playlist_item_id: playlistItemId,
        playback_state: normalizePlaybackState(
            input.playback_state,
            sessionMode === "listening" ? "paused" : "stopped"
        ),
        playback_revision: 0,
        ...(mediaUrl ? {
            media_url_ciphertext: encryptMediaUrl(mediaUrl),
            media_url_fingerprint: createHash("sha256").update(mediaUrl).digest("hex")
        } : {}),
        title: cleanText(input.title, 180),
        source_app: cleanText(input.source_app, 100),
        cadence_seconds: boundedNumber(
            input.cadence_seconds,
            60,
            10800,
            90
        ),
        media_position_seconds: boundedNumber(
            input.media_position_seconds,
            0,
            7 * 24 * 60 * 60,
            0
        ),
        media_duration_seconds: boundedNumber(
            input.media_duration_seconds,
            0,
            7 * 24 * 60 * 60,
            0
        ),
        started_at: timestamp,
        updated_at: timestamp
    };
    const active = await findActiveSession(database);
    if (active?.id && active.id !== id) {
        const timestamp = new Date(now()).toISOString();
        await updateSession(database, active.id, {
            status: "ended",
            ended_at: timestamp,
            updated_at: timestamp
        });
    }

    let created;
    try {
        created = await insertSession(database, values);
    } catch (error) {
        if (String(error?.code || "") !== "23505") throw error;
        const winner =
            (await findSession(database, id)) ||
            (await findActiveSession(database));
        if (!winner) throw error;
        return {
            status: "resumed",
            session: publicCoWatchSession(winner)
        };
    }
    return { status: "created", session: publicCoWatchSession(created) };
}

async function updateListeningPlayback({
    database,
    sessionId,
    input = {},
    now = () => new Date(),
    findSession = findCoWatchSession,
    findItem = findListeningItem
} = {}) {
    requireDatabase(database);
    const id = normalizeSessionId(sessionId);
    const expectedRevision = Number(input.revision ?? input.playback_revision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw requestError(
            400,
            "co_watch_playback_revision_invalid",
            "播放状态更新需要有效的 revision。"
        );
    }
    const session = await findSession(database, id);
    if (!session) {
        throw requestError(404, "co_watch_session_not_found", "找不到这场一起听。");
    }
    if (session.status !== "active" || !["listening", "direct_media"].includes(session.session_mode)) {
        throw requestError(
            409,
            "co_watch_listening_inactive",
            "只有进行中的一起听会话可以更新播放状态。"
        );
    }
    if (session.session_mode === "direct_media") {
        if (input.playlist_id || input.item_id || input.playlist_item_id) {
            throw requestError(400, "co_watch_playback_playlist_invalid", "直链媒体不支持歌单字段。");
        }
        const values = {
            playback_state: normalizePlaybackState(input.playback_state, session.playback_state),
            media_position_seconds: boundedNumber(input.position_seconds ?? input.media_position_seconds, 0, 7 * 24 * 60 * 60, Number(session.media_position_seconds) || 0),
            playback_revision: expectedRevision + 1,
            updated_at: new Date(now()).toISOString()
        };
        const result = await database.from("co_watch_sessions").update(values).eq("id", id).eq("status", "active").eq("session_mode", "direct_media").eq("playback_revision", expectedRevision).select(SESSION_FIELDS).maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw requestError(409, "co_watch_playback_revision_conflict", "播放状态已被其他客户端更新，请刷新后重试。");
        return publicCoWatchSession(result.data);
    }
    const playlistId = input.playlist_id
        ? requiredUuid(input.playlist_id, "music_playlist_id_invalid", "歌单编号格式不正确。")
        : session.playlist_id;
    const itemId = input.item_id || input.playlist_item_id
        ? requiredUuid(
              input.item_id ?? input.playlist_item_id,
              "music_playlist_item_id_invalid",
              "歌曲编号格式不正确。"
          )
        : session.playlist_item_id;
    if (!playlistId || !itemId || !(await findItem(database, playlistId, itemId))) {
        throw requestError(
            400,
            "music_playlist_item_mismatch",
            "歌曲不属于当前租户的指定歌单。"
        );
    }
    const values = {
        playlist_id: playlistId,
        playlist_item_id: itemId,
        playback_state: normalizePlaybackState(input.playback_state, session.playback_state),
        media_position_seconds: boundedNumber(
            input.position_seconds ?? input.media_position_seconds,
            0,
            7 * 24 * 60 * 60,
            Number(session.media_position_seconds) || 0
        ),
        playback_revision: expectedRevision + 1,
        updated_at: new Date(now()).toISOString()
    };
    const result = await database
        .from("co_watch_sessions")
        .update(values)
        .eq("id", id)
        .eq("status", "active")
        .eq("session_mode", "listening")
        .eq("playback_revision", expectedRevision)
        .select(SESSION_FIELDS)
        .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
        throw requestError(
            409,
            "co_watch_playback_revision_conflict",
            "播放状态已被其他客户端更新，请刷新后重试。"
        );
    }
    return publicCoWatchSession(result.data);
}

async function readActiveCoWatchSession({
    database,
    sessionMode,
    findActiveSession = findActiveCoWatchSession
} = {}) {
    requireDatabase(database);
    return publicCoWatchSession(await findActiveSession(database, { sessionMode }));
}

async function readCoWatchSession({
    database,
    sessionId,
    findSession = findCoWatchSession
} = {}) {
    requireDatabase(database);
    const id = normalizeSessionId(sessionId);
    const session = await findSession(database, id);
    if (!session) {
        throw requestError(404, "co_watch_session_not_found", "找不到这场一起看。");
    }
    return publicCoWatchSession(session);
}

async function listCoWatchSessionMessages({
    database,
    sessionId,
    limit = 50,
    findSession = findCoWatchSession,
    listMessages = findCoWatchSessionMessages
} = {}) {
    requireDatabase(database);
    const id = normalizeSessionId(sessionId);
    const session = await findSession(database, id);
    if (!session) {
        throw requestError(404, "co_watch_session_not_found", "找不到这场一起看。");
    }
    const messages = await listMessages(
        database,
        session.conversation_id,
        id,
        limit
    );
    return messages.map((message) => publicMessage(message));
}

async function endCoWatchSession({
    database,
    sessionId,
    input = {},
    now = () => new Date(),
    findSession = findCoWatchSession,
    updateSession = updateCoWatchSession
} = {}) {
    requireDatabase(database);
    const id = normalizeSessionId(sessionId);
    const existing = await findSession(database, id);
    if (!existing) {
        throw requestError(404, "co_watch_session_not_found", "找不到这场一起看。");
    }
    if (existing.status === "ended") {
        return { status: "ended", session: publicCoWatchSession(existing) };
    }
    const timestamp = new Date(now()).toISOString();
    const values = {
        status: "ended",
        media_position_seconds: boundedNumber(
            input.media_position_seconds,
            0,
            7 * 24 * 60 * 60,
            Number(existing.media_position_seconds) || 0
        ),
        ended_at: timestamp,
        updated_at: timestamp
    };
    const updated = await updateSession(database, id, values);
    const grantTable = database.from("co_watch_receiver_grants");
    if (grantTable?.update) {
        const grants = await grantTable
            .update({ revoked_at: timestamp })
            .eq("session_id", id)
            .is("revoked_at", null);
        if (grants.error) throw grants.error;
    }
    return { status: "ended", session: publicCoWatchSession(updated) };
}

async function recordCoWatchReaction({
    database,
    frame,
    conversationId,
    messageId,
    now = () => new Date(),
    findSession = findCoWatchSession,
    insertSession = insertCoWatchSession,
    updateSession = updateCoWatchSession
} = {}) {
    requireDatabase(database);
    const id = normalizeSessionId(frame?.sessionId);
    const capturedAt = new Date(frame?.capturedAt);
    const frameTimestamp = Number.isFinite(capturedAt.getTime())
        ? capturedAt.toISOString()
        : new Date(now()).toISOString();
    const reactionTimestamp = new Date(now()).toISOString();
    const existing = await findSession(database, id);
    if (!existing) {
        return publicCoWatchSession(
            await insertSession(database, {
                id,
                conversation_id: conversationId,
                status: "active",
                title: "",
                source_app: "",
                cadence_seconds: 60,
                media_position_seconds: 0,
                media_duration_seconds: 0,
                frame_count: 1,
                reaction_count: 1,
                last_frame_at: frameTimestamp,
                last_reaction_at: reactionTimestamp,
                last_reaction_message_id: messageId,
                started_at: frameTimestamp,
                updated_at: reactionTimestamp
            })
        );
    }
    if (String(existing.last_reaction_message_id || "") === String(messageId)) {
        return publicCoWatchSession(existing);
    }
    if (existing.status !== "active") {
        return publicCoWatchSession(existing);
    }
    return publicCoWatchSession(
        await updateSession(database, id, {
            frame_count: (Number(existing.frame_count) || 0) + 1,
            reaction_count: (Number(existing.reaction_count) || 0) + 1,
            last_frame_at: frameTimestamp,
            last_reaction_at: reactionTimestamp,
            last_reaction_message_id: messageId,
            updated_at: reactionTimestamp
        })
    );
}

module.exports = {
    SESSION_FIELDS,
    boundedNumber,
    cleanText,
    endCoWatchSession,
    findActiveCoWatchSession,
    findCoWatchSessionMessages,
    findCoWatchSession,
    findListeningItem,
    insertCoWatchSession,
    listCoWatchSessionMessages,
    normalizeSessionId,
    publicCoWatchSession,
    recordCoWatchReaction,
    reserveCoWatchFrameSession,
    readActiveCoWatchSession,
    readCoWatchSession,
    requestError,
    startCoWatchSession,
    updateListeningPlayback,
    updateCoWatchSession
};
