export const COAST_VIDEO_SCENES = Object.freeze({
  day: { video: "/assets/coast-video/coast-day.mp4", poster: "/assets/coast-video/coast-day.webp" },
  twilight: { video: "/assets/coast-video/coast-twilight.mp4", poster: "/assets/coast-video/coast-twilight.webp" },
  night: { video: "/assets/coast-video/coast-night.mp4", poster: "/assets/coast-video/coast-night.webp" },
});

export function coastSceneForSky(sky) {
  const minute = Number(sky?.solarMinute);
  if (!Number.isFinite(minute)) return "day";
  if (minute < 380 || minute >= 1210) return "night";
  if (minute < 530 || minute >= 1000) return "twilight";
  return "day";
}

export function coastPlaybackAllowed({ hidden = false, reducedMotion = false, saveData = false, lowBattery = false, customBackground = false, settingsOpen = false } = {}) {
  return !hidden && !reducedMotion && !saveData && !lowBattery && !customBackground && !settingsOpen;
}

// Only the visible decorative layer owns this decoder. The caller supplies the
// application gates; source changes dispose the previous owner before reusing it.
export function createCoastVideoLifecycle(video, {
  source,
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  navigatorObject = globalThis.navigator,
  applicationRoot = null,
  reducedMotion = false,
  onState = () => {},
  MutationObserverClass = globalThis.MutationObserver,
} = {}) {
  const media = windowObject?.matchMedia?.("(prefers-reduced-motion: reduce)");
  const connection = navigatorObject?.connection;
  const cleanups = [];
  let disposed = false;
  let failed = false;
  let battery = null;
  let pendingPlay = false;
  let playing = false;
  let generation = 0;
  let pageHidden = false;

  const listen = (target, name, listener) => {
    target?.addEventListener?.(name, listener);
    cleanups.push(() => target?.removeEventListener?.(name, listener));
  };
  const state = () => ({
    hidden: documentObject?.hidden || pageHidden,
    reducedMotion: reducedMotion || media?.matches || documentObject?.documentElement?.dataset?.dengtaReducedMotion === "true",
    saveData: connection?.saveData === true,
    lowBattery: Boolean(battery && !battery.charging && battery.level <= 0.2),
    customBackground: Boolean(applicationRoot?.querySelector?.(".private-chat-background")),
    settingsOpen: applicationRoot?.classList?.contains("is-settings-open") === true,
  });
  const stop = (release = false) => {
    generation++;
    pendingPlay = false;
    playing = false;
    video.pause();
    if (release && video.getAttribute("src")) {
      video.removeAttribute("src");
      video.load();
    }
  };
  const synchronize = () => {
    if (disposed) return;
    const gates = state();
    if (failed || !coastPlaybackAllowed(gates)) {
      stop(gates.reducedMotion || gates.saveData || gates.lowBattery || gates.customBackground);
      onState(failed ? "error" : "static");
      return;
    }
    if (pendingPlay || playing) return;
    if (video.getAttribute("src") !== source) {
      video.setAttribute("src", source);
      video.load();
    }
    video.muted = true;
    video.defaultMuted = true;
    pendingPlay = true;
    const ticket = ++generation;
    onState("loading");
    Promise.resolve().then(() => {
      if (disposed || ticket !== generation) return;
      return video.play();
    }).catch(() => {
      if (disposed || ticket !== generation) return;
      failed = true;
      stop(true);
      onState("error");
    });
  };
  listen(video, "playing", () => {
    if (disposed || failed || !coastPlaybackAllowed(state())) return;
    pendingPlay = false;
    playing = true;
    onState("playing");
  });
  listen(video, "error", () => {
    if (disposed || !video.getAttribute("src")) return;
    failed = true;
    stop(true);
    onState("error");
  });
  listen(documentObject, "visibilitychange", synchronize);
  listen(media, "change", synchronize);
  listen(connection, "change", synchronize);
  listen(windowObject, "pagehide", () => { pageHidden = true; synchronize(); });
  listen(windowObject, "pageshow", () => { pageHidden = false; synchronize(); });

  const observe = (target, options, callback) => {
    if (!target || typeof MutationObserverClass !== "function") return;
    const observer = new MutationObserverClass(callback);
    observer.observe(target, options);
    cleanups.push(() => observer.disconnect());
  };
  observe(documentObject?.documentElement, { attributes: true, attributeFilter: ["data-dengta-reduced-motion"] }, synchronize);
  observe(applicationRoot, { attributes: true, childList: true, subtree: true, attributeFilter: ["class"] }, records => {
    const relevant = records.some(record =>
      record.target === applicationRoot ||
      record.target?.classList?.contains("private-chat-background") ||
      [...(record.addedNodes || []), ...(record.removedNodes || [])].some(node =>
        node.classList?.contains("private-chat-background") || node.querySelector?.(".private-chat-background"),
      ),
    );
    if (relevant) synchronize();
  });
  if (typeof navigatorObject?.getBattery === "function") {
    Promise.resolve().then(() => navigatorObject.getBattery()).then(value => {
      if (disposed) return;
      battery = value;
      listen(battery, "chargingchange", synchronize);
      listen(battery, "levelchange", synchronize);
      synchronize();
    }).catch(() => {});
  }
  synchronize();
  return {
    synchronize,
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanups.forEach(cleanup => cleanup());
      stop(true);
    },
  };
}
