import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createChatDrafts } from "./chat-draft.js";

export function useChatDraft(account, companion, session) {
  const drafts = useMemo(() => createChatDrafts(account, companion), [account, companion]);
  const store = drafts.get(session);
  const value = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") store.flush(); };
    window.addEventListener("pagehide", store.flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      store.flush();
      window.removeEventListener("pagehide", store.flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [store]);
  return [value, store.set, drafts.setSession, drafts.move];
}
