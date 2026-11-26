/**
 * 启动期只读请求的白名单与去重键。
 *
 * 实测：一次冷启动里 bootstrap、special-dates、fun-labs 的四个接口各被请求**两遍**，
 * 而且两次缓存读取都发生在第一次写入之前——说明是两个**并发**调用同时拉起的
 * （作用域确定前后各挂载了一次）。每遍都要付跨境往返的钱，这就是首屏那几秒。
 *
 * 处理方式在 api.js：同键并发只发一次，后来者复用第一个请求的结果。
 * 这里只负责「哪些请求可以安全合并」以及「键怎么算」。
 */

/** 只合并这些前缀的 GET。刻意不包含 sessions / messages / 聊天流等强时效数据。 */
export const CACHEABLE_GET_PREFIXES = Object.freeze([
  "/api/v2/bootstrap",
  "/api/v2/xinchao/",
  "/api/v2/private-media/catalog",
  "/api/v2/special-dates",
  "/api/v2/fun-labs/",
  "/api/v2/chat-skin/preferences",
  "/api/v2/voice-output/status",
  "/api/v2/companion-state",
  "/models",
  "/health",
]);

/** Every authenticated response belongs to the account and companion that requested it. */
export const COMPANION_SCOPED_PREFIXES = CACHEABLE_GET_PREFIXES;

function normalizePath(path) {
  const value = String(path || "");
  const queryAt = value.indexOf("?");
  return queryAt >= 0 ? value.slice(0, queryAt) : value;
}

export function isCacheableGetPath(path) {
  const base = normalizePath(path);
  return CACHEABLE_GET_PREFIXES.some((prefix) => base.startsWith(prefix));
}

export function isCompanionScopedPath(path) {
  const base = normalizePath(path);
  return COMPANION_SCOPED_PREFIXES.some((prefix) => base.startsWith(prefix));
}

export function getCacheKey(path, { accountId = "", companionId = "", revision = null } = {}) {
  if (!accountId) return null;
  return JSON.stringify([String(accountId), String(companionId), revision, String(path || "")]);
}
