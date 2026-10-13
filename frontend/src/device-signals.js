import { Capacitor, registerPlugin } from "@capacitor/core";
import { apiRequest } from "./api.js";

export const DeviceSignals = registerPlugin("DeviceSignals");
export const DEVICE_SIGNALS_REPORT_MS = 60 * 1000;

export function deviceSignalsPluginAvailable(capacitor = Capacitor) {
  return (
    capacitor.isNativePlatform() &&
    capacitor.isPluginAvailable("DeviceSignals")
  );
}

export function normalizeDeviceSignals(value) {
  const battery = Number(value?.battery_pct);
  return Object.freeze({
    batteryPct: Number.isFinite(battery) && battery >= 0 && battery <= 100 ? battery : null,
    charging: value?.charging === true,
    appState: value?.app_state === "foreground" ? "foreground" : "background",
    emulator: value?.emulator === true,
    powerEvent: value?.last_power_event?.event || "",
  });
}

export async function readDeviceSignals({
  capacitor = Capacitor,
  plugin = DeviceSignals,
} = {}) {
  if (!deviceSignalsPluginAvailable(capacitor)) {
    return normalizeDeviceSignals({});
  }
  try {
    return normalizeDeviceSignals(await plugin.getSnapshot());
  } catch {
    return normalizeDeviceSignals({});
  }
}

export function mergeDeviceSignalsContext(environmentContext, signals) {
  const source =
    environmentContext &&
    typeof environmentContext === "object" &&
    !Array.isArray(environmentContext)
      ? environmentContext
      : {};
  const next = { ...source };
  delete next.device_signals;
  if (!signals) return next;
  return {
    ...next,
    device_signals: {
      battery_pct: signals.batteryPct,
      charging: signals.charging,
      app_state: signals.appState,
      emulator: signals.emulator,
    },
  };
}

export async function reportDeviceState(payload, { client = apiRequest } = {}) {
  try {
    return await client("/api/v2/device/state", {
      method: "POST",
      timeoutMs: 15_000,
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
}

export async function readPendingDeviceInjects({ client = apiRequest } = {}) {
  try {
    const data = await client("/api/v2/device/injects", { timeoutMs: 12_000 });
    return Array.isArray(data?.injects) ? data.injects : [];
  } catch {
    return [];
  }
}

export async function ackDeviceInjects(ids, { client = apiRequest } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  try {
    await client("/api/v2/device/injects/ack", {
      method: "POST",
      timeoutMs: 12_000,
      body: JSON.stringify({ ids }),
    });
  } catch {
    // 账本确认失败不阻塞主流程。
  }
}
