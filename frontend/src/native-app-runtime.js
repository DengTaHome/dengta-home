const OFFICIAL_INVITE_ORIGINS = [
  "https://dengtahome.com",
  "https://www.dengtahome.com",
];

/** CSS can scope WebKit adjustments without changing Android or Safari/PWA. */
export function markNativePlatform(capacitor, documentObject = globalThis.document) {
  const platform = capacitor.isNativePlatform() ? capacitor.getPlatform() : "web";
  documentObject.documentElement.dataset.nativePlatform = platform;
  return platform;
}

/** Only registered routes are allowed to hand data to authentication or room UI. */
export function classifyNativeAppUrl(rawUrl, {
  publicAppUrl = "",
} = {}) {
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password || url.port) return null;
    if (url.protocol === "dengta:") {
      if (url.hostname === "auth" && ["", "/"].includes(url.pathname)) return "auth";
      if (url.hostname === "room" && /^\/join\/?$/.test(url.pathname)) return "room";
      return null;
    }
    if (url.protocol !== "https:" || !/^\/room\/join\/?$/.test(url.pathname)) return null;
    const origins = new Set(OFFICIAL_INVITE_ORIGINS);
    try {
      const configured = new URL(publicAppUrl);
      if (configured.protocol === "https:" && !configured.username && !configured.password) {
        origins.add(configured.origin);
      }
    } catch {
      // An unconfigured self-hosted origin does not broaden the allowlist.
    }
    return origins.has(url.origin) ? "room" : null;
  } catch {
    return null;
  }
}

/**
 * Subscribe before reading the launch URL: iOS can deliver a link through both
 * channels. Serialize callbacks, deduplicate that overlap, and release listeners
 * even when an async registration resolves after HMR disposal. URLs containing
 * auth tokens stay only in the short-lived in-memory dedupe window, never logs.
 */
export function installNativeDeepLinks({
  app,
  onAuthUrl,
  onRoomUrl,
  publicAppUrl = "",
  dedupeMs = 3_000,
  scheduleExpiry = globalThis.setTimeout,
  cancelExpiry = globalThis.clearTimeout,
} = {}) {
  let disposed = false;
  let listener;
  let queue = Promise.resolve();
  const recent = new Map();

  async function dispatch(value) {
    if (disposed || typeof value !== "string") return;
    const kind = classifyNativeAppUrl(value, { publicAppUrl });
    if (!kind || recent.has(value)) return;
    const entry = { timer: undefined };
    recent.set(value, entry);
    // Bound memory even if a platform repeatedly sends distinct URLs.
    if (recent.size > 32) {
      const oldest = recent.keys().next().value;
      cancelExpiry(recent.get(oldest).timer);
      recent.delete(oldest);
    }
    const run = queue.then(() => {
      if (disposed) return;
      return kind === "auth" ? onAuthUrl?.(value) : onRoomUrl?.(value);
    });
    queue = run.catch(() => {
      // Authentication publishes its own error snapshot; URLs may contain tokens.
    });
    await queue;
    if (!disposed && recent.get(value) === entry) {
      entry.timer = scheduleExpiry(() => recent.delete(value), dedupeMs);
      entry.timer?.unref?.();
    }
  }

  async function start() {
    try {
      const handle = await app.addListener("appUrlOpen", ({ url } = {}) => {
        void dispatch(url);
      });
      if (disposed) {
        await handle.remove();
        return;
      }
      listener = handle;
    } catch {
      // Cold-start handling remains useful if event registration is unavailable.
    }
    if (disposed) return;
    try {
      const launch = await app.getLaunchUrl();
      await dispatch(launch?.url);
    } catch {
      // A normal icon launch has no URL; the event listener stays active.
    }
  }
  void start();

  return () => {
    disposed = true;
    for (const entry of recent.values()) cancelExpiry(entry.timer);
    recent.clear();
    if (listener) {
      void (async () => {
        try { await listener.remove(); } catch { /* Already removed by the platform. */ }
      })();
    }
  };
}
