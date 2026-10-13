import { apiRequest } from "./api.js";
import { DeviceSignals, deviceSignalsPluginAvailable } from "./device-signals.js";

const READ_TIMEOUT_MS = 12_000;
const WRITE_TIMEOUT_MS = 30_000;
const ANALYZE_TIMEOUT_MS = 180_000;

function text(value, maximum = 300) {
  return String(value ?? "").trim().slice(0, maximum);
}

// 风控要求真实设备号:App 上报本机真实信息,后端据此派生设备号。
async function readDeviceIdentity() {
  const available = deviceSignalsPluginAvailable();
  console.log("[qr-device] plugin available:", available);
  if (!available) return null;
  try {
    const identity = await DeviceSignals.getDeviceIdentity();
    console.log("[qr-device] identity ok:", JSON.stringify(identity).slice(0, 120));
    return identity;
  } catch (error) {
    console.log("[qr-device] identity error:", String(error?.message || error));
    return null;
  }
}

export async function beginNeteaseQrLogin() {
  const device = await readDeviceIdentity();
  const data = await apiRequest("/api/v2/music/providers/netease/qr/begin", {
    method: "POST",
    timeoutMs: WRITE_TIMEOUT_MS,
    body: JSON.stringify({ device: device || {} }),
  });
  return data?.session || null;
}

export async function checkNeteaseQrLogin(key) {
  const query = new URLSearchParams({ key: text(key, 200) });
  const data = await apiRequest(`/api/v2/music/providers/netease/qr/check?${query}`, {
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  return data?.result || null;
}

export async function getNeteaseQrStatus() {
  const data = await apiRequest("/api/v2/music/providers/netease/qr/status", {
    timeoutMs: READ_TIMEOUT_MS,
  });
  return data?.connection || { connected: false };
}

export async function disconnectNeteaseQrLogin() {
  const data = await apiRequest("/api/v2/music/providers/netease/qr/status", {
    method: "DELETE",
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  return data?.disconnected === true;
}

export async function listNeteaseQrPlaylists() {
  const data = await apiRequest("/api/v2/music/providers/netease/qr/playlists", {
    timeoutMs: READ_TIMEOUT_MS,
  });
  return Array.isArray(data?.playlists) ? data.playlists : [];
}

export async function importNeteaseQrPlaylist(providerPlaylistId) {
  const data = await apiRequest("/api/v2/music/providers/netease/qr/import", {
    method: "POST",
    timeoutMs: 120_000,
    body: JSON.stringify({ provider_playlist_id: text(providerPlaylistId, 20) }),
  });
  return data?.import || data;
}

export async function refreshNeteaseQrPlaylist(playlistId) {
  const data = await apiRequest("/api/v2/music/providers/netease/qr/refresh", {
    method: "POST",
    timeoutMs: 120_000,
    body: JSON.stringify({ playlist_id: text(playlistId, 100) }),
  });
  return data?.refresh || data;
}

export async function getNeteaseQrSongUrl(providerTrackId) {
  const query = new URLSearchParams({ id: text(providerTrackId, 20) });
  const data = await apiRequest(`/api/v2/music/providers/netease/qr/song-url?${query}`, {
    timeoutMs: READ_TIMEOUT_MS,
  });
  return data?.playback || { url: "" };
}

export async function analyzeMusicUnderstanding({ providerTrackId, title, artist } = {}) {
  const data = await apiRequest("/api/v2/music/understanding/analyze", {
    method: "POST",
    timeoutMs: ANALYZE_TIMEOUT_MS,
    body: JSON.stringify({
      provider_track_id: text(providerTrackId, 20),
      title: text(title, 300),
      artist: text(artist, 300),
    }),
  });
  return data?.understanding || data;
}

export async function narrateMusicUnderstanding({ providerTrackId, title, artist, tier } = {}) {
  const data = await apiRequest("/api/v2/music/understanding/narration", {
    method: "POST",
    timeoutMs: ANALYZE_TIMEOUT_MS,
    body: JSON.stringify({
      provider_track_id: text(providerTrackId, 20),
      title: text(title, 300),
      artist: text(artist, 300),
      tier: tier === "expert" ? "expert" : "casual",
    }),
  });
  return data?.result || data;
}

export async function readMusicUnderstanding(providerTrackId) {
  const data = await apiRequest(
    `/api/v2/music/understanding/tracks/${encodeURIComponent(text(providerTrackId, 20))}`,
    { timeoutMs: READ_TIMEOUT_MS },
  );
  return data?.understanding || null;
}
