export function createMusicPlaybackSync({ getIdentity, getSession, capture, current, patchPlayback, readSession, onApplied, onError }) {
  let run = null, pending = null;
  const accepted = token => run === token && current(token.stamp) && getSession()?.id === token.sessionId && getSession()?.status === "active" && !token.controller.signal.aborted;
  const valid = (value, id) => value?.id === id && value.status === "active" && value.sessionMode === "listening";
  function invalidate() {
    const old = run; run = null; pending = null; old?.controller.abort();
  }
  function submit(snapshot = {}) {
    const active = getSession(), identity = getIdentity();
    if (!valid(active, snapshot.sessionId) || (snapshot.accountScope && snapshot.accountScope !== identity.accountScope) || (snapshot.companionScope && snapshot.companionScope !== identity.companionScope)) return Promise.resolve(false);
    if (run && !accepted(run)) invalidate();
    pending = { ...snapshot, conflictRetried: false };
    if (run) return run.promise;
    const token = { sessionId: active.id, stamp: capture(), controller: new AbortController(), revision: active.revision || 0 };
    const options = { ...identity, signal: token.controller.signal };
    run = token;
    token.promise = (async () => {
      let applied = false;
      try {
        while (pending && accepted(token)) {
          const next = pending; pending = null;
          token.revision = Math.max(token.revision, getSession()?.revision || 0, next.revision || 0);
          try {
            const result = await patchPlayback(token.sessionId, { ...next, revision: token.revision }, options);
            if (!accepted(token)) return false;
            if (!valid(result, token.sessionId)) throw Object.assign(new Error("服务器未确认本场听歌的播放状态，播放器仍可在本机使用。"), { code: "music_playback_receipt_invalid" });
            token.revision = result.revision; onApplied(result); applied = true;
          } catch (error) {
            if (!accepted(token)) return false;
            if (error?.status === 409 && error.code === "co_watch_playback_revision_conflict" && !next.conflictRetried) {
              const refreshed = await readSession({ sessionMode: "listening" }, options);
              if (!accepted(token)) return false;
              if (!valid(refreshed, token.sessionId)) throw Object.assign(new Error("一起听会话已结束或切换，旧播放状态未再提交。"), { code: "co_watch_session_changed", cause: error });
              token.revision = refreshed.revision; onApplied(refreshed);
              pending ||= { ...next, conflictRetried: true };
            } else onError(error);
          }
        }
        return applied;
      } catch (error) {
        if (accepted(token)) onError(error);
        return false;
      } finally {
        if (run === token) { run = null; pending = null; }
      }
    })();
    return token.promise;
  }
  return { submit, invalidate };
}
