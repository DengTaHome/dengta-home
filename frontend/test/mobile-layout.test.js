import assert from "node:assert/strict";
import fs from "node:fs";
import { loadEntrypointCssCascade } from "./helpers/effective-css.js";
import { installInnerHeightViewportFallback } from "../src/mobile-viewport.js";

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ type });
    }
  }
}

function createInnerHeightFallbackHarness() {
  const root = {
    dataset: {},
    style: {
      values: new Map(),
      setProperty(name, value) {
        this.values.set(name, value);
      },
    },
  };
  const windowObject = Object.assign(new FakeEventTarget(), {
    innerHeight: 844,
    innerWidth: 390,
    scrollY: 0,
    scrollTo() {},
  });
  const documentObject = Object.assign(new FakeEventTarget(), {
    activeElement: null,
    documentElement: root,
  });
  const textarea = {
    isContentEditable: false,
    matches(selector) {
      return selector === "input, textarea, select";
    },
  };

  return { documentObject, root, textarea, windowObject };
}

const mobileViewport = { width: 390, height: 844, reducedMotion: false };
const cssCascade = loadEntrypointCssCascade(
  new URL("../src/main.jsx", import.meta.url),
  mobileViewport,
);
const css = cssCascade.source;
for (const selector of [".message-content", ".message-row:not(.user) .message-content"]) {
  assert.equal(cssCascade.declarations(selector).animation?.value, "none", "restored chat text must not fade in again");
}
const narrowViewport = { width: 280, height: 653, reducedMotion: false };
const narrowCssCascade = loadEntrypointCssCascade(
  new URL("../src/main.jsx", import.meta.url),
  narrowViewport,
);
const shortLandscapeCascade = loadEntrypointCssCascade(
  new URL("../src/main.jsx", import.meta.url),
  { width: 844, height: 390, reducedMotion: false },
);
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const chatMessage = fs.readFileSync(
  new URL("../src/ChatMessage.jsx", import.meta.url),
  "utf8",
);
const status = fs.readFileSync(
  new URL("../src/CompanionStatus.jsx", import.meta.url),
  "utf8",
);
const ambientContextBadge = fs.readFileSync(
  new URL("../src/AmbientContextBadge.jsx", import.meta.url),
  "utf8",
);
const celestialBackdrop = fs.readFileSync(
  new URL("../src/CelestialBackdrop.jsx", import.meta.url),
  "utf8",
);
const androidManifest = fs.readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);

function sourceBetween(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return app.slice(start, end);
}

assert.deepEqual(
  cssCascade.stylesheets.map((stylesheet) => stylesheet.name),
  [
    "index.css",
    "cozy-theme.css",
    "auth.css",
    "native-feel.css",
    "apple-ui.css",
    "sun-glass-ui.css",
    "jelly-motion.css",
    "sun-glass-chat.css",
    "typography.css",
    "apple-high.css",
    "room-invite.css",
    "settings-media-polish.css",
    "interaction-polish.css",
    "interface-polish.css",
    "startup-recovery.css",
    "voice-composer.css",
    "login-experience.css",
  ],
  "layout tests must use the same stylesheet order as the application entrypoint",
);
assert.match(
  css,
  /html,\s*body,\s*#root\s*\{[^}]*min-width:\s*0;/s,
  "the app root must not force horizontal overflow on the 280px regression viewport",
);
assert.deepEqual(
  narrowCssCascade.stylesheets.map((stylesheet) => stylesheet.name),
  [
    "index.css",
    "cozy-theme.css",
    "auth.css",
    "native-feel.css",
    "apple-ui.css",
    "sun-glass-ui.css",
    "jelly-motion.css",
    "sun-glass-chat.css",
    "typography.css",
    "apple-high.css",
    "room-invite.css",
    "settings-media-polish.css",
    "interaction-polish.css",
    "interface-polish.css",
    "startup-recovery.css",
    "voice-composer.css",
    "login-experience.css",
  ],
  "the 280px regression must use the complete application stylesheet cascade",
);

const rootLayout = cssCascade.declarations(":root");
const mainPanelLayout = cssCascade.declarations(".main-panel");
const mobileEdgeNavigationLayout = cssCascade.declarations(
  ".mobile-edge-navigation",
);
const diaryTopbarLayout = cssCascade.declarations(".view-diary .topbar");
const chatContentLayout = cssCascade.declarations(".view-chat .view-content");
const expandedChatContentLayout = cssCascade.declarations(
  ".main-panel.view-chat:has(.companion-status.expanded) .view-content",
);
const messageListLayout = cssCascade.declarations(".message-list");
const messageColumnLayout = cssCascade.declarations(".message-column");
const messageBubbleLayout = cssCascade.declarations(".message-bubble");
const referencedMessageBubbleLayout = cssCascade.declarations(
  ".message-bubble:has(.message-reference-block)",
);
const thinkingMessageBubbleLayout = cssCascade.declarations(
  ".message-bubble:has(.thinking-panel)",
);
const composerLayout = cssCascade.declarations(".composer-wrap");
const expandedStatusLayout = cssCascade.declarations(
  ".companion-status.expanded",
);
const statusPanelLayout = cssCascade.declarations(".status-panel");
const presenceStackLayout = cssCascade.declarations(".chat-presence-stack");
const keyboardRootLayout = cssCascade.declarations(
  ':root[data-keyboard-open="true"]',
);
const keyboardNavLayout = cssCascade.declarations(
  ':root[data-keyboard-open="true"] .mobile-nav',
);
const keyboardPresenceLayout = cssCascade.declarations(
  ':root[data-keyboard-open="true"] .chat-presence-stack',
);
const narrowMainPanelLayout = narrowCssCascade.declarations(".main-panel");
const narrowViewContentLayout = narrowCssCascade.declarations(".view-content");
const narrowChatContentLayout = narrowCssCascade.declarations(
  ".view-chat .view-content",
);
const narrowMessageListLayout = narrowCssCascade.declarations(".message-list");
const narrowComposerLayout = narrowCssCascade.declarations(".composer-wrap");
const narrowComposerToolbarLayout =
  narrowCssCascade.declarations(".composer-toolbar");
const narrowStatusSummaryLayout =
  narrowCssCascade.declarations(".status-summary");

assert.equal(
  rootLayout["--mobile-nav-reserved-height"]?.value,
  "0px",
  "mobile pages must not reserve space for a bottom navigation bar",
);
assert.equal(
  mainPanelLayout["padding-bottom"]?.value,
  "0",
  "chat layout must use the pixels released by the old bottom bar",
);
assert.equal(mainPanelLayout.height?.value, "var(--app-height)");
assert.equal(
  mobileEdgeNavigationLayout.display?.value,
  "none",
  "mobile navigation must stay in the sidebar instead of a bottom bar",
);
assert.equal(
  diaryTopbarLayout.display?.value,
  "flex",
  "Diary must keep the top bar and its sidebar menu button visible",
);
assert.equal(
  composerLayout.padding?.value,
  "8px 10px max(8px, env(safe-area-inset-bottom))",
  "the compact composer must clear only the device safe area",
);
assert.equal(
  chatContentLayout.display?.value,
  "contents",
  "mobile message history and composer must participate directly in the main vertical layout",
);
assert.equal(chatContentLayout["min-height"]?.value, "0");
assert.equal(chatContentLayout.flex?.value, "1 1 0%");
assert.equal(
  messageListLayout["min-height"]?.value,
  "64px",
  "expanded panels must still leave a readable slice of chat history",
);
assert.equal(messageListLayout["overflow-y"]?.value, "auto");
assert.equal(
  messageListLayout.flex?.value,
  "1 1 0%",
  "message history must absorb the remaining chat height",
);
assert.equal(
  messageColumnLayout.width?.value,
  "100%",
  "message columns must keep a stable track instead of shrinking around short text",
);
assert.equal(
  messageBubbleLayout["min-width"]?.value,
  "min(176px, 100%)",
  "short messages such as QA-PING must retain a balanced bubble proportion",
);
assert.equal(
  referencedMessageBubbleLayout.width?.value,
  "100%",
  "a quoted reply must give its reference block the full message track",
);
assert.equal(
  thinkingMessageBubbleLayout.width?.value,
  "100%",
  "a streaming reasoning panel must not shrink before answer text arrives",
);
assert.equal(
  messageListLayout.padding?.value,
  "16px 12px 14px",
  "the 390px message scroller must include the Apple mobile spacing",
);
assert.equal(expandedStatusLayout.display?.value, "flex");
assert.equal(
  expandedStatusLayout.height?.value,
  "clamp(320px, 50vh, 500px)",
);
assert.equal(
  expandedStatusLayout["min-height"]?.value,
  "160px",
  "the expanded status must be allowed to yield space to recovery notices and the composer",
);
assert.equal(
  expandedStatusLayout["max-height"]?.value,
  "clamp(320px, 50vh, 500px)",
  "the expanded status may use half the viewport when enough space is available",
);
assert.equal(
  expandedStatusLayout.flex?.value,
  "1 1 clamp(320px, 50vh, 500px)",
  "the expanded status must shrink before the composer can overlap navigation",
);
assert.equal(expandedStatusLayout["flex-direction"]?.value, "column");
assert.equal(
  presenceStackLayout.flex?.value,
  "0 1 auto",
  "the presence stack must yield vertical space when a recovery notice is visible",
);
assert.equal(presenceStackLayout["min-height"]?.value, "0");
assert.equal(statusPanelLayout["min-height"]?.value, "0");
assert.equal(statusPanelLayout.flex?.value, "1 1 auto");
assert.equal(statusPanelLayout["overflow-y"]?.value, "auto");
assert.equal(
  statusPanelLayout["max-height"]?.value,
  "min(50vh, 500px)",
  "expanded status content must scroll inside its mobile boundary",
);
assert.equal(expandedChatContentLayout["min-height"]?.value, "0");
assert.equal(expandedChatContentLayout.flex?.value, "1 1 0%");
assert.equal(
  composerLayout.flex?.value,
  "0 0 auto",
  "the composer must keep its measured height when status or recovery UI grows",
);
assert.equal(
  presenceStackLayout.position?.value,
  "relative",
  "the status and weather stack must establish its own layer above chat history",
);
assert.ok(
  Number.parseInt(presenceStackLayout["z-index"]?.value || "0", 10) > 0,
  "the status and weather stack must not fall behind chat messages",
);
assert.equal(
  keyboardRootLayout["--mobile-nav-reserved-height"]?.value,
  "0px",
  "the keyboard must release the mobile navigation reservation",
);
assert.equal(
  keyboardNavLayout.display?.value,
  "none",
  "the keyboard must hide the fixed mobile navigation",
);
assert.equal(
  keyboardPresenceLayout.display?.value,
  "none",
  "the keyboard must visually hide, but not unmount, the presence stack",
);
assert.ok(
  Number.parseInt(composerLayout["z-index"]?.value || "0", 10) >
    Number.parseInt(presenceStackLayout["z-index"]?.value || "0", 10),
  "the add menu must render above the status and weather stack",
);
assert.equal(
  narrowMainPanelLayout["min-width"]?.value,
  "0",
  "the 280px chat panel must be allowed to shrink below legacy phone widths",
);
assert.equal(
  narrowViewContentLayout["min-width"]?.value,
  "0",
  "the 280px chat content must not force horizontal overflow",
);
assert.equal(
  narrowChatContentLayout.display?.value,
  "contents",
  "the 280px chat must keep the composer as a direct non-shrinking flex item",
);
assert.equal(
  narrowMessageListLayout["min-width"]?.value,
  "0",
  "the 280px message list must remain horizontally shrinkable",
);
assert.equal(
  narrowComposerLayout["min-width"]?.value,
  "0",
  "the 280px composer wrapper must remain horizontally shrinkable",
);
assert.equal(
  narrowComposerLayout["max-width"]?.value,
  "100%",
  "the 280px composer wrapper must stay within the viewport",
);
assert.equal(
  narrowComposerToolbarLayout["grid-template-columns"]?.value,
  "44px minmax(0, 1fr)",
  "legacy toolbar sizing must remain harmless underneath the compact composer grid",
);
assert.equal(
  narrowStatusSummaryLayout["grid-template-columns"]?.value,
  "auto minmax(0, 1fr) auto auto",
  "the 280px status summary must keep only its text column shrinkable",
);
const landscapeExpandedStatus = shortLandscapeCascade.declarations(
  ".companion-status.expanded",
);
assert.equal(
  shortLandscapeCascade.declarations(":root")[
    "--mobile-nav-reserved-height"
  ]?.value,
  "0px",
  "short landscape must also use sidebar-only navigation",
);
assert.equal(
  landscapeExpandedStatus.height?.value,
  "min(46vh, 180px)",
  "short landscape screens must use a useful overlay without consuming composer space",
);
assert.equal(
  landscapeExpandedStatus["max-height"]?.value,
  "min(46vh, 180px)",
);
assert.equal(landscapeExpandedStatus.position?.value, "fixed");
assert.equal(
  landscapeExpandedStatus.top?.value,
  "max(8px, env(safe-area-inset-top))",
);
assert.equal(landscapeExpandedStatus.left?.value, "10px");
assert.equal(landscapeExpandedStatus.right?.value, "10px");
assert.equal(
  shortLandscapeCascade.declarations(
    ".main-panel.view-chat:has(.companion-status.expanded) .topbar",
  ).visibility?.value,
  "hidden",
);
assert.equal(
  shortLandscapeCascade.declarations(
    ".main-panel.view-chat:has(.companion-status.expanded) .ambient-context-badge",
  ).display?.value,
  "none",
  "weather stays mounted but yields its pixels while status is expanded on a short landscape screen",
);

const touchZone = status.match(
  /function touchZone\(zone\)\s*\{([\s\S]*?)\n\s*\}/,
)?.[1];
assert.ok(touchZone, "touchZone handler must exist");
assert.match(
  status,
  /const \[expanded,\s*setExpanded\] = useState\(false\)/,
  "the status panel must start compact on every mounted app session",
);
assert.match(
  app,
  /const \[isStatusPanelExpanded,\s*setIsStatusPanelExpanded\] = useState\(false\)/,
  "the parent layout must also reserve compact status geometry by default",
);
assert.doesNotMatch(
  touchZone,
  /setExpanded\(false\)/,
  "interaction buttons must leave the status panel open",
);
assert.doesNotMatch(
  status,
  /interactionCollapseTimerRef|1100/,
  "interaction collapse must not depend on an arbitrary timer",
);
assert.match(
  status,
  /document\.addEventListener\("pointerdown", closeFromOutside\)/,
  "status panel must close when the user clicks outside it",
);
assert.match(
  status,
  /event\.key === "Escape"[\s\S]*?closePanel\(\)/,
  "status panel must close from the keyboard without changing views",
);
assert.match(
  status,
  /if \(!rootRef\.current\?\.contains\(event\.target\)\) \{\s*closePanel\(\)/,
  "using anything outside the status panel must collapse it",
);
assert.match(
  status,
  /if \(!expanded\) return undefined;[\s\S]*?panelRef\.current\?\.scrollTo\(\{ top: 0 \}\)/,
  "opening the status panel must reset its independent scroll position",
);
assert.match(
  status,
  /aria-expanded=\{expanded\}[\s\S]*?onClick=\{togglePanel\}/,
  "the rainbow capsule must explicitly toggle open and closed",
);
assert.match(
  css,
  /@media \(max-width: 820px\)[\s\S]*?\.view-chat \.view-content\s*\{[^}]*min-height:\s*0[^}]*flex:\s*1 1 auto/s,
  "mobile chat content must remain a shrinkable region above navigation",
);
assert.doesNotMatch(
  css,
  /\.main-panel\.view-chat:has\(\.companion-status\.expanded\) \.message-list\s*\{[^}]*height:\s*0/s,
  "expanded status must not collapse the message scroller to zero height",
);
assert.match(
  status,
  /sun-glass-liquid-action-stage[\s\S]*?sun-glass-capsule-decoration[\s\S]*?Heart[\s\S]*?MessageCircle[\s\S]*?Sparkles/,
  "the floating capsule must keep the three decorative icons",
);
assert.match(
  status,
  /className="sun-glass-status-scroll"[\s\S]*?DESIRE_ACTIONS\.map[\s\S]*?HOT_ZONES\.map[\s\S]*?RECOVERY_ACTIONS\.map/,
  "the expanded glass panel must keep every desire, touch and recovery action in its scroll region",
);
assert.doesNotMatch(
  status,
  /className="status-restore-button"/,
  "the single capsule layout must not leave a second side restore control",
);
assert.match(
  css,
  /\.sun-glass-status-scroll\s*\{[^}]*overflow-y:\s*auto/s,
  "the expanded glass panel must scroll independently",
);
assert.match(
  css,
  /\.sun-glass-liquid-color-flow\s*\{[\s\S]*?sun-glass-rainbow-shimmer[\s\S]*?sun-glass-rainbow-breathe/s,
  "the rainbow capsule must stay visibly animated",
);
assert.match(
  status,
  /formatUpdatedAt\(record\.createdAt, clockNow\)/,
  "recent status records must expose readable timestamps",
);

assert.match(
  app,
  /const handleCompanionInteraction = useCallback\(\s*\(zoneId\) => companionInteractionHandlerRef\.current\?\.\(zoneId\),\s*\[\],\s*\)/,
  "the status panel must receive a stable interaction callback",
);
assert.match(
  app,
  /companionInteractionHandlerRef\.current = registerCompanionInteraction/,
  "the stable callback must forward to the current chat-aware interaction handler",
);
assert.match(
  app,
  /onInteract=\{handleCompanionInteraction\}/,
  "the status panel must use the chat-aware interaction handler",
);
assert.match(
  app,
  /active=\{activeView === "chat"\}/,
  "leaving chat must reset only the status panel while weather stays mounted",
);
assert.match(
  status,
  /const closePanel = useCallback\(\(\) => \{[\s\S]*?scrollTo\(\{ top: 0 \}\);[\s\S]*?setExpanded\(false\)[\s\S]*?if \(active\) return undefined;[\s\S]*?requestAnimationFrame\(closePanel\)/,
  "an inactive status panel must close and reset its private scroll position",
);
assert.match(
  app,
  /className="composer-tool-menu"/,
  "voice and attachment actions must live in the expandable composer menu",
);
assert.match(
  app,
  /function changeView\(view\)[\s\S]*?closeComposerMenu\(\)[\s\S]*?requestStatusPanelClose\(\)[\s\S]*?setActiveView\(view\)/,
  "navigation must close both chat overlays",
);
assert.match(
  css,
  /\.new-chat-label\s*\{[^}]*display:\s*none/s,
  "the compact mobile new-chat button must hide its text label",
);
assert.match(
  app,
  /accept="video\/mp4,video\/webm,video\/quicktime"/,
  "the composer menu must provide a dedicated video picker",
);
assert.equal(
  (app.match(/className="voice-hold-button"/g) || []).length,
  1,
  "the hold-to-talk control must not remain duplicated below the composer",
);
assert.match(
  app,
  /ref=\{composerMenuTriggerRef\}[\s\S]*?disabled=\{isVoiceInputBusy\}[\s\S]*?onClick=\{toggleComposerMenu\}/,
  "AI thinking must not disable the plus menu used to prepare the next turn",
);
const composerMenuTrigger = app.match(
  /<button\s+ref=\{composerMenuTriggerRef\}[\s\S]*?<\/button>/,
)?.[0];
assert.doesNotMatch(
  composerMenuTrigger || "",
  /isSending|isCompanionResponding/,
  "the plus menu must remain available while the current reply is in flight",
);
assert.match(
  app,
  /aria-label=\{\s*isComposerMenuOpen \? "关闭更多功能" : "打开更多功能"[\s\S]*?aria-expanded=\{isComposerMenuOpen\}[\s\S]*?<RainbowAgentMark\s*\/>/,
  "the composer menu trigger must expose its open state while keeping the reference mark stable",
);
assert.doesNotMatch(
  css,
  /\.chat-attach-button\.active\s*\{[^}]*transform:/s,
  "opening the plus menu must not rotate its square trigger into a diamond",
);
assert.match(
  app,
  /disabled=\{attachmentsAtLimit\}[\s\S]*?chatImageInputRef[\s\S]*?disabled=\{attachmentsAtLimit\}[\s\S]*?chatVideoInputRef[\s\S]*?disabled=\{attachmentsAtLimit\}[\s\S]*?chatFileInputRef/,
  "only attachment choices must be disabled at the attachment limit",
);
assert.match(
  app,
  /closeComposerMenuFromEscape[\s\S]*?event\.key !== "Escape"[\s\S]*?closeComposerMenu\(true\)/,
  "Escape must close the plus menu through its focus-restoring path",
);
assert.match(
  app,
  /closeComposerMenu = useCallback[\s\S]*?requestAnimationFrame\(\(\) => composerMenuTriggerRef\.current\?\.focus\(\)\)/,
  "closing the plus menu from Escape must restore focus to its trigger",
);
assert.match(
  app,
  /className="composer-tool-menu"[\s\S]*?aria-label="本会话模型"/,
  "the per-conversation model picker must live inside the plus menu",
);
assert.match(
  app,
  /onFocus=\{\(\) => \{[\s\S]*?"focus-input"[\s\S]*?requestStatusPanelClose\(\)/,
  "focusing the message input must close the status panel",
);
const messageComposerTextarea = app.match(
  /<textarea\s+ref=\{messageInputRef\}[\s\S]*?\/>/,
)?.[0];
assert.ok(
  messageComposerTextarea,
  "the chat composer textarea must remain present",
);
assert.doesNotMatch(
  messageComposerTextarea,
  /disabled=\{/,
  "background sending, companion or voice states must never lock text entry",
);
const composerSendButton = app.match(
  /<button\s+className="send-button"[\s\S]*?<\/button>/,
)?.[0];
assert.match(
  composerSendButton || "",
  /onPointerDown=\{[\s\S]*?handleSendActivation\("pointerdown", event\)[\s\S]*?onClick=\{[\s\S]*?handleSendActivation\("click", event\)/,
  "a touch on send must dispatch before Android keyboard resize without dispatching its synthetic click twice",
);
assert.match(
  app,
  /function handleSendActivation\(action, event\)[\s\S]*?resolveComposerSendActivation[\s\S]*?sendPointerDownHandledRef\.current[\s\S]*?handleSendButton\(\)/,
  "send activation must share one pointer/click deduplication gate",
);
assert.match(
  app,
  /function handleSendButton\(\)[\s\S]*?isSendingRef\.current[\s\S]*?abortChatRequest\(chatRequestRef, "user-cancel"\)[\s\S]*?sendMessage\(\)/,
  "the send control must let the user stop a long model request",
);
assert.doesNotMatch(
  composerSendButton || "",
  /disabled=\{[\s\S]*?\bisSending\s*\|\|/,
  "the stop control must remain tappable while the model is working",
);
assert.doesNotMatch(
  app,
  /key=\{`companion-status-/,
  "status panel must keep one stable component instance",
);
assert.match(
  app,
  /window\.setTimeout\(enqueue,\s*800\)/,
  "settings changes must be autosaved after a short debounce",
);
assert.match(
  app,
  /const recovered = mergeRecoveredStartupData\([\s\S]*?activeSessionIdRef\.current = recovered\.activeSessionId;[\s\S]*?migrateLegacyChatModelToSession\(\s*recovered\.activeSessionId,\s*globalThis\.localStorage,\s*accountStorageScope/,
  "startup must migrate the old model selection into the current account's first active session",
);
assert.match(
  app,
  /function initializeSessionChatModel\(sessionId, serverModel = ""\)[\s\S]*?migrateLegacyChatModelToSession\(\s*sessionId,\s*globalThis\.localStorage,\s*accountStorageScope[\s\S]*?serverModel \|\| migratedModel \|\| settings\.model/,
  "new sessions must consume only the current account's pending model or fall back to the App default",
);
const createSessionSource = sourceBetween(
  "async function createSession()",
  "function chooseSession(",
);
assert.match(
  createSessionSource,
  /body:\s*JSON\.stringify\(\{\s*title:\s*"新对话",\s*\}\)[\s\S]*?initializeSessionChatModel\(data\.session\.id,\s*data\.session\.model_id\)/,
  "an explicitly created first session must use the server-bound model",
);
assert.doesNotMatch(
  createSessionSource,
  /model_id\s*:/,
  "new sessions must not submit a client-side model",
);
assert.match(
  app,
  /function selectChatModel\(value\)[\s\S]*?apiRequest\(`\/api\/v2\/sessions\/\$\{sessionId\}`,[\s\S]*?method: "PATCH"[\s\S]*?model_id: model[\s\S]*?已恢复之前的模型/,
  "model changes must be serialized to the current session and roll back on failure",
);
assert.match(
  app,
  /readServerSessionChatModel\(\s*recovered\.sessions,[\s\S]*?recovered\.activeSessionId[\s\S]*?storeSessionChatModel\(recovered\.activeSessionId, serverSessionModel\)/,
  "startup must prefer the server-persisted model for cross-device continuity",
);
assert.match(
  app,
  /visibilitychange[\s\S]*?flushSettingsBeforePageLeaves[\s\S]*?pagehide/,
  "hidden and pagehide lifecycle events must flush the settings draft",
);
assert.match(
  app,
  /pendingAutosaveAfterFailure\(\s*queued,\s*pendingSettingsSaveRef\.current[\s\S]*?pausedForOnlineRetry = true[\s\S]*?break/,
  "a failed autosave must remain queued while the active request loop stops",
);
assert.match(
  app,
  /SETTINGS_SAVE_RETRY_DELAYS_MS = \[1200,\s*3500,\s*8000\]/,
  "online autosave failures must use a finite delayed retry schedule",
);
assert.match(
  app,
  /apiRequest\("\/api\/weather\/current",[\s\S]*?timeoutMs:\s*BACKEND_WAKE_TIMEOUT_MS/,
  "weather refresh must not fail before a sleeping backend can wake",
);
assert.match(
  app,
  /正在唤醒 DengTa 后端[\s\S]*?服务休眠后的首次连接可能需要约一分钟/,
  "the first cold start must be described as waking rather than disconnected",
);
assert.match(
  app,
  /settingsSaveRetryCountRef\.current >=[\s\S]*?SETTINGS_SAVE_RETRY_DELAYS_MS\.length[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?flushSettingsSaveQueue\(\)/,
  "autosave retries must stop at the configured limit and retry through the same queue",
);
assert.match(
  app,
  /settingsLifecycleFlushPendingRef\.current\) return;[\s\S]*?settingsLifecycleFlushPendingRef\.current = true;[\s\S]*?flushLatestSettingsDraftRef\.current\(\{ keepalive: true \}\)/,
  "visibilitychange and pagehide must share one lifecycle flush per hidden cycle",
);
assert.match(
  ambientContextBadge,
  /className="ambient-context-minimize"[\s\S]*?aria-label=\{`最小化时间和天气到[\s\S]*?onClick=\{\(\) => minimizeWidget\(side\)\}/,
  "weather must provide an explicit accessible minimize button in addition to gestures",
);
assert.match(
  ambientContextBadge,
  /data-minimized="true"[\s\S]*?width:\s*48,[\s\S]*?height:\s*48,[\s\S]*?minWidth:\s*48,[\s\S]*?minHeight:\s*48,/,
  "the minimized weather control must expose at least a 48 by 48 touch target",
);
assert.match(
  ambientContextBadge,
  /const \[minimized,\s*setMinimized\] = useState\(\s*initialState\.preferences\.minimized,\s*\)/,
  "weather minimization must restore from the persisted preference",
);
assert.match(
  ambientContextBadge,
  /const \[side,\s*setSide\] = useState\(initialState\.preferences\.side\)/,
  "the minimized weather edge must restore from the persisted preference",
);
assert.match(
  ambientContextBadge,
  /function minimizeWidget\(nextSide\)[\s\S]*?persistPreferences\(\{ minimized: true, side: normalizedSide \}\)/,
  "minimizing weather must persist both its state and chosen edge",
);
assert.match(
  ambientContextBadge,
  /function restoreWidget\(\)[\s\S]*?persistPreferences\(\{ minimized: false, side \}\)/,
  "restoring weather must persist the expanded state",
);
assert.match(
  css,
  /\.composer\s*\{[^}]*grid-template-columns:\s*42px minmax\(0,\s*1fr\) 42px/s,
  "the compact composer must place plus, text and send controls in one capsule",
);
assert.match(
  app,
  /placeholder=\{[\s\S]*?composerHint[\s\S]*?想和祂说点什么……[\s\S]*?\}/,
  "the compact mobile composer must use a dynamic one-line placeholder",
);
assert.match(
  css,
  /\.celestial-prototype-sky\s*>\s*\.celestial-sun\s*\{[^}]*top:\s*var\(--sun-y\)/s,
  "the accepted prototype sun must follow the continuous sky coordinates",
);
assert.match(
  celestialBackdrop,
  /getSunGlassSky\(minute, snapshot\)/,
  "the production background must use the accepted sky engine without rewriting time",
);
assert.match(
  celestialBackdrop,
  /length:\s*520/,
  "the sharp night background must preserve the prototype galaxy density",
);
assert.doesNotMatch(
  app,
  /className="welcome-companions"[\s\S]*?src="\/app-icon\.svg"/,
  "an empty chat must not render the launcher icon as a large white avatar block",
);
assert.match(
  chatMessage,
  /onPointerDown=\{beginLongPress\}[\s\S]*?onPointerMove=\{moveLongPress\}[\s\S]*?onPointerUp=\{endLongPress\}[\s\S]*?onPointerCancel=\{cancelLongPress\}/,
  "message long press must cancel cleanly when Android turns the gesture into scrolling",
);
assert.match(
  chatMessage,
  /event\.target\?\.closest\?\.\("button, a, input, textarea, select"\)/,
  "long press must leave attachment controls and links interactive",
);
assert.match(
  chatMessage,
  /className="message-reference-button"[\s\S]*?aria-label=\{`引用\$\{displayName\}的这条消息`\}/,
  "each referenceable message must expose a keyboard and screen-reader fallback",
);
assert.match(
  app,
  /className="composer-message-reference"[\s\S]*?aria-label="取消引用"/,
  "the composer must show a cancellable reference snapshot",
);
assert.match(
  css,
  /\.message-row\.can-reference\s*\{[^}]*touch-action:\s*pan-y/s,
  "reference gestures must preserve vertical chat scrolling",
);
assert.match(
  app,
  /pendingSettingsSaveRef/,
  "autosaves must queue newer edits instead of racing requests",
);
assert.match(
  app,
  /settingsSaveRunRef/,
  "callers must be able to await the active settings save queue",
);
assert.match(
  app,
  /while \(pendingSettingsSaveRef\.current\)/,
  "the settings queue must finish newer drafts before resolving",
);
const sendMessageSource = sourceBetween(
  "async function sendMessage()",
  "function scheduleSettingsAutosave",
);
assert.match(
  sendMessageSource,
  /message_reference:\s*messageReferenceAtRequest/,
  "the reference snapshot must travel separately from turn_context",
);
assert.ok(
  sendMessageSource.indexOf("await awaitChatPreparation(flushLatestSettingsDraft,") >= 0 &&
    sendMessageSource.indexOf("await awaitChatPreparation(flushLatestSettingsDraft,") <
      sendMessageSource.indexOf('setMessage("")'),
  "text chat must save the latest role settings before consuming the draft",
);
assert.match(
  sendMessageSource,
  /if \(startingSessionId\) \{\s*setSendPreparationStage\("model"\);\s*await awaitChatPreparation\(\(\) => sessionModelSaveQueueRef\.current, request\.controller\.signal\);\s*\}/,
  "an existing session must finish saving its selected model before sending",
);
assert.doesNotMatch(
  sendMessageSource,
  /model:\s*(?:requestModel|selectedChatModel|activeChatModel|settings\.model)/,
  "chat streams must use the persisted session model instead of a stale client model",
);
const submitVoiceSource = sourceBetween(
  "async function submitVoiceBlob",
  "async function finishVoiceCapture",
);
assert.ok(
  submitVoiceSource.indexOf("await flushLatestSettingsDraft()") >= 0 &&
    submitVoiceSource.indexOf("await flushLatestSettingsDraft()") <
      submitVoiceSource.indexOf('apiRequest("/api/v2/sessions"'),
  "voice chat must save the latest role settings before its first request",
);
const companionInteractionSource = sourceBetween(
  "async function processCompanionInteractionQueue()",
  "async function selectChatAttachments",
);
assert.ok(
  companionInteractionSource.indexOf("await flushLatestSettingsDraft()") >= 0 &&
    companionInteractionSource.indexOf("await flushLatestSettingsDraft()") <
      companionInteractionSource.indexOf(
        "companionInteractionQueueRef.current.shift()",
      ),
  "companion interactions must not consume an event before settings are saved",
);
assert.doesNotMatch(
  companionInteractionSource,
  /applyPromptReceipt/,
  "companion interactions must not overwrite the latest main-chat prompt receipt",
);
const changeViewSource = sourceBetween(
  "function changeView(view)",
  "function renderChat()",
);
assert.match(
  changeViewSource,
  /shouldScheduleSettingsOnViewChange\(\{[\s\S]*activeView,[\s\S]*nextView: view,[\s\S]*hasLoadedSettings: hasLoadedSettingsRef\.current,[\s\S]*scheduleSettingsAutosave\(draftSettingsRef\.current,[\s\S]*immediate: true/,
  "leaving loaded settings must start an immediate save without writing during startup",
);
assert.doesNotMatch(
  app,
  />保存设置</,
  "settings must not require the old bottom save button",
);
assert.doesNotMatch(
  app,
  /event\.type === "reasoning"[\s\S]*appendThinkingSummary/,
  "chat streaming must not render provider reasoning summaries",
);
assert.doesNotMatch(
  app,
  /event\.source === "provider_summary"/,
  "provider reasoning summaries must not be treated as public monologue",
);
assert.match(
  sendMessageSource,
  /event\.type === "monologue"[\s\S]*reduceVisibleMonologueEvent/,
  "the explicit public monologue event must update the current assistant draft",
);
assert.match(
  app,
  /VISIBLE_MONOLOGUE_SOURCE/,
  "public monologue handling must use its explicit model-authored source",
);
assert.doesNotMatch(
  app,
  /\["companion_progress", "provider_summary"\]\.includes\(event\.source\)/,
  "application progress copy must never be merged into the model summary",
);
assert.match(
  app,
  /<PersonalizationEditor\s+field="unified_system_prompt"/,
  "settings must expose the persistent custom-instructions editor",
);
assert.match(
  app,
  /<PersonalizationEditor\s+field="user_details"/,
  "settings must expose a separate persistent user-details editor",
);
assert.match(
  app,
  /“个性化指令”和“你的详情”都会原样进入 DengTa[\s\S]*最高应用级的 instructions \/ system/,
  "settings must explain that both user-edited fields use the highest application instruction level",
);
assert.match(
  app,
  /稳定长期记忆、聊天历史和本轮临时补充仍保持独立/,
  "settings must keep stable memory distinct from user-edited persistent instructions",
);
assert.doesNotMatch(
  app,
  /data-setting-field="(?:system_prompt|additional_prompt|personality)"/,
  "legacy prompt fields must not remain as competing visible editors",
);
assert.match(
  app,
  /data-setting-field="turn_context"/,
  "settings must expose a temporary next-turn context editor",
);
assert.match(
  app,
  /"intimate_expression_enabled"/,
  "settings must expose the persistent intimate-expression toggle",
);
assert.match(
  app,
  /intimateExpressionEnabled=\{\s*settings\.intimate_expression_enabled === true\s*\}/,
  "status interactions must receive the intimate-expression setting",
);
assert.match(
  androidManifest,
  /android\.permission\.ACCESS_COARSE_LOCATION/,
  "Android must declare coarse location for user-enabled weather",
);
assert.match(
  androidManifest,
  /android\.permission\.ACCESS_FINE_LOCATION/,
  "Capacitor geolocation also requires fine location on Android 11 and older",
);
assert.match(
  androidManifest,
  /android:windowSoftInputMode="adjustResize"/,
  "Android must resize the app for the keyboard while CSS hides mobile navigation",
);

const innerHeightFallback = createInnerHeightFallbackHarness();
const cleanupInnerHeightFallback = installInnerHeightViewportFallback({
  documentObject: innerHeightFallback.documentObject,
  windowObject: innerHeightFallback.windowObject,
});
innerHeightFallback.documentObject.activeElement =
  innerHeightFallback.textarea;
innerHeightFallback.documentObject.dispatch("focusin");
innerHeightFallback.windowObject.innerHeight = 510;
innerHeightFallback.windowObject.dispatch("resize");
assert.equal(
  innerHeightFallback.root.dataset.keyboardOpen,
  "true",
  "an editable field plus a reduced innerHeight must hide mobile navigation when visualViewport is unavailable",
);
assert.equal(
  innerHeightFallback.root.style.values.get("--app-height"),
  "510px",
  "the innerHeight fallback must keep the composer inside the keyboard-visible viewport",
);
innerHeightFallback.documentObject.activeElement = null;
innerHeightFallback.documentObject.dispatch("focusout");
assert.equal(
  innerHeightFallback.root.dataset.keyboardOpen,
  "true",
  "focusout must not reveal mobile navigation before the keyboard resize animation finishes",
);
assert.equal(
  innerHeightFallback.root.style.values.get("--app-height"),
  "510px",
);
innerHeightFallback.windowObject.innerHeight = 844;
innerHeightFallback.windowObject.dispatch("resize");
assert.equal(innerHeightFallback.root.dataset.keyboardOpen, "false");
assert.equal(
  innerHeightFallback.root.style.values.get("--app-height"),
  "844px",
);
cleanupInnerHeightFallback();
assert.equal("keyboardOpen" in innerHeightFallback.root.dataset, false);

assert.match(
  app,
  /return installVisualViewportController\(\)/,
  "App must install the controller with the innerHeight keyboard fallback",
);
assert.match(
  fs.readFileSync(new URL("../src/mobile-viewport.js", import.meta.url), "utf8"),
  /const rawGap = Math\.max\(0, fullHeight - viewport\.height\)/,
  "keyboard detection must not let visualViewport offsetTop cancel the height loss",
);
assert.match(
  app,
  /className=\{`topbar-context[\s\S]*?activeView === "chat" \? \([\s\S]*?sun-glass-topbar-identity[\s\S]*?: \([\s\S]*?<h1>\{viewTitle\}<\/h1>/,
  "the mobile chat top bar must render the companion identity instead of the conversation title",
);
assert.match(
  css,
  /@media \(max-width: 820px\)[\s\S]*?\.topbar\s*\{[\s\S]*?env\(safe-area-inset-top\)/,
  "the final mobile top-bar override must retain the Android safe area",
);

console.log("mobile layout regression tests passed");
