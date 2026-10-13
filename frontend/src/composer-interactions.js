export function shouldSubmitComposerKeyDown(event = {}) {
  const nativeEvent = event.nativeEvent || {};
  return (
    event.key === "Enter" &&
    event.shiftKey !== true &&
    event.isComposing !== true &&
    nativeEvent.isComposing !== true &&
    event.keyCode !== 229 &&
    nativeEvent.keyCode !== 229
  );
}

export function shouldHandleComposerPointerDown(event = {}) {
  return (
    event.isPrimary !== false &&
    (event.pointerType === "touch" || event.pointerType === "pen") &&
    (event.button === undefined || event.button === 0)
  );
}

export function resolveComposerSendActivation(
  action,
  event = {},
  pointerDownHandled = false,
) {
  if (action === "pointerdown") {
    const handled = shouldHandleComposerPointerDown(event);
    return { dispatch: handled, pointerDownHandled: handled };
  }

  if (action === "pointercancel") {
    return { dispatch: false, pointerDownHandled: false };
  }

  if (action === "click") {
    const nativeEvent = event.nativeEvent || {};
    const pointerType = event.pointerType || nativeEvent.pointerType || "";
    const detail = Number(event.detail ?? nativeEvent.detail ?? 0);
    const followsPointer =
      pointerType === "touch" || pointerType === "pen" || detail > 0;
    return {
      dispatch: !(pointerDownHandled && followsPointer),
      pointerDownHandled: false,
    };
  }

  return { dispatch: false, pointerDownHandled };
}

export function transitionComposerOverlays(
  { statusExpanded = false, composerMenuOpen = false } = {},
  action,
) {
  switch (action) {
    case "open-composer-menu":
      return { statusExpanded: false, composerMenuOpen: true };
    case "open-status":
      return { statusExpanded: true, composerMenuOpen: false };
    case "focus-input":
    case "navigate":
      return { statusExpanded: false, composerMenuOpen: false };
    case "close-composer-menu":
      return { statusExpanded, composerMenuOpen: false };
    case "close-status":
      return { statusExpanded: false, composerMenuOpen };
    default:
      return { statusExpanded, composerMenuOpen };
  }
}
