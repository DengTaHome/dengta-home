import { apiFetch, apiRequest } from "./api.js";
import { isPrivateMediaAssetId } from "./private-media.js";

export const PRIVATE_MEDIA_IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;
export const PRIVATE_MEDIA_BACKGROUND_LIMIT_BYTES = 12 * 1024 * 1024;

function errorMessage(data, fallback) {
  return String(data?.message || data?.error || fallback);
}

async function parseResponse(response, fallback) {
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(errorMessage(data, fallback));
    error.status = response.status;
    error.code = data?.code || "private_media_request_failed";
    throw error;
  }
  return data;
}

export function privateMediaFileLimit(purpose) {
  return purpose === "chat_background"
    ? PRIVATE_MEDIA_BACKGROUND_LIMIT_BYTES
    : PRIVATE_MEDIA_IMAGE_LIMIT_BYTES;
}

export function privateMediaFileWarning(file, purpose) {
  if (!file || file.size <= privateMediaFileLimit(purpose)) return "";
  const limit = purpose === "chat_background" ? "12 MB" : "5 MB";
  return `图片超过前端建议的 ${limit}；仍可提交，并以后端校验结果为准。`;
}

export async function getPrivateMediaCatalog(client = { apiRequest }) {
  return client.apiRequest("/api/v2/private-media/catalog");
}

export async function uploadPrivateMediaAsset(
  { image, purpose, displayName = "", altText = "", moodTags = [] },
  client = { apiFetch },
) {
  const form = new FormData();
  // Backend multer expects the binary under the "file" field.
  form.append("file", image);
  form.append("purpose", purpose);
  form.append("display_name", displayName);
  form.append("alt_text", altText);
  form.append(
    "mood_tags",
    Array.isArray(moodTags) ? moodTags.join(",") : String(moodTags || ""),
  );
  const response = await client.apiFetch("/api/v2/private-media/assets", {
    method: "POST",
    body: form,
    retry: false,
  });
  return parseResponse(response, "图片上传失败，请稍后重试。");
}

const PREFERENCE_PURPOSES = ["user_avatar", "companion_avatar", "chat_background"];

export function updatePrivateMediaPreferences(preferences, client = { apiRequest }) {
  const source = preferences && typeof preferences === "object" ? preferences : {};
  // Translate the map-style API ({user_avatar_asset_id: id}) into the
  // backend's one-purpose-per-request contract ({purpose, asset_id}).
  const pairs = PREFERENCE_PURPOSES.flatMap((purpose) => {
    const value = Object.hasOwn(source, `${purpose}_asset_id`)
      ? source[`${purpose}_asset_id`]
      : Object.hasOwn(source, purpose)
        ? source[purpose]
        : undefined;
    if (value === undefined) return [];
    return [{ purpose, asset_id: value || null }];
  });
  if (!pairs.length) return Promise.resolve({ ok: true, preferences: [] });
  return Promise.all(
    pairs.map((pair) =>
      client.apiRequest("/api/v2/private-media/preferences", {
        method: "PUT",
        body: JSON.stringify(pair),
      }),
    ),
  ).then((results) => results[results.length - 1]);
}

export function patchPrivateMediaAsset(id, changes, client = { apiRequest }) {
  if (!isPrivateMediaAssetId(id)) {
    throw new TypeError("私密媒体资源 ID 无效。");
  }
  return client.apiRequest(
    `/api/v2/private-media/assets/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(changes) },
  );
}

export function archivePrivateMediaAsset(id, permanent = false, client = { apiRequest }) {
  // Preserve the previous (id, client) signature; only literal true requests deletion.
  if (permanent && typeof permanent === "object") {
    client = permanent;
    permanent = false;
  }
  if (!isPrivateMediaAssetId(id)) {
    throw new TypeError("私密媒体资源 ID 无效。");
  }
  const query = permanent === true ? `?permanent=true` : "";
  return client.apiRequest(
    `/api/v2/private-media/assets/${encodeURIComponent(id)}${query}`,
    { method: "DELETE" },
  );
}
