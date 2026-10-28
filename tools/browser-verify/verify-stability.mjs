// 真机验证 · 界面稳定性（闪动 / 错位）—— 仓库内版本
//
// 用户说状态栏会「错位、闪」。这里不用肉眼判断，直接测两件事：
//   1. 布局位移（CLS）：累计得分越高说明页面元素跳得越厉害
//   2. 状态胶囊的位置采样：稳定后不应该再移动
import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(fileURLToPath(new URL("../../frontend", import.meta.url)));
const DIST = path.join(REPO, "dist");
const OUT = process.env.DENGTA_BROWSER_VERIFY_OUT || path.resolve(REPO, "..", "..", "_audit", "browser");
const PORT = Number(process.env.DENGTA_BROWSER_VERIFY_PORT || 5173);
const AUTH = process.env.DENGTA_BROWSER_VERIFY_AUTH || path.join(OUT, "auth.json");
const auth = JSON.parse(fsSync.readFileSync(AUTH, "utf8"));

// token 只有 1 小时；过期后接口全 401，页面会停在加载态，
// 测出来的「CLS 通过」其实是「什么都没渲染」的假结果。
const CRED = process.env.DENGTA_BROWSER_VERIFY_CREDENTIALS || path.join(OUT, "browser-auth.json");
const SUPABASE_ANON = process.env.DENGTA_SUPABASE_ANON || "sb_publishable_8igj37ucC_HG98LSFwnkHA_6QBtcE8F";
const SUPABASE_TOKEN_URL = process.env.DENGTA_SUPABASE_TOKEN_URL || "https://nyyqizwrlmejpfdhgrnd.supabase.co/auth/v1/token?grant_type=password";
function refreshTokenIfNeeded() {
    const now = Math.floor(Date.now() / 1000);
    if (Number(auth.expires_at || 0) > now + 60) return auth;
    const creds = JSON.parse(fsSync.readFileSync(CRED, "utf8"));
    const bodyPath = path.join(OUT, "_stability-token.json");
    fsSync.writeFileSync(bodyPath, JSON.stringify(creds), "utf8");
    const raw = execFileSync("curl.exe", ["-s", "--max-time", "90", "--socks5-hostname", "127.0.0.1:10808",
        "-X", "POST", SUPABASE_TOKEN_URL, "-H", `apikey: ${SUPABASE_ANON}`,
        "-H", "Content-Type: application/json", "--data-binary", `@${bodyPath}`], { encoding: "utf8" });
    const fresh = JSON.parse(raw);
    if (!fresh.access_token) throw new Error("token 刷新失败: " + raw.slice(0, 160));
    fsSync.writeFileSync(AUTH, raw, "utf8");
    return fresh;
}
const activeAuth = refreshTokenIfNeeded();

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

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-sandbox"], proxy: { server: "http://127.0.0.1:10809" } });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
await page.addInitScript(() => {
    globalThis.__shifts = [];
    try {
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) {
                    globalThis.__shifts.push({ value: entry.value, start: Math.round(entry.startTime), sources: (entry.sources || []).map((source) => source.node?.className || source.node?.tagName || "").slice(0, 3) });
                }
            }
        }).observe({ type: "layout-shift", buffered: true });
    } catch {}
});
const session = { access_token: activeAuth.access_token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3500, refresh_token: activeAuth.refresh_token, user: activeAuth.user };
await page.addInitScript(([k, v]) => { try { globalThis.localStorage.setItem(k, v); } catch {} }, ["dengta_home_auth_v1", JSON.stringify(session)]);

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForSelector(".main-panel", { timeout: 180_000 }).catch(() => {});

// 从外壳出现开始，每 250ms 采样一次状态胶囊的位置
const samples = [];
for (let index = 0; index < 60; index += 1) {
    const sample = await page.evaluate(() => {
        const stack = document.querySelector(".chat-presence-stack");
        const capsule = document.querySelector(".sun-glass-liquid-capsule-toggle");
        const status = document.querySelector(".sun-glass-floating-status-shell");
        const rectOf = (node) => {
            if (!node) return null;
            const rect = node.getBoundingClientRect();
            return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
        };
        const list = document.querySelector(".message-list");
        const composer = document.querySelector(".composer-wrap");
        const guide = document.querySelector(".achievement-guide");
        return {
            stack: rectOf(stack), capsule: rectOf(capsule), status: rectOf(status),
            list: rectOf(list), composer: rectOf(composer), guide: rectOf(guide),
            listScrollHeight: list ? list.scrollHeight : null,
            docHeight: document.documentElement.scrollHeight
        };
    });
    samples.push({ at: index * 250, ...sample });
    await page.waitForTimeout(250);
}

const shifts = await page.evaluate(() => globalThis.__shifts || []);
const cls = shifts.reduce((sum, entry) => sum + entry.value, 0);

// 稳定判定：外壳出现 2 秒之后，位置不应再变化
function movements(key) {
    const stable = samples.filter((sample) => sample.at >= 2000 && sample[key]);
    const unique = new Set(stable.map((sample) => JSON.stringify(sample[key])));
    return { samples: stable.length, distinct: unique.size, values: Array.from(unique).slice(0, 5) };
}

let warmFirstMessage = 0, warmShifts = [], warmCls = 0;
const report = {
    ranAt: new Date().toISOString(),
    cls: Number(cls.toFixed(4)),
    shiftCount: shifts.length,
    shifts: shifts.slice(0, 8),
    movements: {
        capsule: movements("capsule"),
        stack: movements("stack"),
        status: movements("status"),
    },
    firstSamples: samples.slice(0, 6),
    warm: { warmFirstMessage, warmCls: Number(warmCls.toFixed(4)), warmShiftCount: warmShifts.length },
};

// --- 第二次加载：缓存已就绪（日常打开的情形）---
await page.evaluate(() => { globalThis.__shifts = []; });
const reloadStart = Date.now();
await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForSelector(".main-panel", { timeout: 180_000 }).catch(() => {});
await page.waitForSelector(".message-bubble", { timeout: 120_000 }).catch(() => {});
warmFirstMessage = Date.now() - reloadStart;
await page.waitForTimeout(6_000);
warmShifts = await page.evaluate(() => globalThis.__shifts || []);
warmCls = warmShifts.reduce((sum, entry) => sum + entry.value, 0);
console.log("\n=== 重复访问（有缓存）===");
console.log(`  首条消息 ${warmFirstMessage} ms，CLS ${warmCls.toFixed(4)}，位移 ${warmShifts.length} 次`);
for (const shift of warmShifts.slice(0, 5)) console.log(`  +${shift.value.toFixed(4)} @${shift.start}ms  ${shift.sources.join(" / ")}`);
await fs.writeFile(`${OUT}\\stability.json`, JSON.stringify(report, null, 2), "utf8");

console.log("=== 布局位移（CLS） ===");
console.log(`  累计 ${report.cls}，共 ${report.shiftCount} 次无输入位移`);
for (const shift of report.shifts.slice(0, 5)) {
    console.log(`  +${shift.value.toFixed(4)} @${shift.start}ms  ${shift.sources.join(" / ")}`);
}
console.log("\n=== 2 秒后的位置稳定性（不同值越少越稳） ===");
for (const [key, stat] of Object.entries(report.movements)) {
    console.log(`  ${key.padEnd(8)} 采样 ${stat.samples} 次，位置取值 ${stat.distinct} 种  ${JSON.stringify(stat.values)}`);
}
console.log("\n=== 布局变化点（list / composer / guide / 高度） ===");
let previous = null;
for (const sample of samples) {
    const current = JSON.stringify({ list: sample.list, composer: sample.composer, guide: sample.guide, scroll: sample.listScrollHeight });
    if (previous && current !== previous) {
        console.log(`  @${String(sample.at).padStart(5)}ms  list=${JSON.stringify(sample.list)} composer=${JSON.stringify(sample.composer)} guide=${sample.guide ? "有" : "无"} scrollH=${sample.listScrollHeight}`);
    }
    previous = current;
}


// 把重复访问的实测值补进报告（report 在测量前就构造好了，这里补写一次）。
report.warm = {
    warmFirstMessage,
    warmCls: Number(warmCls.toFixed(4)),
    warmShiftCount: warmShifts.length,
};
await fs.writeFile(`${OUT}\\stability.json`, JSON.stringify(report, null, 2), "utf8");

// === 判定 ===
const checks = [];
const addCheck = (name, passed, detail) => checks.push({ name, passed, detail });
addCheck("状态胶囊位置稳定（2 秒后不再移动）", report.movements.capsule.distinct === 1, report.movements.capsule);
addCheck("状态栏容器位置稳定", report.movements.stack.distinct === 1, report.movements.stack);
addCheck("CLS 未达到「差」（< 0.25）", report.cls < 0.25, report.cls);
addCheck("CLS 未达到「需要改进」（< 0.1）", report.cls < 0.1, report.cls);
addCheck("重复访问首条消息 < 3 秒", report.warm.warmFirstMessage > 0 && report.warm.warmFirstMessage < 3000, report.warm);

console.log("\n=== 界面稳定性判定 ===");
let failed = 0;
for (const check of checks) {
    const mark = check.passed ? "✓" : "✗";
    if (!check.passed) failed += 1;
    console.log(`  ${mark} ${check.name}${check.passed ? "" : "  -> " + JSON.stringify(check.detail)}`);
}
console.log(`\n${failed ? `✗ ${failed} 项不通过` : "✓ 全部通过"}`);
process.exit(failed > 0 ? 1 : 0);

await browser.close();
server.close();
