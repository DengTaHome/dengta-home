const kinds = new Set(["music", "watch", "takeout", "bilibili", "art"]);

export function normalizeCompanionActivities(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).flatMap(action => {
    if (!action || !kinds.has(action.kind) || typeof action.id !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(action.id)) return [];
    const seen = new Set();
    const videos = (Array.isArray(action.videos) ? action.videos : []).slice(0, 12).flatMap(video => {
      if (!/^BV[0-9A-Za-z]{10}$/.test(String(video?.bvid || "")) || seen.has(video.bvid)) return [];
      seen.add(video.bvid);
      return [{ bvid: video.bvid, title: String(video.title || "B站视频").slice(0, 300), creator: String(video.creator || "").slice(0, 100), pageUrl: `https://www.bilibili.com/video/${video.bvid}` }];
    });
    return [{ id: action.id, kind: action.kind, query: String(action.query || "").slice(0, 120), videos }];
  });
}

export function buildCompanionActivityRequest(action, accountScope, companionScope) {
  if (!accountScope || !companionScope) return null;
  const normalized = normalizeCompanionActivities([action])[0];
  if (!normalized || normalized.kind === "bilibili") return null;
  const pageUrl = normalized.kind === "watch" && /^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/.test(action.pageUrl || "") ? action.pageUrl : "";
  return Object.freeze({ ...normalized, pageUrl, accountScope, companionScope });
}

export function activityRequestInScope(request, accountScope, companionScope) {
  if (!accountScope || !companionScope) return null;
  return request?.accountScope === accountScope && request?.companionScope === companionScope ? request : null;
}
