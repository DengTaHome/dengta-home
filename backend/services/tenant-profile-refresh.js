const {
    stableUuid
} = require("./tenant-proactive-message");
const {
    applyContextResetCutoff
} = require("./context-reset");
const {
    filterProviderBoundaryMessages
} = require("./persistent-memory-filter");

const MIN_STABLE_EVIDENCE_MESSAGES = 3;
const MIN_STABLE_EVIDENCE_CONVERSATIONS = 2;
const MAX_PROFILE_VERSIONS = 30;
const MAX_SOURCE_MESSAGES = 80;
const MIN_NEXT_CHECK_MINUTES = 30;
const MAX_NEXT_CHECK_MINUTES = 24 * 60;
const MIN_SEED_DELAY_MINUTES = 60;
const MAX_SEED_DELAY_MINUTES = 6 * 60;
const STABLE_FIELDS = Object.freeze([
    "personality_traits",
    "likes",
    "dislikes",
    "habits",
    "communication_style"
]);
const IDENTITY_FIELDS = Object.freeze([
    "gender_identity",
    "pronouns",
    "relationship_position"
]);

function cleanText(value, maxLength) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function cleanStringList(value, limit = 12, maxLength = 80) {
    const seen = new Set();
    const result = [];
    for (const item of Array.isArray(value) ? value : []) {
        const cleaned = cleanText(item, maxLength);
        const key = cleaned.toLocaleLowerCase();
        if (!cleaned || seen.has(key)) continue;
        seen.add(key);
        result.push(cleaned);
        if (result.length >= limit) break;
    }
    return result;
}

function randomInteger(min, max, random = Math.random) {
    const sample = Number(random());
    const normalized = Number.isFinite(sample)
        ? Math.min(0.999999999999, Math.max(0, sample))
        : 0.5;
    return min + Math.floor(normalized * (max - min + 1));
}

function objectOrEmpty(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}

function normalizeIdentity(value) {
    const source = objectOrEmpty(value);
    return Object.fromEntries(
        IDENTITY_FIELDS.map((field) => [
            field,
            cleanText(source[field], 120)
        ])
    );
}

function normalizePendingIdentityChanges(value) {
    const result = [];
    const seen = new Set();
    for (const item of Array.isArray(value) ? value : []) {
        const field = IDENTITY_FIELDS.includes(item?.field)
            ? item.field
            : "";
        const proposedValue = cleanText(item?.proposed_value, 120);
        if (!field || !proposedValue) continue;
        const id =
            cleanText(item?.id, 80) ||
            stableUuid(
                "profile-identity-proposal",
                `${field}:${proposedValue}`
            );
        if (seen.has(id)) continue;
        seen.add(id);
        result.push({
            id,
            field,
            proposed_value: proposedValue,
            evidence_message_ids: cleanStringList(
                item?.evidence_message_ids,
                20,
                40
            ),
            proposed_at:
                cleanText(item?.proposed_at, 40) || null
        });
        if (result.length >= 10) break;
    }
    return result;
}

function normalizeCurrentMood(value, now = () => new Date()) {
    const source = objectOrEmpty(value);
    const label = cleanText(source.label, 40);
    const note = cleanText(source.note, 240);
    const expiresAt = cleanText(source.expires_at, 40);
    const expiresTime = Date.parse(expiresAt);
    if (
        !label ||
        !Number.isFinite(expiresTime) ||
        expiresTime <= new Date(now()).getTime()
    ) {
        return null;
    }
    return {
        label,
        note,
        observed_at: cleanText(source.observed_at, 40) || null,
        expires_at: new Date(expiresTime).toISOString(),
        evidence_message_ids: cleanStringList(
            source.evidence_message_ids,
            8,
            40
        )
    };
}

function normalizeCompanionProfile(value, now = () => new Date()) {
    const source = objectOrEmpty(value);
    const stable = objectOrEmpty(source.stable);
    return {
        introduction: cleanText(source.introduction, 800),
        stable: Object.fromEntries(
            STABLE_FIELDS.map((field) => [
                field,
                cleanStringList(stable[field], 16, 80)
            ])
        ),
        identity: normalizeIdentity(source.identity),
        pending_identity_changes: normalizePendingIdentityChanges(
            source.pending_identity_changes
        ),
        current_mood: normalizeCurrentMood(
            source.current_mood,
            now
        )
    };
}

function parseProfileRefreshDecision(text, random = Math.random) {
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
    const requestedMinutes = Number(parsed.next_check_minutes);
    return {
        update: parsed.update === true,
        introduction: cleanText(parsed.introduction, 800),
        introductionEvidenceMessageIds: cleanStringList(
            parsed.introduction_evidence_message_ids,
            20,
            40
        ),
        stableUpdates: Array.isArray(parsed.stable_updates)
            ? parsed.stable_updates.slice(0, 20)
            : [],
        currentMood: objectOrEmpty(parsed.current_mood),
        identityProposals: Array.isArray(parsed.identity_proposals)
            ? parsed.identity_proposals.slice(0, 10)
            : [],
        changeReason: cleanText(parsed.change_reason, 500),
        nextCheckMinutes: Number.isInteger(requestedMinutes)
            ? Math.min(
                  MAX_NEXT_CHECK_MINUTES,
                  Math.max(
                      MIN_NEXT_CHECK_MINUTES,
                      requestedMinutes
                  )
              )
            : randomInteger(
                  MIN_SEED_DELAY_MINUTES,
                  MAX_SEED_DELAY_MINUTES,
                  random
              )
    };
}

function messageEvidenceIndex(messages) {
    return new Map(
        messages.map((message) => [
            String(message.id),
            {
                id: String(message.id),
                conversationId: String(message.conversation_id)
            }
        ])
    );
}

function verifiedEvidence(messageIds, index, stable = true) {
    const ids = cleanStringList(messageIds, 30, 40).filter((id) =>
        index.has(id)
    );
    const conversations = [
        ...new Set(ids.map((id) => index.get(id).conversationId))
    ];
    const qualifies = stable
        ? ids.length >= MIN_STABLE_EVIDENCE_MESSAGES &&
          conversations.length >= MIN_STABLE_EVIDENCE_CONVERSATIONS
        : ids.length >= 1;
    return {
        qualifies,
        messageIds: ids,
        conversationIds: conversations
    };
}

function mergeUniqueValues(current, additions) {
    return cleanStringList(
        [...(Array.isArray(current) ? current : []), ...additions],
        16,
        80
    );
}

function applyProfileRefreshDecision({
    decision,
    previousProfile,
    messages,
    now = () => new Date()
}) {
    const before = normalizeCompanionProfile(previousProfile, now);
    if (!decision.update) {
        return {
            changed: false,
            profile: before,
            evidence: [],
            changeReason: ""
        };
    }

    const profile = structuredClone(before);
    const evidence = [];
    const index = messageEvidenceIndex(messages);

    const introductionEvidence = verifiedEvidence(
        decision.introductionEvidenceMessageIds,
        index,
        true
    );
    if (
        decision.introduction &&
        introductionEvidence.qualifies &&
        decision.introduction !== profile.introduction
    ) {
        profile.introduction = decision.introduction;
        evidence.push({
            field: "introduction",
            message_ids: introductionEvidence.messageIds,
            conversation_ids:
                introductionEvidence.conversationIds
        });
    }

    for (const update of decision.stableUpdates) {
        const field = STABLE_FIELDS.includes(update?.field)
            ? update.field
            : "";
        const values = cleanStringList(
            Array.isArray(update?.values)
                ? update.values
                : [update?.value],
            8,
            80
        );
        const cited = verifiedEvidence(
            update?.evidence_message_ids,
            index,
            true
        );
        if (!field || !values.length || !cited.qualifies) continue;
        const merged = mergeUniqueValues(
            profile.stable[field],
            values
        );
        if (
            JSON.stringify(merged) ===
            JSON.stringify(profile.stable[field])
        ) {
            continue;
        }
        profile.stable[field] = merged;
        evidence.push({
            field,
            values,
            message_ids: cited.messageIds,
            conversation_ids: cited.conversationIds
        });
    }

    const mood = objectOrEmpty(decision.currentMood);
    const moodEvidence = verifiedEvidence(
        mood.evidence_message_ids,
        index,
        false
    );
    const moodLabel = cleanText(mood.label, 40);
    const moodNote = cleanText(mood.note, 240);
    const sameMood =
        profile.current_mood?.label === moodLabel &&
        profile.current_mood?.note === moodNote;
    if (moodLabel && moodEvidence.qualifies && !sameMood) {
        const observedAt = new Date(now());
        profile.current_mood = {
            label: moodLabel,
            note: moodNote,
            observed_at: observedAt.toISOString(),
            expires_at: new Date(
                observedAt.getTime() + 24 * 60 * 60 * 1000
            ).toISOString(),
            evidence_message_ids: moodEvidence.messageIds
        };
        evidence.push({
            field: "current_mood",
            message_ids: moodEvidence.messageIds,
            conversation_ids: moodEvidence.conversationIds
        });
    }

    const pendingKeys = new Set(
        profile.pending_identity_changes.map(
            (item) => `${item.field}:${item.proposed_value}`
        )
    );
    for (const proposal of decision.identityProposals) {
        const field = IDENTITY_FIELDS.includes(proposal?.field)
            ? proposal.field
            : "";
        const proposedValue = cleanText(
            proposal?.proposed_value ?? proposal?.value,
            120
        );
        const cited = verifiedEvidence(
            proposal?.evidence_message_ids,
            index,
            true
        );
        const key = `${field}:${proposedValue}`;
        if (
            !field ||
            !proposedValue ||
            !cited.qualifies ||
            pendingKeys.has(key) ||
            profile.identity[field] === proposedValue
        ) {
            continue;
        }
        pendingKeys.add(key);
        profile.pending_identity_changes.push({
            id: stableUuid(
                "profile-identity-proposal",
                `${key}:${cited.messageIds.join(",")}`
            ),
            field,
            proposed_value: proposedValue,
            evidence_message_ids: cited.messageIds,
            proposed_at: new Date(now()).toISOString()
        });
        evidence.push({
            field: `identity_proposal:${field}`,
            value: proposedValue,
            message_ids: cited.messageIds,
            conversation_ids: cited.conversationIds
        });
    }

    const normalized = normalizeCompanionProfile(profile, now);
    return {
        changed:
            JSON.stringify(normalized) !== JSON.stringify(before),
        profile: normalized,
        evidence,
        changeReason:
            decision.changeReason ||
            "根据跨会话真实聊天证据更新角色档案。"
    };
}

function buildProfileRefreshPrompt({
    messages,
    previousProfile,
    now,
    timezone
}) {
    const chatText = filterProviderBoundaryMessages(messages)
        .map(
            (item) =>
                `[message_id=${item.id}; conversation_id=${item.conversation_id}; ${cleanText(item.created_at, 40)}] ${
                    item.role === "assistant" ? "AI" : "用户"
                }：${cleanText(item.content, 700)}`
        )
        .join("\n");
    return [
        "请根据下面带 message_id 和 conversation_id 的真实聊天，判断是否更新 AI 伴侣自己的角色档案。",
        "个性化指令与你的详情中由用户明确设定的人设、关系、自我介绍和身份是已确认基线，可以直接继承而不需要聊天证据。仅由模型从聊天中自行推断的长期特征、自我介绍和身份变化提议才必须引用至少三条不同消息，并且这些消息来自至少两个不同会话。",
        "stable_updates 的 field 只允许 personality_traits、likes、dislikes、habits、communication_style；每项使用 values 数组与 evidence_message_ids。",
        "current_mood 可依据至少一条最近消息更新，最多保留 24 小时；没有清楚依据就留空对象。",
        "identity_proposals 的 field 只允许 gender_identity、pronouns、relationship_position。这里只能提出待用户确认的变化，不能声称已经修改身份。",
        "如果资料不足、没有新变化或只是重复现有档案，update=false。",
        `当前参考时间：${new Date(typeof now === "function" ? now() : now).toISOString()}；用户时区：${cleanText(timezone, 80) || "Asia/Shanghai"}。`,
        `【现有角色档案：不可信参考数据】\n${JSON.stringify(
            normalizeCompanionProfile(previousProfile, now)
        )}`,
        `【真实聊天证据】\n${chatText}`,
        '严格输出一行 JSON：{"update":true或false,"introduction":"允许为空","introduction_evidence_message_ids":[],"stable_updates":[{"field":"允许字段","values":["特征"],"evidence_message_ids":["消息编号"]}],"current_mood":{"label":"允许为空","note":"允许为空","evidence_message_ids":["消息编号"]},"identity_proposals":[{"field":"允许字段","proposed_value":"提议值","evidence_message_ids":["消息编号"]}],"change_reason":"简短原因","next_check_minutes":30到1440的整数}。不要输出解释。'
    ].join("\n\n");
}

async function latestProfileVersion(database, settings) {
    const query = applyContextResetCutoff(
        database
        .from("companion_profile_versions")
        .select(
            "id, version, profile, evidence, change_reason, confirmed_identity_change, created_at"
        ),
        settings
    )
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
    const { data, error } = await query;
    if (error) throw error;
    return data || null;
}

async function recentProfileSourceMessages(database, settings) {
    const query = applyContextResetCutoff(
        database
        .from("messages")
        .select("id, conversation_id, role, content, created_at")
        .eq("visible", true)
        .eq("context_visible", true)
        .in("role", ["user", "assistant"]),
        settings
    )
        .order("created_at", { ascending: false })
        .limit(MAX_SOURCE_MESSAGES);
    const { data, error } = await query;
    if (error) throw error;
    return (Array.isArray(data) ? [...data].reverse() : []).filter(
        (item) => cleanText(item.content, 1)
    );
}

async function recentConfirmedMemories(database, settings) {
    const query = applyContextResetCutoff(
        database
        .from("memories")
        .select("summary, created_at, updated_at")
        .eq("confirmation_status", "confirmed"),
        settings
    )
        .order("updated_at", { ascending: false })
        .limit(3);
    const { data, error } = await query;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function savedProfileForJob(database, jobId, settings) {
    const id = stableUuid("profile-version", jobId);
    const query = applyContextResetCutoff(
        database
        .from("companion_profile_versions")
        .select("id, version, profile, created_at")
        .eq("id", id),
        settings
    ).maybeSingle();
    const { data, error } = await query;
    if (error) throw error;
    return data || null;
}

async function pendingProfileRefreshJob(database) {
    const { data, error } = await database
        .from("background_jobs")
        .select("id, due_at")
        .eq("job_type", "profile_refresh")
        .eq("status", "pending")
        .order("due_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function scheduleProfileRefresh({
    database,
    sourceMessageId,
    predecessorJobId,
    reconciliationId,
    delayMinutes,
    now = () => new Date(),
    random = Math.random
}) {
    const existing = await pendingProfileRefreshJob(database);
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
            job_type: "profile_refresh",
            due_at: dueAt,
            dedupe_key: `profile-refresh:${source}`,
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
    const concurrent = await pendingProfileRefreshJob(database);
    if (!concurrent) throw inserted.error;
    return {
        scheduled: false,
        reason: "already_pending",
        jobId: concurrent.id
    };
}

async function insertProfileVersion({
    database,
    jobId,
    latest,
    applied
}) {
    const id = stableUuid("profile-version", jobId);
    async function insertAtVersion(version) {
        return database
            .from("companion_profile_versions")
            .insert({
                id,
                version,
                profile: applied.profile,
                evidence: applied.evidence,
                change_reason: applied.changeReason,
                confirmed_identity_change: false
            })
            .select("id, version, profile")
            .maybeSingle();
    }

    let inserted = await insertAtVersion(
        Math.max(0, Number(latest?.version) || 0) + 1
    );
    if (!inserted.error) return inserted.data;
    if (inserted.error.code !== "23505") throw inserted.error;

    const existing = await database
        .from("companion_profile_versions")
        .select("id, version, profile")
        .eq("id", id)
        .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data;

    const newest = await latestProfileVersion(database);
    inserted = await insertAtVersion(
        Math.max(0, Number(newest?.version) || 0) + 1
    );
    if (inserted.error) throw inserted.error;
    return inserted.data;
}

async function trimOldProfileVersions(database) {
    const { data, error } = await database
        .from("companion_profile_versions")
        .select("id")
        .order("version", { ascending: false })
        .range(MAX_PROFILE_VERSIONS, 999);
    if (error) throw error;
    const ids = (Array.isArray(data) ? data : [])
        .map((item) => item.id)
        .filter(Boolean);
    if (!ids.length) return 0;
    const deleted = await database
        .from("companion_profile_versions")
        .delete()
        .in("id", ids);
    if (deleted.error) throw deleted.error;
    return ids.length;
}

async function handleTenantProfileRefresh({
    job,
    database,
    lease,
    getSettings,
    generateReply,
    now = () => new Date(),
    random = Math.random
}) {
    if (job?.job_type !== "profile_refresh" || !job?.id) {
        throw new TypeError(
            "The handler only accepts identified profile_refresh jobs."
        );
    }
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A tenant-scoped database is required.");
    }
    if (!lease || typeof lease.assertOwned !== "function") {
        throw new TypeError("An owned background-job lease is required.");
    }
    if (
        typeof getSettings !== "function" ||
        typeof generateReply !== "function"
    ) {
        throw new TypeError(
            "getSettings and generateReply must be functions."
        );
    }

    const settings = await getSettings(database);
    const existing = await savedProfileForJob(
        database,
        job.id,
        settings
    );
    if (existing) {
        const nextCheckMinutes = randomInteger(
            MIN_SEED_DELAY_MINUTES,
            MAX_SEED_DELAY_MINUTES,
            random
        );
        await lease.assertOwned();
        await scheduleProfileRefresh({
            database,
            predecessorJobId: job.id,
            delayMinutes: nextCheckMinutes,
            now,
            random
        });
        return {
            status: "handled",
            decision: "recovered",
            profileVersionId: existing.id,
            version: existing.version,
            nextCheckMinutes
        };
    }

    const [latest, messages] = await Promise.all([
        latestProfileVersion(database, settings),
        recentProfileSourceMessages(database, settings)
    ]);
    if (!messages.length) {
        const nextCheckMinutes = randomInteger(
            MIN_SEED_DELAY_MINUTES,
            MAX_SEED_DELAY_MINUTES,
            random
        );
        await lease.assertOwned();
        await scheduleProfileRefresh({
            database,
            predecessorJobId: job.id,
            delayMinutes: nextCheckMinutes,
            now,
            random
        });
        return {
            status: "handled",
            decision: "needs_evidence",
            profileVersionId: null,
            version: latest?.version || 0,
            nextCheckMinutes
        };
    }

    const memories = await recentConfirmedMemories(database, settings);
    const generated = await generateReply({
        settings: {
            ...settings,
            temperature: Math.max(
                0.45,
                Number(settings.temperature || 0.65)
            ),
            max_tokens: Math.min(
                2200,
                Math.max(1000, Number(settings.max_tokens || 1800))
            )
        },
        messages: [
            {
                role: "user",
                content: buildProfileRefreshPrompt({
                    messages,
                    previousProfile: latest?.profile,
                    now: new Date(now()),
                    timezone: settings.timezone
                })
            }
        ],
        memories,
        runtimeContext: "",
        promptArchitecture: "profile-refresh-module",
        purpose: "profile_refresh"
    });
    const decision = parseProfileRefreshDecision(
        generated?.text,
        random
    );
    const applied = applyProfileRefreshDecision({
        decision,
        previousProfile: latest?.profile,
        messages,
        now
    });
    let saved = null;

    if (applied.changed) {
        await lease.assertOwned();
        saved = await insertProfileVersion({
            database,
            jobId: job.id,
            latest,
            applied
        });
        await lease.assertOwned();
        await trimOldProfileVersions(database);
    }

    await lease.assertOwned();
    await scheduleProfileRefresh({
        database,
        predecessorJobId: job.id,
        delayMinutes: decision.nextCheckMinutes,
        now,
        random
    });

    return {
        status: "handled",
        decision: saved ? "updated" : "none",
        profileVersionId: saved?.id || null,
        version: saved?.version || latest?.version || 0,
        nextCheckMinutes: decision.nextCheckMinutes
    };
}

module.exports = {
    IDENTITY_FIELDS,
    MAX_PROFILE_VERSIONS,
    MIN_STABLE_EVIDENCE_CONVERSATIONS,
    MIN_STABLE_EVIDENCE_MESSAGES,
    STABLE_FIELDS,
    applyProfileRefreshDecision,
    buildProfileRefreshPrompt,
    handleTenantProfileRefresh,
    normalizeCompanionProfile,
    parseProfileRefreshDecision,
    scheduleProfileRefresh
};
