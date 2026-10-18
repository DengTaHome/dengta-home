function recoveryError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function createMonologueRequestOperation({
  timeoutMs = 120_000,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  const controller = new AbortController();
  let failure;
  const abortWith = error => { failure = error; controller.abort(error); };
  const timer = setTimer(() => abortWith(recoveryError("inner_monologue_timeout",
    "补充心声等待超过两分钟，已停止本次等待。原片段仍保留，可重新点击补充；重试会复用原请求编号。")), timeoutMs);
  const reason = () => failure || controller.signal.reason || new DOMException("本次等待已取消。", "AbortError");
  return {
    controller,
    cancel() {
      abortWith(recoveryError("inner_monologue_cancelled", "已取消本次心声等待，原片段仍保留。需要时可再次补充。"));
    },
    finish() { clearTimer(timer); },
    wait(work) {
      if (controller.signal.aborted) return Promise.reject(reason());
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          controller.signal.removeEventListener("abort", abort);
          callback(value);
        };
        const abort = () => finish(reject, reason());
        controller.signal.addEventListener("abort", abort, { once: true });
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw reason();
          return work();
        }).then(value => finish(resolve, value), error => finish(reject, error));
      });
    },
  };
}
