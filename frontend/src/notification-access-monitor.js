const errors = {
  music_notification_check_failed: "无法读取通知使用权，请重新检查。",
  music_notification_settings_failed: "无法打开通知使用权设置，请在系统设置中手动授权。",
  music_notification_listener_failed: "返回前台时无法自动检查授权，请点重新检查。",
  music_notification_listener_timeout: "自动检查授权的监听连接超时，请点重新检查。",
};

export function createNotificationAccessMonitor({ supported, read, open, listen, onState, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let generation = 0, revision = 0, active = false, handle, opening = false;
  let listenerFailure = "";
  const timeoutMarker = Symbol("notification-access-timeout");
  let registration = 0, registering = false;
  let state = { supported, granted: false, checking: supported, opening: false, errorCode: "", errorMessage: "" };
  const pending = new Set();
  const emit = patch => { state = { ...state, ...patch }; if (active) onState(state); };
  const failure = code => ({ errorCode: code, errorMessage: `${errors[code]}（${code}）` });
  const removeListener = value => { if (typeof value?.remove === "function") void Promise.resolve().then(() => value.remove()).catch(() => {}); };
  function bounded(call, onLateValue) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (method, value) => { if (settled) return; settled = true; clearTimer(timer); pending.delete(cancel); method(value); };
      const cancel = () => finish(reject, new Error("Cancelled"));
      const timer = setTimer(() => finish(reject, Object.assign(new Error("Timeout"), { [timeoutMarker]: true })), 12000);
      pending.add(cancel);
      Promise.resolve().then(() => { if (settled) throw new Error("Cancelled"); return call(); }).then(value => { if (settled) onLateValue?.(value); else finish(resolve, value); }, error => finish(reject, error));
    });
  }
  async function ensureListener() {
    if (!active || !supported || handle || registering) return;
    registering = true;
    const token = generation, attempt = ++registration;
    try {
      const value = await bounded(async () => {
        const receipt = await listen(event => { if (active && token === generation && attempt === registration && event?.isActive) void refresh(); });
        if (typeof receipt?.remove !== "function") throw new Error("Invalid listener receipt");
        return receipt;
      }, removeListener);
      if (!active || token !== generation || attempt !== registration) { removeListener(value); return; }
      handle = value; registering = false; listenerFailure = "";
      if (["music_notification_listener_failed", "music_notification_listener_timeout"].includes(state.errorCode)) emit({ errorCode: "", errorMessage: "" });
    } catch (error) {
      if (active && token === generation && attempt === registration) {
        registering = false; listenerFailure = error?.[timeoutMarker] ? "music_notification_listener_timeout" : "music_notification_listener_failed"; registration++;
        emit(failure(listenerFailure));
      }
    }
  }
  async function refresh() {
    if (!active || !supported) return;
    void ensureListener();
    const token = generation, request = ++revision;
    emit({ checking: true });
    try {
      const result = await bounded(read);
      if (typeof result?.granted !== "boolean") throw new Error("Invalid receipt");
      if (active && token === generation && request === revision) emit({ granted: result.granted, checking: false, ...(listenerFailure ? failure(listenerFailure) : { errorCode: "", errorMessage: "" }) });
    } catch {
      if (active && token === generation && request === revision) emit({ checking: false, ...failure("music_notification_check_failed") });
    }
  }
  async function request() {
    if (!active || !supported || opening) return;
    opening = true;
    const token = generation;
    emit({ opening: true, errorCode: "", errorMessage: "" });
    try {
      if (await bounded(open) !== true) throw new Error("Settings unavailable");
      if (active && token === generation) await refresh();
    } catch {
      if (active && token === generation) emit(failure("music_notification_settings_failed"));
    } finally {
      if (token === generation) { opening = false; emit({ opening: false }); }
    }
  }
  function stop() {
    active = false; generation++; revision++; registration++; registering = false; opening = false;
    for (const cancel of [...pending]) cancel();
    if (handle) { removeListener(handle); handle = undefined; }
  }
  function start() {
    stop(); active = true; listenerFailure = "";
    if (!supported) return () => stop();
    void refresh();
    return () => stop();
  }
  return { start, stop, refresh, request, initialState: state };
}
