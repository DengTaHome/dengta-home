import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { getSunGlassSky } from "../src/sun-glass-sky.js";

test("the visible morning moon never teleports at 07:00", () => {
  const before = getSunGlassSky(419.99), after = getSunGlassSky(420);
  assert.ok(before.moonOpacity > .9 && after.moonOpacity > .9);
  assert.ok(Math.abs(before.moonX - after.moonX) < .01);
  assert.ok(Math.abs(before.moonY - after.moonY) < .01);
});

test("midnight preserves the visible moon and seamless sky colors", () => {
  const before = getSunGlassSky(1439.99), after = getSunGlassSky(0);
  assert.ok(Math.abs(before.moonX - after.moonX) < .01);
  assert.ok(Math.abs(before.moonY - after.moonY) < .01);
  assert.equal(before.moonOpacity, after.moonOpacity);
  assert.deepEqual(before.colors, after.colors);
});

test("the moon resets its path only while completely hidden at midday", () => {
  for (const minute of [719.99, 720, 720.01]) assert.equal(getSunGlassSky(minute).moonOpacity, 0);
  assert.ok(getSunGlassSky(719.99).moonX > 90);
  assert.ok(getSunGlassSky(720).moonX < 10);
});

test("sun and night trajectory anchor points remain unchanged", () => {
  assert.equal(getSunGlassSky(450).sunX, 7);
  assert.equal(getSunGlassSky(810).sunY, 18);
  assert.equal(getSunGlassSky(1170).sunX, 93);
  assert.equal(getSunGlassSky(1230).moonX, 7);
  assert.equal(getSunGlassSky(105).moonY, 20);
});

test("all minute values and malformed clock inputs produce usable sky properties", () => {
  for (const minute of [...Array.from({ length: 1441 }, (_, index) => index), -1, 2880, NaN, Infinity, undefined, "not-a-clock"]) {
    const sky = getSunGlassSky(minute);
    for (const [key, value] of Object.entries(sky)) if (key !== "colors") assert.ok(Number.isFinite(value), `${key} must be finite`);
    assert.ok(sky.colors.every(color => /^rgb\(\d+ \d+ \d+\)$/.test(color)));
  }
});

test("galaxy shorthand resets precede explicit positioning offsets", () => {
  const css = readFileSync(new URL("../src/sun-glass-ui.css", import.meta.url), "utf8");
  const rule = css.match(/\.celestial-prototype-sky \.celestial-milky-way\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.ok(rule.indexOf("inset: auto") < rule.indexOf("left: -14%"));
  assert.ok(rule.indexOf("inset: auto") < rule.indexOf("top: 15%"));
});
