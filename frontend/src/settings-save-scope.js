export function settingsSaveScope(snapshot = {}) {
  return JSON.stringify([snapshot.user?.id || "", snapshot.activeCompanionId || ""]);
}

export function createScopedSettingsSession(manager, scope, signal) {
  const [accountId, companionId] = JSON.parse(scope);
  const isCurrent = () => !signal?.aborted && settingsSaveScope(manager.getSnapshot()) === scope;
  function assertCurrent(context) {
    if (isCurrent() && (!context || (context.companionId || "") === companionId)) return;
    const error = new Error("账号或伴侣已切换，本次设置保存已取消。请在原来的空间核对设置。");
    error.code = "settings_scope_changed";
    throw error;
  }
  return {
    getSnapshot() {
      return { user: { id: accountId }, activeCompanionId: companionId };
    },
    async getRequestContext() {
      assertCurrent();
      const context = await manager.getRequestContext();
      assertCurrent(context);
      return context;
    },
    captureCompanionFromResponse(response) {
      if (isCurrent()) manager.captureCompanionFromResponse?.(response);
    },
    invalidateSession(message) {
      if (isCurrent()) return manager.invalidateSession?.(message);
    },
  };
}

const guards = new Map();
export function registerSettingsSaveGuard(scope, flush, setExiting) {
  const entry = { flush, setExiting };
  guards.set(scope, entry);
  return () => { if (guards.get(scope) === entry) guards.delete(scope); };
}

export async function flushSettingsBeforeAccountExit(scope) {
  const entry = guards.get(scope);
  if (!entry) return true;
  entry.setExiting?.(true);
  const saved = await entry.flush();
  return saved === true && guards.get(scope) === entry;
}

export function releaseSettingsAccountExit(scope) {
  guards.get(scope)?.setExiting?.(false);
}
