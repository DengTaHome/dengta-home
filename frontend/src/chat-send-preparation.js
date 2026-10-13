export const CHAT_SEND_PREPARATION_LABELS = {
  settings: "正在同步最新设置，消息尚未发送，可随时停止。",
  model: "正在确认所选模型，消息尚未发送，可随时停止。",
};

// Cancelling this wait must not cancel the independent settings save itself.
export function awaitChatPreparation(operation, signal) {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException("发送准备已取消", "AbortError");
    const abort = () => reject(abortError());
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    const finish = (callback, value) => {
      signal.removeEventListener("abort", abort);
      callback(value);
    };
    Promise.resolve().then(() => {
      if (signal.aborted) throw abortError();
      return operation();
    }).then(
      value => finish(resolve, value),
      error => finish(reject, error),
    );
  });
}
