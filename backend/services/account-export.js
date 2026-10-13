"use strict";

// 全量导出服务：把账号下所有用户内容按模块整理成一份总记录，
// 支持 json / md / txt / html 四种格式（与导入功能可互通的扩展名）。

const EXPORT_FORMATS = new Set(["json", "md", "txt", "html"]);

const SENSITIVE_COLUMN = /(cookie|ciphertext|secret|token|password|apikey|api_key|access_key|refresh_key|credential)/i;
const KEEP_CONNECTION_COLUMNS = /(account|nickname|display_name|name|face|avatar|uid|user_id|connected|status|provider|type|created_at|updated_at|expires|url|email|media_id|bvid|title|cover)/i;

// 模块定义：key / 标题 / 表格清单。
const MODULES = [
    {
        key: "account_settings",
        title: "账号与设置",
        tables: [
            { table: "user_profiles", filter: "id" },
            { table: "settings", filter: "user" },
            { table: "private_media_preferences", filter: "user" }
        ]
    },
    {
        key: "companions",
        title: "伴侣与人设",
        tables: [
            { table: "companions", filter: "user" },
            { table: "companion_profile_versions", filter: "user" },
            { table: "companion_chat_preferences", filter: "user" },
            { table: "companion_creative_settings", filter: "user" },
            { table: "companion_slot_codes", filter: "user" }
        ]
    },
    {
        key: "conversations",
        title: "会话与聊天记录",
        tables: [
            { table: "conversations", filter: "user" },
            { table: "messages", filter: "user" }
        ]
    },
    {
        key: "memories",
        title: "记忆",
        tables: [
            { table: "memories", filter: "user" },
            { table: "stable_memory_candidates", filter: "user" },
            { table: "memory_calendar", filter: "user" },
            { table: "conversation_composer_hints", filter: "user" }
        ]
    },
    {
        key: "moments",
        title: "时刻与互动",
        tables: [
            { table: "moments", filter: "user" },
            { table: "moment_comments", filter: "user" },
            { table: "companion_runtime_states", filter: "user" }
        ]
    },
    {
        key: "diary",
        title: "日记",
        tables: [{ table: "companion_diary_entries", filter: "user" }]
    },
    {
        key: "creative",
        title: "绘画与创作",
        tables: [
            { table: "companion_artworks", filter: "user" },
            { table: "companion_creative_inspirations", filter: "user" },
            { table: "image_generation_calls", filter: "user" },
            { table: "media_assets", filter: "user" },
            { table: "account_media_assets", filter: "user" }
        ]
    },
    {
        key: "video",
        title: "视频与一起看",
        tables: [
            { table: "co_watch_sessions", filter: "user" },
            { table: "co_watch_receiver_grants", filter: "user" },
            { table: "watch_events", filter: "user" },
            { table: "interest_profiles", filter: "user" },
            { table: "content_imports", filter: "user" },
            { table: "content_import_candidates", filter: "user" },
            { table: "world_book_entries", filter: "user" }
        ]
    },
    {
        key: "music",
        title: "音乐记忆",
        tables: [
            { table: "music_playlists", filter: "user" },
            { table: "music_playlist_items", filter: "user" },
            { table: "music_favorites", filter: "user" },
            { table: "music_understandings", filter: "user" },
            { table: "music_playback_queues", filter: "user" },
            { table: "music_playback_queue_items", filter: "user" },
            { table: "ai_music_play_requests", filter: "user" }
        ]
    },
    {
        key: "nursery",
        title: "育儿屋",
        tables: [
            { table: "nursery_children", filter: "user" },
            { table: "nursery_child_state", filter: "user" },
            { table: "nursery_actions", filter: "user" },
            { table: "nursery_utterances", filter: "user" },
            { table: "nursery_events", filter: "user" },
            { table: "nursery_milestones", filter: "user" },
            { table: "nursery_caregiver_bonds", filter: "user" }
        ]
    },
    {
        key: "fun",
        title: "成就与玩法",
        tables: [
            { table: "user_achievements", filter: "user" },
            { table: "daily_shots", filter: "user" },
            { table: "special_dates", filter: "user" },
            { table: "compatibility_records", filter: "user" },
            { table: "takeout_commands", filter: "user" }
        ]
    }
];

// 连接类表：只导出账号信息（脱敏），不导出任何凭据。
const CONNECTION_TABLES = [
    { table: "netease_cookie_sessions", filter: "user" },
    { table: "netease_qr_connections", filter: "user" },
    { table: "bilibili_qr_connections", filter: "user" },
    { table: "xhs_connections", filter: "user" },
    { table: "mcp_connections", filter: "user" }
];

function cleanText(value, maximum = 2000) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, maximum).join("");
}

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function createAccountExportService({ database, supabaseUrl = "", supabaseKey = "" } = {}) {
    if (!database?.from) throw new TypeError("account export requires a Supabase database client");

    const columnCache = new Map();
    let schemaByTable = null;
    let schemaFetchedAt = 0;
    const COLUMN_CACHE_TTL_MS = 10 * 60 * 1000;

    // 通过 PostgREST OpenAPI 文档一次性拿全部表的列（information_schema 不可经 REST 查询）。
    async function loadSchema() {
        if (schemaByTable && Date.now() - schemaFetchedAt < COLUMN_CACHE_TTL_MS) {
            return schemaByTable;
        }
        const url = supabaseUrl || database?.restUrl || "";
        const key = supabaseKey || database?.__key || "";
        let schema = null;
        if (url) {
            try {
                const response = await fetch(url.replace(/\/$/, "") + "/", {
                    headers: {
                        apikey: key,
                        Authorization: "Bearer " + key,
                        Accept: "application/openapi+json"
                    },
                    signal: AbortSignal.timeout(15000)
                });
                if (response.ok) {
                    const openapi = await response.json();
                    const schemas = openapi?.components?.schemas || {};
                    const result = {};
                    for (const [name, definition] of Object.entries(schemas)) {
                        const properties = definition?.properties || {};
                        result[name] = Object.keys(properties);
                    }
                    schema = result;
                }
            } catch {
                schema = null;
            }
        }
        if (!schema) {
            // 兜底：逐表查询一行，从返回行推断列。
            schema = {};
            for (const spec of [...MODULES.flatMap((m) => m.tables), ...CONNECTION_TABLES]) {
                const table = spec.table;
                try {
                    const { data } = await database.from(table).select("*").limit(1);
                    if (Array.isArray(data) && data[0]) {
                        schema[table] = Object.keys(data[0]);
                    } else {
                        schema[table] = [];
                    }
                } catch {
                    schema[table] = [];
                }
            }
        }
        schemaByTable = schema;
        schemaFetchedAt = Date.now();
        return schema;
    }

    async function columnsOf(table) {
        const schema = await loadSchema();
        if (Object.prototype.hasOwnProperty.call(schema, table)) return schema[table] || [];
        // 未知表：查一行推断。
        try {
            const { data } = await database.from(table).select("*").limit(1);
            if (Array.isArray(data) && data[0]) {
                const cols = Object.keys(data[0]);
                schema[table] = cols;
                return cols;
            }
        } catch {
            // ignore
        }
        schema[table] = [];
        return [];
    }

    // 按作用域拉取一张表的全部用户行。
    async function fetchRows(table, filter, scope) {
        let builder = database.from(table).select("*");
        const cols = await columnsOf(table);
        if (cols.includes("user_id")) {
            builder = builder.eq("user_id", scope.userId);
        } else if (cols.includes("id") && filter === "id") {
            builder = builder.eq("id", scope.userId);
        }
        if (cols.includes("companion_id")) {
            builder = builder.eq("companion_id", scope.companionId);
        }
        const { data, error } = await builder.order("created_at", { ascending: true });
        if (error) {
            if (String(error?.message || "").includes("does not exist") || error?.code === "42P01") {
                return [];
            }
            throw error;
        }
        return Array.isArray(data) ? data : [];
    }

    // 连接类表脱敏：只留账号信息列。
    function sanitizeRow(row) {
        if (!row || typeof row !== "object") return row;
        const out = {};
        for (const [key, value] of Object.entries(row)) {
            if (SENSITIVE_COLUMN.test(key)) continue;
            if (!KEEP_CONNECTION_COLUMNS.test(key)) continue;
            out[key] = value;
        }
        return out;
    }

    function isRowEmpty(row) {
        if (!row || typeof row !== "object") return true;
        return Object.keys(row).filter((k) => !["id", "user_id", "companion_id", "created_at", "updated_at"].includes(k)).length === 0;
    }

    async function collect(scope) {
        const modules = {};
        for (const module of MODULES) {
            const rows = {};
            for (const spec of module.tables) {
                try {
                    const list = await fetchRows(spec.table, spec.filter, scope);
                    rows[spec.table] = list;
                } catch (error) {
                    rows[spec.table] = [];
                    rows[spec.table + "__error"] = String(error?.message || "读取失败").slice(0, 200);
                }
            }
            modules[module.key] = { title: module.title, rows };
        }
        const connections = {};
        for (const spec of CONNECTION_TABLES) {
            try {
                const list = await fetchRows(spec.table, spec.filter, scope);
                connections[spec.table] = list.map(sanitizeRow).filter((row) => !isRowEmpty(row));
            } catch {
                connections[spec.table] = [];
            }
        }
        return { modules, connections };
    }

    function roleLabel(role) {
        if (role === "user") return "用户";
        if (role === "assistant") return "AI";
        if (role === "system") return "系统";
        return String(role || "未知");
    }

    function messageText(message) {
        const parts = [];
        if (message?.content) parts.push(String(message.content));
        const calls = message?.tool_calls;
        if (calls && typeof calls === "object") {
            const names = Object.keys(calls).filter((k) => !["resolved_model", "response_mode", "processing_stages"].includes(k));
            if (names.length) parts.push("【工具调用】" + names.join("、"));
        }
        return parts.join("\n");
    }

    function formatTime(value) {
        if (!value) return "";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return String(value);
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    // 多行值渲染为引用块，避免内容中的 # / ** 破坏总记录结构。
    function mdValue(value) {
        const text = String(typeof value === "object" ? JSON.stringify(value, null, 2) : value);
        const single = text.replace(/\s+/g, " ").trim();
        if (!single.includes("\n") && single.length < 120) return single;
        return "\n> " + text.split("\n").map((line) => line.trim()).filter(Boolean).join("\n> ");
    }

    // ---------- 渲染：JSON ----------
    function renderJson({ scope, data, exportedAt }) {
        return JSON.stringify({
            schema_version: 1,
            app: "dengta-home",
            exported_at: exportedAt,
            account: {
                user_id: scope.userId,
                companion_id: scope.companionId
            },
            modules: data.modules,
            connections: data.connections
        }, null, 2);
    }

    // ---------- 渲染：Markdown 总记录 ----------
    function renderMarkdown({ scope, data, exportedAt, accountInfo }) {
        const lines = [];
        lines.push("# 灯塔 AI 伴侣 · 全部数据导出");
        lines.push("");
        lines.push(`> 账号邮箱：${accountInfo?.email || "（未知）"}`);
        lines.push(`> 用户编号：${scope.userId}`);
        lines.push(`> 伴侣编号：${scope.companionId}`);
        lines.push(`> 导出时间：${formatTime(exportedAt)}`);
        lines.push("> 说明：以下内容按模块、按时间整理，包含聊天记录、人设提示词、记忆、绘画、视频与音乐记忆等全部用户数据，可用于备份、迁移或导入蒸馏。");
        lines.push("");
        for (const module of MODULES) {
            const moduleData = data.modules[module.key];
            if (!moduleData) continue;
            lines.push(`## ${module.title}`);
            lines.push("");
            for (const spec of module.tables) {
                const list = moduleData.rows[spec.table] || [];
                if (list.length === 0) continue;
                if (spec.table === "conversations") {
                    for (const conv of list) {
                        const msgCount = Array.isArray(moduleData.rows.messages)
                            ? moduleData.rows.messages.filter((m) => m.conversation_id === conv.id).length
                            : 0;
                        lines.push(`### 会话「${cleanText(conv.title, 120) || "未命名会话"}」（${formatTime(conv.created_at)} 起，共 ${msgCount} 条消息）`);
                        lines.push("");
                    }
                    continue;
                }
                if (spec.table === "messages") {
                    const byConversation = new Map();
                    for (const message of list) {
                        const key = message.conversation_id || "未分组";
                        if (!byConversation.has(key)) byConversation.set(key, []);
                        byConversation.get(key).push(message);
                    }
                    const convTitles = new Map((moduleData.rows.conversations || []).map((c) => [c.id, cleanText(c.title, 120)]));
                    for (const [convId, messages] of byConversation) {
                        if (messages.length === 0) continue;
                        lines.push(`### 聊天记录：${convTitles.get(convId) || "会话 " + String(convId).slice(0, 8)}`);
                        lines.push("");
                        for (const message of messages) {
                            const time = formatTime(message.created_at);
                            const text = messageText(message);
                            if (!text) continue;
                            lines.push(`#### ${time} · ${roleLabel(message.role)}`);
                            lines.push("");
                            lines.push(text);
                            lines.push("");
                        }
                    }
                    continue;
                }
                if (spec.table === "companions") {
                    for (const companion of list) {
                        lines.push(`### 伴侣：${cleanText(companion.name, 80) || "未命名"}`);
                        lines.push("");
                        lines.push(`- 状态：${companion.status || ""}`);
                        lines.push(`- 创建：${formatTime(companion.created_at)}`);
                        lines.push(`- 更新：${formatTime(companion.updated_at)}`);
                        lines.push("");
                    }
                    continue;
                }
                if (spec.table === "companion_profile_versions") {
                    for (const version of list) {
                        lines.push(`### 人设版本（${formatTime(version.created_at)}）`);
                        lines.push("");
                        for (const [key, value] of Object.entries(version)) {
                            if (["id", "user_id", "companion_id", "created_at"].includes(key)) continue;
                            if (value == null || value === "") continue;
                            lines.push(`- **${key}**：${mdValue(value)}`);
                        }
                        lines.push("");
                    }
                    continue;
                }
                if (spec.table === "settings") {
                    for (const row of list) {
                        lines.push("### 设置与偏好");
                        lines.push("");
                        for (const [key, value] of Object.entries(row)) {
                            if (["id", "user_id", "companion_id", "created_at"].includes(key)) continue;
                            if (value == null || value === "") continue;
                            lines.push(`- **${key}**：${mdValue(value)}`);
                        }
                        lines.push("");
                    }
                    continue;
                }
                if (spec.table === "memories") {
                    for (const memory of list) {
                        lines.push(`- ${formatTime(memory.created_at)} ${memory.confirmation_status ? `（${memory.confirmation_status}）` : ""}：${cleanText(memory.summary, 600)}${memory.conversation_id ? `（会话 ${String(memory.conversation_id).slice(0, 8)}）` : ""}`);
                    }
                    lines.push("");
                    continue;
                }
                if (spec.table === "user_profiles") {
                    for (const row of list) {
                        lines.push("### 账号资料");
                        lines.push("");
                        for (const [key, value] of Object.entries(row)) {
                            if (["id", "created_at", "updated_at"].includes(key)) continue;
                            if (value == null || value === "") continue;
                            lines.push(`- **${key}**：${mdValue(value)}`);
                        }
                        lines.push("");
                    }
                    continue;
                }
                // 通用渲染：行 → 列表
                for (const row of list) {
                    const summary = [];
                    for (const [key, value] of Object.entries(row)) {
                        if (["id", "user_id", "companion_id", "created_at", "updated_at", "visible"].includes(key)) continue;
                        if (value == null || value === "") continue;
                        if (key === "content" || key === "summary" || key === "title" || key === "description") {
                            summary.push(cleanText(value, 600));
                        } else if (typeof value === "object") {
                            summary.push(`${key}=${JSON.stringify(value)}`);
                        } else {
                            summary.push(`${key}=${String(value)}`);
                        }
                    }
                    const time = row.created_at ? `（${formatTime(row.created_at)}）` : "";
                    lines.push(`- ${cleanText(row.title || row.name || row.content || row.summary || row.description || String(row.id).slice(0, 8), 300)}${time}${summary.length ? " · " + summary.join(" · ").slice(0, 400) : ""}`);
                }
                if (list.length > 0) lines.push("");
            }
        }
        lines.push("## 外部连接（仅账号信息，凭据不导出）");
        lines.push("");
        for (const [table, list] of Object.entries(data.connections)) {
            if (list.length === 0) continue;
            lines.push(`### ${table}`);
            lines.push("");
            for (const row of list) {
                lines.push(`- ${Object.entries(row).map(([k, v]) => `${k}=${String(v)}`).join(" · ")}`);
            }
            lines.push("");
        }
        lines.push("---");
        lines.push("（文件由灯塔 AI 伴侣导出功能生成）");
        lines.push("");
        return lines.join("\n");
    }

    // ---------- 渲染：TXT ----------
    function renderTxt(markdown) {
        return markdown
            .replace(/^#+\s*/gm, "")
            .replace(/\*\*/g, "")
            .replace(/^>\s*/gm, "")
            .replace(/^- /gm, "· ")
            .replace(/`/g, "");
    }

    // ---------- 渲染：HTML ----------
    function renderHtml(markdown) {
        const esc = (value) => String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        const body = markdown
            .split("\n")
            .map((line) => {
                if (line.startsWith("# ")) return `<h1>${esc(line.slice(2))}</h1>`;
                if (line.startsWith("## ")) return `<h2>${esc(line.slice(3))}</h2>`;
                if (line.startsWith("### ")) return `<h3>${esc(line.slice(4))}</h3>`;
                if (line.startsWith("#### ")) return `<h4>${esc(line.slice(5))}</h4>`;
                if (line.startsWith("> ")) return `<blockquote>${esc(line.slice(2))}</blockquote>`;
                if (line.startsWith("- ")) return `<li>${esc(line.slice(2))}</li>`;
                if (line.trim() === "") return "";
                return `<p>${esc(line)}</p>`;
            })
            .join("\n");
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>灯塔 AI 伴侣 · 全部数据导出</title>
<style>
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:860px;margin:0 auto;padding:24px 16px 64px;line-height:1.7;color:#333}
h1{font-size:26px;border-bottom:2px solid #eee;padding-bottom:8px}
h2{font-size:20px;margin-top:32px;border-left:4px solid #a96854;padding-left:10px}
h3{font-size:16px;margin-top:20px;color:#8a4f38}
h4{font-size:14px;color:#555;margin-top:16px}
blockquote{color:#777;background:#faf7f2;border-left:3px solid #e3d5c5;padding:8px 12px;margin:0 0 16px}
li{margin:4px 0}
p{white-space:pre-wrap;word-break:break-word}
</style>
</head>
<body>${body}</body>
</html>`;
    }

    async function exportAccount(scope, format = "md") {
        const normalized = String(format || "md").toLowerCase();
        if (!EXPORT_FORMATS.has(normalized)) {
            throw requestError(400, "export_format_invalid", "导出格式只支持 json、md、txt、html。");
        }
        const exportedAt = new Date();
        const data = await collect(scope);
        let accountInfo = null;
        try {
            const { data: profile } = await database
                .from("user_profiles")
                .select("email, display_name")
                .eq("id", scope.userId)
                .maybeSingle();
            accountInfo = profile || null;
        } catch {
            accountInfo = null;
        }
        let content;
        if (normalized === "json") {
            content = renderJson({ scope, data, exportedAt });
        } else {
            const markdown = renderMarkdown({ scope, data, exportedAt, accountInfo });
            content = normalized === "md" ? markdown : normalized === "html" ? renderHtml(markdown) : renderTxt(markdown);
        }
        const stamp = [
            exportedAt.getFullYear(),
            String(exportedAt.getMonth() + 1).padStart(2, "0"),
            String(exportedAt.getDate()).padStart(2, "0"),
            "-",
            String(exportedAt.getHours()).padStart(2, "0"),
            String(exportedAt.getMinutes()).padStart(2, "0"),
            String(exportedAt.getSeconds()).padStart(2, "0")
        ].join("");
        return {
            format: normalized,
            filename: `dengta-export-${stamp}.${normalized}`,
            content,
            size: Buffer.byteLength(content, "utf8"),
            exported_at: exportedAt.toISOString()
        };
    }

    return { exportAccount };
}

module.exports = { createAccountExportService, EXPORT_FORMATS };
