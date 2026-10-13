// A bridge timeout does not cancel a native side effect; callers must not retry it automatically.
export function awaitCastReceipt(request, { timeoutMs = 5000, code = "cast_command_timeout", signal } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => finish(reject, Object.assign(new Error("cast_operation_cancelled"), { name: "AbortError", code: "cast_operation_cancelled" }));
    // Always observe late rejection, including a request already cancelled before registration.
    Promise.resolve(request).then(value => finish(resolve, value), error => finish(reject, error));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(reject, Object.assign(new Error(code), { code })), timeoutMs);
  });
}
