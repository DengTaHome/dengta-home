const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION_TYPES = new Set([
    "add",
    "remove",
    "move",
    "replace",
    "advance",
    "set_mode"
]);
const { requireCompletePlaylist } = require("./music-playlist-integrity");

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function requiredUuid(value, code, message) {
    const id = String(value || "").trim().toLowerCase();
    if (!UUID_PATTERN.test(id)) throw requestError(400, code, message);
    return id;
}

function optionalPosition(value) {
    const position = Number(value);
    if (!Number.isSafeInteger(position) || position < 0 || position >= 500) {
        throw requestError(400, "music_queue_position_invalid", "队列位置不正确。");
    }
    return position;
}

function publicQueue(queue, items) {
    return {
        session_id: queue.session_id,
        revision: Number(queue.revision) || 0,
        repeat_mode: queue.repeat_mode || "off",
        shuffle_enabled: Boolean(queue.shuffle_enabled),
        current_queue_item_id: queue.current_queue_item_id || null,
        items: (items || []).map((item) => ({
            id: item.id,
            item_id: item.item_id,
            playlist_id: item.playlist_id,
            position: Number(item.position),
            title: item.title || "",
            artist: item.artist || "",
            album: item.album || "",
            duration_seconds: item.duration_seconds == null
                ? null
                : Number(item.duration_seconds),
            playback_mode: item.playback_mode || "direct_https",
            provider_track_id: item.provider_track_id || null,
            external_url: item.external_url || null
        }))
    };
}

async function readMusicQueue({ database, sessionId } = {}) {
    const id = requiredUuid(
        sessionId,
        "co_watch_session_invalid",
        "共看会话编号格式不正确。"
    );
    const session = await database
        .from("co_watch_sessions")
        .select("id, status, session_mode")
        .eq("id", id)
        .maybeSingle();
    if (session.error) throw session.error;
    if (!session.data) {
        throw requestError(404, "co_watch_session_not_found", "找不到这场一起听。");
    }
    if (session.data.session_mode !== "listening") {
        throw requestError(409, "music_queue_session_invalid", "该会话不是一起听会话。");
    }
    const queue = await database
        .from("music_playback_queues")
        .select("id, session_id, revision, repeat_mode, shuffle_enabled, current_queue_item_id")
        .eq("session_id", id)
        .maybeSingle();
    if (queue.error) throw queue.error;
    if (!queue.data) {
        return publicQueue({ session_id: id, revision: 0 }, []);
    }
    const items = await database
        .from("music_playback_queue_items")
        .select("id, item_id, playlist_id, position, title, artist, album, duration_seconds, playback_mode, provider_track_id, external_url")
        .eq("queue_id", queue.data.id)
        .order("position", { ascending: true });
    if (items.error) throw items.error;
    return publicQueue(queue.data, items.data);
}

function normalizeOperation(input) {
    const type = String(input?.type || "").trim().toLowerCase();
    if (!OPERATION_TYPES.has(type)) {
        throw requestError(400, "music_queue_operation_invalid", "队列操作类型不正确。");
    }
    const operation = { type };
    if (type === "add") {
        operation.item_id = requiredUuid(
            input.item_id,
            "music_queue_item_invalid",
            "歌曲编号格式不正确。"
        );
        if (input.position !== undefined) {
            operation.position = optionalPosition(input.position);
        }
    } else if (type === "remove" || type === "move") {
        operation.queue_item_id = requiredUuid(
            input.queue_item_id,
            "music_queue_item_invalid",
            "队列项编号格式不正确。"
        );
        if (type === "move") operation.position = optionalPosition(input.position);
    } else if (type === "replace") {
        if (!Array.isArray(input.item_ids) || input.item_ids.length > 500) {
            throw requestError(400, "music_queue_items_invalid", "替换队列需要不超过 500 首歌曲。");
        }
        operation.item_ids = input.item_ids.map((itemId) => requiredUuid(
            itemId,
            "music_queue_item_invalid",
            "歌曲编号格式不正确。"
        ));
    } else if (type === "set_mode") {
        if (input.repeat_mode !== undefined) operation.repeat_mode = input.repeat_mode;
        if (input.shuffle_enabled !== undefined) {
            operation.shuffle_enabled = input.shuffle_enabled;
        }
    }
    return operation;
}

function rpcError(result) {
    const details = result?.error;
    if (!details) return null;
    const statuses = {
        co_watch_session_not_found: 404,
        music_queue_item_not_found: 404,
        music_queue_revision_conflict: 409,
        music_queue_session_inactive: 409,
        music_queue_session_invalid: 409
    };
    return requestError(
        statuses[details.code] || 400,
        details.code || "music_queue_operation_failed",
        details.message || "队列操作失败。"
    );
}

async function validateQueuePlaylists(database, operation) {
    const ids = operation.type === "add" ? [operation.item_id] : operation.type === "replace" ? [...new Set(operation.item_ids)] : [];
    if (!ids.length) return;
    const result = await database.from("music_playlist_items")
        .select("id,playlist_id")
        .in("id", ids);
    if (result.error) throw result.error;
    if (result.data?.length !== ids.length) throw requestError(404, "music_queue_item_missing", "找不到本账号的队列歌曲，请刷新歌单重试。");
    const playlistIds = [...new Set(result.data.map(item => item.playlist_id))];
    const playlists = await database.from("music_playlists")
        .select("id,item_count,provider,external_url,provider_playlist_id,music_playlist_items(position)")
        .in("id", playlistIds);
    if (playlists.error) throw playlists.error;
    if (playlists.data?.length !== playlistIds.length) throw requestError(404, "music_queue_item_missing", "找不到本账号的队列歌单，请刷新重试。");
    for (const playlist of playlists.data) {
        requireCompletePlaylist(playlist, [...(playlist?.music_playlist_items || [])].sort((a, b) => a.position - b.position));
    }
}

async function applyMusicQueueOperation({ database, sessionId, input = {}, validatePlaylists = validateQueuePlaylists } = {}) {
    const id = requiredUuid(sessionId, "co_watch_session_invalid", "共看会话编号格式不正确。");
    const requestId = requiredUuid(
        input.request_id,
        "music_queue_request_id_invalid",
        "队列操作需要有效的 request_id。"
    );
    const expectedRevision = Number(input.expected_revision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw requestError(400, "music_queue_revision_invalid", "expected_revision 格式不正确。");
    }
    const operation = normalizeOperation(input.operation || input);
    await validatePlaylists(database, operation);
    const result = await database.rpc("apply_music_queue_operation", {
        p_session_id: id,
        p_request_id: requestId,
        p_expected_revision: expectedRevision,
        p_operation: operation
    });
    if (result.error) throw result.error;
    const operationError = rpcError(result.data);
    if (operationError) throw operationError;
    return result.data;
}

module.exports = {
    applyMusicQueueOperation,
    readMusicQueue
};
