import { musicErrorMessage } from "./music-operation-feedback.js";

export function sameNowPlaying(a, b) {
  return !!a && !!b && a.packageName === b.packageName && a.title === b.title && a.artist === b.artist;
}

export async function runNowPlayingControl({ scope, song, action, control, read, onBusy, onSong, onFeedback }) {
  if (!song || !["play", "pause", "next"].includes(action)) return;
  const token = scope.begin("now-playing-control");
  if (!token) return;
  try {
    onBusy(true);
    scope.assertCurrent(token);
    await control(action, { expectedSong: song });
    scope.assertCurrent(token);
    const observed = await read();
    scope.assertCurrent(token);
    if (observed) onSong(observed);
    const confirmed = observed?.playbackStateKnown !== false && (action === "next"
      ? observed && observed.packageName === song.packageName && !sameNowPlaying(song, observed)
      : sameNowPlaying(song, observed) && observed.isPlaying === (action === "play"));
    onFeedback(confirmed
      ? action === "next" ? "已读取到切歌后的播放器状态。" : action === "play" ? "播放器已确认播放。" : "播放器已确认暂停。"
      : "指令已提交，等待播放器更新；若没有变化，请在音乐 App 中操作。");
  } catch (error) {
    if (scope.current(token)) onFeedback(musicErrorMessage(error, "播放器操作失败，请在音乐 App 中重试。"));
  } finally {
    scope.finish(token);
    if (scope.current(token)) onBusy(false);
  }
}
