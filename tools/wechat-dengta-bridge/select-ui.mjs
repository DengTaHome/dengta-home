#!/usr/bin/env node
/**
 * Local channel-sync console (temporary UI until the DengTa frontend repo is
 * deployable). Serves one page on 127.0.0.1:3111, lets the owner toggle persona
 * sections / memories / style for the WeChat channel, and writes selection.json
 * consumed by auto-reply.mjs. Binds loopback only; no secrets in the page.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const CONFIG_PATH = process.env.WECHAT_DENGTA_CONFIG || path.join("D:\\GZdeepseek", "_credentials", "wechat-dengta-bridge.json");
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const STATE_DIR = cfg.stateDir || "D:\\GZdeepseek\\wechat-auto-reply-state";
const SELECTION_PATH = path.join(STATE_DIR, "selection.json");
const PORT = Number(process.env.CHANNEL_SYNC_PORT || 3111);

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function loadSelection() {
    try { return JSON.parse(fs.readFileSync(SELECTION_PATH, "utf8")); }
    catch { return null; }
}

const CATEGORY_LABELS = { normal: "正常", private: "私密", nsfw: "NSFW / 色情", style: "说话风格" };

function renderPage(selection) {
    if (!selection) {
        return "<!doctype html><meta charset='utf-8'><p>还没有 selection.json，请先运行 <code>make-selection.mjs</code>。</p>";
    }
    const sectionRows = (selection.sections || []).map((section, index) => `
      <tr class="cat-${escapeHtml(section.category)}">
        <td><input type="checkbox" data-section="${index}" ${section.enabled ? "checked" : ""}></td>
        <td>${escapeHtml(CATEGORY_LABELS[section.category] || section.category)}</td>
        <td>${escapeHtml(section.title)}</td>
        <td><details><summary>查看内容</summary><pre>${escapeHtml(section.content)}</pre></details></td>
      </tr>`).join("");
    const memoryRows = (selection.memories || []).map((memory, index) => `
      <tr><td><input type="checkbox" data-memory="${index}" ${memory.enabled ? "checked" : ""}></td>
      <td>${escapeHtml(memory.updated_at || "")}</td><td>${escapeHtml(memory.summary)}</td></tr>`).join("");
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>DengTa 通道同步 · ${escapeHtml(selection.ai_name || "伴侣")}</title>
<style>
body{font:14px/1.5 system-ui;margin:24px;max-width:1100px;background:#fafafa;color:#222}
h1{font-size:20px} .hint{color:#666} table{border-collapse:collapse;width:100%;background:#fff}
th,td{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left}
.cat-nsfw{background:#fff2f2}.cat-private{background:#fff8ef}.cat-style{background:#f2f7ff}
pre{white-space:pre-wrap;max-width:680px;max-height:240px;overflow:auto;margin:6px 0}
button{padding:8px 20px;font-size:14px;cursor:pointer}
.toolbar{position:sticky;bottom:0;background:#fafafa;padding:10px 0}
</style>
<h1>DengTa 通道同步 · ${escapeHtml(selection.ai_name || "伴侣")}</h1>
<p class="hint">只勾选你愿意同步到微信的人设小节和记忆。私密/NSFW 小节默认关闭；记忆默认全部关闭。保存后下一轮微信回复立即生效。</p>
<h2>人设小节（${sectionRows ? "" : "无"}）</h2>
<table><thead><tr><th>同步</th><th>分类</th><th>标题</th><th>内容</th></tr></thead><tbody>${sectionRows}</tbody></table>
<h2>说话风格</h2>
<p><label><input type="checkbox" id="style-enabled" ${selection.style_enabled ? "checked" : ""}> 启用独立说话风格</label></p>
<textarea id="style-text" rows="4" style="width:100%">${escapeHtml(selection.style_text || "")}</textarea>
<h2>记忆词条</h2>
<table><thead><tr><th>同步</th><th>更新时间</th><th>摘要</th></tr></thead><tbody>${memoryRows || "<tr><td colspan=3>没有记忆</td></tr>"}</tbody></table>
<div class="toolbar"><button id="save">保存勾选</button> <span id="status" class="hint"></span></div>
<script>
function collect(){
  const selection = ${JSON.stringify(JSON.stringify(selection))};
  const data = JSON.parse(selection);
  document.querySelectorAll("[data-section]").forEach((el)=>{ data.sections[Number(el.dataset.section)].enabled = el.checked; });
  document.querySelectorAll("[data-memory]").forEach((el)=>{ data.memories[Number(el.dataset.memory)].enabled = el.checked; });
  data.style_enabled = document.getElementById("style-enabled").checked;
  data.style_text = document.getElementById("style-text").value;
  return data;
}
document.getElementById("save").onclick = async () => {
  const status = document.getElementById("status");
  status.textContent = "保存中…";
  const response = await fetch("/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(collect()) });
  const result = await response.json();
  status.textContent = result.ok ? "已保存，下一条微信消息生效" : ("失败: " + (result.error || ""));
};
</script></html>`;
}

const server = http.createServer((req, res) => {
    if (req.url === "/" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(renderPage(loadSelection()));
        return;
    }
    if (req.url === "/api/selection" && req.method === "GET") {
        const selection = loadSelection();
        res.writeHead(selection ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(selection ? { ok: true, selection } : { ok: false, error: "selection missing" }));
        return;
    }
    if (req.url === "/save" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => { body += chunk; if (body.length > 2_000_000) req.destroy(); });
        req.on("end", () => {
            try {
                const incoming = JSON.parse(body);
                const current = loadSelection();
                if (!current) throw new Error("selection missing");
                const next = {
                    ...current,
                    sections: (current.sections || []).map((section, index) => ({ ...section, enabled: Boolean(incoming.sections?.[index]?.enabled) })),
                    memories: (current.memories || []).map((memory, index) => ({ ...memory, enabled: Boolean(incoming.memories?.[index]?.enabled) })),
                    style_enabled: Boolean(incoming.style_enabled),
                    style_text: String(incoming.style_text || "").slice(0, 4000),
                    updatedAt: new Date().toISOString(),
                };
                fs.writeFileSync(SELECTION_PATH, JSON.stringify(next, null, 2));
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: true }));
            } catch (error) {
                res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
            }
        });
        return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`channel-sync console: http://127.0.0.1:${PORT}`);
});
