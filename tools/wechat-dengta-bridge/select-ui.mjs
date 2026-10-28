#!/usr/bin/env node
/**
 * DengTa channel-sync console (DB-backed).
 *
 * Temporary local UI until the DengTa frontend repo is deployable. Reads
 * persona sections / memories / preferences from the production channel-sync
 * API using the owner's Supabase session, lets the owner tick sections and
 * memories for WeChat, and writes the selection back through the authenticated
 * API. Loopback only; no tokens are rendered into the page.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const CONFIG_PATH = process.env.WECHAT_DENGTA_CONFIG || path.join("D:\\GZdeepseek", "_credentials", "wechat-dengta-bridge.json");
const SESSION_PATH = process.env.DENGTA_SESSION_PATH || path.join("D:\\GZdeepseek", "_credentials", "dengta-account-session.json");
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const BASE = cfg.backendBaseUrl;
const PORT = Number(process.env.CHANNEL_SYNC_PORT || 3111);

function sessionToken() {
    const session = JSON.parse(fs.readFileSync(SESSION_PATH, "utf8"));
    return String(session.access_token || "");
}
async function api(pathname, options = {}) {
    const response = await fetch(`${BASE}${pathname}`, {
        ...options,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken()}`, ...(options.headers || {}) },
        signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload };
}
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
const CATEGORY_LABELS = { normal: "正常", private: "私密", nsfw: "NSFW / 色情", style: "说话风格" };

async function loadState() {
    const [sections, prefs, memories] = await Promise.all([
        api("/api/v2/channel-sync/persona-sections"),
        api("/api/v2/channel-sync/preferences?channel=wechat"),
        api("/api/v2/channel-sync/memories?limit=50"),
    ]);
    if (!sections.payload.ok || !prefs.payload.ok || !memories.payload.ok) {
        throw new Error(`channel-sync API failed: ${sections.status}/${prefs.status}/${memories.status}`);
    }
    return {
        sections: sections.payload.sections || [],
        preferences: prefs.payload.preferences || {},
        memories: memories.payload.memories || [],
    };
}

function renderPage(state) {
    const prefs = state.preferences || {};
    const selectedSections = new Set(prefs.persona_section_ids || []);
    const selectedMemories = new Set(prefs.memory_ids || []);
    const sectionRows = state.sections.map((section) => `
      <tr class="cat-${escapeHtml(section.category)}">
        <td><input type="checkbox" data-section-id="${escapeHtml(section.id)}" ${selectedSections.has(section.id) ? "checked" : ""}></td>
        <td>${escapeHtml(CATEGORY_LABELS[section.category] || section.category)}</td>
        <td>${escapeHtml(section.title)}</td>
        <td><details><summary>查看内容</summary><pre>${escapeHtml(section.content)}</pre></details></td>
      </tr>`).join("");
    const memoryRows = state.memories.map((memory) => `
      <tr><td><input type="checkbox" data-memory-id="${escapeHtml(memory.id)}" ${selectedMemories.has(memory.id) ? "checked" : ""}></td>
      <td>${escapeHtml(memory.updated_at || "")}</td><td>${escapeHtml(memory.summary)}</td></tr>`).join("");
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>DengTa 通道同步</title>
<style>
body{font:14px/1.5 system-ui;margin:24px;max-width:1100px;background:#fafafa;color:#222}
h1{font-size:20px}.hint{color:#666}table{border-collapse:collapse;width:100%;background:#fff}
th,td{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left}
.cat-nsfw{background:#fff2f2}.cat-private{background:#fff8ef}.cat-style{background:#f2f7ff}
pre{white-space:pre-wrap;max-width:680px;max-height:240px;overflow:auto;margin:6px 0}
button{padding:8px 20px;font-size:14px;cursor:pointer}.toolbar{position:sticky;bottom:0;background:#fafafa;padding:10px 0}
</style>
<h1>DengTa 通道同步 · 微信</h1>
<p class="hint">勾选要同步到微信的人设小节和记忆；默认全部关闭。保存后下一轮微信回复生效，数据写回 DengTa 账号（不是本地文件）。</p>
<h2>人设小节（${state.sections.length}）</h2>
<table><thead><tr><th>同步</th><th>分类</th><th>标题</th><th>内容</th></tr></thead><tbody>${sectionRows || "<tr><td colspan=4>还没有人设小节</td></tr>"}</tbody></table>
<h2>说话风格</h2>
<p><label><input type="checkbox" id="style-enabled" ${prefs.style_enabled ? "checked" : ""}> 启用独立说话风格</label></p>
<textarea id="style-text" rows="4" style="width:100%">${escapeHtml(prefs.style_text || "")}</textarea>
<h2>记忆词条（${state.memories.length}）</h2>
<table><thead><tr><th>同步</th><th>更新时间</th><th>摘要</th></tr></thead><tbody>${memoryRows || "<tr><td colspan=3>没有记忆</td></tr>"}</tbody></table>
<div class="toolbar"><button id="save">保存勾选</button> <span id="status" class="hint"></span></div>
<script>
document.getElementById("save").onclick = async () => {
  const status = document.getElementById("status");
  status.textContent = "保存中…";
  const sectionIds = [...document.querySelectorAll("[data-section-id]")].filter((el) => el.checked).map((el) => el.dataset.sectionId);
  const memoryIds = [...document.querySelectorAll("[data-memory-id]")].filter((el) => el.checked).map((el) => el.dataset.memoryId);
  const response = await fetch("/save", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Channel-Sync": "1" },
    body: JSON.stringify({ section_ids: sectionIds, memory_ids: memoryIds, style_enabled: document.getElementById("style-enabled").checked, style_text: document.getElementById("style-text").value })
  });
  const result = await response.json();
  status.textContent = result.ok ? "已保存，下一条微信消息生效" : ("失败: " + (result.error || ""));
};
</script></html>`;
}

async function saveState(body) {
    const state = await loadState();
    const sectionIds = new Set(Array.isArray(body.section_ids) ? body.section_ids : []);
    const memoryIds = new Set(Array.isArray(body.memory_ids) ? body.memory_ids.slice(0, 50) : []);
    const sections = state.sections.map((section) => ({
        section_key: section.section_key,
        title: section.title,
        content: section.content,
        category: section.category,
        enabled: sectionIds.has(section.id),
        sort_order: section.sort_order,
    }));
    const putSections = await api("/api/v2/channel-sync/persona-sections", { method: "PUT", body: JSON.stringify({ sections }) });
    if (!putSections.payload.ok) throw new Error(`保存人设小节失败: HTTP ${putSections.status}`);
    const enabledIds = state.sections.filter((section) => sectionIds.has(section.id)).map((section) => section.id);
    const prefs = {
        channel: "wechat",
        persona_mode: enabledIds.length ? "selected" : "normal_only",
        persona_section_ids: enabledIds,
        style_enabled: body.style_enabled === true,
        style_text: String(body.style_text || "").slice(0, 4000),
        memory_mode: memoryIds.size ? "selected" : "none",
        memory_ids: [...memoryIds],
        memory_keywords: [],
        memory_limit: memoryIds.size,
        media_enabled: false,
    };
    const putPrefs = await api("/api/v2/channel-sync/preferences", { method: "PUT", body: JSON.stringify(prefs) });
    if (!putPrefs.payload.ok) throw new Error(`保存通道偏好失败: HTTP ${putPrefs.status}`);
    return { ok: true, sections: enabledIds.length, memories: memoryIds.size };
}

const server = http.createServer(async (req, res) => {
    try {
        if (req.url === "/" && req.method === "GET") {
            const state = await loadState();
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" });
            res.end(renderPage(state));
            return;
        }
        if (req.url === "/save" && req.method === "POST") {
            const origin = String(req.headers.origin || "");
            if (!String(req.headers["content-type"] || "").includes("application/json") || req.headers["x-channel-sync"] !== "1" || (origin && origin !== `http://127.0.0.1:${PORT}`)) {
                res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: false, error: "forbidden" }));
                return;
            }
            let body = "";
            req.on("data", (chunk) => { body += chunk; if (body.length > 2_000_000) req.destroy(); });
            req.on("end", async () => {
                try {
                    const result = await saveState(JSON.parse(body || "{}"));
                    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify(result));
                } catch (error) {
                    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
                }
            });
            return;
        }
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found");
    } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
    }
});

server.listen(PORT, "127.0.0.1", () => console.log(`DB-backed channel-sync console: http://127.0.0.1:${PORT}`));
