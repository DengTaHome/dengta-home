import { Capacitor, registerPlugin } from "@capacitor/core";
import { normalizeNowPlayingCapabilities, nowPlayingActionState } from "./now-playing-capabilities.js";

export const DEVICE_ACTIVITY_WINDOW_MINUTES = 30;
export const DEVICE_ACTIVITY_REFRESH_MS = 5 * 60 * 1000;

export const DeviceActivity = registerPlugin("DeviceActivity");

function boundedInteger(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function safeAppName(value) {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(/\s+/g, " ").trim())
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .slice(0, 40)
    .join("")
    .trim();
}

export function normalizeDeviceActivityState(value) {
  return Object.freeze({
    supported: value?.supported === true,
    enabled: value?.enabled === true,
    permissionGranted: value?.permissionGranted === true,
  });
}

export function normalizeDeviceActivitySummary(value) {
  const capturedTime = Date.parse(value?.capturedAt);
  if (!Number.isFinite(capturedTime)) return null;

  const windowMinutes = boundedInteger(value?.windowMinutes, 5, 120, 0);
  if (!windowMinutes || !Array.isArray(value?.apps)) return null;

  const apps = value.apps
    .slice(0, 6)
    .map((item) => {
      const name = safeAppName(item?.name);
      if (!name) return null;
      const launchCount = boundedInteger(item?.launchCount, 0, 100);
      const hasForegroundSeconds = Number.isFinite(
        Number(item?.foregroundSeconds),
      );
      const foregroundMinutes = hasForegroundSeconds
        ? Math.round(
            boundedInteger(
              item.foregroundSeconds,
              0,
              windowMinutes * 60,
            ) / 60,
          )
        : boundedInteger(item?.foregroundMinutes, 0, windowMinutes);
      return Object.freeze({
        name,
        launchCount,
        foregroundMinutes: Math.min(
          windowMinutes,
          Math.max(0, foregroundMinutes),
        ),
      });
    })
    .filter(Boolean);

  if (apps.length === 0) return null;
  return Object.freeze({
    capturedAt: new Date(capturedTime).toISOString(),
    windowMinutes,
    apps: Object.freeze(apps),
  });
}

export function normalizeCurrentApp(value) {
  const app = value?.currentApp;
  if (!app?.name) return null;
  return Object.freeze({
    name: safeAppName(app.name),
    packageName: safeAppName(app.packageName) || "",
    sinceSeconds: boundedInteger(app.sinceSeconds, 0, 300, 0),
  });
}

export async function readCurrentApp({
  capacitor = Capacitor,
  plugin = DeviceActivity,
} = {}) {
  if (!deviceActivityPluginAvailable(capacitor)) return null;
  try {
    return normalizeCurrentApp(await plugin.getCurrentApp());
  } catch {
    return null;
  }
}


export function normalizeNowPlaying(value) {
  const song = value?.nowPlaying;
  if (!song || !song.title) return null;
  return Object.freeze({
    title: String(song.title || "").slice(0, 120),
    artist: String(song.artist || "").slice(0, 120),
    album: String(song.album || "").slice(0, 120),
    packageName: String(song.packageName || "").slice(0, 80),
    sessionId: String(song.sessionId || "").slice(0, 160),
    isPlaying: song.isPlaying === true && song.playbackStateKnown !== false,
    playbackStateKnown: song.playbackStateKnown !== false,
    ...normalizeNowPlayingCapabilities(song),
    durationSeconds: Number(song.duration) > 0 ? Math.round(Number(song.duration) / 1000) : 0,
    positionSeconds: Number(song.position) > 0 ? Math.round(Number(song.position) / 1000) : 0,
    cover: typeof song.cover === "string" && song.cover.startsWith("data:image") ? song.cover : "",
  });
}

export async function readNowPlaying({
  capacitor = Capacitor,
  plugin = DeviceActivity,
} = {}) {
  if (!deviceActivityPluginAvailable(capacitor)) return null;
  try {
    return normalizeNowPlaying(await plugin.getNowPlaying());
  } catch {
    return null;
  }
}


export async function controlNowPlaying(action, {
  capacitor = Capacitor,
  plugin = DeviceActivity,
  expectedSong,
} = {}) {
  const failure = code => Object.assign(new Error({
    music_control_unavailable: "此设备不支持系统播放器控制，请打开音乐 App 操作。",
    music_control_invalid: "歌曲或操作信息已失效，请刷新歌曲卡片后重试。",
    music_control_permission: "通知使用权未开启或已撤销，请在设置中重新授权。",
    music_control_session_changed: "播放器或歌曲已切换，请等待歌曲卡片更新后重试。",
    music_control_session_missing: "当前歌曲没有可控制的媒体会话，请打开音乐 App 操作。",
    music_control_unsupported: "此播放器不支持该操作，请打开音乐 App 操作。",
    music_control_failed: "系统播放器指令发送失败，请在音乐 App 中重试。",
  }[code]), { code });
  if (!deviceActivityPluginAvailable(capacitor)) throw failure("music_control_unavailable");
  if (!["play", "pause", "next"].includes(action) || !expectedSong?.packageName || !expectedSong?.title) throw failure("music_control_invalid");
  if (!nowPlayingActionState(expectedSong, action).available) throw failure("music_control_unsupported");
  let result;
  try {
    result = await plugin.controlNowPlaying({ action, expectedPackage: expectedSong.packageName, expectedTitle: expectedSong.title, expectedArtist: expectedSong.artist || "", expectedSessionId: expectedSong.sessionId || "" });
  } catch {
    throw failure("music_control_failed");
  }
  if (result?.controlled !== true) throw failure(["music_control_permission", "music_control_session_changed", "music_control_session_missing", "music_control_unsupported", "music_control_invalid"].includes(result?.code) ? result.code : "music_control_failed");
  return { submitted: true };
}


export async function readNotificationAccessState({
  capacitor = Capacitor,
  plugin = DeviceActivity,
  strict = false,
} = {}) {
  if (!deviceActivityPluginAvailable(capacitor)) return { granted: false };
  try {
    const result = await plugin.getNotificationAccessState();
    if (strict && typeof result?.granted !== "boolean") throw new Error("Invalid receipt");
    return { granted: result?.granted === true };
  } catch {
    if (strict) throw Object.assign(new Error("无法读取通知使用权，请返回本页重新检查。"), { code: "music_notification_check_failed" });
    return { granted: false };
  }
}

export async function openNotificationAccessSettings({
  capacitor = Capacitor,
  plugin = DeviceActivity,
} = {}) {
  if (!deviceActivityPluginAvailable(capacitor)) return false;
  try {
    await plugin.openNotificationAccessSettings();
    return true;
  } catch {
    return false;
  }
}

export function mergeCurrentAppContext(environmentContext, currentApp) {
  const source =
    environmentContext &&
    typeof environmentContext === "object" &&
    !Array.isArray(environmentContext)
      ? environmentContext
      : {};
  const next = { ...source };
  delete next.current_app;
  delete next.currentApp;
  return currentApp ? { ...next, currentApp } : next;
}

export function mergeDeviceActivityContext(environmentContext, summary) {
  const source =
    environmentContext &&
    typeof environmentContext === "object" &&
    !Array.isArray(environmentContext)
      ? environmentContext
      : {};
  const next = { ...source };
  delete next.device_activity;
  delete next.deviceActivity;

  const normalized = normalizeDeviceActivitySummary(summary);
  return normalized ? { ...next, deviceActivity: normalized } : next;
}

export function deviceActivityPluginAvailable(capacitor = Capacitor) {
  return (
    capacitor.isNativePlatform() &&
    capacitor.isPluginAvailable("DeviceActivity")
  );
}

export async function readDeviceActivityState({
  capacitor = Capacitor,
  plugin = DeviceActivity,
} = {}) {
  if (!deviceActivityPluginAvailable(capacitor)) {
    return normalizeDeviceActivityState({});
  }
  return normalizeDeviceActivityState(await plugin.getState());
}
