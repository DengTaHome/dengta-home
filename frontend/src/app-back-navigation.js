export function createBackLayerRegistry() {
  const layers = new Map();
  const listeners = new Set();
  let sequence = 0;
  return {
    register(close, priority = 0) {
      const key = ++sequence;
      layers.set(key, { close, priority, sequence: key });
      listeners.forEach(listener => listener());
      return () => { layers.delete(key); listeners.forEach(listener => listener()); };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    closeTop() {
      const top = [...layers.values()].sort((a, b) => b.priority - a.priority || b.sequence - a.sequence)[0];
      if (!top) return false;
      top.close();
      return true;
    },
  };
}

export const appBackLayers = createBackLayerRegistry();

export function createAppBackController({ dismissKeyboard, closeLayer, goBack, showExitHint, exit, now = Date.now, exitWindowMs = 2_000 }) {
  let exitArmedAt = null;
  let busy = false;
  let disposed = false;
  let revision = 0;
  return {
    reset() { exitArmedAt = null; revision += 1; },
    dispose() { disposed = true; revision += 1; },
    async back() {
      if (busy || disposed) return;
      busy = true;
      const currentRevision = revision;
      try {
        const hidden = await dismissKeyboard();
        if (disposed || revision !== currentRevision) return;
        if (hidden || closeLayer() || goBack()) { exitArmedAt = null; return; }
        const timestamp = now();
        if (exitArmedAt !== null && timestamp - exitArmedAt >= 0 && timestamp - exitArmedAt < exitWindowMs) {
          exitArmedAt = null;
          await exit();
        } else {
          exitArmedAt = timestamp;
          showExitHint();
        }
      } finally { busy = false; }
    },
  };
}
