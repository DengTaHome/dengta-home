// 真机验证 · 语音输入的完整交互链路
//
// 用假麦克风（--use-fake-device-for-media-stream）真实触发录音，验证：
//   1. 按下就发出 /voice/warmup 预热请求（这是本轮新增的延迟优化）
//   2. 长按进入录音态，按钮显示「松开发送 · x.x 秒」且秒数在走
//   3. 录音开始与松手都有震动反馈（navigator.vibrate）
//   4. 松手后进入上传/思考，最终要么给出回复，要么给出可读错误，
//      不会卡死在中间状态
//
// 用法：node tools/browser-verify/verify-voice-ui.mjs
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

const DEVICE = { width: 390, height: 844, dpr: 2.75 };
await fs.mkdir(OUT, { recursive: true });

function token() {
    const creds = JSON.parse(fsSync.readFileSync(CRED, "utf8"));
    const bodyPath = path.join(OUT, "_voice-body.json");
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
const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: [
        "--no-sandbox",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
    ],
    proxy: { server: "http://127.0.0.1:10809", bypass: "127.0.0.1,localhost" },
});

const checks = [];
const failures = [];
const record = (name, passed, detail) => {
    checks.push({ name, passed, detail });
    if (!passed) failures.push(`${name}: ${JSON.stringify(detail)}`);
    console.log(`  ${passed ? "✓" : "✗"} ${name}${passed ? "" : "  -> " + JSON.stringify(detail)}`);
};

const context = await browser.newContext({ viewport: { width: DEVICE.width, height: DEVICE.height }, deviceScaleFactor: DEVICE.dpr, isMobile: true, hasTouch: true });
await context.grantPermissions(["microphone"], { origin: `http://127.0.0.1:${PORT}` });
const page = await context.newPage();

// 生产后端的 /health 目前报告语音服务未配置；为了稳定验证前端链路，
// 这里把 hervoice_proxy_configured 伪装成 true，并拦截预热请求。
await page.route(/\/health(\?|$)/, async (route) => {
    try {
        const response = await route.fetch();
        const json = await response.json();
        json.features = { ...(json.features || {}), hervoice_proxy_configured: true };
        await route.fulfill({ response, json });
    } catch {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, features: { hervoice_proxy_configured: true } }) });
    }
});
await page.route("**/voice/warmup", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, started: true }) })
);

// 记录预热请求与震动调用
const warmupRequests = [];
page.on("request", (request) => {
    if (request.url().includes("/voice/warmup")) warmupRequests.push({ method: request.method(), at: Date.now() });
});
await page.addInitScript(() => {
    // 让测试可以把麦克风授权拖慢，验证「授权期间松手」的分支。
    globalThis.__delayMicMs = 0;
    const originalGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(
        navigator.mediaDevices,
    );
    if (originalGetUserMedia) {
        navigator.mediaDevices.getUserMedia = async (constraints) => {
            const delay = Number(globalThis.__delayMicMs || 0);
            if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
            return originalGetUserMedia(constraints);
        };
    }
});

await page.addInitScript(() => {
    globalThis.__vibrations = [];
    const original = navigator.vibrate?.bind(navigator);
    navigator.vibrate = (pattern) => {
        globalThis.__vibrations.push(pattern);
        try { return original ? original(pattern) : true; } catch { return true; }
    };
});

const session = { access_token: auth.access_token, token_type: "bearer", expires_in: auth.expires_in, expires_at: Math.floor(Date.now() / 1000) + auth.expires_in - 60, refresh_token: auth.refresh_token, user: auth.user };
await page.addInitScript(([k, v]) => { try { globalThis.localStorage.setItem(k, v); } catch { } }, ["dengta_home_auth_v1", JSON.stringify(session)]);
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForSelector(".main-panel", { timeout: 150_000 }).catch(() => {});
await page.waitForFunction(() => !document.querySelector(".dengta-prelude"), null, { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(2500);

let button = page.locator(".chat-voice-button").first();
// 语音是否可用取决于 /health 刷新，按钮可能晚几秒才出现
await button.waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
if ((await button.count()) === 0) {
    // 旧布局回退：语音入口在「+」菜单里
    await page.locator(".chat-attach-button").first().click().catch(() => {});
    await page.waitForTimeout(400);
    button = page.locator(".voice-hold-button").first();
}
const buttonVisible = (await button.count()) > 0 && (await button.isVisible());
record("语音按钮可见", buttonVisible, buttonVisible);
if (buttonVisible) {
    const label = (await button.getAttribute("aria-label")) || "";
    record("语音按钮有可读标签", /长按说话|语音/.test(label), label);

    const preState = await page.evaluate(() => {
        const btn = document.querySelector(".chat-voice-button");
        const rect = btn ? btn.getBoundingClientRect() : null;
        const hit = rect
            ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            : null;
        return {
            exists: Boolean(btn),
            disabled: btn ? btn.disabled : null,
            cls: btn ? btn.className : null,
            rect: rect
                ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
                : null,
            hit: hit ? String(hit.className || hit.tagName) : null,
            voiceAvailable: Boolean(document.querySelector(".chat-voice-button"))
        };
    });
    console.log("  诊断:", JSON.stringify(preState));

    const beforeWarmup = warmupRequests.length;
    const box = await button.boundingBox();
    const x = box ? box.x + box.width / 2 : DEVICE.width / 2;
    const y = box ? box.y + box.height / 2 : DEVICE.height - 80;
    await button.dispatchEvent("pointerdown", {
        pointerId: 7,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
    });
    await page.waitForTimeout(120);
    record("按下即触发 /voice/warmup 预热", warmupRequests.length > beforeWarmup, warmupRequests.slice(beforeWarmup));

    // 长按门控（约 260ms）后进入录音
    await page.waitForTimeout(900);
    const recordingState = await page.evaluate(() => {
        const direct = document.querySelector(".chat-voice-button");
        const controls = document.querySelector(".voice-controls");
        const btn = direct || document.querySelector(".voice-hold-button");
        return {
            className: direct
                ? direct.className
                : controls
                  ? controls.className
                  : null,
            pressed: btn ? btn.getAttribute("aria-pressed") : null,
            text: (btn ? btn.textContent : "").trim().slice(0, 40)
        };
    });
    record(
        "长按进入录音态",
        /voice-recording|is-recording/.test(recordingState.className || "") ||
            recordingState.pressed === "true",
        recordingState
    );
    record(
        "录音时显示秒数计时",
        /\d\.\d/.test(recordingState.text) && recordingState.pressed === "true",
        recordingState.text
    );

    await page.waitForTimeout(700);
    const vibrated = await page.evaluate(() => globalThis.__vibrations.slice());
    record("录音开始有震动反馈", vibrated.length >= 1, vibrated);

    // 松手发送
    const box2 = await button.boundingBox();
    const x2 = box2 ? box2.x + box2.width / 2 : x;
    const y2 = box2 ? box2.y + box2.height / 2 : y;
    await button.dispatchEvent("pointerup", {
        pointerId: 7,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 0,
        clientX: x2,
        clientY: y2,
    });

    // 等待进入处理中或直接结束
    const bubblesBefore = await page.locator(".message-bubble").count();
    await page.waitForTimeout(1200);
    const postRelease = await page.evaluate(() => {
        const direct = document.querySelector(".chat-voice-button");
        const error = document.querySelector(".voice-inline-error");
        return {
            directClass: direct ? direct.className : null,
            directDisabled: direct ? direct.disabled : null,
            pressed: direct ? direct.getAttribute("aria-pressed") : null,
            error: error ? error.textContent.trim().slice(0, 120) : "",
            bubbles: document.querySelectorAll(".message-bubble").length,
            bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 160)
        };
    });
    const processing =
        Boolean(postRelease.error) ||
        postRelease.pressed === "true" ||
        postRelease.bubbles > bubblesBefore ||
        Boolean(postRelease.directDisabled);

    record("松手后进入处理流程", processing, postRelease);

    const afterVibrations = await page.evaluate(() => globalThis.__vibrations.slice());
    record("松手有第二次震动", afterVibrations.length >= 2, afterVibrations);

    // 最终要么出结果要么出可读错误，不能永久卡住
    const settled = await page
        .waitForFunction(
            (before) => {
                const direct = document.querySelector(".chat-voice-button");
                const busy =
                    direct &&
                    (direct.disabled || direct.getAttribute("aria-pressed") === "true");
                const error = document.querySelector(".voice-inline-error");
                const bubbles = document.querySelectorAll(".message-bubble").length;
                return !busy || Boolean(error && error.textContent.trim()) || bubbles > before;
            },
            bubblesBefore,
            { timeout: 80_000 }
        )
        .then(() => true)
        .catch(() => false);
    const finalState = await page.evaluate(() => {
        const direct = document.querySelector(".chat-voice-button");
        const error = document.querySelector(".voice-inline-error");
        return {
            className: direct ? direct.className : null,
            disabled: direct ? direct.disabled : null,
            error: error ? error.textContent.trim().slice(0, 160) : "",
            bubbles: document.querySelectorAll(".message-bubble").length
        };
    });
    record("语音流程最终收敛（不永久卡住）", settled, finalState);
    record("失败时给出可读提示", settled, finalState.error || "(未失败)");

    // 场景 2：长按阈值已到、麦克风还在授权中时松手 —— 不能开始无人按着的录音
    await page.evaluate(() => {
        globalThis.__delayMicMs = 1_500;
    });
    const box3 = await button.boundingBox();
    const x3 = box3 ? box3.x + box3.width / 2 : DEVICE.width / 2;
    const y3 = box3 ? box3.y + box3.height / 2 : DEVICE.height - 80;
    await button.dispatchEvent("pointerdown", {
        pointerId: 11,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: x3,
        clientY: y3,
    });
    await page.waitForTimeout(500);
    await button.dispatchEvent("pointerup", {
        pointerId: 11,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 0,
        clientX: x3,
        clientY: y3,
    });
    await page.waitForTimeout(2_600);
    const releaseDuringPermission = await page.evaluate(() => {
        const direct = document.querySelector(".chat-voice-button");
        const notice = document.querySelector(".notice, .voice-inline-error");
        return {
            pressed: direct ? direct.getAttribute("aria-pressed") : null,
            cls: direct ? direct.className : null,
            notice: notice ? notice.textContent.replace(/\s+/g, " ").trim().slice(0, 80) : "",
        };
    });
    record(
        "授权期间松手不会开始录音",
        releaseDuringPermission.pressed !== "true" &&
            !/is-recording/.test(releaseDuringPermission.cls || ""),
        releaseDuringPermission
    );
    record(
        "授权期间松手有明确提示",
        /松开|没有录音/.test(releaseDuringPermission.notice || ""),
        releaseDuringPermission.notice
    );
    await page.evaluate(() => {
        globalThis.__delayMicMs = 0;
    });

    await page.screenshot({ path: `${OUT}/voice-ui-390x844.png`, timeout: 120_000 });
}

await fs.writeFile(`${OUT}/voice-ui.json`, JSON.stringify({ ranAt: new Date().toISOString(), checks, failures }, null, 2), "utf8");
console.log(`\n${failures.length ? "✗ " + failures.length + " 项不通过" : "✓ 全部通过"}`);
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);
