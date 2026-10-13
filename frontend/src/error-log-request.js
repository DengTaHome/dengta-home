const receiptFailure = code => Object.assign(new Error("日志接口的回执不完整，请重新读取。"), { code });

export function validateErrorLog(log, logId) {
  if (!log || typeof log !== "object" || Array.isArray(log) || String(log.id ?? "") !== String(logId)) {
    throw receiptFailure("error_log_receipt_invalid");
  }
  return log;
}

async function requestLogJson(path, request, timeoutMs, options) {
  const controller = new AbortController();
  const { signal, ...requestOptions } = options;
  let timer, abort;
  const cancelled = () => Object.assign(new Error("日志读取已取消。"), { name: "AbortError" });
  try {
    if (signal?.aborted) throw cancelled();
    const interruption = new Promise((_, reject) => {
      abort = () => { reject(cancelled()); controller.abort(); };
      signal?.addEventListener("abort", abort, { once: true });
    });
    return await Promise.race([
      request(path, { ...requestOptions, retry: false, signal: controller.signal }),
      interruption,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = Object.assign(new Error("日志读取超时，请重试。"), { code: "request_timeout" });
          reject(error);
          controller.abort();
        }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function requestErrorLog(logId, request, timeoutMs = 15000, options = {}) {
  const data = await requestLogJson(`/api/errors/${encodeURIComponent(logId)}`, request, timeoutMs, options);
  return data?.log == null ? null : validateErrorLog(data.log, logId);
}

export async function requestErrorLogs(request, limit = 50, timeoutMs = 15000, options = {}) {
  const count = Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 50;
  const data = await requestLogJson(`/api/errors?limit=${count}`, request, timeoutMs, options);
  if (!Array.isArray(data?.logs) || data.logs.some(log => !log || typeof log !== "object" || Array.isArray(log) || !String(log.id ?? "").trim())) {
    throw receiptFailure("error_logs_receipt_invalid");
  }
  return data.logs;
}
