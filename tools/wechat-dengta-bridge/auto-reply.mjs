#!/usr/bin/env node
/**
 * WeChat iLink <-> DengTa auto-reply loop.
 *
 * Polls the hardened wxb CLI, sends new trusted text messages through the
 * production DengTa channel bridge (persona + memory), and answers as ClawBot.
 * Secrets live in a local JSON file outside the repository; this file only
 * contains the protocol logic.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = process.env.WECHAT_DENGTA_CONFIG || path.join("D:\\GZdeepseek", "_credentials", "wechat-dengta-bridge.json");
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const CLI_DIR = cfg.wechatCliDir || "D:\\GZdeepseek\\wechat-bridge";
const CLI = path.join(CLI_DIR, "src", "cli", "index.js");
const STATE_DIR = cfg.stateDir || "D:\\GZdeepseek\\wechat-auto-reply-state";
const POLL_MS = Number(cfg.pollIntervalMs || 60000);
const MAX_PROCESSED = 2000;
// 防封号：限速、拟人停顿、单条长度上限。宁可回复慢，也不做机器式连发。
const MAX_REPLIES_PER_HOUR = 30;
const MIN_GLOBAL_GAP_MS = 8000;
const MIN_USER_GAP_MS = 15000;
const MAX_REPLY_CHARS = 900;

fs.mkdirSync(STATE_DIR, { recursive: true });
const processedPath = path.join(STATE_DIR, "processed.json");
const conversationsPath = path.join(STATE_DIR, "conversations.json");
const ratePath = path.join(STATE_DIR, "rate.json");
const logPath = path.join(STATE_DIR, "bridge.log");
const lockPath = path.join(STATE_DIR, "bridge.lock");

function log(message) {
    const line = `${new Date().toISOString()} ${message}`;
    console.log(line);
    try { fs.appendFileSync(logPath, line + "\n"); } catch {}
}

function loadJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function saveJson(file, value) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
}

const processed = new Set(loadJson(processedPath, []));
const conversations = loadJson(conversationsPath, {});
const rate = loadJson(ratePath, { hourStart: 0, hourCount: 0, lastSentAt: 0, lastByUser: {} });

function canReplyNow(userId) {
    const now = Date.now();
    if (now - rate.hourStart >= 3600_000) {
        rate.hourStart = now;
        rate.hourCount = 0;
    }
    if (rate.hourCount >= MAX_REPLIES_PER_HOUR) {
        log(`[rate-limit] hourly cap ${MAX_REPLIES_PER_HOUR} reached; skipping reply`);
        return false;
    }
    if (now - (rate.lastSentAt || 0) < MIN_GLOBAL_GAP_MS) {
        log("[rate-limit] global gap not elapsed; skipping this round");
        return false;
    }
    if (now - (rate.lastByUser?.[userId] || 0) < MIN_USER_GAP_MS) {
        log(`[rate-limit] per-user gap not elapsed for ${userId}; skipping`);
        return false;
    }
    return true;
}

function markReplySent(userId) {
    const now = Date.now();
    rate.hourCount = (rate.hourCount || 0) + 1;
    rate.lastSentAt = now;
    rate.lastByUser = { ...(rate.lastByUser || {}), [userId]: now };
    saveJson(ratePath, rate);
}

function humanPause() {
    const ms = 800 + Math.floor(Math.random() * 1400);
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function rememberProcessed(id) {
    processed.add(String(id));
    while (processed.size > MAX_PROCESSED) processed.delete(processed.values().next().value);
    saveJson(processedPath, [...processed]);
}

function acquireLock() {
    try {
        const existing = Number(fs.readFileSync(lockPath, "utf8").trim());
        if (existing && existing !== process.pid) {
            try { process.kill(existing, 0); log(`[skip] another poller is alive (pid ${existing})`); return false; }
            catch { fs.unlinkSync(lockPath); }
        }
    } catch {}
    try { fs.writeFileSync(lockPath, String(process.pid)); return true; }
    catch { return false; }
}
function releaseLock() {
    try { if (Number(fs.readFileSync(lockPath, "utf8").trim()) === process.pid) fs.unlinkSync(lockPath); } catch {}
}
process.on("exit", releaseLock);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { releaseLock(); process.exit(0); });

function healStateLocks() {
    // 上一轮 fetch 被强杀会留下 accounts/*.lock；按教程只清 pid 已死的孤儿锁。
    const accountsDir = path.join(cfg.wechatStateDir, "accounts");
    let entries = [];
    try { entries = fs.readdirSync(accountsDir); } catch { return; }
    for (const name of entries) {
        if (!name.endsWith(".lock")) continue;
        const file = path.join(accountsDir, name);
        try {
            const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
            const pid = Number(parsed?.pid);
            if (pid) {
                try { process.kill(pid, 0); continue; }
                catch { fs.unlinkSync(file); log(`[self-heal] removed orphan lock ${name} (pid ${pid})`); }
            } else if (Date.now() - fs.statSync(file).mtimeMs > 300000) {
                fs.unlinkSync(file);
                log(`[self-heal] removed stale lock ${name}`);
            }
        } catch {}
    }
}

function runCli(args, timeoutMs) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CLI, ...args], {
            cwd: CLI_DIR,
            env: { ...process.env, WX_STATE_DIR: cfg.wechatStateDir, WX_FETCH_TIMEOUT_MS: "100000" },
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            try { child.kill(); } catch {}
            reject(new Error(`wxb timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", (error) => { clearTimeout(timer); reject(error); });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(`wxb exited ${code}: ${stderr.slice(-400) || stdout.slice(-400)}`));
            resolve({ stdout, stderr });
        });
    });
}

function parseCliJson(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) throw new Error("empty wxb output");
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error(`unexpected wxb output: ${trimmed.slice(0, 300)}`);
    return JSON.parse(trimmed.slice(start, end + 1));
}

async function fetchMessages() {
    const { stdout } = await runCli(["fetch", "--maxAttempts", "2"], 280000);
    const parsed = parseCliJson(stdout);
    if (!parsed.ok) throw new Error(`fetch failed: ${parsed.error?.code || "unknown"} ${parsed.error?.message || ""}`);
    return parsed.data;
}

async function sendText(accountId, userId, text) {
    const args = ["send", "--user", userId, "--text", text];
    if (accountId) args.unshift("--account", accountId);
    const { stdout } = await runCli(args, 120000);
    const parsed = parseCliJson(stdout);
    if (!parsed.ok) throw new Error(`send failed: ${parsed.error?.code || "unknown"} ${parsed.error?.message || ""}`);
    return parsed.data;
}

function messageText(message) {
    if (message.type === "text" && typeof message.text === "string" && message.text.trim()) return message.text.trim();
    const itemText = (message.items || []).filter((item) => item.kind === "text" && item.text).map((item) => item.text).join("\n").trim();
    if (itemText) return itemText;
    const kinds = [...new Set((message.items || []).map((item) => item.kind).filter(Boolean))];
    return `[用户发来一条${kinds.length ? kinds.join("/") : message.type || "非文字"}消息，自动回复暂时只能处理文字]`;
}

async function chatWithDengTa(text, conversationId) {
    const body = {
        qq: cfg.bindingKey,
        text,
        client_message_id: crypto.randomUUID(),
    };
    if (conversationId) body.conversation_id = conversationId;
    const response = await fetch(`${cfg.backendBaseUrl}/api/v2/qq-bridge/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-dengta-qq-token": cfg.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
        throw new Error(`DengTa chat failed: HTTP ${response.status} ${payload.code || ""} ${payload.message || ""}`.trim());
    }
    return payload;
}

async function pollOnce() {
    if (!acquireLock()) return;
    try {
        healStateLocks();
        const data = await fetchMessages();
        const accountId = data.accountId || "";
        const messages = (data.messages || []).filter((message) => message.trusted !== false);
        const pending = messages.filter((message) => message?.id && !processed.has(String(message.id)));
        if (!pending.length) return;
        for (const message of pending) {
            const userId = message.fromUserId;
            const text = messageText(message);
            log(`[in] ${userId} ${text.slice(0, 80).replace(/\s+/g, " ")}`);
            if (!canReplyNow(userId)) {
                rememberProcessed(message.id);
                continue;
            }
            let reply = "";
            try {
                const result = await chatWithDengTa(text, conversations[userId]?.conversationId);
                reply = String(result.reply || "").trim();
                if (result.conversation_id) {
                    conversations[userId] = { conversationId: result.conversation_id, updatedAt: new Date().toISOString() };
                    saveJson(conversationsPath, conversations);
                }
            } catch (error) {
                log(`[chat-error] ${error.message}`);
                reply = "我这会儿有点卡住了，等我一下再回你。";
            }
            if (reply) {
                reply = reply.slice(0, MAX_REPLY_CHARS);
                try {
                    await humanPause();
                    await sendText(accountId, userId, reply);
                    markReplySent(userId);
                    log(`[out] ${userId} ${reply.slice(0, 80).replace(/\s+/g, " ")}`);
                } catch (error) {
                    log(`[send-error] ${error.message}`);
                }
            }
            rememberProcessed(message.id);
        }
    } finally {
        releaseLock();
    }
}

log(`[start] polling every ${POLL_MS}ms, chat=${cfg.backendBaseUrl}`);
while (true) {
    try {
        await pollOnce();
    } catch (error) {
        const message = String(error.message || error);
        log(`[poll-error] ${message}`);
        if (message.includes("SESSION_EXPIRED")) {
            log("[fatal] WeChat iLink session expired; stop polling and wait for a fresh QR login");
            process.exit(2);
        }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}
