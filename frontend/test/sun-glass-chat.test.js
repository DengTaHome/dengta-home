import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("the approved Variant A controls are wired into the real chat screen", () => {
  const app = read("src/App.jsx");
  const deck = read("src/SunGlassTimeDeck.jsx");
  const status = read("src/CompanionStatus.jsx");

  assert.match(app, /<SunGlassTimeDeck[\s\S]*?onGlassLevel=/);
  assert.match(app, /weatherModeOverride=\{weatherPreviewMode\}/);
  assert.match(deck, /清晨 08:00/);
  assert.match(deck, /红霞 18:00/);
  assert.match(deck, /蓝调 18:40/);
  assert.match(deck, /银河 22:00/);
  assert.match(deck, /微云/);
  assert.match(deck, /雨幕/);
  assert.match(deck, /晴雷/);
  assert.match(deck, /晴空/);
  assert.match(deck, /aria-label="全局玻璃度"/);
  assert.match(status, /sun-glass-liquid-action-stage/);
  assert.match(status, /sun-glass-liquid-capsule-toggle/);
  assert.match(status, /sun-glass-capsule-decoration/);
  assert.match(status, /Heart/);
  assert.match(status, /MessageCircle/);
  assert.match(status, /Sparkles/);
  assert.match(status, /听歌/);
  assert.match(status, /看书/);
  assert.match(status, /看电视/);
  assert.match(status, /sun-glass-floating-status-shell/);
  assert.match(status, /sun-glass-status-scroll/);
  assert.doesNotMatch(status, /data-status-drag-handle|dragPosition/);
  assert.doesNotMatch(
    status,
    /status-advanced-content/,
    "the legacy dark status dashboard must not remain behind the glass template",
  );
});

test("the mobile layer preserves the prototype dimensions and jelly motion", () => {
  const styles = read("src/sun-glass-chat.css");

  assert.match(
    styles,
    /\.sun-glass-liquid-action-module\s*\{[\s\S]*?width:\s*236px;[\s\S]*?height:\s*64px;[\s\S]*?border-radius:\s*34px;/,
  );
  assert.match(
    styles,
    /\.sun-glass-status-ribbon\s*\{[\s\S]*?min-height:\s*70px;[\s\S]*?border-radius:\s*25px;/,
  );
  assert.match(
    styles,
    /\.sun-glass-time-deck\s*\{[\s\S]*?border-radius:\s*25px;/,
  );
  assert.match(styles, /@keyframes sun-glass-liquid-color-crossing/);
  assert.match(styles, /@keyframes sun-glass-rainbow-shimmer/);
  assert.match(styles, /@keyframes sun-glass-rainbow-breathe/);
  assert.match(styles, /@keyframes sun-glass-jelly-open/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(
    styles,
    /@media \(min-width: 821px\)\s*\{[\s\S]*?\.sun-glass-time-deck\s*\{[\s\S]*?display:\s*block;/,
  );
});

test("the local visual preview is isolated from production startup data", () => {
  const app = read("src/App.jsx");

  assert.match(app, /const visualPreview = arguments\[0\]\?\.visualPreview === true/);
  assert.match(app, /if \(visualPreview\)[\s\S]*?setIsLoading\(false\)/);
  assert.match(app, /showStartupRecovery =\s*!visualPreview/);
});

test("time preview changes the shared sky snapshot without changing system time", () => {
  const theme = read("src/dengta-theme.js");
  const backdrop = read("src/CelestialBackdrop.jsx");

  assert.match(theme, /const \[previewMinute, setPreviewMinute\] = useState\(null\)/);
  assert.match(theme, /dateAtChinaMinute\(clock, previewMinute\)/);
  assert.match(backdrop, /weatherModeOverride/);
  assert.match(backdrop, /\["clear", "cloudy", "rain", "storm"\]\.includes/);
});

test("the accepted sky keeps the real preview minute and exposes weather controls", () => {
  const deck = read("src/SunGlassTimeDeck.jsx");
  const backdrop = read("src/CelestialBackdrop.jsx");
  const styles = read("src/sun-glass-ui.css");

  assert.match(deck, /const \[isOpen, setIsOpen\] = useState\(false\)/);
  assert.match(deck, /WEATHER_PRESETS\.find/);
  assert.match(deck, /实时\$\{displayedWeatherLabel\}/);
  assert.match(deck, /onWeatherMode\?\.\(null\)/);
  assert.doesNotMatch(backdrop, /snapshot\.resolvedAppearance === "night"/);
  assert.match(backdrop, /getSunGlassSky\(minute, snapshot\)/);
  const sunRule = styles.match(
    /\.celestial-prototype-sky > \.celestial-sun\s*\{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(sunRule, "the visible sun rule must exist");
  assert.doesNotMatch(sunRule, /inset:\s*auto/);
});

test("expanded status stays anchored below the single fixed capsule", () => {
  const app = read("src/App.jsx");
  const status = read("src/CompanionStatus.jsx");
  const styles = read("src/sun-glass-chat.css");

  assert.doesNotMatch(status, /setDragPosition|data-status-drag-handle/);
  assert.match(
    styles,
    /@media \(min-width: 821px\)[\s\S]*?left:\s*max\(10px, calc\(50vw - 220px\)\);[\s\S]*?transform:\s*none(?:\s*!important)?;/,
  );
  assert.match(
    styles,
    /\.sun-glass-floating-status-panel[\s\S]*?position:\s*fixed;/,
  );
  assert.match(app, /isStatusPanelExpanded \? " status-panel-open"/);
  assert.match(
    styles,
    /\.main-panel\.view-chat\.status-panel-open \.message-list,[\s\S]*?opacity:\s*1;/,
  );
  assert.match(
    styles,
    /\.sun-glass-floating-status-shell\.expanded[\s\S]*?> \.sun-glass-liquid-action-stage[\s\S]*?display:\s*grid;/,
  );
  assert.match(
    styles,
    /status-panel-motion-v3[\s\S]*?\.sun-glass-floating-status-panel\.is-open[\s\S]*?visibility 0s linear 280ms/,
  );
  assert.match(
    styles,
    /sun-glass-floating-status-shell\.high-energy,[\s\S]*?sun-glass-floating-status-shell\.low-energy,[\s\S]*?left:\s*max\(10px, calc\(50vw - 220px\)\);/,
  );
});
