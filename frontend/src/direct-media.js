import {
  accountStorageKey,
  readAccountStorage,
  writeAccountStorage,
} from "./account-storage.js";

export const DIRECT_MEDIA_SOURCE_APP = "dengta-direct-media";
export const WEB_PAGE_SOURCE_APP = "dengta-web-page";
export const DIRECT_MEDIA_SESSION_KEY = "dengta.together.direct-media.v2";

function mediaScope(accountScope, companionScope) {
  return accountScope && companionScope ? JSON.stringify([accountScope, companionScope]) : "";
}

const MAX_MEDIA_URL_LENGTH = 4096;

function normalizeHostname(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function parseIpv4(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const octets = hostname.split(".").map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255)
    ? octets
    : null;
}

function isPrivateIpv4(hostname) {
  const octets = parseIpv4(hostname);
  if (!octets) return false;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isPrivateIpv6(hostname) {
  if (!hostname.includes(":")) return false;
  const normalized = hostname.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:0" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }
  const firstGroup = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
  if ((firstGroup & 0xfe00) === 0xfc00 || (firstGroup & 0xffc0) === 0xfe80) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isPrivateIpv4(mapped)) return true;
    const groups = mapped.split(":");
    if (groups.length === 2 && groups.every((group) => /^[\da-f]{1,4}$/.test(group))) {
      const high = Number.parseInt(groups[0], 16);
      const low = Number.parseInt(groups[1], 16);
      return isPrivateIpv4(
        `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
      );
    }
  }
  return false;
}

export function isPrivateMediaHostname(value) {
  const hostname = normalizeHostname(value);
  if (!hostname) return true;
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }
  return isPrivateIpv4(hostname) || isPrivateIpv6(hostname);
}

function isKnownVideoPage(url) {
  const hostname = normalizeHostname(url.hostname);
  const pathname = url.pathname.toLowerCase();
  if (hostname === "b23.tv" || hostname.endsWith(".b23.tv")) return true;
  if (
    hostname === "bilibili.com" ||
    hostname.endsWith(".bilibili.com")
  ) {
    return pathname.startsWith("/video/") || pathname.startsWith("/bangumi/");
  }
  if (
    hostname === "iqiyi.com" ||
    hostname.endsWith(".iqiyi.com") ||
    hostname === "iq.com" ||
    hostname.endsWith(".iq.com")
  ) {
    return true;
  }
  return false;
}

function invalid(code, message) {
  return Object.freeze({ ok: false, code, message, url: "" });
}

export function validateDirectMediaUrl(value) {
  const input = String(value || "").trim();
  if (!input) return invalid("required", "请先粘贴 HTTPS 视频直链。");
  if (input.length > MAX_MEDIA_URL_LENGTH) {
    return invalid("too_long", "视频链接过长，请更换有效的媒体直链。");
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return invalid("invalid", "链接格式不正确，请粘贴完整的 HTTPS 地址。");
  }
  if (parsed.protocol !== "https:") {
    return invalid(
      "protocol",
      "为了保护设备安全，只允许 HTTPS 视频直链；不支持 HTTP、javascript、data、file 或 blob 地址。",
    );
  }
  if (parsed.username || parsed.password) {
    return invalid("userinfo", "链接不能包含用户名或密码，请更换公开的 HTTPS 视频直链。");
  }
  if (isPrivateMediaHostname(parsed.hostname)) {
    return invalid("private_host", "不能播放 localhost、局域网或私有 IP 地址中的视频。");
  }
  if (isKnownVideoPage(parsed)) {
    return invalid(
      "provider_page",
      "这是爱奇艺或哔哩哔哩的网页链接，不是视频文件直链。受平台授权和防盗链限制，DengTa 不能提取该网页中的视频。",
    );
  }
  return Object.freeze({ ok: true, code: "ok", message: "", url: parsed.href });
}

function cleanPlaybackNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(604800, Math.max(0, number));
}

export function readDirectMediaSession(storage, accountScope = "", companionScope = "") {
  const scope = mediaScope(accountScope, companionScope);
  if (!scope) return null;
  try {
    const stored = readAccountStorage(
      storage,
      DIRECT_MEDIA_SESSION_KEY,
      scope,
    );
    if (!stored) return null;
    const value = JSON.parse(stored);
    const validation = validateDirectMediaUrl(value?.url);
    if (!validation.ok) {
      storage?.removeItem(accountStorageKey(DIRECT_MEDIA_SESSION_KEY, scope));
      return null;
    }
    return Object.freeze({
      url: validation.url,
      title: String(value?.title || "").trim().slice(0, 180),
      positionSeconds: cleanPlaybackNumber(value?.positionSeconds),
      durationSeconds: cleanPlaybackNumber(value?.durationSeconds),
    });
  } catch {
    return null;
  }
}

export function storeDirectMediaSession(
  storage,
  accountScope = "",
  value = {},
  companionScope = "",
) {
  const scope = mediaScope(accountScope, companionScope);
  if (!scope) return invalid("scope_required", "请先选择账号和伴侣。");
  const validation = validateDirectMediaUrl(value.url);
  if (!validation.ok) return validation;
  try {
    writeAccountStorage(
      storage,
      DIRECT_MEDIA_SESSION_KEY,
      scope,
      JSON.stringify({
        url: validation.url,
        title: String(value.title || "").trim().slice(0, 180),
        positionSeconds: cleanPlaybackNumber(value.positionSeconds),
        durationSeconds: cleanPlaybackNumber(value.durationSeconds),
      }),
    );
  } catch {
    // Some embedded browsers disable sessionStorage. Playback still works in memory.
  }
  return validation;
}

export function clearDirectMediaSession(storage, accountScope = "", companionScope = "") {
  const scope = mediaScope(accountScope, companionScope);
  if (!scope) return;
  try {
    storage?.removeItem(accountStorageKey(DIRECT_MEDIA_SESSION_KEY, scope));
  } catch {
    // The in-memory player can still be cleared when storage is unavailable.
  }
}
