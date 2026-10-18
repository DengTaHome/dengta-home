export const SURPRISE_MAP_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const SURPRISE_MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export function displayMapArea(area) {
  if (typeof area?.latitude !== "number" || !Number.isFinite(area.latitude) || Math.abs(area.latitude) > 90 ||
      typeof area.longitude !== "number" || !Number.isFinite(area.longitude) || Math.abs(area.longitude) > 180 ||
      typeof area.radius_m !== "number" || !Number.isFinite(area.radius_m) || area.radius_m < 1 || area.radius_m > 50000) return null;
  return { latitude: Math.max(-85.0511, Math.min(85.0511, area.latitude)), longitude: area.longitude, radius_m: area.radius_m };
}

// The tile provider receives a coarse viewing region, never the GPS receipt or a letter body.
export function coarseMapCenter(position) {
  if (typeof position?.latitude !== "number" || !Number.isFinite(position.latitude) || Math.abs(position.latitude) > 90 ||
      typeof position.longitude !== "number" || !Number.isFinite(position.longitude) || Math.abs(position.longitude) > 180) return null;
  return { latitude: Math.max(-85.0511, Math.min(85.0511, Math.round(position.latitude * 100) / 100)),
    longitude: Math.round(position.longitude * 100) / 100 };
}

const loadLibrary = async () => {
  const [library] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);
  return library.default || library;
};

export function mountSurpriseMap(container, { load = loadLibrary, onStatus = () => {}, onSelect = () => {},
  documentObject = globalThis.document, ResizeObserverClass = globalThis.ResizeObserver,
  IntersectionObserverClass = globalThis.IntersectionObserver } = {}) {
  let disposed = false, library, map, layer, markers, resizeObserver, intersectionObserver, timer;
  let state = { items: [], position: null, selectedId: null }, visible = true, tileErrors = 0, centered = false, lastFocus = "";
  const status = value => { if (!disposed) onStatus(value); };
  const stopTimer = () => { clearTimeout(timer); timer = null; };
  const startTimer = () => { stopTimer(); timer = setTimeout(() => status("timeout"), 18000); };
  function visibility() {
    if (!map || disposed) return;
    if (!visible || documentObject?.hidden) { stopTimer(); if (map.hasLayer(layer)) map.removeLayer(layer); }
    else if (!map.hasLayer(layer)) { status("loading"); layer.addTo(map); }
  }
  function draw() {
    if (!map || disposed) return;
    markers.clearLayers();
    const points = []; let focusedCircle;
    for (const item of state.items) {
      const area = displayMapArea(item?.area); if (!area) continue;
      const point = [area.latitude, area.longitude]; points.push(point);
      const circle = library.circle(point, { radius: area.radius_m, color: item.id === state.selectedId ? "#9a526f" : "#527e70",
        fillColor: item.id === state.selectedId ? "#cf86a4" : "#83b29f", fillOpacity: 0.22, weight: 2 });
      circle.on("click", () => { if (!disposed) onSelect(item.id); });
      circle.on("add", () => {
        const element = circle.getElement?.(); if (!element) return;
        element.setAttribute("role", "button"); element.setAttribute("tabindex", "0");
        element.setAttribute("aria-label", `查看信件范围：${String(item.title || "沿途来信")}`);
        element.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!disposed) onSelect(item.id); } });
      });
      circle.addTo(markers);
      if (item.id === state.selectedId) focusedCircle = circle;
    }
    const selected = state.items.find(item => item.id === state.selectedId);
    const focus = displayMapArea(selected?.area), coarse = coarseMapCenter(state.position);
    const focusKey = focus ? `letter:${selected.id}` : coarse ? `near:${coarse.latitude}:${coarse.longitude}` : "";
    if (focusKey && focusKey !== lastFocus) {
      if (focusedCircle) map.fitBounds(focusedCircle.getBounds(), { padding: [30, 30], maxZoom: 14, animate: false });
      else map.setView([coarse.latitude, coarse.longitude], 12, { animate: false });
      centered = true;
    } else if (!centered && points.length) { map.fitBounds(markers.getBounds(), { padding: [30, 30], maxZoom: 14, animate: false }); centered = true; }
    lastFocus = focusKey;
  }
  startTimer();
  const ready = Promise.resolve().then(load).then(value => {
    if (disposed || !container) return;
    library = value;
    map = library.map(container, { zoomControl: false, scrollWheelZoom: false, minZoom: 2, maxZoom: 16,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, worldCopyJump: true });
    map.setView([25, 105], 4, { animate: false });
    library.control.zoom({ zoomInTitle: "放大地图", zoomOutTitle: "缩小地图" }).addTo(map);
    map.attributionControl?.setPrefix(false);
    layer = library.tileLayer(SURPRISE_MAP_TILES, { attribution: SURPRISE_MAP_ATTRIBUTION,
      maxZoom: 16, updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 0, referrerPolicy: "strict-origin-when-cross-origin" });
    layer.on("loading", () => { tileErrors = 0; status("loading"); startTimer(); });
    layer.on("tileerror", () => { tileErrors++; status("unavailable"); });
    layer.on("load", () => { stopTimer(); status(tileErrors ? "unavailable" : "ready"); });
    markers = library.featureGroup().addTo(map);
    documentObject?.addEventListener("visibilitychange", visibility);
    if (ResizeObserverClass) { resizeObserver = new ResizeObserverClass(() => { if (!disposed) map.invalidateSize({ animate: false, pan: false }); }); resizeObserver.observe(container); }
    if (IntersectionObserverClass) { intersectionObserver = new IntersectionObserverClass(entries => { visible = entries.some(entry => entry.isIntersecting); visibility(); }); intersectionObserver.observe(container); }
    draw(); visibility();
  }).catch(() => { stopTimer(); status("failed"); });
  return {
    ready,
    update(next) { if (disposed) return; state = next; draw(); },
    fit() {
      if (!map || disposed) return;
      const points = state.items.map(item => displayMapArea(item?.area)).filter(Boolean).map(area => [area.latitude, area.longitude]);
      if (points.length) map.fitBounds(markers.getBounds(), { padding: [30, 30], maxZoom: 14, animate: false });
    },
    destroy() {
      if (disposed) return;
      disposed = true; stopTimer(); resizeObserver?.disconnect(); intersectionObserver?.disconnect();
      documentObject?.removeEventListener("visibilitychange", visibility);
      layer?.off(); markers?.clearLayers(); map?.remove();
    },
  };
}
