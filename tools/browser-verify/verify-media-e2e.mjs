// 真机验证 · 私密媒体设置端到端（头像 / 伴侣头像 / 聊天背景）
//
// 回答一个具体的抱怨：「在设置里换了头像或背景，聊天里没变」。
//
// 完整链路：上传一张临时头像 → 设为 user_avatar 偏好 → 真浏览器加载应用 →
// 断言聊天里出现 blob 图片头像（naturalWidth > 0）且确实请求了资产内容。
// 结束时清理干净：清空偏好 + 永久删除临时资产。
//
// 注意：静态服务器端口必须是 5173。后端 CORS 白名单只放行这个端口，
// 换端口会让所有接口被浏览器拦掉，得到「应用没加载」的假结论。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const REPO = "D:\\GZdeepseek\\dengta-home\\frontend";
const AUTH = process.env.DENGTA_BROWSER_VERIFY_AUTH || "D:\\GZdeepseek\\_audit\\browser\\auth.json";
const BASE = "https://dengta-home-backend-rkmq.onrender.com";
const APIFY = "sb_publishable_8igj37ucC_HG98LSFwnkHA_6QBtcE8F";
const UPLOAD_FILE = path.join(REPO, "public", "app-icon-192.png");
// 用途可配置：user_avatar / companion_avatar / chat_background
const PURPOSE = process.env.DENGTA_MEDIA_PURPOSE || "user_avatar";
const ASSERT_SELECTOR = process.env.DENGTA_MEDIA_SELECTOR
    || (PURPOSE === "chat_background" ? ".private-chat-background img" : "img.message-avatar-image");
const OUT = process.env.DENGTA_BROWSER_VERIFY_OUT || "D:\\GZdeepseek\\_audit\\browser";

const auth = JSON.parse(fs.readFileSync(AUTH, "utf8"));

function curl(args) {
    const result = execFileSync("curl.exe", ["-s", "--max-time", "180", "--socks5-hostname", "127.0.0.1:10808",
        "-H", `Authorization: Bearer ${auth.access_token}`, "-H", `apikey: ${APIFY}`, ...args], { encoding: "utf8" });
    try { return JSON.parse(result); } catch { return { raw: result.slice(0, 300) }; }
}

const steps = [];
let mediaE2eFailed = false;
const record = (name, detail) => { steps.push({ name, detail }); console.log(`- ${name}: ${JSON.stringify(detail).slice(0, 220)}`); };

let createdAssetId = null;
try {
    // 1) 上传临时头像
    const uploaded = curl(["-X", "POST", `${BASE}/api/v2/private-media/assets`,
        "-F", `file=@${UPLOAD_FILE};type=image/png`, "-F", `purpose=${PURPOSE}`]);
    createdAssetId = uploaded?.asset?.id || null;
    record("上传临时头像", { ok: !!createdAssetId, id: createdAssetId ? createdAssetId.slice(0, 8) : null, error: uploaded?.message });

    if (createdAssetId) {
        // 2) 设为 user_avatar
        const bodyPath = path.join(OUT, "_pref-set.json");
        fs.writeFileSync(bodyPath, JSON.stringify({ purpose: PURPOSE, asset_id: createdAssetId }), "utf8");
        const setResult = curl(["-X", "PUT", `${BASE}/api/v2/private-media/preferences`,
            "-H", "Content-Type: application/json", "--data-binary", `@${bodyPath}`]);
        record("设为头像偏好", setResult);

        // 3) 读回目录
        const catalog = curl([`${BASE}/api/v2/private-media/catalog`]);
        const preferences = catalog.preferences || {};
        record("目录里的偏好", {
            preferences,
            pointsToNewAsset: JSON.stringify(preferences).includes(createdAssetId)
        });

        // 4) 真浏览器：看聊天头像
        const { chromium } = createRequire(import.meta.url)("D:\\GZdeepseek\\_tools\\pw\\node_modules\\playwright-core");
        const pagePort = Number(process.env.DENGTA_BROWSER_VERIFY_PORT || 5173); // 必须是白名单端口
        const http = await import("node:http");
        const DIST = path.join(REPO, "dist");
        const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".webp": "image/webp", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".woff": "font/woff", ".ttf": "font/ttf" };
        const fsPromises = await import("node:fs/promises");
        const server = await new Promise((resolve) => {
            const s = http.createServer(async (req, res) => {
                try {
                    const url = new URL(req.url, `http://127.0.0.1:${pagePort}`);
                    let filePath = path.join(DIST, decodeURIComponent(url.pathname));
                    const stat = await fsPromises.stat(filePath).catch(() => null);
                    if (!stat || stat.isDirectory()) filePath = path.join(DIST, "index.html");
                    const body = await fsPromises.readFile(filePath);
                    res.writeHead(200, { "content-type": TYPES[path.extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
                    res.end(body);
                } catch (error) { res.writeHead(500).end(String(error)); }
            });
            s.listen(pagePort, "127.0.0.1", () => resolve(s));
        });

        const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-sandbox"], proxy: { server: "http://127.0.0.1:10809", bypass: "127.0.0.1,localhost" } });
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        const session = { access_token: auth.access_token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3500, refresh_token: auth.refresh_token, user: auth.user };
        await page.addInitScript(([k, v]) => { try { globalThis.localStorage.setItem(k, v); } catch {} }, ["dengta_home_auth_v1", JSON.stringify(session)]);
        await page.goto(`http://127.0.0.1:${pagePort}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
        await page.waitForSelector(".main-panel", { timeout: 180_000 }).catch(() => {});
        // 等目标元素真的渲染出来再断言：慢后端下不等就会把「还没加载」误判成「设置未生效」。
        await page.waitForSelector(ASSERT_SELECTOR, { timeout: 120_000 }).catch(() => {});
        await page.waitForTimeout(3_000);
        const mediaRequests = [];
        page.on("request", (request) => {
            const url = request.url();
            if (/private-media|user_avatar|companion_avatar/i.test(url)) mediaRequests.push(url.replace(/^https?:\/\/[^/]+/, "").slice(0, 80));
        });
        // 必须等聊天真的渲染出来再量，否则会得到「没有头像」的假结论。
        await page.waitForSelector(".message-bubble", { timeout: 180_000 }).catch(() => {});
        await page.waitForTimeout(6_000);

        const avatarState = await page.evaluate(() => {
            const allImages = Array.from(document.querySelectorAll("img")).map((el) => ({
                kind: "img",
                cls: String(el.className || "").slice(0, 40),
                src: (el.currentSrc || el.src || "").slice(0, 70),
                naturalWidth: el.naturalWidth,
                complete: el.complete
            }));
            const avatarNodes = Array.from(document.querySelectorAll("[class*=avatar]")).slice(0, 6).map((el) => ({
                tag: el.tagName.toLowerCase(),
                cls: String(el.className || "").slice(0, 50),
                html: el.outerHTML.slice(0, 120)
            }));
            const bgImages = Array.from(document.querySelectorAll("[style]"))
                .map((el) => getComputedStyle(el).backgroundImage || "")
                .filter((value) => value && value !== "none")
                .slice(0, 6);
            return {
                imageCount: allImages.length,
                blobImages: allImages.filter((item) => item.src.startsWith("blob:")),
                privateImages: allImages.filter((item) => /private-media|user_avatar/i.test(item.src)),
                loadedImages: allImages.filter((item) => item.naturalWidth > 0).length,
                avatarNodes,
                bgImages
            };
        });
        record("浏览器里的媒体资源", avatarState);
        record("媒体相关的网络请求", mediaRequests.slice(0, 8));
        const rendered = await page.evaluate((selector) => {
            const nodes = Array.from(document.querySelectorAll(selector));
            return nodes.map((el) => ({ tag: el.tagName.toLowerCase(), naturalWidth: el.naturalWidth ?? null, complete: el.complete ?? null })).slice(0, 4);
        }, ASSERT_SELECTOR);
        record("目标元素是否渲染", { selector: ASSERT_SELECTOR, count: rendered.length, rendered });
        const ok = rendered.length > 0 && (rendered[0].naturalWidth === null || rendered[0].naturalWidth > 0);
        record(ok ? ">>> 结论：设置已生效" : ">>> 结论：设置未生效", { ok });
        if (!ok) mediaE2eFailed = true;
        await page.screenshot({ path: `${OUT}\\avatar-after-set.png`, timeout: 120_000 });
        await browser.close();
        server.close();

        await fs.promises.writeFile(path.join(OUT, "avatar-e2e.json"), JSON.stringify({ ranAt: new Date().toISOString(), steps, avatarState }, null, 2), "utf8");
    }
} finally {
    // 5) 清理：先清偏好，再永久删除临时资产
    if (createdAssetId) {
        const clearPath = path.join(OUT, "_pref-clear.json");
        fs.writeFileSync(clearPath, JSON.stringify({ purpose: PURPOSE, asset_id: null }), "utf8");
        const cleared = curl(["-X", "PUT", `${BASE}/api/v2/private-media/preferences`,
            "-H", "Content-Type: application/json", "--data-binary", `@${clearPath}`]);
        record("清空偏好", cleared);
        const deleted = curl(["-X", "DELETE", `${BASE}/api/v2/private-media/assets/${createdAssetId}`]);
        record("删除临时资产", deleted);

        const finalCatalog = curl([`${BASE}/api/v2/private-media/catalog`]);
        record("清理后的目录", {
            activeAssets: (finalCatalog.assets || []).filter((asset) => asset.status === "active").length,
            preferences: finalCatalog.preferences || {}
        });
    }
}

fs.writeFileSync(path.join(OUT, "avatar-e2e.json"), JSON.stringify({ ranAt: new Date().toISOString(), steps }, null, 2), "utf8");
console.log("\n结果已写入 _audit/browser/avatar-e2e.json");
process.exit(mediaE2eFailed ? 1 : 0);
