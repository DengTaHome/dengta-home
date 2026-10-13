import { apiFetch, apiRequest } from "./api.js";
import { authSession } from "./auth-session.js";

export function createImportRequestClient({ accountScope, companionScope, auth = authSession, client = { apiFetch, apiRequest } }) {
  const current = () => {
    const snapshot = auth.getSnapshot();
    return Boolean(accountScope && companionScope && snapshot?.user?.id === accountScope && snapshot?.activeCompanionId === companionScope);
  };
  const assertCurrent = signal => {
    signal?.throwIfAborted();
    if (!current()) throw Object.assign(new Error("账号或伴侣已切换，请在当前导入面板重新操作。"), { code: "import_scope_changed" });
  };
  const guardedAuth = {
    getSnapshot: () => auth.getSnapshot(),
    async getRequestContext() {
      assertCurrent(); const context = await auth.getRequestContext(); assertCurrent();
      if (context?.companionId !== companionScope) throw Object.assign(new Error("导入请求的伴侣范围未确认。"), { code: "import_scope_changed" });
      return context;
    },
    captureCompanionFromResponse: response => { if (current()) auth.captureCompanionFromResponse?.(response); },
    invalidateSession: (...args) => current() ? auth.invalidateSession?.(...args) : undefined,
  };
  const guarded = method => async (path, options = {}) => {
    assertCurrent(options.signal);
    const result = await client[method](path, { ...options, authSession: guardedAuth });
    assertCurrent(options.signal); return result;
  };
  return { apiFetch: guarded("apiFetch"), apiRequest: guarded("apiRequest") };
}
