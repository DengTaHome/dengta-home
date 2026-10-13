import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function readPreference() {
  return globalThis.document?.documentElement?.dataset.dengtaReducedMotion === "true" ||
    globalThis.window?.matchMedia?.(QUERY)?.matches === true;
}

function subscribe(listener) {
  const root = globalThis.document?.documentElement;
  const media = globalThis.window?.matchMedia?.(QUERY);
  const observer = root && typeof MutationObserver === "function"
    ? new MutationObserver(listener)
    : null;
  observer?.observe(root, { attributes: true, attributeFilter: ["data-dengta-reduced-motion"] });
  media?.addEventListener?.("change", listener);
  return () => {
    observer?.disconnect();
    media?.removeEventListener?.("change", listener);
  };
}

export default function useReducedVisualMotion() {
  return useSyncExternalStore(subscribe, readPreference, () => false);
}
