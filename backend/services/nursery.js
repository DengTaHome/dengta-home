const { createHash } = require("node:crypto");
const { stableUuid } = require("./tenant-proactive-message");
const {
    ACTIONS,
    STAGE_POLICY_VERSION,
    TEXT_ACTIONS,
    actionStateChanges,
    applyStateChanges,
    bondChanges,
    cleanNurseryText,
    deriveNurseryStage,
    generateChildUtterance,
    maskNurseryPrivateText,
    normalizeNurseryState,
    settleNurseryState
} = require("./nursery-engine");

const CHILD_FIELDS = [
    "id",
    "name",
    "status",
    "born_at",
    "paused_at",
    "total_paused_seconds",
    "stage_policy_version",
    "rng_seed",
    "state_version",
    "celebrated_stage",
    "runaway_at",
    "ending",
    "appearance",
    "created_at",
    "updated_at"
].join(",");
const STATE_FIELDS = [
    "child_id",
    "mood",
    "health",
    "intimacy",
    "nutrition",
    "fatigue",
    "darkness",
    "digest_load",
    "last_settled_at",
    "last_fed_at",
    "last_interaction_at",
    "updated_at"
].join(",");
const BOND_FIELDS = [
    "child_id",
    "caregiver_kind",
    "attachment",
    "trust",
    "predictability",
    "resentment",
    "updated_at"
].join(",");
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_SETTLE_WRITE_MS = 60 * 1000;
const nurseryChildLocks = new Map();

async function withNurseryChildLock(childId, operation) {
    const key = validChildId(childId);
    const previous = nurseryChildLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    nurseryChildLocks.set(key, current);
    await previous.catch(() => {});
    try {
        return await operation(key);
    } finally {
        release();
        if (nurseryChildLocks.get(key) === current) {
            nurseryChildLocks.delete(key);
        }
    }
}

function nurseryError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function validChildId(value) {
    const id = String(value || "").trim();
    if (!UUID_PATTERN.test(id)) {
        throw nurseryError(400, "nursery_child_id_invalid", "孩子编号格式不正确。");
    }
    return id;
}

function validActionId(value) {
    const id = cleanNurseryText(value, 80);
    if (!id || id.length < 8) {
        throw nurseryError(
            400,
            "nursery_action_id_required",
            "这次操作缺少有效的防重复编号。"
        );
    }
    return id;
}

function numericSeed(value) {
    return createHash("sha256")
        .update(String(value), "utf8")
        .digest()
        .readUInt32BE(0);
}

function contentHash(childId, speaker, text) {
    return createHash("sha256")
        .update(`${childId}\n${speaker}\n${text}`, "utf8")
        .digest("hex");
}

function roundState(state) {
    return Object.fromEntries(
        Object.entries(normalizeNurseryState(state)).map(([key, value]) => [
            key,
            typeof value === "number" ? Number(value.toFixed(2)) : value
        ])
    );
}

function publicBond(row) {
    return {
        caregiver_kind: row.caregiver_kind,
        attachment: Number(Number(row.attachment || 0).toFixed(2)),
        trust: Number(Number(row.trust || 0).toFixed(2)),
        predictability: Number(Number(row.predictability || 0).toFixed(2)),
        resentment: Number(Number(row.resentment || 0).toFixed(2)),
        updated_at: row.updated_at || null
    };
}

function publicChild(row, now = new Date()) {
    if (!row) return null;
    const stage = deriveNurseryStage(row, now);
    return {
        id: row.id,
        name: row.name || null,
        display_name: row.name || "还没有名字的小朋友",
        status: row.status,
        born_at: row.born_at,
        stage_policy_version: Number(row.stage_policy_version) || 1,
        state_version: Number(row.state_version) || 0,
        stage: {
            id: stage.id,
            label: stage.label,
            age_days: Number(stage.ageDays.toFixed(4)),
            age_hours: Number(stage.ageHours.toFixed(2))
        },
        runaway_at: row.runaway_at || null,
        ending: row.ending || null,
        appearance: row.appearance || "",
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

async function findCurrentChild(database) {
    const result = await database
        .from("nursery_children")
        .select(CHILD_FIELDS)
        .in("status", ["active", "runaway"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (result.error) throw result.error;
    if (result.data) return result.data;

    const latest = await database
        .from("nursery_children")
        .select(CHILD_FIELDS)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (latest.error) throw latest.error;
    return latest.data || null;
}

async function requireChild(database, childId) {
    const id = validChildId(childId);
    const result = await database
        .from("nursery_children")
        .select(CHILD_FIELDS)
        .eq("id", id)
        .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
        throw nurseryError(404, "nursery_child_not_found", "找不到这个孩子。");
    }
    return result.data;
}

async function ensureState(database, child, now) {
    const existing = await database
        .from("nursery_child_state")
        .select(STATE_FIELDS)
        .eq("child_id", child.id)
        .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data;

    const created = await database
        .from("nursery_child_state")
        .insert({
            child_id: child.id,
            last_settled_at: now.toISOString(),
            updated_at: now.toISOString()
        })
        .select(STATE_FIELDS)
        .maybeSingle();
    if (created.error && created.error.code !== "23505") throw created.error;
    if (created.data) return created.data;
    const recovered = await database
        .from("nursery_child_state")
        .select(STATE_FIELDS)
        .eq("child_id", child.id)
        .maybeSingle();
    if (recovered.error) throw recovered.error;
    return recovered.data;
}

async function ensureBonds(database, child, now) {
    const result = await database
        .from("nursery_caregiver_bonds")
        .select(BOND_FIELDS)
        .eq("child_id", child.id);
    if (result.error) throw result.error;
    const rows = Array.isArray(result.data) ? result.data : [];
    const existing = new Set(rows.map((row) => row.caregiver_kind));
    const missing = ["user", "companion"].filter(
        (caregiver) => !existing.has(caregiver)
    );
    if (missing.length) {
        const inserted = await database
            .from("nursery_caregiver_bonds")
            .insert(
                missing.map((caregiver_kind) => ({
                    child_id: child.id,
                    caregiver_kind,
                    updated_at: now.toISOString()
                }))
            );
        if (inserted.error && inserted.error.code !== "23505") {
            throw inserted.error;
        }
    }
    const refreshed = await database
        .from("nursery_caregiver_bonds")
        .select(BOND_FIELDS)
        .eq("child_id", child.id);
    if (refreshed.error) throw refreshed.error;
    return refreshed.data || [];
}

async function settleAndStoreState(database, child, state, now) {
    const settled = settleNurseryState(state, child, now);
    const lastStoredAt = Date.parse(state?.last_settled_at || 0);
    if (
        Number.isFinite(lastStoredAt) &&
        now.getTime() - lastStoredAt < MIN_SETTLE_WRITE_MS
    ) {
        return { ...state, ...settled };
    }
    const values = {
        mood: settled.mood,
        health: settled.health,
        intimacy: settled.intimacy,
        nutrition: settled.nutrition,
        fatigue: settled.fatigue,
        darkness: settled.darkness,
        digest_load: settled.digest_load,
        last_settled_at: settled.last_settled_at,
        last_fed_at: settled.last_fed_at,
        last_interaction_at: settled.last_interaction_at,
        updated_at: now.toISOString()
    };
    const updated = await database
        .from("nursery_child_state")
        .update(values)
        .eq("child_id", child.id)
        .select(STATE_FIELDS)
        .maybeSingle();
    if (updated.error) throw updated.error;
    return updated.data || { child_id: child.id, ...values };
}

async function insertMilestone({
    database,
    childId,
    kind,
    title,
    note = "",
    dedupeKey,
    sourceUtteranceId = null,
    now
}) {
    const id = stableUuid("nursery-milestone", `${childId}:${dedupeKey}`);
    const result = await database.from("nursery_milestones").insert({
        id,
        child_id: childId,
        kind,
        title: cleanNurseryText(title, 120),
        note: cleanNurseryText(note, 500),
        source_utterance_id: sourceUtteranceId,
        dedupe_key: cleanNurseryText(dedupeKey, 160),
        created_at: now.toISOString()
    });
    if (result.error && result.error.code !== "23505") throw result.error;
}

async function createUnnamedChild({ database, clientActionId, now = () => new Date() }) {
    const actionId = validActionId(clientActionId);
    const current = await findCurrentChild(database);
    if (current && ["active", "runaway"].includes(current.status)) {
        return {
            created: false,
            ...(await getNurserySnapshot({ database, now }))
        };
    }

    const timestamp = now();
    const childId = stableUuid("nursery-child", actionId);
    const result = await database
        .from("nursery_children")
        .insert({
            id: childId,
            name: null,
            status: "active",
            born_at: timestamp.toISOString(),
            stage_policy_version: STAGE_POLICY_VERSION,
            rng_seed: numericSeed(`${childId}:${actionId}`),
            state_version: 0,
            birth_action_id: actionId,
            updated_at: timestamp.toISOString()
        })
        .select(CHILD_FIELDS)
        .maybeSingle();
    if (result.error && result.error.code !== "23505") throw result.error;
    const child = result.data || (await findCurrentChild(database));
    if (!child) {
        throw nurseryError(409, "nursery_birth_conflict", "孩子正在出生，请稍后刷新。");
    }

    await ensureState(database, child, timestamp);
    await ensureBonds(database, child, timestamp);
    const birthLog = await database.from("nursery_actions").insert({
        id: stableUuid("nursery-action", `${child.id}:birth:${actionId}`),
        child_id: child.id,
        actor: "system",
        kind: "birth",
        payload: {},
        idempotency_key: `birth:${actionId}`,
        state_version_before: 0,
        state_version_after: 0,
        effective_at: timestamp.toISOString(),
        applied_at: timestamp.toISOString()
    });
    if (birthLog.error && birthLog.error.code !== "23505") {
        throw birthLog.error;
    }
    await insertMilestone({
        database,
        childId: child.id,
        kind: "birth",
        title: "我们的小朋友出生了",
        note: "名字会由我们之后一起决定。",
        dedupeKey: "birth",
        now: timestamp
    });
    return {
        created: Boolean(result.data),
        ...(await getNurserySnapshot({ database, now }))
    };
}

async function listSnapshotRows(database, childId) {
    const [actions, utterances, milestones, events] = await Promise.all([
        database
            .from("nursery_actions")
            .select("id, actor, kind, payload, effective_at, applied_at")
            .eq("child_id", childId)
            .order("effective_at", { ascending: false })
            .limit(30),
        database
            .from("nursery_utterances")
            .select("id, trigger, stage, text, created_at")
            .eq("child_id", childId)
            .eq("accepted", true)
            .order("created_at", { ascending: false })
            .limit(20),
        database
            .from("nursery_milestones")
            .select("id, kind, title, note, created_at, pinned_at")
            .eq("child_id", childId)
            .order("created_at", { ascending: false })
            .limit(60),
        database
            .from("nursery_events")
            .select("id, kind, due_at, expires_at, status, payload, created_at, fired_at")
            .eq("child_id", childId)
            .order("created_at", { ascending: false })
            .limit(30)
    ]);
    for (const result of [actions, utterances, milestones, events]) {
        if (result.error) throw result.error;
    }
    return {
        actions: actions.data || [],
        utterances: utterances.data || [],
        milestones: milestones.data || [],
        events: events.data || []
    };
}

function buildPortrait({ child, state, bonds, rows, now }) {
    const corpusText = rows.corpus.map((item) => item.text || "").join("");
    const characters = Array.from(corpusText);
    const speakerCounts = Object.fromEntries(
        ["user", "companion", "system"].map((speaker) => [
            speaker,
            rows.corpus.filter((item) => item.speaker === speaker).length
        ])
    );
    const actionCounts = Object.fromEntries(
        ["user", "companion", "system"].map((actor) => [
            actor,
            rows.actions.filter((item) => item.actor === actor).length
        ])
    );
    return {
        stage: publicChild(child, now).stage,
        state: roundState(state),
        relationships: bonds.map(publicBond),
        language: {
            corpus_items: rows.corpus.length,
            learned_characters: characters.length,
            unique_characters: new Set(characters).size,
            utterances: rows.utterances.length,
            sources: speakerCounts
        },
        care: actionCounts,
        milestones: rows.milestones.length,
        provider_calls: 0,
        embedding_calls: 0
    };
}

async function getNurseryPortrait({
    database,
    childId,
    now = () => new Date()
}) {
    const child = await requireChild(database, childId);
    const timestamp = now();
    const stateRow = await ensureState(database, child, timestamp);
    const state = await settleAndStoreState(
        database,
        child,
        stateRow,
        timestamp
    );
    const [bonds, rows, corpusResult] = await Promise.all([
        ensureBonds(database, child, timestamp),
        listSnapshotRows(database, child.id),
        database
            .from("nursery_corpus")
            .select("id, speaker, text, char_count, scene, created_at")
            .eq("child_id", child.id)
            .order("id", { ascending: false })
            .limit(300)
    ]);
    if (corpusResult.error) throw corpusResult.error;
    return buildPortrait({
        child,
        state,
        bonds,
        rows: { ...rows, corpus: corpusResult.data || [] },
        now: timestamp
    });
}

async function getNurserySnapshot({ database, now = () => new Date() }) {
    const timestamp = now();
    const child = await findCurrentChild(database);
    if (!child) {
        return {
            available: true,
            child: null,
            state: null,
            bonds: [],
            actions: [],
            utterances: [],
            milestones: [],
            events: [],
            portrait: null,
            provider_calls: 0,
            embedding_calls: 0
        };
    }
    const baseState = await ensureState(database, child, timestamp);
    const state = await settleAndStoreState(
        database,
        child,
        baseState,
        timestamp
    );
    const [bonds, rows] = await Promise.all([
        ensureBonds(database, child, timestamp),
        listSnapshotRows(database, child.id)
    ]);
    return {
        available: true,
        child: publicChild(child, timestamp),
        state: roundState(state),
        bonds: bonds.map(publicBond),
        actions: rows.actions,
        utterances: rows.utterances,
        milestones: rows.milestones,
        events: rows.events,
        portrait: null,
        provider_calls: 0,
        embedding_calls: 0
    };
}

async function loadNurseryRuntimeSnapshot({ database, now = () => new Date() }) {
    const timestamp = now();
    const child = await findCurrentChild(database);
    if (!child) return null;
    const [stateResult, bondsResult, utteranceResult] = await Promise.all([
        database
            .from("nursery_child_state")
            .select(STATE_FIELDS)
            .eq("child_id", child.id)
            .maybeSingle(),
        database
            .from("nursery_caregiver_bonds")
            .select(BOND_FIELDS)
            .eq("child_id", child.id),
        database
            .from("nursery_utterances")
            .select("id, text, stage, created_at")
            .eq("child_id", child.id)
            .eq("accepted", true)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
    ]);
    for (const result of [stateResult, bondsResult, utteranceResult]) {
        if (result.error) throw result.error;
    }
    return {
        child,
        stage: deriveNurseryStage(child, timestamp),
        state: settleNurseryState(stateResult.data || {}, child, timestamp),
        bonds: bondsResult.data || [],
        latest_utterance: utteranceResult.data || null
    };
}

function validateAction(action, text) {
    if (!ACTIONS.includes(action)) {
        throw nurseryError(400, "nursery_action_invalid", "这个照护动作不存在。");
    }
    const cleaned = maskNurseryPrivateText(text);
    if (TEXT_ACTIONS.has(action) && !cleaned) {
        throw nurseryError(
            400,
            "nursery_action_text_required",
            "请写下这次想说给孩子听的话。"
        );
    }
    return cleaned;
}

async function countRecentSameAction(database, childId, actor, action, now) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const result = await database
        .from("nursery_actions")
        .select("id")
        .eq("child_id", childId)
        .eq("actor", actor)
        .eq("kind", action)
        .gte("effective_at", since)
        .limit(12);
    if (result.error) throw result.error;
    return (result.data || []).length;
}

async function findAction(database, childId, id) {
    const result = await database
        .from("nursery_actions")
        .select("id, actor, kind, payload, effective_at, applied_at, state_version_after")
        .eq("child_id", childId)
        .eq("id", id)
        .maybeSingle();
    if (result.error) throw result.error;
    return result.data || null;
}

async function saveCorpus({ database, child, speaker, text, actionId, now, state }) {
    if (!text) return null;
    const digestPenalty = Number(state.digest_load) >= 75 ? 0.5 : 1;
    const result = await database
        .from("nursery_corpus")
        .insert({
            child_id: child.id,
            source_kind: "direct",
            speaker,
            text,
            content_sha256: contentHash(child.id, speaker, text),
            char_count: Array.from(text).length,
            training_weight: digestPenalty,
            scene: "home",
            created_at: now.toISOString()
        })
        .select("id, speaker, text, char_count, scene, created_at")
        .maybeSingle();
    if (result.error && result.error.code !== "23505") throw result.error;
    return result.data || { source_action_id: actionId, text };
}

async function updateBond({ database, childId, actor, action, state, now }) {
    if (!['user', 'companion'].includes(actor)) return null;
    const found = await database
        .from("nursery_caregiver_bonds")
        .select(BOND_FIELDS)
        .eq("child_id", childId)
        .eq("caregiver_kind", actor)
        .maybeSingle();
    if (found.error) throw found.error;
    const current = found.data || {
        caregiver_kind: actor,
        attachment: 20,
        trust: 20,
        predictability: 20,
        resentment: 0
    };
    const changes = bondChanges(action, state);
    const values = {
        child_id: childId,
        caregiver_kind: actor,
        attachment: Math.min(100, Math.max(0, Number(current.attachment) + changes.attachment)),
        trust: Math.min(100, Math.max(0, Number(current.trust) + changes.trust)),
        predictability: Math.min(100, Math.max(0, Number(current.predictability) + changes.predictability)),
        resentment: Math.min(100, Math.max(0, Number(current.resentment) + changes.resentment)),
        updated_at: now.toISOString()
    };
    const result = found.data
        ? await database
              .from("nursery_caregiver_bonds")
              .update(values)
              .eq("child_id", childId)
              .eq("caregiver_kind", actor)
        : await database.from("nursery_caregiver_bonds").insert(values);
    if (result.error) throw result.error;
    return values;
}

async function saveChildUtterance({ database, child, action, corpus, now }) {
    const recentResult = await database
        .from("nursery_utterances")
        .select("id, text, created_at")
        .eq("child_id", child.id)
        .eq("accepted", true)
        .order("created_at", { ascending: false })
        .limit(12);
    if (recentResult.error) throw recentResult.error;
    const stage = deriveNurseryStage(child, now);
    const generated = generateChildUtterance({
        corpus,
        child,
        stage,
        recentUtterances: recentResult.data || [],
        trigger: action
    });
    const inserted = await database
        .from("nursery_utterances")
        .insert({
            child_id: child.id,
            trigger: action,
            stage: stage.id,
            text: generated.text,
            generation_parameters: {
                local: true,
                attempts: generated.attempts,
                fallback: generated.fallback === true,
                policy_version: STAGE_POLICY_VERSION
            },
            accepted: true,
            created_at: now.toISOString()
        })
        .select("id, trigger, stage, text, created_at")
        .maybeSingle();
    if (inserted.error) throw inserted.error;
    return inserted.data;
}

async function applyNurseryActionUnlocked({
    database,
    childId,
    actor,
    action,
    text = "",
    clientActionId,
    now = () => new Date()
}) {
    const child = await requireChild(database, childId);
    if (child.status === "graduated") {
        throw nurseryError(409, "nursery_child_graduated", "孩子已经长大离开育儿房了。");
    }
    if (!['user', 'companion', 'system'].includes(actor)) {
        throw nurseryError(400, "nursery_actor_invalid", "照护人类型不正确。");
    }
    const cleanedText = validateAction(action, text);
    const idempotencyKey = validActionId(clientActionId);
    const actionId = stableUuid(
        "nursery-action",
        `${child.id}:${actor}:${idempotencyKey}`
    );
    const existing = await findAction(database, child.id, actionId);
    if (existing?.applied_at) {
        return {
            idempotent: true,
            action: existing,
            ...(await getNurserySnapshot({ database, now }))
        };
    }

    const timestamp = now();
    const stateRow = await ensureState(database, child, timestamp);
    const settled = settleNurseryState(stateRow, child, timestamp);
    const previousCount = await countRecentSameAction(
        database,
        child.id,
        actor,
        action,
        timestamp
    );
    const changes = actionStateChanges({
        action,
        state: settled,
        text: cleanedText,
        previousCount
    });
    const nextState = applyStateChanges(
        settled,
        changes,
        timestamp,
        action
    );
    const stateVersionBefore = Number(child.state_version) || 0;
    const stateVersionAfter = stateVersionBefore + 1;

    if (!existing) {
        const insertedAction = await database.from("nursery_actions").insert({
            id: actionId,
            child_id: child.id,
            actor,
            kind: action,
            payload: {
                text_chars: Array.from(cleanedText).length,
                repeated_today: previousCount,
                changes
            },
            idempotency_key: idempotencyKey,
            state_version_before: stateVersionBefore,
            state_version_after: stateVersionAfter,
            effective_at: timestamp.toISOString(),
            applied_at: null
        });
        if (insertedAction.error) {
            if (insertedAction.error.code === "23505") {
                return {
                    idempotent: true,
                    action: await findAction(database, child.id, actionId),
                    ...(await getNurserySnapshot({ database, now }))
                };
            }
            throw insertedAction.error;
        }
    }

    if (Number(child.state_version) < stateVersionAfter) {
        const childUpdate = await database
            .from("nursery_children")
            .update({
                state_version: stateVersionAfter,
                updated_at: timestamp.toISOString()
            })
            .eq("id", child.id)
            .eq("state_version", stateVersionBefore)
            .select("id, state_version")
            .maybeSingle();
        if (childUpdate.error) throw childUpdate.error;
        if (!childUpdate.data) {
            throw nurseryError(
                409,
                "nursery_state_conflict",
                "孩子的状态刚刚发生了变化，请重试这次操作。"
            );
        }
        const stateUpdate = await database
            .from("nursery_child_state")
            .update({
                ...nextState,
                updated_at: timestamp.toISOString()
            })
            .eq("child_id", child.id);
        if (stateUpdate.error) throw stateUpdate.error;
    }

    if (TEXT_ACTIONS.has(action)) {
        await saveCorpus({
            database,
            child,
            speaker: actor === "system" ? "companion" : actor,
            text: cleanedText,
            actionId,
            now: timestamp,
            state: nextState
        });
    }
    await updateBond({
        database,
        childId: child.id,
        actor,
        action,
        state: settled,
        now: timestamp
    });

    const corpusResult = await database
        .from("nursery_corpus")
        .select("id, speaker, text, created_at")
        .eq("child_id", child.id)
        .order("id", { ascending: false })
        .limit(300);
    if (corpusResult.error) throw corpusResult.error;
    const utterance = await saveChildUtterance({
        database,
        child: { ...child, state_version: stateVersionAfter },
        action,
        corpus: (corpusResult.data || []).reverse(),
        now: timestamp
    });
    await insertMilestone({
        database,
        childId: child.id,
        kind: "first_voice",
        title: "第一次回应我们",
        note: utterance.text,
        dedupeKey: "first_voice",
        sourceUtteranceId: utterance.id,
        now: timestamp
    });
    const stage = deriveNurseryStage(child, timestamp);
    await insertMilestone({
        database,
        childId: child.id,
        kind: "stage",
        title: `进入${stage.label}`,
        note: "成长阶段按出生后的实际时间计算。",
        dedupeKey: `stage:${stage.id}`,
        now: timestamp
    });

    const applied = await database
        .from("nursery_actions")
        .update({ applied_at: timestamp.toISOString() })
        .eq("id", actionId)
        .eq("child_id", child.id);
    if (applied.error) throw applied.error;
    return {
        idempotent: false,
        action: {
            id: actionId,
            actor,
            kind: action,
            effective_at: timestamp.toISOString(),
            applied_at: timestamp.toISOString()
        },
        child_utterance: utterance,
        ...(await getNurserySnapshot({ database, now }))
    };
}

async function applyNurseryAction(options) {
    return withNurseryChildLock(options?.childId, (childId) =>
        applyNurseryActionUnlocked({ ...options, childId })
    );
}

function validNameCandidates(value) {
    const values = Array.isArray(value) ? value : [value];
    const names = [...new Set(values.map((item) => cleanNurseryText(item, 20)).filter(Boolean))];
    if (!names.length || names.length > 3) {
        throw nurseryError(
            400,
            "nursery_name_candidates_invalid",
            "请提供一到三个名字。"
        );
    }
    return names;
}

async function chooseName(database, child, names) {
    if (names.length === 1) return names[0];
    const corpus = await database
        .from("nursery_corpus")
        .select("text")
        .eq("child_id", child.id)
        .order("id", { ascending: false })
        .limit(300);
    if (corpus.error) throw corpus.error;
    const learnedCharacters = Array.from(
        (corpus.data || []).map((row) => row.text || "").join("")
    );
    return [...names].sort((left, right) => {
        const score = (name) =>
            Array.from(name).reduce(
                (sum, character) =>
                    sum + learnedCharacters.filter(
                        (learned) => learned === character
                    ).length,
                0
            );
        return (
            score(right) - score(left) ||
            numericSeed(`${child.rng_seed}:${left}`) -
                numericSeed(`${child.rng_seed}:${right}`)
        );
    })[0];
}

async function nameNurseryChildUnlocked({
    database,
    childId,
    candidates,
    clientActionId,
    now = () => new Date()
}) {
    const child = await requireChild(database, childId);
    const names = validNameCandidates(candidates);
    const actionId = validActionId(clientActionId);
    if (child.name) {
        if (names.includes(child.name)) {
            return {
                idempotent: true,
                chosen_name: child.name,
                ...(await getNurserySnapshot({ database, now }))
            };
        }
        throw nurseryError(409, "nursery_name_already_set", "孩子已经有正式名字了。");
    }
    const timestamp = now();
    const chosen = await chooseName(database, child, names);
    const updated = await database
        .from("nursery_children")
        .update({ name: chosen, updated_at: timestamp.toISOString() })
        .eq("id", child.id)
        .is("name", null)
        .select(CHILD_FIELDS)
        .maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data?.name) {
        throw nurseryError(409, "nursery_name_conflict", "名字刚刚发生了变化，请刷新查看。");
    }
    const action = await database.from("nursery_actions").insert({
        id: stableUuid("nursery-action", `${child.id}:name:${actionId}`),
        child_id: child.id,
        actor: "user",
        kind: "name",
        payload: { candidates: names, chosen_name: chosen },
        idempotency_key: `name:${actionId}`,
        state_version_before: Number(child.state_version) || 0,
        state_version_after: Number(child.state_version) || 0,
        effective_at: timestamp.toISOString(),
        applied_at: timestamp.toISOString()
    });
    if (action.error && action.error.code !== "23505") throw action.error;
    await insertMilestone({
        database,
        childId: child.id,
        kind: "name",
        title: `我们给孩子取名为${chosen}`,
        note: names.length > 1 ? "孩子从我们给出的候选里选中了这个名字。" : "这是我们一起定下的名字。",
        dedupeKey: "name",
        now: timestamp
    });
    return {
        idempotent: false,
        chosen_name: chosen,
        ...(await getNurserySnapshot({ database, now }))
    };
}

async function nameNurseryChild(options) {
    return withNurseryChildLock(options?.childId, (childId) =>
        nameNurseryChildUnlocked({ ...options, childId })
    );
}

async function companionNurseryAction({
    database,
    childId,
    clientActionId,
    now = () => new Date()
}) {
    const recent = await database
        .from("messages")
        .select("id, content, created_at")
        .eq("role", "assistant")
        .eq("visible", true)
        .eq("context_visible", true)
        .order("created_at", { ascending: false })
        .limit(20);
    if (recent.error) throw recent.error;
    const source = (recent.data || []).find((message) =>
        cleanNurseryText(message.content, 600)
    );
    return applyNurseryAction({
        database,
        childId,
        actor: "companion",
        action: source ? "talk" : "soothe",
        text: source ? cleanNurseryText(source.content, 600) : "",
        clientActionId,
        now
    });
}

module.exports = {
    CHILD_FIELDS,
    applyNurseryAction,
    companionNurseryAction,
    createUnnamedChild,
    getNurseryPortrait,
    getNurserySnapshot,
    loadNurseryRuntimeSnapshot,
    nameNurseryChild,
    nurseryError,
    publicChild
};
