// 真机验证 · 触摸目标（多界面）
//
// 用户反复说「触屏点不动」。这里在真浏览器里逐个量可交互元素的实际命中框：
// 主界面 → 状态面板（点胶囊展开）→ 设置（点状态面板里的齿轮），
// 任何界面只要有一个小于 44×44 就退出码 1。
import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// 仓库内版本：路径可覆盖，默认按仓库结构推导。
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
const session = {
    access_token: auth.access_token, token_type: "bearer", expires_in: auth.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + auth.expires_in - 60,
    refresh_token: auth.refresh_token, user: auth.user
};
await page.addInitScript(([key, value]) => { try { globalThis.localStorage.setItem(key, value); } catch {} }, ["dengta_home_auth_v1", JSON.stringify(session)]);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForSelector(".main-panel", { timeout: 180_000 }).catch(() => {});
await page.waitForTimeout(10_000);

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
const notes = {};

surfaces.main = await measure(null);
await page.screenshot({ path: `${OUT}\\touch-main.png`, timeout: 120_000 });

try {
    const capsule = page.locator(".sun-glass-liquid-capsule-toggle").first();
    if (await capsule.count()) {
        await capsule.click({ timeout: 8_000 });
        await page.waitForTimeout(1_500);
        surfaces.statusPanel = await measure(".status-panel");
        await page.screenshot({ path: `${OUT}\\touch-status.png`, timeout: 120_000 });

        const gear = page.locator('.status-panel [title="设置"], .status-panel [aria-label*="设置"]').first();
        if (await gear.count()) {
            await gear.click({ timeout: 8_000 });
            await page.waitForTimeout(2_500);
            surfaces.settings = await measure("main");
            await page.screenshot({ path: `${OUT}\\touch-settings.png`, timeout: 120_000 });
        } else {
            notes.settings = "状态面板里没找到设置齿轮";
        }
    } else {
        notes.statusPanel = "没找到状态胶囊";
    }
} catch (error) {
    notes.error = String(error).slice(0, 160);
}


// 音乐界面：侧边栏在移动端是抽屉，先点「打开菜单」再点「听歌」。
// 顺带记录 <audio> 的播放状态——用户提过「自动播放音乐」，要事实不要猜测。
try {
    const menuButton = page.locator('.menu-button, [aria-label*="打开菜单"]').first();
    if (await menuButton.count()) {
        await menuButton.evaluate((node) => node.click()).catch(() => {});
        await page.waitForTimeout(1_000);
    }
    const musicEntry = page.locator('button', { hasText: "听歌" }).first();
    if (await musicEntry.count()) {
        // 抽屉里的元素可能在视口外，直接派发 DOM 点击更稳。
        await musicEntry.evaluate((node) => node.click());
        await page.waitForTimeout(3_000);
        surfaces.music = await measure("main");
        const audioState = await page.evaluate(() => Array.from(document.querySelectorAll("audio")).map((node) => ({
            src: (node.currentSrc || node.src || "").slice(0, 60),
            paused: node.paused,
            muted: node.muted,
            autoplay: node.autoplay
        })));
        notes.musicAudio = JSON.stringify(audioState).slice(0, 400);
        await page.screenshot({ path: `${OUT}\\touch-music.png`, timeout: 120_000 });
    } else {
        notes.music = "侧边栏里没找到听歌入口";
    }
} catch (error) {
    notes.musicError = String(error).slice(0, 140);
}

await fs.writeFile(`${OUT}\\touch-targets.json`, JSON.stringify({ ranAt: new Date().toISOString(), surfaces, notes }, null, 2), "utf8");

let offenders = 0;
for (const [name, surface] of Object.entries(surfaces)) {
    offenders += surface.undersized.length;
    console.log(`\n=== ${name} ===`);
    console.log(`  可交互元素 ${surface.total} 个，其中 ${surface.undersized.length} 个小于 44×44`);
    for (const item of surface.undersized.slice(0, 15)) {
        console.log(`  ${String(item.w).padStart(3)}×${String(item.h).padStart(3)}  ${item.tag}.${item.cls}  ${item.kind}  "${item.label}"`);
    }
}
for (const [key, value] of Object.entries(notes)) console.log(`\n[note] ${key}: ${value}`);

await browser.close();
server.close();
process.exit(offenders > 0 ? 1 : 0);
