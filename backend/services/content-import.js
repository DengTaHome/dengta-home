const { createHash } = require("node:crypto");
const { decodeText } = require("./adaptive-file-parser");

const SOURCE_TYPES = new Set(["world_book", "chat_history"]);
const TARGETS = new Set([
    "user_details",
    "unified_system_prompt",
    "memories",
    "memory_calendar",
    "world_book_entries"
]);
const TYPE_TARGETS = Object.freeze({
    memory: new Set(["user_details", "memories"]),
    style: new Set(["unified_system_prompt"]),
    world_book: new Set(["world_book_entries"]),
    calendar: new Set(["memory_calendar"])
});
const MAX_TEXT_CHARS = 1_000_000;

function contentImportError(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}

function cleanText(value, max = 200_000) {
    return String(value ?? "").replace(/\u0000/g, "").slice(0, max);
}

function nonEmptyText(value, max) {
    const text = cleanText(value, max).trim();
    return text || "";
}

function decodeUtf8(bytes) {
    return decodeText(bytes);
}

function normalizeInput(input = {}) {
    const sourceType = String(input.sourceType || input.source_type || "");
    if (!SOURCE_TYPES.has(sourceType)) {
        throw contentImportError(
            400,
            "import_source_type_invalid",
            "导入类型必须是 world_book 或 chat_history。"
        );
    }
    const mediaType = String(
        input.mediaType || input.media_type || "text/plain"
    ).split(";", 1)[0].trim().toLowerCase();
    const sourceName = cleanText(
        input.sourceName || input.source_name || "import.txt",
        240
    );
    const bytes = Buffer.isBuffer(input.bytes)
        ? input.bytes
        : Buffer.from(String(input.content ?? ""), "utf8");
    if (!bytes.length) {
        throw contentImportError(400, "import_empty", "导入内容不能为空。");
    }
    let text = decodeUtf8(bytes);
    const warnings = [];
    if (text.length > MAX_TEXT_CHARS) {
        if (mediaType === "application/json") throw contentImportError(413, "import_json_too_large", "JSON 结构超过单次解析容量，请拆成完整 JSON 或导出为 JSONL；内容尚未保存。");
        // Instead of rejecting oversized imports, keep the head and tell the
        // user exactly where the cut happened.
        const kept = text.slice(0, MAX_TEXT_CHARS);
        const lineCount = kept.split("\n").length;
        warnings.push({
            code: "import_text_truncated",
            count: text.length - MAX_TEXT_CHARS,
            message: `内容超出单次导入上限，已保留前 ${MAX_TEXT_CHARS.toLocaleString("zh-CN")} 个字符（约第 ${lineCount.toLocaleString("zh-CN")} 行处截断），其余部分未导入。可以把剩余部分拆成下一个文件继续导入。`
        });
        text = kept;
    }
    return { sourceType, mediaType, sourceName, bytes, text, warnings };
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        throw contentImportError(
            400,
            "import_json_invalid",
            "导入内容不是有效的 JSON。"
        );
    }
}

function valuesOfEntries(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
}

// 中英文关键词提取：从标题和内容中自动提取最有意义的词作为关键词
function extractKeywords(title, content) {
    const text = `${title} ${content}`;
    const MAX_KEYWORDS = 10;
    const keywords = [];
    // 中文：提取 2-4 字词
    const chineseWords = text.match(/[\u4e00-\u9fff]{2,4}/g);
    if (chineseWords) {
        const dedup = new Set();
        for (const word of chineseWords) {
            // 跳过纯数字、单字重复、无意义填充词
            if (/^(\d+)$/.test(word)) continue;
            if (/^(的|了|是|在|我|有|和|就|不|人|都|一|个|上|也|很|到|说|要|去|你|会|着|没有|我们|他们|可以|这个|那个|什么|怎么|不是|但是|因为|所以|如果|虽然|还是|或者|已经|一个|可以|没有|这个|那个|这些|那些|这样|那样)$/.test(word)) continue;
            dedup.add(word);
        }
        for (const word of dedup) {
            keywords.push(word);
            if (keywords.length >= MAX_KEYWORDS) break;
        }
    }
    // 英文：提取 3 字符以上单词
    const englishWords = text.match(/\b[a-zA-Z]{3,}\b/g);
    if (englishWords) {
        const stopWords = new Set(["the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "has", "was", "were", "that", "this", "with", "from", "have", "been", "will", "would", "could", "should", "about", "which", "their", "there", "what", "when", "where", "how", "very", "just", "also", "than", "then", "some", "into", "over", "after", "before", "between", "other", "more", "such", "only", "even", "much", "still", "while", "every", "each", "most", "many", "both", "through", "during", "without", "because", "already", "another", "however", "therefore", "nevertheless", "though", "although", "instead", "otherwise", "further", "moreover", "besides", "meanwhile", "never", "always", "often", "usually", "sometimes", "rarely", "seldom", "maybe", "perhaps", "likely", "probably", "certainly", "definitely", "absolutely", "actually", "basically", "essentially", "generally", "normally", "typically", "really", "quite", "pretty", "rather", "fairly", "somewhat", "almost", "nearly", "approximately", "roughly", "around", "about"]);
        const dedup = new Set();
        for (const word of englishWords) {
            const lower = word.toLowerCase();
            if (stopWords.has(lower)) continue;
            if (/^\d+$/.test(lower)) continue;
            dedup.add(lower);
        }
        for (const word of dedup) {
            keywords.push(word);
            if (keywords.length >= MAX_KEYWORDS) break;
        }
    }
    // 如果标题被提取过，从 content 开头再补充
    if (content && keywords.length < 3) {
        const firstLine = content.split("\n")[0].trim();
        const firstWords = firstLine.split(/[\s,，。、；：]+/).filter(Boolean).slice(0, 3);
        for (const word of firstWords) {
            if (word.length >= 2 && !keywords.includes(word) && keywords.length < MAX_KEYWORDS) {
                keywords.push(word);
            }
        }
    }
    return keywords;
}

function splitDocument(text) {
    const normalized = text.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return [];
    const headingParts = normalized.split(/(?=^#{1,6}\s+)/m).filter(Boolean);
    const parts = headingParts.length > 1
        ? headingParts
        : normalized.split(/\n{2,}/).filter(Boolean);
    return parts.map((part, index) => {
        const lines = part.trim().split("\n");
        const heading = lines[0].match(/^#{1,6}\s+(.+)$/);
        const title = heading ? heading[1].trim() : `条目 ${index + 1}`;
        const content = (heading ? lines.slice(1).join("\n") : part).trim();
        return {
            title,
            content,
            keywords: extractKeywords(title, content)
        };
    }).filter((item) => item.content);
}

function importedWorldBookFields(entry = {}, ordinal = 0) {
    const priorityValue = entry.priority ?? entry.order ?? 100;
    const priority = Number.isInteger(Number(priorityValue))
        ? Math.max(-100000, Math.min(100000, Number(priorityValue))) : 100;
    const sortValue = entry.sort_order ?? entry.display_order ?? ordinal;
    const sortOrder = Number.isInteger(Number(sortValue)) ? Number(sortValue) : ordinal;
    const matchMode = entry.match_mode === "all" || entry.selective === true
        ? "all" : "any";
    const rawPosition = entry.position ?? entry.insertion_position;
    const position = rawPosition === "before_memory" || rawPosition === 0
        ? "before_memory" : "dynamic_context";
    return {
        priority,
        constant: entry.constant === true,
        match_mode: matchMode,
        case_sensitive: entry.case_sensitive === true || entry.caseSensitive === true,
        position,
        sort_order: sortOrder
    };
}

function parseWorldBook(input) {
    let entries;
    let warnings = [];
    if (input.mediaType === "application/json") {
        const root = parseJson(input.text);
        // 尝试多种常见世界书 JSON 格式（Operit、北极星、Risque、群星等）
        entries = valuesOfEntries(
            root?.entries ?? root?.data ?? root?.world_book?.entries ??
            root?.worldbook ?? root?.items ?? root?.pages ??
            root?.characters ?? root?.locations ?? root?.objects ?? root?.events ??
            root?.records ?? root?.content ?? root?.list ?? root?.books ??
            root?.world_book_entries ?? root?.worldBookEntries ??
            root?.entries ?? root?.data ?? root
        );
        if (!entries || !entries.length) {
            // 最后尝试：根对象的值按数组展开
            entries = Object.values(root).filter(v => typeof v === 'object' && v !== null);
            if (entries.length) {
                warnings.push({
                    code: "world_book_format_heuristic",
                    count: entries.length,
                    message: "未识别到标准世界书 JSON 结构，已按根对象字段展开。"
                });
            }
        }
    } else {
        entries = splitDocument(input.text);
    }
    const candidates = entries.map((entry, ordinal) => {
        if (typeof entry === "string") {
            entry = { content: entry };
        }
        const sourceContent = String(entry?.content ?? entry?.text ?? entry?.description ??
            entry?.detail ?? entry?.body ?? entry?.summary ?? "").replace(/\u0000/g, "");
        const content = nonEmptyText(sourceContent, 200_000);
        if (!content) return null;
        const truncation = sourceContent.length > 200_000 ? {
            truncated: true,
            source_characters: sourceContent.length,
            retained_characters: content.length,
            omitted_characters: sourceContent.length - content.length
        } : null;
        if (truncation) warnings.push({
            code: "import_world_book_content_truncated", count: 1, ordinal, ...truncation,
            message: `第 ${ordinal + 1} 条世界书正文共有 ${truncation.source_characters.toLocaleString("zh-CN")} 字符，单条保存上限为 200,000；当前预览保留 ${truncation.retained_characters.toLocaleString("zh-CN")} 字符，另有 ${truncation.omitted_characters.toLocaleString("zh-CN")} 字符未纳入候选。这是部分正文，确认只保存当前候选；完整内容请拆条重新导入。`
        });
        const rawKeywords = entry?.keys ?? entry?.key ?? entry?.keywords ??
            entry?.tags ?? entry?.category ?? entry?.labels ?? [];
        const keywords = (Array.isArray(rawKeywords)
            ? rawKeywords
            : String(rawKeywords).split(/[,，、\s]+/))
            .map((item) => nonEmptyText(item, 120))
            .filter(Boolean)
            .slice(0, 100);
        // 当 JSON 导入条目没有关键词时，自动从内容提取
        if (!keywords.length) {
            const title = nonEmptyText(
                entry?.comment ?? entry?.name ?? entry?.title ??
                entry?.label ?? entry?.keyword ?? entry?.header,
                240
            );
            const autoKeywords = extractKeywords(
                title || `条目 ${ordinal + 1}`,
                content
            );
            for (const kw of autoKeywords) {
                if (keywords.length < 20) keywords.push(kw);
            }
        }
        return {
            ordinal,
            candidate_type: "world_book",
            target: "world_book_entries",
            title: nonEmptyText(
                entry?.comment ?? entry?.name ?? entry?.title ??
                entry?.label ?? entry?.keyword ?? entry?.header,
                240
            ) || `条目 ${ordinal + 1}`,
            content,
            metadata: {
                ...(truncation ? { content_truncation: truncation } : {}),
                keywords,
                enabled: entry?.disable !== true && entry?.enabled !== false,
                ...importedWorldBookFields(entry, ordinal),
                source_fields: entry && typeof entry === "object"
                    ? JSON.parse(JSON.stringify(entry)) : {}
            }
        };
    }).filter(Boolean);
    return { candidates, warnings };
}

function highConfidenceAssistantRefusal(text) {
    const value = String(text || "");
    const refusal = /(?:抱歉|对不起|不能|无法|不会|不可以|can't|cannot|won't|unable to)/i;
    const provider = /(?:政策|规则|安全准则|内容政策|作为(?:一个)?AI|AI(?:助手|模型)|policy|guidelines?|as an AI|language model)/i;
    const alternative = /(?:我可以帮助|换个话题|其他方式|instead|however,? I can|I can help)/i;
    return refusal.test(value) && provider.test(value) && alternative.test(value);
}

function parseTimestamp(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const raw = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(raw)) {
        return null;
    }
    let normalized = raw.replace(" ", "T");
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        normalized = `${normalized}T00:00:00.000Z`;
    } else if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
        normalized = `${normalized}${/T\d{2}:\d{2}$/.test(normalized) ? ":00" : ""}Z`;
    }
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function chatRows(root) {
    if (Array.isArray(root)) return root;
    for (const key of ["messages", "chat", "history", "data"]) {
        if (Array.isArray(root?.[key])) return root[key];
    }
    return [];
}

function normalizeChatRow(row, ordinal) {
    if (!row || typeof row !== "object") return null;
    let role = String(row.role || row.sender || row.type || "").toLowerCase();
    if (!role && typeof row.is_user === "boolean") {
        role = row.is_user ? "user" : "assistant";
    }
    if (["human", "you", "me", "用户"].includes(role)) role = "user";
    if (["ai", "bot", "character", "assistant", "助手"].includes(role)) {
        role = "assistant";
    }
    if (!['user', 'assistant', 'system'].includes(role)) return null;
    const content = nonEmptyText(
        row.content ?? row.message ?? row.mes ?? row.text,
        200_000
    );
    if (!content) return null;
    const occurredAt = parseTimestamp(
        row.created_at ?? row.timestamp ?? row.time ?? row.send_date ?? ""
    );
    return { role, content, occurredAt, ordinal };
}

function parseTextChat(text) {
    const rows = [];
    let current = null;
    // Real-world exports use many speaker labels: 我 / 我说 / 用户 / 对方 / TA /
    // 他 / 她 / user / assistant / AI / 助手 / char / system …
    const marker = /^(?:\[([^\]]+)\]\s*)?(?:\d{4}-\d{2}-\d{2}[ \t]\d{2}:\d{2}(?::\d{2})?[ \t]+)?(我说|user|human|用户|我|对方说|对方|ta|他|她|assistant|ai|bot|助手|char|character|system|系统)\s*(?:说)?\s*[:：]\s*(.*)$/i;
    const pipeMarker = /^(\d{4}-\d{2}-\d{2}T[^|]+)\s*\|\s*(我说|user|human|用户|我|对方说|对方|ta|他|她|assistant|ai|bot|助手|char|character|system|系统)\s*(?:说)?\s*\|\s*(.*)$/i;
    const roleFor = (label) => /^(我说|user|human|用户|我)$/i.test(label) ? "user"
        : /^(system|系统)$/i.test(label) ? "system" : "assistant";
    for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
        const pipe = line.match(pipeMarker);
        const match = pipe || line.match(marker);
        if (match) {
            if (current) rows.push(current);
            const label = match[2].toLowerCase();
            current = {
                role: roleFor(label),
                content: match[3],
                ordinal: rows.length,
                occurredAt: parseTimestamp(match[1] || "")
            };
        } else if (current) {
            current.content += `\n${line}`;
        }
    }
    if (current) rows.push(current);
    return rows.map((row) => ({ ...row, content: row.content.trim() }))
        .filter((row) => row.content);
}

function durableMemory(row) {
    if (row.role === "system") return false;
    return /(?:我(?:叫|是|住|来自|喜欢|偏好|不喜欢|讨厌|希望|想要|需要)|请记住|记得我|生日|纪念日|工作|职业|家人|伴侣|过敏|习惯|we (?:are|live|like)|my (?:name|birthday|job|preference))/i.test(row.content);
}

function calendarEvent(row) {
    return Boolean(row.occurredAt) && /(?:今天|昨天|明天|见面|去了|到达|发生|生日|纪念|预约|计划|开始|结束|搬家|入职|离职|结婚|旅行|约会|today|yesterday|tomorrow|met|visited|appointment|planned|started|ended)/i.test(row.content);
}

function chatCandidate(type, target, title, content, row, extra = {}) {
    return {
        ordinal: 0,
        candidate_type: type,
        target,
        title: nonEmptyText(title, 240),
        content: nonEmptyText(content, 200_000),
        metadata: {
            role: row?.role || null,
            occurred_at: row?.occurredAt || null,
            period_start: row?.occurredAt || null,
            period_end: row?.occurredAt
                ? new Date(new Date(row.occurredAt).getTime() + 1).toISOString()
                : null,
            reliable_time: Boolean(row?.occurredAt),
            ...extra
        }
    };
}

function parseChatHistory(input) {
    const sourceRows = input.mediaType === "application/json"
        ? chatRows(parseJson(input.text)).map(normalizeChatRow).filter(Boolean)
        : parseTextChat(input.text);
    const warnings = [];
    const candidates = [];
    // Text without recognizable speaker labels (narrative logs, diary-style
    // exports) is still importable: split it into paragraph memories.
    if (!sourceRows.length && input.mediaType !== "application/json") {
        for (const part of splitDocument(input.text)) {
            candidates.push(chatCandidate(
                "memory",
                "memories",
                part.title,
                part.content,
                null
            ));
        }
        if (candidates.length) {
            warnings.push({
                code: "chat_roles_not_found_fallback",
                count: candidates.length,
                message: "未识别到带角色标记的对话，已按段落整理为稳定记忆候选，你可以在预览里逐条修改。"
            });
        }
    }
    let filteredRefusals = 0;
    const usableRows = [];
    for (const row of sourceRows) {
        if (row.role === "assistant" && highConfidenceAssistantRefusal(row.content)) {
            filteredRefusals += 1;
            continue;
        }
        usableRows.push(row);
        if (row.role === "system") {
            candidates.push(chatCandidate(
                "style",
                "unified_system_prompt",
                "导入的聊天指令",
                row.content,
                row
            ));
        }
        if (durableMemory(row)) {
            candidates.push(chatCandidate(
                "memory",
                row.role === "user" ? "user_details" : "memories",
                row.role === "user" ? "用户事实或偏好" : "对话中的稳定事实",
                row.content,
                row
            ));
        }
        if (calendarEvent(row)) {
            candidates.push(chatCandidate(
                "calendar",
                "memory_calendar",
                "带可靠时间的事件",
                row.content,
                row
            ));
        }
    }
    const styleRows = usableRows
        .filter((row) => row.role === "assistant")
        .slice(0, 6);
    if (styleRows.length) {
        candidates.push(chatCandidate(
            "style",
            "unified_system_prompt",
            "历史聊天风格样本",
            [
                "延续以下历史聊天所体现的表达风格，但不要照搬其中的事实：",
                ...styleRows.map((row) => `- ${row.content}`)
            ].join("\n"),
            null,
            { sample_count: styleRows.length }
        ));
    }
    if (filteredRefusals) {
        warnings.push({
            code: "assistant_provider_refusal_filtered",
            count: filteredRefusals,
            message: "已过滤高置信度的助手供应商拒答。"
        });
    }
    if (!sourceRows.length) {
        warnings.push({
            code: "chat_messages_not_found",
            count: 1,
            message: "未识别到带角色的聊天消息。"
        });
    }
    candidates.forEach((candidate, ordinal) => {
        candidate.ordinal = ordinal;
    });
    return { candidates, warnings };
}

function parseContentImport(rawInput) {
    const input = normalizeInput(rawInput);
    const parsed = input.sourceType === "world_book"
        ? parseWorldBook(input)
        : parseChatHistory(input);
    const warnings = [...(input.warnings || []), ...parsed.warnings];
    if (!parsed.candidates.length) {
        throw contentImportError(
            422,
            "import_no_candidates",
            "导入内容中没有可预览的候选项。"
        );
    }
    return {
        ...input,
        digest: createHash("sha256").update(input.bytes).digest("hex"),
        candidates: parsed.candidates,
        warnings
    };
}

async function previewContentImport(database, rawInput) {
    const parsed = parseContentImport(rawInput);
    const { data: importRow, error: importError } = await database
        .from("content_imports")
        .insert({
            source_type: parsed.sourceType,
            source_name: parsed.sourceName,
            media_type: parsed.mediaType,
            commit_protocol: "atomic-v1",
            content_digest: parsed.digest,
            candidate_count: parsed.candidates.length,
            warning_count: parsed.warnings.length
        })
        .select("*")
        .single();
    if (importError) {
        if (["42703", "PGRST204"].includes(importError.code)) {
            throw contentImportError(503, "import_transaction_unavailable", "服务器导入结构尚未更新，本次没有开始写入，请稍后重试。");
        }
        throw importError;
    }
    const rows = parsed.candidates.map((candidate) => ({
        import_id: importRow.id,
        ...candidate
    }));
    const { data: candidates, error: candidateError } = await database
        .from("content_import_candidates")
        .insert(rows)
        .select("*");
    if (candidateError) throw candidateError;
    return {
        import: importRow,
        digest: parsed.digest,
        count: candidates.length,
        warning_count: parsed.warnings.length,
        warnings: parsed.warnings,
        candidates
    };
}

async function getContentImport(database, importId) {
    const { data: importRow, error } = await database
        .from("content_imports")
        .select("*")
        .eq("id", importId)
        .maybeSingle();
    if (error) throw error;
    if (!importRow) {
        throw contentImportError(404, "import_not_found", "未找到该导入任务。");
    }
    const { data: candidates, error: candidatesError } = await database
        .from("content_import_candidates")
        .select("*")
        .eq("import_id", importRow.id)
        .order("ordinal", { ascending: true });
    if (candidatesError) throw candidatesError;
    return { import: importRow, candidates };
}

async function listContentImports(database) {
    const { data, error } = await database
        .from("content_imports")
        .select("*")
        .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
}

function validatedDecision(candidate, raw = {}) {
    const decision = String(raw.decision || raw.status || "");
    if (!['accepted', 'rejected'].includes(decision)) {
        throw contentImportError(
            400,
            "import_decision_invalid",
            "每个候选项都必须明确 accepted 或 rejected。"
        );
    }
    const target = String(raw.target || candidate.target);
    if (!TARGETS.has(target)) {
        throw contentImportError(400, "import_target_invalid", "导入目标无效。");
    }
    if (!TYPE_TARGETS[candidate.candidate_type]?.has(target)) {
        throw contentImportError(
            400,
            "import_target_invalid",
            "候选类型与导入目标不匹配。"
        );
    }
    const title = nonEmptyText(
        Object.hasOwn(raw, "title") ? raw.title : candidate.title,
        240
    );
    const sourceContent = String((Object.hasOwn(raw, "content") ? raw.content : candidate.content) ?? "").replace(/\u0000/g, "");
    if (sourceContent.length > 200_000) {
        throw contentImportError(400, "import_content_invalid", "候选正文超过单条导入的 200,000 字符容量，请拆条或缩短后重试；本次尚未写入。");
    }
    const content = nonEmptyText(sourceContent, 200_000);
    if (decision === "accepted" && !content) {
        throw contentImportError(400, "import_content_empty", "接受的候选内容不能为空。");
    }
    if (
        decision === "accepted" &&
        target === "memory_calendar" &&
        candidate.metadata?.reliable_time !== true
    ) {
        throw contentImportError(
            400,
            "import_time_unreliable",
            "只有带可靠时间范围的候选项才能写入记忆日历。"
        );
    }
    const metadata = candidate.metadata || {};
    const runtime = candidate.candidate_type === "world_book" ? {
        keywords: Object.hasOwn(raw, "keywords") ? raw.keywords : metadata.keywords,
        enabled: Object.hasOwn(raw, "enabled") ? raw.enabled : metadata.enabled,
        priority: Object.hasOwn(raw, "priority") ? raw.priority : metadata.priority,
        constant: Object.hasOwn(raw, "constant") ? raw.constant : metadata.constant,
        match_mode: Object.hasOwn(raw, "match_mode") ? raw.match_mode : metadata.match_mode,
        case_sensitive: Object.hasOwn(raw, "case_sensitive") ? raw.case_sensitive : metadata.case_sensitive,
        position: Object.hasOwn(raw, "position") ? raw.position : metadata.position,
        sort_order: Object.hasOwn(raw, "sort_order") ? raw.sort_order : metadata.sort_order
    } : {};
    if (candidate.candidate_type === "world_book" && decision === "accepted") {
        if (!Array.isArray(runtime.keywords)) throw contentImportError(400, "import_world_book_keywords_invalid", "世界书关键词必须是数组。");
        runtime.keywords = [...new Set(runtime.keywords.map((item) => nonEmptyText(item, 120)).filter(Boolean))].slice(0, 100);
        for (const field of ["enabled", "constant", "case_sensitive"]) {
            if (typeof runtime[field] !== "boolean") throw contentImportError(400, `import_world_book_${field}_invalid`, `世界书 ${field} 无效。`);
        }
        runtime.priority = Number(runtime.priority);
        runtime.sort_order = Number(runtime.sort_order);
        if (!Number.isInteger(runtime.priority) || runtime.priority < -100000 || runtime.priority > 100000) throw contentImportError(400, "import_world_book_priority_invalid", "世界书 priority 无效。");
        if (!Number.isInteger(runtime.sort_order)) throw contentImportError(400, "import_world_book_sort_order_invalid", "世界书 sort_order 无效。");
        if (!["any", "all"].includes(runtime.match_mode)) throw contentImportError(400, "import_world_book_match_mode_invalid", "世界书 match_mode 无效。");
        if (!["before_memory", "dynamic_context"].includes(runtime.position)) throw contentImportError(400, "import_world_book_position_invalid", "世界书 position 无效。");
    }
    return { decision, target, title, content, ...runtime };
}

function appendPreservingOriginal(original, addition) {
    const current = String(original ?? "");
    return current ? `${current}\n\n${addition}` : addition;
}

async function commitContentImport(database, importId, rawDecisions) {
    const preview = await getContentImport(database, importId);
    if (!["preview", "committed"].includes(preview.import.status)) {
        throw contentImportError(409, "import_already_committed", "该导入任务已经提交。");
    }
    if (!Array.isArray(rawDecisions) || rawDecisions.length !== preview.candidates.length) {
        throw contentImportError(
            400,
            "import_decisions_incomplete",
            "必须为全部候选项提交一次决策。"
        );
    }
    const byId = new Map(rawDecisions.map((item) => [String(item?.candidate_id || item?.id || ""), item]));
    if (byId.size !== preview.candidates.length) {
        throw contentImportError(400, "import_decisions_incomplete", "候选决策存在缺失或重复。"
        );
    }
    const decisions = preview.candidates.map((candidate) => {
        const raw = byId.get(candidate.id);
        if (!raw) {
            throw contentImportError(400, "import_candidate_invalid", "决策包含未知候选项。"
            );
        }
        return { candidate, ...validatedDecision(candidate, raw) };
    });
    if (typeof database.rpc !== "function") {
        throw contentImportError(503, "import_transaction_unavailable", "服务器尚未配置原子导入，请稍后重试；本次没有开始写入。");
    }
    const payload = decisions.map(({ candidate, ...decision }) => ({
        candidate_id: candidate.id, ...decision
    }));
    let receipt;
    try {
        receipt = await database.rpc("commit_content_import_atomic", {
            p_import_id: importId, p_decisions: payload
        });
    } catch {
        throw contentImportError(503, "import_commit_unconfirmed", "导入提交回执未确认，请先检查提交结果；不要直接创建重复导入。");
    }
    const { data, error } = receipt || {};
    if (error) {
        const known = new Set(["import_not_found", "import_already_committed", "import_commit_conflict",
            "import_partial_legacy", "import_legacy_preview", "import_settings_missing", "import_decisions_incomplete",
            "import_candidate_invalid", "import_decision_invalid", "import_target_invalid",
            "import_content_invalid", "import_content_empty", "import_time_unreliable"]);
        if (/^PT(400|404|409)$/.test(error.code || "") && known.has(error.message)) {
            throw contentImportError(Number(error.code.slice(2)), error.message, "导入未完成，请根据错误代码核对预览与提交结果。");
        }
        if (["PGRST202", "42883"].includes(error.code)) {
            throw contentImportError(503, "import_transaction_unavailable", "服务器尚未配置原子导入，请稍后重试；本次没有开始写入。");
        }
        if (/^(22|23|40)/.test(error.code || "")) {
            throw contentImportError(503, "import_commit_rolled_back", "数据库未完成提交，已回滚本轮写入；请检查候选后重试。");
        }
        throw contentImportError(503, "import_commit_unconfirmed", "导入提交回执未确认，请先检查提交结果；不要直接创建重复导入。");
    }
    const acceptedCount = decisions.filter((item) => item.decision === "accepted").length;
    const rejectedCount = decisions.length - acceptedCount;
    if (data?.atomic !== true || data?.import?.id !== importId || data.import.status !== "committed"
        || data.accepted_count !== acceptedCount || data.rejected_count !== rejectedCount
        || data.import.accepted_count !== acceptedCount || data.import.rejected_count !== rejectedCount) {
        throw contentImportError(502, "import_commit_receipt_invalid", "没有收到匹配的完整提交回执，请先检查提交结果。");
    }
    return data;
}

function resolvedImport(importRow, importId) {
    const accepted = importRow?.accepted_count, rejected = importRow?.rejected_count;
    if (importRow?.id !== importId || importRow.status !== "committed"
        || !Number.isSafeInteger(accepted) || accepted < 0 || !Number.isSafeInteger(rejected) || rejected < 0
        || !Number.isSafeInteger(importRow.candidate_count) || importRow.candidate_count < 0
        || accepted + rejected !== importRow.candidate_count) {
        throw contentImportError(502, "import_resolution_receipt_invalid", "未收到可靠的导入处理结果，请保留编号并再次核对。");
    }
    return { import: importRow, accepted_count: accepted, rejected_count: rejected,
        resolution: accepted === 0 ? "discarded" : "committed", resolution_protocol: "reject-pending-v1" };
}

async function resolveContentImport(database, importId) {
    const preview = await getContentImport(database, importId);
    if (preview.import.status === "committed") return resolvedImport(preview.import, importId);
    try {
        // The same row lock arbitrates late commits and this explicit all-rejected decision.
        const result = await commitContentImport(database, importId, preview.candidates.map(candidate => ({
            candidate_id: candidate.id, decision: "rejected"
        })));
        return resolvedImport(result.import, importId);
    } catch (error) {
        if (!["import_commit_conflict", "import_already_committed"].includes(error?.code)) throw error;
        const completed = await getContentImport(database, importId);
        return resolvedImport(completed.import, importId);
    }
}

module.exports = {
    commitContentImport,
    contentImportError,
    getContentImport,
    highConfidenceAssistantRefusal,
    listContentImports,
    parseContentImport,
    previewContentImport,
    resolveContentImport
};
