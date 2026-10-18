function editableElementIsFocused(documentObject) {
  const activeElement = documentObject.activeElement;
  return Boolean(
    activeElement &&
      typeof activeElement.matches === "function" &&
      (activeElement.matches("input, textarea, select") ||
        activeElement.isContentEditable),
  );
}

export function installVisualViewportController({ windowObject = globalThis.window, documentObject = globalThis.document } = {}) {
  const viewport = windowObject.visualViewport;
  if (!viewport) return installInnerHeightViewportFallback({ windowObject, documentObject });
  const root = documentObject.documentElement;
  let fullHeight = Math.max(windowObject.innerHeight, viewport.height + viewport.offsetTop);
  let viewportWidth = viewport.width || windowObject.innerWidth;
  let keyboardOpen = false, frame = null, disposed = false, lastHeight = "";
  function fitViewport() {
    frame = null;
    if (disposed || (viewport.scale && Math.abs(viewport.scale - 1) > .01)) return;
    if (!Number.isFinite(viewport.height) || viewport.height <= 0) return;
    const visibleBottom = viewport.height + viewport.offsetTop;
    const width = viewport.width || windowObject.innerWidth;
    if (Math.abs(width - viewportWidth) > 48) {
      viewportWidth = width; fullHeight = Math.max(windowObject.innerHeight, visibleBottom); keyboardOpen = false;
    }
    const focused = editableElementIsFocused(documentObject);
    const rawGap = Math.max(0, fullHeight - viewport.height);
    // Blur can arrive before the keyboard closes, including between two editable fields.
    keyboardOpen = (keyboardOpen && rawGap > 60) || (focused && rawGap > 100);
    if (!keyboardOpen) {
      if (!focused && Math.abs(windowObject.innerHeight - visibleBottom) < 3) fullHeight = visibleBottom;
      else if (rawGap <= 100) fullHeight = Math.max(fullHeight, visibleBottom, windowObject.innerHeight);
    }
    const state = keyboardOpen ? "true" : "false";
    if (root.dataset.keyboardOpen !== state) root.dataset.keyboardOpen = state;
    const height = `${Math.round(keyboardOpen ? viewport.height : fullHeight)}px`;
    if (height !== lastHeight) { lastHeight = height; root.style.setProperty("--app-height", height); }
    if (!keyboardOpen && !focused && windowObject.scrollY) windowObject.scrollTo(0, 0);
  }
  function schedule() {
    if (!disposed && frame === null) frame = windowObject.requestAnimationFrame(fitViewport);
  }
  fitViewport();
  viewport.addEventListener("resize", schedule); viewport.addEventListener("scroll", schedule);
  windowObject.addEventListener("resize", schedule); windowObject.addEventListener("orientationchange", schedule);
  documentObject.addEventListener("focusin", schedule); documentObject.addEventListener("focusout", schedule);
  return () => {
    disposed = true; if (frame !== null) windowObject.cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule); viewport.removeEventListener("scroll", schedule);
    windowObject.removeEventListener("resize", schedule); windowObject.removeEventListener("orientationchange", schedule);
    documentObject.removeEventListener("focusin", schedule); documentObject.removeEventListener("focusout", schedule);
    delete root.dataset.keyboardOpen;
  };
}

export function installInnerHeightViewportFallback({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
} = {}) {
  const root = documentObject.documentElement;
  let fullHeight = windowObject.innerHeight;
  let viewportWidth = windowObject.innerWidth;
  let keyboardOpen = false;
  let frame = null, disposed = false, lastHeight = "";

  function fitViewport() {
    frame = null;
    if (disposed) return;
    const nextHeight = windowObject.innerHeight;
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
    const nextViewportWidth = windowObject.innerWidth;
    if (Math.abs(nextViewportWidth - viewportWidth) > 48) {
      viewportWidth = nextViewportWidth;
      fullHeight = nextHeight;
    }

    const rawGap = Math.max(0, fullHeight - nextHeight);
    const focused = editableElementIsFocused(documentObject);
    keyboardOpen = (keyboardOpen && rawGap > 60) || (focused && rawGap > 100);

    if (!keyboardOpen) {
      if (!focused) fullHeight = nextHeight;
      else if (rawGap <= 100) fullHeight = Math.max(fullHeight, nextHeight);
    }

    const state = keyboardOpen ? "true" : "false";
    if (root.dataset.keyboardOpen !== state) root.dataset.keyboardOpen = state;
    const height = `${Math.round(keyboardOpen ? nextHeight : fullHeight)}px`;
    if (height !== lastHeight) { lastHeight = height; root.style.setProperty("--app-height", height); }
    if (!keyboardOpen && !focused && windowObject.scrollY) {
      windowObject.scrollTo(0, 0);
    }
  }

  function schedule() {
    if (disposed) return;
    if (typeof windowObject.requestAnimationFrame !== "function") { fitViewport(); return; }
    if (frame === null) frame = windowObject.requestAnimationFrame(fitViewport);
  }

  fitViewport();
  windowObject.addEventListener("resize", schedule);
  windowObject.addEventListener("orientationchange", schedule);
  documentObject.addEventListener("focusin", schedule);
  documentObject.addEventListener("focusout", schedule);

  return () => {
    disposed = true; if (frame !== null) windowObject.cancelAnimationFrame(frame);
    windowObject.removeEventListener("resize", schedule);
    windowObject.removeEventListener("orientationchange", schedule);
    documentObject.removeEventListener("focusin", schedule);
    documentObject.removeEventListener("focusout", schedule);
    delete root.dataset.keyboardOpen;
  };
}
