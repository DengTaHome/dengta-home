import { accountStorageKey } from "./account-storage.js";

export const MAX_MUSIC_MOMENTS = 200;
export const MAX_MUSIC_MOMENT_NOTE = 240;
const BASE_KEY = "dengta_music_moments_v1";
const MAX_STORED_LENGTH = 400_000;
const FIELDS = ["id", "playlistId", "itemId", "title", "artist", "positionSeconds", "positionSource", "note", "createdAt"];
const MESSAGES = Object.freeze({
  music_moment_scope_missing: "请先选择当前账号和伴侣，再使用片段卡。",
  music_moment_storage_unavailable: "本机存储不可用，片段卡未保存。请检查浏览器存储空间后重试；备注仍保留。",
  music_moment_storage_invalid: "本机片段卡格式异常，暂未改写原资料。请重试读取。",
  music_moment_limit: "已保存200张片段卡，请删除不需要的卡片后再保存。",
  music_moment_invalid: "片段资料不完整或时间无效，请重新标记当前曲目。",
  music_moment_player_unready: "这首歌的播放位置尚未就绪。请等待音频载入，或选回对应曲目。",
  music_moment_scope_changed: "账号、伴侣或页面已切换，旧片段操作已取消。",
});
export function musicMomentError(code) {
  return Object.assign(new Error(MESSAGES[code] || MESSAGES.music_moment_invalid), { code });
}
export function musicMomentFeedback(error) {
  const code = Object.hasOwn(MESSAGES, error?.code) ? error.code : "music_moment_invalid";
  return `${MESSAGES[code]}（错误代码：${code}）`;
}
const stringWithin = (value, max, required = false) => typeof value === "string" && Array.from(value).length <= max && (!required || value.trim().length > 0);
function scopeKey(scope) {
  if (!stringWithin(scope?.accountScope, 120, true) || !stringWithin(scope?.companionScope, 120, true)) throw musicMomentError("music_moment_scope_missing");
  return accountStorageKey(BASE_KEY, JSON.stringify([scope.accountScope, scope.companionScope]));
}
function normalizeMoment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !stringWithin(value.id, 120, true) || !stringWithin(value.playlistId, 100, true) || !stringWithin(value.itemId, 100, true) ||
    /^local-\d+$/.test(value.itemId) || !stringWithin(value.title, 180, true) || !stringWithin(value.artist, 180) ||
    !stringWithin(value.note, MAX_MUSIC_MOMENT_NOTE) || !Number.isFinite(value.positionSeconds) || value.positionSeconds < 0 || value.positionSeconds > 86_400 ||
    !["device", "manual"].includes(value.positionSource) || !stringWithin(value.createdAt, 40, true) || !Number.isFinite(Date.parse(value.createdAt))) {
    throw musicMomentError("music_moment_invalid");
  }
  return Object.freeze(Object.fromEntries(FIELDS.map(key => [key, value[key]])));
}
export function createMusicMoment(capture, note = "", { id = globalThis.crypto?.randomUUID?.(), createdAt = new Date().toISOString() } = {}) {
  return normalizeMoment({ ...capture, note, id: id || `moment-${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt });
}
export function parseMusicMomentTime(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (/^\d{1,5}(?:\.\d{1,2})?$/.test(text)) return Number(text) <= 86_400 ? Number(text) : null;
  const match = /^(\d{1,4}):([0-5]\d)$/.exec(text);
  const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  return Number.isFinite(seconds) && seconds <= 86_400 ? seconds : null;
}
export function createMusicMomentsStore(scope, suppliedStorage) {
  const key = scopeKey(scope);
  const getStorage = () => {
    try {
      const storage = suppliedStorage || globalThis.localStorage || globalThis.window?.localStorage;
      if (!storage?.getItem || !storage?.setItem) throw new Error();
      return storage;
    } catch { throw musicMomentError("music_moment_storage_unavailable"); }
  };
  const read = () => {
    let stored;
    try { stored = getStorage().getItem(key); }
    catch { throw musicMomentError("music_moment_storage_unavailable"); }
    if (stored === null || stored === undefined) return [];
    try {
      if (typeof stored !== "string" || stored.length > MAX_STORED_LENGTH) throw new Error();
      const data = JSON.parse(stored);
      if (data.version !== 1 || data.accountScope !== scope.accountScope || data.companionScope !== scope.companionScope || !Array.isArray(data.moments) || data.moments.length > MAX_MUSIC_MOMENTS) throw new Error();
      const moments = data.moments.map(normalizeMoment);
      if (new Set(moments.map(moment => moment.id)).size !== moments.length) throw new Error();
      return moments;
    } catch { throw musicMomentError("music_moment_storage_invalid"); }
  };
  const write = moments => {
    if (moments.length > MAX_MUSIC_MOMENTS) throw musicMomentError("music_moment_limit");
    const stored = JSON.stringify({ version: 1, accountScope: scope.accountScope, companionScope: scope.companionScope, moments });
    if (stored.length > MAX_STORED_LENGTH) throw musicMomentError("music_moment_limit");
    try { getStorage().setItem(key, stored); }
    catch { throw musicMomentError("music_moment_storage_unavailable"); }
    return moments;
  };
  return Object.freeze({
    read,
    add(value) {
      const moment = normalizeMoment(value), moments = read();
      if (moments.some(entry => entry.id === moment.id)) return moments;
      return write([moment, ...moments]);
    },
    remove(id) { return write(read().filter(moment => moment.id !== id)); },
  });
}
