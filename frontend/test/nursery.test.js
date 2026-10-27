import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
// 侧边栏条目已搬到 feature-navigation.js
const nav = await readFile(new URL("../src/feature-navigation.js", import.meta.url), "utf8");
const nursery = await readFile(
  new URL("../src/Nursery.jsx", import.meta.url),
  "utf8",
);
const css = await readFile(
  new URL("../src/cozy-theme.css", import.meta.url),
  "utf8",
);

assert.match(app, /lazy\(\(\) => import\("\.\/Nursery"\)\)/);
assert.match(app, /<Suspense/);
assert.match(nav, /id: "nursery"/);
assert.match(app, /<Nursery/);
assert.match(nursery, /apiRequest\("\/api\/v2\/nursery", \{/);
assert.match(nursery, /companion-actions/);
assert.match(nursery, /client_action_id/);
assert.match(nursery, /60 \* 1000/);
assert.match(nursery, /nursery-local-badge/);
assert.match(nursery, /成长画像/);
assert.doesNotMatch(nursery, /api[_-]?key|chat\/completions|embedding/i);
assert.match(css, /\.nursery-page\s*\{/);
assert.match(css, /\.nursery-care-grid button\s*\{[^}]*min-height:\s*76px/s);
assert.match(css, /@media \(max-width: 340px\)/);
assert.match(css, /\.nursery-state-grid,\s*\n\s*\.nursery-bonds\s*\{[^}]*grid-template-columns:\s*1fr/s);

console.log("zero-provider nursery UI regression tests passed");
