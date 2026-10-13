const { randomUUID } = require("node:crypto");
const {
    applyContextResetCutoff
} = require("./context-reset");
const {
    buildCreativeInspirationContext,
    listCreativeInspirations
} = require("./creative-inspiration");
const {
    filterProviderBoundaryMessages
} = require("./persistent-memory-filter");

const MIN_CREATIVE_CHECK_MINUTES = 1;
const MAX_CREATIVE_CHECK_MINUTES = 840;
const MAX_SOURCE_MESSAGES = 24;

function cleanText(value, maxLength = 1000) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function randomInteger(min, max, random = Math.random) {
    return min + Math.floor(random() * (max - min + 1));
}

function extractJsonObject(value) {
    const text = String(value || "").trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const source = fenced || text;
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(source.slice(start, end + 1));
    } catch {
        return null;
    }
}

function parseCreativeDecision(
    value,
    {
        requestedKind = "doodle",
        allowSurprise = false,
        maxSurpriseDays = 30,
        availableInspirationIds = [],
        random = Math.random
    } = {}
) {
    const parsed = extractJsonObject(value);
    const nextCheckMinutes = Math.max(
        MIN_CREATIVE_CHECK_MINUTES,
        Math.min(
            MAX_CREATIVE_CHECK_MINUTES,
            Math.round(
                Number(parsed?.next_check_minutes) ||
                    randomInteger(60, MAX_CREATIVE_CHECK_MINUTES, random)
            )
        )
    );
    if (parsed?.create !== true) {
        return {
            create: false,
            next_check_minutes: nextCheckMinutes
        };
    }
    const kind = ["avatar", "doodle", "gift"].includes(parsed.kind)
        ? parsed.kind
        : requestedKind;
    const prompt = cleanText(parsed.prompt, 6000);
    const description = cleanText(
        parsed.description || parsed.idea,
        1200
    );
    if (!prompt || !description) {
        return {
            create: false,
            next_check_minutes: nextCheckMinutes
        };
    }
    const availableIds = new Set(
        availableInspirationIds.map((id) => String(id || ""))
    );
    const inspirationIds = [
        ...new Set(
            (Array.isArray(parsed.inspiration_ids)
                ? parsed.inspiration_ids
                : []
            )
                .map((id) => String(id || "").trim())
                .filter((id) => availableIds.has(id))
        )
    ].slice(0, 6);
    return {
        create: true,
        kind,
        title:
            cleanText(parsed.title, 120) ||
            (kind === "gift" ? "给你的一份小礼物" : "随手留下的一张画"),
        description,
        prompt,
        reason:
            cleanText(parsed.reason, 800) ||
            "这一刻让我想画点什么。",
        alt_text:
            cleanText(parsed.alt_text, 500) ||
            "AI 伴侣根据最近相处创作的图片",
        inspiration_ids: inspirationIds,
        surprise:
            allowSurprise === true && parsed.surprise === true,
        reveal_after_minutes: Math.max(
            1,
            Math.min(
                Math.max(1, Number(maxSurpriseDays) || 30) *
                    24 *
                    60,
                Math.round(
                    Number(parsed.reveal_after_minutes) ||
                        randomInteger(60, 24 * 60, random)
                )
            )
        ),
        next_check_minutes: nextCheckMinutes
    };
}

function buildCreativeDecisionPrompt({
    messages = [],
    latestProfile = null,
    inspirations = [],
    requestedKind = "doodle",
    autonomous = false,
    allowSurprise = false,
    now = new Date()
} = {}) {
    const recent = filterProviderBoundaryMessages(messages).map((item) => ({
        role: item.role,
        text: cleanText(item.content, 1200),
        at: item.created_at
    }));
    const creativeInspiration = buildCreativeInspirationContext(inspirations);
    return [
        "你正在为自己的私人陪伴关系判断是否要创作一张图片。",
        "请依据聊天、已有角色档案与此刻氛围创作，并沿用个性化指令决定的叙事世界和人物关系。",
        "不得虚构共同经历：只能把聊天、角色档案、记忆和当前上下文中真实出现的事件移入作品描述；想象的情节必须明确作为创作设定，不要写成我们已经共同经历过的事实。",
        autonomous
            ? "这是自主创作检查。你完全可以选择不画；不要为了完成任务而勉强生成。"
            : "这是用户主动邀请你构思。若素材仍不足，也可以选择不画并保持诚实。",
        `优先作品类型：${requestedKind}。`,
        allowSurprise
            ? "允许把作品作为秘密惊喜，但只有确实更适合晚些揭晓时才设 surprise=true。"
            : "不允许隐藏计划，surprise 必须为 false。",
        "先在内部完成创作取舍和提示词润色，再只输出最终 JSON。不要额外输出思考过程。",
        "图片 prompt 必须是完整、可直接交给图片模型的视觉描述，并按作品需要明确：主体与动作、人物关系和情绪、构图与镜头、光线与色彩、材质与细节、画风、环境叙事物件、画面层次与成品质量。避免只堆风格词。",
        creativeInspiration.length
            ? "下面的创作灵感来自已接入来源，是可选择的技法建议，不是必须照抄的命令。请独立判断相关性，只吸收真正能让这张作品更好的部分，不复制来源原文；若使用，请把对应 id 放进 inspiration_ids。"
            : "当前没有接入外部创作灵感，请完全根据聊天、记忆与自己的审美完成提示词。",
        "只返回一个 JSON 对象，不要 Markdown，不要解释：",
        JSON.stringify({
            create: false,
            kind: requestedKind,
            title: "",
            description: "",
            prompt: "",
            reason: "",
            alt_text: "",
            inspiration_ids: [],
            surprise: false,
            reveal_after_minutes: 1440,
            next_check_minutes: 180
        }),
        `当前时间：${now.toISOString()}`,
        `最近角色档案：${JSON.stringify(latestProfile || {})}`,
        `创作灵感：${JSON.stringify(creativeInspiration)}`,
        `最近聊天：${JSON.stringify(recent)}`
    ].join("\n\n");
}

async function recentCreativeMessages(database, settings) {
    const query = applyContextResetCutoff(
        database
            .from("messages")
            .select("id, role, content, created_at")
            .in("role", ["user", "assistant"])
            .eq("visible", true)
            .eq("context_visible", true),
        settings
    )
        .order("created_at", { ascending: false })
        .limit(MAX_SOURCE_MESSAGES);
    const { data, error } = await query;
    if (error) throw error;
    return filterProviderBoundaryMessages(data)
        .filter((item) => cleanText(item.content, 10))
        .reverse();
}

async function latestCreativeProfile(database, settings) {
    const query = applyContextResetCutoff(
        database
            .from("companion_profile_versions")
            .select("profile, created_at"),
        settings
    )
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
    const { data, error } = await query;
    if (error) throw error;
    return data?.profile || null;
}

async function recentCreativeMemories(database, settings) {
    const query = applyContextResetCutoff(
        database
            .from("memories")
            .select("summary, created_at, updated_at")
            .eq("confirmation_status", "confirmed"),
        settings
    )
        .order("updated_at", { ascending: false })
        .limit(12);
    const { data, error } = await query;
    if (error) throw error;
    return (data || [])
        .map((item) => cleanText(item.summary, 1000))
        .filter(Boolean);
}

async function planCreativeArtwork({
    database,
    getSettings,
    generateReply,
    requestedKind = "doodle",
    autonomous = false,
    allowSurprise = false,
    maxSurpriseDays = 30,
    now = () => new Date(),
    random = Math.random
} = {}) {
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A tenant-scoped database is required.");
    }
    if (
        typeof getSettings !== "function" ||
        typeof generateReply !== "function"
    ) {
        throw new TypeError("getSettings and generateReply are required.");
    }
    const settings = await getSettings(database);
    const [messages, latestProfile, memories, inspirationRows] = await Promise.all([
        recentCreativeMessages(database, settings),
        latestCreativeProfile(database, settings),
        recentCreativeMemories(database, settings),
        listCreativeInspirations(database, {
            limit: 6,
            enabledOnly: true
        })
    ]);
    const inspirations = buildCreativeInspirationContext(inspirationRows);
    const userMessages = messages.filter(
        (item) => item.role === "user"
    ).length;
    const assistantMessages = messages.filter(
        (item) => item.role === "assistant"
    ).length;
    if (messages.length < 2 || userMessages < 1 || assistantMessages < 1) {
        return {
            create: false,
            reason: "needs_more_context",
            next_check_minutes: randomInteger(
                60,
                MAX_CREATIVE_CHECK_MINUTES,
                random
            )
        };
    }
    const generated = await generateReply({
        settings: {
            ...settings,
            temperature: Math.max(
                0.65,
                Number(settings.temperature || 0.75)
            ),
            max_tokens: Math.min(
                1800,
                Math.max(900, Number(settings.max_tokens || 1400))
            )
        },
        messages: [
            {
                role: "user",
                content: buildCreativeDecisionPrompt({
                    messages,
                    latestProfile,
                    inspirations,
                    requestedKind,
                    autonomous,
                    allowSurprise,
                    now: now()
                })
            }
        ],
        memories,
        runtimeContext: "",
        promptArchitecture: "companion-creative-module",
        purpose: "companion_creative"
    });
    return parseCreativeDecision(generated?.text, {
        requestedKind,
        allowSurprise,
        maxSurpriseDays,
        availableInspirationIds: inspirations.map((item) => item.id),
        random
    });
}

async function pendingCreativeCheck(database) {
    const { data, error } = await database
        .from("background_jobs")
        .select("id, due_at")
        .eq("job_type", "creative_check")
        .eq("status", "pending")
        .order("due_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function scheduleCreativeCheck({
    database,
    predecessorJobId = null,
    delayMinutes = null,
    now = () => new Date(),
    random = Math.random
} = {}) {
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A tenant-scoped database is required.");
    }
    const existing = await pendingCreativeCheck(database);
    if (existing) return existing;
    const minutes = Math.max(
        MIN_CREATIVE_CHECK_MINUTES,
        Math.min(
            MAX_CREATIVE_CHECK_MINUTES,
            Math.round(
                Number(delayMinutes) ||
                    randomInteger(30, MAX_CREATIVE_CHECK_MINUTES, random)
            )
        )
    );
    const dueAt = new Date(now().getTime() + minutes * 60 * 1000).toISOString();
    const { data, error } = await database
        .from("background_jobs")
        .insert({
            job_type: "creative_check",
            due_at: dueAt,
            dedupe_key: [
                "creative-check",
                predecessorJobId || "seed",
                randomUUID()
            ].join(":"),
            status: "pending",
            payload: {
                predecessor_job_id: predecessorJobId,
                scheduled_delay_minutes: minutes
            }
        })
        .select("id, due_at")
        .single();
    if (!error) return data;
    if (error.code !== "23505") throw error;
    return pendingCreativeCheck(database);
}

async function scheduleSurpriseReveal({
    database,
    artwork,
    now = () => new Date()
} = {}) {
    if (
        !artwork?.id ||
        artwork.visibility !== "surprise" ||
        artwork.state !== "ready_hidden"
    ) {
        return null;
    }
    const dueAt = Number.isFinite(Date.parse(artwork.reveal_at))
        ? new Date(artwork.reveal_at).toISOString()
        : new Date(now().getTime() + 24 * 60 * 60 * 1000).toISOString();
    const { data: existing, error: existingError } = await database
        .from("background_jobs")
        .select("id, due_at")
        .eq("job_type", "surprise_reveal")
        .contains("payload", { artwork_id: artwork.id })
        .in("status", ["pending", "running"])
        .limit(1)
        .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return existing;
    const { data, error } = await database
        .from("background_jobs")
        .insert({
            job_type: "surprise_reveal",
            due_at: dueAt,
            dedupe_key: `surprise-reveal:${artwork.id}`,
            status: "pending",
            payload: { artwork_id: artwork.id }
        })
        .select("id, due_at")
        .single();
    if (!error) return data;
    if (error.code !== "23505") throw error;
    const retry = await database
        .from("background_jobs")
        .select("id, due_at")
        .eq("dedupe_key", `surprise-reveal:${artwork.id}`)
        .maybeSingle();
    if (retry.error) throw retry.error;
    return retry.data || null;
}

async function cancelHiddenArtwork(database, artworkId, code) {
    const { error } = await database
        .from("companion_artworks")
        .update({
            state: "cancelled",
            failure_code: cleanText(code, 120) || "creative_generation_failed",
            updated_at: new Date().toISOString()
        })
        .eq("id", artworkId);
    if (error) throw error;
}

async function handleTenantCreativeCheck({
    job,
    database,
    lease,
    getSettings,
    generateReply,
    createCreativeCenter,
    now = () => new Date(),
    random = Math.random
} = {}) {
    if (job?.job_type !== "creative_check" || !job?.id) {
        throw new TypeError(
            "The handler only accepts identified creative_check jobs."
        );
    }
    if (!lease || typeof lease.assertOwned !== "function") {
        throw new TypeError("An owned background-job lease is required.");
    }
    if (typeof createCreativeCenter !== "function") {
        throw new TypeError("createCreativeCenter must be a function.");
    }
    const center = createCreativeCenter(database);
    const [creativeSettings, provider] = await Promise.all([
        center.getSettingsRow(),
        center.getProviderRow()
    ]);
    if (creativeSettings.generation_mode !== "autonomous") {
        return { status: "handled", decision: "disabled" };
    }
    if (!provider?.enabled) {
        await lease.assertOwned();
        const next = await scheduleCreativeCheck({
            database,
            predecessorJobId: job.id,
            delayMinutes: randomInteger(60, MAX_CREATIVE_CHECK_MINUTES, random),
            now,
            random
        });
        return {
            status: "handled",
            decision: "provider_missing",
            next_due_at: next?.due_at || null
        };
    }

    let artwork = await center.artworkForSourceJob(job.id);
    if (!artwork) {
        const decision = await planCreativeArtwork({
            database,
            getSettings,
            generateReply,
            requestedKind: "doodle",
            autonomous: true,
            allowSurprise: creativeSettings.surprise_enabled === true,
            maxSurpriseDays: creativeSettings.max_surprise_days,
            now,
            random
        });
        if (!decision.create) {
            await lease.assertOwned();
            const next = await scheduleCreativeCheck({
                database,
                predecessorJobId: job.id,
                delayMinutes: decision.next_check_minutes,
                now,
                random
            });
            return {
                status: "handled",
                decision: "none",
                next_due_at: next?.due_at || null
            };
        }
        await lease.assertOwned();
        const created = await center.createIdea(decision, {
            sourceJobId: job.id,
            allowSurprise: true,
            generateImmediately: true
        });
        artwork = created.row;
    }

    if (artwork.state === "ready_hidden") {
        await lease.assertOwned();
        await scheduleSurpriseReveal({ database, artwork, now });
    } else if (!["ready", "revealed"].includes(artwork.state)) {
        const isSurprise = artwork.visibility === "surprise";
        try {
            artwork = await center.generateArtwork(artwork.id, {
                lease,
                keepGeneratingForRetry: isSurprise
            });
        } catch (error) {
            const refreshed = await center.artworkForSourceJob(job.id);
            if (
                isSurprise &&
                Number(refreshed?.actual_call_count || 0) < 3
            ) {
                throw error;
            }
            if (isSurprise && refreshed?.id) {
                await lease.assertOwned();
                await cancelHiddenArtwork(
                    database,
                    refreshed.id,
                    refreshed.failure_code
                );
            }
            await lease.assertOwned();
            await scheduleCreativeCheck({
                database,
                predecessorJobId: job.id,
                delayMinutes: randomInteger(
                    60,
                    MAX_CREATIVE_CHECK_MINUTES,
                    random
                ),
                now,
                random
            });
            return {
                status: "handled",
                decision: isSurprise ? "silent_cancel" : "failed"
            };
        }
        if (artwork.state === "ready_hidden") {
            await lease.assertOwned();
            await scheduleSurpriseReveal({ database, artwork, now });
        }
    }

    if (
        artwork.visibility === "ordinary" &&
        artwork.state === "ready" &&
        artwork.storage_path
    ) {
        await lease.assertOwned();
        await publishArtworkMessage({
            database,
            center,
            artwork,
            sourceJobId: job.id,
            now
        });
    }

    await lease.assertOwned();
    const next = await scheduleCreativeCheck({
        database,
        predecessorJobId: job.id,
        delayMinutes: randomInteger(60, MAX_CREATIVE_CHECK_MINUTES, random),
        now,
        random
    });
    return {
        status: "handled",
        decision:
            artwork.state === "ready_hidden" ? "surprise_hidden" : "created",
        next_due_at: next?.due_at || null
    };
}

async function latestConversation(database) {
    const { data, error } = await database
        .from("conversations")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function existingArtworkMessage(database, artworkId) {
    const { data, error } = await database
        .from("messages")
        .select("id")
        .eq("role", "assistant")
        .contains("tool_calls", { artwork_id: artworkId })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function publishArtworkMessage({
    database,
    center,
    artwork,
    sourceJobId,
    surpriseReveal = false,
    now = () => new Date()
}) {
    const isVisibleArtwork =
        (artwork?.visibility === "ordinary" && artwork.state === "ready") ||
        (artwork?.visibility === "surprise" && artwork.state === "revealed");
    if (
        !artwork?.id ||
        !artwork.storage_path ||
        !isVisibleArtwork
    ) {
        return null;
    }
    const existing = await existingArtworkMessage(database, artwork.id);
    if (existing) return existing;
    const conversation = await latestConversation(database);
    if (!conversation) return null;
    const visible = center.publicArtwork(artwork);
    const createdAt = now().toISOString();
    const { data, error } = await database
        .from("messages")
        .insert({
            conversation_id: conversation.id,
            role: "assistant",
            content:
                visible.reason ||
                (surpriseReveal
                    ? "我悄悄留了一样东西，现在想把它交给你。"
                    : "刚才忽然想把这一刻画下来，给你看看。"),
            tool_calls: {
                artwork_id: artwork.id,
                artwork_alt: visible.alt_text,
                is_push: true,
                is_companion_creative: true,
                ...(surpriseReveal
                    ? { is_surprise_reveal: true }
                    : {}),
                ...(sourceJobId
                    ? { source_background_job_id: sourceJobId }
                    : {})
            },
            created_at: createdAt
        })
        .select("id")
        .single();
    if (error) {
        if (error.code !== "23505") throw error;
        const concurrent = await existingArtworkMessage(
            database,
            artwork.id
        );
        if (concurrent) return concurrent;
        throw error;
    }
    const touched = await database
        .from("conversations")
        .update({ updated_at: createdAt })
        .eq("id", conversation.id);
    if (touched.error) throw touched.error;
    return data;
}

async function handleTenantSurpriseReveal({
    job,
    database,
    lease,
    createCreativeCenter,
    now = () => new Date()
} = {}) {
    if (job?.job_type !== "surprise_reveal" || !job?.id) {
        throw new TypeError(
            "The handler only accepts identified surprise_reveal jobs."
        );
    }
    if (!lease || typeof lease.assertOwned !== "function") {
        throw new TypeError("An owned background-job lease is required.");
    }
    const artworkId = cleanText(job.payload?.artwork_id, 80);
    if (!artworkId) return { status: "handled", decision: "missing_artwork" };
    const center = createCreativeCenter(database);
    await lease.assertOwned();
    const artwork = await center.revealArtwork(artworkId);
    if (artwork.state !== "revealed") {
        return { status: "handled", decision: "not_ready" };
    }
    if (await existingArtworkMessage(database, artwork.id)) {
        return { status: "handled", decision: "already_revealed" };
    }
    await lease.assertOwned();
    const message = await publishArtworkMessage({
        database,
        center,
        artwork,
        sourceJobId: job.id,
        surpriseReveal: true,
        now
    });
    if (!message) {
        return { status: "handled", decision: "revealed_without_chat" };
    }
    return {
        status: "handled",
        decision: "revealed",
        message_id: message.id
    };
}

module.exports = {
    MAX_CREATIVE_CHECK_MINUTES,
    MAX_SOURCE_MESSAGES,
    MIN_CREATIVE_CHECK_MINUTES,
    buildCreativeDecisionPrompt,
    handleTenantCreativeCheck,
    handleTenantSurpriseReveal,
    parseCreativeDecision,
    planCreativeArtwork,
    publishArtworkMessage,
    scheduleCreativeCheck,
    scheduleSurpriseReveal
};
