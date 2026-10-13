const CHUNK_RECOVERY_KEY = "dengta:app-chunk-recovery";
const UI_PREFERENCE_KEYS = Object.freeze([
  "dengta.ui-theme.v1",
  "dengta.ui-theme.v2",
  "dengta.font-mode.v1",
  "dengta.chat-skin.v1",
  "dengta_home_ambient_preferences_v1",
  "dengta_home_ambient_location_v1",
  "dengta_home_ambient_weather_v1",
]);

export function startupDiagnosticCode(error) {
  const message = String(error?.message || "");
  if (/catalog/.test(message) && /null|undefined/.test(message)) {
    return "DT-START-PM-01";
  }
  if (error?.name === "ChunkLoadError" || /dynamically imported module|chunk/i.test(message)) {
    return "DT-START-CH-01";
  }
  if (/is not a function|not defined|unsupported/i.test(message)) {
    return "DT-START-WV-01";
  }
  return "DT-START-UI-01";
}

export function clearLocalUiPreferences(
  accountScope = "",
  storage = globalThis.localStorage,
) {
  const scope = String(accountScope || "").trim();
  for (const key of UI_PREFERENCE_KEYS) {
    try {
      storage?.removeItem(key);
      if (scope) storage?.removeItem(`${key}:${scope}`);
    } catch {
      // A restricted WebView may reject storage access; reload remains available.
    }
  }
}

export function reloadApplication() {
  globalThis.sessionStorage?.removeItem(CHUNK_RECOVERY_KEY);
  globalThis.location?.reload();
}

export function clearUiPreferencesAndReload(accountScope = "") {
  clearLocalUiPreferences(accountScope);
  reloadApplication();
}

export function installChunkRecovery() {
  globalThis.addEventListener?.("vite:preloadError", (event) => {
    event.preventDefault?.();
    const storage = globalThis.sessionStorage;
    if (storage?.getItem(CHUNK_RECOVERY_KEY) === "attempted") return;
    storage?.setItem(CHUNK_RECOVERY_KEY, "attempted");
    globalThis.location?.reload();
  });
}

export function markAppLoaded() {
  globalThis.sessionStorage?.removeItem(CHUNK_RECOVERY_KEY);
}
