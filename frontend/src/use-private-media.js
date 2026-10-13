import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { API_BASE_URL, apiFetch } from "./api";
import { privateMediaRequestPath } from "./private-media";
import { authSession } from "./auth-session.js";

export function usePrivateMediaSource(source, { enabled = true, scopeKey = "" } = {}) {
  const value = String(source || "").trim();
  const requestPath = privateMediaRequestPath(value, API_BASE_URL);
  const snapshot = useSyncExternalStore(authSession.subscribe, authSession.getSnapshot, authSession.getSnapshot);
  const scope = JSON.stringify([snapshot?.user?.id || "", snapshot?.activeCompanionId || "", scopeKey]);
  const identity = useMemo(() => ({ source: value, scope, enabled }), [value, scope, enabled]);
  const [loaded, setLoaded] = useState({
    identity: null,
    url: "",
    error: "",
  });

  useEffect(() => {
    if (!requestPath || !enabled) return undefined;

    let active = true;
    let objectUrl = "";
    const controller = new AbortController();
    apiFetch(requestPath, { retry: false, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.message || "媒体暂时无法读取。");
        }
        const blob = await response.blob();
        if (!active) return;
        if (!blob.size) throw new Error("媒体内容为空。");
        objectUrl = URL.createObjectURL(blob);
        if (active) {
          setLoaded({ identity, url: objectUrl, error: "" });
        }
      })
      .catch((error) => {
        if (active) {
          setLoaded({
            identity,
            url: "",
            error: error?.message || "媒体暂时无法读取。",
          });
        }
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [requestPath, enabled, identity]);

  if (!requestPath) {
    return { url: value, loading: false, error: "" };
  }
  if (!enabled || loaded.identity !== identity) {
    return { url: "", loading: true, error: "" };
  }
  return {
    url: loaded.url,
    loading: false,
    error: loaded.error,
  };
}
