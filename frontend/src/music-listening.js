import { apiFetch, apiRequest } from "./api.js";
import { authSession } from "./auth-session.js";
import { coWatchRequestOptions } from "./co-watch-request-scope.js";
import { captureMusicScope, assertMusicScope } from "./music-request-scope.js";
import { musicErrorMessage } from "./music-operation-feedback.js";
import { isPrivateMediaHostname } from "./direct-media.js";
import { requireMusicPlaylistReceipt } from "./music-playlist-status.js";

const MAX_TEXT = 500;
const MAX_ITEMS = 2_000;
const READ_TIMEOUT_MS = 12_000;
const WRITE_TIMEOUT_MS = 15_000;


async function musicRequest(path, input, options) {
  const scope = captureMusicScope(options, authSession);
  assertMusicScope(scope, authSession);
  const result = await apiRequest(path, { ...input, ...coWatchRequestOptions(scope, authSession) });
  assertMusicScope(scope, authSession);
  return result;
}

async function musicFetch(path, input, scope) {
  assertMusicScope(scope, authSession);
  const result = await apiFetch(path, { ...input, ...coWatchRequestOptions(scope, authSession) });
  assertMusicScope(scope, authSession);
  return result;
}

function importReceipt(data) {
  const playlist = normalizeMusicPlaylist(data);
  if (!playlist.id) throw Object.assign(new Error("服务器未返回歌单保存回执。请先刷新列表确认，避免重复导入。"), { code: "music_import_receipt_invalid" });
  return playlist;
}

function cookieReceipt(data, expected) {
  if (typeof data?.session?.connected !== "boolean" || (expected !== undefined && data.session.connected !== expected)) {
    throw Object.assign(new Error("服务器未确认网易云登录状态，请刷新或重试。当前状态仍保留。"), { code: "music_cookie_receipt_invalid" });
  }
  return data;
}

function text(value, maximum = MAX_TEXT) {
  return String(value ?? "").trim().slice(0, maximum);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

export function validateDirectAudioUrl(value) {
  const input = text(value, 4096);
  if (!input) return { ok: false, code: "required", message: "请先填写音频 HTTPS 直链。" };
  let url;
  try { url = new URL(input); } catch { return { ok: false, code: "invalid", message: "请填写完整的 HTTPS 音频地址。" }; }
  if (url.protocol !== "https:") return { ok: false, code: "protocol", message: "只允许公开 HTTPS 音频直链。" };
  if (url.username || url.password) return { ok: false, code: "userinfo", message: "音频地址不能包含用户名或密码。" };
  if (isPrivateMediaHostname(url.hostname)) {
    return { ok: false, code: "private_host", message: "不能播放本机、局域网或私有 IP 的音频。" };
  }
  return { ok: true, code: "ok", url: url.href, message: "" };
}

export function detectNeteaseShare(value) {
  const raw = String(value || "").trim();
  const urlMatch = raw.match(/https?:\/\/(?:[\w-]+\.)?(?:music\.163\.com|163cn\.tv)\/[^\s<>"']*/i);
  if (!urlMatch) return null;
  const cleanedUrl = urlMatch[0].replace(/[，。；、!！?？)）\]]+$/, "");
  let parsed;
  try { parsed = new URL(cleanedUrl); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  if (host === "163cn.tv" || host.endsWith(".163cn.tv")) {
    return Object.freeze({ provider: "网易云音乐", providerId: "netease", resourceType: "short", resourceId: "", playlistId: "", title: "网易云短链", shareUrl: parsed.href });
  }
  if (host !== "music.163.com" && !host.endsWith(".music.163.com")) return null;
  const pathMatch = parsed.pathname.match(/\/(?:m\/)?(playlist|song)(?:\/|$)/i);
  const hashMatch = parsed.hash.match(/#\/(playlist|song)\?[^#]*\bid=(\d+)/i);
  const resourceType = (pathMatch?.[1] || hashMatch?.[1] || "").toLowerCase();
  const resourceId = parsed.searchParams.get("id") || hashMatch?.[2] || "";
  if (!new Set(["playlist", "song"]).has(resourceType) || !/^\d{1,20}$/.test(resourceId)) return null;
  parsed.hash = "";
  parsed.search = `?id=${resourceId}`;
  const beforeLink = raw.slice(0, urlMatch.index).replace(/^(?:分享|复制).*?[:：]\s*/i, "").trim();
  const titleLines = beforeLink.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = titleLines[titleLines.length - 1] || (resourceType === "song" ? "网易云单曲" : "网易云歌单");
  return Object.freeze({ provider: "网易云音乐", providerId: "netease", resourceType, resourceId, playlistId: resourceType === "playlist" ? resourceId : "", title: text(title, 180), shareUrl: parsed.href });
}

export const detectNeteasePlaylistShare = (value) => {
  const resource = detectNeteaseShare(value);
  return resource?.resourceType === "playlist" ? resource : null;
};

function normalizeItem(item, index = 0) {
  const source = typeof item === "string" ? { url: item } : item || {};
  const url = text(source.url || source.audio_url || source.src, 4096);
  return Object.freeze({
    id: text(source.id || `local-${index}`, 100),
    title: text(source.title || source.name || `曲目 ${index + 1}`, 180),
    artist: text(source.artist || source.author, 180),
    album: text(source.album, 180),
    url,
    providerTrackId: text(source.provider_track_id ?? source.providerTrackId, 20),
    externalUrl: text(source.external_url ?? source.externalUrl, 4096),
    playbackMode: text(source.playback_mode ?? source.playbackMode ?? (url ? "direct_https" : ""), 40),
    coverUrl: text(source.cover_url ?? source.coverUrl ?? source.pic_url ?? source.album?.picUrl, 4096),
    durationSeconds: number(source.duration_seconds ?? source.duration),
    lyrics: String(source.lyrics ?? source.lyric ?? ""),
  });
}

function normalizeFavorite(value) {
  const source = value || {};
  return Object.freeze({
    itemId: text(source.item_id ?? source.itemId, 100),
    playlistId: text(source.playlist_id ?? source.playlistId, 100),
    title: text(source.title, 180),
    artist: text(source.artist, 180),
    album: text(source.album, 180),
    durationSeconds: number(source.duration_seconds ?? source.durationSeconds),
    favoritedAt: source.favorited_at ?? source.favoritedAt ?? "",
  });
}

export function normalizeMusicPlaylist(value) {
  const source = value?.playlist || value || {};
  const rawItems = source.items || source.tracks || source.playlist_items || [];
  const items = (Array.isArray(rawItems) ? rawItems : []).slice(0, MAX_ITEMS).map(normalizeItem);
  return Object.freeze({
    id: text(source.id, 100),
    name: text(source.name || source.title || "未命名歌单", 180),
    provider: text(source.provider || source.source_format || "local_playlist", 80),
    providerPlaylistId: text(source.provider_playlist_id ?? source.providerPlaylistId, 100),
    externalUrl: text(source.external_url ?? source.externalUrl, 4096),
    sourceFormat: text(source.source_format ?? source.sourceFormat, 80),
    itemCount: number(source.item_count ?? source.itemCount, items.length),
    savedItemCount: Number.isInteger(source.saved_item_count) && source.saved_item_count >= 0 ? source.saved_item_count : null,
    saveState: ["ready", "incomplete", "external_metadata"].includes(source.save_state) ? source.save_state : "unknown",
    items: Object.freeze(items),
    createdAt: source.created_at || "",
  });
}

function queryWithConnection(path, connectionId, parameters = {}) {
  const query = new URLSearchParams({ connection_id: text(connectionId, 100) });
  for (const [key, value] of Object.entries(parameters)) query.set(key, text(value, 500));
  return `${path}?${query}`;
}

function normalizeRemotePlaylists(data) {
  const values = Array.isArray(data?.playlists) ? data.playlists : Array.isArray(data) ? data : [];
  return Object.freeze(values.slice(0, MAX_ITEMS).map(normalizeMusicPlaylist));
}

export async function listNeteaseConnections(options = {}) {
  const data = await musicRequest("/api/mcp/connections/manage", { timeoutMs: READ_TIMEOUT_MS }, options);
  return Object.freeze((Array.isArray(data?.connections) ? data.connections : []).filter(
    (connection) => connection?.provider_profile === "netease_cloud_music",
  ));
}

export async function connectNeteaseMcp({ name, endpoint, token } = {}, options = {}) {
  const data = await musicRequest("/api/v2/music/providers/netease/connections/provision", {
    method: "POST",
    timeoutMs: WRITE_TIMEOUT_MS,
    body: JSON.stringify({
      name: text(name, 80),
      endpoint: text(endpoint, 1000),
      token: String(token ?? "").trim(),
    }),
  }, options);
  const connection = data?.connection || data;
  if (!connection?.id) throw Object.assign(new Error("服务器未返回连接保存回执，请刷新连接列表确认。"), { code: "music_connection_receipt_invalid" });
  return Object.freeze(connection);
}

export async function getNeteaseConnectionStatus(connectionId, options = {}) {
  const data = await musicRequest(`/api/v2/music/providers/netease/connections/${encodeURIComponent(connectionId)}/status`, { timeoutMs: READ_TIMEOUT_MS }, options);
  return data?.status && typeof data.status === "object" ? data.status : data;
}

export async function listNeteasePlaylists(connectionId, options = {}) {
  return normalizeRemotePlaylists(await musicRequest(queryWithConnection("/api/v2/music/providers/netease/playlists", connectionId), { timeoutMs: READ_TIMEOUT_MS }, options));
}

export async function getNeteasePlaylist(connectionId, providerPlaylistId, options = {}) {
  return normalizeMusicPlaylist(await musicRequest(queryWithConnection(
    `/api/v2/music/providers/netease/playlists/${encodeURIComponent(providerPlaylistId)}`,
    connectionId,
  ), { timeoutMs: READ_TIMEOUT_MS }, options));
}

export async function searchNeteaseMusic(connectionId, query, options = {}) {
  const data = await musicRequest(queryWithConnection("/api/v2/music/providers/netease/search", connectionId, { q: query }), { timeoutMs: READ_TIMEOUT_MS }, options);
  const values = Array.isArray(data?.items) ? data.items : Array.isArray(data?.tracks) ? data.tracks : Array.isArray(data) ? data : [];
  return Object.freeze(values.slice(0, MAX_ITEMS).map(normalizeItem));
}

export async function importNeteaseShare(connectionId, shareUrl, options = {}) {
  return importReceipt(await musicRequest("/api/v2/music/providers/netease/imports/share", {
    method: "POST",
    timeoutMs: WRITE_TIMEOUT_MS,
    body: JSON.stringify({ connection_id: text(connectionId, 100), share_url: text(shareUrl, 4096) }),
  }, options));
}

export async function readNeteaseCookieSession(options = {}) {
  return cookieReceipt(await musicRequest("/api/v2/music/providers/netease/cookie-session", {
    timeoutMs: 12_000,
  }, options));
}

export async function saveNeteaseCookieSession(cookie, options = {}) {
  return cookieReceipt(await musicRequest("/api/v2/music/providers/netease/cookie-session", {
    method: "POST",
    timeoutMs: 20_000,
    body: JSON.stringify({ cookie: text(cookie, 4096) }),
  }, options), true);
}

export async function clearNeteaseCookieSession(options = {}) {
  return cookieReceipt(await musicRequest("/api/v2/music/providers/netease/cookie-session", {
    method: "DELETE",
    timeoutMs: 12_000,
  }, options), false);
}
export async function requestExternalMusicPlayback(resourceType, resourceId, options = {}) {
  return musicRequest("/api/v2/music/providers/netease/external-playback", {
    method: "POST",
    timeoutMs: WRITE_TIMEOUT_MS,
    body: JSON.stringify({ resource_type: resourceType, resource_id: text(resourceId, 20) }),
  }, options);
}

export async function listAiMusicPlayRequests(options = {}) {
  const data = await musicRequest("/api/v2/music/providers/netease/ai-play-requests?delivery=claim-v1", { timeoutMs: READ_TIMEOUT_MS }, options);
  if (data?.delivery_protocol !== "claim-v1") throw Object.assign(new Error("服务器尚未启用点歌交接，请稍后重试或在一起听中手动打开。"), { code: "music_ai_delivery_protocol_required" });
  if (!Array.isArray(data?.requests)) throw Object.assign(new Error("服务器未返回有效点歌列表，请稍后重试。"), { code: "music_ai_requests_receipt_invalid" });
  return data.requests;
}

export async function claimAiMusicPlayRequest(id, deliveryToken, options = {}) {
  const data = await musicRequest(`/api/v2/music/providers/netease/ai-play-requests/${encodeURIComponent(id)}/claim`, {
    method: "POST", timeoutMs: WRITE_TIMEOUT_MS, retry: false, body: JSON.stringify({ delivery_token: deliveryToken }),
  }, options);
  if (data?.request?.id !== id || typeof data.claimed !== "boolean" || (data.claimed && typeof data.committed !== "boolean")) throw Object.assign(new Error("服务器未确认点歌领取，请稍后重试。"), { code: "music_ai_delivery_receipt_invalid" });
  return data;
}

export async function commitAiMusicPlayRequest(id, deliveryToken, options = {}) {
  const data = await musicRequest(`/api/v2/music/providers/netease/ai-play-requests/${encodeURIComponent(id)}/commit`, {
    method: "POST", timeoutMs: WRITE_TIMEOUT_MS, retry: false, body: JSON.stringify({ delivery_token: deliveryToken }),
  }, options);
  if (data?.request?.id !== id || data.ok !== true || data.committed !== true || typeof data.replayed !== "boolean") throw Object.assign(new Error("服务器未确认播放器交接，暂不重复打开，请在一起听中手动检查。"), { code: "music_ai_delivery_receipt_invalid" });
  return data;
}

export async function reportAiMusicPlayResult(id, result, options = {}) {
  const data = await musicRequest(`/api/v2/music/providers/netease/ai-play-requests/${encodeURIComponent(id)}/result`, {
    method: "POST", timeoutMs: WRITE_TIMEOUT_MS, retry: false, body: JSON.stringify(result),
  }, options);
  if (data?.ok !== true || (data.request && (data.request.id !== id || data.request.status !== result.status))) throw Object.assign(new Error("服务器未确认点歌结果，稍后只重传结果，不重复打开歌曲。"), { code: "music_ai_result_receipt_invalid" });
  return data;
}


// ---------- 网易云 Cookie 版音乐操作（App 内一键登录后可用） ----------

function normalizeSearchTrack(item) {
  return Object.freeze({
    providerTrackId: text(item?.provider_track_id ?? item?.id, 20),
    title: text(item?.title ?? item?.name, 180),
    artist: text(item?.artist, 180),
    album: text(item?.album, 180),
    coverUrl: text(item?.cover_url ?? item?.coverUrl, 4096),
    durationSeconds: number(item?.duration_seconds ?? item?.durationSeconds),
    externalUrl: text(item?.external_url ?? ("https://music.163.com/#/song?id=" + (item?.provider_track_id ?? item?.id)), 4096),
  });
}

export async function cookieSearchNetease(query, limit = 10, options = {}) {
  const data = await musicRequest("/api/v2/music/providers/netease/cookie/search?q=" + encodeURIComponent(text(query, 120)) + "&limit=" + Math.min(30, Math.max(1, number(limit, 10))), { timeoutMs: READ_TIMEOUT_MS }, options);
  const values = Array.isArray(data?.items) ? data.items : [];
  return Object.freeze(values.slice(0, 50).map(normalizeSearchTrack));
}

export async function cookieGetMyPlaylists(options = {}) {
  return musicRequest("/api/v2/music/providers/netease/cookie/my-playlists", { timeoutMs: READ_TIMEOUT_MS }, options);
}

export async function cookieGetPlaylistTracks(playlistId, options = {}) {
  return musicRequest("/api/v2/music/providers/netease/cookie/playlist?id=" + encodeURIComponent(text(playlistId, 20)), { timeoutMs: READ_TIMEOUT_MS }, options);
}

export async function cookieGetDailyRecommend(options = {}) {
  return musicRequest("/api/v2/music/providers/netease/cookie/daily", { timeoutMs: READ_TIMEOUT_MS }, options);
}

export async function cookieGetPlayHistory(limit = 20, options = {}) {
  return musicRequest("/api/v2/music/providers/netease/cookie/history?limit=" + Math.min(50, Math.max(1, number(limit, 20))), { timeoutMs: READ_TIMEOUT_MS }, options);
}

export async function cookieLikeSong(songId, like, options = {}) {
  return musicRequest("/api/v2/music/providers/netease/cookie/like", {
    method: "POST",
    timeoutMs: WRITE_TIMEOUT_MS,
    body: JSON.stringify({ song_id: text(songId, 20), like: like !== false }),
  }, options);
}

export async function cookieCreatePlaylist(name, privacy = false, options = {}) {
  return musicRequest("/api/v2/music/providers/netease/cookie/playlist", {
    method: "POST",
    timeoutMs: WRITE_TIMEOUT_MS,
    body: JSON.stringify({ name: text(name, 60), privacy: privacy === true }),
  }, options);
}

export async function cookieAddToPlaylist(playlistId, trackIds, options = {}) {
  return musicRequest("/api/v2/music/providers/netease/cookie/playlist/tracks", {
    method: "POST",
    timeoutMs: WRITE_TIMEOUT_MS,
    body: JSON.stringify({ playlist_id: text(playlistId, 20), track_ids: (Array.isArray(trackIds) ? trackIds : [trackIds]).map((id) => text(id, 20)).slice(0, 100) }),
  }, options);
}

export async function cookieRemoveFromPlaylist(playlistId, trackIds, options = {}) {
  return musicRequest("/api/v2/music/providers/netease/cookie/playlist/tracks", {
    method: "DELETE",
    timeoutMs: WRITE_TIMEOUT_MS,
    body: JSON.stringify({ playlist_id: text(playlistId, 20), track_ids: (Array.isArray(trackIds) ? trackIds : [trackIds]).map((id) => text(id, 20)).slice(0, 100) }),
  }, options);
}

export function parseMusicText(content, format = "auto") {
  const raw = String(content || "").replace(/^\uFEFF/, "").trim();
  const requested = String(format || "auto").toLowerCase();
  if (!raw) return [];
  if (requested === "json" || (requested === "auto" && (raw.startsWith("{") || raw.startsWith("[")))) {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : parsed.items || parsed.tracks || parsed.playlist_items || [];
    return items.map(normalizeItem);
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (requested === "m3u" || requested === "m3u8" || (requested === "auto" && lines.some((line) => line.toUpperCase() === "#EXTM3U"))) {
    const result = [];
    let metadata = {};
    for (const line of lines) {
      if (line.startsWith("#EXTINF:")) {
        const [, duration, label = ""] = line.match(/^#EXTINF:([^,]*),(.*)$/) || [];
        const split = label.split(" - ");
        metadata = { duration, title: split.pop() || label, artist: split.join(" - ") };
      } else if (!line.startsWith("#")) {
        result.push(normalizeItem({ ...metadata, url: line }, result.length));
        metadata = {};
      }
    }
    return result;
  }
  return lines.filter((line) => !line.startsWith("#")).map((line, index) => normalizeItem({ url: line, title: line.split("/").pop() }, index));
}

function resolveImportFormat(content, format) {
  const requested = String(format || "auto").toLowerCase();
  if (["txt", "text", "url", "tab"].includes(requested)) return "text";
  if (requested !== "auto") return requested;
  const raw = String(content || "").replace(/^\uFEFF/, "").trimStart();
  if (raw.startsWith("{") || raw.startsWith("[")) return "json";
  if (/^#EXTM3U/im.test(raw)) return "m3u";
  return "text";
}

export async function importMusicPlaylist({ format = "auto", sourceName = "粘贴内容", name = "我的歌单", content, requestId }, options = {}) {
  if (detectNeteaseShare(content)) {
    throw new Error("这是网易云网页分享，请使用网易云导入操作。");
  }
  const resolvedFormat = resolveImportFormat(content, format);
  const items = parseMusicText(content, resolvedFormat);
  if (!items.length) throw new Error("没有解析到可播放曲目。");
  return importReceipt(await musicRequest("/api/v2/music/playlists/import", {
    method: "POST", timeoutMs: WRITE_TIMEOUT_MS, retry: false,
    body: JSON.stringify({ format: resolvedFormat, source_name: text(sourceName, 180), name: text(name, 180), content: String(content || ""), ...(requestId ? { request_id: requestId } : {}) }),
  }, options));
}

export async function uploadLocalMusicFile(file, options = {}) {
  options = captureMusicScope(options, authSession);
  if (!(file instanceof Blob)) throw new Error("请选择一个音频文件。");
  if (file.size === 0) throw new Error("音频文件是空的。");
  if (file.size > 20 * 1024 * 1024) throw Object.assign(new Error("单个音频不能超过 20MB。大文件可选择仅本机播放。"), { code: "music_audio_too_large" });
  if (!/\.(?:mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(file.name || "audio.mp3")) throw Object.assign(new Error("请选择 MP3、M4A、AAC、WAV、OGG、OPUS 或 FLAC 音频。"), { code: "music_audio_type_invalid" });
  const form = new FormData();
  form.append("file", file, file.name || "audio.mp3");
  const response = await musicFetch("/api/v2/music/upload-audio", {
    method: "POST",
    timeoutMs: 60_000,
    body: form,
    retry: false,
  }, options);
  const data = await response.json().catch(() => ({}));
  assertMusicScope(options, authSession);
  if (!response.ok) {
    const code = data?.code || "music_audio_upload_failed";
    throw Object.assign(new Error(musicErrorMessage({ ...data, message: data?.message || data?.error, code, status: response.status }, "本机音频上传失败，请检查文件和网络后重试。")), { code, status: response.status, error_log_id: data?.error_log_id });
  }
  const receipt = validateDirectAudioUrl(data?.audio?.url);
  if (!receipt.ok) throw Object.assign(new Error("没有收到有效的音频上传回执，请重试上传同一文件。"), { code: "music_audio_receipt_invalid" });
  return Object.freeze({
    url: receipt.url,
    title: text(String(data.audio.title || "本机音频"), 180),
  });
}

export async function listMusicPlaylists(options = {}) {
  const data = await musicRequest("/api/v2/music/playlists", { timeoutMs: READ_TIMEOUT_MS }, options);
  return (Array.isArray(data?.playlists) ? data.playlists : []).map(normalizeMusicPlaylist);
}

export async function getMusicPlaylist(id, options = {}) {
  return requireMusicPlaylistReceipt(normalizeMusicPlaylist(await musicRequest(`/api/v2/music/playlists/${encodeURIComponent(id)}`, { timeoutMs: READ_TIMEOUT_MS }, options)));
}

export async function deleteMusicPlaylist(id, options = {}) {
  return musicRequest(`/api/v2/music/playlists/${encodeURIComponent(id)}`, { method: "DELETE", timeoutMs: WRITE_TIMEOUT_MS }, options);
}

export async function listMusicFavorites(options = {}) {
  const data = await musicRequest("/api/v2/music/favorites", { timeoutMs: READ_TIMEOUT_MS }, options);
  const favorites = Array.isArray(data?.favorites) ? data.favorites : Array.isArray(data) ? data : [];
  return Object.freeze(favorites.map(normalizeFavorite).filter((entry) => entry.itemId));
}

export async function putMusicFavorite(itemId, options = {}) {
  const data = await musicRequest(`/api/v2/music/favorites/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    timeoutMs: WRITE_TIMEOUT_MS,
    body: "{}",
  }, options);
  return normalizeFavorite(data?.favorite || data);
}

export async function deleteMusicFavorite(itemId, options = {}) {
  const data = await musicRequest(`/api/v2/music/favorites/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    timeoutMs: WRITE_TIMEOUT_MS,
  }, options);
  return Object.freeze({
    itemId: text(data?.deleted?.item_id ?? itemId, 100),
    favorited: false,
  });
}
