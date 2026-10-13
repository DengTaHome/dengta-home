export function coWatchRequestOptions(options = {}, authSession) {
  const { accountScope, companionScope, signal } = options;
  if (!accountScope || !companionScope) return { signal };
  const matches = () => {
    const snapshot = authSession.getSnapshot();
    return snapshot?.user?.id === accountScope && snapshot?.activeCompanionId === companionScope;
  };
  const assertScope = () => {
    signal?.throwIfAborted();
    if (!matches()) throw Object.assign(new Error("账号或伴侣已切换，请在当前页面重试。"), { code: "co_watch_scope_changed" });
  };
  return {
    signal,
    authSession: {
      getSnapshot: () => authSession.getSnapshot(),
      async getRequestContext() {
        assertScope();
        const context = await authSession.getRequestContext();
        assertScope();
        if (context?.companionId !== companionScope) throw Object.assign(new Error("共看请求的伴侣范围不一致，请刷新后重试。"), { code: "co_watch_scope_changed" });
        return context;
      },
      captureCompanionFromResponse: response => { if (matches()) authSession.captureCompanionFromResponse?.(response); },
      invalidateSession: message => { if (matches()) return authSession.invalidateSession?.(message); },
    },
  };
}
