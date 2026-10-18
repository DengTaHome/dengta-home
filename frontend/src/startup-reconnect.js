export const BACKEND_WAKE_TIMEOUT_MS = 75_000;
export const STARTUP_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000];
export const STARTUP_REQUEST_OPTIONS = Object.freeze({
  retry: false,
  timeoutMs: BACKEND_WAKE_TIMEOUT_MS,
});

function retryDelayForFailure(failureCount, retryDelays) {
  const index = Math.min(
    Math.max(0, failureCount - 1),
    Math.max(0, retryDelays.length - 1),
  );
  return retryDelays[index] ?? 30_000;
}

function isDocumentHidden(documentTarget) {
  return documentTarget?.visibilityState === "hidden";
}

export function mergeRecoveredStartupData(current = {}, recovered = {}) {
  const sessions = Array.isArray(recovered.sessions) ? recovered.sessions : [];
  const currentSessionId = current.activeSessionId;
  const activeSessionId = sessions.some(
    (session) => session.id === currentSessionId,
  )
    ? currentSessionId
    : sessions[0]?.id || null;

  return {
    ...current,
    settings: recovered.settings ?? current.settings,
    sessions,
    activeSessionId,
  };
}

export function createStartupReconnectController({
  attempt,
  onStateChange = () => {},
  retryDelays = STARTUP_RETRY_DELAYS_MS,
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  timeoutMs = BACKEND_WAKE_TIMEOUT_MS,
} = {}) {
  if (typeof attempt !== "function") {
    throw new TypeError("attempt must be a function");
  }

  let state = {
    status: "idle",
    failureCount: 0,
    nextRetryDelayMs: null,
    lastError: null,
    reason: "",
  };
  let timerId = null;
  let inFlight = null;
  let started = false;
  let stopped = false;
  let currentAttempt = null;

  function publish(patch) {
    state = { ...state, ...patch };
    onStateChange({ ...state });
  }

  function clearRetryTimer() {
    if (timerId === null) return;
    clearTimeoutFn(timerId);
    timerId = null;
  }

  function scheduleRetry(forcedDelay) {
    clearRetryTimer();
    const normalDelay = retryDelayForFailure(
      state.failureCount,
      retryDelays,
    );
    const delay =
      forcedDelay ??
      (isDocumentHidden(documentTarget)
        ? Math.max(30_000, normalDelay)
        : normalDelay);

    publish({ status: "waiting", nextRetryDelayMs: delay });
    timerId = setTimeoutFn(() => {
      timerId = null;
      void retryNow("scheduled");
    }, delay);
  }

  function retryNow(reason = "manual", { replaceInFlight = false } = {}) {
    if (stopped) return Promise.resolve(null);
    if (inFlight && !replaceInFlight) return inFlight;
    currentAttempt?.abort();
    const controller = new AbortController();
    currentAttempt = controller;
    const isCurrent = () => !stopped && currentAttempt === controller && !controller.signal.aborted;

    clearRetryTimer();
    publish({ status: "connecting", nextRetryDelayMs: null, lastError: null, reason });

    let deadline;
    let onAbort;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(new DOMException("Connection attempt cancelled", "AbortError"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      deadline = setTimeoutFn(() => {
        const error = new Error("后端连接超时，可重新连接；草稿和附件仍然保留。");
        error.code = "startup_connection_timeout";
        reject(error);
        controller.abort();
      }, timeoutMs);
    });

    const execution = Promise.race([
      Promise.resolve().then(() => isCurrent() ? attempt({ reason, attemptNumber: state.failureCount + 1, signal: controller.signal, isCurrent }) : null),
      cancelled,
    ])
      .then((result) => {
        if (!isCurrent()) return null;
        publish({
          status: "connected",
          failureCount: 0,
          nextRetryDelayMs: null,
          lastError: null,
        });
        return result;
      })
      .catch((error) => {
        if (stopped || currentAttempt !== controller || error?.name === "AbortError") return null;
        publish({
          failureCount: state.failureCount + 1,
          lastError: error instanceof Error ? error : new Error(String(error)),
        });
        scheduleRetry();
        return null;
      })
      .finally(() => {
        clearTimeoutFn(deadline);
        controller.signal.removeEventListener("abort", onAbort);
        if (inFlight === execution) inFlight = null;
      });

    inFlight = execution;
    return execution;
  }

  function handleOnline() {
    void retryNow("online");
  }

  function handleVisibilityChange() {
    if (documentTarget?.visibilityState === "visible") {
      if (state.status === "waiting") void retryNow("visible");
      return;
    }
    if (
      state.status === "waiting" &&
      Number(state.nextRetryDelayMs) < 30_000
    ) {
      scheduleRetry(30_000);
    }
  }

  function start() {
    if (!started) {
      started = true;
      stopped = false;
      windowTarget?.addEventListener?.("online", handleOnline);
      documentTarget?.addEventListener?.(
        "visibilitychange",
        handleVisibilityChange,
      );
    }
    return retryNow("startup");
  }

  function stop() {
    stopped = true;
    currentAttempt?.abort();
    clearRetryTimer();
    windowTarget?.removeEventListener?.("online", handleOnline);
    documentTarget?.removeEventListener?.(
      "visibilitychange",
      handleVisibilityChange,
    );
    publish({ status: "stopped", nextRetryDelayMs: null });
  }

  return {
    start,
    stop,
    retryNow,
    getState: () => ({ ...state }),
  };
}
