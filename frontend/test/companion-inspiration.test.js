import assert from "node:assert/strict";
import { COMPANION_INSPIRATIONS, pickCompanionInspiration } from "../src/companion-inspiration.js";
assert.equal(new Set(COMPANION_INSPIRATIONS.map(item => item.id)).size, COMPANION_INSPIRATIONS.length);
for (const item of COMPANION_INSPIRATIONS) for (const random of [0, .5, 1, NaN, -1]) {
  const next = pickCompanionInspiration(item.id, () => random);
  assert.notEqual(next.id, item.id);
  assert.ok(next.draft.length > 10);
}
console.log("Companion inspiration selection varies, preserves drafts and handles random boundaries.");
