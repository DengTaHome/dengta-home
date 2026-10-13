function error(status, code, message) { return Object.assign(new Error(message), { status, code }); }

function playlistSaveState(playlist, savedCount) {
    const expected = Number(playlist?.item_count);
    if (!Number.isInteger(expected) || expected < 0 || expected > 500 || !Number.isInteger(savedCount) || savedCount < 0 || savedCount > 500) {
        throw error(502, "music_playlist_receipt_invalid", "无法核对歌单保存数量，请刷新重试。");
    }
    const metadataOnly = playlist.provider === "netease" && expected === 0 && savedCount === 0 && Boolean(playlist.external_url || playlist.provider_playlist_id);
    return { saved_item_count: savedCount, save_state: metadataOnly ? "external_metadata" : expected > 0 && savedCount === expected ? "ready" : "incomplete" };
}

function requireCompletePlaylist(playlist, items) {
    const state = playlistSaveState(playlist, Array.isArray(items) ? items.length : -1);
    if (state.save_state === "incomplete") throw error(409, "music_playlist_incomplete", `歌单尚未保存完整（已保存 ${state.saved_item_count}/${playlist.item_count} 首）。请回到导入面板继续保存；面板已关闭时请重新导入原文件。`);
    if (state.save_state === "ready" && items.some((item, index) => item.position !== index)) {
        throw error(409, "music_playlist_positions_invalid", "歌单曲目位置不完整，请刷新核对或重新导入原文件。");
    }
    return state;
}

module.exports = { playlistSaveState, requireCompletePlaylist };
