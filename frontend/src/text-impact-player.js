let activePlayback = null;
let requestVersion = 0;

function reducedMotion() {
  return globalThis.document?.documentElement?.dataset.dengtaReducedMotion === "true" ||
    globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

export function stopTextImpact() {
  requestVersion += 1;
  activePlayback?.();
}

export function measureTextImpactGlyphs(source, { width, height, maximum = 96 } = {}) {
  if (!source?.ownerDocument || !source.isConnected) return [];
  const doc = source.ownerDocument;
  const view = doc.defaultView;
  const walker = doc.createTreeWalker(source, 4);
  const range = doc.createRange();
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  const output = [];
  const limit = Math.min(96, Math.max(1, Math.trunc(Number(maximum)) || 96));
  function* codePoints(value) {
    let index = 0;
    for (const segment of value) { yield { segment, index }; index += segment.length; }
  }
  let node, measured = 0;
  try {
    while ((node = walker.nextNode()) && measured < 320 && output.length < limit) {
      const value = String(node.textContent || "");
      if (!value.trim()) continue;
      const style = view.getComputedStyle(node.parentElement || source);
      const segments = segmenter ? segmenter.segment(value) : codePoints(value);
      const box = source.getBoundingClientRect();
      const approximateStart = box.top < 0 && box.height > height
        ? Math.max(0, Math.floor(value.length * -box.top / box.height) - 40) : 0;
      for (const entry of segments) {
        if (entry.index < approximateStart || !entry.segment.trim()) continue;
        if (++measured > 320 || output.length >= limit) break;
        range.setStart(node, entry.index);
        range.setEnd(node, entry.index + entry.segment.length);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > height || rect.right < 0 || rect.left > width) continue;
        output.push({ text: entry.segment, x: rect.left, y: rect.top,
          width: rect.width, height: rect.height,
          font: `${style.fontStyle || "normal"} ${style.fontWeight || "400"} ${style.fontSize || "16px"} ${style.fontFamily || "sans-serif"}`,
          color: style.color || "#444" });
      }
    }
  } finally { range.detach?.(); }
  return output;
}

function visibleSource(source, scopeKey) {
  if (!source?.isConnected || !source.getClientRects().length) return false;
  const owner = source.closest?.("[data-text-impact-scope]");
  return Boolean(owner && owner.dataset.textImpactScope === scopeKey);
}

export async function playTextImpact(source, { mode = "scatter", target = "composer", scopeKey = "" } = {}) {
  stopTextImpact();
  const version = requestVersion;
  if (reducedMotion() || !visibleSource(source, scopeKey) || source.ownerDocument.visibilityState === "hidden") return { started: false, reason: "unavailable" };
  const { createTextImpactSimulation } = await import("./text-impact-physics.js");
  if (version !== requestVersion || reducedMotion() || !visibleSource(source, scopeKey) || source.ownerDocument.visibilityState === "hidden") return { started: false, reason: "cancelled" };
  const view = source.ownerDocument.defaultView;
  const viewport = view.visualViewport;
  const width = Math.min(view.innerWidth, viewport?.width || view.innerWidth);
  const height = Math.min(view.innerHeight, viewport?.height || view.innerHeight);
  const glyphs = measureTextImpactGlyphs(source, { width, height });
  if (!glyphs.length) return { started: false, reason: "empty" };
  const role = source.closest(".message-row")?.classList.contains("user") ? "assistant" : "user";
  const candidates = target === "avatar"
    ? [...source.ownerDocument.querySelectorAll(`.message-row.${role} .message-avatar`)].reverse()
    : [...source.ownerDocument.querySelectorAll(".composer textarea")];
  const destination = candidates.find(element => {
    const owner = element.closest?.("[data-text-impact-scope]");
    if (!owner || owner.dataset.textImpactScope !== scopeKey) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= height;
  });
  const rect = destination?.getBoundingClientRect();
  const bounds = { width, height };
  const targetRect = rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height, kind: target }
    : { x: width * 0.15, y: height - 72, width: width * 0.7, height: 36, kind: "composer" };
  const simulation = createTextImpactSimulation({ glyphs, mode, target: targetRect, bounds, seed: Date.now() % 2147483647 });
  const canvas = source.ownerDocument.createElement("canvas");
  const ratio = Math.min(view.devicePixelRatio || 1, 2);
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);
  canvas.className = "text-impact-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;pointer-events:none;z-index:70;`;
  const context = canvas.getContext("2d");
  if (!context) return { started: false, reason: "canvas_unavailable" };
  context.scale(ratio, ratio);
  source.ownerDocument.body.appendChild(canvas);
  source.classList.add("text-impact-source-playing");
  let frame = 0, lastTime = null, stopped = false, hitShown = false;
  const startedAt = view.performance.now();
  const media = view.matchMedia?.("(prefers-reduced-motion: reduce)");
  let observer;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    view.cancelAnimationFrame(frame);
    canvas.remove();
    source.classList.remove("text-impact-source-playing");
    destination?.classList?.remove("text-impact-target-hit");
    view.removeEventListener("resize", stop);
    view.removeEventListener("scroll", stop, true);
    viewport?.removeEventListener("resize", stop);
    viewport?.removeEventListener("scroll", stop);
    source.ownerDocument.removeEventListener("visibilitychange", stop);
    media?.removeEventListener?.("change", stop);
    observer?.disconnect();
    if (activePlayback === stop) activePlayback = null;
  };
  activePlayback = stop;
  view.addEventListener("resize", stop, { passive: true });
  view.addEventListener("scroll", stop, { passive: true, capture: true });
  viewport?.addEventListener("resize", stop, { passive: true });
  viewport?.addEventListener("scroll", stop, { passive: true });
  source.ownerDocument.addEventListener("visibilitychange", stop);
  media?.addEventListener?.("change", stop);
  if (typeof view.MutationObserver === "function") {
    observer = new view.MutationObserver(() => { if (reducedMotion()) stop(); });
    observer.observe(source.ownerDocument.documentElement, { attributes: true, attributeFilter: ["data-dengta-reduced-motion"] });
  }
  const render = now => {
    if (stopped) return;
    if (!visibleSource(source, scopeKey) || reducedMotion() || source.ownerDocument.visibilityState === "hidden" || now - startedAt > 5500) { stop(); return; }
    simulation.step(lastTime === null ? 0 : Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    if (!hitShown && simulation.particles.some(particle => particle.targetImpacts > 0)) {
      hitShown = true;
      destination?.classList?.add("text-impact-target-hit");
    }
    context.clearRect(0, 0, width, height);
    for (const particle of simulation.particles) {
      if (particle.alpha <= 0) continue;
      context.save();
      context.globalAlpha = particle.alpha;
      context.font = particle.font;
      context.fillStyle = particle.color;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.translate(particle.x + particle.width / 2, particle.y + particle.height / 2);
      context.rotate(particle.angle || 0);
      context.fillText(particle.text, 0, 0);
      context.restore();
    }
    canvas.dataset.particleCount = String(simulation.particles.length);
    canvas.dataset.motionPhase = simulation.elapsed < 0.45 ? "launch" : simulation.elapsed < 1.5 ? "fall" : "settle";
    if (simulation.done) { stop(); return; }
    frame = view.requestAnimationFrame(render);
  };
  frame = view.requestAnimationFrame(render);
  return { started: true, stop };
}
