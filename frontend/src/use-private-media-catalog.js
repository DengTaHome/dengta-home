import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPrivateMediaCatalog } from "./private-media-api.js";
import { settingsServiceErrorDetail } from "./settings-service-errors.js";

export function usePrivateMediaCatalog(scope, disabled = false, loadCatalog = getPrivateMediaCatalog) {
  const identity = useMemo(() => ({ scope, disabled }), [scope, disabled]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const mounted = useRef(false);
  const revision = useRef(0);
  const [record, setRecord] = useState({ identity, catalog: null, loading: false, error: "" });
  const isCurrent = useCallback(() => mounted.current && currentIdentity.current === identity, [identity]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (disabled || !isCurrent()) return null;
    const request = ++revision.current;
    setRecord(previous => ({ identity, catalog: previous.identity === identity ? previous.catalog : null, loading: true, error: "" }));
    try {
      const catalog = await loadCatalog();
      if (!isCurrent() || revision.current !== request) return null;
      setRecord({ identity, catalog, loading: false, error: "" });
      return catalog;
    } catch (error) {
      if (!isCurrent() || revision.current !== request) return null;
      setRecord(previous => ({ ...previous, loading: false, error: settingsServiceErrorDetail(error, "私密媒体目录暂时无法读取，请点击刷新重试。") }));
      return null;
    }
  }, [disabled, identity, isCurrent, loadCatalog]);

  const updateCatalog = useCallback(value => {
    if (disabled || !isCurrent()) return;
    revision.current++;
    setRecord(previous => {
      if (!isCurrent()) return previous;
      const catalog = previous.identity === identity ? previous.catalog : null;
      return { identity, catalog: typeof value === "function" ? value(catalog) : value, loading: false, error: "" };
    });
  }, [disabled, identity, isCurrent]);

  useEffect(() => { void refresh(); }, [refresh]);

  const visible = record.identity === identity;
  return {
    catalog: visible ? record.catalog : null,
    loading: !disabled && (!visible || record.loading),
    error: visible ? record.error : "",
    refresh,
    updateCatalog,
  };
}
