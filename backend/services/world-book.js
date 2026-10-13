"use strict";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MATCH_MODES = new Set(["any", "all"]);
const POSITIONS = new Set(["before_memory", "dynamic_context"]);
const MUTABLE_FIELDS = new Set([
    "title", "content", "keywords", "enabled", "priority", "constant",
    "match_mode", "case_sensitive", "position", "sort_order", "metadata"
]);

function worldBookError(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}

function integer(value, field, minimum, maximum, fallback) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw worldBookError(400, `world_book_${field}_invalid`, `${field} 无效。`);
    }
    return parsed;
}

function normalizeKeywords(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw worldBookError(400, "world_book_keywords_invalid", "keywords 必须是数组。");
    }
    return [...new Set(value.map((item) => String(item ?? "").trim())
        .filter(Boolean))].slice(0, 100).map((item) => item.slice(0, 120));
}

function normalizeFields(input = {}, { partial = false } = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw worldBookError(400, "world_book_body_invalid", "请求正文无效。");
    }
    const output = {};
    const has = (field) => Object.hasOwn(input, field);
    const text = (field, maximum, required = false) => {
        if (!has(field)) return;
        const value = String(input[field] ?? "").replace(/\u0000/g, "").trim();
        if (required && !value) {
            throw worldBookError(400, `world_book_${field}_required`, `${field} 不能为空。`);
        }
        output[field] = value.slice(0, maximum);
    };
    text("title", 240);
    text("content", 200000, true);
    if (has("keywords")) output.keywords = normalizeKeywords(input.keywords);
    for (const field of ["enabled", "constant", "case_sensitive"]) {
        if (!has(field)) continue;
        if (typeof input[field] !== "boolean") {
            throw worldBookError(400, `world_book_${field}_invalid`, `${field} 必须是布尔值。`);
        }
        output[field] = input[field];
    }
    if (has("priority")) output.priority = integer(input.priority, "priority", -100000, 100000);
    if (has("sort_order")) output.sort_order = integer(input.sort_order, "sort_order", -2147483648, 2147483647);
    if (has("match_mode")) {
        const value = String(input.match_mode);
        if (!MATCH_MODES.has(value)) throw worldBookError(400, "world_book_match_mode_invalid", "match_mode 无效。");
        output.match_mode = value;
    }
    if (has("position")) {
        const value = String(input.position);
        if (!POSITIONS.has(value)) throw worldBookError(400, "world_book_position_invalid", "position 无效。");
        output.position = value;
    }
    if (has("metadata")) {
        if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) {
            throw worldBookError(400, "world_book_metadata_invalid", "metadata 必须是对象。");
        }
        output.metadata = input.metadata;
    }
    if (!partial) {
        if (!output.content) throw worldBookError(400, "world_book_content_required", "content 不能为空。");
        return {
            title: "", keywords: [], enabled: true, priority: 100,
            constant: false, match_mode: "any", case_sensitive: false,
            position: "dynamic_context", sort_order: 0, metadata: {}, ...output
        };
    }
    if (!Object.keys(output).length) {
        throw worldBookError(400, "world_book_update_empty", "没有可更新字段。");
    }
    return output;
}

function assertId(id) {
    if (!UUID_PATTERN.test(String(id || ""))) {
        throw worldBookError(400, "world_book_id_invalid", "世界书条目 ID 无效。");
    }
}

async function listWorldBookEntries(database, input = {}) {
    const limit = integer(input.limit, "limit", 1, 100, 50);
    const offset = integer(input.offset, "offset", 0, 1000000, 0);
    let query = database.from("world_book_entries").select("*", { count: "exact" });
    if (input.enabled !== undefined) query = query.eq("enabled", input.enabled);
    if (input.constant !== undefined) query = query.eq("constant", input.constant);
    if (input.position) {
        if (!POSITIONS.has(String(input.position))) {
            throw worldBookError(400, "world_book_position_invalid", "position 无效。");
        }
        query = query.eq("position", input.position);
    }
    const search = String(input.search || "").trim().slice(0, 200);
    if (search) query = query.or(`title.ilike.%${search.replace(/[,%()]/g, "") }%,content.ilike.%${search.replace(/[,%()]/g, "")}%`);
    const { data, error, count } = await query
        .order("priority", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) throw error;
    return { entries: data || [], pagination: { limit, offset, total: count ?? (data || []).length } };
}

async function createWorldBookEntry(database, input) {
    const values = normalizeFields(input);
    const { data, error } = await database.from("world_book_entries")
        .insert(values).select("*").single();
    if (error) throw error;
    return data;
}

async function updateWorldBookEntry(database, id, input) {
    assertId(id);
    const values = normalizeFields(input, { partial: true });
    const { data, error } = await database.from("world_book_entries")
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq("id", id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw worldBookError(404, "world_book_entry_not_found", "未找到世界书条目。");
    return data;
}

async function deleteWorldBookEntry(database, id) {
    assertId(id);
    const { data, error } = await database.from("world_book_entries")
        .delete().eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw worldBookError(404, "world_book_entry_not_found", "未找到世界书条目。");
    return data.id;
}

async function reorderWorldBookEntries(database, input = {}) {
    if (!Array.isArray(input.entries) || !input.entries.length || input.entries.length > 100) {
        throw worldBookError(400, "world_book_reorder_invalid", "entries 必须包含 1 到 100 个排序项。");
    }
    const seen = new Set();
    const updates = input.entries.map((item, index) => {
        assertId(item?.id);
        if (seen.has(item.id)) throw worldBookError(400, "world_book_reorder_invalid", "排序项不能重复。");
        seen.add(item.id);
        return { id: item.id, sort_order: integer(item.sort_order, "sort_order", -2147483648, 2147483647, index) };
    });
    const entries = [];
    for (const item of updates) entries.push(await updateWorldBookEntry(database, item.id, { sort_order: item.sort_order }));
    return entries;
}

module.exports = {
    createWorldBookEntry, deleteWorldBookEntry, listWorldBookEntries,
    reorderWorldBookEntries, updateWorldBookEntry, worldBookError
};
