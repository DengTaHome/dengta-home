function signature(input) {
  return JSON.stringify([input.sessionMode, input.mediaUrl, input.sourceApp, input.musicPlaylistId, input.musicPlaylistItemId]);
}

export function createCoWatchLifecycle({ getIdentity, getSession, isBusy, createSession, endSession, onBusy, onStarted, onEnded, idFactory = () => crypto.randomUUID() }) {
  let pending = null, revision = 0, retry = null, lastStart = null;
  const scope = () => JSON.stringify(getIdentity());
  const capture = () => ({ scope: scope(), revision, sessionId: getSession()?.id || "" });
  const current = stamp => stamp.scope === scope() && stamp.revision === revision;
  const failure = (code, message) => ({ ok: false, code, message });
  function begin() {
    if (pending || isBusy()) return null;
    const identity = getIdentity();
    if (!identity.accountScope || !identity.companionScope) return null;
    const token = { ...capture(), revision: ++revision, identity, controller: new AbortController() };
    pending = token; onBusy(true); return token;
  }
  function finish(token) {
    if (pending !== token) return;
    pending = null;
    onBusy(false);
  }
  const accepted = token => pending === token && current(token) && !token.controller.signal.aborted;
  const inputInScope = input => (!input.accountScope || input.accountScope === getIdentity().accountScope) && (!input.companionScope || input.companionScope === getIdentity().companionScope);
  const requestOptions = token => ({ ...token.identity, signal: token.controller.signal });
  return {
    capture, current,
    invalidate() {
      revision++; retry = null; lastStart = null;
      const old = pending; pending = null; old?.controller.abort();
      if (old) onBusy(false);
    },
    async start(input) {
      if (!inputInScope(input)) return failure("co_watch_scope_changed", "账号或伴侣已切换，请在当前页面重试。");
      const token = begin();
      if (!token) return failure("co_watch_operation_busy", "另一项共看操作正在进行，请稍候。");
      const key = signature(input);
      try {
        const active = getSession();
        if (active?.status === "active") {
          if (input.reuseActiveMode === true && active.sessionMode === input.sessionMode) {
            onStarted(active); return { ok: true, session: active };
          }
          if (retry?.scope === token.scope && retry.key === key && retry.id === active.id) {
            lastStart = { scope: token.scope, key, sessionId: active.id }; retry = null;
            onStarted(active); return { ok: true, session: active };
          }
          if (lastStart?.scope === token.scope && lastStart.key === key && lastStart.sessionId === active.id) return { ok: true, session: active };
          return failure("co_watch_active_conflict", "已有一场共看，请先结束后再开始新的视频。");
        }
        if (!retry || retry.scope !== token.scope || retry.key !== key) retry = { scope: token.scope, key, id: idFactory() };
        const result = await createSession({ ...input, sessionId: retry.id }, requestOptions(token));
        if (!accepted(token)) return failure("co_watch_scope_changed", "账号或伴侣已切换，旧操作结果未应用。");
        if (!result?.id || result.status !== "active" || result.sessionMode !== input.sessionMode) return failure("co_watch_receipt_invalid", "服务器没有返回有效的共看会话，请重试。");
        if (result.id !== retry.id) return failure("co_watch_active_conflict", "另一设备建立了不同的共看会话，请刷新后确认。");
        if (getSession()?.id && getSession().id !== result.id) return failure("co_watch_session_changed", "共看会话已改变，请刷新后重试。");
        lastStart = { scope: token.scope, key, sessionId: result.id }; retry = null;
        onStarted(result); return { ok: true, session: result };
      } catch (error) {
        return accepted(token) ? failure(error?.code || "co_watch_start_failed", error?.message || "暂时无法开始共看，请重试。") : failure("co_watch_scope_changed", "账号或伴侣已切换，旧操作结果未应用。");
      } finally { finish(token); }
    },
    async stop(input = {}) {
      if (!inputInScope(input)) return failure("co_watch_scope_changed", "账号或伴侣已切换，请在当前页面重试。");
      if (input.sessionId && input.sessionId !== getSession()?.id) return failure("co_watch_session_changed", "共看会话已改变，请在当前页面重试。");
      if (getSession()?.id && input.sessionMode && getSession().sessionMode !== input.sessionMode) return failure("co_watch_active_conflict", "当前会话类型已改变，请从对应的播放页面结束。");
      const token = begin();
      if (!token) return failure("co_watch_operation_busy", "另一项共看操作正在进行，请稍候。");
      const active = getSession();
      try {
        const ended = active?.id ? await endSession(active.id, input, requestOptions(token)) : null;
        if (!accepted(token)) return failure("co_watch_scope_changed", "账号或伴侣已切换，旧操作结果未应用。");
        if ((getSession()?.id || "") !== (active?.id || "")) return failure("co_watch_session_changed", "共看会话已改变，旧结束结果未应用。");
        if (active?.id && (ended?.id !== active.id || ended?.status !== "ended")) return failure("co_watch_receipt_invalid", "服务器未确认结束，请重试，当前播放记录仍保留。");
        retry = null; lastStart = null; onEnded(ended); return { ok: true, session: ended };
      } catch (error) {
        return accepted(token) ? failure(error?.code || "co_watch_stop_failed", error?.message || "暂时无法结束共看，请重试。") : failure("co_watch_scope_changed", "账号或伴侣已切换，旧操作结果未应用。");
      } finally { finish(token); }
    },
  };
}
