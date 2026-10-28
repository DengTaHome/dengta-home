// 真机验证 · 投屏接收端与涂鸦画室的触摸目标
//
// 这两个界面此前从未被量过：
//   /receive  —— 投屏接收端（电视/另一台设备打开的配对页）
//   涂鸦画室  —— 从侧边栏进入
// 规则同主界面：可交互元素的命中框不得小于 44×44。
import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(fileURLToPath(new URL("../../frontend", import.meta.url)));
const DIST = path.join(REPO, "dist");
const OUT = process.env.DENGTA_BROWSER_VERIFY_OUT || path.resolve(REPO, "..", "..", "_audit", "browser");
const PORT = Number(process.env.DENGTA_BROWSER_VERIFY_PORT || 5173);
const AUTH = process.env.DENGTA_BROWSER_VERIFY_AUTH || path.join(OUT, "auth.json");
const auth = JSON.parse(fsSync.readFileSync(AUTH, "utf8"));
const localRequire = createRequire(import.meta.url);
function loadPlaywright() {
    const roots = [
        process.env.DENGTA_PLAYWRIGHT_ROOT,
        path.resolve(REPO, "node_modules"),
        path.resolve(REPO, "..", "node_modules"),
        "D:\\GZdeepseek\\_tools\\pw\\node_modules"
    ].filter(Boolean);
    for (const root of roots) {
        try { return localRequire(path.join(root, "playwright-core")); } catch {}
    }
    try { return localRequire("playwright-core"); } catch {}
    throw new Error("找不到 playwright-core：装一个，或设置 DENGTA_PLAYWRIGHT_ROOT。");
}
const { chromium } = loadPlaywright();

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".webp": "image/webp", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".woff": "font/woff", ".ttf": "font/ttf" };
const server = await new Promise((resolve) => {
    const s = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
            let filePath = path.join(DIST, decodeURIComponent(url.pathname));
            const stat = await fs.stat(filePath).catch(() => null);
            if (!stat || stat.isDirectory()) filePath = path.join(DIST, "index.html");
            const body = await fs.readFile(filePath);
            res.writeHead(200, { "content-type": TYPES[path.extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
            res.end(body);
        } catch (error) { res.writeHead(500).end(String(error)); }
    });
    s.listen(PORT, "127.0.0.1", () => resolve(s));
});

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-sandbox"], proxy: { server: "http://127.0.0.1:10809", bypass: "127.0.0.1,localhost" } });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e).slice(0, 160)));

const session = { access_token: auth.access_token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3500, refresh_token: auth.refresh_token, user: auth.user };
await page.addInitScript(([k, v]) => { try { globalThis.localStorage.setItem(k, v); } catch {} }, ["dengta_home_auth_v1", JSON.stringify(session)]);

async function measure(scopeSelector) {
    return page.evaluate((selector) => {
        const MIN = 44;
        const root = selector ? (document.querySelector(selector) || document) : document;
        const nodes = Array.from(root.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]'));
        const undersized = [];
        for (const el of nodes) {
            const style = getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) continue;
            if (el.tagName === "INPUT" && el.type === "file") continue;
            if (String(el.className || "").includes("visually-hidden")) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) continue;
            if (rect.width >= MIN && rect.height >= MIN) continue;
            undersized.push({
                tag: el.tagName.toLowerCase(),
                cls: (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".").slice(0, 60),
                kind: [el.getAttribute("type") || "", el.getAttribute("placeholder") || ""].filter(Boolean).join(":"),
                label: (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent || "").trim().slice(0, 24),
                w: Math.round(rect.width),
                h: Math.round(rect.height)
            });
        }
        return { total: nodes.length, undersized };
    }, scopeSelector);
}

const surfaces = {};

// --- 投屏接收端 ---
await page.goto(`http://127.0.0.1:${PORT}/receive`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(6_000);
surfaces.receiver = await measure(null);
surfaces.receiver.heading = await page.evaluate(() => (document.querySelector("h1, h2, label")?.textContent || "").trim().slice(0, 40));
await page.screenshot({ path: `${OUT}\\touch-receiver.png`, timeout: 120_000 });

// --- 涂鸦画室 ---
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForSelector(".main-panel", { timeout: 180_000 }).catch(() => {});
await page.waitForTimeout(8_000);
const menuButton = page.locator('.menu-button, [aria-label*="打开菜单"]').first();
if (await menuButton.count()) {
    await menuButton.evaluate((node) => node.click()).catch(() => {});
    await page.waitForTimeout(1_000);
}
const artEntry = page.locator("button", { hasText: "涂鸦" }).first();
if (await artEntry.count()) {
    await artEntry.evaluate((node) => node.click());
    await page.waitForTimeout(4_000);
    surfaces.artStudio = await measure("main");
    await page.screenshot({ path: `${OUT}\\touch-art.png`, timeout: 120_000 });
} else {
    surfaces.artStudio = { total: 0, undersized: [], note: "没找到涂鸦入口" };
}

let offenders = 0;
for (const [name, surface] of Object.entries(surfaces)) {
    offenders += surface.undersized.length;
    console.log(`\n=== ${name} ===`);
    console.log(`  可交互元素 ${surface.total} 个，其中 ${surface.undersized.length} 个小于 44×44${surface.heading ? `  标题="${surface.heading}"` : ""}${surface.note ? `  ${surface.note}` : ""}`);
    for (const item of surface.undersized.slice(0, 12)) {
        console.log(`  ${String(item.w).padStart(3)}×${String(item.h).padStart(3)}  ${item.tag}.${item.cls}  ${item.kind}  "${item.label}"`);
    }
}
if (consoleErrors.length) {
    console.log("\nconsole 错误:");
    consoleErrors.slice(0, 6).forEach((line) => console.log("  " + line));
}

await fs.writeFile(`${OUT}\\touch-extra.json`, JSON.stringify({ surfaces, consoleErrors: consoleErrors.slice(0, 10) }, null, 2), "utf8");
await browser.close();
server.close();
process.exit(offenders > 0 ? 1 : 0);
