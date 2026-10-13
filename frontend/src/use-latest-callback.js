import { useCallback, useLayoutEffect, useRef } from "react";

export function useLatestCallback(callback) {
  const committed = useRef(callback);
  useLayoutEffect(() => { committed.current = callback; }, [callback]);
  const stable = useCallback((...args) => committed.current?.(...args), []);
  return typeof callback === "function" ? stable : undefined;
}
