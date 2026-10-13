export function captureMusicScope(options = {}, auth) {
  const snapshot = auth.getSnapshot();
  return {
    ...options,
    accountScope: options.accountScope || snapshot?.user?.id || "",
    companionScope: options.companionScope || snapshot?.activeCompanionId || "",
  };
}

export function assertMusicScope(scope, auth) {
  scope.signal?.throwIfAborted();
  const snapshot = auth.getSnapshot();
  if ((scope.accountScope && scope.accountScope !== snapshot?.user?.id) || (scope.companionScope && scope.companionScope !== snapshot?.activeCompanionId)) {
    throw Object.assign(new Error("账号或伴侣已切换，旧音乐操作已取消。请在当前页面重试。"), { code: "music_scope_changed" });
  }
}

export function createMusicRequestScope(auth) {
  let scope = {}, generation = 0, controller = new AbortController(), alive = false;
  const jobs = new Map();
  const capture = () => ({ generation, options: { ...scope, signal: controller.signal } });
  const current = token => {
    if (!token || token.cancelled || !alive || token.generation !== generation || token.options.signal.aborted) return false;
    try { assertMusicScope(token.options, auth); return true; } catch { return false; }
  };
  function invalidate() { generation++; alive = false; controller.abort(); jobs.clear(); }
  return {
    bind(options) { invalidate(); scope = captureMusicScope(options, auth); controller = new AbortController(); alive = true; },
    capture, current, invalidate,
    assertCurrent(token) {
      if (!current(token)) throw Object.assign(new Error("页面或账号已切换，旧音乐操作已取消。"), { code: "music_scope_changed" });
    },
    begin(key, { replace = false } = {}) {
      const old = jobs.get(key);
      if (old && !replace) return null;
      if (old) { old.cancelled = true; old.controller.abort(); }
      const token = { ...capture(), key, controller: new AbortController() };
      if (typeof AbortSignal.any === "function") token.options.signal = AbortSignal.any([controller.signal, token.controller.signal]);
      if (!current(token)) return null;
      jobs.set(key, token); return token;
    },
    finish(token) { if (token && jobs.get(token.key) === token) jobs.delete(token.key); },
    busy(key) { return current(jobs.get(key)); },
    cancel(token) { if (token) { token.cancelled = true; token.controller?.abort(); if (jobs.get(token.key) === token) jobs.delete(token.key); } },
    cancelKey(key) { this.cancel(jobs.get(key)); },
  };
}
