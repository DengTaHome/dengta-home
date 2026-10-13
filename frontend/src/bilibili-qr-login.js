import { apiRequest } from "./api.js";

const READ_TIMEOUT_MS = 12_000;
const WRITE_TIMEOUT_MS = 20_000;

function text(value, maximum = 200) {
  return String(value ?? "").trim().slice(0, maximum);
}

export async function beginBilibiliQrLogin() {
  const data = await apiRequest("/api/v2/co-watch/bilibili-qr/begin", {
    method: "POST",
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  return data?.session || null;
}

export async function checkBilibiliQrLogin(key) {
  const query = new URLSearchParams({ key: text(key, 200) });
  const data = await apiRequest(`/api/v2/co-watch/bilibili-qr/check?${query}`, {
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  return data?.result || null;
}

export async function getBilibiliQrStatus() {
  const data = await apiRequest("/api/v2/co-watch/bilibili-qr/status", {
    timeoutMs: READ_TIMEOUT_MS,
  });
  return data?.connection || { connected: false };
}

export async function disconnectBilibiliQrLogin() {
  const data = await apiRequest("/api/v2/co-watch/bilibili-qr/status", {
    method: "DELETE",
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  return data?.disconnected === true;
}

export async function listBilibiliFavoriteFolders() {
  const data = await apiRequest("/api/v2/co-watch/bilibili-qr/favorites", {
    timeoutMs: READ_TIMEOUT_MS,
  });
  return Array.isArray(data?.folders) ? data.folders : [];
}

export async function listBilibiliFavoriteVideos(mediaId, page = 1) {
  const data = await apiRequest(
    `/api/v2/co-watch/bilibili-qr/favorites/${encodeURIComponent(text(mediaId, 20))}?page=${Math.max(1, Number(page) || 1)}`,
    { timeoutMs: READ_TIMEOUT_MS },
  );
  return Array.isArray(data?.videos) ? data.videos : [];
}
