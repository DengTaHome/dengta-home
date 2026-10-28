// 真机验证 · 冷启动健康检查重试
//
// 背景：打开 App 时若正好遇到后端冷启动，第一次 /health 会失败；
// 旧行为是整场都显示「语音暂不可用」，必须刷新页面才能恢复。
// 现在应该按 2/5/10/20 秒退避重试，并且在同一个页面里自己恢复。
//
// 做法：拦截 /health，前 2 次直接返回 503，之后正常转发（并把语音能力伪装成可用）。
// 断言：health 请求 ≥3 次、麦克风按钮最终出现、页面没有整页重载。
import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(fileURLToPath(new URL("../../frontend", import.meta.url)));
const DIST = path.join(REPO, "dist");
const OUT = "D:\\GZdeepseek\\_audit\\browser";
const CRED = path.join(OUT, "browser-auth.json");
const PORT = 5174;
const ANON = "sb_publishable_8igj37ucC_HG98LSFwnkHA_6QBtcE8F";
const TOKEN_URL = "https://nyyqizwrlmejpfdhgrnd.supabase.co/auth/v1/token?grant_type=password";
const localRequire = createRequire(import.meta.url);
const { chromium } = localRequire("D:\\GZdeepseek\\_tools\\pw\\node_modules\\playwright-core");

await fs.mkdir(OUT, { recursive: true });
const creds = JSON.parse(fsSync.readFileSync(CRED, "utf8"));
const bodyPath = path.join(OUT, "_health-body.json");
fsSync.writeFileSync(bodyPath, JSON.stringify(creds));
const raw = execFileSync("curl.exe", ["-s", "--max-time", "90", "--socks5-hostname", "127.0.0.1:10808",
  "-X", "POST", TOKEN_URL, "-H", `apikey: ${ANON}`, "-H", "Content-Type: application/json",
  "--data-binary", `@${bodyPath}`], { encoding: "utf8" });
const auth = JSON.parse(raw);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".webp": "image/webp" };
const server = await new Promise((resolve) => {
  const s = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      let file = path.join(DIST, decodeURIComponent(url.pathname));
      const stat = await fs.stat(file).catch(() => null);
      if (!stat || stat.isDirectory()) file = path.join(DIST, "index.html");
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(await fs.readFile(file));
    } catch (error) { res.writeHead(500).end(String(error)); }
  });
  s.listen(PORT, "127.0.0.1", () => resolve(s));
});

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-sandbox"], proxy: { server: "http://127.0.0.1:10809", bypass: "127.0.0.1,localhost" } });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
const page = await context.newPage();
let healthCalls = 0;
let navigations = 0;
page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1; });
const seenHealthUrls = [];
page.on("request", (request) => {
    if (request.url().includes("health")) seenHealthUrls.push(request.url());
});

await page.route(/\/health(\?|$)/, async (route) => {
  healthCalls += 1;
  if (healthCalls <= 2) {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "waking up" }) });
    return;
  }
  try {
    const response = await route.fetch();
    const json = await response.json();
    json.features = { ...(json.features || {}), hervoice_proxy_configured: true };
    await route.fulfill({ response, json });
  } catch {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, features: { hervoice_proxy_configured: true } }) });
  }
});
const session = { access_token: auth.access_token, token_type: "bearer", expires_in: auth.expires_in, expires_at: Math.floor(Date.now() / 1000) + auth.expires_in - 60, refresh_token: auth.refresh_token, user: auth.user };
await page.addInitScript(([k, v]) => { try { globalThis.localStorage.setItem(k, v); } catch {} }, ["dengta_home_auth_v1", JSON.stringify(session)]);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
const navAfterLoad = navigations;

const appeared = await page.waitForSelector(".chat-voice-button", { timeout: 90_000 }).then(() => true).catch(() => false);
const state = await page.evaluate(() => {
  const button = document.querySelector(".chat-voice-button");
  return {
    visible: Boolean(button),
    label: button ? button.getAttribute("aria-label") : null,
    bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 160),
  };
});
const checks = [
  { name: "健康检查发生重试（≥3 次）", passed: healthCalls >= 3, detail: healthCalls },
  { name: "重试后麦克风恢复可用", passed: appeared && state.visible, detail: state },
  { name: "没有靠整页刷新恢复", passed: navigations === navAfterLoad, detail: { navigations, navAfterLoad } },
];
await page.screenshot({ path: path.join(OUT, "health-retry-390x844.png"), timeout: 120_000 }).catch(() => {});
console.log("  诊断: healthCalls=" + healthCalls + " urls=" + JSON.stringify(seenHealthUrls.slice(0, 3)) + " body=" + state.bodyText);
for (const check of checks) console.log(`  ${check.passed ? "✓" : "✗"} ${check.name}${check.passed ? "" : " -> " + JSON.stringify(check.detail)}`);
const failed = checks.filter((check) => !check.passed).length;
console.log(failed ? `\n✗ ${failed} 项不通过` : "\n✓ 全部通过");
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
