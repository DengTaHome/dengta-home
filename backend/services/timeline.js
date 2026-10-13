"use strict";

// timeline-for-agent 多租户集成服务（DengTa 服务器版）
// 生活时间轴：按 user_id+companion_id 隔离，事件模型/校验/合并语义对齐 timeline-for-agent（AGPL-3.0）：
//   - 事件需 startAt/endAt ISO，且按用户时区必须落在目标 date 当天（跨天睡眠拆两段）
//   - merge 按事件 id 去重合并，replace 整日覆盖，finalize 标记 final
//   - 新事件节点自动进入 proposals 提案
// 与 timeline-for-agent 的差异（服务器版自适应）：
//   - 分类/事件节点 label 本地化为中文（id 结构保持一致：life/work/study/...）
//   - 事件缺 endAt 时默认 +30 分钟并截断到当天末尾（对话记录场景更鲁棒）

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_EVENT_DURATION_MS = 30 * 60 * 1000;

// ---------- 默认分类（对齐 timeline-for-agent default-taxonomy，label 中文化） ----------

function createDefaultTaxonomy() {
    return {
        categories: [
            { id: "life", label: "生活", children: [
                { id: "life.meal", label: "吃饭" },
                { id: "life.hygiene", label: "洗漱" },
                { id: "life.chores", label: "家务" },
                { id: "life.shopping", label: "购物" },
                { id: "life.errand", label: "跑腿办事" },
                { id: "life.other", label: "其他生活" }
            ] },
            { id: "work", label: "工作", children: [
                { id: "work.coding", label: "编码" },
                { id: "work.meeting", label: "会议" },
                { id: "work.writing", label: "写作" },
                { id: "work.communication", label: "沟通" },
                { id: "work.other", label: "其他工作" }
            ] },
            { id: "study", label: "学习", children: [
                { id: "study.reading", label: "阅读" },
                { id: "study.course", label: "课程" },
                { id: "study.practice", label: "练习" },
                { id: "study.review", label: "复习" },
                { id: "study.other", label: "其他学习" }
            ] },
            { id: "exercise", label: "运动", children: [
                { id: "exercise.walk", label: "散步" },
                { id: "exercise.workout", label: "锻炼" },
                { id: "exercise.stretch", label: "拉伸" },
                { id: "exercise.other", label: "其他运动" }
            ] },
            { id: "entertainment", label: "娱乐", children: [
                { id: "entertainment.video", label: "看视频" },
                { id: "entertainment.game", label: "玩游戏" },
                { id: "entertainment.social_media", label: "刷社交媒体" },
                { id: "entertainment.music", label: "听音乐" },
                { id: "entertainment.other", label: "其他娱乐" }
            ] },
            { id: "health", label: "健康", children: [
                { id: "health.rest", label: "休养" },
                { id: "health.medication", label: "服药" },
                { id: "health.pain", label: "症状护理" },
                { id: "health.hospital", label: "就医" },
                { id: "health.other", label: "其他健康" }
            ] },
            { id: "social", label: "社交", children: [
                { id: "social.chat", label: "聊天" },
                { id: "social.call", label: "通话" },
                { id: "social.family", label: "家庭时光" },
                { id: "social.other", label: "其他社交" }
            ] },
            { id: "care", label: "照顾", children: [
                { id: "care.pet", label: "宠物照顾" },
                { id: "care.household", label: "家庭照顾" },
                { id: "care.self", label: "自我照顾" },
                { id: "care.other", label: "其他照顾" }
            ] },
            { id: "travel", label: "出行", children: [
                { id: "travel.commute", label: "通勤" },
                { id: "travel.transit", label: "公共交通" },
                { id: "travel.other", label: "其他出行" }
            ] },
            { id: "rest", label: "休息", children: [
                { id: "rest.sleep", label: "睡眠" },
                { id: "rest.nap", label: "小睡" },
                { id: "rest.idle", label: "空闲" },
                { id: "rest.other", label: "其他休息" }
            ] }
        ],
        eventNodes: [
            buildEventNode("evt.breakfast", "早餐", "life.meal", ["breakfast", "morning meal", "吃早饭"]),
            buildEventNode("evt.lunch", "午餐", "life.meal", ["lunch", "midday meal", "吃午饭"]),
            buildEventNode("evt.dinner", "晚餐", "life.meal", ["dinner", "evening meal", "吃晚饭"]),
            buildEventNode("evt.shower", "洗澡", "life.hygiene", ["shower", "wash up", "洗漱"]),
            buildEventNode("evt.cleanup", "收拾房间", "life.chores", ["room reset", "tidying up", "打扫"]),
            buildEventNode("evt.commute", "通勤", "travel.commute", ["commute", "ride to work", "ride home", "上班路上", "下班路上"]),
            buildEventNode("evt.focus_coding", "专注编码", "work.coding", ["coding", "shipping code", "implementation", "写代码"]),
            buildEventNode("evt.meeting", "会议", "work.meeting", ["meeting", "sync", "开会"]),
            buildEventNode("evt.reading", "阅读", "study.reading", ["reading", "read a book", "看书"]),
            buildEventNode("evt.learning", "课程学习", "study.course", ["course", "studying", "lesson", "上课"]),
            buildEventNode("evt.walk", "散步", "exercise.walk", ["walk", "go for a walk", "遛弯"]),
            buildEventNode("evt.workout", "锻炼", "exercise.workout", ["workout", "training", "健身"]),
            buildEventNode("evt.watch_show", "追剧", "entertainment.video", ["watching a show", "tv time", "看剧"]),
            buildEventNode("evt.short_video", "刷短视频", "entertainment.social_media", ["short videos", "reels", "scrolling videos"]),
            buildEventNode("evt.phone_scroll", "刷手机", "entertainment.social_media", ["phone scrolling", "doomscrolling"]),
            buildEventNode("evt.headache_rest", "头痛休养", "health.rest", ["resting with a headache", "头疼休息"]),
            buildEventNode("evt.medication", "服药", "health.medication", ["taking medicine", "medication", "吃药"]),
            buildEventNode("evt.hospital_visit", "就医", "health.hospital", ["clinic visit", "hospital visit", "doctor appointment", "去医院", "看医生"]),
            buildEventNode("evt.chatting", "聊天", "social.chat", ["chatting", "replying to messages", "和朋友聊天"]),
            buildEventNode("evt.sleep", "睡眠", "rest.sleep", ["sleep", "went to sleep", "睡觉"]),
            buildEventNode("evt.nap", "小睡", "rest.nap", ["nap", "power nap", "午睡"])
        ]
    };
}

function buildEventNode(id, label, parentId, aliases = []) {
    return { id, label, aliases, parentId, status: "official" };
}

// ---------- 时区工具（服务器本地时区无关） ----------

function formatDateInTimezone(value, timezone) {
    try {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).format(Date.parse(value));
    } catch {
        return "";
    }
}

// 当地时区下 "YYYY-MM-DD HH:mm:ss" 对应的 UTC 毫秒（迭代逼近，无夏令时问题）
function utcMsFromLocal(dateStr, timeStr, timezone) {
    const [y, m, d] = String(dateStr).split("-").map((v) => Number(v));
    const [hh = 0, mm = 0, ss = 0] = String(timeStr || "00:00:00").split(":").map((v) => Number(v));
    let guess = Date.UTC(y, m - 1, d, hh, mm, ss);
    for (let i = 0; i < 5; i++) {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
        }).formatToParts(new Date(guess));
        const map = {};
        for (const part of parts) map[part.type] = part.value;
        const localAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day),
            Number(map.hour), Number(map.minute), Number(map.second));
        const err = localAsUtc - guess;
        if (Math.abs(err) < 1000) return guess;
        guess = guess + err;
    }
    return guess;
}

// date（YYYY-MM-DD）当天在当地时区的末尾（23:59:59.999）的 UTC 毫秒
function localDayEndUtcMs(date, timezone) {
    const [y, m, d] = String(date).split("-").map((v) => Number(v));
    let guess = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
    for (let i = 0; i < 5; i++) {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
        }).formatToParts(new Date(guess));
        const map = {};
        for (const part of parts) map[part.type] = part.value;
        const localAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day),
            Number(map.hour), Number(map.minute), Number(map.second));
        const err = localAsUtc - guess;
        if (Math.abs(err) < 1000) return guess + 999;
        guess = guess + err;
    }
    return guess;
}

// ---------- 事件归一化/校验（对齐 timeline-for-agent timeline-store.js） ----------

function normalizeIso(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeConfidence(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0.5;
    return Math.max(0, Math.min(1, parsed));
}

function slugify(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "event";
    return raw.replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "event";
}

function normalizeEventId(event, index, title, eventNodeId, startAt) {
    const explicit = String(event?.id || "").trim();
    if (explicit) return explicit;
    const key = slugify(eventNodeId || title || `fact_${index + 1}`);
    const timeKey = startAt.replace(/[:.]/g, "-");
    return `fact:${key}:${timeKey}`;
}

function buildCategoryMap(taxonomy) {
    const map = new Map();
    if (!taxonomy || !Array.isArray(taxonomy.categories)) return map;
    for (const category of taxonomy.categories) {
        map.set(category.id, { categoryId: category.id, label: category.label });
        for (const child of Array.isArray(category.children) ? category.children : []) {
            map.set(child.id, { categoryId: category.id, label: child.label });
        }
    }
    return map;
}

function buildEventNodeMap(taxonomy) {
    const map = new Map();
    if (!taxonomy || !Array.isArray(taxonomy.eventNodes)) return map;
    for (const node of taxonomy.eventNodes) map.set(node.id, node);
    return map;
}

function deriveCategoryId(subcategoryId, categoryMap) {
    if (!subcategoryId || !categoryMap || !categoryMap.size) return "";
    return categoryMap.get(subcategoryId)?.categoryId || "";
}

function normalizeEvent(event, index, categoryMap, nodeMap) {
    if (!event || typeof event !== "object") return { value: null, error: "event 必须是对象" };
    const startAt = normalizeIso(event.startAt);
    const endAt = normalizeIso(event.endAt);
    if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) {
        return { value: null, error: "startAt/endAt 缺失或时间范围无效（endAt 必须晚于 startAt）" };
    }
    const eventNodeId = String(event.eventNodeId || "").trim();
    const eventNode = nodeMap && eventNodeId ? nodeMap.get(eventNodeId) : null;
    const subcategoryId = String(event.subcategoryId || eventNode?.parentId || "").trim();
    const categoryId = String(event.categoryId || deriveCategoryId(subcategoryId, categoryMap) || "").trim();
    if (!subcategoryId || !categoryId) {
        return { value: null, error: "需要 eventNodeId，或 subcategoryId/categoryId 能解析分类" };
    }
    const title = String(event.title || eventNode?.label || "").trim();
    if (!title) return { value: null, error: "title 缺失且 eventNodeId 无法补全" };
    return {
        value: {
            id: normalizeEventId(event, index, title, eventNodeId, startAt),
            startAt,
            endAt,
            title,
            note: String(event.note || event.remark || "").trim(),
            categoryId,
            subcategoryId,
            eventNodeId,
            tags: Array.isArray(event.tags) ? event.tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [],
            confidence: normalizeConfidence(event.confidence),
            sourceMessageIds: Array.isArray(event.sourceMessageIds)
                ? event.sourceMessageIds.map((value) => String(value || "").trim()).filter(Boolean)
                : []
        },
        error: ""
    };
}

function normalizeDayEvents(events, taxonomy, options = {}) {
    const categoryMap = buildCategoryMap(taxonomy);
    const nodeMap = buildEventNodeMap(taxonomy);
    const strict = !!options.strict;
    if (!Array.isArray(events)) return [];
    return events.flatMap((event, index) => {
        const result = normalizeEvent(event, index, categoryMap, nodeMap);
        if (result.value) return [result.value];
        if (strict) throw new Error(`第 ${index + 1} 条事件无效：${result.error}`);
        return [];
    });
}

function validateDayEvents(date, events, timezone) {
    const resolvedTimezone = String(timezone || "").trim() || DEFAULT_TIMEZONE;
    for (const event of Array.isArray(events) ? events : []) {
        const startDate = formatDateInTimezone(event.startAt, resolvedTimezone);
        const endDate = formatDateInTimezone(event.endAt, resolvedTimezone);
        if (startDate !== date || endDate !== date) {
            throw new Error(
                `时间轴事件必须落在 ${date} 当天：${event.title}（${event.startAt} ~ ${event.endAt}，按 ${resolvedTimezone} 时区）`
            );
        }
    }
}

// 服务器版自适应：缺 endAt 时默认 +30 分钟并截断到当天末尾
function withDefaultEndAt(event, date, timezone) {
    if (event?.endAt) return event;
    if (!event?.startAt) return event;
    const start = new Date(event.startAt).getTime();
    if (!Number.isFinite(start)) return event;
    const capped = Math.min(start + DEFAULT_EVENT_DURATION_MS, localDayEndUtcMs(date, timezone));
    return { ...event, endAt: new Date(capped).toISOString() };
}

// ---------- Supabase 多租户持久化 ----------

async function getTaxonomyRecord(database, tenant) {
    const { data, error } = await database
        .from("timeline_taxonomy")
        .select("taxonomy, proposals")
        .eq("user_id", tenant.userId)
        .eq("companion_id", tenant.companionId)
        .maybeSingle();
    if (error) throw error;
    if (data) {
        return {
            taxonomy: data.taxonomy || createDefaultTaxonomy(),
            proposals: Array.isArray(data.proposals) ? data.proposals : []
        };
    }
    const created = createDefaultTaxonomy();
    const { error: insertError } = await database
        .from("timeline_taxonomy")
        .insert({
            user_id: tenant.userId,
            companion_id: tenant.companionId,
            taxonomy: created,
            proposals: []
        });
    if (insertError) throw insertError;
    return { taxonomy: created, proposals: [] };
}

async function saveTaxonomyRecord(database, tenant, taxonomy, proposals) {
    const { error } = await database
        .from("timeline_taxonomy")
        .update({ taxonomy, proposals, updated_at: new Date().toISOString() })
        .eq("user_id", tenant.userId)
        .eq("companion_id", tenant.companionId);
    if (error) throw error;
}

async function getDayRecord(database, tenant, date) {
    const { data, error } = await database
        .from("timeline_days")
        .select("status, updated_at, events")
        .eq("user_id", tenant.userId)
        .eq("companion_id", tenant.companionId)
        .eq("date", date)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function saveDayRecord(database, tenant, date, day) {
    const payload = {
        user_id: tenant.userId,
        companion_id: tenant.companionId,
        date,
        status: day.status,
        updated_at: day.updatedAt,
        events: day.events
    };
    const { error } = await database
        .from("timeline_days")
        .upsert(payload, { onConflict: "user_id,companion_id,date" });
    if (error) throw error;
}

async function deleteDayRecord(database, tenant, date) {
    const { error } = await database
        .from("timeline_days")
        .delete()
        .eq("user_id", tenant.userId)
        .eq("companion_id", tenant.companionId)
        .eq("date", date);
    if (error) throw error;
}

// ---------- 对外 API ----------

// 写入一天：mode=merge（默认，按事件 id 合并）| replace（整日覆盖）
// payload: { date, mode, events[], dropEventIds[], finalize, newEventNodes[], source }
async function writeTimelineDay({ database, userId, companionId, timezone = DEFAULT_TIMEZONE, payload = {}, source = null }) {
    const tenant = { userId, companionId };
    const date = String(payload.date || "").trim();
    if (!date) throw new Error("timeline_write 需要 date（YYYY-MM-DD，用户当地日期）");

    const { taxonomy, proposals } = await getTaxonomyRecord(database, tenant);
    const mode = String(payload.mode || "merge").trim().toLowerCase() === "replace" ? "replace" : "merge";

    // 新事件节点 -> proposals
    const existingIds = new Set((taxonomy.eventNodes || []).map((node) => node.id));
    for (const candidate of Array.isArray(payload.newEventNodes) ? payload.newEventNodes : []) {
        const id = String(candidate?.id || "").trim();
        const label = String(candidate?.label || "").trim();
        const parentId = String(candidate?.parentId || "").trim();
        if (!id || !label || !parentId || existingIds.has(id)) continue;
        existingIds.add(id);
        taxonomy.eventNodes.push({ id, label, aliases: [], parentId, status: "provisional" });
        proposals.push({
            id: `proposal:${id}`,
            date,
            proposedNodeId: id,
            label,
            parentId,
            sourceMessageIds: [],
            createdAt: new Date().toISOString()
        });
    }
    if (proposals.length) await saveTaxonomyRecord(database, tenant, taxonomy, proposals);

    // 归一化（缺 endAt 兜底）
    const rawEvents = Array.isArray(payload.events) ? payload.events : [];
    const preprocessed = rawEvents.map((event) => withDefaultEndAt(event, date, timezone));
    const normalizedEvents = normalizeDayEvents(preprocessed, taxonomy, { strict: true });
    validateDayEvents(date, normalizedEvents, timezone);

    let day;
    if (mode === "replace") {
        if (!normalizedEvents.length) {
            await deleteDayRecord(database, tenant, date);
            return { date, mode, eventCount: 0, status: "missing", deleted: true };
        }
        day = {
            status: payload.finalize ? "final" : "draft",
            updatedAt: new Date().toISOString(),
            events: normalizedEvents
        };
        await saveDayRecord(database, tenant, date, day);
    } else {
        const currentDay = await getDayRecord(database, tenant, date);
        const merged = new Map();
        for (const currentEvent of currentDay?.events || []) merged.set(currentEvent.id, currentEvent);
        for (const event of normalizedEvents) merged.set(event.id, event);
        for (const eventId of Array.isArray(payload.dropEventIds) ? payload.dropEventIds : []) {
            merged.delete(String(eventId || "").trim());
        }
        const nextEvents = [...merged.values()].sort((left, right) => {
            const delta = Date.parse(left.startAt) - Date.parse(right.startAt);
            return delta !== 0 ? delta : left.id.localeCompare(right.id);
        });
        if (!nextEvents.length) {
            await deleteDayRecord(database, tenant, date);
            return { date, mode, eventCount: 0, status: "missing", deleted: true };
        }
        day = {
            status: payload.finalize ? "final" : (currentDay?.status === "final" ? "final" : "draft"),
            updatedAt: new Date().toISOString(),
            events: nextEvents
        };
        await saveDayRecord(database, tenant, date, day);
    }

    return {
        date,
        mode,
        eventCount: day.events.length,
        status: day.status,
        updatedAt: day.updatedAt
    };
}

async function readTimelineDay({ database, userId, companionId, date = "" }) {
    const normalizedDate = String(date || "").trim();
    if (!normalizedDate) throw new Error("timeline_read 需要 date（YYYY-MM-DD）");
    const day = await getDayRecord(database, { userId, companionId }, normalizedDate);
    if (!day) {
        return { date: normalizedDate, exists: false, status: "missing", updatedAt: "", eventCount: 0, events: [] };
    }
    return {
        date: normalizedDate,
        exists: true,
        status: day.status,
        updatedAt: day.updatedAt,
        eventCount: day.events.length,
        events: day.events.map((event) => ({
            id: event.id,
            startAt: event.startAt,
            endAt: event.endAt,
            title: event.title,
            note: event.note || "",
            categoryId: event.categoryId,
            subcategoryId: event.subcategoryId,
            eventNodeId: event.eventNodeId || "",
            tags: Array.isArray(event.tags) ? [...event.tags] : []
        }))
    };
}

async function listTimelineCategories({ database, userId, companionId }) {
    const { taxonomy } = await getTaxonomyRecord(database, { userId, companionId });
    const eventNodesByParentId = new Map();
    for (const node of Array.isArray(taxonomy?.eventNodes) ? taxonomy.eventNodes : []) {
        const parentId = String(node?.parentId || "").trim();
        if (!parentId) continue;
        const group = eventNodesByParentId.get(parentId) || [];
        group.push({
            id: String(node.id || "").trim(),
            label: String(node.label || "").trim(),
            aliases: Array.isArray(node.aliases) ? [...node.aliases] : [],
            status: String(node.status || "official").trim() || "official"
        });
        eventNodesByParentId.set(parentId, group);
    }
    const categories = Array.isArray(taxonomy?.categories)
        ? taxonomy.categories.map((category) => ({
            id: String(category.id || "").trim(),
            label: String(category.label || "").trim(),
            children: Array.isArray(category.children)
                ? category.children.map((child) => ({
                    id: String(child.id || "").trim(),
                    label: String(child.label || "").trim(),
                    eventNodes: (eventNodesByParentId.get(String(child.id || "").trim()) || [])
                        .slice()
                        .sort((left, right) => left.id.localeCompare(right.id))
                }))
                : []
        }))
        : [];
    return { categoryCount: categories.length, categories };
}

async function listTimelineProposals({ database, userId, companionId, date = "" }) {
    const { proposals } = await getTaxonomyRecord(database, { userId, companionId });
    const filtered = date
        ? proposals.filter((proposal) => String(proposal?.date || "").trim() === String(date).trim())
        : proposals;
    const items = filtered
        .map((proposal) => ({
            id: String(proposal.id || "").trim(),
            date: String(proposal.date || "").trim(),
            proposedNodeId: String(proposal.proposedNodeId || "").trim(),
            label: String(proposal.label || "").trim(),
            parentId: String(proposal.parentId || "").trim(),
            sourceMessageIds: Array.isArray(proposal.sourceMessageIds) ? [...proposal.sourceMessageIds] : [],
            createdAt: String(proposal.createdAt || "").trim()
        }))
        .sort((left, right) => {
            const timeDelta = Date.parse(right.createdAt || "") - Date.parse(left.createdAt || "");
            if (Number.isFinite(timeDelta) && timeDelta !== 0) return timeDelta;
            return left.id.localeCompare(right.id);
        });
    return { date: date || "", proposalCount: items.length, proposals: items };
}

module.exports = {
    writeTimelineDay,
    readTimelineDay,
    listTimelineCategories,
    listTimelineProposals
};
