import { IOS_AUTH_STORAGE_KEYS } from "./auth-keychain-storage.js";

export class AuthStorageLeaseError extends Error {
  constructor(code = "auth_storage_unavailable") {
    super("安全登录存储暂不可用，请解锁设备后重试。");
    this.name = "AuthStorageLeaseError";
    this.code = code;
  }
}

/**
 * Each SDK client gets its own revocable storage lease. Retirement fences old
 * refreshes immediately, then drains the operation already in progress before
 * clearing credentials. The next client must wait for this barrier to finish.
 */
export function createAuthStorageLease(storage, keys = IOS_AUTH_STORAGE_KEYS) {
  if (storage === undefined || storage === null) return undefined;
  if (!["getItem", "setItem", "removeItem"].every(method => typeof storage[method] === "function")) {
    throw new AuthStorageLeaseError();
  }
  const authKeys = new Set(keys);
  let queue = Promise.resolve();
  let retired = false;
  let retirement = null;

  function assertActive() {
    if (retired) throw new AuthStorageLeaseError("auth_storage_retired");
  }

  function serialize(key, code, operation) {
    if (!authKeys.has(key)) return Promise.reject(new AuthStorageLeaseError("auth_storage_invalid_key"));
    if (retired) return Promise.reject(new AuthStorageLeaseError("auth_storage_retired"));
    const result = queue.then(async () => {
      assertActive();
      const value = await operation();
      assertActive();
      return value;
    }).catch(error => {
      // Storage providers can include credentials in messages or causes.
      throw new AuthStorageLeaseError(error instanceof AuthStorageLeaseError ? error.code : code);
    });
    queue = result.catch(() => {});
    return result;
  }

  return Object.freeze({
    getItem(key) {
      return serialize(key, "auth_storage_read_failed", () => storage.getItem(key));
    },
    setItem(key, value) {
      return serialize(key, "auth_storage_write_failed", () => storage.setItem(key, value));
    },
    removeItem(key) {
      return serialize(key, "auth_storage_remove_failed", () => storage.removeItem(key));
    },
    retireAndClear() {
      retired = true;
      if (retirement) return retirement;
      const clear = queue.then(async () => {
        try {
          if (typeof storage.retireAndClear === "function") {
            await storage.retireAndClear();
            return;
          }
          let failed = false;
          for (const key of authKeys) {
            try {
              await storage.removeItem(key);
              if (await storage.getItem(key) !== null) failed = true;
            } catch {
              failed = true;
            }
          }
          if (failed) throw new AuthStorageLeaseError("auth_storage_clear_failed");
        } catch {
          throw new AuthStorageLeaseError("auth_storage_clear_failed");
        }
      });
      retirement = clear;
      queue = clear.catch(() => {});
      void clear.catch(() => {
        // Keep the lease sealed, but permit explicit clearing after unlock.
        if (retirement === clear) retirement = null;
      });
      return clear;
    },
  });
}
