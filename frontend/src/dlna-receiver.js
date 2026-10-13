import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * DLNA 接收端前端桥。
 *
 * 方法：
 *   start()            — 在局域网注册为 DLNA 投屏接收器
 *   stop()             — 解除注册
 *   getState()         — 获取当前状态
 *
 * 事件（通过 addListener 监听）：
 *   mediaReceived      — 视频 App 投屏了一个媒体 → { uri, title, metaJson }
 *   stateChanged       — 服务启停 → { state: "running"|"stopped" }
 */
export const DlnaReceiver = registerPlugin("DlnaReceiver");

export function dlnaPluginAvailable(capacitor = Capacitor) {
  return (
    capacitor.isNativePlatform() &&
    capacitor.isPluginAvailable("DlnaReceiver")
  );
}

export function normalizeDlnaState(value = {}) {
  const hasReadiness = typeof value.ssdpReady === "boolean" || typeof value.httpReady === "boolean";
  const errorCode = String(value.errorCode || "");
  const discoveryStatus = String(value.discoveryStatus || (value.active === true ? "ready" : "stopped"));
  const wifiName = String(value.wifiName || "");
  return Object.freeze({
    supported: value.supported === true,
    active: value.active === true && !errorCode && discoveryStatus === "ready"
      && (!hasReadiness || (value.ssdpReady === true && value.httpReady === true)),
    enabled: value.enabled === true,
    ssdpReady: value.ssdpReady === true,
    httpReady: value.httpReady === true,
    discoveryStatus,
    errorCode,
    port: Number(value.port) || 0,
    transportState: String(value.transportState || "STOPPED"),
    currentUri: String(value.currentUri || ""),
    wifiAware: value.wifiAware === true,
    wifiName: wifiName.toLowerCase() === "<unknown ssid>" ? "" : wifiName,
  });
}

export async function readDlnaState({
  capacitor = Capacitor,
  plugin = DlnaReceiver,
} = {}) {
  if (!dlnaPluginAvailable(capacitor)) {
    return normalizeDlnaState({});
  }
  return normalizeDlnaState(await plugin.getState());
}

export async function startDlnaReceiver({
  capacitor = Capacitor,
  plugin = DlnaReceiver,
} = {}) {
  if (!dlnaPluginAvailable(capacitor)) {
    return normalizeDlnaState({});
  }
  return normalizeDlnaState(await plugin.start());
}

export async function stopDlnaReceiver({
  capacitor = Capacitor,
  plugin = DlnaReceiver,
} = {}) {
  if (!dlnaPluginAvailable(capacitor)) {
    return normalizeDlnaState({});
  }
  return normalizeDlnaState(await plugin.stop());
}
