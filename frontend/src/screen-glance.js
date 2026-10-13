import { Capacitor, registerPlugin } from "@capacitor/core";

export const ScreenGlance = registerPlugin("ScreenGlance");
export const SCREEN_GLANCE_DEFAULT_CONFIG = Object.freeze({
  randomEnabled: false,
  minimumMinutes: 60,
  maximumMinutes: 180,
  wifiOnly: true,
  chargingOnly: false,
  watchTogetherEnabled: false,
  watchIntervalSeconds: 90,
  coWatchSessionId: "",
});

const MAX_CAPTURE_BYTES = 1_500_000;
const SUPPORTED_CAPTURE_TYPES = new Set(["image/jpeg", "image/png"]);

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function isoTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

export function normalizeScreenGlanceConfig(value = {}) {
  const minimumMinutes = boundedInteger(
    value.minimumMinutes,
    1,
    180,
    SCREEN_GLANCE_DEFAULT_CONFIG.minimumMinutes,
  );
  const requestedMaximum = boundedInteger(
    value.maximumMinutes,
    1,
    180,
    SCREEN_GLANCE_DEFAULT_CONFIG.maximumMinutes,
  );
  return {
    randomEnabled: value.randomEnabled === true,
    minimumMinutes,
    maximumMinutes: Math.max(minimumMinutes, requestedMaximum),
    wifiOnly:
      value.wifiOnly === undefined
        ? SCREEN_GLANCE_DEFAULT_CONFIG.wifiOnly
        : value.wifiOnly === true,
    chargingOnly: value.chargingOnly === true,
    watchTogetherEnabled: value.watchTogetherEnabled === true,
    watchIntervalSeconds: boundedInteger(
      value.watchIntervalSeconds,
      60,
      10_800,
      SCREEN_GLANCE_DEFAULT_CONFIG.watchIntervalSeconds,
    ),
    coWatchSessionId:
      typeof value.coWatchSessionId === "string"
        ? value.coWatchSessionId.trim().slice(0, 80)
        : "",
  };
}

export function normalizeScreenGlanceState(value = {}) {
  const config = normalizeScreenGlanceConfig(value);
  return Object.freeze({
    supported: value.supported === true,
    active: value.active === true,
    paused: value.paused === true,
    randomEnabled: value.randomEnabled === true,
    minimumMinutes: config.minimumMinutes,
    maximumMinutes: config.maximumMinutes,
    wifiOnly: config.wifiOnly,
    chargingOnly: config.chargingOnly,
    watchTogetherEnabled: config.watchTogetherEnabled,
    watchIntervalSeconds: config.watchIntervalSeconds,
    coWatchSessionId: config.coWatchSessionId,
    pendingCapture: value.pendingCapture === true,
    capturedAt: isoTimestamp(value.capturedAt),
    nextCaptureAt: isoTimestamp(value.nextCaptureAt),
    nextWatchCaptureAt: isoTimestamp(value.nextWatchCaptureAt),
    coWatchPreviewAvailable: value.coWatchPreviewAvailable === true,
    coWatchPreviewCapturedAt: isoTimestamp(value.coWatchPreviewCapturedAt),
    lastReactionAt: isoTimestamp(value.lastReactionAt),
    lastReaction:
      typeof value.lastReaction === "string"
        ? value.lastReaction.replace(/\s+/g, " ").trim().slice(0, 160)
        : "",
    lastError:
      typeof value.lastError === "string"
        ? value.lastError.replace(/\s+/g, " ").trim().slice(0, 160)
        : "",
  });
}

export function screenGlancePluginAvailable(capacitor = Capacitor) {
  return (
    capacitor.isNativePlatform() &&
    capacitor.isPluginAvailable("ScreenGlance")
  );
}

function decodeBase64(value) {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source || source.length > Math.ceil((MAX_CAPTURE_BYTES * 4) / 3) + 8) {
    throw new Error("无法读取屏幕画面，图片为空或过大。");
  }
  try {
    const binary = globalThis.atob(source);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CAPTURE_BYTES) {
      throw new Error("capture_size_invalid");
    }
    return bytes;
  } catch {
    throw new Error("无法读取屏幕画面，图片数据已经失效。");
  }
}

function captureFileName(capturedAt, mimeType) {
  const timestamp = isoTimestamp(capturedAt) || new Date().toISOString();
  const compact = timestamp.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `dengta-screen-glance-${compact}.${
    mimeType === "image/png" ? "png" : "jpg"
  }`;
}

export function screenGlanceCaptureToFile(value = {}) {
  const mimeType = String(value.mimeType || "").toLowerCase();
  if (!SUPPORTED_CAPTURE_TYPES.has(mimeType)) {
    throw new Error("不支持这次屏幕画面的图片格式。");
  }
  const bytes = decodeBase64(value.base64);
  return new File([bytes], captureFileName(value.capturedAt, mimeType), {
    type: mimeType,
    lastModified: Date.parse(value.capturedAt) || Date.now(),
  });
}

export function buildScreenGlanceTurn(value = {}) {
  const capturedAt = isoTimestamp(value.capturedAt);
  return Object.freeze({
    displayText: "（允许伴侣看了一眼刚才共享的屏幕）",
    turnContext: [
      "用户通过 Android 系统屏幕共享明确授权了这一张当前画面。",
      "请结合你此刻的人设、心情和最近对话，自主决定要不要吐槽、调侃、问一句或安静不评价，不要使用固定模板。",
      capturedAt ? `画面捕获时间：${capturedAt}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

export function clearPendingScreenGlanceTurn(
  pending,
  revokeAttachment = () => {},
) {
  if (pending?.attachment) revokeAttachment(pending.attachment);
  return null;
}

export async function readScreenGlanceState({
  capacitor = Capacitor,
  plugin = ScreenGlance,
} = {}) {
  if (!screenGlancePluginAvailable(capacitor)) {
    return normalizeScreenGlanceState({});
  }
  return normalizeScreenGlanceState(await plugin.getState());
}

export async function readCoWatchPreview({
  capacitor = Capacitor,
  plugin = ScreenGlance,
  accountScope = "",
  companionScope = "",
} = {}) {
  if (!screenGlancePluginAvailable(capacitor)) return null;
  const preview = await plugin.readCoWatchPreview();
  if (preview?.available !== true || !preview.base64) return null;
  if ((accountScope || companionScope) && !screenCaptureMatchesIdentity(preview, { accountScope, companionScope })) return null;
  const mimeType = SUPPORTED_CAPTURE_TYPES.has(preview.mimeType)
    ? preview.mimeType
    : "image/jpeg";
  decodeBase64(preview.base64);
  return Object.freeze({
    src: `data:${mimeType};base64,${preview.base64}`,
    capturedAt: isoTimestamp(preview.capturedAt),
    width: boundedInteger(preview.width, 1, 4096, 1),
    height: boundedInteger(preview.height, 1, 4096, 1),
  });
}

export function screenCaptureMatchesIdentity(capture, identity) {
  return !!identity?.accountScope && !!identity?.companionScope && capture?.scopeKey === `${identity.accountScope}:${identity.companionScope}`;
}
