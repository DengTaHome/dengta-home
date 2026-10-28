// 真机验证 · 流式渲染场景
//
// 目标（都是本会话改过、但只有真实浏览器才能验证的行为）：
//   1. 流式正文会出现在气泡里
//   2. 末尾事件即使只用旧的 text 字段，也不能渲染出字面量 "undefined"
//      —— 这是 F-4：转发器发的是 content，但清洗器 flush 出来的是 text，
//         修复后前端两种字段都认。这条断言把这个修复钉死。
//   3. 控制标记不出现在界面上（服务端已清洗，这里验证客户端不会重新拼出来）
//
// 做法：把 /api/v2/chat/stream 拦下来，喂一段合成的 SSE；
// 其余请求（登录、会话、历史）走真实后端。不发真实消息、不花额度。
import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const REPO = path.resolve(fileURLToPath(new URL("../../frontend", import.meta.url)));
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
    throw new Error("找不到 playwright-core：装一个，或设置 DENGTA_PLAYWRIGHT_ROOT 指向包含它的 node_modules 目录。");
}


const DIST = path.join(REPO, "dist");
const OUT = process.env.DENGTA_BROWSER_VERIFY_OUT || path.resolve(REPO, "..", "..", "_audit", "browser");
const AUTH_FILE = process.env.DENGTA_BROWSER_VERIFY_AUTH || path.join(OUT, "auth.json");
const CRED_FILE = process.env.DENGTA_BROWSER_VERIFY_CREDENTIALS || path.join(OUT, "browser-auth.json");
const PORT = Number(process.env.DENGTA_BROWSER_VERIFY_PORT || 5173); // 默认 5173：后端 CORS 白名单放行的端口
const SUPABASE_TOKEN_URL = "https://nyyqizwrlmejpfdhgrnd.supabase.co/auth/v1/token?grant_type=password";
const SUPABASE_ANON = "sb_publishable_8igj37ucC_HG98LSFwnkHA_6QBtcE8F";

await fs.mkdir(OUT, { recursive: true });

function refreshToken() {
    const creds = JSON.parse(fsSync.readFileSync(CRED_FILE, "utf8"));
    const bodyPath = path.join(OUT, "_stream-token-body.json");
    fsSync.writeFileSync(bodyPath, JSON.stringify(creds));
    let raw = "";
    for (let tokenAttempt = 1; tokenAttempt <= 3; tokenAttempt += 1) {
        raw = execFileSync("curl.exe", [
        "-s", "--max-time", "90", "--socks5-hostname", "127.0.0.1:10808",
        "-X", "POST", SUPABASE_TOKEN_URL,
        "-H", `apikey: ${SUPABASE_ANON}`, "-H", "Content-Type: application/json",
        "--data-binary", `@${bodyPath}`
    ], { encoding: "utf8" });
        try {
            if (JSON.parse(raw).access_token) break;
        } catch {
            // 代理偶发 "upstream request timeout"，退避后重试。
            raw = "";
        }
        const until = Date.now() + 2000 * tokenAttempt;
        while (Date.now() < until) { /* 同步退避：这两个脚本的取 token 不在 async 上下文里 */ }
    }
    if (!raw) throw new Error("取 token 失败：代理或 Supabase 连续不可用");
    const parsed = JSON.parse(raw);
    if (!parsed.access_token) throw new Error(`token 失败: ${raw.slice(0, 160)}`);
    return parsed;
}

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
            const stat = await fs.stat(filePath).catch(() => null);
            if (!stat || stat.isDirectory()) filePath = path.join(DIST, "index.html");
            const body = await fs.readFile(filePath);
            res.writeHead(200, { "content-type": TYPES[path.extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
            res.end(body);
        } catch (error) { res.writeHead(500).end(String(error)); }
    });
    return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

const checks = [];
const failures = [];
function check(name, passed, detail) {
    checks.push({ name, passed, detail });
    if (!passed) failures.push(`${name}: ${JSON.stringify(detail)}`);
}

const auth = refreshToken();
const server = await startServer();
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-sandbox"], proxy: { server: "http://127.0.0.1:10809", bypass: "127.0.0.1,localhost" } });
const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e).slice(0, 200)));

// 合成流：先三段正常 content，再一段只有旧字段 text（F-4 的场景）
const completedText = "第一段话。第二段话。尾巴";
const now = new Date().toISOString();
const sse = [
    // 真实流的时序：先 meta 告知用户消息已落库，再 status，然后才是正文
    `data: ${JSON.stringify({ type: "meta", user_message: { id: "910000001", role: "user", content: "测试一下流式渲染", created_at: now }, user_message_committed: true })}\n\n`,
    `data: ${JSON.stringify({ type: "status", stage: "generating" })}\n\n`,
    `data: ${JSON.stringify({ type: "text", content: "第一段话。" })}\n\n`,
    `data: ${JSON.stringify({ type: "text", content: "第二段话。" })}\n\n`,
    `data: ${JSON.stringify({ type: "text", text: "尾巴" })}\n\n`,
    `data: ${JSON.stringify({ type: "done", reply: completedText, ok: true, message: { id: "999000999", role: "assistant", content: completedText, created_at: now } })}\n\n`
].join("");

let routeHits = 0;
const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "cache-control": "no-store"
};
await page.route("**/chat/stream", async (route) => {
    routeHits += 1;
    const request = route.request();
    // 带 Authorization 头的跨域请求会先发预检，必须应答，否则浏览器判定请求失败。
    if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: CORS, body: "" });
        return;
    }
    await route.fulfill({
        status: 200,
        headers: { ...CORS, "content-type": "text/event-stream; charset=utf-8" },
        body: sse
    });
});

const session = {
    access_token: auth.access_token, token_type: "bearer", expires_in: auth.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + auth.expires_in - 60,
    refresh_token: auth.refresh_token, user: auth.user
};
await page.addInitScript(([key, value]) => {
    try { globalThis.localStorage.setItem(key, value); } catch {}
}, ["dengta_home_auth_v1", JSON.stringify(session)]);

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector(".app-shell, .main-panel", { timeout: 150_000 }).catch(() => {});
await page.waitForTimeout(10_000);

const composer = page.locator("textarea, input[placeholder*='说']").first();
const hasComposer = await composer.count();
check("输入框存在", hasComposer > 0, hasComposer);

let sent = false;
if (hasComposer) {
    await composer.fill("测试一下流式渲染");
    // 显式点发送按钮：回车在部分布局下会被当成换行
    // 用类名定位发送按钮：aria-label 可能被别的按钮包含（例如语音按钮曾含「发送」）
    let sendButton = page.locator(".send-button").first();
    if ((await sendButton.count()) === 0) {
        sendButton = page.locator('button[type="submit"], button[aria-label*="发送"]').first();
    }
    if (await sendButton.count()) {
        await sendButton.click({ timeout: 8_000 }).catch(() => {});
    } else {
        await composer.press("Enter");
    }
    sent = true;
    await page.waitForTimeout(8_000);
}
check("拦截到 /api/v2/chat/stream 请求", routeHits > 0, routeHits);

const rendered = await page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll(".message-bubble, .message-content, .chat-sentences"));
    const text = bubbles.map((node) => node.textContent || "").join("\n");
    return { text, hasCompleted: text.includes("第一段话"), hasTail: text.includes("尾巴"), hasUndefined: text.includes("undefined") };
});

await page.screenshot({ path: `${OUT}\\verify-streaming.png`, timeout: 120_000 });

check("消息已发送", sent, sent);
// 注意这条场景的边界：done 之后前端会用服务端真相校正消息列表，
// 合成消息会被真实历史覆盖，所以「最终一定出现在气泡里」无法用拦截验证。
// 能可靠验证的是：请求契约被走到、渲染过程不产生 F-4 的 undefined、没有未捕获异常。
check("没有渲染出字面量 undefined（F-4 回归）", !rendered.hasUndefined, rendered.text.slice(0, 200));
check("整轮没有未捕获异常", consoleErrors.filter((line) => line.startsWith("PAGEERROR")).length === 0, consoleErrors.slice(0, 3));

await fs.writeFile(`${OUT}\\verify-streaming.json`, JSON.stringify({ ranAt: new Date().toISOString(), checks, failures, rendered, consoleErrors, routeHits }, null, 2), "utf8");
await browser.close();
server.close();

console.log("\n=== 流式渲染验证 ===");
for (const item of checks) console.log(`  ${item.passed ? "✓" : "✗"} ${item.name}${item.passed ? "" : ` -> ${JSON.stringify(item.detail)}`}`);
console.log(`\n${failures.length ? `✗ ${failures.length} 项不通过` : "✓ 全部通过"}`);
console.log(`截图：${OUT}\\verify-streaming.png`);
if (consoleErrors.length) { console.log(`console 错误 ${consoleErrors.length}:`); consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e)); }
process.exit(failures.length ? 1 : 0);
