import { Capacitor, registerPlugin } from "@capacitor/core";

const NeteasePlayback = registerPlugin("NeteasePlayback");
const RESOURCE_TYPES = new Set(["song", "playlist"]);
const RESOURCE_ID = /^\d{1,20}$/;

function openWebResource(url) {
  const popup = window.open("", "_blank");
  if (!popup) throw Object.assign(new Error("浏览器阻止了打开网易云，请允许弹出窗口后重试。"), { code: "music_popup_blocked" });
  try { popup.opener = null; popup.location.href = url; }
  catch { popup.close(); throw Object.assign(new Error("浏览器无法打开网易云链接，请重试。"), { code: "music_web_open_failed" }); }
  return { opened: true, target: "web" };
}

export function validateNeteaseResource(resourceType, resourceId) {
  const type = String(resourceType || "");
  const id = String(resourceId || "");
  if (!RESOURCE_TYPES.has(type) || !RESOURCE_ID.test(id)) throw new Error("网易云资源标识无效，无法打开。");
  return Object.freeze({ resourceType: type, resourceId: id });
}

export async function openNeteasePlayback(resourceType, resourceId) {
  const resource = validateNeteaseResource(resourceType, resourceId);
  if (Capacitor.isNativePlatform()) return NeteasePlayback.open(resource);
  const path = resource.resourceType === "song" ? "song" : "playlist";
  const url = `https://music.163.com/#/${path}?id=${resource.resourceId}`;
  return openWebResource(url);
}

// AI 放歌：无确认弹窗，静默调起网易云播放（仅单曲）。
export async function playNeteaseSilent(resourceType, resourceId) {
  const resource = validateNeteaseResource(resourceType, resourceId);
  if (resource.resourceType !== "song") {
    throw new Error("AI 放歌只支持单曲。");
  }
  if (Capacitor.isNativePlatform()) return NeteasePlayback.playSilent(resource);
  const url = `https://music.163.com/#/song?id=${resource.resourceId}`;
  return openWebResource(url);
}
