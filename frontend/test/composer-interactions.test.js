import assert from "node:assert/strict";
import fs from "node:fs";
import {
  resolveComposerSendActivation,
  shouldHandleComposerPointerDown,
  shouldSubmitComposerKeyDown,
  transitionComposerOverlays,
} from "../src/composer-interactions.js";

const appSource = fs.readFileSync(
  new URL("../src/App.jsx", import.meta.url),
  "utf8",
);

function simulateCurrentAndroidSendTap() {
  const sendButton = appSource.match(
    /<button\s+className="send-button"[\s\S]*?<\/button>/,
  )?.[0];
  assert.ok(sendButton, "the chat send button must remain present");
  assert.match(sendButton, /handleSendActivation\("pointerdown", event\)/);
  assert.match(sendButton, /handleSendActivation\("click", event\)/);
  let requestInFlight = false;
  let submissions = 0;
  let aborts = 0;
  let pointerDownHandled = false;
  const dispatch = () => {
    if (requestInFlight) {
      requestInFlight = false;
      aborts += 1;
      return;
    }
    requestInFlight = true;
    submissions += 1;
  };

  for (const [action, event] of [
    [
      "pointerdown",
      { pointerType: "touch", isPrimary: true, button: 0, detail: 0 },
    ],
    ["click", { nativeEvent: { pointerType: "touch", detail: 1 } }],
  ]) {
    const activation = resolveComposerSendActivation(
      action,
      event,
      pointerDownHandled,
    );
    pointerDownHandled = activation.pointerDownHandled;
    if (activation.dispatch) dispatch();
  }
  return { aborts, requestInFlight, submissions };
}

assert.equal(
  shouldSubmitComposerKeyDown({ key: "Enter", shiftKey: false }),
  true,
  "plain Enter submits the composer",
);
assert.equal(
  shouldSubmitComposerKeyDown({ key: "Enter", shiftKey: true }),
  false,
  "Shift+Enter inserts a line break",
);
assert.equal(
  shouldSubmitComposerKeyDown({
    key: "Enter",
    isComposing: true,
    nativeEvent: { isComposing: true },
  }),
  false,
  "Enter must not submit while an IME composition is active",
);
assert.equal(
  shouldSubmitComposerKeyDown({
    key: "Enter",
    nativeEvent: { isComposing: true },
  }),
  false,
  "the native IME state alone must also block submission",
);
assert.equal(
  shouldSubmitComposerKeyDown({
    key: "Enter",
    keyCode: 229,
    nativeEvent: { keyCode: 229 },
  }),
  false,
  "legacy Android IME Enter events must not submit",
);

assert.equal(
  shouldHandleComposerPointerDown({ pointerType: "touch", isPrimary: true, button: 0 }),
  true,
  "Android touch must act before keyboard focus can collapse the viewport",
);
assert.equal(
  shouldHandleComposerPointerDown({ pointerType: "pen", isPrimary: true, button: 0 }),
  true,
  "a primary pen tap follows the same direct composer action path",
);
assert.equal(
  shouldHandleComposerPointerDown({ pointerType: "mouse", isPrimary: true, button: 0 }),
  false,
  "mouse clicks must keep the normal click activation path",
);
assert.equal(
  shouldHandleComposerPointerDown({ pointerType: "touch", isPrimary: false, button: 0 }),
  false,
  "secondary touches must not dispatch composer actions",
);

assert.deepEqual(
  simulateCurrentAndroidSendTap(),
  { aborts: 0, requestInFlight: true, submissions: 1 },
  "one ordinary Android tap must start exactly one request and must not immediately abort it",
);
assert.deepEqual(
  resolveComposerSendActivation(
    "click",
    { detail: 0, nativeEvent: { detail: 0 } },
    true,
  ),
  { dispatch: true, pointerDownHandled: false },
  "a keyboard or assistive click must not be swallowed by stale touch state",
);
assert.deepEqual(
  resolveComposerSendActivation("pointercancel", {}, true),
  { dispatch: false, pointerDownHandled: false },
  "a cancelled pointer must clear touch deduplication state",
);

assert.deepEqual(
  transitionComposerOverlays(
    { statusExpanded: true, composerMenuOpen: false },
    "open-composer-menu",
  ),
  { statusExpanded: false, composerMenuOpen: true },
);
assert.deepEqual(
  transitionComposerOverlays(
    { statusExpanded: false, composerMenuOpen: true },
    "open-status",
  ),
  { statusExpanded: true, composerMenuOpen: false },
);
assert.deepEqual(
  transitionComposerOverlays(
    { statusExpanded: true, composerMenuOpen: true },
    "focus-input",
  ),
  { statusExpanded: false, composerMenuOpen: false },
);

console.log("composer interaction tests passed");
