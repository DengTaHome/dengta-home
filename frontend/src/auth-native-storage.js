import { Capacitor } from "@capacitor/core";

/**
 * Android 原生端会话持久化（缺陷 2 修复）。
 *
 * 为什么需要它：AuthGate/GoTrueClient 默认用 WebView localStorage 保存登录会话，
 * Android 在系统存储压力下可能回收 WebView 存储，导致用户"莫名其妙掉登录"。
 * @capacitor/preferences 提供原生键值存储，可靠性更高。
 *
 * 用法：把返回值传给 GoTrueClient 的 storage 选项（SupportedStorage，支持 async）。
 */

async function preferencesAdapter() {
  const { Preferences } = await import("@capacitor/preferences");
  return {
    async getItem(key) {
      const { value } = await Preferences.get({ key });
      return value ?? null;
    },
    async setItem(key, value) {
      await Preferences.set({ key, value: String(value ?? "") });
    },
    async removeItem(key) {
      await Preferences.remove({ key });
    },
  };
}

export async function resolveAuthStorage({
  storage = globalThis.localStorage,
} = {}) {
  if (Capacitor.isNativePlatform()) {
    try {
      const adapter = await preferencesAdapter();
      // 探测一次写入，确认原生存储可用
      const probeKey = "dengta_auth_storage_probe_v1";
      await adapter.setItem(probeKey, "1");
      const probe = await adapter.getItem(probeKey);
      await adapter.removeItem(probeKey);
      if (probe === "1") return adapter;
    } catch {
      // 原生存储不可用（罕见），回退 localStorage
    }
  }
  // Web/非原生：直接返回原始 storage（保持引用一致性，让测试通过）
  if (
    storage &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
  ) {
    return storage;
  }
  return undefined;
}
