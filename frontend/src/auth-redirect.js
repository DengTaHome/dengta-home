export const PUBLIC_AUTH_REDIRECT_URL =
  "https://www.dengtahome.com/";

const BUILD_PUBLIC_AUTH_REDIRECT_URL =
  import.meta.env?.VITE_PUBLIC_AUTH_REDIRECT_URL;
const BUILD_APP_BASE_URL = import.meta.env?.BASE_URL;
const OFFICIAL_WEB_HOSTS = new Set([
  "dengtahome.com",
  "www.dengtahome.com",
  "your-project-1.vercel.app",
  "your-project-5.onrender.com",
  "your-project-4.onrender.com",
]);

function cleanHttpUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return undefined;
  try {
    return new URL(text).toString();
  } catch {
    return undefined;
  }
}

function currentAppUrl(location, baseUrl) {
  const origin = cleanHttpUrl(location?.origin);
  if (!origin) return undefined;

  const rawBase = String(baseUrl || "").trim();
  const absoluteBase = cleanHttpUrl(rawBase);
  if (absoluteBase) return absoluteBase;

  let pathname =
    rawBase && !["/", "./"].includes(rawBase)
      ? rawBase
      : String(location?.pathname || "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;

  const callback = new URL(pathname, origin);
  callback.search = "";
  callback.hash = "";
  if (!callback.pathname.endsWith("/")) callback.pathname += "/";
  return callback.toString();
}

const DEEP_LINK_SCHEME = "dengta://auth";

export function resolveEmailRedirectUrl({
  nativePlatform = false,
  location = globalThis.location,
  configuredUrl = BUILD_PUBLIC_AUTH_REDIRECT_URL,
  baseUrl = BUILD_APP_BASE_URL,
  officialUrl = PUBLIC_AUTH_REDIRECT_URL,
} = {}) {
  const configured = cleanHttpUrl(configuredUrl);
  if (configured) return configured;

  // 缺陷 1 修复：原生 App 返回深度链接，用户点击邮箱验证/重置链接后
  // 回跳到 dengta://auth#access_token=...，由 AppUrlOpen 监听器接收。
  if (nativePlatform) return DEEP_LINK_SCHEME;

  const official = cleanHttpUrl(officialUrl);
  if (nativePlatform) return official;

  const origin = cleanHttpUrl(location?.origin);
  if (!origin) return official;
  const current = new URL(origin);
  if (OFFICIAL_WEB_HOSTS.has(current.hostname)) return official;

  return currentAppUrl(location, baseUrl) || official;
}
