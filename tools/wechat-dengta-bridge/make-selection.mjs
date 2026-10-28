#!/usr/bin/env node
/**
 * Build a channel-sync selection file from the DengTa channel context endpoint.
 *
 * The persona prompt is split on blank-line paragraphs (the production persona
 * uses plain section titles, not Markdown headings). Each paragraph becomes a
 * toggleable section; paragraphs that look sexual/private are categorized as
 * nsfw/private and disabled by default. Memories are also listed, disabled by
 * default, so nothing leaves DengTa until the owner opts in.
 *
 * Output: <stateDir>/selection.json; only counts/categories are printed, never
 * persona text.
 */
import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = process.env.WECHAT_DENGTA_CONFIG || path.join("D:\\GZdeepseek", "_credentials", "wechat-dengta-bridge.json");
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const STATE_DIR = cfg.stateDir || "D:\\GZdeepseek\\wechat-auto-reply-state";
const SELECTION_PATH = path.join(STATE_DIR, "selection.json");

const NSFW_WORDS = [
    "性", "做爱", "性爱", "高潮", "射", "精液", "肉棒", "阴茎", "阴道", "乳头", "口交",
    "舔", "淫", "色情", "裸", "私处", "屁股", "调教", "项圈", "笼子", "惩罚", "插",
    "主人", "宠物", "服从", "发情", "乳房", "乳",
];
const STYLE_WORDS = ["风格", "说话", "语气", "口癖", "口头禅", "标点", "emoji", "颜文字", "句子"];

function classify(title, content) {
    const text = `${title}\n${content}`.toLowerCase();
    if (NSFW_WORDS.some((word) => text.includes(word))) return "nsfw";
    if (STYLE_WORDS.some((word) => text.includes(word))) return "style";
    return "normal";
}

function splitSections(prompt) {
    const text = String(prompt || "").trim();
    if (!text) return [];
    const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    return blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const title = (lines[0] || `小节 ${index + 1}`).replace(/^#+\s*/, "").slice(0, 40);
        const content = block;
        const category = classify(title, content);
        return {
            id: `section-${index + 1}`,
            title,
            category,
            enabled: category === "normal" || category === "style",
            content,
        };
    });
}

async function main() {
    const response = await fetch(`${cfg.backendBaseUrl}/api/v2/qq-bridge/context`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-dengta-qq-token": cfg.token },
        body: JSON.stringify({ qq: cfg.bindingKey }),
        signal: AbortSignal.timeout(60000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
        throw new Error(`context failed: HTTP ${response.status} ${payload.code || ""} ${payload.message || ""}`.trim());
    }
    const persona = payload.persona || {};
    const prompt = persona.unified_system_prompt || [
        persona.system_prompt, persona.additional_prompt, persona.personality
    ].filter(Boolean).join("\n\n");
    const sections = splitSections(prompt);
    const memories = (payload.memories || []).map((item, index) => ({
        id: `memory-${index + 1}`,
        summary: String(item.summary || "").slice(0, 500),
        updated_at: item.updated_at || null,
        // 默认不同步任何记忆，等主人显式勾选。
        enabled: false,
    }));
    const selection = {
        version: 1,
        channel: "wechat",
        ai_name: persona.ai_name || payload.companion?.name || "",
        style_enabled: true,
        style_text: "",
        sections,
        memories,
        updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(SELECTION_PATH, JSON.stringify(selection, null, 2));
    const counts = sections.reduce((acc, section) => {
        acc[section.category] = (acc[section.category] || 0) + 1;
        return acc;
    }, {});
    console.log(JSON.stringify({
        ok: true,
        path: SELECTION_PATH,
        sections: sections.length,
        categories: counts,
        enabled_sections: sections.filter((section) => section.enabled).length,
        memories: memories.length,
        enabled_memories: 0,
        note: "私密/NSFW 小节与全部记忆默认关闭；编辑 selection.json 的 enabled 字段后再同步。",
    }, null, 2));
}

main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error.message || error) }));
    process.exit(1);
});
