const ACTIONS = Object.freeze(["play", "pause", "next"]);
const LABELS = Object.freeze({ play: "播放", pause: "暂停", next: "下一首" });

export function normalizeNowPlayingCapabilities(value) {
  const known = value?.controlCapabilitiesKnown !== false && typeof value?.canControl === "boolean" && Array.isArray(value?.availableActions);
  const availableActions = known && value.canControl === true
    ? ACTIONS.filter(action => value.availableActions.includes(action)) : [];
  return Object.freeze({
    controlCapabilitiesKnown: known,
    canControl: availableActions.length > 0,
    availableActions: Object.freeze(availableActions),
  });
}

export function nowPlayingActionState(song, action) {
  if (song?.source === "dengta") return { available: !!song.playbackId && ACTIONS.includes(action), reason: song.playbackId ? "" : "歌曲播放已结束，请重新选歌。" };
  const capabilities = normalizeNowPlayingCapabilities(song);
  if (!song?.packageName) return { available: false, reason: "当前歌曲没有可控制的播放器，请在音乐 App 中操作。" };
  if (!capabilities.controlCapabilitiesKnown) return { available: false, reason: "控制能力待确认，请在音乐 App 中操作。" };
  if (!capabilities.canControl) return { available: false, reason: "当前歌曲仅供识别，请在音乐 App 中操作。" };
  const available = capabilities.availableActions.includes(action);
  return { available, reason: available ? "" : `当前播放器未提供${LABELS[action] || "此操作"}，请在音乐 App 中操作。` };
}
