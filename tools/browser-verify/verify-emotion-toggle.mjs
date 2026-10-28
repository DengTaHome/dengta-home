// 真机验证 · 情绪理解开关一致性
//
// 产品口径（本轮确定，可回滚）：关闭「情绪理解」后
//   - 历史消息里的语音情绪标签隐藏（数据保留，重新开启即可恢复）
//   - 最近一次语音分析卡片只显示转写，并明确写「情绪理解已关闭」
//   - 新语音轮次不再把情绪标签渲染出来
//
// 验证方式：拦截 /voice/turn 返回可控的 voice_analysis，
// 只用 localStorage 控制开关（应用启动时读取的就是它），
// 再尝试打开设置面板确认下拉框与状态一致。
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
const SUPABASE_ANON = process.env.DENGTA_SUPABASE_ANON || "sb_publishable_8igj37ucC_HG98LSFwnkHA_6QBtcE8F";
const SUPABASE_TOKEN_URL = process.env.DENGTA_SUPABASE_TOKEN_URL || "https://nyyqizwrlmejpfdhgrnd.supabase.co/auth/v1/token?grant_type=password";
const { chromium } = createRequire(import.meta.url)("D:\\GZdeepseek\\_tools\\pw\\node_modules\\playwright-core");

await fs.mkdir(OUT, { recursive: true });
const creds = JSON.parse(fsSync.readFileSync(CRED, "utf8"));
const bodyPath = path.join(OUT, "_emotion-body.json");
fsSync.writeFileSync(bodyPath, JSON.stringify(creds));
const auth = JSON.parse(
  execFileSync("curl.exe", ["-s", "--max-time", "90", "--socks5-hostname", "127.0.0.1:10808",
    "-X", "POST", SUPABASE_TOKEN_URL, "-H", `apikey: ${SUPABASE_ANON}`, "-H", "Content-Type: application/json",
    "--data-binary", `@${bodyPath}`], { encoding: "utf8" })
);
const session = {
  access_token: auth.access_token,
  token_type: "bearer",
  expires_in: auth.expires_in,
  expires_at: Math.floor(Date.now() / 1000) + auth.expires_in - 60,
  refresh_token: auth.refresh_token,
  user: auth.user,
};
const EMOTION_KEY = `dengta_emotion_understanding_enabled:${auth.user.id}`;

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".webp": "image/webp" };
const server = await new Promise((resolve) => {
  const s = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      let file = path.join(DIST, decodeURIComponent(url.pathname));
      const stat = await fs.stat(file).catch(() => null);
      if (!stat || stat.isDirectory()) file = path.join(DIST, "index.html");
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(await fs.readFile(file));
    } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
  });
  s.listen(PORT, "127.0.0.1", () => resolve(s));
});

const checks = [];
const failures = [];
const record = (name, passed, detail) => {
  checks.push({ name, passed, detail });
  if (!passed) failures.push(`${name}: ${JSON.stringify(detail)}`);
  console.log(`  ${passed ? "✓" : "✗"} ${name}${passed ? "" : "  -> " + JSON.stringify(detail)}`);
};
// 这个脚本是 run-all 的 blocking 项：不允许"跳过"当成通过，否则又是假通过。
const skip = (name, reason) => {
  checks.push({ name, passed: false, skipped: true, reason });
  failures.push(`${name}: SKIPPED ${reason}`);
  console.log(`  ✗ ${name} -> SKIPPED：${reason}`);
};

const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  proxy: { server: "http://127.0.0.1:10809", bypass: "127.0.0.1,localhost" },
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
await context.grantPermissions(["microphone"], { origin: `http://127.0.0.1:${PORT}` });
const page = await context.newPage();
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
// 可控的语音轮次响应：真实触发前端从"语音返回"到"消息渲染"的完整链路。
const voiceRequests = [];
// 历史语音消息：验证 reload 后 hydrate 路径的情绪标签是否也被开关控制。
const historyMockLog = [];
await page.route(/\/api\/v2\/sessions\/[^/]+\/messages/, async (route) => {
  try {
    const response = await route.fetch();
    const json = await response.json();
    const synthetic = {
      id: "synthetic-history-voice",
      role: "user",
      content: "历史语音：今天有点累",
      created_at: new Date().toISOString(),
      voice_analysis: { text: "历史语音：今天有点累", emotion: "calm", confidence: 0.8, hint: "" },
    };
    const messages = Array.isArray(json.messages) ? json.messages : [];
    if (!messages.some((message) => message.id === synthetic.id)) messages.unshift(synthetic);
    historyMockLog.push({
      path: new URL(route.request().url()).pathname,
      messageCount: messages.length,
      syntheticIncluded: messages.some((message) => message.id === synthetic.id),
    });
    await route.fulfill({
      status: response.status(),
      contentType: "application/json",
      body: JSON.stringify({ ...json, messages }),
    });
  } catch {
    await route.continue();
  }
});
await page.route("**/voice/turn", async (route) => {
  const body = route.request().postDataBuffer?.()?.toString("utf8") || "";
  voiceRequests.push(body);
  const match = body.match(/name="session_id"\r?\n\r?\n([0-9a-zA-Z-]+)/);
  const sessionId = match ? match[1] : "";
  const now = new Date().toISOString();
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session_id: sessionId,
      user_message: { id: `synthetic-user-${Date.now()}`, role: "user", content: "今天有点累", created_at: now },
      assistant_message: { id: `synthetic-assistant-${Date.now()}`, role: "assistant", content: "那就先歇一会儿，我在。", created_at: now },
      voice_analysis: { text: "今天有点累", emotion: "calm", confidence: 0.78, hint: "声音线索：语速偏慢" },
      prompt_receipt: null,
    }),
  });
});
await page.addInitScript(([key, value]) => {
  try {
    globalThis.localStorage.setItem(key, value);
    // 每个阶段从「没有聊天缓存」开始：否则上一阶段的情绪标签会进入首屏缓存，
    // 让 before/after 基线漂移，产生假失败或假通过。
    for (const cacheKey of Object.keys(globalThis.localStorage)) {
      if (/chat-cache|chat_cache|dengta\.chat/i.test(cacheKey)) {
        globalThis.localStorage.removeItem(cacheKey);
      }
    }
  } catch { /* ignore */ }
}, ["dengta_home_auth_v1", JSON.stringify(session)]);
const setEmotion = async (enabled) => {
  // 必须在应用同源页面里写：about:blank 上写 localStorage 会被丢弃。
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 }).catch(() => {});
  await page.evaluate(([key, value]) => {
    try { globalThis.localStorage.setItem(key, value); } catch { /* ignore */ }
  }, [EMOTION_KEY, enabled ? "true" : "false"]);
};

const loadChat = async () => {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const ready = await page.waitForSelector(".message-list, .chat-voice-button", { timeout: 120_000 }).then(() => true).catch(() => false);
  if (!ready) return false;
  await page.waitForTimeout(3_000);
  // 选中一个会话，确保语音请求带 session_id（拦截器用它回填响应）
  const items = page.locator(".session-select");
  if ((await items.count()) > 0 && (await page.locator(".message-bubble").count()) === 0) {
    await items.first().evaluate((node) => node.click()).catch(() => {});
    await page.waitForTimeout(3_000);
  }
  await page.waitForSelector(".chat-voice-button:not(.chat-voice-cancel)", { timeout: 60_000 }).catch(() => {});
  return true;
};

const sendFakeVoiceTurn = async (label) => {
  const mic = page.locator(".chat-voice-button:not(.chat-voice-cancel)").first();
  await mic.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  const box = await mic.boundingBox();
  const x = box ? box.x + box.width / 2 : 320;
  const y = box ? box.y + box.height / 2 : 800;
  const before = await page.evaluate(() => ({
    meta: document.querySelectorAll(".voice-message-meta").length,
    card: document.querySelector(".voice-analysis-card")?.textContent || "",
    transcriptBubbles: Array.from(document.querySelectorAll(".message-bubble")).filter((node) =>
      /今天有点累/.test(node.textContent || ""),
    ).length,
  }));
  await mic.dispatchEvent("pointerdown", { pointerId: 51, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y });
  await page.waitForTimeout(1_500);
  await mic.dispatchEvent("pointerup", { pointerId: 51, pointerType: "touch", isPrimary: true, button: 0, buttons: 0, clientX: x, clientY: y });
  const arrived = await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll(".message-bubble")).some((node) =>
          /今天有点累/.test(node.textContent || ""),
        ),
      null,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(500);
  // 语音分析卡片渲染在"更多功能"菜单里：先打开菜单再读，读完关掉。
  const menuTrigger = page.locator('button[aria-label="打开更多功能"]').first();
  if (await menuTrigger.count()) {
    await menuTrigger.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  const after = await page.evaluate(() => ({
    meta: document.querySelectorAll(".voice-message-meta").length,
    metas: Array.from(document.querySelectorAll(".voice-message-meta")).map((node) => node.textContent.trim()).slice(-2),
    card: document.querySelector(".voice-analysis-card")?.textContent || "",
    transcriptBubbles: Array.from(document.querySelectorAll(".message-bubble")).filter((node) =>
      /今天有点累/.test(node.textContent || ""),
    ).length,
    userTextAppeared: Array.from(document.querySelectorAll(".message-bubble")).some((node) => /今天有点累/.test(node.textContent || "")),
    notice: document.querySelector(".notice")?.textContent || "",
    menuOpen: Boolean(document.querySelector(".composer-tool-menu")),
  }));
  const closeTrigger = page.locator('button[aria-label="关闭更多功能"]').first();
  if (await closeTrigger.count()) await closeTrigger.click({ timeout: 8_000 }).catch(() => {});
  return { label, arrived, before, after };
};

// ---- 阶段 1：关闭状态 ----
let ok = await loadChat();
await setEmotion(false);
await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
ok = await loadChat();
record("关闭状态下聊天页加载", ok, ok);
let closed = null;
if (ok) {
  closed = await sendFakeVoiceTurn("关闭");
  record("关闭状态仍能完成语音轮次", closed.arrived, closed.after.card.slice(0, 60));
  record("关闭后新消息确实出现了",
    closed.after.transcriptBubbles > closed.before.transcriptBubbles,
    { before: closed.before.transcriptBubbles, after: closed.after.transcriptBubbles });
  record("关闭后新消息不显示情绪标签",
    closed.after.meta === closed.before.meta,
    { before: closed.before.meta, after: closed.after.meta });
  record("关闭后语音分析卡明确提示已关闭",
    /情绪理解已关闭/.test(closed.after.card),
    closed.after.card.slice(0, 80));
  record("关闭后卡片仍保留文字转写",
    /今天有点累/.test(closed.after.card),
    closed.after.card.slice(0, 80));
  record("关闭后提示条不泄露情绪/置信度",
    !/情绪线索|置信度/.test(closed.after.notice) && /语音已转写/.test(closed.after.notice),
    closed.after.notice);
  const closedRequestBody = voiceRequests.at(-1) || "";
  record("关闭状态请求里 emotion_understanding_enabled=false",
    closedRequestBody.includes("emotion_understanding_enabled") && closedRequestBody.includes("false"));
}

// ---- 阶段 2：开启状态 ----
await setEmotion(true);
await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
ok = await loadChat();
record("开启状态下聊天页加载", ok, ok);
let opened = null;
if (ok) {
  opened = await sendFakeVoiceTurn("开启");
  record("开启状态能完成语音轮次", opened.arrived, opened.after.card.slice(0, 60));
  record("开启后新消息显示情绪标签",
    opened.after.meta > opened.before.meta,
    { before: opened.before.meta, after: opened.after.meta, metas: opened.after.metas });
  record("开启后情绪标签包含情绪与置信度",
    (opened.after.metas.at(-1) || "").length > 0 &&
      /置信度/.test(opened.after.metas.at(-1) || ""),
    opened.after.metas);
  record("开启后分析卡显示情绪与置信度",
    /平静|calm|置信度/.test(opened.after.card),
    opened.after.card.slice(0, 80));
  record("开启后提示条包含情绪线索",
    /情绪线索|置信度/.test(opened.after.notice),
    opened.after.notice);
  const openedRequestBody = voiceRequests.at(-1) || "";
  record("开启状态请求里 emotion_understanding_enabled=true",
    openedRequestBody.includes("emotion_understanding_enabled") && openedRequestBody.includes("true"));
}

// ---- 阶段 3：设置面板下拉框与持久化状态一致（找不到入口则跳过，不假通过） ----
await setEmotion(false);
await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
ok = await loadChat();
if (ok) {
  let selectState = null;
  try {
    const capsule = page.locator(".sun-glass-liquid-capsule-toggle").first();
    if (await capsule.count()) {
      await capsule.click({ timeout: 8_000 });
      await page.waitForTimeout(1_200);
      const gear = page.locator('.status-panel [title="设置"], .status-panel [aria-label*="设置"]').first();
      if (await gear.count()) {
        await gear.click({ timeout: 8_000 });
        await page.waitForTimeout(1_800);
        const voiceCategory = page.locator("button", { hasText: "语音与情绪" }).first();
        if (await voiceCategory.count()) {
          await voiceCategory.click({ timeout: 8_000 }).catch(() => {});
          await page.waitForTimeout(1_200);
        }
        selectState = await page.evaluate(() => {
          const labels = Array.from(document.querySelectorAll("label"));
          const target = labels.find((node) => /情绪理解/.test(node.textContent || ""));
          const select = target?.querySelector("select");
          return select ? { value: select.value, options: Array.from(select.options).map((o) => o.textContent.trim()) } : null;
        });
        if (selectState) {
          record("设置面板的情绪开关与持久化状态一致", selectState.value === "false", selectState);
          await page.evaluate(() => {
            const labels = Array.from(document.querySelectorAll("label"));
            const target = labels.find((node) => /情绪理解/.test(node.textContent || ""));
            const select = target?.querySelector("select");
            if (select) {
              select.value = "true";
              select.dispatchEvent(new Event("change", { bubbles: true }));
            }
          });
          await page.waitForTimeout(500);
          const stored = await page.evaluate((key) => globalThis.localStorage.getItem(key), EMOTION_KEY);
          record("在设置里切换开关会持久化", stored === "true", stored);
        }
      }
    }
  } catch (error) {
    skip("设置面板情绪开关", String(error).slice(0, 100));
  }
  if (!selectState) skip("设置面板情绪开关", "没有找到状态面板/设置入口/情绪下拉框");
}

// ---- 阶段 4：历史消息（reload 后的 hydrate 路径） ----
await setEmotion(false);
await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
ok = await loadChat();
if (ok) {
  const historyBubble = await page
    .waitForFunction(
      () => Array.from(document.querySelectorAll(".message-bubble")).some((node) => /历史语音/.test(node.textContent || "")),
      null,
      { timeout: 60_000 },
    )
    .then(() => true)
    .catch(() => false);
  record("关闭状态能加载历史语音消息", historyBubble, historyBubble);
  if (historyBubble) {
    const closedHistory = await page.evaluate(() => ({
      meta: document.querySelectorAll(".voice-message-meta").length,
      metas: Array.from(document.querySelectorAll(".voice-message-meta")).map((node) => node.textContent.trim()).slice(0, 2),
    }));
    record("关闭后历史语音消息不显示情绪标签", closedHistory.meta === 0, closedHistory);
  }
}

await setEmotion(true);
await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
ok = await loadChat();
if (ok) {
  const historyBubble = await page
    .waitForFunction(
      () => Array.from(document.querySelectorAll(".message-bubble")).some((node) => /历史语音/.test(node.textContent || "")),
      null,
      { timeout: 60_000 },
    )
    .then(() => true)
    .catch(() => false);
  record("开启状态能加载历史语音消息", historyBubble, historyBubble);
  if (historyBubble) {
    const openedHistory = await page.evaluate(() => {
      const bubble = Array.from(document.querySelectorAll(".message-bubble")).find((node) =>
        /历史语音/.test(node.textContent || ""),
      );
      return {
        meta: document.querySelectorAll(".voice-message-meta").length,
        metas: Array.from(document.querySelectorAll(".voice-message-meta")).map((node) => node.textContent.trim()).slice(0, 2),
        bubbleHtml: bubble ? bubble.outerHTML.slice(0, 1400) : "",
        voiceNodes: Array.from(document.querySelectorAll("[class*=voice]")).map((node) => String(node.className)).slice(0, 8),
        historyMockLog: globalThis.__historyMockLog || null,
      };
    });
    record("重新开启后历史情绪标签恢复显示",
      (openedHistory.meta >= 1 && /置信度/.test(openedHistory.metas.join(" "))),
      { ...openedHistory, nodeMockLog: historyMockLog.slice(-4) });
  }
}

// 清理：恢复默认（开启）
await setEmotion(true);
await fs.writeFile(`${OUT}/emotion-toggle.json`, JSON.stringify({ ranAt: new Date().toISOString(), checks, failures }, null, 2), "utf8");
console.log(failures.length ? `\n✗ ${failures.length} 项不通过` : "\n✓ 全部通过");
await browser.close();
server.close();
process.exit(failures.length ? 1 : 0);








