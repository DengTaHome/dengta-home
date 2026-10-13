const normalized = value => String(value || "").trim().toLowerCase();
export function createNowPlayingSync({ getIdentity, getSession, capture, current, readPlaylist, submit, onUnmatched }) {
  let run = null;
  function invalidate() { const old = run; run = null; old?.controller.abort(); }
  async function sync(song) {
    const active = getSession();
    if (!song?.title || active?.status !== "active" || active.sessionMode !== "listening" || !active.musicPlaylistId) return false;
    const key = JSON.stringify([active.id, song.title, song.artist]);
    if (run?.key === key) return run.promise;
    invalidate();
    const token = { key, stamp: capture(), sessionId: active.id, controller: new AbortController() }; run = token;
    const options = { ...getIdentity(), signal: token.controller.signal };
    const accepted = () => run === token && current(token.stamp) && getSession()?.id === token.sessionId && getSession()?.status === "active" && getSession()?.sessionMode === "listening" && getSession()?.musicPlaylistId === active.musicPlaylistId && !token.controller.signal.aborted;
    token.promise = (async () => {
      try {
        const playlist = await readPlaylist(active.musicPlaylistId, options);
        if (!accepted()) return false;
        if (playlist?.id !== active.musicPlaylistId) return false;
        const matches = (playlist?.items || []).filter(item => normalized(item.title) === normalized(song.title) && (!song.artist || normalized(item.artist) === normalized(song.artist)));
        if (matches.length !== 1) { onUnmatched(); return false; }
        return await submit({ ...options, sessionId: active.id, playbackState: "playing", mediaPositionSeconds: song.positionSeconds || 0, mediaDurationSeconds: song.durationSeconds || matches[0].durationSeconds || 0, musicPlaylistId: playlist.id, musicPlaylistItemId: matches[0].id, revision: getSession()?.revision || 0 });
      } catch { return false; }
      finally { if (run === token) run = null; }
    })();
    return token.promise;
  }
  return { sync, invalidate };
}
