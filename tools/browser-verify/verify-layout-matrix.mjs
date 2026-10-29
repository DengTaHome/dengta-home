// 真机验证 · 多尺寸安卓屏幕适配
//
// 在一组真实安卓机型视口下加载应用，等界面真正就绪后检查：
//   - 水平溢出（页面能左右滑动）
//   - 交互元素被推出视口（点到屏幕外）
//   - 输入框/底栏被裁或落在屏幕外
//   - 触摸目标 < 44px
//   - 文本被容器裁掉（排除 line-clamp 与装饰元素）
//
// 会刻意排除：off-canvas 侧边栏、visually-hidden 输入、装饰图层。
//
// 用法：node tools/browser-verify/verify-layout-matrix.mjs
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
const AUTH = process.env.DENGTA_BROWSER_VERIFY_AUTH || path.join(OUT, "auth.json");
const CRED = process.env.DENGTA_BROWSER_VERIFY_CREDENTIALS || path.join(OUT, "browser-auth.json");
const PORT = Number(process.env.DENGTA_BROWSER_VERIFY_PORT || 5173);
const SUPABASE_ANON = process.env.DENGTA_SUPABASE_ANON || "sb_publishable_8igj37ucC_HG98LSFwnkHA_6QBtcE8F";
const SUPABASE_TOKEN_URL = process.env.DENGTA_SUPABASE_TOKEN_URL || "https://nyyqizwrlmejpfdhgrnd.supabase.co/auth/v1/token?grant_type=password";

const localRequire = createRequire(import.meta.url);
function loadPlaywright() {
    const roots = [process.env.DENGTA_PLAYWRIGHT_ROOT, path.join(REPO, "node_modules"), path.join(REPO, "..", "node_modules"), "D:\\GZdeepseek\\_tools\\pw\\node_modules"].filter(Boolean);
    for (const root of roots) {
        try { return localRequire(path.join(root, "playwright-core")); } catch { /* 继续 */ }
    }
    try { return localRequire("playwright-core"); } catch { /* 继续 */ }
    throw new Error("找不到 playwright-core");
}

const DEVICES = [
    { name: "320x568-dpr2-se1", width: 320, height: 568, dpr: 2 },
    { name: "360x640-dpr2-small", width: 360, height: 640, dpr: 2 },
    { name: "360x800-dpr3-tall", width: 360, height: 800, dpr: 3 },
    { name: "375x667-dpr2-se2", width: 375, height: 667, dpr: 2 },
    { name: "375x812-dpr3-x", width: 375, height: 812, dpr: 3 },
    { name: "390x844-dpr3-14", width: 390, height: 844, dpr: 3 },
    { name: "393x873-dpr2.75-pixel", width: 393, height: 873, dpr: 2.75 },
    { name: "412x915-dpr2.625-large", width: 412, height: 915, dpr: 2.625 },
    { name: "414x896-dpr2-xr", width: 414, height: 896, dpr: 2 },
    { name: "428x926-dpr3-max", width: 428, height: 926, dpr: 3 },
    { name: "430x932-dpr3-pro", width: 430, height: 932, dpr: 3 },
    { name: "480x1040-dpr2-fold", width: 480, height: 1040, dpr: 2 },
    { name: "600x960-dpr2-small-tablet", width: 600, height: 960, dpr: 2 },
    { name: "800x1280-dpr2-tablet", width: 800, height: 1280, dpr: 2 },
    { name: "568x320-landscape-small", width: 568, height: 320, dpr: 2 },
    { name: "844x390-landscape-14", width: 844, height: 390, dpr: 3 },
    { name: "896x414-landscape-large", width: 896, height: 414, dpr: 2.625 },
    { name: "915x412-landscape-wide", width: 915, height: 412, dpr: 2.625 },
];

await fs.mkdir(OUT, { recursive: true });

function token() {
    const creds = JSON.parse(fsSync.readFileSync(CRED, "utf8"));
    const bodyPath = path.join(OUT, "_layout-body.json");
    fsSync.writeFileSync(bodyPath, JSON.stringify(creds));
    let raw = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        raw = execFileSync("curl.exe", ["-s", "--max-time", "90", "--socks5-hostname", "127.0.0.1:10808",
            "-X", "POST", SUPABASE_TOKEN_URL, "-H", `apikey: ${SUPABASE_ANON}`,
            "-H", "Content-Type: application/json", "--data-binary", `@${bodyPath}`], { encoding: "utf8" });
        try { if (JSON.parse(raw).access_token) break; } catch { raw = ""; }
        const until = Date.now() + 1500 * attempt;
        while (Date.now() < until) { /* 同步退避 */ }
    }
    const parsed = JSON.parse(raw);
    fsSync.writeFileSync(AUTH, raw, "utf8");
    return parsed;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".webp": "image/webp", ".mp4": "video/mp4", ".woff": "font/woff", ".ttf": "font/ttf" };
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

const auth = token();
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-sandbox"], proxy: { server: "http://127.0.0.1:10809", bypass: "127.0.0.1,localhost" } });

const results = [];
let fatalError = null;
for (const device of DEVICES) {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, deviceScaleFactor: device.dpr, isMobile: true, hasTouch: true });
    try {
    const page = await context.newPage();
    const session = { access_token: auth.access_token, token_type: "bearer", expires_in: auth.expires_in, expires_at: Math.floor(Date.now() / 1000) + auth.expires_in - 60, refresh_token: auth.refresh_token, user: auth.user };
    await page.addInitScript(([k, v]) => { try { globalThis.localStorage.setItem(k, v); } catch { } }, ["dengta_home_auth_v1", JSON.stringify(session)]);
    const startedAt = Date.now();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector(".main-panel", { timeout: 150_000 });
    // Do not treat the loading shell as "ready": wait until the recovery banner
    // and startup veil are gone AND real chat/session content exists. A blank or
    // failed boot must fail the matrix instead of producing an empty issue list.
    await page.waitForFunction(() => {
        const composer = document.querySelector(".composer");
        const recovery = document.querySelector(".connection-recovery");
        const startup = document.querySelector(".app-startup-page, .dengta-prelude");
        return Boolean(composer && !recovery && !startup);
    }, null, { timeout: 150_000 });
    await page.waitForTimeout(700);
    // Session rows are not chat content: a fresh session can be empty. Select a
    // session that actually has messages (read-only) so screenshots/overflow
    // checks cover the real transcript instead of the loading/empty placeholder.
    if (await page.locator(".message-bubble").count() === 0) {
        const sessions = page.locator(".session-select");
        const count = await sessions.count();
        for (let index = 0; index < Math.min(count, 12); index += 1) {
            await sessions.nth(index).evaluate((node) => node.click()).catch(() => {});
            await page.waitForTimeout(900);
            if (await page.locator(".message-bubble").count() > 0) break;
        }
    }
    await page.waitForFunction(() => document.querySelectorAll(".message-bubble").length > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    const readyMs = Date.now() - startedAt;
    const required = await page.evaluate(() => ({
        mainPanel: Boolean(document.querySelector(".main-panel")),
        composer: Boolean(document.querySelector(".composer")),
        messages: document.querySelectorAll(".message-bubble").length,
    }));
    if (!required.mainPanel || !required.composer || required.messages === 0) {
        throw new Error(`layout prerequisites missing at ${device.name}: ${JSON.stringify(required)}`);
    }

    const audit = await page.evaluate(({ vw, vh }) => {
        const issues = [];
        // 抽屉/侧边栏在收起状态下会被 transform 推到屏幕左侧，这不是布局错误。
        const isOffCanvas = (el) => {
            for (let node = el; node; node = node.parentElement) {
                if (node.getAttribute?.("aria-hidden") === "true") return true;
                if (node.hasAttribute?.("inert")) return true;
                if (String(node.className || "").includes("visually-hidden")) return true;
                const style = getComputedStyle(node);
                if (["fixed", "absolute"].includes(style.position)) {
                    const rect = node.getBoundingClientRect();
                    // 整个容器完全在视口左侧或右侧之外 → 收起状态的抽屉
                    if (rect.width > 0 && (rect.right <= 1 || rect.left >= innerWidth - 1)) return true;
                }
            }
            return false;
        };
        const docWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        if (docWidth > vw + 1) issues.push({ kind: "horizontal-overflow", detail: `scrollWidth=${docWidth} > ${vw}` });
        const msgCount = document.querySelectorAll(".message-bubble").length;
        const sessionCount = document.querySelectorAll(".session-select, .session-list, .session-item").length;
        if (msgCount === 0 && sessionCount === 0) issues.push({ kind: "missing-content", detail: "no message/session content" });

        // 交互元素被推出视口（排除 off-canvas）
        const pushed = [];
        for (const el of document.querySelectorAll('button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [contenteditable="true"]')) {
            if (isOffCanvas(el)) continue;
            const style = getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) continue;
            if (el.tagName === "INPUT" && el.type === "file") continue;
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            if (r.bottom < 0 || r.top > vh) continue;
            if (r.right > vw + 2 || r.left < -2) {
                pushed.push({ cls: String(el.className || "").split(/\s+/).slice(0, 2).join(".").slice(0, 40), l: Math.round(r.left), r: Math.round(r.right), label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 16) });
            }
        }
        if (pushed.length) issues.push({ kind: "interactive-out-of-viewport", count: pushed.length, samples: pushed.slice(0, 6) });

        // 底栏/输入框是否落在屏幕外或与视口重叠出界
        for (const selector of [".composer", ".composer-wrap", ".topbar"]) {
            const node = document.querySelector(selector);
            if (!node) continue;
            const r = node.getBoundingClientRect();
            if (r.right > vw + 2 || r.left < -2) issues.push({ kind: "container-out-of-viewport", selector, detail: `${Math.round(r.left)}..${Math.round(r.right)} vs ${vw}` });
            if (selector !== ".topbar" && (r.bottom > vh + 2 || r.top < 0)) issues.push({ kind: "container-out-of-viewport", selector, detail: `top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} vs ${vh}` });
        }

        // 输入框不能被挤得太窄（新增按钮后尤其要盯）
        const composerInput = document.querySelector(".composer textarea");
        if (composerInput) {
            const width = composerInput.getBoundingClientRect().width;
            if (width < 120) {
                issues.push({ kind: "composer-too-narrow", detail: Math.round(width) + "px < 120px" });
            }
        }

        // 触摸目标
        const small = [];
        for (const el of document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]')) {
            if (isOffCanvas(el)) continue;
            const style = getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) continue;
            if (el.tagName === "INPUT" && el.type === "file") continue;
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            if (r.bottom < 0 || r.top > vh) continue;
            const after = getComputedStyle(el, "::after");
            let effectiveW = r.width;
            let effectiveH = r.height;
            if (after.position === "absolute" && after.content && after.content !== "none") {
                const left = Number.parseFloat(after.left);
                const right = Number.parseFloat(after.right);
                const top = Number.parseFloat(after.top);
                const bottom = Number.parseFloat(after.bottom);
                if (Number.isFinite(left) && Number.isFinite(right) && left < 0 && right < 0) effectiveW -= left + right;
                if (Number.isFinite(top) && Number.isFinite(bottom) && top < 0 && bottom < 0) effectiveH -= top + bottom;
            }
            if (effectiveW < 44 || effectiveH < 44) small.push({ cls: String(el.className || "").split(/\s+/).slice(0, 2).join(".").slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), ew: Math.round(effectiveW), eh: Math.round(effectiveH) });
        }
        if (small.length) issues.push({ kind: "small-tap-targets", count: small.length, samples: small.slice(0, 6) });

        // 聊天气泡文本被裁（排除 line-clamp）
        const clipped = [];
        for (const el of document.querySelectorAll(".message-bubble, .message-content, .chat-sentences")) {
            const style = getComputedStyle(el);
            const clamp = style.webkitLineClamp || style.lineClamp || "none";
            if (clamp !== "none") continue;
            if (!["hidden", "clip"].includes(style.overflowY) && !["hidden", "clip"].includes(style.overflow)) continue;
            if (el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 20) clipped.push({ cls: String(el.className || "").split(/\s+/).slice(0, 2).join(".").slice(0, 40), scrollH: el.scrollHeight, clientH: el.clientHeight });
        }
        if (clipped.length) issues.push({ kind: "clipped-chat-text", count: clipped.length, samples: clipped.slice(0, 5) });

        return { issues, docWidth, msgCount, sessionCount };
    }, { vw: device.width, vh: device.height });

    await page.screenshot({ path: `${OUT}/layout-${device.width}x${device.height}.png`, timeout: 120_000 });
    results.push({ device: device.name, readyMs, ...audit, issueCount: audit.issues.length });
    console.log(`\n=== ${device.name} === 就绪 ${(readyMs / 1000).toFixed(1)}s`);
    if (!audit.issues.length) console.log("  ✓ 未发现布局问题");
    for (const issue of audit.issues) console.log(`  ✗ ${issue.kind}: ${issue.detail || JSON.stringify(issue.samples || issue.count)}`);
    } catch (error) {
        fatalError = error;
        results.push({ device: device.name, error: String(error).slice(0, 300), issueCount: 0 });
        console.error(`\n=== ${device.name} === ERROR ${String(error).slice(0, 300)}`);
    } finally {
        await context.close();
    }
}

await fs.writeFile(`${OUT}/layout-matrix.json`, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2), "utf8");
const total = results.reduce((sum, item) => sum + item.issueCount, 0);
console.log(`\n合计问题: ${total}`);
await browser.close();
server.close();
process.exit(total > 0 || fatalError ? 1 : 0);
