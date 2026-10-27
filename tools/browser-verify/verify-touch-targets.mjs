// 真机验证 · 触摸目标
//
// 用户反复说「触屏点不动」。之前只能靠审查员读 CSS 推测，这里改成在真浏览器里
// 逐个量可交互元素的实际命中框，把小于 44×44 的列出来。
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
const CRED = process.env.DENGTA_BROWSER_VERIFY_CREDENTIALS || path.join(OUT, "browser-auth.json");
const PORT = Number(process.env.DENGTA_BROWSER_VERIFY_PORT || 5173);
const ANON = "sb_publishable_8igj37ucC_HG98LSFwnkHA_6QBtcE8F";
const TOKEN_URL = "https://nyyqizwrlmejpfdhgrnd.supabase.co/auth/v1/token?grant_type=password";

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
await fs.mkdir(OUT, { recursive: true });

const creds = JSON.parse(fsSync.readFileSync(CRED, "utf8"));
const bodyPath = path.join(OUT, "_tt-body.json");
fsSync.writeFileSync(bodyPath, JSON.stringify(creds));
const auth = JSON.parse(execFileSync("curl.exe", [
    "-s", "--max-time", "90", "--socks5-hostname", "127.0.0.1:10808",
    "-X", "POST", TOKEN_URL, "-H", `apikey: ${ANON}`, "-H", "Content-Type: application/json",
    "--data-binary", `@${bodyPath}`
], { encoding: "utf8" }));
if (!auth.access_token) throw new Error("token 获取失败");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".webp": "image/webp", ".mp4": "video/mp4" };
const server = await new Promise((resolve) => {
    const s = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
            let filePath = path.join(DIST, decodeURIComponent(url.pathname));
            if (!filePath.startsWith(DIST)) { res.writeHead(403).end(); return; }
            const stat = await fs.stat(filePath).catch(() => null);
            if (!stat || stat.isDirectory()) filePath = path.join(DIST, "index.html");
            const body = await fs.readFile(filePath);
            res.writeHead(200, { "content-type": TYPES[path.extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
            res.end(body);
        } catch (error) { res.writeHead(500).end(String(error)); }
    });
    s.listen(PORT, "127.0.0.1", () => resolve(s));
});

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-sandbox"], proxy: { server: "http://127.0.0.1:10809" } });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const session = { access_token: auth.access_token, token_type: "bearer", expires_in: auth.expires_in, expires_at: Math.floor(Date.now() / 1000) + auth.expires_in - 60, refresh_token: auth.refresh_token, user: auth.user };
await page.addInitScript(([k, v]) => { try { globalThis.localStorage.setItem(k, v); } catch {} }, ["dengta_home_auth_v1", JSON.stringify(session)]);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForSelector(".main-panel", { timeout: 180_000 }).catch(() => {});
await page.waitForTimeout(10_000);

// 打开侧边栏 → 设置
const opened = { sidebar: false, settings: false };
for (const selector of ['[aria-label*="菜单"]', '[aria-label*="导航"]', ".mobile-command-trigger", 'button:has-text("☰")']) {
    try {
        const trigger = page.locator(selector).first();
        if (await trigger.count()) { await trigger.click({ timeout: 5_000 }); opened.sidebar = true; await page.waitForTimeout(1_500); break; }
    } catch {}
}
for (const selector of ['button:has-text("设置")', '[aria-label*="设置"]', 'a:has-text("设置")']) {
    try {
        const entry = page.locator(selector).first();
        if (await entry.count()) { await entry.click({ timeout: 5_000 }); opened.settings = true; await page.waitForTimeout(2_500); break; }
    } catch {}
}

const measure = () => page.evaluate(() => {
    const MIN = 44;
    const items = [];
    const nodes = Array.from(document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]'));
    for (const el of nodes) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        // 隐藏的文件输入不算触摸目标：靠外部 label 触发，本身 1×1 且视觉隐藏
        if (el.tagName === "INPUT" && el.type === "file") continue;
        if (String(el.className || "").includes("visually-hidden")) continue;
        const small = rect.width < MIN || rect.height < MIN;
        if (!small) continue;
        const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
        items.push({
            tag: el.tagName.toLowerCase(),
            cls: cls.slice(0, 60),
            label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24),
            w: Math.round(rect.width),
            h: Math.round(rect.height)
        });
    }
    return { total: nodes.length, undersized: items };
});

const mainSurface = await measure();
await page.screenshot({ path: `${OUT}\\touch-main.png`, timeout: 120_000 });

const report = { ranAt: new Date().toISOString(), opened, mainSurface };
await fs.writeFile(`${OUT}\\touch-targets.json`, JSON.stringify(report, null, 2), "utf8");

console.log(`侧边栏打开: ${opened.sidebar}  设置打开: ${opened.settings}`);
console.log(`\n=== 主界面触摸目标 ===`);
console.log(`  可交互元素 ${mainSurface.total} 个，其中 ${mainSurface.undersized.length} 个小于 44×44`);
for (const item of mainSurface.undersized.slice(0, 20)) {
    console.log(`  ${String(item.w).padStart(3)}×${String(item.h).padStart(3)}  ${item.tag}.${item.cls}  "${item.label}"`);
}

await browser.close();
server.close();
process.exit(mainSurface.undersized.length > 0 ? 1 : 0);
