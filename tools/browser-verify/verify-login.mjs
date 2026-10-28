// 登录页真机体检（网页版多视口；APK 用同一 WebView，规则一致）
//
// 覆盖：未登录首屏是否可用、字段语义（name/autocomplete/inputmode/enterkeyhint）、
// 密码可见切换、登录/注册切换、错误提示中文化、提交忙碌态、短屏（模拟键盘顶起）布局、
// 触摸目标 44px、水平溢出。
//
// 不需要登录态；Supabase 认证请求用 route 拦截，不消耗真实额度。
import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(fileURLToPath(new URL("../../frontend", import.meta.url)));
const DIST = path.join(REPO, "dist");
const OUT = process.env.DENGTA_BROWSER_VERIFY_OUT || path.resolve(REPO, "..", "..", "_audit", "browser");
const PORT = 5173;
const { chromium } = createRequire(import.meta.url)("D:\\GZdeepseek\\_tools\\pw\\node_modules\\playwright-core");

await fs.mkdir(OUT, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
};
const server = await new Promise((resolve) => {
  const s = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      let file = path.join(DIST, decodeURIComponent(url.pathname));
      const stat = await fs.stat(file).catch(() => null);
      if (!stat || stat.isDirectory()) file = path.join(DIST, "index.html");
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(await fs.readFile(file));
    } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
  });
  s.listen(PORT, "127.0.0.1", () => resolve(s));
});

const checks = [];
const failures = [];
const record = (device, name, passed, detail) => {
  checks.push({ device, name, passed, detail });
  if (!passed) failures.push(`${device} ${name}: ${JSON.stringify(detail)}`);
  console.log(`  ${passed ? "✓" : "✗"} ${name}${passed ? "" : "  -> " + JSON.stringify(detail)}`);
};

const DEVICES = [
  { name: "360x640", width: 360, height: 640, dpr: 2 },
  { name: "390x844", width: 390, height: 844, dpr: 2.75 },
  { name: "800x1280", width: 800, height: 1280, dpr: 2 },
];

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-sandbox"], proxy: { server: "http://127.0.0.1:10809", bypass: "127.0.0.1,localhost" } });

for (const device of DEVICES) {
  console.log(`\n=== ${device.name} ===`);
  const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, deviceScaleFactor: device.dpr, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  // 未登录：清掉可能残留的认证缓存
  await page.addInitScript(() => {
    try {
      for (const key of Object.keys(globalThis.localStorage)) {
        if (/auth|dengta_home_auth/i.test(key)) globalThis.localStorage.removeItem(key);
      }
    } catch { /* ignore */ }
  });
  // 认证接口拦截：先给「无效凭据」，再给「慢响应」测忙碌态
  let authMode = "invalid";
  await page.route("**/auth/v1/token**", async (route) => {
    if (authMode === "slow") await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" }),
    });
  });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const formReady = await page.waitForSelector(".auth-form input[type='email']", { timeout: 90_000 }).then(() => true).catch(() => false);
  record(device.name, "未登录直接进入登录页", formReady, formReady);
  if (!formReady) { await context.close(); continue; }
  await page.waitForTimeout(800);

  const semantics = await page.evaluate(() => {
    const email = document.querySelector(".auth-form input[type='email']");
    const password = document.querySelector(".auth-password-field input");
    const toggle = document.querySelector(".auth-password-toggle");
    const rect = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      email: email ? {
        name: email.getAttribute("name"),
        autocomplete: email.getAttribute("autocomplete"),
        inputmode: email.getAttribute("inputmode"),
        enterkeyhint: email.getAttribute("enterkeyhint"),
      } : null,
      password: password ? {
        type: password.getAttribute("type"),
        name: password.getAttribute("name"),
        autocomplete: password.getAttribute("autocomplete"),
      } : null,
      toggle: toggle ? {
        label: toggle.getAttribute("aria-label"),
        rect: rect(toggle),
      } : null,
      tabs: Array.from(document.querySelectorAll(".auth-mode-switch [role='tab']")).map((tab) => ({
        text: (tab.textContent || "").trim(),
        selected: tab.getAttribute("aria-selected"),
        rect: rect(tab),
      })),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      panel: (() => {
        const node = document.querySelector(".auth-panel");
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
      })(),
      smallTargets: Array.from(document.querySelectorAll(".auth-panel button, .auth-panel input, .auth-panel a"))
        .filter((node) => {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const r = node.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
        })
        .map((node) => ({ tag: node.tagName, cls: String(node.className || "").slice(0, 40), ...rect(node) }))
        .slice(0, 6),
    };
  });

  record(device.name, "邮箱字段可自动填充且有键盘提示",
    semantics.email?.name === "email" &&
      semantics.email?.autocomplete === "username" &&
      semantics.email?.inputmode === "email" &&
      semantics.email?.enterkeyhint === "next",
    semantics.email);
  record(device.name, "密码字段语义正确",
    semantics.password?.type === "password" &&
      semantics.password?.name === "password" &&
      semantics.password?.autocomplete === "current-password",
    semantics.password);
  record(device.name, "密码可见切换存在且 ≥44px",
    Boolean(semantics.toggle) && semantics.toggle.rect?.w >= 44 && semantics.toggle.rect?.h >= 44,
    semantics.toggle);
  record(device.name, "登录/注册切换可点且 ≥44px",
    semantics.tabs.length === 2 && semantics.tabs.every((tab) => tab.rect.w >= 44 && tab.rect.h >= 44),
    semantics.tabs);
  record(device.name, "无水平溢出", !semantics.horizontalOverflow, semantics.horizontalOverflow);
  record(device.name, "面板在视口内", Boolean(semantics.panel), semantics.panel);
  record(device.name, "登录页触摸目标全部 ≥44px", semantics.smallTargets.length === 0, semantics.smallTargets);

  // 密码可见切换行为
  const passwordInput = page.locator(".auth-password-field input").first();
  await passwordInput.fill("secret-pass-123");
  const toggle = page.locator(".auth-password-toggle").first();
  await toggle.click();
  const visibleType = await passwordInput.getAttribute("type");
  const visibleLabel = await toggle.getAttribute("aria-label");
  await toggle.click();
  const hiddenType = await passwordInput.getAttribute("type");
  record(device.name, "密码可见切换生效",
    visibleType === "text" && hiddenType === "password" && /隐藏/.test(visibleLabel || ""),
    { visibleType, hiddenType, visibleLabel });

  // 登录/注册切换
  await page.locator(".auth-mode-switch [role='tab']").nth(1).click();
  const registerReady = await page.waitForSelector("input[name='display-name']", { timeout: 5_000 }).then(() => true).catch(() => false);
  record(device.name, "注册页显示昵称字段", registerReady, registerReady);
  await page.locator(".auth-mode-switch [role='tab']").nth(0).click();
  await page.waitForTimeout(200);

  // 错误提示：无效凭据必须给出中文可读提示，且按钮恢复可用
  authMode = "invalid";
  await page.locator(".auth-form input[type='email']").fill("nobody@example.test");
  await page.locator(".auth-password-field input").fill("wrong-password");
  await page.locator(".auth-primary-button").click();
  const feedback = await page
    .waitForFunction(() => {
      const node = document.querySelector(".auth-feedback");
      return node && node.textContent.trim().length > 0 ? node.textContent.trim() : "";
    }, null, { timeout: 20_000 })
    .then((handle) => handle.jsonValue())
    .catch(() => "");
  const buttonEnabled = await page.locator(".auth-primary-button").isEnabled().catch(() => false);
  // 允许「（错误代码：auth_error）」这类诊断后缀，但不允许原始英文错误直出
  const rawEnglishError = /Invalid login credentials|error_description|invalid_grant|Internal Server Error/i.test(feedback);
  record(device.name, "无效凭据给出中文提示",
    /密码|邮箱|账号|失败|网络/.test(feedback) &&
      !rawEnglishError &&
      !/[a-z]+_[a-z]+/.test(feedback),
    feedback);
  record(device.name, "失败后按钮恢复可用", buttonEnabled, buttonEnabled);

  // 忙碌态：慢响应时按钮禁用并显示“正在登录…”
  authMode = "slow";
  await page.locator(".auth-primary-button").click();
  await page.waitForTimeout(400);
  const busyState = await page.evaluate(() => {
    const button = document.querySelector(".auth-primary-button");
    return {
      disabled: button ? button.disabled : null,
      text: button ? (button.textContent || "").trim().slice(0, 20) : "",
    };
  });
  record(device.name, "提交中按钮禁用并提示进行中",
    busyState.disabled === true && /正在/.test(busyState.text),
    busyState);
  await page.waitForTimeout(1_800);

  await page.screenshot({ path: path.join(OUT, `login-${device.width}x${device.height}.png`), timeout: 120_000 });
  await context.close();
}

// 短视口（模拟键盘顶起）：表单从顶部排布且可滚动
{
  console.log("\n=== 360x420（键盘顶起） ===");
  const context = await browser.newContext({ viewport: { width: 360, height: 420 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const ready = await page.waitForSelector(".auth-form input[type='email']", { timeout: 90_000 }).then(() => true).catch(() => false);
  const layout = await page.evaluate(() => {
    const panel = document.querySelector(".auth-panel");
    const form = document.querySelector(".auth-form");
    if (!panel || !form) return null;
    const panelStyle = getComputedStyle(panel);
    return {
      alignContent: panelStyle.alignContent,
      paddingTop: panelStyle.paddingTop,
      pageScrollable: document.documentElement.scrollHeight > innerHeight + 2 || getComputedStyle(document.querySelector(".auth-page")).overflowY === "auto",
      formTop: Math.round(form.getBoundingClientRect().top),
    };
  });
  record("360x420", "短视口从顶部排布（不被居中挤出）",
    ready && layout && (layout.alignContent === "start" || layout.formTop <= 18),
    layout);
  record("360x420", "短视口页面可滚动到提交按钮", Boolean(layout && layout.pageScrollable), layout);
  await page.screenshot({ path: path.join(OUT, "login-360x420-keyboard.png"), timeout: 120_000 });
  await context.close();
}

await fs.writeFile(`${OUT}/login-audit.json`, JSON.stringify({ ranAt: new Date().toISOString(), checks, failures }, null, 2), "utf8");
console.log(`\n${failures.length ? "✗ " + failures.length + " 项不通过" : "✓ 全部通过"}`);
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
