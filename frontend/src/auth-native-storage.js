import { Capacitor, registerPlugin } from "@capacitor/core";
import { createIosAuthStorage } from "./auth-keychain-storage.js";

const DengTaKeychain = registerPlugin("DengTaKeychain");
const loadPreferences = async () => {
  const { Preferences } = await import("@capacitor/preferences");
  // Capacitor proxies synthesize every property, including `then`. Returning
  // one from an async function invokes that nonexistent plugin method during
  // Promise resolution and leaves native auth initialization pending forever.
  // Only return a plain, non-thenable adapter; do not weaken secure migration.
  return {
    get: options => Preferences.get(options),
    set: options => Preferences.set(options),
    remove: options => Preferences.remove(options),
  };
};

/**
 * GoTrue async SupportedStorage. iOS credentials use device-only Keychain and
 * fail closed. Android retains its existing Preferences behavior; Web uses its
 * supplied storage. Preferences on iOS is read only for one-time migration.
 */

async function preferencesAdapter(preferencesLoader = loadPreferences) {
  const Preferences = await preferencesLoader();
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
  capacitor = Capacitor,
  keychain = DengTaKeychain,
  preferencesLoader = loadPreferences,
} = {}) {
  if (capacitor.isNativePlatform() && capacitor.getPlatform() === "ios") {
    let legacyPreferences;
    try { legacyPreferences = await preferencesLoader(); } catch { /* Migration fails closed. */ }
    return createIosAuthStorage({
      keychain: capacitor.isPluginAvailable("DengTaKeychain") ? keychain : undefined,
      legacyPreferences,
      legacyStorage: storage,
    });
  }
  if (capacitor.isNativePlatform()) {
    try {
      const adapter = await preferencesAdapter(preferencesLoader);
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
