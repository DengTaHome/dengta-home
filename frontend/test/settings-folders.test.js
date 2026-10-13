import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const themeStudio = fs.readFileSync(
  new URL("../src/ThemeStudio.jsx", import.meta.url),
  "utf8"
);
const timeDeck = fs.readFileSync(
  new URL("../src/SunGlassTimeDeck.jsx", import.meta.url),
  "utf8"
);
const scrubber = fs.readFileSync(
  new URL("../src/use-glass-scrubber.js", import.meta.url),
  "utf8"
);
const styles = fs.readFileSync(
  new URL("../src/sun-glass-ui.css", import.meta.url),
  "utf8"
);

assert.match(app, /const SETTINGS_CATEGORIES = \[/);
assert.match(app, /<SettingsHome key=\{privateMediaScope\} categories=\{SETTINGS_CATEGORIES\} onSelectCategory=\{settingsCategoryNavigation\.selectCategory\}/);
assert.match(app, /settingsCategory === "appearance"/);
assert.match(app, /settingsCategory === "services"/);
assert.match(app, /settingsCategory === "devices"/);
assert.match(styles, /\.settings-folder-grid/);
assert.match(styles, /\.settings-category-heading/);

assert.match(themeStudio, /useGlassScrubber/);
assert.match(timeDeck, /useGlassScrubber/);
assert.match(scrubber, /requestAnimationFrame/);
assert.match(scrubber, /includeBlur:\s*false/);
assert.match(scrubber, /includeBlur:\s*true/);
assert.match(scrubber, /dataset\.glassScrubbing/);

console.log("settings folders and smooth glass controls passed");
