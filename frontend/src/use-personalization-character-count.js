import { useEffect, useMemo, useState } from "react";
import { countPersonalizationCharacters, countPersonalizationCharactersCooperatively } from "./personalization-editor.js";

const BACKGROUND_COUNT_THRESHOLD = 20000;
const BACKGROUND_COUNT_DELAY_MS = 150;

export default function usePersonalizationCharacterCount(value) {
  const [receipt, setReceipt] = useState({ value: null, count: null });
  const immediateCount = useMemo(() => value.length <= BACKGROUND_COUNT_THRESHOLD ? countPersonalizationCharacters(value) : null, [value]);

  useEffect(() => {
    if (value.length <= BACKGROUND_COUNT_THRESHOLD) return;
    let cancelled = false, worker, fallbackStarted = false;
    const finish = (count) => {
      if (!cancelled && count !== null) setReceipt({ value, count });
    };
    const fallback = () => {
      if (cancelled || fallbackStarted) return;
      fallbackStarted = true;
      worker?.terminate();
      void countPersonalizationCharactersCooperatively(value, () => cancelled).then(finish);
    };
    const timer = setTimeout(() => {
      if (cancelled) return;
      try {
        worker = new Worker(new URL("./personalization-character-count.worker.js", import.meta.url), { type: "module" });
        worker.onmessage = (event) => {
          const count = event.data?.count;
          if (!Number.isInteger(count) || count < 0) { fallback(); return; }
          finish(count);
          worker.terminate();
        };
        worker.onerror = fallback;
        worker.postMessage(value);
      } catch {
        fallback();
      }
    }, BACKGROUND_COUNT_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); worker?.terminate(); };
  }, [value]);

  return immediateCount ?? (receipt.value === value ? receipt.count : null);
}
