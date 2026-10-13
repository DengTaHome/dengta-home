"use strict";

// 自适应聊天记录/文档解析：按扩展名 + 内容魔数自动识别格式，
// 把用户导出的各类聊天记录文件规范化成可提纯的纯文本。
// 参考 dot-skill(colleague-skill) 的多源输入思路,面向风格提纯场景落地。

const TEXT_EXTENSIONS = new Set([
    "md", "markdown", "txt", "text", "json", "jsonl", "ndjson",
    "html", "htm", "csv", "log", "srt", "vtt", "xml", "yaml", "yml",
    "ini", "conf", "tsv", "eml"
]);

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function extOf(filename) {
    return String(filename || "").split(".").pop().toLowerCase();
}

function sniffMagic(buffer) {
    if (!buffer || buffer.length < 4) return "";
    const head = buffer.subarray(0, 8);
    // PDF: %PDF-
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf";
    // DOCX/ZIP: PK\x03\x04
    if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) return "zip";
    // JSON: starts with { or [ (after optional BOM/whitespace)
    const textHead = buffer.subarray(0, 64).toString("utf8").replace(/^\uFEFF/, "").trimStart();
    if (textHead.startsWith("{") || textHead.startsWith("[")) return "json";
    // HTML
    if (/^<!doctype html|^<html/i.test(textHead)) return "html";
    return "text";
}

function stripHtml(html) {
    const source = String(html || "");
    const withoutScripts = source.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
    return withoutScripts
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|pre)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function parseCsv(text, delimiter = ",") {
    const rows = []; let row = [], current = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (quoted && text[i + 1] === '"') { current += '"'; i++; }
            else quoted = !quoted;
        } else if (!quoted && ch === delimiter) { row.push(current); current = ""; }
        else if (!quoted && (ch === "\n" || ch === "\r")) {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            row.push(current); rows.push(row); row = []; current = "";
        } else current += ch;
    }
    if (quoted) throw requestError(400, "import_csv_invalid", "CSV 的引号未闭合，请检查文件是否完整。");
    if (current || row.length) { row.push(current); rows.push(row); }
    return rows.filter(row => row.some(Boolean)).map(row => row.join(" | ")).join("\n");
}

function parseSrt(text) {
    const blocks = String(text || "").split(/\r?\n\r?\n/).map((block) => {
        const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        // 去掉序号行与时间轴行
        const content = lines.filter((line) => !/^\d+$/.test(line) && !/-->/.test(line) && !/^WEBVTT(?:\s|$)/.test(line));
        return content.join(" ");
    }).filter(Boolean);
    return blocks.join("\n");
}

async function parseEml(bytes) {
    const { MailParser } = require("mailparser");
    const parser = new MailParser({ skipTextToHtml: true, maxHtmlLengthToParse: 20 * 1024 * 1024 });
    const parts = [];
    return new Promise((resolve, reject) => {
        parser.on("error", reject);
        parser.on("headers", headers => { if (headers.get("subject")) parts.push(String(headers.get("subject"))); });
        parser.on("data", part => {
            if (part.type === "attachment") { part.content.on("error", reject); part.content.on("end", () => part.release()); part.content.resume(); }
            else if (part.type === "text") parts.push(part.text || stripHtml(part.html));
        });
        parser.on("end", () => resolve(parts.join("\n\n")));
        parser.end(bytes);
    });
}

function contentText(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n");
    if (value && typeof value === "object") return contentText(value.parts ?? value.text ?? value.content ?? "");
    return "";
}

function jsonRows(data) {
    if (Array.isArray(data)) return data.flatMap(row => jsonRows(row));
    if (!data || typeof data !== "object") return [];
    if (data.mapping) return Object.values(data.mapping).flatMap(node => jsonRows(node.message));
    const collection = data.messages ?? data.conversations ?? data.chats ?? data.items;
    return collection ? jsonRows(collection) : [data];
}

function parseJsonMessages(text) {
    let data = null;
    try { data = JSON.parse(text); } catch { return null; }
    const rows = jsonRows(data);
    const lines = [];
    for (const row of rows) {
        const sender = String(row.sender || row.from || row.user || row.name || row.author?.role || row.role || "").trim();
        const content = contentText(row.content ?? row.text ?? row.message ?? row.body ?? row.msg).trim();
        if (!content) continue;
        lines.push((sender ? sender + ": " : "") + content);
    }
    return lines.join("\n");
}

function decodeText(bytes) {
    let encodings = ["utf-8", "gb18030"];
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encodings = ["utf-16le"];
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encodings = ["utf-16be"];
    else if (bytes.includes(0)) throw requestError(415, "import_file_type_unsupported", "二进制文件不能作为文本读取，请选择受支持的文档格式。");
    for (const encoding of encodings) {
        try { return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); } catch { /* try the next encoding */ }
    }
    throw requestError(400, "import_invalid_encoding", "无法识别文本编码，请另存为 UTF-8 后重试。");
}

async function extractText(filename, buffer) {
    const ext = extOf(filename);
    const magic = sniffMagic(buffer);
    const bytes = Buffer.from(buffer);

    // PDF（魔数优先）——pdf-parse v2 API
    if (magic === "pdf" || ext === "pdf") {
        const { PDFParse } = require("pdf-parse");
        const parser = new PDFParse({ data: bytes });
        try {
            const parsed = await parser.getText();
            const text = String(parsed?.text || "").replace(/\n-- \d+ of \d+ --\n?$/g, "").trim();
            if (!text) throw requestError(400, "import_pdf_no_text", "PDF 没有可提取的文字，扫描版请先进行 OCR。");
            return { format: "pdf", text, size: bytes.length };
        } catch (error) {
            if (error.code) throw error;
            const encrypted = /password|encrypted/i.test(String(error.name));
            throw requestError(400, encrypted ? "import_pdf_password_required" : "import_pdf_invalid", encrypted ? "PDF 已加密，请先解密后重新导入。" : "PDF 结构无效或文件不完整，请重新导出后导入。");
        } finally { await parser.destroy(); }
    }

    // DOCX（zip 魔数 + 扩展名）
    if (magic === "zip" && (ext === "docx" || ext === "doc")) {
        require("./chat-attachments").validateDocxArchive(bytes);
        const mammoth = require("mammoth");
        const parsed = await mammoth.extractRawText({ buffer: bytes });
        return { format: "docx", text: String(parsed?.value || "").trim(), size: bytes.length };
    }

    if (magic === "zip" || ext === "doc" || ["zip", "xlsx", "xls", "ppt", "pptx", "docx"].includes(ext)) {
        throw requestError(415, "import_file_type_unsupported", "此入口暂不支持该二进制格式；旧版 DOC 请另存为 DOCX，表格或压缩包请先导出文本。");
    }

    if (ext === "eml") return { format: ext, text: (await parseEml(bytes)).trim(), size: bytes.length };

    // 其余按文本处理
    const text = decodeText(bytes);
    let normalized = "";
    let format = ext && TEXT_EXTENSIONS.has(ext) ? ext : magic;

    if (format === "json" || ext === "json" || ext === "jsonl" || ext === "ndjson") {
        const parsed = ext === "jsonl" || ext === "ndjson"
            ? text.split(/\r?\n/).filter(line => line.trim()).map(line => {
                const result = parseJsonMessages(line);
                if (result === null) throw requestError(400, "import_json_invalid", "JSONL 有一行不是有效的 JSON，请检查文件是否完整。");
                return result || line;
            }).join("\n") : parseJsonMessages(text);
        if (parsed) {
            normalized = parsed;
        } else {
            // 非对话 JSON:输出可读结构
            normalized = text;
        }
    } else if (format === "html" || ext === "html" || ext === "htm") {
        normalized = stripHtml(text);
    } else if (ext === "csv" || ext === "tsv") {
        normalized = parseCsv(text, ext === "tsv" ? "\t" : ",");
    } else if (ext === "srt" || ext === "vtt") {
        normalized = parseSrt(text);
    } else {
        normalized = text;
    }

    return { format, text: normalized.trim(), size: bytes.length };
}

module.exports = { createAdaptiveFileParser: () => ({ extractText }), extractText, sniffMagic, stripHtml, decodeText };
