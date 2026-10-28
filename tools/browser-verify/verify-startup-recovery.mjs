// 真机验证 · 启动恢复状态的可见性、层叠与可操作性
//
// 背景：实测「正在唤醒 DengTa 后端…」横幅会与浮动的顶部状态胶囊叠压，
// 横幅里的按钮被盖住。修完层叠后又发现更隐蔽的问题：横幅在 DOM 里、
// 坐标也正确，但被加载遮罩挡住 —— 用户根本看不见。
//
// 所以这里不只量尺寸，还要问三件事：
//   1. 横幅中心点 elementFromPoint 命中的是不是它自己（有没有被盖住）
//   2. 从横幅到 body 的有效 opacity 是否为 1（有没有淡出/隐藏）
//   3. 与浮动的状态胶囊是否重叠
//
// 制造状态的方式：把 /api/v2/bootstrap 延迟 20 秒，让应用停在「正在唤醒」。
//
// 用法：node tools/browser-verify/verify-startup-recovery.mjs
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
    { name: "360x640", width: 360, height: 640, dpr: 2 },
    { name: "360x780", width: 360, height: 780, dpr: 3 },
    { name: "393x873", width: 393, height: 873, dpr: 2.75 },
];

await fs.mkdir(OUT, { recursive: true });

function token() {
    const creds = JSON.parse(fsSync.readFileSync(CRED, "utf8"));
    const bodyPath = path.join(OUT, "_recovery-body.json");
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

const checks = [];
const failures = [];
const record = (deviceName, name, passed, detail) => {
    checks.push({ device: deviceName, name, passed, detail });
    if (!passed) failures.push(`${deviceName} ${name}: ${JSON.stringify(detail)}`);
    console.log(`  ${passed ? "✓" : "✗"} ${name}${passed ? "" : "  -> " + JSON.stringify(detail)}`);
};

for (const device of DEVICES) {
    console.log(`\n=== ${device.name} ===`);
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, deviceScaleFactor: device.dpr, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.route("**/api/v2/bootstrap*", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        await route.continue().catch(() => {});
    });
    const session = { access_token: auth.access_token, token_type: "bearer", expires_in: auth.expires_in, expires_at: Math.floor(Date.now() / 1000) + auth.expires_in - 60, refresh_token: auth.refresh_token, user: auth.user };
    await page.addInitScript(([k, v]) => { try { globalThis.localStorage.setItem(k, v); } catch { } }, ["dengta_home_auth_v1", JSON.stringify(session)]);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });

    const bannerShown = await page.waitForSelector(".connection-recovery", { timeout: 90_000 }).then(() => true).catch(() => false);
    record(device.name, "恢复横幅出现", bannerShown, bannerShown);
    if (!bannerShown) { await context.close(); continue; }
    // 启动动画（DengTaPrelude，约 3.18s）是刻意的开场，不是遮挡 bug。
    // 等它退场后再判断「横幅是否真的能被用户看见」。
    await page.waitForFunction(() => !document.querySelector(".dengta-prelude"), null, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(600);

    const state = await page.evaluate(() => {
        const banner = document.querySelector(".connection-recovery");
        const stack = document.querySelector(".chat-presence-stack");
        const capsule = document.querySelector(".sun-glass-liquid-capsule-toggle");
        const button = banner?.querySelector("button");
        const rect = (node) => {
            if (!node) return null;
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") return null;
            const r = node.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
        };
        const overlap = (a, b) => {
            if (!a || !b) return 0;
            const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
            const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
            return width * height;
        };
        const effectiveOpacity = (node) => {
            let value = 1;
            for (let cur = node; cur; cur = cur.parentElement) {
                const style = getComputedStyle(cur);
                value *= Number(style.opacity === "" ? 1 : style.opacity);
                if (style.display === "none" || style.visibility === "hidden") return 0;
            }
            return value;
        };
        const bannerRect = rect(banner);
        const centerX = bannerRect ? Math.round(bannerRect.x + bannerRect.w / 2) : 0;
        const centerY = bannerRect ? Math.round(bannerRect.y + bannerRect.h / 2) : 0;
        const hit = bannerRect ? document.elementFromPoint(centerX, centerY) : null;
        const hitInsideBanner = Boolean(hit && banner && (hit === banner || banner.contains(hit)));
        const strong = banner?.querySelector("strong");
        const span = banner?.querySelector("span");
        const clipped = (node) => Boolean(node) && node.scrollHeight > node.clientHeight + 2 && node.clientHeight > 0 && !["hidden", "clip"].includes(getComputedStyle(node).overflow);
        return {
            bannerRect,
            stackRect: rect(stack),
            capsuleRect: rect(capsule),
            buttonRect: rect(button),
            overlapStack: overlap(bannerRect, rect(stack)),
            overlapCapsule: overlap(bannerRect, rect(capsule)),
            titleClipped: clipped(strong),
            detailClipped: clipped(span),
            opacity: Number(effectiveOpacity(banner).toFixed(2)),
            hitInsideBanner,
            hitClass: hit ? String(hit.className || hit.tagName).slice(0, 60) : null,
            bannerText: (banner?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80)
        };
    });

    record(device.name, "横幅在视口内", Boolean(state.bannerRect) && state.bannerRect.right <= device.width + 2 && state.bannerRect.bottom <= device.height + 2, state.bannerRect);
    record(device.name, "横幅视觉可见（未被遮挡）", state.opacity === 1 && state.hitInsideBanner, { opacity: state.opacity, hit: state.hitClass });
    record(device.name, "横幅与状态胶囊无重叠", state.overlapCapsule === 0, state.overlapCapsule);
    record(device.name, "横幅与状态栏无重叠", state.overlapStack === 0, state.overlapStack);
    record(device.name, "标题未被裁", !state.titleClipped, state.titleClipped);
    record(device.name, "说明文字未被裁", !state.detailClipped, state.detailClipped);
    record(device.name, "重连按钮可见且 ≥44", Boolean(state.buttonRect) && state.buttonRect.h >= 44, state.buttonRect);
    record(device.name, "横幅文案正确", state.bannerText.includes("唤醒") || state.bannerText.includes("连接") || state.bannerText.includes("没有响应"), state.bannerText);
    await page.screenshot({ path: `${OUT}/recovery-${device.width}x${device.height}.png`, timeout: 120_000 });
    await context.close();
}

await fs.writeFile(`${OUT}/startup-recovery.json`, JSON.stringify({ ranAt: new Date().toISOString(), checks, failures }, null, 2), "utf8");
console.log(`\n${failures.length ? "✗ " + failures.length + " 项不通过" : "✓ 全部通过"}`);
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
