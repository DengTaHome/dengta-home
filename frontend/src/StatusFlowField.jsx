import { useEffect, useRef } from "react";
import useReducedVisualMotion from "./use-reduced-visual-motion.js";

import { createStatusFluidEngine } from "./status-fluid-engine";

const FRAME_INTERVAL_MS = 1000 / 60;
const FLOW_LIFETIME_MS = 6800;
const PATH_SAMPLE_PIXELS = 9;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function hsvToRgb(hue, saturation, value) {
  const normalized = ((hue % 1) + 1) % 1;
  const sector = normalized * 6;
  const index = Math.floor(sector);
  const fraction = sector - index;
  const p = value * (1 - saturation);
  const q = value * (1 - fraction * saturation);
  const t = value * (1 - (1 - fraction) * saturation);
  const colors = [
    [value, t, p],
    [q, value, p],
    [p, value, t],
    [p, q, value],
    [t, p, value],
    [value, p, q],
  ];
  return colors[index % 6];
}

export default function StatusFlowField({ active }) {
  const canvasRef = useRef(null);
  const reduceMotion = useReducedVisualMotion();

  useEffect(() => {
    if (!active || reduceMotion) return undefined;
    const canvas = canvasRef.current;
    const panel = canvas?.closest(".sun-glass-floating-status-panel");
    const field = canvas?.parentElement;
    if (!canvas || !panel || !field) return undefined;

    let engine = null;
    const documentObject = globalThis.document;
    const windowObject = globalThis.window;
    const isHidden = () => documentObject?.hidden === true;
    let disposed = false;
    let resizePending = false;
    let contextLost = false;
    let restorePending = false;

    const pointerState = {
      active: false,
      pointerId: null,
      touchId: null,
      x: 0.5,
      y: 0.5,
      clientX: 0,
      clientY: 0,
      lastAt: performance.now(),
    };
    let animationFrame = 0;
    let rendererGeneration = 0;
    let activeUntil = 0;
    let lastFrameAt = performance.now();
    let lastPointerEventAt = -Infinity;
    let hueSeed = Math.random();

    const resetFeedback = () => {
      rendererGeneration++;
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      activeUntil = 0;
      pointerState.active = false;
      pointerState.pointerId = null;
      pointerState.touchId = null;
    };
    const releaseEngine = () => {
      const previous = engine;
      engine = null;
      previous?.dispose();
    };
    const showFallback = () => {
      resetFeedback();
      releaseEngine();
      field.classList.remove("status-flow-field--ready");
      field.classList.add("status-flow-field--fallback");
    };
    const runEngine = (operation) => {
      if (disposed || contextLost || !engine) return false;
      try {
        operation();
        return true;
      } catch {
        showFallback();
        return false;
      }
    };
    const initialize = () => {
      if (disposed) return;
      if (contextLost || isHidden()) {
        restorePending = true;
        return;
      }
      restorePending = false;
      resetFeedback();
      releaseEngine();
      try {
        engine = createStatusFluidEngine(canvas);
      } catch {
        engine = null;
      }
      if (!engine) {
        showFallback();
        return;
      }
      resizePending = false;
      field.classList.remove("status-flow-field--fallback");
      field.classList.add("status-flow-field--ready");
    };

    const localPoint = (clientX, clientY) => {
      const rect = panel.getBoundingClientRect();
      return {
        x: clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1),
        y: 1 - clamp((clientY - rect.top) / Math.max(rect.height, 1), 0, 1),
        clientX,
        clientY,
      };
    };

    const colorFor = (x, y, offset = 0) => {
      const color = hsvToRgb(
        hueSeed + x * 0.36 + y * 0.14 + offset * 0.043,
        0.97,
        1,
      );
      return color.map((channel) => channel * 0.72);
    };

    const draw = (now, generation) => {
      if (generation !== rendererGeneration) return;
      animationFrame = 0;
      if (disposed || isHidden() || !engine) return;
      const elapsed = clamp((now - lastFrameAt) / 1000, 1 / 240, 0.022);
      lastFrameAt = now;
      if (!runEngine(() => {
        engine.step(elapsed);
        engine.render();
        if (now >= activeUntil) {
          engine.clear();
          engine.render();
        }
      })) return;
      if (now < activeUntil) {
        queueDraw();
      }
    };

    const queueDraw = () => {
      const generation = rendererGeneration;
      animationFrame = requestAnimationFrame((now) => draw(now, generation));
    };

    const requestDraw = () => {
      if (disposed || isHidden() || !engine) return;
      activeUntil = performance.now() + FLOW_LIFETIME_MS;
      if (!animationFrame) {
        lastFrameAt = performance.now() - FRAME_INTERVAL_MS;
        queueDraw();
      }
    };

    const splatTap = (point) => {
      hueSeed = (hueSeed + 0.11) % 1;
      for (let index = 0; index < 3; index += 1) {
        const angle = index * ((Math.PI * 2) / 3) + hueSeed * Math.PI;
        engine.splat(
          point.x,
          point.y,
          Math.cos(angle) * 26,
          Math.sin(angle) * 26,
          colorFor(point.x, point.y, index),
          0.00032,
        );
      }
      requestDraw();
    };

    const splatPointerPath = (from, to, elapsedSeconds) => {
      const distancePixels = Math.hypot(
        to.clientX - from.clientX,
        to.clientY - from.clientY,
      );
      if (distancePixels < 1.25) return;
      const samples = clamp(Math.ceil(distancePixels / PATH_SAMPLE_PIXELS), 1, 24);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const speed = clamp(distancePixels / Math.max(elapsedSeconds, 1 / 240), 40, 2400);
      const force = 2850 + speed * 1.18;
      const radius = clamp(0.00025 + speed * 0.00000009, 0.00027, 0.00047);
      for (let index = 1; index <= samples; index += 1) {
        const progress = index / samples;
        const x = from.x + dx * progress;
        const y = from.y + dy * progress;
        engine.splat(
          x,
          y,
          dx * force,
          dy * force,
          colorFor(x, y, index + performance.now() * 0.00018),
          radius,
        );
      }
      requestDraw();
    };

    const startTrail = (clientX, clientY, now = performance.now()) => {
      if (disposed || isHidden() || !engine) return;
      const point = localPoint(clientX, clientY);
      pointerState.active = true;
      pointerState.x = point.x;
      pointerState.y = point.y;
      pointerState.clientX = clientX;
      pointerState.clientY = clientY;
      pointerState.lastAt = now;
      runEngine(() => splatTap(point));
    };

    const continueTrail = (clientX, clientY, now = performance.now()) => {
      if (!pointerState.active || disposed || isHidden() || !engine) return;
      const next = localPoint(clientX, clientY);
      const previous = {
        x: pointerState.x,
        y: pointerState.y,
        clientX: pointerState.clientX,
        clientY: pointerState.clientY,
      };
      const elapsed = clamp((now - pointerState.lastAt) / 1000, 1 / 240, 0.08);
      if (!runEngine(() => splatPointerPath(previous, next, elapsed))) return;
      pointerState.x = next.x;
      pointerState.y = next.y;
      pointerState.clientX = clientX;
      pointerState.clientY = clientY;
      pointerState.lastAt = now;
    };

    const stopTrail = () => {
      pointerState.active = false;
      pointerState.pointerId = null;
      pointerState.touchId = null;
      activeUntil = Math.max(activeUntil, performance.now() + 4300);
    };

    const startPointerFlow = (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      lastPointerEventAt = performance.now();
      pointerState.pointerId = event.pointerId;
      startTrail(event.clientX, event.clientY, lastPointerEventAt);
    };

    const movePointerFlow = (event) => {
      if (!pointerState.active || pointerState.pointerId !== event.pointerId) return;
      lastPointerEventAt = performance.now();
      continueTrail(event.clientX, event.clientY, lastPointerEventAt);
    };

    const stopPointerFlow = (event) => {
      if (pointerState.pointerId !== event.pointerId) return;
      lastPointerEventAt = performance.now();
      stopTrail();
    };

    const startTouchFlow = (event) => {
      if (performance.now() - lastPointerEventAt < 600) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      pointerState.touchId = touch.identifier;
      startTrail(touch.clientX, touch.clientY);
    };

    const moveTouchFlow = (event) => {
      if (performance.now() - lastPointerEventAt < 600) return;
      const touch = [...event.changedTouches].find(
        (candidate) => candidate.identifier === pointerState.touchId,
      );
      if (!touch) return;
      continueTrail(touch.clientX, touch.clientY);
    };

    const stopTouchFlow = (event) => {
      if (performance.now() - lastPointerEventAt < 600) return;
      const ended = [...event.changedTouches].some(
        (touch) => touch.identifier === pointerState.touchId,
      );
      if (ended) stopTrail();
    };

    const resize = () => {
      if (disposed) return;
      if (isHidden()) {
        resizePending = true;
        return;
      }
      if (runEngine(() => {
        engine.resize();
        engine.render();
      })) resizePending = false;
    };
    const handleVisibility = () => {
      resetFeedback();
      if (disposed || isHidden()) return;
      if (restorePending) {
        initialize();
        return;
      }
      if (runEngine(() => {
        if (resizePending) engine.resize();
        engine.clear();
        engine.render();
      })) resizePending = false;
    };
    const handleContextLost = (event) => {
      event.preventDefault();
      contextLost = true;
      showFallback();
    };
    const handleContextRestored = () => {
      contextLost = false;
      initialize();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(panel);
    panel.addEventListener("pointerdown", startPointerFlow);
    panel.addEventListener("pointermove", movePointerFlow);
    panel.addEventListener("pointerup", stopPointerFlow);
    panel.addEventListener("pointercancel", stopPointerFlow);
    panel.addEventListener("touchstart", startTouchFlow, { passive: true });
    panel.addEventListener("touchmove", moveTouchFlow, { passive: true });
    panel.addEventListener("touchend", stopTouchFlow, { passive: true });
    panel.addEventListener("touchcancel", stopTouchFlow, { passive: true });
    windowObject?.addEventListener?.("pointerup", stopPointerFlow);
    windowObject?.addEventListener?.("pointercancel", stopPointerFlow);
    windowObject?.addEventListener?.("touchend", stopTouchFlow, { passive: true });
    windowObject?.addEventListener?.("touchcancel", stopTouchFlow, { passive: true });
    windowObject?.addEventListener?.("blur", stopTrail);
    documentObject?.addEventListener?.("visibilitychange", handleVisibility);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    initialize();

    return () => {
      disposed = true;
      resetFeedback();
      resizeObserver.disconnect();
      panel.removeEventListener("pointerdown", startPointerFlow);
      panel.removeEventListener("pointermove", movePointerFlow);
      panel.removeEventListener("pointerup", stopPointerFlow);
      panel.removeEventListener("pointercancel", stopPointerFlow);
      panel.removeEventListener("touchstart", startTouchFlow);
      panel.removeEventListener("touchmove", moveTouchFlow);
      panel.removeEventListener("touchend", stopTouchFlow);
      panel.removeEventListener("touchcancel", stopTouchFlow);
      windowObject?.removeEventListener?.("pointerup", stopPointerFlow);
      windowObject?.removeEventListener?.("pointercancel", stopPointerFlow);
      windowObject?.removeEventListener?.("touchend", stopTouchFlow);
      windowObject?.removeEventListener?.("touchcancel", stopTouchFlow);
      windowObject?.removeEventListener?.("blur", stopTrail);
      documentObject?.removeEventListener?.("visibilitychange", handleVisibility);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      field.classList.remove("status-flow-field--ready");
      field.classList.remove("status-flow-field--fallback");
      releaseEngine();
    };
  }, [active, reduceMotion]);

  return (
    <div className="status-flow-field" aria-hidden="true">
      <canvas ref={canvasRef} className="status-flow-canvas" />
    </div>
  );
}
