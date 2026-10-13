export function isPetDockObscured() {
  if (typeof document === 'undefined') return false;
  if (document.documentElement.dataset.keyboardOpen === 'true') return true;
  const active = document.activeElement;
  return Boolean(globalThis.matchMedia?.('(max-width: 820px)').matches &&
    (active?.matches?.('input, textarea, select') || active?.isContentEditable));
}

export function subscribePetDockEnvironment(listener) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-keyboard-open'] });
  document.addEventListener('focusin', listener);
  document.addEventListener('focusout', listener);
  window.addEventListener('resize', listener);
  return () => {
    observer.disconnect();
    document.removeEventListener('focusin', listener);
    document.removeEventListener('focusout', listener);
    window.removeEventListener('resize', listener);
  };
}

export function readPetDockEnabled(storage, key) {
  try { return Boolean(key && storage?.getItem(`${key}:dock`) === 'true'); } catch { return false; }
}

export function savePetDockEnabled(storage, key, enabled) {
  try { if (key) storage?.setItem(`${key}:dock`, String(enabled === true)); } catch { /* Session toggle remains usable. */ }
}
