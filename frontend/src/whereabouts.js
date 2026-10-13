// 行踪采集与上报（whereabouts-mcp 安卓适配）
// 定时 + 前台/后台切换 + 充电变化 → 调 Whereabouts 插件拿位置/电量 → POST /api/v2/whereabouts/ingest
import { Capacitor } from "@capacitor/core";

const WHEREABOUTS_REPORT_INTERVAL_MS = 20 * 60 * 1000; // 20 分钟一次
const LAST_REPORT_KEY = "dengta_whereabouts_last_report";

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

function lastReportAt() {
  try {
    const value = Number(localStorage.getItem(LAST_REPORT_KEY) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function markReported() {
  try {
    localStorage.setItem(LAST_REPORT_KEY, String(Date.now()));
  } catch {
    // 存储不可用时忽略
  }
}

export async function reportWhereabouts({ apiRequest, trigger = "probe", capacitor = Capacitor, force = false } = {}) {
  if (!whereaboutsPluginAvailable(capacitor)) return null;
  const perms = await readWhereaboutsPermissions(capacitor);
  if (!perms.granted) return null;
  if (!force && Date.now() - lastReportAt() < WHEREABOUTS_REPORT_INTERVAL_MS) return null;
  const location = await captureLocation(capacitor);
  if (!location?.latitude || !location?.longitude) return null;
  const body = {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    timestamp: String(location.timestamp || new Date().toISOString()),
    batteryLevel: Number(location.batteryLevel),
    trigger: String(trigger || "probe").slice(0, 40),
    source: "dengta-android",
  };
  try {
    const result = await apiRequest("/api/v2/whereabouts/ingest", {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: 15_000,
    });
    markReported();
    return result;
  } catch {
    return null;
  }
}

// 应用内调度：前台每 20 分钟 + 返回前台时 + 后台切换时各尝试一次（节流在内部）
export function startWhereaboutsScheduler({ apiRequest, capacitor = Capacitor, getActive = () => true }) {
  if (!whereaboutsPluginAvailable(capacitor)) return () => {};
  const report = (trigger) =>
    void reportWhereabouts({ apiRequest, trigger, capacitor });
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible" && getActive()) report("timer");
  }, WHEREABOUTS_REPORT_INTERVAL_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") report("foreground");
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}