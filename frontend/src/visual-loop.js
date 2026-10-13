// Decorative canvases yield their frame budget to interaction and stop when hidden.
export function createVisualLoop(draw, { windowObject = window, documentObject = document, animated = true, reducedMotion = false, interval = 33 } = {}) {
  const media = windowObject.matchMedia?.("(prefers-reduced-motion: reduce)");
  let disposed = false, frame = null, timer = null;
  const cancel = () => {
    if (frame !== null) windowObject.cancelAnimationFrame(frame);
    if (timer !== null) windowObject.clearTimeout(timer);
    frame = timer = null;
  };
  const paint = now => {
    frame = null;
    if (disposed || documentObject.hidden) return;
    draw(reducedMotion || media?.matches ? 0 : now);
    if (animated && !reducedMotion && !media?.matches) {
      timer = windowObject.setTimeout(() => {
        timer = null;
        if (!disposed && !documentObject.hidden) frame = windowObject.requestAnimationFrame(paint);
      }, typeof interval === "function" ? interval() : interval);
    }
  };
  const invalidate = () => {
    cancel();
    if (!disposed && !documentObject.hidden) frame = windowObject.requestAnimationFrame(paint);
  };
  documentObject.addEventListener("visibilitychange", invalidate);
  media?.addEventListener?.("change", invalidate);
  invalidate();
  return {
    invalidate,
    dispose() { disposed = true; cancel(); documentObject.removeEventListener("visibilitychange", invalidate); media?.removeEventListener?.("change", invalidate); },
  };
}
