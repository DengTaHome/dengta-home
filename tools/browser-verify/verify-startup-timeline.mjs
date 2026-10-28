// 启动时间线探针：量化「App chunk 预加载 + 启动请求并行」的收益。
//
// 记录（相对 navigationStart）：
//   appChunkStart  —— 聊天主界面 chunk 的请求开始时间
//   bootstrapStart —— /api/v2/bootstrap 请求开始时间
//   healthStart    —— /health 请求开始时间
//   firstMessage   —— 第一条消息气泡可见的时间
//
// 断言（本地构建、已登录）：
//   1. App chunk 在 1200ms 内开始下载（预加载生效，而不是等登录态解析后才 lazy）
//   2. /health 在 bootstrap 结束之前就已发出（并行，而不是排在 bootstrap 之后）
//   3. 首条消息 < 6000ms
//   4. 启动请求没有重复（bootstrap 只发一次）
import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(fileURLToPath(new URL("../../frontend", import.meta.url)));
const DIST = path.join(REPO, "dist");
const OUT = process.env.DENGTA_BROWSER_VERIFY_OUT || path.resolve(REPO, "..", "..", "_audit", "browser");
const CRED = path.join(OUT, "browser-auth.json");
const PORT = 5173;
const ANON = "sb_publishable_8igj37ucC_HG98LSFwnkHA_6QBtcE8F";
const TOKEN_URL = "https://nyyqizwrlmejpfdhgrnd.supabase.co/auth/v1/token?grant_type=password";
const { chromium } = createRequire(import.meta.url)("D:\\GZdeepseek\\_tools\\pw\\node_modules\\playwright-core");

await fs.mkdir(OUT, { recursive: true });
const creds = JSON.parse(fsSync.readFileSync(CRED, "utf8"));
const bodyPath = path.join(OUT, "_timeline-body.json");
fsSync.writeFileSync(bodyPath, JSON.stringify(creds));
const auth = JSON.parse(
  execFileSync("curl.exe", ["-s", "--max-time", "90", "--socks5-hostname", "127.0.0.1:10808",
    "-X", "POST", TOKEN_URL, "-H", `apikey: ${ANON}`, "-H", "Content-Type: application/json",
    "--data-binary", `@${bodyPath}`], { encoding: "utf8" })
);

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
    } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
  });
  s.listen(PORT, "127.0.0.1", () => resolve(s));
});

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-sandbox"], proxy: { server: "http://127.0.0.1:10809", bypass: "127.0.0.1,localhost" } });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
const page = await context.newPage();

const timeline = [];
const responses = [];
// 故意让 Supabase 的用户校验慢 1.5 秒：
// 没有预加载时，App chunk 必须等登录态确定后才开始下载，会落在这 1.5 秒之后；
// 有预加载时，chunk 一开始就下载，与登录校验并行。
const AUTH_DELAY_MS = process.env.DENGTA_TIMELINE_AUTH_DELAY === "0" ? 0 : 1_500;
await page.route("**/auth/v1/user**", async (route) => {
  if (AUTH_DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, AUTH_DELAY_MS));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: auth.user.id, email: auth.user.email }),
  });
});

page.on("request", (request) => {
  const url = request.url();
  timeline.push({ at: Date.now(), url });
});
let navigations = 0;
page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1; });
page.on("response", (response) => {
  const url = response.url();
  if (url.includes("/api/v2/bootstrap") || url.includes("/health")) {
    responses.push({ at: Date.now(), url: url.slice(0, 100) });
  }
});

const session = { access_token: auth.access_token, token_type: "bearer", expires_in: auth.expires_in, expires_at: Math.floor(Date.now() / 1000) + auth.expires_in - 60, refresh_token: auth.refresh_token, user: auth.user };
await page.addInitScript(([k, v]) => { try { globalThis.localStorage.setItem(k, v); } catch {} }, ["dengta_home_auth_v1", JSON.stringify(session)]);
// 真实登录用户本地同步存着伴侣 ID；不注入的话会把「首次发现伴侣」误当成 App 重挂，
// 造成 2 次 bootstrap 的假象（已验证）。
const COMPANION_ID = "d99ebbd8-5823-4e39-8be4-79a92be965c0";
await page.addInitScript(([userId, companionId]) => {
  try {
    globalThis.localStorage.setItem("dengta_active_companion_id_v1:" + userId, companionId);
  } catch {}
}, [auth.user.id, COMPANION_ID]);

const navigationStart = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForSelector(".main-panel", { timeout: 120_000 }).catch(() => {});
await page.waitForSelector(".session-select", { timeout: 90_000 }).catch(() => {});

// 保证有历史会话渲染出消息
const ensureChat = async () => {
  if ((await page.locator(".message-bubble").count()) > 0) return true;
  const items = page.locator(".session-select");
  const total = await items.count();
  for (let index = 0; index < Math.min(total, 6); index += 1) {
    await items.nth(index).evaluate((node) => node.click()).catch(() => {});
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.waitForTimeout(1_000);
      if ((await page.locator(".message-bubble").count()) > 0) return true;
    }
  }
  return false;
};
// 等首条消息或"没有历史会话"的明确空态，避免用 570ms 的假就绪做判断
let hasMessage = await ensureChat();
if (!hasMessage) {
  await page.waitForTimeout(6_000);
  hasMessage = (await page.locator(".message-bubble").count()) > 0;
}
// 等 bootstrap 真的回来（Render 冷启动时可到十几秒）
for (let index = 0; index < 60 && !responses.some((entry) => entry.url.includes("/api/v2/bootstrap")); index += 1) {
  await page.waitForTimeout(1_000);
}
const firstMessageAt = Date.now();
const readyMs = firstMessageAt - navigationStart;

const find = (needle) => timeline.find((entry) => entry.url.includes(needle));
const appChunk = find("/assets/App-") || find("App-");
const bootstrap = find("/api/v2/bootstrap");
const health = find("/health");
const relative = (entry) => (entry ? entry.at - navigationStart : null);
const bootstrapResponse = responses.find((entry) => entry.url.includes("/api/v2/bootstrap"));

const prefetchMarkMs = await page.evaluate(() => {
  const mark = performance.getEntriesByName("dengta:app-prefetch").at(-1);
  return mark ? Math.round(mark.startTime) : null;
});
const appChunkUrls = timeline.filter((e) => /\/assets\/App-/.test(e.url)).map((e) => ({ ms: e.at - navigationStart, url: e.url.split("/").pop() }));
const bootstrapUrls = timeline.filter((e) => e.url.includes("/api/v2/bootstrap")).map((e) => ({ ms: e.at - navigationStart, url: e.url.slice(0, 140) }));
const authRequests = timeline
  .filter((entry) => entry.url.includes("/auth/v1/"))
  .map((entry) => ({ ms: entry.at - navigationStart, url: entry.url.slice(0, 90) }));
const bootstrapRequests = timeline
  .filter((entry) => entry.url.includes("/api/v2/bootstrap"))
  .map((entry) => entry.at - navigationStart);

const data = {
  ranAt: new Date().toISOString(),
  prefetchMarkMs,
  bootstrapRequests,
  bootstrapUrls,
  appChunkUrls,
  navigations,
  authRequests,
  readyMs,
  hasMessage,
  appChunkStartMs: relative(appChunk),
  bootstrapStartMs: relative(bootstrap),
  bootstrapResponseMs: bootstrapResponse ? bootstrapResponse.at - navigationStart : null,
  healthStartMs: relative(health),
  bootstrapCount: timeline.filter((entry) => entry.url.includes("/api/v2/bootstrap")).length,
  appChunkCount: timeline.filter((entry) => /\/assets\/App-/.test(entry.url)).length,
};

const checks = [];
const check = (name, passed, detail) => {
  checks.push({ name, passed, detail });
  console.log(`  ${passed ? "✓" : "✗"} ${name}${passed ? "" : "  -> " + JSON.stringify(detail)}`);
};
check("页面进入聊天并出现消息", hasMessage, { readyMs });
check("App chunk 预加载在登录态之前触发（mark ≤800ms）",
  data.prefetchMarkMs !== null &&
    data.prefetchMarkMs <= 800 &&
    data.appChunkStartMs !== null &&
    data.appChunkStartMs <= data.prefetchMarkMs + 800,
  { prefetchMarkMs: data.prefetchMarkMs, appChunkStartMs: data.appChunkStartMs });
check("/health 与 bootstrap 并行（在 bootstrap 结束前发出）",
  data.healthStartMs !== null && data.bootstrapResponseMs !== null && data.healthStartMs <= data.bootstrapResponseMs,
  { healthStartMs: data.healthStartMs, bootstrapResponseMs: data.bootstrapResponseMs });
check("首条消息 < 12000ms", readyMs < 12_000, readyMs);
check("启动没有重复 bootstrap", data.bootstrapCount === 1, data.bootstrapCount);

await fs.writeFile(path.join(OUT, "startup-timeline.json"), JSON.stringify({ data, checks }, null, 2), "utf8");
console.log("\n时间线:", JSON.stringify(data, null, 2));
const failed = checks.filter((item) => !item.passed).length;
console.log(failed ? `\n✗ ${failed} 项不通过` : "\n✓ 全部通过");
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
