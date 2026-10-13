import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function keyframeBlocks(styles, prefixPattern) {
  const blocks = [];
  const matcher = new RegExp(`@keyframes\\s+(${prefixPattern}[^\\s{]*)\\s*\\{`, "g");
  for (const match of styles.matchAll(matcher)) {
    let depth = 1;
    let cursor = match.index + match[0].length;
    while (cursor < styles.length && depth > 0) {
      if (styles[cursor] === "{") depth += 1;
      if (styles[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    blocks.push(styles.slice(match.index, cursor));
  }
  return blocks;
}

test("the companion pulse uses compositor motion instead of repainting an SVG dash", () => {
  const statusSource = read("src/CompanionStatus.jsx");
  const styles = read("src/native-feel.css");

  assert.doesNotMatch(
    statusSource,
    /<path[^>]*className="status-pulse-runner"/,
  );
  assert.match(styles, /\.status-pulse-runner[\s\S]*translate3d/);
  assert.doesNotMatch(
    styles,
    /\.status-pulse-runner[\s\S]{0,500}stroke-dashoffset/,
  );
});

test("the launch thread straightens point-by-point without React frame state", () => {
  const prelude = read("src/DengTaPrelude.jsx");
  const chatMessage = read("src/ChatMessage.jsx");
  const styles = read("src/native-feel.css");

  assert.match(prelude, /className="dengta-prelude"/);
  assert.match(
    prelude,
    /data-word="DENGTA"/,
    "the launch thread must resolve into the DENGTA wordmark",
  );
  assert.match(prelude, /data-motion="progressive-tension"/);
  assert.match(prelude, /requestAnimationFrame\(renderFrame\)/);
  assert.match(prelude, /pointRatio \* THREAD_STAGGER/);
  assert.doesNotMatch(
    prelude,
    /set[A-Z][A-Za-z]*\([^)]*requestAnimationFrame/,
    "the one-shot SVG morph must update attributes directly, not React state per frame",
  );
  assert.doesNotMatch(
    chatMessage,
    /key=\{`\$\{item\.id\}-\$\{item\.isStreaming/,
  );
  assert.match(styles, /@keyframes dengta-thread-arrive/);
  assert.match(styles, /@keyframes native-sheet-enter/);
  assert.match(styles, /@keyframes native-nav-settle/);
  assert.match(styles, /@keyframes native-weather-unfold/);
  assert.doesNotMatch(
    keyframeBlocks(styles, "(?:dengta|native)").join("\n"),
    /(?:height|width|margin|padding|top|left)\s*:/,
  );
});

test("long repeated content can skip offscreen layout and reduced motion is supported", () => {
  const styles = read("src/native-feel.css");

  assert.match(styles, /content-visibility:\s*auto/);
  assert.match(styles, /contain-intrinsic-size:/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test("the settings flow stays GPU-backed and freezes its visible frame while scrolling", () => {
  const appSource = read("src/App.jsx");
  const flowSource = read("src/SettingsFlowField.jsx");
  const styles = read("src/sun-glass-ui.css");
  const flowStart = styles.indexOf(".settings-flow-field {");
  const flowEnd = styles.indexOf("\n.sidebar {", flowStart);
  const flowStyles = styles.slice(flowStart, flowEnd);

  assert.ok(flowStart >= 0 && flowEnd > flowStart);
  assert.doesNotMatch(flowStyles, /filter:\s*blur\(/);
  assert.doesNotMatch(flowStyles, /mix-blend-mode:\s*(?:multiply|screen|soft-light)/);
  assert.match(flowSource, /powerPreference:\s*"high-performance"/);
  assert.match(flowSource, /const ACTIVE_FRAME_MS = 1000 \/ 15/);
  assert.match(flowSource, /classList\.contains\("is-scrolling"\)/);
  assert.match(flowSource, /preserveDrawingBuffer:\s*true/);
  assert.match(flowSource, /if \(disposed \|\| scrolling\) return/);
  assert.match(flowSource, /cancelAnimationFrame\(animationFrame\)/);
  assert.match(
    flowSource,
    /reducedMotion\.matches \? 0\.64 : \(elapsed % LOOP_SECONDS\) \/ LOOP_SECONDS/,
    "reduced motion must freeze the visible frame while scrolling",
  );
  assert.match(flowSource, /760 \/ Math\.max\(longestSide, 1\)/);
  assert.match(
    styles,
    /\.settings-sheet[\s\S]{0,260}backdrop-filter:\s*none/,
  );
  assert.match(
    styles,
    /\.settings-sheet \.settings-card[\s\S]{0,420}content-visibility:\s*visible/,
  );
  assert.match(
    styles,
    /\.settings-sheet \.save-bar[\s\S]{0,260}backdrop-filter:\s*none/,
  );
  assert.doesNotMatch(
    styles,
    /\.settings-card,[\s\S]{0,900}backdrop-filter:\s*blur\(/,
  );
  assert.match(appSource, /onScroll=\{handleSettingsScroll\}/);
  assert.doesNotMatch(
    styles,
    /\.settings-sheet\.is-scrolling\s+\.settings-flow-field\s*\{[^}]*visibility:\s*hidden/,
  );
  assert.match(
    styles,
    /\.settings-sheet \.settings-card,[\s\S]{0,260}content-visibility:\s*visible/,
  );
});

test("the sky does not repaint invisible weather layers at animation speed", () => {
  const backdropSource = read("src/CelestialBackdrop.jsx");

  assert.match(backdropSource, /const hasVisibleMotion =/);
  assert.match(backdropSource, /const starsVisible = sky\.night > 0\.08/);
  assert.match(
    backdropSource,
    /createVisualLoop\(paint, \{ animated: hasVisibleMotion/,
  );
});

test("dialogs share a layout-free jelly spring on the compositor", () => {
  const mainSource = read("src/main.jsx");
  const styles = read("src/jelly-motion.css");
  const jellyFrames = keyframeBlocks(styles, "dengta-jelly").join("\n");

  assert.match(mainSource, /import "\.\/jelly-motion\.css"/);
  assert.match(styles, /\.settings-sheet,[\s\S]*?\.account-menu-popover/);
  assert.match(styles, /@keyframes dengta-jelly-pop/);
  assert.match(styles, /@keyframes dengta-jelly-sheet-pop/);
  assert.match(styles, /--dengta-jelly-enter: 220ms/);
  assert.doesNotMatch(jellyFrames, /scale3d\(1\.0[1-9]/);
  assert.doesNotMatch(
    jellyFrames,
    /(?:height|width|margin|padding|top|left|border-radius)\s*:/,
  );
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});
