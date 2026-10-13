import { captureChatScrollState, restoreChatScrollState } from "./chat-scroll-state.js";

// One controller per mounted conversation. Layout changes never count as a user scroll.
export function createChatScrollController(list, followRef, runtime = window) {
  let frame = 0;
  let idleTimer = 0;
  let lastTop = list.scrollTop;
  let touchY = null;
  let mouseDown = false;
  let leavingBottom = false;
  let disposed = false;
  const listeners = [];
  const listen = (target, name, callback) => {
    target.addEventListener(name, callback, { passive: true });
    listeners.push(() => target.removeEventListener(name, callback));
  };
  function sync() {
    if (disposed || !followRef.current) return;
    leavingBottom = false;
    restoreChatScrollState(list, { pinnedToBottom: true });
    lastTop = list.scrollTop;
  }
  function schedule() {
    if (disposed || frame || !followRef.current) return;
    frame = runtime.requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  }
  function open() {
    followRef.current = true;
    sync();
    schedule();
  }
  function readHistory() {
    leavingBottom = true;
    followRef.current = false;
  }
  listen(list, "wheel", (event) => {
    if (event.deltaY < 0) readHistory();
    else if (event.deltaY > 0) leavingBottom = false;
  });
  listen(list, "touchstart", (event) => { touchY = event.touches[0]?.clientY ?? null; });
  listen(list, "touchmove", (event) => {
    const next = event.touches[0]?.clientY ?? null;
    if (next !== null && touchY !== null && next > touchY) readHistory();
    else if (next !== null && touchY !== null && next < touchY) leavingBottom = false;
    touchY = next;
  });
  listen(list, "pointerdown", (event) => { mouseDown = event.pointerType === "mouse"; });
  listen(runtime, "pointerup", () => { mouseDown = false; });
  listen(runtime, "pointercancel", () => { mouseDown = false; });
  listen(list, "keydown", (event) => {
    if (event.target?.closest?.("input, textarea, select, [contenteditable=true]")) return;
    if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) {
      readHistory();
    }
  });
  listen(list, "scroll", () => {
    if (mouseDown && list.scrollTop < lastTop) readHistory();
    const atBottom = captureChatScrollState(list, 2)?.pinnedToBottom;
    if (!atBottom) leavingBottom = false;
    else if (!leavingBottom) followRef.current = true;
    lastTop = list.scrollTop;
    list.classList.add("is-scrolling");
    runtime.clearTimeout(idleTimer);
    idleTimer = runtime.setTimeout(() => list.classList.remove("is-scrolling"), 140);
  });
  const observer = runtime.ResizeObserver ? new runtime.ResizeObserver(schedule) : null;
  observer?.observe(list);
  if (list.firstElementChild) observer?.observe(list.firstElementChild);
  open();
  return {
    open,
    sync,
    dispose() {
      disposed = true;
      observer?.disconnect();
      listeners.forEach((remove) => remove());
      runtime.cancelAnimationFrame(frame);
      runtime.clearTimeout(idleTimer);
      list.classList.remove("is-scrolling");
    },
  };
}
