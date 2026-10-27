// 真机验证：把本地构建跑起来，接生产后端，用真账号在真浏览器里检查关键界面。
//
// 它回答的是「用户到底能不能看到」——单测回答不了这个。
// 本会话里它抓到过两个所有单测都放过的 bug：
//   1. 心潮胶囊被渲染成嵌套 button，浏览器重排出大灰块压住状态栏
//   2. 线上 drives 是对象而不是数组，于是花瓣一片都不画
//
// 用法：node verify-local-build.mjs [--json]
// 依赖：_tools/sing-box 代理（10808/10809）、_audit/browser-auth.json（账号密码）、frontend/dist
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// playwright-core 不是本仓库的依赖（只是验证工具的依赖）。
// 依次尝试：环境变量指定的目录 → 仓库 node_modules → 工具链目录。
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
    throw new Error(
        "找不到 playwright-core。装一个（npm i -D playwright-core）或设置 DENGTA_PLAYWRIGHT_ROOT 指向包含它的 node_modules 目录。"
    );
}
let chromium = null; // 在 main() 里加载：REPO 常量在下面才定义

const REPO = path.resolve(fileURLToPath(new URL("../../frontend", import.meta.url)));
const DIST = path.join(REPO, "dist");
const OUT = process.env.DENGTA_BROWSER_VERIFY_OUT || path.resolve(REPO, "..", "..", "_audit", "browser");
const AUTH_FILE = process.env.DENGTA_BROWSER_VERIFY_AUTH || path.join(OUT, "auth.json");
const CRED_FILE = process.env.DENGTA_BROWSER_VERIFY_CREDENTIALS || path.join(OUT, "browser-auth.json");
const PORT = Number(process.env.DENGTA_BROWSER_VERIFY_PORT || 5173);
const SUPABASE_TOKEN_URL = process.env.DENGTA_SUPABASE_TOKEN_URL || "https://nyyqizwrlmejpfdhgrnd.supabase.co/auth/v1/token?grant_type=password";
const SUPABASE_ANON = process.env.DENGTA_SUPABASE_ANON || "sb_publishable_8igj37ucC_HG98LSFwnkHA_6QBtcE8F";

const asJson = process.argv.includes("--json");
await fs.mkdir(OUT, { recursive: true });

// --- 1. 拿 token（脚本自己刷新，不依赖外部准备）---
async function loadToken() {
    const creds = JSON.parse(await fs.readFile(CRED_FILE, "utf8"));
    const bodyPath = path.join(OUT, "_token-body.json");
    await fs.writeFile(bodyPath, JSON.stringify({ email: creds.email, password: creds.password }), "utf8");
    const raw = execFileSync("curl.exe", [
        "-s", "--max-time", "90", "--socks5-hostname", "127.0.0.1:10808",
        "-X", "POST", SUPABASE_TOKEN_URL,
        "-H", `apikey: ${SUPABASE_ANON}`,
        "-H", "Content-Type: application/json",
        "--data-binary", `@${bodyPath}`
    ], { encoding: "utf8" });
    const auth = JSON.parse(raw);
    if (!auth.access_token) throw new Error(`token 获取失败: ${raw.slice(0, 200)}`);
    await fs.writeFile(AUTH_FILE, raw, "utf8");
    return auth;
}

// --- 2. 静态服务器托管 dist ---
const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
    ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
    ".webmanifest": "application/manifest+json", ".ico": "image/x-icon"
};
function startServer() {
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
            let filePath = path.join(DIST, decodeURIComponent(url.pathname));
            if (!filePath.startsWith(DIST)) { res.writeHead(403).end(); return; }
            let stat = await fs.stat(filePath).catch(() => null);
            if (!stat || stat.isDirectory()) {
                filePath = path.join(DIST, "index.html");
            }
            const body = await fs.readFile(filePath);
            res.writeHead(200, { "content-type": TYPES[path.extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
            res.end(body);
        } catch (error) { res.writeHead(500).end(String(error)); }
    });
    return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

const failures = [];
const checks = [];
function check(name, passed, detail) {
    checks.push({ name, passed, detail });
    if (!passed) failures.push(`${name}: ${JSON.stringify(detail)}`);
}

async function main() {
    ({ chromium } = loadPlaywright());
    const auth = await loadToken();
    const server = await startServer();
    console.log(`静态服务器 http://127.0.0.1:${PORT}（dist 已构建）`);

    const browser = await chromium.launch({
        channel: "msedge", headless: true, args: ["--no-sandbox"],
        proxy: { server: "http://127.0.0.1:10809" }
    });
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36"
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e).slice(0, 200)));

    const session = {
        access_token: auth.access_token, token_type: "bearer",
        expires_in: auth.expires_in,
        expires_at: Math.floor(Date.now() / 1000) + auth.expires_in - 60,
        refresh_token: auth.refresh_token, user: auth.user
    };
    await page.addInitScript(([key, value]) => {
        try { globalThis.localStorage.setItem(key, value); } catch {}
    }, ["dengta_home_auth_v1", JSON.stringify(session)]);

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForSelector(".app-shell, .main-panel", { timeout: 150_000 }).catch(() => {});
    await page.waitForTimeout(12_000);

    const probe = await page.evaluate(() => {
        const q = (sel) => document.querySelectorAll(sel).length;
        const ruleLoaded = (needle) => Array.from(document.styleSheets).some((sheet) => {
            try { return Array.from(sheet.cssRules || []).some((rule) => String(rule.cssText || "").includes(needle)); }
            catch { return false; }
        });
        const capsule = document.querySelector(".xinchao-capsule");
        const stack = document.querySelector(".chat-presence-stack");
        return {
            appShell: q(".app-shell") > 0,
            statusStack: q(".chat-presence-stack"),
            bodyTextLength: document.body.innerText.trim().length,
            xinchaoInStatus: q(".chat-presence-stack .xinchao-capsule"),
            xinchaoPetals: q(".xinchao-capsule-petal"),
            xinchaoText: capsule ? capsule.textContent.trim().slice(0, 40) : null,
            capsuleRect: capsule ? (() => { const r = capsule.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
            stackRect: stack ? (() => { const r = stack.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
            navIndicator: q(".feature-navigation-groups > .sliding-indicator"),
            refusalBannerStyles: ruleLoaded("chat-refusal-banner"),
            partialReplyStyles: ruleLoaded("partial-reply-note"),
            nestedButtons: q("button button")
        };
    });

    await page.screenshot({ path: `${OUT}\\verify-status.png`, timeout: 120_000 });

    // 断言：这些是「用户能不能看到」的硬指标
    check("应用外壳渲染", probe.appShell, probe.appShell);
    check("有实质内容（已登录）", probe.bodyTextLength > 500, probe.bodyTextLength);
    check("心潮胶囊在状态栏内", probe.xinchaoInStatus === 1, probe.xinchaoInStatus);
    check("心潮花瓣 ≥1 片", probe.xinchaoPetals >= 1, probe.xinchaoPetals);
    check("心潮胶囊有尺寸", !!probe.capsuleRect && probe.capsuleRect.w > 40, probe.capsuleRect);
    check("状态栏高度符合预期", !!probe.stackRect && probe.stackRect.h === 68, probe.stackRect);
    check("滑动高亮块已挂载", probe.navIndicator === 1, probe.navIndicator);
    check("拒答标注样式已加载", probe.refusalBannerStyles, probe.refusalBannerStyles);
    check("部分回复样式已加载", probe.partialReplyStyles, probe.partialReplyStyles);
    check("没有嵌套 button（无效 HTML）", probe.nestedButtons === 0, probe.nestedButtons);
    check("无 console 错误", consoleErrors.length === 0, consoleErrors.slice(0, 5));

    const report = { ranAt: new Date().toISOString(), url: `http://127.0.0.1:${PORT}/`, probe, consoleErrors: consoleErrors.slice(0, 10), checks, failures };
    await fs.writeFile(`${OUT}\\verify-report.json`, JSON.stringify(report, null, 2), "utf8");

    await browser.close();
    server.close();

    if (asJson) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log("\n=== 真机验证 ===");
        for (const item of checks) console.log(`  ${item.passed ? "✓" : "✗"} ${item.name}${item.passed ? "" : ` -> ${JSON.stringify(item.detail)}`}`);
        console.log(`\n${failures.length ? `✗ ${failures.length} 项不通过` : "✓ 全部通过"}`);
        console.log(`截图与报告：${OUT}`);
    }
    process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
    console.error("真机验证失败：", error?.message || error);
    process.exit(2);
});
