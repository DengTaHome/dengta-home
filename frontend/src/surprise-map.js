import { Capacitor } from "@capacitor/core";

export function surpriseMapError(error) {
  const code = /^[a-z0-9_]{1,90}$/i.test(String(error?.code || "")) ? error.code : "surprise_map_request_failed";
  const help = {
    surprise_map_schema_required: "藏宝地图的数据结构尚未安装，现有聊天与记忆不受影响。",
    surprise_map_receipt_invalid: "服务器没有返回有效确认，草稿仍保留；请刷新核对后重试。",
    surprise_map_request_conflict: "上次留信请求已绑定另一份内容或地点，请先刷新核对结果，再重新开始。",
    surprise_map_location_required: "请点击定位，只使用本次位置来核对距离。",
    surprise_map_location_invalid: "定位结果不完整，请打开精确定位后重新尝试。",
    surprise_map_location_stale: "这次定位已过期，请重新定位。",
    surprise_map_accuracy_insufficient: "定位精度不足，请到开阔位置重试。",
    surprise_map_too_far: "还没到信件附近，走近一些后再点击领取。",
    surprise_map_out_of_range: "还没到信件附近，走近一些后再点击领取。",
    surprise_map_location_inaccurate: "定位精度不足，请到开阔位置重试。",
    surprise_map_draft_failed: "本次模型未返回完整信件，可以重试写信或自行填写。",
    surprise_map_publication_exists: "这封信已有公开版本，请先刷新查看，避免重复发布。",
    surprise_map_invalid_request: "请检查标题、正文、地点与坐标是否完整。",
    surprise_map_not_found: "这封信已撤回，或不属于当前空间，请刷新。",
    surprise_map_draft_unavailable: "当前模型暂时无法写信，请检查接口设置；也可以自己填写。",
    surprise_map_draft_invalid: "模型没有返回完整信件，可重试写信或自行填写。",
    surprise_map_publication_confirmation_required: "请先预览公开内容并确认，再发布。",
    location_permission_denied: "未获定位授权。可以继续浏览，或在系统设置中允许位置后再试。",
    location_unavailable: "暂时无法定位，请检查定位开关与网络。",
    location_timeout: "定位超时，请到开阔位置后重试。",
    settings_scope_changed: "空间已切换，本次操作已取消。",
    request_timeout: "等待确认超时，请先刷新核对结果，避免重复留信。",
  };
  return `${help[code] || "本次操作未确认完成，请刷新核对；仍失败时可提供错误代码检查。"}（${code}）`;
}

export function validMapLocation(location) {
  return location && typeof location.latitude === "number" && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 &&
    typeof location.longitude === "number" && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180 &&
    typeof location.accuracy === "number" && Number.isFinite(location.accuracy) && location.accuracy >= 0;
}
export async function locateForSurpriseMap({ capacitor = Capacitor, geolocation = globalThis.navigator?.geolocation, now = () => Date.now() } = {}) {
  let location, capturedAt;
  if (capacitor?.isPluginAvailable?.("Whereabouts")) {
    const plugin = capacitor.Plugins.Whereabouts;
    const permission = await plugin.requestPermissions();
    if (permission?.granted !== true) throw Object.assign(new Error("Location not granted"), { code: "location_permission_denied" });
    location = await plugin.getLocation();
    capturedAt = typeof location?.timestamp === "number" ? location.timestamp : Date.parse(location?.timestamp || "");
  } else {
    if (!geolocation) throw Object.assign(new Error("Geolocation unavailable"), { code: "location_unavailable" });
    const result = await new Promise((resolve, reject) => geolocation.getCurrentPosition(resolve,
      error => reject(Object.assign(new Error("Geolocation failed"), { code: ({ 1: "location_permission_denied", 2: "location_unavailable", 3: "location_timeout" })[error?.code] || "location_unavailable" })),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }));
    location = result.coords;
    capturedAt = result.timestamp;
  }
  if (!Number.isFinite(capturedAt) || now() - capturedAt > 120000 || capturedAt - now() > 30000) throw Object.assign(new Error("Stale location receipt"), { code: "surprise_map_location_stale" });
  const position = { latitude: location?.latitude, longitude: location?.longitude, accuracy: location?.accuracy, captured_at: new Date(capturedAt).toISOString() };
  if (!validMapLocation(position)) throw Object.assign(new Error("Incomplete geolocation receipt"), { code: "surprise_map_location_invalid" });
  return position;
}

export function mapRadarPoint(area, center) {
  if (!area || !Number.isFinite(area.latitude) || !Number.isFinite(area.longitude)) return null;
  const dx = (area.longitude - (center?.longitude ?? 0)) * Math.cos((center?.latitude ?? 0) * Math.PI / 180);
  const dy = area.latitude - (center?.latitude ?? 0);
  const distance = Math.hypot(dx, dy);
  const scale = distance > 0.02 ? 0.02 / distance : 1;
  return { x: 50 + dx * scale * 1900, y: 50 - dy * scale * 1900 };
}
