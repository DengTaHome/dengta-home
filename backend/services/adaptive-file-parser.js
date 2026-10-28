"use strict";

// 自适应聊天记录/文档解析：按扩展名 + 内容魔数 + 内容特征自动识别格式，
// 把用户导出的各类聊天记录文件规范化成可提纯的纯文本。
// 目前覆盖：微信/QQ 导出的 TXT、WhatsApp、Telegram JSON、Discord JSON、
// DSH 会话（jsonl / jsonl.zstd）、MHT/MHTML、XLSX 聊天表，以及通用文档格式。
// 加密的微信数据库不做解密；只处理用户已经导出的文件。

const zlib = require("node:zlib");

const TEXT_EXTENSIONS = new Set([
    "md", "markdown", "txt", "text", "json", "jsonl", "ndjson",
    "html", "htm", "mht", "mhtml", "csv", "log", "srt", "vtt", "xml",
    "yaml", "yml", "ini", "conf", "tsv", "eml", "zst", "zstd"
]);

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

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
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf";
    if (head.subarray(0, 4).equals(ZSTD_MAGIC)) return "zstd";
    if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) return "zip";
    const textHead = buffer.subarray(0, 128).toString("utf8").replace(/^\uFEFF/, "").trimStart();
    if (textHead.startsWith("{") || textHead.startsWith("[")) return "json";
    if (/^<!doctype html|^<html/i.test(textHead)) return "html";
    if (/^MIME-Version:|^Content-Type:\s*multipart/i.test(textHead)) return "mht";
    return "text";
}

function stripHtml(html) {
    let source = String(html || "").slice(0, 2 * 1024 * 1024);
    const lower = source.toLowerCase();
    for (const tag of ["script", "style"]) {
        let index = 0;
        for (;;) {
            const open = source.toLowerCase().indexOf(`<${tag}`, index);
            if (open < 0) break;
            const close = source.toLowerCase().indexOf(`</${tag}>`, open);
            if (close < 0) {
                source = source.slice(0, open);
                break;
            }
            source = source.slice(0, open) + " " + source.slice(close + tag.length + 3);
            index = open;
        }
    }
    return source
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

// ---------------------------------------------------------------------------
// MHT / MHTML（QQ、Outlook、部分网页导出常用）
// ---------------------------------------------------------------------------

function decodeQuotedPrintable(value) {
    const source = String(value || "").replace(/=\r?\n/g, "");
    const bytes = [];
    for (let i = 0; i < source.length; i += 1) {
        if (source[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(source.slice(i + 1, i + 3))) {
            bytes.push(parseInt(source.slice(i + 1, i + 3), 16));
            i += 2;
        } else {
            bytes.push(source.charCodeAt(i) & 0xff);
        }
    }
    // 返回原始字节的 latin1 视图，交给 decodeMimeBody 按 charset 解码一次
    return Buffer.from(bytes).toString("latin1");
}

function decodeMimeBody(headers, bodyBuffer) {
    const encoding = (headers.match(/content-transfer-encoding:\s*([^\r\n]+)/i) || [])[1]?.trim().toLowerCase();
    const charset = (headers.match(/charset="?([^";\r\n]+)"?/i) || [])[1]?.trim().toLowerCase() || "utf-8";
    let bytes;
    if (encoding === "base64") {
        bytes = Buffer.from(bodyBuffer.toString("latin1").replace(/\s+/g, ""), "base64");
    } else if (encoding === "quoted-printable") {
        bytes = Buffer.from(decodeQuotedPrintable(bodyBuffer.toString("latin1")), "latin1");
    } else {
        bytes = bodyBuffer;
    }
    for (const candidate of [charset, "utf-8", "gb18030"]) {
        try {
            return new TextDecoder(candidate, { fatal: true }).decode(bytes);
        } catch {
            /* try the next charset */
        }
    }
    return bytes.toString("utf8");
}

/**
 * 解析 MHTML（multipart/related 等）：优先 text/html，其次 text/plain。
 * 从原始字节切分，charset 只解码一次（GBK/GB2312 导出不再乱码）。
 */
function parseMht(buffer) {
    const bytes = Buffer.from(buffer);
    const head = bytes.subarray(0, 4096).toString("latin1");
    const boundary = (head.match(/boundary="?([^";\r\n]+)"?/i) || [])[1];
    if (!boundary) return stripHtml(bytes.toString("utf8"));
    const marker = Buffer.from(`--${boundary}`, "latin1");
    const parts = [];
    let start = bytes.indexOf(marker);
    while (start >= 0) {
        const next = bytes.indexOf(marker, start + marker.length);
        const end = next >= 0 ? next : bytes.length;
        parts.push(bytes.subarray(start + marker.length, end));
        start = next;
    }
    const htmlParts = [];
    const textParts = [];
    for (const part of parts) {
        const separator = part.indexOf(Buffer.from("\r\n\r\n"));
        if (separator < 0) continue;
        const headers = part.subarray(0, separator).toString("latin1");
        const body = part.subarray(separator + 4);
        if (/content-type:\s*text\/html/i.test(headers)) htmlParts.push(decodeMimeBody(headers, body));
        else if (/content-type:\s*text\/plain/i.test(headers)) textParts.push(decodeMimeBody(headers, body));
    }
    const text = htmlParts.map(stripHtml).join("\n\n") || textParts.join("\n\n");
    return text.trim();
}

// ---------------------------------------------------------------------------
// 聊天格式专用解析
// ---------------------------------------------------------------------------

function contentText(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n");
    if (value && typeof value === "object") {
        if (typeof value.text === "string" && value.type === "text") return value.text;
        return contentText(value.parts ?? value.text ?? value.content ?? value.message ?? "");
    }
    return "";
}

function normalizeTimestamp(value) {
    if (value == null) return "";
    if (typeof value === "number") {
        const ms = value < 1e12 ? value * 1000 : value;
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16).replace("T", " ");
    }
    const text = String(value).trim();
    if (/^\d{10,13}$/.test(text)) return normalizeTimestamp(Number(text));
    const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[T\s](\d{1,2}):(\d{2})/);
    if (iso) {
        return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")} ${iso[4].padStart(2, "0")}:${iso[5]}`;
    }
    return "";
}

function senderOfRow(row) {
    const value =
        row.sender ?? row.from ?? row.user ?? row.name ?? row.username ??
        row.sender_name ?? row.nickname ?? row.author?.username ?? row.author?.name ??
        row.from_user ?? row.role ?? row.author?.role ?? "";
    if (typeof value === "object") return String(value.name || value.username || value.title || "").trim();
    return String(value || "").trim();
}

function rowTextOf(row) {
    return contentText(row.content ?? row.text ?? row.message ?? row.body ?? row.msg ?? row.message_text ?? "").trim();
}

function jsonRows(data) {
    if (Array.isArray(data)) return data.flatMap(row => jsonRows(row));
    if (!data || typeof data !== "object") return [];
    if (data.mapping) return Object.values(data.mapping).flatMap(node => jsonRows(node.message));
    const collection =
        data.messages ?? data.conversations ?? data.chats ?? data.items ??
        data.dialog ?? data.message_list ?? null;
    return collection ? jsonRows(collection) : [data];
}

function parseJsonMessages(text) {
    let data = null;
    try { data = JSON.parse(text); } catch { return null; }
    const rows = jsonRows(data);
    const lines = [];
    for (const row of rows) {
        const sender = senderOfRow(row);
        const content = rowTextOf(row);
        if (!content) continue;
        const time = normalizeTimestamp(row.time ?? row.date ?? row.timestamp ?? row.created_at ?? row.send_time);
        lines.push((time ? `[${time}] ` : "") + (sender ? sender + ": " : "") + content);
    }
    return lines.join("\n");
}

/** DSH 会话事件（jsonl / jsonl.zstd 解压后）：user/message / assistant/message。 */
function parseDshJsonl(text) {
    const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim());
    const messages = [];
    for (const line of lines) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (!event || typeof event !== "object") continue;
        const type = String(event.type || "");
        if (!/message$/.test(type) && type !== "message") continue;
        const payload = event.data || event.payload || event;
        const message = payload.message || payload;
        const role = String(message.role || payload.role || "");
        if (!["user", "assistant"].includes(role)) continue; // 系统提示词不导入
        const rawContent = message.content ?? message.text ?? "";
        let textValue;
        if (Array.isArray(rawContent)) {
            textValue = rawContent
                .filter((part) => part && typeof part === "object" && part.type === "text")
                .map((part) => String(part.text || ""))
                .join("\n");
        } else {
            textValue = contentText(rawContent);
        }
        if (!textValue.trim()) continue;
        messages.push(`${role === "user" ? "用户" : "助手"}: ${textValue.trim()}`);
    }
    return messages.length >= 2 ? messages.join("\n") : null;
}

/**
 * 微信/QQ/WhatsApp 导出的纯文本：常见「时间戳行 + 内容」结构。
 * 返回规范化 `发送者: 内容`；识别不出结构、或首行不是聊天头时返回 null，
 * 避免把会议纪要/日志误判成聊天并丢掉前置正文。
 */
function parseMessengerText(text) {
    const lines = String(text || "").split(/\r?\n/);
    const out = [];
    let current = null;
    let headerCount = 0;
    const whatsapp = /^\[(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*([^:]{1,60}):\s*(.*)$/;
    const whatsappDash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*([^:]{1,60}):\s*(.*)$/;
    const qqHeader = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([^:：]{1,40}?)(?:\s*[（(](\d{4,})[)）])?\s*$/;
    const qqInline = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([^:：]{1,40}?)\s*[:：]\s*(.*)$/;
    const wechatHeader = /^(.{1,40}?)\s{2,}(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/;
    const flush = () => {
        if (current && current.content.trim()) out.push(`${current.sender}: ${current.content.trim()}`);
        current = null;
    };
    let firstNonEmpty = null;
    for (const raw of lines) {
        const line = String(raw || "").replace(/\uFEFF/g, "").trimEnd();
        if (!line.trim()) { flush(); continue; }
        if (firstNonEmpty === null) firstNonEmpty = line;
        let match = line.match(whatsapp) || line.match(whatsappDash);
        if (match) {
            headerCount += 1;
            flush();
            current = { sender: match[7].trim(), content: match[8] || "" };
            continue;
        }
        match = line.match(qqInline);
        if (match) {
            headerCount += 1;
            flush();
            current = { sender: match[7].trim(), content: match[8] || "" };
            continue;
        }
        match = line.match(qqHeader);
        if (match) {
            headerCount += 1;
            flush();
            const sender = match[7].trim();
            if (/^\d+$/.test(sender)) { current = null; continue; }
            current = { sender, content: "" };
            continue;
        }
        match = line.match(wechatHeader);
        if (match) {
            headerCount += 1;
            flush();
            current = { sender: match[1].trim(), content: "" };
            continue;
        }
        if (current) current.content += (current.content ? "\n" : "") + line.trim();
    }
    flush();
    if (headerCount < 2 || out.length < 2) return null;
    // 首行不是聊天头 → 认为前置正文，交回普通文本处理（不丢行）
    const firstIsHeader =
        whatsapp.test(firstNonEmpty || "") || whatsappDash.test(firstNonEmpty || "") ||
        qqHeader.test(firstNonEmpty || "") || qqInline.test(firstNonEmpty || "") ||
        wechatHeader.test(firstNonEmpty || "");
    return firstIsHeader ? out.join("\n") : null;
}

// ---------------------------------------------------------------------------
// XLSX（很多平台导出聊天记录为表格）
// ---------------------------------------------------------------------------

function decodeXmlEntities(value) {
    return String(value || "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

function xmlTextOf(fragment) {
    return decodeXmlEntities(
        (String(fragment || "").match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [])
            .map((item) => item.replace(/<[^>]+>/g, ""))
            .join("")
    );
}

function columnIndexOf(ref) {
    const letters = String(ref || "").replace(/[^A-Z]/g, "").slice(-3);
    let index = 0;
    for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
    return Math.max(0, Math.min(255, index - 1));
}

async function parseXlsx(buffer) {
    if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
        throw requestError(413, "import_xlsx_too_large", "XLSX 文件请控制在 8MB 以内，避免解压占用过多内存。");
    }
    const JSZip = require("jszip");
    let zip;
    try {
        zip = await JSZip.loadAsync(Buffer.from(buffer));
    } catch {
        throw requestError(400, "import_xlsx_invalid", "XLSX 文件结构无效或已损坏，请重新导出。");
    }
    // zip 炸弹防护：先看 central directory 的声明大小（不实际解压）
    let declaredBytes = 0;
    for (const entry of Object.values(zip.files)) {
        const size = Number(entry?._data?.uncompressedSize);
        if (Number.isFinite(size) && size > 0) declaredBytes += size;
    }
    if (declaredBytes > 64 * 1024 * 1024) {
        throw requestError(413, "import_xlsx_too_large", "XLSX 解压后体积过大，请缩小表格后再导入。");
    }
    let sharedXml = zip.file("xl/sharedStrings.xml")
        ? await zip.file("xl/sharedStrings.xml").async("string")
        : "";
    if (sharedXml.length > 32 * 1024 * 1024) {
        throw requestError(413, "import_xlsx_too_large", "XLSX 共享字符串体积过大，请缩小表格后再导入。");
    }
    const shared = [];
    for (const si of sharedXml.match(/<si>[\s\S]*?<\/si>/g) || []) {
        shared.push(xmlTextOf(si));
    }
    const sheetNames = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
    if (!sheetNames.length) {
        throw requestError(400, "import_xlsx_empty", "XLSX 里没有可读取的工作表。");
    }
    const sheetXml = await zip.file(sheetNames[0]).async("string");
    if (sheetXml.length > 32 * 1024 * 1024) {
        throw requestError(413, "import_xlsx_too_large", "XLSX 工作表体积过大，请缩小表格后再导入。");
    }
    const rows = [];
    let cursor = 0;
    while (rows.length < 20000) {
        const rowStart = sheetXml.indexOf("<row", cursor);
        if (rowStart < 0) break;
        const rowEnd = sheetXml.indexOf("</row>", rowStart);
        if (rowEnd < 0) break;
        const rowXml = sheetXml.slice(rowStart, rowEnd);
        const cells = [];
        let cellCursor = 0;
        while (cells.length < 64) {
            const cellStart = rowXml.indexOf("<c", cellCursor);
            if (cellStart < 0) break;
            const tagEnd = rowXml.indexOf(">", cellStart);
            if (tagEnd < 0) break;
            const attributes = rowXml.slice(cellStart, tagEnd);
            const selfClosing = rowXml[tagEnd - 1] === "/";
            const cellEnd = selfClosing ? tagEnd + 1 : rowXml.indexOf("</c>", tagEnd);
            if (cellEnd < 0) break;
            const cellXml = rowXml.slice(cellStart, selfClosing ? tagEnd + 1 : cellEnd + 4);
            const ref = (attributes.match(/r="([A-Z]+\d+)"/) || [])[1];
            const type = (attributes.match(/t="([^"]+)"/) || [])[1];
            const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
            let value = valueMatch ? decodeXmlEntities(valueMatch[1]) : "";
            if (type === "s") value = shared[Number(value)] || "";
            else if (type === "inlineStr") value = xmlTextOf(cellXml);
            cells[columnIndexOf(ref)] = value;
            cellCursor = cellEnd + (selfClosing ? 0 : 4);
        }
        if (cells.some((value) => String(value || "").trim())) rows.push(cells);
        cursor = rowEnd + 6;
    }
    if (!rows.length) return null;

    const header = rows[0].map((value) => String(value || "").toLowerCase());
    const find = (patterns) => header.findIndex((value) => patterns.some((pattern) => value.includes(pattern)));
    const senderIndex = find(["sender", "发送者", "发送人", "昵称", "用户名", "from", "author", "成员"]);
    const contentIndex = find(["content", "内容", "消息", "text", "message", "正文"]);
    const timeIndex = find(["time", "时间", "date", "日期"]);
    // 只有「内容列 + (发送者列或时间列)」才可能是聊天记录；避免联系人表被误判
    if (contentIndex < 0 || (senderIndex < 0 && timeIndex < 0)) return null;
    const lines = [];
    for (const row of rows.slice(1)) {
        const sender = String((senderIndex >= 0 ? row[senderIndex] : "") || "").trim();
        const content = String((contentIndex >= 0 ? row[contentIndex] : "") || "").trim();
        if (!content || /^(时间|发送者|内容)$/.test(content)) continue;
        const time = timeIndex >= 0 ? normalizeTimestamp(row[timeIndex]) : "";
        lines.push((time ? `[${time}] ` : "") + (sender ? `${sender}: ` : "") + content);
    }
    return lines.length >= 2 ? lines.join("\n") : null;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

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

function decompressZstd(bytes, filename) {
    if (typeof zlib.zstdDecompressSync !== "function") {
        throw requestError(415, "import_zstd_unsupported", "当前 Node 运行时不支持 zstd 解压，请先解压后再导入。");
    }
    try {
        return zlib.zstdDecompressSync(Buffer.from(bytes), {
            maxOutputLength: 128 * 1024 * 1024
        });
    } catch {
        throw requestError(400, "import_zstd_invalid", `无法解压 ${filename || "zstd 文件"}，请确认文件完整。`);
    }
}

async function extractText(filename, buffer) {
    const ext = extOf(filename);
    const magic = sniffMagic(buffer);
    let bytes = Buffer.from(buffer);

    // zstd（DSH 会话是 session.v4.jsonl.zstd）
    if (magic === "zstd" || ext === "zst" || ext === "zstd") {
        bytes = decompressZstd(bytes, filename);
        const innerName = String(filename || "").replace(/\.(?:zst|zstd)$/i, "") || "session.jsonl";
        return extractText(innerName, bytes);
    }

    // 邮件必须在 MHT 之前处理：.eml 也以 MIME-Version/multipart 开头
    if (ext === "eml") return { format: ext, text: (await parseEml(bytes)).trim(), size: bytes.length };

    // MHT / MHTML：魔数/内容特征优先，其次扩展名
    const textHead = bytes.subarray(0, 256).toString("utf8").replace(/^\uFEFF/, "").trimStart();
    if (ext === "mht" || ext === "mhtml" || magic === "mht" ||
        /^MIME-Version:|^Content-Type:\s*multipart/i.test(textHead)) {
        const text = parseMht(bytes);
        return { format: "mht", text: text.trim(), size: bytes.length };
    }

    // XLSX（zip 魔数 + 扩展名）
    if ((magic === "zip" || ext === "xlsx" || ext === "xls") && (ext === "xlsx" || ext === "xls")) {
        const text = await parseXlsx(bytes);
        if (text) return { format: "xlsx", text: text.trim(), size: bytes.length };
        throw requestError(400, "import_xlsx_empty", "XLSX 里没有识别到聊天记录内容，请检查列名或另存为 CSV。");
    }

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

    // 其余按文本处理
    const text = decodeText(bytes);
    let normalized = "";
    let format = ext && TEXT_EXTENSIONS.has(ext) ? ext : magic;

    const isJsonLike = format === "json" || ext === "json" || ext === "jsonl" || ext === "ndjson";
    if (isJsonLike) {
        const dsh = parseDshJsonl(text);
        if (dsh) {
            normalized = dsh;
            format = "dsh-jsonl";
        } else if (ext === "jsonl" || ext === "ndjson") {
            normalized = text.split(/\r?\n/).filter(line => line.trim()).map(line => {
                const result = parseJsonMessages(line);
                if (result === null) throw requestError(400, "import_json_invalid", "JSONL 有一行不是有效的 JSON，请检查文件是否完整。");
                return result || line;
            }).join("\n");
        } else {
            normalized = parseJsonMessages(text) || text;
        }
    } else if (format === "html" || ext === "html" || ext === "htm") {
        normalized = stripHtml(text);
    } else if (ext === "csv" || ext === "tsv") {
        normalized = parseCsv(text, ext === "tsv" ? "\t" : ",");
    } else if (ext === "srt" || ext === "vtt") {
        normalized = parseSrt(text);
    } else {
        const trimmed = text.trimStart();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            const parsedJson = parseJsonMessages(text) || parseDshJsonl(text);
            if (parsedJson) normalized = parsedJson;
        }
        if (!normalized) {
            const messenger = parseMessengerText(text);
            normalized = messenger || text;
            if (messenger) format = "chat-text";
        }
    }

    return { format, text: normalized.trim(), size: bytes.length };
}

module.exports = {
    createAdaptiveFileParser: () => ({ extractText }),
    extractText,
    sniffMagic,
    stripHtml,
    decodeText,
    parseMht,
    parseMessengerText,
    parseDshJsonl,
    parseXlsx,
    decodeQuotedPrintable
};
