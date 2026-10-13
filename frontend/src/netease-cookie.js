import { Capacitor, registerPlugin } from "@capacitor/core";

export const NeteaseCookie = registerPlugin("NeteaseCookie");

export function neteaseCookiePluginAvailable(capacitor = Capacitor) {
  return (
    capacitor.isNativePlatform() &&
    capacitor.isPluginAvailable("NeteaseCookie")
  );
}

export async function openNeteaseCookieLogin({ plugin = NeteaseCookie, desktop = false } = {}) {
  if (!neteaseCookiePluginAvailable()) {
    return { ok: false, error: "一键连接仅 Android App 可用。" };
  }
  try {
    const value = await plugin.openLogin({ desktop });
    return { ok: true, ...(value || {}) };
  } catch (error) {
    return { ok: false, error: String(error?.message || "打开网易云登录页失败。") };
  }
}

// 电脑桌面版网页登录：桌面 UA 加载 music.163.com（含扫码登录），
// 二维码支持双指放大；部分用户反馈手机版登录页点不动，用桌面版绕开。
export async function openNeteaseDesktopLogin(options = {}) {
  return openNeteaseCookieLogin({ ...options, desktop: true });
}
