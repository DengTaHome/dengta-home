const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID}$`, "i");
const PRIVATE_MEDIA_PATH = new RegExp(
  `^\\/(?:(?:api\\/v2\\/(?:attachments|moments)|attachments)(?:\\/|$)|api\\/v2\\/creative\\/artworks\\/[^/?]+\\/image(?:\\?|$)|api\\/v2\\/private-media\\/assets\\/${UUID}\\/content(?:\\?|$))`,
  "i",
);

export function privateMediaRequestPath(value, apiBaseUrl) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (PRIVATE_MEDIA_PATH.test(source)) return source;

  try {
    const mediaUrl = new URL(source);
    const apiUrl = new URL(String(apiBaseUrl || ""));
    if (mediaUrl.origin !== apiUrl.origin) return "";

    const basePath = apiUrl.pathname.replace(/\/$/, "");
    const path = `${mediaUrl.pathname}${mediaUrl.search}`;
    if (basePath && !path.startsWith(`${basePath}/`)) return "";
    const relativePath = basePath ? path.slice(basePath.length) : path;
    return PRIVATE_MEDIA_PATH.test(relativePath) ? relativePath : "";
  } catch {
    return "";
  }
}

export function isPrivateMediaUrl(value, apiBaseUrl) {
  return Boolean(privateMediaRequestPath(value, apiBaseUrl));
}

export function privateMediaContentPath(id) {
  const value = String(id || "").trim();
  return UUID_PATTERN.test(value)
    ? `/api/v2/private-media/assets/${value}/content`
    : "";
}

export function isPrivateMediaAssetId(id) {
  return UUID_PATTERN.test(String(id || "").trim());
}

export function normalizePrivateMediaCatalog(data = {}) {
  const source = data && typeof data === "object" ? data : {};
  const root = source.catalog && typeof source.catalog === "object"
    ? source.catalog
    : source;
  const grouped = root.assets || root.items || [];
  const assets = Array.isArray(grouped)
    ? grouped
    : Object.entries(grouped).flatMap(([purpose, items]) =>
        (Array.isArray(items) ? items : []).map((item) => ({ purpose, ...item })),
      );
  return {
    assets: assets
      .map((asset) => ({
        ...asset,
        id: String(asset.id || asset.asset_id || ""),
        purpose: String(asset.purpose || asset.kind || ""),
        display_name: String(asset.display_name || ""),
        alt_text: String(asset.alt_text || ""),
        mood_tags: Array.isArray(asset.mood_tags)
          ? asset.mood_tags
          : String(asset.mood_tags || "")
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
      }))
      .filter((asset) => privateMediaContentPath(asset.id) && asset.status !== "archived"),
    preferences: root.preferences || source.preferences || {},
  };
}

export function selectedPrivateMedia(catalog, purpose) {
  const normalized = normalizePrivateMediaCatalog(catalog);
  const selectedId = String(
    normalized.preferences[`${purpose}_asset_id`] ||
      normalized.preferences[`${purpose}_id`] ||
      normalized.preferences[purpose] ||
      "",
  );
  return (
    normalized.assets.find(
      (asset) => asset.id === selectedId && asset.purpose === purpose,
    ) || null
  );
}

export function privateMediaAsset(catalog, id, purpose = "") {
  const safePath = privateMediaContentPath(id);
  if (!safePath) return null;
  return (
    normalizePrivateMediaCatalog(catalog).assets.find(
      (asset) => asset.id === id && (!purpose || asset.purpose === purpose),
    ) || null
  );
}
