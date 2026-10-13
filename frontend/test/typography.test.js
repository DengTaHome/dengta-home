import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyThemePreferences,
  DENGTA_FONT_MODE_STORAGE_KEY,
  DEFAULT_THEME_PREFERENCES,
  getCelestialSnapshot,
  normalizeThemePreferences,
  readThemePreferences,
  writeThemePreferences,
} from "../src/dengta-theme.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");
const bundledFontPath = path.join(
  projectRoot,
  "public",
  "fonts",
  "DengTaSans-cjk-v2.woff2",
);

const css = fs.readFileSync(
  new URL("../src/typography.css", import.meta.url),
  "utf8",
);
const nativeCss = fs.readFileSync(
  new URL("../src/native-feel.css", import.meta.url),
  "utf8",
);
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const studio = fs.readFileSync(
  new URL("../src/ThemeStudio.jsx", import.meta.url),
  "utf8",
);

test("font preference defaults to the stable complete CJK face", () => {
  assert.equal(DEFAULT_THEME_PREFERENCES.fontMode, "standard");
  assert.equal(normalizeThemePreferences({}).fontMode, "standard");
  assert.equal(normalizeThemePreferences({ fontMode: "system" }).fontMode, "system");
  assert.equal(normalizeThemePreferences({ fontMode: "unknown" }).fontMode, "standard");
  assert.match(studio, /DengTa 标准/);
  assert.match(studio, /跟随系统/);
});

test("font preference persists per account and reaches the document root", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const saved = writeThemePreferences(
    { ...DEFAULT_THEME_PREFERENCES, fontMode: "system" },
    storage,
    "account-a",
  );
  const root = {
    dataset: {},
    style: { setProperty() {} },
  };

  assert.equal(readThemePreferences(storage, "account-a").fontMode, "system");
  assert.equal(readThemePreferences(storage, "account-b").fontMode, "standard");
  assert.equal(values.get(DENGTA_FONT_MODE_STORAGE_KEY), "system");
  applyThemePreferences(
    saved,
    getCelestialSnapshot(new Date("2026-08-13T04:00:00.000Z"), "day"),
    root,
  );
  assert.equal(root.dataset.dengtaFontMode, "system");
});

test("dynamic chat surfaces share the versioned DengTa CJK family", () => {
  assert.match(css, /DengTaSans-cjk-v2\.woff2/);
  assert.match(css, /:root\[data-dengta-font-mode="system"\]/);
  assert.match(css, /--font-display:\s*var\(--dengta-font\)/);
  assert.match(css, /--apple-font-text:\s*var\(--dengta-font\)/);
  assert.match(css, /\.app-shell \.message-content[\s\S]*font-family: var\(--dengta-font\) !important/);
  assert.match(css, /\.app-shell \.composer textarea[\s\S]*font-family: var\(--dengta-font\) !important/);
  assert.match(css, /\.app-shell \.thinking-panel[\s\S]*font-family: var\(--dengta-font\) !important/);
  assert.match(css, /\.app-shell \.message-content a/);
  assert.match(css, /body :where\(h1, h2, h3, h4, h5, h6/);
  assert.match(
    css,
    /body :where\(h1,[\s\S]*font-family: var\(--dengta-font\) !important/,
  );
  assert.match(css, /body :where\(code, pre, kbd, samp\)/);
  assert.match(nativeCss, /--font-ui:\s*var\(--dengta-font\)/);
  assert.match(
    nativeCss,
    /taotao-cream"\] a\s*\{\s*font-family:\s*var\(--dengta-font\)/,
  );
  assert.doesNotMatch(
    nativeCss,
    /\.chat-skin-cream-message \.message-bubble[\s\S]{0,700}ChillRoundF/,
    "decorative round type must not own chat message copy",
  );
});

test("the web shell preloads the versioned font and rotates the PWA cache", () => {
  assert.match(html, /dengta\.font-mode\.v1/);
  assert.match(html, /document\.documentElement\.dataset\.dengtaFontMode = mode/);
  assert.match(html, /mode !== "system"/);
  assert.match(html, /preload\.href = "\/fonts\/DengTaSans-cjk-v2\.woff2"/);
  assert.match(sw, /dengta-home-v14-fonts/);
  assert.ok(
    fs.statSync(bundledFontPath).size > 7_000_000,
    "the standard font must include the complete CJK coverage instead of the old UI subset",
  );
  assert.equal(
    fs.readFileSync(bundledFontPath).subarray(0, 4).toString("ascii"),
    "wOF2",
    "the standard font asset must remain a valid WOFF2 file",
  );
});
