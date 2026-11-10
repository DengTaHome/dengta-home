// Requires Playwright on the Node resolution path and a running Vite dev server.
// Exercises existing fictional visualPreview components without account/model services.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const { chromium, webkit } = require("playwright");
const baseUrl = process.env.IOS_TEST_URL || "http://127.0.0.1:5173";
const outputDir = path.resolve(process.env.IOS_TEST_OUTPUT || "../artifacts/ios");
const engine = process.env.IOS_TEST_ENGINE || "chromium";
const browser = await (engine === "webkit" ? webkit : chromium).launch({
  headless: true,
  ...(engine === "chromium" ? { executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] } : {}),
});
await mkdir(outputDir, { recursive: true });
const reports = [];

async function checkLayout(page, label) {
  const result = await page.evaluate(() => {
    const visible = element => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && bounds.bottom > 0 && bounds.top < innerHeight;
    };
    return {
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      smallFields: [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]),textarea,select')]
        .filter(visible)
        .map(element => ({ label: element.getAttribute("aria-label") || element.name || element.tagName, size: parseFloat(getComputedStyle(element).fontSize) }))
        .filter(field => field.size < 16),
    };
  });
  assert.ok(result.scrollWidth <= result.width + 1, `${label}: horizontal document overflow ${JSON.stringify(result)}`);
  assert.deepEqual(result.smallFields, [], `${label}: editable controls would trigger iOS focus zoom`);
  await page.screenshot({ path: path.join(outputDir, `${engine}-${label}.png`), animations: "disabled" });
  reports.push({ label, ...result });
}

try {
  for (const [name, width, height] of [
    ["iphone-se", 375, 667],
    ["iphone", 390, 844],
    ["iphone-landscape", 844, 390],
    ["ipad-portrait", 820, 1180],
    ["ipad-landscape", 1024, 768],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.nativePlatform = "ios"; });
    });
    await page.route("**/_ios-preview", route => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN" data-native-platform="ios"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/src/visual-preview.jsx"></script></body></html>',
    }));
    // No external network is needed: this checks the unconfigured auth screen and fictional preview.
    await page.route("https://**", route => route.abort());
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => { document.documentElement.dataset.nativePlatform = "ios"; });
    await page.addStyleTag({ url: `${baseUrl}/src/ios.css` });
    await checkLayout(page, `${name}-auth`);
    await page.goto(`${baseUrl}/_ios-preview`, { waitUntil: "networkidle" });
    await page.addStyleTag({ url: `${baseUrl}/src/ios.css` });
    await page.locator(".composer textarea").waitFor();
    await checkLayout(page, `${name}-chat`);
    const composer = page.locator(".composer textarea").first();
    if (await composer.count()) {
      await composer.fill("这是一条虚构的 iOS 布局验证草稿。");
      await checkLayout(page, `${name}-composer-focused`);
    }
    const settings = page.getByRole("button", { name: "打开设置", exact: true });
    if (!await settings.isVisible()) {
      await page.getByRole("button", { name: /^展开.+的动态状态$/ }).click();
      await checkLayout(page, `${name}-status`);
    }
    await settings.click();
    await page.getByRole("dialog").waitFor();
    await checkLayout(page, `${name}-settings`);
    assert.deepEqual(errors, [], `${name}: uncaught page errors`);
    await page.close();
  }
  await writeFile(path.join(outputDir, `${engine}-layout-report.json`), JSON.stringify({ engine, reports, limitations: ["CSS viewport emulation does not emulate physical notches, the iOS software keyboard, native plugins, signing, or authenticated backend requests."] }, null, 2));
  console.log(`${engine}: ${reports.length} layout checks passed; evidence: ${outputDir}`);
} finally {
  await browser.close();
}
