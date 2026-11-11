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
const phase2 = process.env.IOS_TEST_SUITE === "phase2";

async function checkLayout(page, label) {
  await page.screenshot({ path: path.join(outputDir, `${engine}-${label}.png`), animations: "disabled" });
  const result = await page.evaluate(() => {
    const visible = element => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && bounds.bottom > 0 && bounds.top < innerHeight && bounds.right > 0 && bounds.left < innerWidth && (!element.checkVisibility || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
    };
    return {
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      viewportHeight: window.visualViewport?.height ?? innerHeight,
      appHeight: getComputedStyle(document.documentElement).getPropertyValue("--app-height").trim(),
      keyboardOpen: document.documentElement.dataset.keyboardOpen || null,
      smallFields: [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]),textarea,select')]
        .filter(visible)
        .map(element => ({ label: element.getAttribute("aria-label") || element.name || element.tagName, size: parseFloat(getComputedStyle(element).fontSize) }))
        .filter(field => field.size < 16),
      smallTapTargets: [...document.querySelectorAll('button,a[href],summary')].filter(visible).map(element => {
        const bounds = element.getBoundingClientRect();
        return { label: element.getAttribute("aria-label") || element.textContent.trim().slice(0, 48), width: Math.round(bounds.width), height: Math.round(bounds.height) };
      }).filter(target => target.width < 44 || target.height < 44),
      smallEssentialTapTargets: [...document.querySelectorAll('.sun-glass-status-window-actions>button,.settings-gear-button,.menu-button,.new-chat-top,.send-button,.memory-card-actions button,.memory-summary-toolbar button')].filter(visible).map(element => {
        const bounds = element.getBoundingClientRect();
        return { label: element.getAttribute("aria-label") || element.textContent.trim().slice(0, 48), width: Math.round(bounds.width), height: Math.round(bounds.height) };
      }).filter(target => target.width < 44 || target.height < 44),
    };
  });
  assert.ok(result.scrollWidth <= result.width + 1, `${label}: horizontal document overflow ${JSON.stringify(result)}`);
  assert.deepEqual(result.smallFields, [], `${label}: editable controls would trigger iOS focus zoom`);
  assert.deepEqual(result.smallEssentialTapTargets, [], `${label}: essential touch controls are below the 44px iOS recommendation`);
  reports.push({ label, ...result });
  await writeFile(path.join(outputDir, `${engine}-partial-layout-report.json`), JSON.stringify({ engine, suite: phase2 ? "phase2" : "baseline", reports }, null, 2));
}

async function installFictionalNetwork(page) {
  await page.route("https://**", route => route.abort());
  await page.route("http://localhost:3000/**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({}) }));
}

async function installViewportSimulation(page) {
  await page.addInitScript(() => {
    const state = { height: null, offsetTop: 0 };
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      height: { get: () => state.height ?? window.innerHeight },
      width: { get: () => window.innerWidth },
      offsetTop: { get: () => state.offsetTop },
      offsetLeft: { get: () => 0 },
      scale: { get: () => 1 },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => viewport });
    window.__iosViewportSimulation = (height = null, offsetTop = 0) => {
      state.height = height; state.offsetTop = offsetTop;
      viewport.dispatchEvent(new Event("resize"));
    };
  });
}

async function settleFrames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function simulateSafeInsets(page, insets) {
  // Browser env(safe-area-inset-*) is zero. Preserve stylesheet cascade order
  // while substituting fixture values; this is a CSS simulation, not notch hardware.
  await page.evaluate(values => {
    for (const sheet of [...document.styleSheets]) {
      if (sheet.disabled || sheet.ownerNode?.dataset.iosSimulation) continue;
      let css;
      try { css = [...sheet.cssRules].map(rule => rule.cssText).join("\n"); } catch { continue; }
      if (!css.includes("safe-area-inset-")) continue;
      const style = document.createElement("style");
      style.dataset.iosSimulation = "true";
      style.textContent = css.replace(/env\(safe-area-inset-(top|bottom|left|right)(?:\s*,[^)]+)?\)/g, (_, side) => `${values[side] || 0}px`);
      sheet.ownerNode.after(style);
      sheet.disabled = true;
    }
    document.documentElement.dataset.iosInsetSimulation = JSON.stringify(values);
  }, insets);
  await settleFrames(page);
}

async function openSettings(page) {
  let settings = page.getByRole("button", { name: "打开设置", exact: true });
  if (!await settings.isVisible()) await page.getByRole("button", { name: /^展开.+的动态状态$/ }).click();
  settings = page.getByRole("button", { name: "打开设置", exact: true }).first();
  await settings.click();
  await page.getByRole("dialog").waitFor();
}

async function openNavigation(page) {
  const outside = await page.locator(".sidebar").evaluate(element => getComputedStyle(element).position === "fixed" && !element.classList.contains("open"));
  if (!outside) return false;
  const menu = page.getByRole("button", { name: "打开菜单", exact: true });
  if (await menu.isVisible()) await menu.click();
  else {
    const toggle = page.getByRole("button", { name: /^展开.+的动态状态$/ });
    if (await toggle.count()) await toggle.click();
    await page.getByRole("button", { name: "打开侧边导航", exact: true }).click();
  }
  await page.locator(".sidebar.open").waitFor();
  return true;
}

async function verifyPhase2() {
  for (const [name, width, height] of [
    ["iphone-se", 375, 667], ["iphone15-pro", 393, 852], ["iphone-pro-max", 430, 932],
    ["iphone15-landscape", 852, 393], ["iphone-pro-max-landscape", 932, 430],
    ["ipad-portrait", 820, 1180], ["ipad-landscape", 1024, 768],
  ].filter(([name]) => !process.env.IOS_TEST_DEVICES || process.env.IOS_TEST_DEVICES.split(",").includes(name))) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await installFictionalNetwork(page);
    await installViewportSimulation(page);
    if (process.env.IOS_TEST_VIEWS !== "memory") {
    await page.goto(`${baseUrl}/test/ios-phase2-preview.html?view=auth`, { waitUntil: "networkidle" });
    await page.getByLabel("邮箱", { exact: true }).waitFor();
    await checkLayout(page, `${name}-configured-login`);
    await page.locator(".auth-page").evaluate(element => { element.scrollTop = element.scrollHeight; });
    await checkLayout(page, `${name}-login-scrolled-bottom`);
    const loginScroll = await page.locator(".auth-page").evaluate(element => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }));
    assert.ok(loginScroll.clientHeight <= height + 1, `${name}: login scroll container exceeds viewport`);
    if (loginScroll.scrollHeight > loginScroll.clientHeight + 1) assert.ok(loginScroll.scrollTop > 0, `${name}: login content is clipped without scrolling`);
    const email = page.getByLabel("邮箱", { exact: true });
    await email.fill("fictional@example.test");
    const keyboardHeight = Math.max(230, height - 330);
    await page.evaluate(next => window.__iosViewportSimulation(next), keyboardHeight);
    await settleFrames(page);
    await email.scrollIntoViewIfNeeded();
    await checkLayout(page, `${name}-login-simulated-keyboard`);
    assert.equal(await page.locator("html").getAttribute("data-keyboard-open"), "true", `${name}: auth does not track simulated viewport`);
    assert.equal(await page.locator(".auth-page").evaluate(element => element.clientHeight), keyboardHeight, `${name}: auth does not shrink to visible viewport`);
    await page.evaluate(() => { document.activeElement?.blur(); window.__iosViewportSimulation(); });
    await settleFrames(page);

    await page.goto(`${baseUrl}/test/ios-phase2-preview.html`, { waitUntil: "networkidle" });
    await page.locator(".composer textarea").waitFor();
    await checkLayout(page, `${name}-chat`);
    await page.locator(".composer textarea").fill("虚构草稿：一起记录今天的小事。");
    await page.evaluate(next => window.__iosViewportSimulation(next), keyboardHeight);
    await settleFrames(page);
    await checkLayout(page, `${name}-chat-simulated-keyboard`);
    const composerBottom = await page.locator(".composer").evaluate(element => element.getBoundingClientRect().bottom);
    assert.ok(composerBottom <= keyboardHeight + 1, `${name}: composer extends below simulated visible viewport (${composerBottom} > ${keyboardHeight})`);
    await page.evaluate(() => { document.activeElement?.blur(); window.__iosViewportSimulation(); });
    await settleFrames(page);
    await openSettings(page);
    await checkLayout(page, `${name}-settings`);
    const search = page.getByPlaceholder("试试“记忆”“语音”或“备份”");
    await search.fill("记忆");
    await page.evaluate(next => window.__iosViewportSimulation(next), keyboardHeight);
    await settleFrames(page);
    // A synthetic visualViewport cannot run WebKit's native input-avoidance.
    // Explicitly scroll the focused field through the real modal scroll area.
    await search.scrollIntoViewIfNeeded();
    await checkLayout(page, `${name}-settings-simulated-keyboard`);
    const modalBottom = await page.locator(".settings-sheet").evaluate(element => element.getBoundingClientRect().bottom);
    assert.ok(modalBottom <= keyboardHeight + 1, `${name}: settings extends below simulated visible viewport (${modalBottom} > ${keyboardHeight})`);
    const searchBottom = await search.evaluate(element => element.getBoundingClientRect().bottom);
    assert.ok(searchBottom <= keyboardHeight + 1, `${name}: settings search cannot scroll above simulated keyboard`);
    await page.evaluate(() => { document.activeElement?.blur(); window.__iosViewportSimulation(); });
    await settleFrames(page);
    if (["iphone15-pro", "iphone-pro-max-landscape"].includes(name)) {
      const insets = width > height ? { top: 0, right: 59, bottom: 21, left: 59 } : { top: 59, right: 0, bottom: 34, left: 0 };
      await simulateSafeInsets(page, insets);
      await checkLayout(page, `${name}-settings-simulated-safe-insets`);
      const done = await page.getByRole("button", { name: "Done", exact: true }).evaluate(element => element.getBoundingClientRect().toJSON());
      assert.ok(done.x >= insets.left && done.right <= width - insets.right, `${name}: Done overlaps simulated unsafe horizontal area`);
    }
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const drawer = await openNavigation(page);
    await checkLayout(page, `${name}-navigation`);
    if (drawer) {
      await page.mouse.click(width - 8, Math.round(height / 2));
      await page.locator(".sidebar.open").waitFor({ state: "hidden" });
      await openNavigation(page);
    }
    await page.locator(".primary-nav button").filter({ hasText: "查看和管理聊天记忆" }).click();
    await page.locator(".memory-page").waitFor();
    await checkLayout(page, `${name}-memory-navigation`);
    }
    await page.goto(`${baseUrl}/test/ios-phase2-preview.html?view=memory`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "修改", exact: true }).waitFor();
    await checkLayout(page, `${name}-memory`);
    await page.getByRole("button", { name: "修改", exact: true }).click();
    await page.getByRole("textbox", { name: "修改长期记忆" }).fill("虚构记忆修改草稿，未提交真实服务。");
    await checkLayout(page, `${name}-memory-edit`);
    assert.deepEqual(errors, [], `${name}: uncaught page errors`);
    await page.close();
  }
}

try {
  if (phase2) await verifyPhase2();
  else {
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
  }
  await writeFile(path.join(outputDir, `${engine}-layout-report.json`), JSON.stringify({ engine, suite: phase2 ? "phase2" : "baseline", reports, limitations: ["CSS viewport emulation does not emulate physical notches, the iOS software keyboard, native plugins, signing, or authenticated backend requests.", "phase2 uses a synthetic visualViewport, CSS env substitution for named safe inset screenshots, and fictional seeded memory components; it does not verify native keyboard or account persistence.", "smallTapTargets are advisory measurements against the 44px iOS recommendation, not automatic WCAG conformance claims."] }, null, 2));
  console.log(`${engine}: ${reports.length} layout checks passed; evidence: ${outputDir}`);
} finally {
  await browser.close();
}
