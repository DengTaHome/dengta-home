import { Capacitor, registerPlugin } from "@capacitor/core";

export const BrowserLauncher = registerPlugin("BrowserLauncher");

export function browserLauncherAvailable(capacitor = Capacitor) {
  return (
    capacitor.isNativePlatform() &&
    capacitor.isPluginAvailable("BrowserLauncher")
  );
}

// 打开内置浏览器（登录态长住，独立于日常浏览器）。
export async function openBuiltInBrowser({
  url = "",
  title = "",
  site = "",
  mode = "",
  desktop = false,
} = {}) {
  if (!browserLauncherAvailable()) {
    return { ok: false, error: "内置浏览器仅 Android App 可用。" };
  }
  try {
    const value = await BrowserLauncher.open({ url, title, site, mode, desktop });
    return { ok: true, ...(value || {}) };
  } catch (error) {
    return { ok: false, error: String(error?.message || "打开内置浏览器失败。") };
  }
}

// 读取某站点已提取的登录态 Cookie（在浏览器里点"提取登录态"后）。
export async function readBrowserCookie(site) {
  if (!browserLauncherAvailable()) {
    return { cookie: "", url: "" };
  }
  try {
    const value = await BrowserLauncher.getCookie({ site });
    return { cookie: String(value?.cookie || ""), url: String(value?.url || "") };
  } catch {
    return { cookie: "", url: "" };
  }
}
