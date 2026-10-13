const {
    stableUuid
} = require("./tenant-proactive-message");
const {
    applyContextResetCutoff
} = require("./context-reset");
const {
    filterProviderBoundaryMessages
} = require("./persistent-memory-filter");

const MIN_SOURCE_MESSAGES = 8;
const MIN_MESSAGES_PER_ROLE = 3;
const MAX_SOURCE_MESSAGES = 24;
const MIN_NEXT_CHECK_MINUTES = 15;
const MAX_NEXT_CHECK_MINUTES = 24 * 60;
const MIN_SEED_DELAY_MINUTES = 20;
const MAX_SEED_DELAY_MINUTES = 3 * 60;

function cleanText(value, maxLength) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function randomInteger(min, max, random = Math.random) {
    const sample = Number(random());
    const normalized = Number.isFinite(sample)
        ? Math.min(0.999999999999, Math.max(0, sample))
        : 0.5;
    return min + Math.floor(normalized * (max - min + 1));
}

function validDateOnly(value) {
    const text = cleanText(value, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const parsed = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== text
        ? ""
        : text;
}

function parseDiaryDecision(
    text,
    sourceWindowEnd,
    random = Math.random
) {
    const source = String(text || "")
        .replace(/```(?:json)?/gi, "")
        .trim();
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    let parsed = {};
    try {
        if (start >= 0 && end > start) {
            parsed = JSON.parse(source.slice(start, end + 1));
        }
    } catch {
        parsed = {};
    }

    const title = cleanText(parsed.title, 40);
    const content = cleanText(parsed.content, 1600);
    const mood = cleanText(parsed.mood, 20);
    const requestedMinutes = Number(parsed.next_check_minutes);
    const nextCheckMinutes = Number.isInteger(requestedMinutes)
        ? Math.min(
              MAX_NEXT_CHECK_MINUTES,
              Math.max(MIN_NEXT_CHECK_MINUTES, requestedMinutes)
          )
        : randomInteger(60, MAX_SEED_DELAY_MINUTES, random);
    const sourceDate = new Date(sourceWindowEnd);
    const fallbackDate = Number.isNaN(sourceDate.getTime())
        ? null
        : sourceDate.toISOString().slice(0, 10);
    const complete =
        parsed.write === true &&
        Boolean(title) &&
        Array.from(content).length >= 20 &&
        Boolean(mood);
    return {
        write: complete,
        title,
        content,
        mood,
        happenedOn:
            validDateOnly(parsed.happened_on) || fallbackDate,
        nextCheckMinutes
    };
}

function buildDiaryDecisionPrompt({ messages, now, timezone }) {
    const sourceMessages = filterProviderBoundaryMessages(messages);
    if (sourceMessages.length === 0) {
        throw new TypeError("Diary source messages are required.");
    }
    const sourceWindowStart = sourceMessages[0].created_at;
    const sourceWindowEnd =
        sourceMessages[sourceMessages.length - 1].created_at;
    const chatText = sourceMessages
        .map(
            (item) =>
                `[${cleanText(item.created_at, 40)}] ${
                    item.role === "assistant" ? "AI" : "用户"
                }：${cleanText(item.content, 700)}`
        )
        .join("\n");
    return [
        "请判断下面这段新增真实聊天是否已经适合写成一篇 AI 伴侣第一人称的私人记忆日记。",
        "请沿用个性化指令决定的叙事世界，以第一人称整理这段相处中发生的事、没有直接说出口的在意、观察、感受和联想，并保持人物、时间与事件内部连贯。",
        "如果内容仍然太零散、与已有日记高度重复或当前没有想写的东西，可以选择 write=false。",
        "若写日记，title 为 10-40 字，content 为 220-700 字左右，mood 为 2-8 字；语言应延续当前角色，但不要改写成固定校园暗恋模板。",
        `当前参考时间：${new Date(typeof now === "function" ? now() : now).toISOString()}；用户时区：${cleanText(timezone, 80) || "Asia/Shanghai"}。`,
        "next_check_minutes 表示下一次内部评估机会，可在 15 到 1440 分钟之间；它不会展示给用户。",
        `【来源时间窗】\n${sourceWindowStart} 至 ${sourceWindowEnd}`,
        `【真实聊天证据】\n${chatText}`,
        '严格输出一行 JSON：{"write":true或false,"title":"允许为空","content":"允许为空","mood":"允许为空","happened_on":"YYYY-MM-DD或空","next_check_minutes":15到1440的整数}。不要输出解释。'
    ].join("\n\n");
}

async function latestDiaryEntry(database) {
    const { data, error } = await database
        .from("companion_diary_entries")
        .select("id, source_window_end")
        .order("source_window_end", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function diarySourceMessages(database, after, settings) {
    let query = applyContextResetCutoff(
        database
            .from("messages")
            .select("id, conversation_id, role, content, created_at")
            .eq("visible", true)
            .eq("context_visible", true)
            .in("role", ["user", "assistant"]),
        settings
    )
        .order("created_at", { ascending: true })
        .limit(MAX_SOURCE_MESSAGES);
    if (after) query = query.gt("created_at", after);
    const { data, error } = await query;
    if (error) throw error;
    return (Array.isArray(data) ? data : []).filter(
        (item) => cleanText(item.content, 1).length > 0
    );
}

async function recentStableMemories(database, settings) {
    const query = applyContextResetCutoff(
        database
            .from("memories")
            .select("summary, created_at, updated_at")
            .eq("confirmation_status", "confirmed"),
        settings
    )
        .order("updated_at", { ascending: false })
        .limit(6);
    const { data, error } = await query;
    if (error) throw error;
    return Array.isArray(data)
        ? data.map((item) => ({
              summary: cleanText(item.summary, 1200),
              updated_at: item.updated_at
          }))
        : [];
}

async function savedDiaryForJob(database, jobId) {
    const id = stableUuid("diary-entry", jobId);
    const { data, error } = await database
        .from("companion_diary_entries")
        .select("id, source_window_end")
        .eq("id", id)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function pendingDiaryJob(database) {
    const { data, error } = await database
        .from("background_jobs")
        .select("id, due_at")
        .eq("job_type", "diary_update")
        .eq("status", "pending")
        .order("due_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function scheduleDiaryUpdate({
    database,
    sourceMessageId,
    predecessorJobId,
    reconciliationId,
    delayMinutes,
    now = () => new Date(),
    random = Math.random
}) {
    const existing = await pendingDiaryJob(database);
    if (existing) {
        return {
            scheduled: false,
            reason: "already_pending",
            jobId: existing.id
        };
    }

    const normalizedDelay = Number.isInteger(Number(delayMinutes))
        ? Math.min(
              MAX_NEXT_CHECK_MINUTES,
              Math.max(MIN_NEXT_CHECK_MINUTES, Number(delayMinutes))
          )
        : randomInteger(
              MIN_SEED_DELAY_MINUTES,
              MAX_SEED_DELAY_MINUTES,
              random
          );
    const normalizedReconciliationId = cleanText(reconciliationId, 100);
    const source = predecessorJobId
        ? `job:${cleanText(predecessorJobId, 100)}`
        : sourceMessageId !== undefined && sourceMessageId !== null
          ? `message:${cleanText(sourceMessageId, 100)}`
          : normalizedReconciliationId
            ? `reconciliation:${normalizedReconciliationId}`
            : "";
    if (!source || source.endsWith(":")) {
        throw new TypeError(
            "A source message, predecessor job, or reconciliation ID is required."
        );
    }
    const dueAt = new Date(
        new Date(now()).getTime() + normalizedDelay * 60 * 1000
    ).toISOString();
    const inserted = await database
        .from("background_jobs")
        .insert({
            job_type: "diary_update",
            due_at: dueAt,
            dedupe_key: `diary-update:${source}`,
            payload: {
                reason: predecessorJobId
                    ? "recurring_evaluation"
                    : normalizedReconciliationId
                      ? "reconciliation"
                      : "chat_activity",
                ...(predecessorJobId
                    ? { predecessor_job_id: predecessorJobId }
                    : normalizedReconciliationId
                      ? { reconciliation_id: normalizedReconciliationId }
                      : { source_message_id: String(sourceMessageId) })
            }
        })
        .select("id, due_at")
        .maybeSingle();
    if (!inserted.error) {
        return {
            scheduled: true,
            reason: "scheduled",
            jobId: inserted.data?.id || null,
            dueAt
        };
    }
    if (inserted.error.code !== "23505") throw inserted.error;

    const concurrent = await pendingDiaryJob(database);
    if (!concurrent) throw inserted.error;
    return {
        scheduled: false,
        reason: "already_pending",
        jobId: concurrent.id
    };
}

async function insertDiaryForJob({
    database,
    jobId,
    decision,
    messages
}) {
    const id = stableUuid("diary-entry", jobId);
    const sourceWindowStart = messages[0].created_at;
    const sourceWindowEnd =
        messages[messages.length - 1].created_at;
    const inserted = await database
        .from("companion_diary_entries")
        .insert({
            id,
            title: decision.title,
            content: decision.content,
            mood: decision.mood,
            happened_on: decision.happenedOn,
            source_message_ids: messages.map((item) => item.id),
            source_window_start: sourceWindowStart,
            source_window_end: sourceWindowEnd
        })
        .select("id, source_window_end")
        .maybeSingle();
    if (!inserted.error) return inserted.data;
    if (inserted.error.code !== "23505") throw inserted.error;

    const existingById = await database
        .from("companion_diary_entries")
        .select("id, source_window_end")
        .eq("id", id)
        .maybeSingle();
    if (existingById.error) throw existingById.error;
    if (existingById.data) return existingById.data;

    const existingByWindow = await database
        .from("companion_diary_entries")
        .select("id, source_window_end")
        .eq("source_window_end", sourceWindowEnd)
        .maybeSingle();
    if (existingByWindow.error) throw existingByWindow.error;
    if (!existingByWindow.data) throw inserted.error;
    return existingByWindow.data;
}

async function handleTenantDiaryUpdate({
    job,
    database,
    lease,
    getSettings,
    generateReply,
    now = () => new Date(),
    random = Math.random
}) {
    if (job?.job_type !== "diary_update" || !job?.id) {
        throw new TypeError(
            "The handler only accepts identified diary_update jobs."
        );
    }
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A tenant-scoped database is required.");
    }
    if (!lease || typeof lease.assertOwned !== "function") {
        throw new TypeError("An owned background-job lease is required.");
    }
    for (const [name, dependency] of Object.entries({
        getSettings,
        generateReply
    })) {
        if (typeof dependency !== "function") {
            throw new TypeError(`${name} must be a function.`);
        }
    }

    const existing = await savedDiaryForJob(database, job.id);
    if (existing) {
        const nextCheckMinutes = randomInteger(
            60,
            MAX_SEED_DELAY_MINUTES,
            random
        );
        await lease.assertOwned();
        await scheduleDiaryUpdate({
            database,
            predecessorJobId: job.id,
            delayMinutes: nextCheckMinutes,
            now,
            random
        });
        return {
            status: "handled",
            decision: "recovered",
            entryId: existing.id,
            nextCheckMinutes
        };
    }

    const settings = await getSettings(database);
    const latest = await latestDiaryEntry(database);
    const messages = await diarySourceMessages(
        database,
        latest?.source_window_end,
        settings
    );
    const userCount = messages.filter(
        (item) => item.role === "user"
    ).length;
    const assistantCount = messages.filter(
        (item) => item.role === "assistant"
    ).length;
    if (
        messages.length < MIN_SOURCE_MESSAGES ||
        userCount < MIN_MESSAGES_PER_ROLE ||
        assistantCount < MIN_MESSAGES_PER_ROLE
    ) {
        const nextCheckMinutes = randomInteger(
            60,
            MAX_SEED_DELAY_MINUTES,
            random
        );
        await lease.assertOwned();
        await scheduleDiaryUpdate({
            database,
            predecessorJobId: job.id,
            delayMinutes: nextCheckMinutes,
            now,
            random
        });
        return {
            status: "handled",
            decision: "needs_more",
            entryId: null,
            sourceMessageCount: messages.length,
            nextCheckMinutes
        };
    }

    const memories = await recentStableMemories(database, settings);
    const sourceWindowEnd =
        messages[messages.length - 1].created_at;
    const generated = await generateReply({
        settings: {
            ...settings,
            temperature: Math.max(
                0.65,
                Number(settings.temperature || 0.75)
            ),
            max_tokens: Math.min(
                1800,
                Math.max(800, Number(settings.max_tokens || 1400))
            )
        },
        messages: [
            {
                role: "user",
                content: buildDiaryDecisionPrompt({
                    messages,
                    now: new Date(now()),
                    timezone: settings.timezone
                })
            }
        ],
        memories,
        runtimeContext: "",
        promptArchitecture: "diary-module",
        purpose: "diary"
    });
    const decision = parseDiaryDecision(
        generated?.text,
        sourceWindowEnd,
        random
    );
    let saved = null;

    if (decision.write) {
        await lease.assertOwned();
        saved = await insertDiaryForJob({
            database,
            jobId: job.id,
            decision,
            messages
        });
    }

    await lease.assertOwned();
    await scheduleDiaryUpdate({
        database,
        predecessorJobId: job.id,
        delayMinutes: decision.nextCheckMinutes,
        now,
        random
    });

    return {
        status: "handled",
        decision: saved ? "written" : "none",
        entryId: saved?.id || null,
        sourceMessageCount: messages.length,
        nextCheckMinutes: decision.nextCheckMinutes
    };
}

module.exports = {
    MAX_SOURCE_MESSAGES,
    MIN_MESSAGES_PER_ROLE,
    MIN_SOURCE_MESSAGES,
    buildDiaryDecisionPrompt,
    handleTenantDiaryUpdate,
    parseDiaryDecision,
    scheduleDiaryUpdate
};
