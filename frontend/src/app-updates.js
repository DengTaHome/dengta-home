export const APP_UPDATE_FEED = "https://www.dengtahome.com/updates/android.json";
export const APP_UPDATE_PACKAGE = "home.dengta.app";
export const UPDATE_REMIND_MS = 24 * 60 * 60 * 1_000;
export const MAX_ANDROID_BUILD = 2_147_483_647;

export function validUpdateDownload(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password &&
      !url.port && !url.search && !url.hash && /^\/DengTaHome\/dengta-home(?:-frontend)?\/releases\/download\/v[\d.]+\/[-\w.]+\.apk$/.test(url.pathname);
  } catch { return false; }
}

function invalidFeed() {
  const error = new Error("更新信息暂时不可用，请稍后再试。当前版本仍可使用。");
  error.code = "app_update_manifest_invalid";
  return error;
}

export function readUpdateManifest(data, installedBuild) {
  if (!data || data.schema_version !== 1 || data.package_id !== APP_UPDATE_PACKAGE || data.channel !== "stable") throw invalidFeed();
  if (!(typeof installedBuild === "number" || typeof installedBuild === "string" && /^[1-9]\d*$/.test(installedBuild))) throw invalidFeed();
  const build = Number(installedBuild);
  if (!Number.isSafeInteger(build) || build < 1 || build > MAX_ANDROID_BUILD) throw invalidFeed();
  if (data.latest === null) return null;
  const release = data.latest;
  if (!release || !Number.isSafeInteger(release.version_code) || release.version_code < 1 || release.version_code > MAX_ANDROID_BUILD ||
    typeof release.version !== "string" || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(release.version) || !validUpdateDownload(release.apk_url) ||
    typeof release.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(release.sha256) || !Number.isSafeInteger(release.size_bytes) || release.size_bytes < 1 ||
    typeof release.published_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(release.published_at) || !Number.isFinite(Date.parse(release.published_at)) || !Array.isArray(release.notes) ||
    release.notes.length < 1 || release.notes.length > 20 ||
    !release.notes.every(note => typeof note === "string" && note.trim().length > 0 && note.length <= 500)) throw invalidFeed();
  return release.version_code > build ? { ...release, notes: [...release.notes] } : null;
}

export async function fetchAppUpdate(installedBuild, { fetchImpl = globalThis.fetch, signal, timeoutMs = 12_000 } = {}) {
  if (signal?.aborted) throw new DOMException("Update check cancelled", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, timeoutMs);
  let reader;
  let rejectAbort;
  const cancellation = new Promise((_, reject) => {
    rejectAbort = () => reject(new DOMException("Update check cancelled", "AbortError"));
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
  });
  try {
    if (controller.signal.aborted) throw new DOMException("Update check cancelled", "AbortError");
    const response = await Promise.race([fetchImpl(APP_UPDATE_FEED, {
      method: "GET", cache: "no-store", credentials: "omit", redirect: "error",
      headers: { Accept: "application/json" }, signal: controller.signal,
    }), cancellation]);
    if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json") || Number(response.headers.get("Content-Length")) > 65_536) throw invalidFeed();
    reader = response.body?.getReader();
    if (!reader) throw invalidFeed();
    const decoder = new TextDecoder();
    let bytes = 0, content = "";
    while (true) {
      const { done, value } = await Promise.race([reader.read(), cancellation]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65_536) throw invalidFeed();
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
    let payload;
    try { payload = JSON.parse(content); } catch { throw invalidFeed(); }
    if (controller.signal.aborted) throw new DOMException("Update check cancelled", "AbortError");
    return readUpdateManifest(payload, installedBuild);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
    if (reader) void reader.cancel().catch(() => {});
  }
}

export function shouldRemindUpdate(release, storage = globalThis.localStorage, now = Date.now()) {
  try {
    const value = JSON.parse(storage?.getItem("dengta.app-update.snooze") || "null");
    return value?.build !== release.version_code || !Number.isFinite(value.at) || now < value.at || now - value.at >= UPDATE_REMIND_MS;
  } catch { return true; }
}

export function snoozeUpdate(release, storage = globalThis.localStorage, now = Date.now()) {
  try { storage?.setItem("dengta.app-update.snooze", JSON.stringify({ build: release.version_code, at: now })); } catch { /* The in-memory close still works when storage is blocked. */ }
}
