import { funLabsDiagnostic } from "./fun-labs-refresh.js";
import { describeOperationError } from "./operation-error-help.js";
import { recordOperationFailure } from "./operation-diagnostics.js";

export const DISCOVERY_ERROR_FEEDBACK = Object.freeze({
  interest_profile_empty: { reason: "还没有足够的一起看记录来推荐视频。", action: "先挑一个视频一起看，之后再回来换一批。" },
  interest_profile_read_failed: { reason: "服务器未能读取兴趣档案。", action: "重试读取，持续失败时查看日志；无需重新建立账号。" },
  interest_history_read_failed: { reason: "服务器未能读取最近的观看记录。", action: "重试读取并查看日志，已有记录不会因此删除。" },
  interest_unavailable: { reason: "当前服务器尚未提供兴趣推荐服务。", action: "其他玩法仍可使用；通过日志核对服务器配置。" },
  discover_interests_invalid: { reason: "兴趣接口返回的数据格式不完整。", action: "重试读取并查看日志；保留上次成功的兴趣信息。" },
  discover_recommend_invalid: { reason: "推荐接口返回的视频信息不完整。", action: "重试读取并查看日志；保留上次成功的视频。" },
  discover_load_failed: { reason: "推荐读取失败，具体原因尚未确认。", action: "检查连接后换一批，再通过日志核对原因。" },
});

export function emptyDiscoveryState() {
  return { busy: false, interests: [], recommend: null, sections: {
    interests: { status: "idle", diagnostic: null }, recommend: { status: "idle", diagnostic: null },
  } };
}

function invalid(code) { throw Object.assign(new Error("Discovery receipt is incomplete"), { code }); }
export function discoveryValue(section, data) {
  if (section === "interests") {
    const rows = data?.profile?.interests;
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row.term !== "string" || !row.term.trim())) invalid("discover_interests_invalid");
    return rows.map(({ term }) => ({ term }));
  }
  const feed = data?.recommend;
  if (!feed || !Array.isArray(feed.videos) || (feed.reason != null && typeof feed.reason !== "string")) invalid("discover_recommend_invalid");
  const ids = new Set();
  const videos = feed.videos.map(video => {
    if (!video || typeof video.bvid !== "string" || !/^BV[a-zA-Z0-9]{10}$/.test(video.bvid) || typeof video.title !== "string" || !video.title.trim()
      || ["author", "duration", "cover"].some(key => video[key] != null && typeof video[key] !== "string")
      || (video.play != null && (typeof video.play !== "number" || !Number.isFinite(video.play) || video.play < 0))) invalid("discover_recommend_invalid");
    if (ids.has(video.bvid)) return null;
    ids.add(video.bvid);
    let cover = "";
    if (video.cover) {
      try {
        const url = new URL(video.cover.startsWith("//") ? `https:${video.cover}` : video.cover);
        if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) { url.protocol = "https:"; cover = url.href; }
      } catch { /* A broken optional cover uses the existing visual fallback. */ }
    }
    return { bvid: video.bvid, title: video.title, author: video.author || "", duration: video.duration || "", cover, play: video.play ?? 0 };
  }).filter(Boolean);
  return { reason: feed.reason || "", videos };
}

export function discoveryFailure(error) {
  const diagnostic = funLabsDiagnostic(error, "discover_load_failed", DISCOVERY_ERROR_FEEDBACK);
  const help = [401, 403].includes(diagnostic.http_status)
    ? describeOperationError({ code: diagnostic.error_code, status: diagnostic.http_status })
    : DISCOVERY_ERROR_FEEDBACK[diagnostic.error_code] || describeOperationError({ code: diagnostic.error_code, status: diagnostic.http_status });
  return { ...help, diagnostic };
}

export async function refreshDiscovery({ token, currentToken, isMounted, lock, request, update, previousVideos = [] }) {
  if (!isMounted() || currentToken() !== token || lock.current?.scope === token) return;
  const operation = { scope: token };
  lock.current = operation;
  const revision = token.discoveryRevision = (token.discoveryRevision || 0) + 1;
  const current = () => isMounted() && currentToken() === token && token.discoveryRevision === revision;
  const change = transform => update(previous => {
    if (!current()) return previous;
    const state = previous.scope === token ? previous : emptyDiscoveryState();
    const next = transform({ ...state, scope: token, sections: { ...state.sections } });
    return { ...next, busy: Object.values(next.sections).some(section => section.status === "busy") };
  });
  change(state => ({ ...state, sections: { interests: { status: "busy", diagnostic: null }, recommend: { status: "busy", diagnostic: null } } }));
  const ids = previousVideos.map(video => video.bvid).filter(id => /^BV[a-zA-Z0-9]{10}$/.test(id));
  const exclude = ids.length ? `&exclude=${encodeURIComponent(ids.join(","))}` : "";
  try {
    return await Promise.all([
      ["interests", "/api/v2/fun-labs/interests", 15_000],
      ["recommend", `/api/v2/fun-labs/recommend?limit=4${exclude}`, 30_000],
    ].map(async ([section, path, timeoutMs]) => {
      try {
        const value = discoveryValue(section, await request(path, { timeoutMs }));
        if (!current()) return "stale";
        change(state => ({ ...state, [section]: value, sections: { ...state.sections, [section]: { status: "success", diagnostic: null } } }));
        return "success";
      } catch (error) {
        if (!current()) return "stale";
        if (["discover_interests_invalid", "discover_recommend_invalid"].includes(error?.code)) recordOperationFailure(token.scope, path, error);
        const feedback = discoveryFailure(error);
        change(state => ({ ...state, sections: { ...state.sections, [section]: { status: "error", ...feedback } } }));
        return "error";
      }
    }));
  } finally { if (lock.current === operation) lock.current = null; }
}

export async function copyDiscoveryLink(bvid, { clipboard = globalThis.navigator?.clipboard, current, feedback }) {
  if (typeof bvid !== "string" || !/^BV[a-zA-Z0-9]{10}$/.test(bvid) || !current()) return;
  try {
    if (typeof clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
    await clipboard.writeText(`https://www.bilibili.com/video/${bvid}`);
    if (current()) feedback("已复制视频链接。");
  } catch {
    if (current()) feedback("视频链接未复制成功：浏览器未允许访问剪贴板。可以重新点击复制，或打开视频后从地址栏复制。错误代码：clipboard_write_failed");
  }
}
