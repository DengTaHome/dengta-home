import { normalizeScreenGlanceConfig } from "./screen-glance.js";

export function createScreenGlanceLifecycle({ getIdentity, getSession, getConfig, isBusy, plugin, preparePermission, createSession, endSession, onBusy, onState, onStarted, onEnded, onStopped, idFactory = () => crypto.randomUUID() }) {
  let pending = null, revision = 0, retryId = null;
  const scope = () => JSON.stringify(getIdentity());
  const capture = () => ({ scope: scope(), revision });
  const current = stamp => stamp.scope === scope() && stamp.revision === revision;
  const failure = (code, message) => ({ ok: false, code, message });
  const changed = () => failure("screen_glance_scope_changed", "账号或伴侣已切换，旧共享操作未应用。");
  const inScope = input => (!input.accountScope || input.accountScope === getIdentity().accountScope) && (!input.companionScope || input.companionScope === getIdentity().companionScope);
  function begin() {
    if (pending || isBusy()) return null;
    const identity = getIdentity();
    if (!identity.accountScope || !identity.companionScope) return null;
    const token = { ...capture(), revision: ++revision, identity, controller: new AbortController() };
    pending = token; onBusy(true); return token;
  }
  const accepted = token => pending === token && current(token);
  const requestOptions = token => ({ ...token.identity, signal: token.controller.signal });
  function finish(token) {
    if (pending !== token) return;
    pending = null; onBusy(false);
  }
  const stoppedConfig = config => normalizeScreenGlanceConfig({ ...config, watchTogetherEnabled: false, coWatchSessionId: "" });
  return {
    capture, current,
    invalidate() {
      revision++; retryId = null;
      const old = pending; pending = null; old?.controller.abort();
      if (old) { onBusy(false); void plugin.stopSession({ scopeKey: `${old.identity.accountScope}:${old.identity.companionScope}` }).catch(() => {}); }
    },
    async start(input = {}) {
      if (!inScope(input)) return changed();
      const token = begin();
      if (!token) return failure("screen_glance_operation_busy", "另一项共看操作正在进行，请稍候。");
      const active = getSession()?.status === "active" ? getSession() : null;
      const watchTogether = input.watchTogether === true;
      let created = null, ownsProjection = false;
      try {
        if (watchTogether && active && active.sessionMode !== "screen") return failure("co_watch_active_conflict", "已有听歌或视频会话，请先结束后再开始屏幕共看。");
        const before = await plugin.getState();
        if (!accepted(token)) return changed();
        const permission = await preparePermission();
        if (!accepted(token)) return changed();
        if (permission.status === "error") return failure("screen_glance_notification_permission", permission.message);
        // Ask for projection consent before creating any server session.
        const consent = await plugin.startSession({ scopeKey: `${token.identity.accountScope}:${token.identity.companionScope}` });
        if (!accepted(token)) return changed();
        if (consent?.consentDenied || consent?.consentCancelled) {
          onState(consent); return { ok: true, cancelled: true, state: consent };
        }
        ownsProjection = before?.active !== true;
        let session = watchTogether ? active : null;
        if (watchTogether && !session) {
          retryId ||= idFactory();
          session = await createSession({ ...input, sessionMode: "screen", sessionId: retryId }, requestOptions(token));
          if (!accepted(token)) return changed();
          if (!session?.id || session.id !== retryId || session.status !== "active" || session.sessionMode !== "screen") throw Object.assign(new Error("服务器未返回有效的屏幕共看回执，请刷新后重试。"), { code: "co_watch_receipt_invalid" });
          created = session;
          if ((getSession()?.id || "") !== (active?.id || "")) throw Object.assign(new Error("共看会话已改变，请刷新后重试。"), { code: "co_watch_session_changed" });
          onStarted(session); retryId = null;
        }
        const config = normalizeScreenGlanceConfig({ ...getConfig(), watchTogetherEnabled: watchTogether, watchIntervalSeconds: input.cadenceSeconds || getConfig().watchIntervalSeconds, coWatchSessionId: watchTogether ? session?.id || "" : "" });
        if (session && getSession()?.id !== session.id) throw Object.assign(new Error("共看会话已改变，请刷新后重试。"), { code: "co_watch_session_changed" });
        const state = await plugin.configure({ ...config, scopeKey: `${token.identity.accountScope}:${token.identity.companionScope}` });
        if (!accepted(token)) return changed();
        onState(state); return { ok: true, state, session, starting: consent?.starting === true };
      } catch (error) {
        if (!accepted(token)) return changed();
        let cleanupFailed = false;
        if (ownsProjection) {
          await plugin.stopSession({ scopeKey: `${token.identity.accountScope}:${token.identity.companionScope}` }).catch(() => { cleanupFailed = true; });
          if (!accepted(token)) return changed();
        }
        if (created) {
          try {
            const ended = await endSession(created.id, input, requestOptions(token));
            if (!accepted(token)) return changed();
            if (ended?.id !== created.id || ended.status !== "ended") throw new Error("服务器未确认结束。", { cause: error });
            if (getSession()?.id === created.id) onEnded(ended);
          } catch {
            if (!accepted(token)) return changed();
            return failure("screen_glance_rollback_failed", "共享启动失败，服务器会话尚未确认结束。请点击结束并清除重试；会话记录仍保留。");
          }
        }
        if (cleanupFailed) return failure("screen_glance_cleanup_failed", "启动失败且系统未确认停止共享，请用 Android 常驻通知结束共享，或点击结束并清除重试。");
        return failure(error?.code || "screen_glance_start_failed", error?.message || "无法开始屏幕共看，请重试。");
      } finally { finish(token); }
    },
    async stop(input = {}) {
      if (!inScope(input)) return changed();
      if (input.sessionId && input.sessionId !== getSession()?.id) return failure("co_watch_session_changed", "共看会话已改变，请在当前页面重试。");
      const token = begin();
      if (!token) return failure("screen_glance_operation_busy", "另一项共看操作正在进行，请稍候。");
      const active = getSession()?.status === "active" && getSession().sessionMode === "screen" ? getSession() : null;
      try {
        await plugin.stopSession({ scopeKey: `${token.identity.accountScope}:${token.identity.companionScope}` });
        if (!accepted(token)) return changed();
        const state = await plugin.configure({ ...stoppedConfig(getConfig()), scopeKey: `${token.identity.accountScope}:${token.identity.companionScope}` });
        if (!accepted(token)) return changed();
        onState(state); onStopped();
        if (active) {
          const ended = await endSession(active.id, input, requestOptions(token));
          if (!accepted(token)) return changed();
          if (getSession()?.id !== active.id) return failure("co_watch_session_changed", "共看会话已改变，旧结束结果未应用。");
          if (ended?.id !== active.id || ended.status !== "ended") return failure("co_watch_receipt_invalid", "屏幕共享已停止，服务器尚未确认结束，请重试。");
          onEnded(ended);
        }
        retryId = null; return { ok: true, state };
      } catch (error) {
        return accepted(token) ? failure(error?.code || "screen_glance_stop_failed", error?.message || "暂时无法结束屏幕共看，请重试；会话记录仍保留。") : changed();
      } finally { finish(token); }
    },
  };
}
