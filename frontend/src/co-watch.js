import { apiRequest } from "./api.js";
import { authSession } from "./auth-session.js";
import { coWatchRequestOptions } from "./co-watch-request-scope.js";

function cleanText(value, maximum = 180) {
  return Array.from(String(value || "").trim()).slice(0, maximum).join("");
}

function cleanNumber(value, maximum = 604800) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(maximum, Math.max(0, Math.round(number)));
}

const QUEUE_ERROR_MESSAGES = Object.freeze({
  co_watch_session_not_found: "找不到这场一起听，请重新开始。",
  music_queue_item_not_found: "这首歌已不在可用歌单或队列中。",
  music_queue_revision_conflict: "播放队列刚刚在别处更新，正在同步最新内容。",
  music_queue_session_inactive: "这场一起听已经结束。",
  music_queue_session_invalid: "当前会话不是一起听会话。",
  music_queue_item_limit: "播放队列最多保存 500 首歌曲。",
  music_queue_item_invalid: "歌曲或队列项编号格式不正确。",
  music_queue_items_invalid: "替换队列需要不超过 500 首有效歌曲。",
  music_queue_operation_invalid: "无法识别这次队列操作。",
  music_queue_position_invalid: "目标队列位置不正确，请同步后重试。",
  music_queue_repeat_mode_invalid: "循环模式不正确。",
  music_queue_shuffle_invalid: "随机播放设置不正确。",
  music_queue_request_id_invalid: "队列请求编号无效，请重新操作。",
  music_queue_revision_invalid: "队列同步版本无效，请刷新后重试。",
});

function queueRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeQueueItem(value) {
  const source = value || {};
  return Object.freeze({
    id: cleanText(source.id, 100),
    itemId: cleanText(source.item_id ?? source.itemId, 100),
    playlistId: cleanText(source.playlist_id ?? source.playlistId, 100),
    position: cleanNumber(source.position, 499),
    title: cleanText(source.title, 300),
    artist: cleanText(source.artist, 300),
    album: cleanText(source.album, 300),
    durationSeconds: cleanNumber(source.duration_seconds ?? source.durationSeconds),
    playbackMode: cleanText(source.playback_mode ?? source.playbackMode, 40) || "direct_https",
    providerTrackId: cleanText(source.provider_track_id ?? source.providerTrackId, 20),
    externalUrl: cleanText(source.external_url ?? source.externalUrl, 4096),
  });
}

export function normalizeMusicQueue(value) {
  const source = value?.queue || value || {};
  return Object.freeze({
    sessionId: cleanText(source.session_id ?? source.sessionId, 100),
    revision: cleanNumber(source.revision, 1_000_000_000),
    repeatMode: ["off", "all", "one"].includes(source.repeat_mode ?? source.repeatMode)
      ? (source.repeat_mode ?? source.repeatMode)
      : "off",
    shuffleEnabled: Boolean(source.shuffle_enabled ?? source.shuffleEnabled),
    currentQueueItemId: cleanText(source.current_queue_item_id ?? source.currentQueueItemId, 100),
    items: Object.freeze((Array.isArray(source.items) ? source.items : []).slice(0, 500).map(normalizeQueueItem)),
  });
}

function stableQueueError(error) {
  if (!error?.code || !QUEUE_ERROR_MESSAGES[error.code]) return error;
  const translated = new Error(QUEUE_ERROR_MESSAGES[error.code], { cause: error });
  translated.status = error.status;
  translated.code = error.code;
  translated.requestId = error.requestId;
  return translated;
}

export function normalizeCoWatchSession(value) {
  if (!value?.id) return null;
  const receiver = value.receiver || value.cast_receiver || {};
  return Object.freeze({
    id: cleanText(value.id, 80),
    conversationId: cleanText(value.conversation_id, 80),
    status: value.status === "ended" ? "ended" : "active",
    sessionMode: value.session_mode === "direct" ? "direct_media" : cleanText(value.session_mode, 40) || "screen",
    mediaUrl: cleanText(value.media_url, 4096),
    title: cleanText(value.title),
    sourceApp: cleanText(value.source_app, 100),
    cadenceSeconds: Math.min(
      10_800,
      Math.max(60, cleanNumber(value.cadence_seconds, 10_800) || 90),
    ),
    mediaPositionSeconds: cleanNumber(value.media_position_seconds),
    mediaDurationSeconds: cleanNumber(value.media_duration_seconds),
    revision: cleanNumber(value.playback_revision ?? value.revision, 1_000_000_000),
    playbackState: value.playback_state === "playing" ? "playing" : "paused",
    musicPlaylistId: cleanText(value.playlist_id ?? value.music_playlist_id, 100),
    musicPlaylistItemId: cleanText(value.item_id ?? value.playlist_item_id ?? value.music_playlist_item_id, 100),
    castReceiver: Object.freeze({
      status: cleanText(receiver.status ?? receiver.state ?? value.receiver_status, 40),
      name: cleanText(receiver.name ?? value.receiver_name, 100),
      acknowledged: Boolean(receiver.acknowledged),
      positionSeconds: cleanNumber(receiver.position_seconds),
      lastAckAt: receiver.last_ack_at ?? receiver.reported_at ?? value.receiver_last_ack_at ?? "",
    }),
    frameCount: cleanNumber(value.frame_count, 1_000_000),
    reactionCount: cleanNumber(value.reaction_count, 1_000_000),
    lastFrameAt: value.last_frame_at || "",
    lastReactionAt: value.last_reaction_at || "",
    startedAt: value.started_at || "",
    endedAt: value.ended_at || "",
  });
}

export async function readActiveCoWatchSession({ sessionMode = "" } = {}, options = {}) {
  const query = sessionMode
    ? `?mode=${encodeURIComponent(sessionMode)}`
    : "";
  const data = await apiRequest(
    `/api/v2/co-watch/sessions/active${query}`,
    { timeoutMs: 12_000, ...coWatchRequestOptions(options, authSession) },
  );
  return normalizeCoWatchSession(data?.session);
}

export async function createCoWatchSession(input = {}, options = {}) {
  const data = await apiRequest("/api/v2/co-watch/sessions", {
    method: "POST",
    timeoutMs: 15_000,
    ...coWatchRequestOptions(options, authSession),
    body: JSON.stringify({
      session_id: input.sessionId || undefined,
      title: cleanText(input.title),
      session_mode: ["screen", "direct_media", "listening", "web_page"].includes(input.sessionMode) ? input.sessionMode : "screen",
      media_url: ["direct_media", "web_page"].includes(input.sessionMode) ? cleanText(input.mediaUrl, 4096) : "",
      source_app: cleanText(input.sourceApp, 100),
      media_duration_seconds: cleanNumber(input.mediaDurationSeconds),
      media_position_seconds: cleanNumber(input.mediaPositionSeconds),
      playlist_id: cleanText(input.musicPlaylistId, 100),
      item_id: cleanText(input.musicPlaylistItemId, 100),
      cadence_seconds: Math.min(
        10_800,
        Math.max(60, cleanNumber(input.cadenceSeconds, 10_800) || 90),
      ),
    }),
  });
  return normalizeCoWatchSession(data?.session);
}

export async function endCoWatchSession(sessionId, input = {}, options = {}) {
  const data = await apiRequest(
    `/api/v2/co-watch/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      timeoutMs: 15_000,
      ...coWatchRequestOptions(options, authSession),
      body: JSON.stringify({
        status: "ended",
        title: cleanText(input.title),
        media_position_seconds: cleanNumber(input.mediaPositionSeconds),
      }),
    },
  );
  return normalizeCoWatchSession(data?.session);
}

export async function patchCoWatchPlayback(sessionId, input = {}, options = {}) {
  const data = await apiRequest(`/api/v2/co-watch/sessions/${encodeURIComponent(sessionId)}/playback`, {
    method: "PATCH", timeoutMs: 15_000,
    ...coWatchRequestOptions(options, authSession),
    body: JSON.stringify({
      playback_revision: cleanNumber(input.revision, 1_000_000_000),
      playback_state: input.playbackState === "playing" ? "playing" : "paused",
      playlist_id: cleanText(input.musicPlaylistId, 100),
      item_id: cleanText(input.musicPlaylistItemId, 100),
      media_position_seconds: cleanNumber(input.mediaPositionSeconds),
      media_duration_seconds: cleanNumber(input.mediaDurationSeconds),
    }),
  });
  return normalizeCoWatchSession(data?.session || data);
}

export async function readCoWatchMusicQueue(sessionId, options = {}) {
  try {
    return normalizeMusicQueue(await apiRequest(
      `/api/v2/co-watch/sessions/${encodeURIComponent(sessionId)}/queue`,
      { timeoutMs: 12_000, ...coWatchRequestOptions(options, authSession) },
    ));
  } catch (error) {
    throw stableQueueError(error);
  }
}

export async function applyCoWatchMusicQueueOperation(sessionId, input = {}, options = {}) {
  const requestId = input.requestId || queueRequestId();
  try {
    const data = await apiRequest(
      `/api/v2/co-watch/sessions/${encodeURIComponent(sessionId)}/queue/operations`,
      {
        method: "POST",
        timeoutMs: 15_000,
        ...coWatchRequestOptions(options, authSession),
        body: JSON.stringify({
          request_id: requestId,
          expected_revision: cleanNumber(input.expectedRevision, 1_000_000_000),
          operation: input.operation || {},
        }),
      },
    );
    return Object.freeze({
      requestId: cleanText(data?.request_id ?? requestId, 100),
      replayed: Boolean(data?.replayed),
      queue: normalizeMusicQueue(data?.queue),
    });
  } catch (error) {
    error.requestId = requestId;
    throw stableQueueError(error);
  }
}

export async function createCoWatchPairingCode(sessionId) {
  const data = await apiRequest(
    `/api/v2/co-watch/sessions/${encodeURIComponent(sessionId)}/pairing-code`,
    { method: "POST", timeoutMs: 15_000, body: "{}" },
  );
  return Object.freeze({
    pairingCode: cleanText(data?.pairing_code, 20),
    sessionId: cleanText(data?.session_id ?? sessionId, 80),
    expiresAt: data?.expires_at || "",
  });
}

export async function readCoWatchDialog(session, options = {}) {
  if (!session?.conversationId || !session?.id) return [];
  const data = await apiRequest(
    `/api/v2/sessions/${encodeURIComponent(session.conversationId)}/messages`,
    { timeoutMs: 12_000, ...coWatchRequestOptions(options, authSession) },
  );
  return (Array.isArray(data?.messages) ? data.messages : [])
    .filter((message) => {
      const metadata = message?.tool_calls || {};
      return (
        metadata.is_co_watch === true &&
        String(metadata.co_watch_session_id || "") === session.id
      );
    })
    .slice(-24)
    .map((message) => ({
      id: cleanText(message.id, 100),
      role: message.role === "user" ? "user" : "assistant",
      text: cleanText(message.content, 600),
      at: message.created_at || "",
    }))
    .filter((message) => message.id && message.text);
}

export async function sendCoWatchReply(sessionId, text, positionSeconds = 0) {
  const requestId = globalThis.crypto?.randomUUID?.() ||
    `co-watch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const data = await apiRequest(
    `/api/v2/co-watch/sessions/${encodeURIComponent(sessionId)}/reply`,
    {
      method: "POST",
      timeoutMs: 90_000,
      body: JSON.stringify({
        text: cleanText(text, 500),
        request_id: requestId,
        media_position_seconds: cleanNumber(positionSeconds),
      }),
    },
  );
  const reaction = data?.reaction;
  const assistantMessage = data?.assistant_message;
  const content = assistantMessage?.content;
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      (reaction != null && typeof reaction !== "string") ||
      (assistantMessage != null && (typeof assistantMessage !== "object" || Array.isArray(assistantMessage))) ||
      (content != null && typeof content !== "string") ||
      !(reaction?.trim() || content?.trim())) {
    const error = new Error("共看服务返回的回复格式不完整，本次未确认成功，输入仍保留。请先刷新当前对话核对，再决定重试。（错误代码：co_watch_reply_receipt_invalid）");
    error.code = "co_watch_reply_receipt_invalid";
    throw error;
  }
  return Object.freeze({
    requestId,
    reaction: cleanText(reaction, 600),
    danmaku: Array.isArray(data?.danmaku) ? data.danmaku : [],
    assistantMessage: assistantMessage || null,
    session: normalizeCoWatchSession(data?.session),
  });
}

export async function resolveCoWatchPage(pageUrl, { signal } = {}) {
  const query = new URLSearchParams({ url: cleanText(pageUrl, 4096) });
  const data = await apiRequest(`/api/v2/co-watch/page-resolve?${query}`, {
    timeoutMs: 15_000,
    signal,
  });
  return data?.page || null;
}

export function formatMediaTime(value) {
  const seconds = cleanNumber(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}
