export function musicPlaylistStatus(playlist) {
  if (playlist?.saveState === "incomplete") return `保存未完成 · ${playlist.savedItemCount ?? "?"}/${playlist.itemCount} 首`;
  if (playlist?.saveState === "external_metadata") return "外部音乐链接";
  return `${playlist?.itemCount || 0} 首${playlist?.saveState === "ready" ? "" : " · 选择后核对"}`;
}

export function requireMusicPlaylistReceipt(playlist) {
  if (playlist.saveState === "incomplete" || (playlist.itemCount > 0 && playlist.items.length !== playlist.itemCount)) {
    throw Object.assign(new Error("歌单尚未保存完整，请回到导入面板继续保存；面板已关闭时请重新导入原文件。"), { code: "music_playlist_incomplete", status: 409 });
  }
  return playlist;
}
