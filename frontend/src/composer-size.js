export function resizeComposerInput(input) {
  if (!input) return;
  const view = input.ownerDocument.defaultView;
  const style = view.getComputedStyle(input);
  const minimum = Number.parseFloat(style.minHeight) || 44;
  const maximum = Number.parseFloat(style.maxHeight) || 176;
  input.style.height = "0px";
  const contentHeight = input.scrollHeight;
  input.style.height = `${Math.min(maximum, Math.max(minimum, contentHeight))}px`;
  input.style.overflowY = contentHeight > maximum ? "auto" : "hidden";
}
