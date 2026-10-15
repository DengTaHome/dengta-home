import { apiRequest } from "./api.js";
import { authSession } from "./auth-session.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";

export function createOmbreMemoryReads(scopeKey) {
  const operations = new Map();
  let mounted = false;
  const current = operation => {
    const snapshot = authSession.getSnapshot();
    return Boolean(mounted && operation && operations.get(operation.lane) === operation && snapshot.user?.id && snapshot.activeCompanionId && settingsSaveScope(snapshot) === scopeKey);
  };
  function cancel(lane) {
    const operation = operations.get(lane);
    operations.delete(lane);
    operation?.controller.abort();
  }
  return {
    current,
    cancel,
    mount() {
      mounted = true;
      return () => { mounted = false; for (const lane of operations.keys()) cancel(lane); };
    },
    start(lane) {
      cancel(lane);
      const operation = { lane, controller: new AbortController(), timedOut: false };
      operations.set(lane, operation);
      return operation;
    },
    async request(operation, path) {
      const signal = operation.controller.signal;
      const failure = () => Object.assign(new Error("记忆读取未完成。"), { code: operation.timedOut ? "request_timeout" : "settings_scope_changed" });
      if (!current(operation) || signal.aborted) throw failure();
      let onAbort;
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(failure());
        signal.addEventListener("abort", onAbort, { once: true });
      });
      // The same signal protects auth preparation, late 401s, and a stalled JSON body.
      const timer = window.setTimeout(() => { operation.timedOut = true; operation.controller.abort(); }, 15_000);
      try {
        const data = await Promise.race([
          apiRequest(path, { signal, timeoutMs: 0, retry: false, authSession: createScopedSettingsSession(authSession, scopeKey, signal) }),
          aborted,
        ]);
        if (!current(operation)) throw failure();
        return data;
      } finally {
        window.clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
