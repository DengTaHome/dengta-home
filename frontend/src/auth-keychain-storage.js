export const IOS_AUTH_STORAGE_KEYS = Object.freeze([
  "dengta_home_auth_v1",
  "dengta_home_auth_v1-code-verifier",
  "dengta_home_auth_v1-user",
]);

const AUTH_KEYS = new Set(IOS_AUTH_STORAGE_KEYS);

export class IosAuthStorageError extends Error {
  constructor(code = "ios_auth_storage_unavailable") {
    super("安全登录存储暂不可用，请解锁设备后重新打开应用。");
    this.name = "IosAuthStorageError";
    this.code = code;
  }
}

function requireAuthKey(key) {
  if (!AUTH_KEYS.has(key)) throw new IosAuthStorageError("ios_auth_storage_invalid_key");
}

async function readKeychain(plugin, key) {
  const result = await plugin.get({ key });
  if (!result || !(result.value === null || typeof result.value === "string")) {
    throw new IosAuthStorageError();
  }
  return result.value;
}

async function writeVerified(plugin, key, value) {
  await plugin.set({ key, value });
  if (await readKeychain(plugin, key) !== value) throw new IosAuthStorageError();
}

async function readLegacyPreference(preferences, key) {
  const result = await preferences.get({ key });
  if (!result || !(result.value === null || typeof result.value === "string")) throw new IosAuthStorageError();
  return result.value;
}

/** Delete only the known auth keys. Unrelated settings and user content stay intact. */
async function scrubLegacyKey(preferences, storage, key) {
  const results = await Promise.allSettled([
    (async () => {
      if (!preferences) throw new IosAuthStorageError();
      await preferences.remove({ key });
      if (await readLegacyPreference(preferences, key) !== null) throw new IosAuthStorageError();
    })(),
    (async () => {
      if (!storage) throw new IosAuthStorageError();
      await storage.removeItem(key);
      if (await storage.getItem(key) !== null) throw new IosAuthStorageError();
    })(),
  ]);
  if (results.some(result => result.status === "rejected")) throw new IosAuthStorageError("ios_auth_storage_cleanup_failed");
}

async function removeVerifiedAndScrub(plugin, preferences, storage, key) {
  try {
    await plugin.remove({ key });
    if (await readKeychain(plugin, key) !== null) throw new IosAuthStorageError();
  } finally {
    await scrubLegacyKey(preferences, storage, key);
  }
}

/**
 * Migrate the previous native Preferences/localStorage session exactly once.
 * Keychain wins if it already contains a value. A verified Keychain write occurs
 * before deletion; all known plaintext copies are still scrubbed if migration
 * fails. No failed read/write can turn into a plaintext persistence fallback.
 * Values and provider errors never become error causes, diagnostics, or logs.
 */
export async function createIosAuthStorage({
  keychain,
  legacyPreferences,
  legacyStorage,
} = {}) {
  let migrationFailed = false;
  for (const key of IOS_AUTH_STORAGE_KEYS) {
    try {
      const current = await readKeychain(keychain, key);
      if (current === null) {
        if (!legacyPreferences || !legacyStorage) throw new IosAuthStorageError();
        const preferred = await readLegacyPreference(legacyPreferences, key);
        const legacy = preferred ?? await legacyStorage.getItem(key);
        if (legacy !== null && legacy !== undefined) {
          if (typeof legacy !== "string") throw new IosAuthStorageError();
          await writeVerified(keychain, key, legacy);
        }
      }
    } catch {
      migrationFailed = true;
    } finally {
      try { await scrubLegacyKey(legacyPreferences, legacyStorage, key); }
      catch { migrationFailed = true; }
    }
  }
  if (migrationFailed) throw new IosAuthStorageError("ios_auth_storage_migration_failed");

  // One queue preserves storage call order across writes, reads and logout.
  // Rejection never poisons later calls, allowing an unlocked device to retry.
  let queue = Promise.resolve();
  let retired = false;
  let retirement = null;
  const assertActive = () => {
    if (retired) throw new IosAuthStorageError("ios_auth_storage_retired");
  };
  const serialized = (key, code, operation) => {
    requireAuthKey(key);
    if (retired) return Promise.reject(new IosAuthStorageError("ios_auth_storage_retired"));
    const result = queue.then(async () => {
      assertActive();
      const value = await operation();
      assertActive();
      return value;
    }).catch(error => {
      throw new IosAuthStorageError(error?.code === "ios_auth_storage_retired" ? "ios_auth_storage_retired" : code);
    });
    queue = result.catch(() => {});
    return result;
  };
  return Object.freeze({
    getItem(key) {
      return serialized(key, "ios_auth_storage_read_failed", () => readKeychain(keychain, key));
    },
    setItem(key, value) {
      return serialized(key, "ios_auth_storage_write_failed", async () => {
        if (typeof value !== "string") throw new IosAuthStorageError();
        await writeVerified(keychain, key, value);
      });
    },
    removeItem(key) {
      return serialized(key, "ios_auth_storage_remove_failed", () =>
        removeVerifiedAndScrub(keychain, legacyPreferences, legacyStorage, key));
    },
    retireAndClear() {
      // Synchronous revocation blocks old SDK calls and already-queued work.
      // The privileged clear waits for any in-flight native operation before a
      // new SDK/storage instance may be created by the account-exit barrier.
      retired = true;
      if (retirement) return retirement;
      const clear = queue.then(async () => {
        let failed = false;
        for (const key of IOS_AUTH_STORAGE_KEYS) {
          try { await removeVerifiedAndScrub(keychain, legacyPreferences, legacyStorage, key); }
          catch { failed = true; }
        }
        if (failed) throw new IosAuthStorageError("ios_auth_storage_clear_failed");
      });
      retirement = clear;
      queue = clear.catch(() => {});
      void clear.catch(() => {
        // Remain retired, but allow an explicit clear retry after unlocking.
        if (retirement === clear) retirement = null;
      });
      return clear;
    },
  });
}
