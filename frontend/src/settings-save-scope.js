import { captureAccountRuntimeEpoch, isAccountRuntimeCurrent } from "./account-cleanup.js";

export function settingsSaveScope(snapshot = {}) {
  return JSON.stringify([snapshot.user?.id || "", snapshot.activeCompanionId || ""]);
}

export function createScopedSettingsSession(manager, scope, signal) {
  const [accountId, companionId] = JSON.parse(scope);
  const captured = captureAccountRuntimeEpoch(accountId);
  const revision = manager.getRequestScope?.().revision ?? null;
  const isCurrent = () => !signal?.aborted && isAccountRuntimeCurrent(captured) &&
    settingsSaveScope(manager.getSnapshot()) === scope &&
    (revision === null || manager.getRequestScope?.().revision === revision);
  function assertCurrent(context) {
    if (isCurrent() && (!context || ((context.companionId || "") === companionId &&
      (context.accountId === undefined || context.accountId === accountId) &&
      (revision === null || context.scopeRevision === undefined || context.scopeRevision === revision)))) return;
    const error = new Error("账号或伴侣已切换，本次设置保存已取消。请在原来的空间核对设置。");
    error.code = "settings_scope_changed";
    error.name = "AbortError";
    throw error;
  }
  return {
    getSnapshot() {
      return { user: { id: accountId }, activeCompanionId: companionId };
    },
    getRequestScope() {
      assertCurrent();
      return Object.freeze({ accountId, companionId, revision });
    },
    async getRequestContext() {
      assertCurrent();
      const context = await manager.getRequestContext();
      assertCurrent(context);
      return context;
    },
    captureCompanionFromResponse(response, expectedScope) {
      if (isCurrent()) return manager.captureCompanionFromResponse?.(response, expectedScope);
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
