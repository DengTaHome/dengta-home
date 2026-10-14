import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("mobile chat uses one decorative rainbow capsule as the status toggle", () => {
  const status = read("src/CompanionStatus.jsx");
  const styles = read("src/sun-glass-chat.css");

  assert.match(
    read("src/NowPlayingCard.jsx"),
    /className="sun-glass-liquid-capsule-toggle has-now-playing"/,
    "the separate song card keeps the same capsule styles without nesting controls in a button",
  );
  assert.match(status, /nowPlaying \? \([\s\S]*?<NowPlayingCard/);
  assert.match(
    status,
    /sun-glass-liquid-capsule-toggle[\s\S]*?aria-expanded=\{expanded\}[\s\S]*?onClick=\{togglePanel\}/,
  );
  assert.match(
    status,
    /sun-glass-capsule-decoration[\s\S]*?<Heart[\s\S]*?<MessageCircle[\s\S]*?<Sparkles/,
  );
  assert.doesNotMatch(
    status,
    /sun-glass-liquid-action-stage[\s\S]*?QUICK_ACTIONS\.map/,
    "the decorative capsule icons must not remain independent action buttons",
  );
  assert.match(status, /onOpenNavigation/);
  assert.match(status, /onOpenSettings/);
  assert.doesNotMatch(status, /dragPosition|data-status-drag-handle/);
  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*?\.main-panel\.view-chat > \.topbar\s*\{[^}]*display:\s*none/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*?\.sun-glass-status-ribbon\s*\{[^}]*display:\s*none/s,
  );
  assert.match(
    styles,
    /\.sun-glass-floating-status-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s,
  );
  assert.match(
    styles,
    /\.main-panel\.view-chat \.chat-presence-stack\s*\{[^}]*display:\s*block;[^}]*overflow:\s*visible;[^}]*transform:\s*none;[^}]*backdrop-filter:\s*none/s,
    "the fixed capsule container must not clip or offset the connected panel",
  );
  assert.match(
    styles,
    /\.sun-glass-floating-status-shell\.expanded[\s\S]*?\.sun-glass-floating-status-panel\s*\{[^}]*position:\s*fixed !important;[^}]*top:\s*calc\(var\(--dengta-mobile-capsule-top\) \+ 70px\) !important/s,
    "the expanded panel must remain connected beneath the safe capsule",
  );
  assert.match(styles, /status-panel-motion-v3/);
  assert.match(
    styles,
    /\.sun-glass-floating-status-panel\[aria-hidden="true"\][^{]*\{[^}]*transition:[^}]*visibility 0s linear 280ms/s,
    "closing must keep the panel visible until its opacity and transform finish",
  );
});

test("time and weather controls live inside the plus menu and coalesce scrubbing", () => {
  const app = read("src/App.jsx");
  const deck = read("src/SunGlassTimeDeck.jsx");
  const menuStart = app.indexOf('<section className="composer-tool-menu"');
  const deckStart = app.indexOf("<SunGlassTimeDeck");

  assert.ok(menuStart >= 0, "the plus menu must exist");
  assert.ok(
    deckStart > menuStart,
    "the time deck must not occupy the always-visible composer area",
  );
  assert.match(deck, /SCRUB_COMMIT_INTERVAL_MS = 84/);
  assert.match(deck, /requestAnimationFrame/);
  assert.match(deck, /cancelAnimationFrame/);
  assert.match(deck, /data-time-scrubbing/);
  assert.match(deck, /document\.documentElement\.dataset\.timeScrubbing/);
  assert.match(deck, /aria-label="跟随实时天气"/);
  assert.match(app, /readEnabledAmbientCache\(undefined, accountStorageScope\)\.weather\.weather/);
});

test("mobile message bubbles expand toward the screen edges", () => {
  const styles = read("src/sun-glass-chat.css");

  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*?\.main-panel\.view-chat \.message-list\s*\{[^}]*padding-inline:\s*8px/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*?\.main-panel\.view-chat \.message-bubble[^{]*\{[^}]*max-width:\s*min\(94%,\s*720px\)/s,
  );
});

test("expanded status uses an opaque black interactive flow surface", () => {
  const status = read("src/CompanionStatus.jsx");
  const flow = [
    read("src/StatusFlowField.jsx"),
    read("src/status-fluid-engine.js"),
  ].join("\n");
  const styles = read("src/sun-glass-chat.css");

  assert.match(status, /<StatusFlowField active=\{expanded\} \/>/);
  assert.match(flow, /ADVECTION_SHADER/);
  assert.match(flow, /CURL_SHADER/);
  assert.match(flow, /VORTICITY_SHADER/);
  assert.match(flow, /DIVERGENCE_SHADER/);
  assert.match(flow, /PRESSURE_SHADER/);
  assert.match(flow, /GRADIENT_SUBTRACT_SHADER/);
  assert.match(flow, /SPLAT_SHADER/);
  assert.match(flow, /createDoubleFBO/);
  assert.match(flow, /splatPointerPath/);
  assert.match(flow, /panel\.addEventListener\("pointerdown", startPointerFlow/);
  assert.match(flow, /panel\.addEventListener\("pointermove", movePointerFlow/);
  assert.match(flow, /panel\.addEventListener\("touchmove", moveTouchFlow/);
  assert.doesNotMatch(flow, /gl\.drawArrays\(gl\.POINTS/);
  assert.doesNotMatch(flow, /gl_PointCoord/);
  assert.match(
    styles,
    /\.sun-glass-floating-status-shell\.expanded[\s\S]*?\.sun-glass-floating-status-panel[\s\S]*?background:\s*#050507/,
  );
  assert.match(styles, /\.status-flow-canvas/);
});

test("mobile capsule creates a chat paint boundary", () => {
  const styles = read("src/sun-glass-chat.css");

  assert.match(
    styles,
    /--dengta-mobile-capsule-top:\s*max\(\s*34px,\s*calc\(env\(safe-area-inset-top\) \+ 4px\)/,
  );
  assert.match(
    styles,
    /\.main-panel\.view-chat \.message-list\s*\{[^}]*clip-path:\s*inset\(calc\(var\(--dengta-mobile-capsule-top\) \+ 66px\) 0 0 0\)/s,
  );
});
