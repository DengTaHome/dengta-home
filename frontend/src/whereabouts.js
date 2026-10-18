// 行踪采集与上报（whereabouts-mcp 安卓适配）
// 已授权时定时或返回前台 → 调 Whereabouts 插件拿位置/电量 → POST /api/v2/whereabouts/ingest
import { Capacitor } from "@capacitor/core";
import { authSession as defaultAuthSession } from "./auth-session.js";
import { accountStorageKey } from "./account-storage.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";
import { readWhereaboutsConsent, subscribeWhereaboutsConsent } from "./whereabouts-consent.js";

const WHEREABOUTS_REPORT_INTERVAL_MS = 20 * 60 * 1000; // 20 分钟一次
const LAST_REPORT_KEY = "dengta_whereabouts_last_report";
const pendingReports = new WeakMap();

export function whereaboutsPluginAvailable(capacitor = Capacitor) {
  return Boolean(capacitor?.isPluginAvailable?.("Whereabouts"));
}

export async function readWhereaboutsPermissions(capacitor = Capacitor) {
  if (!whereaboutsPluginAvailable(capacitor)) return { available: false };
  try {
    const result = await capacitor.Plugins.Whereabouts.checkPermissions();
    return { available: true, granted: result?.granted === true };
  } catch {
    return { available: true, granted: false };
  }
}

export async function requestWhereaboutsPermissions(capacitor = Capacitor) {
  if (!whereaboutsPluginAvailable(capacitor)) return { available: false };
  try {
    const result = await capacitor.Plugins.Whereabouts.requestPermissions();
    return { available: true, granted: result?.granted === true };
  } catch {
    return { available: true, granted: false };
  }
}

async function captureLocation(capacitor = Capacitor) {
  if (!whereaboutsPluginAvailable(capacitor)) return null;
  try {
    return await capacitor.Plugins.Whereabouts.getLocation();
  } catch {
    return null;
  }
}

function lastReportAt(storage, scope, now) {
  try {
    const value = Number(storage?.getItem(accountStorageKey(LAST_REPORT_KEY, scope)) || 0);
    return Number.isFinite(value) && value > 0 && value <= now ? value : 0;
  } catch {
    return 0;
  }
}

function markReported(storage, scope, now) {
  try {
    storage?.setItem(accountStorageKey(LAST_REPORT_KEY, scope), String(now));
  } catch {
    // 存储不可用时忽略
  }
}

function locationNumber(value, minimum, maximum) {
  if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

async function reportForScope({ apiRequest, trigger, capacitor, force, session, scope, storage, now, signal, requireConsent }) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) return null;
  signal?.addEventListener("abort", forwardAbort, { once: true });
  const current = () => !controller.signal.aborted && settingsSaveScope(session.getSnapshot()) === scope && (!requireConsent || readWhereaboutsConsent(scope, storage));
  const unsubscribe = session.subscribe?.(() => { if (!current()) controller.abort(); });
  const unsubscribeConsent = requireConsent ? subscribeWhereaboutsConsent(() => { if (!current()) controller.abort(); }) : null;
  try {
    if (!current()) return null;
    const permissions = await readWhereaboutsPermissions(capacitor);
    if (!current() || !permissions.granted) return null;
    const previousReport = lastReportAt(storage, scope, now());
    if (!force && previousReport && now() - previousReport < WHEREABOUTS_REPORT_INTERVAL_MS) return null;
    const location = await captureLocation(capacitor);
    if (!current()) return null;
    const latitude = locationNumber(location?.latitude, -90, 90);
    const longitude = locationNumber(location?.longitude, -180, 180);
    if (latitude === null || longitude === null) return null;
    const accuracy = locationNumber(location?.accuracy, 0, Number.MAX_VALUE);
    const batteryLevel = locationNumber(location?.batteryLevel, 0, 100);
    const body = {
      latitude, longitude,
      ...(accuracy === null ? {} : { accuracy }),
      timestamp: String(location.timestamp || new Date(now()).toISOString()),
      ...(batteryLevel === null ? {} : { batteryLevel }),
      trigger: String(trigger || "probe").slice(0, 40),
      source: "dengta-android",
    };
    const result = await apiRequest("/api/v2/whereabouts/ingest", {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: 15_000,
      signal: controller.signal,
      authSession: createScopedSettingsSession(session, scope, controller.signal),
    });
    if (!current()) return null;
    markReported(storage, scope, now());
    return result;
  } catch {
    return null;
  } finally {
    unsubscribe?.();
    unsubscribeConsent?.();
    signal?.removeEventListener("abort", forwardAbort);
  }
}

export async function reportWhereabouts({ apiRequest, trigger = "probe", capacitor = Capacitor, force = false,
  authSession = defaultAuthSession, storage, now = Date.now, signal, requireConsent = false } = {}) {
  if (!whereaboutsPluginAvailable(capacitor) || typeof apiRequest !== "function" || !authSession?.getSnapshot) return null;
  const snapshot = authSession.getSnapshot();
  if (!snapshot?.user?.id || !snapshot.activeCompanionId || signal?.aborted) return null;
  const scope = settingsSaveScope(snapshot);
  if (requireConsent && !readWhereaboutsConsent(scope, storage)) return null;
  let pending = pendingReports.get(authSession);
  if (!pending) { pending = new Map(); pendingReports.set(authSession, pending); }
  if (pending.has(scope)) return pending.get(scope);
  let targetStorage = storage;
  try { targetStorage ??= globalThis.localStorage; } catch { /* optional storage */ }
  const operation = reportForScope({ apiRequest, trigger, capacitor, force, session: authSession, scope, storage: targetStorage, now, signal, requireConsent });
  pending.set(scope, operation);
  try { return await operation; }
  finally { if (pending.get(scope) === operation) pending.delete(scope); }
}

// OS location permission alone never enables periodic recording.
export function startWhereaboutsScheduler({ apiRequest, capacitor = Capacitor, getActive = () => true,
  authSession = defaultAuthSession, storage, now = Date.now }) {
  if (!whereaboutsPluginAvailable(capacitor)) return () => {};
  let controller = null, scope = "", timer = null, stopped = false;
  const clearRun = () => {
    controller?.abort(); controller = null; scope = "";
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };
  const sync = () => {
    const snapshot = authSession.getSnapshot(), nextScope = settingsSaveScope(snapshot);
    const enabled = snapshot.user?.id && snapshot.activeCompanionId && readWhereaboutsConsent(nextScope, storage);
    if (!stopped && enabled && scope === nextScope && controller && !controller.signal.aborted) return;
    clearRun();
    if (stopped || !enabled) return;
    scope = nextScope; controller = new AbortController();
    timer = window.setInterval(() => report("timer"), WHEREABOUTS_REPORT_INTERVAL_MS);
  };
  const report = trigger => {
    sync();
    if (!controller || document.visibilityState !== "visible" || !getActive()) return;
    void reportWhereabouts({ apiRequest, trigger, capacitor, authSession, storage, now, signal: controller.signal, requireConsent: true });
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") report("foreground");
  };
  const unsubscribeSession = authSession.subscribe?.(sync);
  const unsubscribeConsent = subscribeWhereaboutsConsent(sync);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener?.("storage", sync);
  sync();
  return () => {
    stopped = true; clearRun(); unsubscribeSession?.(); unsubscribeConsent();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener?.("storage", sync);
  };
}
