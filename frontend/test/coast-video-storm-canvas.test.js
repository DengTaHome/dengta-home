import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Execute the production 2D atmosphere hook against canvas call receipts. This
// checks rendered storm layers rather than matching implementation strings.
const source = fs.readFileSync(new URL("../src/CelestialBackdrop.jsx", import.meta.url), "utf8");
const componentAt = source.indexOf("export default function CelestialBackdrop");
const helpers = source.slice(0, componentAt).replace(/^import[^;]+;\r?\n/gm, "");

function drawFixture(mode, intensity = 1) {
  const calls = () => ({ fill: 0, stroke: 0, fillRect: 0, ellipses: 0, lines: 0 });
  const canvas = () => {
    const receipt = calls();
    const context = {
      setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, arc() {},
      fill() { receipt.fill++; }, stroke() { receipt.stroke++; }, fillRect() { receipt.fillRect++; },
      ellipse() { receipt.ellipses++; }, moveTo() {}, lineTo() { receipt.lines++; },
    };
    return { receipt, width: 0, height: 0, style: {}, getContext: () => context };
  };
  const stars = canvas(), clouds = canvas(), weather = canvas();
  const cleanups = [];
  const scope = {
    mode, intensity, stars, clouds, weather,
    useRef: value => ({ current: value }),
    useEffect: callback => { cleanups.push(callback()); },
    performance: { now: () => 0 },
    window: { devicePixelRatio: 1, innerWidth: 390, innerHeight: 844, addEventListener() {}, removeEventListener() {} },
    document: { hidden: false, documentElement: { dataset: {} }, querySelector: () => null },
    createVisualLoop(draw) { draw(1000); return { invalidate() {}, dispose() {} }; },
  };
  vm.runInNewContext(`${helpers}\nusePrototypeAtmosphere({ starsRef:{current:stars}, cloudsRef:{current:clouds}, weatherRef:{current:weather}, sky:{night:0,daylight:1}, mode, rainIntensity:intensity, reduceMotion:false });`, scope);
  cleanups.forEach(cleanup => cleanup?.());
  return { clouds: clouds.receipt, weather: weather.receipt };
}

test("actual clear atmosphere draws no cloud/rain/lightning weather layers", () => {
  const f = drawFixture("clear");
  assert.equal(f.clouds.fill, 0);
  assert.equal(f.weather.stroke, 0);
  assert.equal(f.weather.fillRect, 0);
});

test("actual normal rain draws dark cloud shapes and rain lines without lightning", () => {
  const f = drawFixture("rain");
  assert.equal(f.clouds.fill, 18);
  assert.ok(f.weather.lines >= 94);
  assert.ok(f.weather.stroke >= 94);
  assert.equal(f.weather.fillRect, 0);
  assert.ok(f.weather.ellipses >= 38, "glass drops must remain present alongside the rain");
});

test("actual thunderstorm paints heavy rain and clouds as well as the existing lightning flash", () => {
  const normal = drawFixture("rain", 1);
  const storm = drawFixture("storm", 1.6);
  assert.equal(storm.clouds.fill, 18);
  assert.ok(storm.weather.lines >= 150);
  assert.ok(storm.weather.stroke >= 150);
  assert.ok(storm.weather.stroke > normal.weather.stroke);
  assert.equal(storm.weather.fillRect, 1, "the existing lightning flash must remain active");
  assert.ok(storm.weather.ellipses >= 38, "storm glass drops and ripples cannot disappear");
});
