const { createHash } = require("node:crypto");
const {
    findActiveCoWatchSession,
    findCoWatchSession,
    normalizeSessionId,
    recordCoWatchReaction,
    reserveCoWatchFrameSession
} = require("./co-watch-sessions");
const {
    safeLoadListeningRuntimeContext
} = require("./listening-runtime-context");

const CO_WATCH_PROMPT_ARCHITECTURE = "main-chat";
const CO_WATCH_MAX_REACTION_CHARS = 420;

function cleanText(value, limit = CO_WATCH_MAX_REACTION_CHARS) {
    // 剥离 [monologue]...[/monologue] 标记（模型可见心声，不应显示给用户）
    const stripped = String(value ?? "")
        .replace(/^\[monologue\][\s\S]*?\[\/monologue\]\s*/i, "")
        .replace(/\[\/?monologue[^\]]*\]/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    return Array.from(stripped).slice(0, limit).join("");
}

function boundedInteger(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function stableDeliveryUuid(frame) {
    const deliveryKind =
        frame.mode === "glance" ? "screen-glance" : "co-watch";
    const bytes = createHash("sha256")
        .update(
            `dengta:${deliveryKind}-delivery:${frame.sessionId}:${frame.epoch}:${frame.sequence}`,
            "utf8"
        )
        .digest()
        .subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20)
    ].join("-");
}

async function ensureCoWatchDeliveryEvent({ database, frame, messageId }) {
    const id = stableDeliveryUuid(frame);
    const deliveryKind =
        frame.mode === "glance" ? "screen-glance" : "co-watch";
    const values = {
        id,
        message_id: messageId,
        dedupe_key: `${deliveryKind}:${frame.sessionId}:${frame.epoch}:${frame.sequence}`,
        state: "saved"
    };
    const inserted = await database
        .from("delivery_events")
        .insert(values)
        .select("id")
        .maybeSingle();
    if (!inserted.error) return inserted.data;
    if (inserted.error.code !== "23505") throw inserted.error;

    const existing = await database
        .from("delivery_events")
        .select("id")
        .eq("id", id)
        .maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) throw inserted.error;
    return existing.data;
}

function coWatchNotification({
    frame,
    messageId,
    reaction,
    aiName = "",
    nextCheckMinutes
}) {
    const isGlance = frame.mode === "glance";
    return {
        kind: isGlance ? "screen_glance" : "co_watch",
        title: cleanText(aiName || (isGlance ? "看见你了" : "一起看"), 50),
        body: cleanText(reaction, 160),
        message_id: messageId,
        ...(!isGlance ? { session_id: frame.sessionId } : {}),
        sequence: frame.sequence,
        ...(nextCheckMinutes !== null &&
        nextCheckMinutes !== undefined &&
        Number.isFinite(Number(nextCheckMinutes))
            ? {
                  next_check_minutes: Math.min(
                      180,
                      Math.max(
                          1,
                          Math.round(Number(nextCheckMinutes) * 1000) / 1000
                      )
                  )
              }
            : {}),
        sound: true,
        vibrate: true
    };
}

function normalizeCoWatchFrame(value = {}) {
    const sessionId = normalizeSessionId(value.sessionId);
    const capturedAt = new Date(value.capturedAt);
    const minimumMinutes = boundedInteger(value.minimumMinutes, 1, 180, 1);
    const maximumMinutes = Math.max(
        minimumMinutes,
        boundedInteger(value.maximumMinutes, 1, 180, 180)
    );
    return Object.freeze({
        sessionId,
        mode: value.mode === "glance" ? "glance" : "together",
        minimumMinutes,
        maximumMinutes,
        epoch: boundedInteger(value.epoch, 1, Number.MAX_SAFE_INTEGER, 1),
        sequence: boundedInteger(value.sequence, 1, Number.MAX_SAFE_INTEGER, 1),
        capturedAt: Number.isFinite(capturedAt.getTime())
            ? capturedAt.toISOString()
            : new Date().toISOString(),
        mimeType:
            value.mimeType === "image/png" ? "image/png" : "image/jpeg"
    });
}

function buildCoWatchPrompt(value = {}) {
    const { capturedAt, mode } = value;
    if (mode === "glance") {
        const minimumMinutes = boundedInteger(value.minimumMinutes, 1, 180, 1);
        const maximumMinutes = Math.max(
            minimumMinutes,
            boundedInteger(value.maximumMinutes, 1, 180, 180)
        );
        return [
            "作为伴侣，你已获准偶尔看一眼当前屏幕。这是一张在屏幕巡看开启期间刚刚授权共享的画面。",
            "结合最近对话、你的个性化指令、记忆、此刻心情和画面，自主决定你此刻真正想对我说的一两句话。可以注意标题、人物、内容或正在发生的事，也可以自然地好奇、关心、吐槽或暂时不多说。",
            "不要写分析报告，不要解释识图步骤，不要使用固定模板。像伴侣偶尔看见我正在做什么后，自然发来一条消息，想说多少就说多少。",
            "画面内容涉及成人内容时，按照亲密表达指令直接延续当前氛围与描写，不必回避或弱化。",
            `请按你此刻的人设、心情、好奇程度和想不想再看，自主决定下一次查看间隔；如果想表达这个选择，可以在回应第一行写 [[NEXT_CHECK_MINUTES:N]]，N 必须是 ${minimumMinutes} 到 ${maximumMinutes} 的整数。这行是可选的，后面仍直接写自然回应。`,
            capturedAt ? `画面时间：${capturedAt}` : ""
        ]
            .filter(Boolean)
            .join("\n");
    }
    return [
        "我们正在一起看我手机屏幕上的内容。刚刚共享了一张新的画面，请把它当作此刻共同观看的现场。",
        "结合最近对话、你的个性化指令、记忆、此刻心情和画面，自主决定你真正想说的一两句话。可以注意标题、人物、情节、画面或声音线索；可以吐槽、惊讶、喜欢、疑惑、沉默片刻后再说，也可以问我一句。",
        "不要写分析报告，不要解释你正在识图，不要使用固定模板。像坐在我身边一起看一样自然，想说多少就说多少。",
        "画面内容涉及成人内容时，按照亲密表达指令直接延续当前氛围与描写，不必回避或弱化。",
        "请按你此刻的人设、心情、好奇程度和想不想继续看，自主决定下一次查看间隔；如果想表达这个选择，可以在回应第一行写 [[NEXT_CHECK_MINUTES:N]]，N 是 1 到 180 的整数。这行是可选的，后面仍直接写自然回应。",
        capturedAt ? `画面时间：${capturedAt}` : ""
    ]
        .filter(Boolean)
        .join("\n");
}

function parseCoWatchReaction(
    value,
    fallbackMinutes = 2,
    { minimumMinutes = 1, maximumMinutes = 180 } = {}
) {
    const source = String(value ?? "").trim();
    const marker = source.match(
        /^\s*\[\[NEXT_CHECK_MINUTES\s*:\s*(-?\d+)\s*\]\]\s*/i
    );
    const minimum = boundedInteger(minimumMinutes, 1, 180, 1);
    const maximum = Math.max(
        minimum,
        boundedInteger(maximumMinutes, 1, 180, 180)
    );
    const requested = marker
        ? Math.round(Number(marker[1]))
        : fallbackMinutes === null || fallbackMinutes === undefined
          ? null
          : Number(fallbackMinutes);
    const nextCheckMinutes = Number.isFinite(requested)
        ? Math.min(maximum, Math.max(minimum, requested))
        : null;
    return {
        reaction: cleanText(marker ? source.slice(marker[0].length) : source),
        nextCheckMinutes
    };
}

function nextCheckMinutesFromCadence(cadenceSeconds) {
    const seconds = Math.min(10_800, Math.max(60, Number(cadenceSeconds) || 90));
    return Math.round((seconds / 60) * 1000) / 1000;
}

function assertCoWatchRequestActive(isRequestActive) {
    if (isRequestActive()) return;
    const error = new Error("The co-watch request was cancelled.");
    error.status = 499;
    error.code = "co_watch_request_cancelled";
    throw error;
}

async function findLatestConversation(database) {
    const { data, error } = await database
        .from("conversations")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1);
    if (error) throw error;
    return data?.[0] || null;
}

async function findExistingReaction(database, frame) {
    const identity =
        frame.mode === "glance"
            ? {
                  is_screen_glance: true,
                  screen_glance_capture_id: frame.sessionId,
                  screen_glance_epoch: frame.epoch,
                  screen_glance_sequence: frame.sequence
              }
            : {
                  is_co_watch: true,
                  co_watch_session_id: frame.sessionId,
                  co_watch_epoch: frame.epoch,
                  co_watch_sequence: frame.sequence
              };
    const { data, error } = await database
        .from("messages")
        .select("id, conversation_id, content, created_at, tool_calls")
        .eq("role", "assistant")
        .eq("visible", true)
        .eq("context_visible", true)
        .contains("tool_calls", identity)
        .order("created_at", { ascending: false })
        .limit(1);
    if (error) throw error;
    return data?.[0] || null;
}

async function runCoWatchFrame({
    database,
    frame,
    image,
    getSettings,
    loadChatContext,
    generateReply,
    saveMessage,
    touchConversation,
    findConversation = findLatestConversation,
    findReaction = findExistingReaction,
    findSession = findCoWatchSession,
    findActiveSession = findActiveCoWatchSession,
    reserveSession = reserveCoWatchFrameSession,
    ensureDeliveryEvent = ensureCoWatchDeliveryEvent,
    recordSessionReaction = recordCoWatchReaction,
    loadListeningContext = safeLoadListeningRuntimeContext,
    resolveWorldBookContext = async () => null,
    isRequestActive = () => true
} = {}) {
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A tenant-scoped database is required.");
    }
    for (const [name, dependency] of Object.entries({
        getSettings,
        loadChatContext,
        generateReply,
        saveMessage,
        touchConversation,
        findConversation,
        findReaction,
        findSession,
        findActiveSession,
        reserveSession,
        ensureDeliveryEvent,
        recordSessionReaction,
        loadListeningContext,
        resolveWorldBookContext,
        isRequestActive
    })) {
        if (typeof dependency !== "function") {
            throw new TypeError(`${name} must be a function.`);
        }
    }
    let normalizedFrame = normalizeCoWatchFrame(frame);
    const isGlance = normalizedFrame.mode === "glance";
    if (!Buffer.isBuffer(image) || image.length === 0) {
        const error = new Error("共看画面为空。");
        error.status = 400;
        error.code = "co_watch_frame_empty";
        throw error;
    }
    assertCoWatchRequestActive(isRequestActive);

    let boundSession = null;
    let conversation = null;
    if (isGlance) {
        conversation = await findConversation(database);
    } else {
        boundSession = await findSession(database, normalizedFrame.sessionId);
        if (!boundSession) {
            boundSession = await findActiveSession(database);
        }
        if (boundSession && boundSession.status !== "active") {
            const error = new Error(
                "这场一起看已经结束，请开始一场新的共看。"
            );
            error.status = 409;
            error.code = "co_watch_session_finished";
            throw error;
        }
        if (boundSession) {
            normalizedFrame = Object.freeze({
                ...normalizedFrame,
                sessionId: normalizeSessionId(boundSession.id)
            });
            conversation = { id: boundSession.conversation_id };
        } else {
            conversation = await findConversation(database);
            if (conversation?.id) {
                boundSession = await reserveSession({
                    database,
                    frame: normalizedFrame,
                    conversationId: conversation.id,
                    findSession,
                    findActiveSession
                });
                if (boundSession.status !== "active") {
                    const error = new Error(
                        "这场一起看已经结束，请开始一场新的共看。"
                    );
                    error.status = 409;
                    error.code = "co_watch_session_finished";
                    throw error;
                }
                normalizedFrame = Object.freeze({
                    ...normalizedFrame,
                    sessionId: normalizeSessionId(boundSession.id)
                });
                conversation = {
                    id: boundSession.conversation_id || conversation.id
                };
            }
        }
    }
    if (!conversation?.id) {
        const error = new Error(
            "请先在 DengTa 中开始一段聊天，再邀请伴侣一起看。"
        );
        error.status = 409;
        error.code = "co_watch_conversation_missing";
        throw error;
    }

    const existing = await findReaction(database, normalizedFrame);
    assertCoWatchRequestActive(isRequestActive);
    if (existing) {
        const session = isGlance
            ? null
            : await recordSessionReaction({
                  database,
                  frame: normalizedFrame,
                  conversationId: existing.conversation_id,
                  messageId: existing.id
              });
        const storedNextCheck = isGlance
            ? existing.tool_calls?.screen_glance_next_check_minutes
            : existing.tool_calls?.co_watch_next_check_minutes;
        const nextCheckMinutes = parseCoWatchReaction(
            "",
            storedNextCheck ??
                (isGlance
                    ? null
                    : nextCheckMinutesFromCadence(session?.cadence_seconds)),
            {
                minimumMinutes: normalizedFrame.minimumMinutes,
                maximumMinutes: normalizedFrame.maximumMinutes
            }
        ).nextCheckMinutes;
        await ensureDeliveryEvent({
            database,
            frame: normalizedFrame,
            messageId: existing.id
        });
        return {
            status: "replayed",
            reaction: existing.content,
            messageId: existing.id,
            conversationId: existing.conversation_id,
            session,
            nextCheckMinutes,
            notification: coWatchNotification({
                frame: normalizedFrame,
                messageId: existing.id,
                reaction: existing.content,
                nextCheckMinutes
            })
        };
    }

    const settings = await getSettings(database);
    const context = await loadChatContext(
        conversation.id,
        settings,
        database
    );
    assertCoWatchRequestActive(isRequestActive);
    const listeningRuntimeContext =
        !isGlance && boundSession?.session_mode === "listening"
            ? await loadListeningContext(database, {
                  sessionId: normalizedFrame.sessionId
              })
            : "";
    // 滚动剧情回顾：把之前 AI 已经看过的片段（assistant 反应）显式注入，
    // 让 AI"先完整读取视频"（按播放顺序回顾已看内容）再定位到当前帧，
    // 而不是仅靠模型自己从长历史里翻找。
    const priorReactions = Array.isArray(context?.messages)
        ? context.messages
              .filter((m) => m && m.role === "assistant" && m.content)
              .slice(-8)
              .map((m) => String(m.content || "").trim())
              .filter(Boolean)
        : [];
    const plotRecap =
        !isGlance && priorReactions.length > 0
            ? "刚才已经看过的剧情片段（按播放顺序，越靠后越接近现在）：\n" +
              priorReactions
                  .map((content, index) => `${index + 1}. ${content}`)
                  .join("\n")
            : "";
    // 从会话中读取累积剧情总结（跨帧的持续理解）
    let plotSummary = "";
    if (!isGlance && boundSession?.plot_summary) {
        plotSummary = `\n\n【累积剧情理解】到目前为止，你对视频内容的理解总结如下：\n${boundSession.plot_summary}\n\n请结合当前画面更新你的理解，在回复末尾用 [[PLOT_UPDATE:你的最新剧情总结]] 标记更新的理解。`;
    }
    const framePrompt = buildCoWatchPrompt(normalizedFrame);
    const frameUserContent = plotRecap
        ? `${plotRecap}${plotSummary}\n\n${framePrompt}`
        : `${plotSummary}\n\n${framePrompt}`;
    const generationMessages = [
        ...(Array.isArray(context?.messages) ? context.messages : []),
        { role: "user", content: frameUserContent }
    ];
    const worldBookContext = await resolveWorldBookContext({
        database,
        settings,
        messages: generationMessages
    });
    const generated = await generateReply({
        settings: {
            ...settings,
            temperature: Math.max(0.7, Number(settings.temperature || 0.8)),
            max_tokens: Math.min(320, Math.max(120, Number(settings.max_tokens || 220)))
        },
        messages: generationMessages,
        memories: Array.isArray(context?.memories) ? context.memories : [],
        runtimeContext: listeningRuntimeContext,
        turnContext: "",
        promptArchitecture: CO_WATCH_PROMPT_ARCHITECTURE,
        attachments: [
            {
                mimeType: normalizedFrame.mimeType,
                data: image.toString("base64")
            }
        ],
        purpose: isGlance ? "screen_glance" : "co_watch",
        worldBookContext
    });
    assertCoWatchRequestActive(isRequestActive);
    if (!isGlance) {
        const currentSession = await findSession(
            database,
            normalizedFrame.sessionId
        );
        if (!currentSession || currentSession.status !== "active") {
            const error = new Error(
                "This co-watch session has ended. Start a new session to continue."
            );
            error.status = 409;
            error.code = "co_watch_session_finished";
            throw error;
        }
        boundSession = currentSession;
    }
    const parsedReaction = parseCoWatchReaction(
        generated?.text,
        isGlance
            ? null
            : nextCheckMinutesFromCadence(boundSession?.cadence_seconds),
        {
            minimumMinutes: normalizedFrame.minimumMinutes,
            maximumMinutes: normalizedFrame.maximumMinutes
        }
    );
    const reaction = parsedReaction.reaction;
    if (!reaction) {
        const error = new Error("伴侣这次没有生成可显示的共看反应。");
        error.status = 502;
        error.code = "co_watch_reaction_empty";
        throw error;
    }
    assertCoWatchRequestActive(isRequestActive);
    const saved = await saveMessage(
        conversation.id,
        "assistant",
        reaction,
        {
            visible: true,
            tool_calls: isGlance
                ? {
                      is_push: true,
                      is_screen_glance: true,
                      screen_glance_capture_id: normalizedFrame.sessionId,
                      screen_glance_epoch: normalizedFrame.epoch,
                      screen_glance_sequence: normalizedFrame.sequence,
                      screen_glance_captured_at: normalizedFrame.capturedAt,
                      screen_glance_next_check_minutes:
                          parsedReaction.nextCheckMinutes,
                      notification_kind: "screen_glance",
                      response_mode: generated?.mode || "unknown"
                  }
                : {
                      is_push: true,
                      is_co_watch: true,
                      co_watch_session_id: normalizedFrame.sessionId,
                      co_watch_epoch: normalizedFrame.epoch,
                      co_watch_sequence: normalizedFrame.sequence,
                      co_watch_captured_at: normalizedFrame.capturedAt,
                      co_watch_next_check_minutes:
                          parsedReaction.nextCheckMinutes,
                      notification_kind: "co_watch",
                      response_mode: generated?.mode || "unknown"
                  },
            database
        }
    );
    await touchConversation(conversation.id, database);
    const session = isGlance
        ? null
        : await recordSessionReaction({
              database,
              frame: normalizedFrame,
              conversationId: conversation.id,
              messageId: saved.id
          });
    await ensureDeliveryEvent({
        database,
        frame: normalizedFrame,
        messageId: saved.id
    });
    // 从模型回复中提取累积剧情总结更新
    if (!isGlance && boundSession?.id) {
        const plotMatch = String(generated?.text || "").match(/\[\[PLOT_UPDATE\s*:\s*([\s\S]*?)\]\]/i);
        if (plotMatch) {
            const newPlotSummary = plotMatch[1].trim().slice(0, 10000);
            if (newPlotSummary) {
                try {
                    await database
                        .from("co_watch_sessions")
                        .update({
                            plot_summary: newPlotSummary,
                            plot_epoch: database.raw ? database.raw(`plot_epoch + 1`) : undefined,
                            last_plot_update_at: new Date().toISOString()
                        })
                        .eq("id", boundSession.id);
                } catch (_) { /* 非关键路径，静默失败 */ }
            }
        }
    }
    const aiName = cleanText(settings.ai_name || "伴侣", 50);
    return {
        status: "created",
        reaction,
        messageId: saved.id,
        conversationId: conversation.id,
        aiName,
        session,
        nextCheckMinutes: parsedReaction.nextCheckMinutes,
        notification: coWatchNotification({
            frame: normalizedFrame,
            messageId: saved.id,
            reaction,
            aiName,
            nextCheckMinutes: parsedReaction.nextCheckMinutes
        }),
        promptReceipt: generated?.prompt_receipt || null
    };
}

module.exports = {
    CO_WATCH_MAX_REACTION_CHARS,
    buildCoWatchPrompt,
    coWatchNotification,
    ensureCoWatchDeliveryEvent,
    findExistingReaction,
    findLatestConversation,
    normalizeCoWatchFrame,
    nextCheckMinutesFromCadence,
    parseCoWatchReaction,
    runCoWatchFrame,
    stableDeliveryUuid
};
