import { useLayoutEffect, useRef } from "react";

export function useSettingsCategoryNavigation({ isOpen, category, scopeKey, scrollRef, focusTarget, onSelect }) {
  const current = useRef(null);
  const previous = useRef(null);
  const homeReturn = useRef(null);

  useLayoutEffect(() => {
    current.current = { isOpen, category, scopeKey };
    const last = previous.current;
    previous.current = { isOpen, category, scopeKey };
    if (!isOpen || last?.scopeKey !== scopeKey) homeReturn.current = null;
    if (!isOpen || (last?.isOpen && last.category === category && last.scopeKey === scopeKey)) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const destination = !category && homeReturn.current?.scopeKey === scopeKey ? homeReturn.current : null;
    const top = destination?.top || 0;
    if (scroll.scrollTo) scroll.scrollTo({ top, behavior: "instant" });
    else scroll.scrollTop = top;
    if (!focusTarget) {
      if (category) scroll.querySelector(".settings-category-back")?.focus({ preventScroll: true });
      else if (destination?.target?.isConnected) destination.target.focus({ preventScroll: true });
    }
  }, [isOpen, category, scopeKey, scrollRef, focusTarget]);

  useLayoutEffect(() => () => { current.current = null; homeReturn.current = null; }, []);

  function selectCategory(id, target) {
    const live = current.current;
    if (!live?.isOpen || live.scopeKey !== scopeKey || live.category) return;
    homeReturn.current = { scopeKey, top: scrollRef.current?.scrollTop || 0, target };
    current.current = { ...live, category: id };
    onSelect(id);
  }

  function returnHome() {
    const live = current.current;
    if (!live?.isOpen || live.scopeKey !== scopeKey || !live.category) return;
    current.current = { ...live, category: null };
    onSelect(null);
  }

  return { selectCategory, returnHome };
}
