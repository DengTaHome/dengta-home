const { randomUUID } = require("node:crypto");
const {
    coWatchNotification,
    ensureCoWatchDeliveryEvent
} = require("./co-watch");
const {
    findCoWatchSession,
    updateCoWatchSession
} = require("./co-watch-sessions");
const {
    safeLoadListeningRuntimeContext
} = require("./listening-runtime-context");

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function mediaClock(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return hours
        ? pad(hours) + ":" + pad(minutes) + ":" + pad(secs)
        : pad(minutes) + ":" + pad(secs);
}

const DANMAKU_MARKER_RE = /\[弹幕\]\s*(\d{1,3}:\d{2}(?::\d{2})?)\s+([^\n\[]+)/g;

function danmakuTimeToSeconds(value) {
    const parts = String(value || "").split(":");
    if (parts.length === 2) {
        const m = Number(parts[0]);
        const s = Number(parts[1]);
        if (Number.isFinite(m) && Number.isFinite(s) && m >= 0 && s >= 0 && s < 60) return m * 60 + s;
    } else if (parts.length === 3) {
        const h = Number(parts[0]);
        const m = Number(parts[1]);
        const s = Number(parts[2]);
        if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s) && h >= 0 && m >= 0 && m < 60 && s >= 0 && s < 60) {
            return h * 3600 + m * 60 + s;
        }
    }
    return null;
}

function extractDanmaku(text) {
    const items = [];
    const source = String(text || "");
    if (source) {
        const regex = new RegExp(DANMAKU_MARKER_RE.source, "g");
        let match;
        while ((match = regex.exec(source))) {
            const seconds = danmakuTimeToSeconds(match[1]);
            const content = cleanText(match[2], 60);
            if (seconds !== null && content) {
                items.push({ media_time_seconds: seconds, text: content });
            }
        }
    }
    const cleaned = source
        .replace(DANMAKU_MARKER_RE, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
    return { cleaned, danmaku: items };
}

async function loadRecentCoWatchReactions(database, conversationId, limit = 6, session = null) {
    try {
        const { data, error } = await database
            .from("messages")
            .select("content, tool_calls, created_at")
            .eq("conversation_id", conversationId)
            .eq("role", "assistant")
            .eq("visible", true)
            .order("created_at", { ascending: false })
            .limit(Math.min(40, limit * 6));
        if (error) return { current: [], earlier: [] };
        const rows = (data || [])
            .filter((row) => {
                const calls = row?.tool_calls || {};
                return calls.is_co_watch === true || calls.is_screen_glance === true;
            })
            .map((row) => ({
                text: cleanText(row?.content, 160),
                media_position_seconds:
                    Number(row?.tool_calls?.co_watch_media_position_seconds) || 0,
                session_id: String(row?.tool_calls?.co_watch_session_id || "")
            }))
            .filter((item) => item.text);
        if (session?.session_mode === "screen") {
            return { current: rows.slice(0, limit), earlier: [] };
        }
        const sid = String(session?.id || "");
        const current = [];
        const earlier = [];
        for (const item of rows) {
            if (item.session_id === sid) {
                current.push(item);
            } else if (earlier.length < 4) {
                earlier.push(item);
            }
        }
        return { current: current.slice(0, limit), earlier };
    } catch {
        return { current: [], earlier: [] };
    }
}


function cleanText(value, maximum) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
        .slice(0, maximum)
        .join("");
}

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

async function findUserMessageByRequestId(database, requestId) {
    const { data, error } = await database
        .from("messages")
        .select("id, conversation_id, content, tool_calls")
        .eq("role", "user")
        .eq("client_message_id", requestId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function findAssistantReplyByRequestId(
    database,
    conversationId,
    requestId
) {
    const { data, error } = await database
        .from("messages")
        .select("id, conversation_id, content, tool_calls")
        .eq("conversation_id", conversationId)
        .eq("role", "assistant")
        .contains("tool_calls", { reply_to_client_message_id: requestId })
        .order("created_at", { ascending: true })
        .limit(1);
    if (error) throw error;
    return data?.[0] || null;
}

async function recordCoWatchTextReply({
    database,
    session,
    messageId,
    mediaPositionSeconds,
    now = () => new Date()
} = {}) {
    const values = {
        reaction_count: (Number(session.reaction_count) || 0) + 1,
        last_reaction_at: new Date(now()).toISOString(),
        last_reaction_message_id: messageId,
        updated_at: new Date(now()).toISOString()
    };
    if (Number.isFinite(Number(mediaPositionSeconds))) {
        values.media_position_seconds = Math.min(
            7 * 24 * 60 * 60,
            Math.max(0, Math.round(Number(mediaPositionSeconds)))
        );
    }
    return updateCoWatchSession(database, session.id, values);
}

function buildCoWatchReplyPrompt({ text, session, mediaPositionSeconds, recentReactions = [], earlierReactions = [] } = {}) {
    if (session?.session_mode === "listening") {
        return [
            "我们正在同一场一起听歌中。用户从本场回复区直接说了一句话。",
            `当前一起听标题：${cleanText(session?.title, 180) || "未命名歌曲"}`,
            `用户发消息时播放到：${mediaClock(mediaPositionSeconds)}`,
            `用户刚才说：${text}`,
            "请结合运行时提供的当前曲名、歌手和播放位置，像陪在用户身边听同一首歌一样自然接话，直接给出一两句可发送的回应。你只能依据歌曲元数据和用户的话陪聊，不得声称自己真正听见了音频。"
        ].join("\n");
    }
    const currentReactions = Array.isArray(recentReactions?.current)
        ? recentReactions.current
        : Array.isArray(recentReactions)
        ? recentReactions
        : [];
    const plot = currentReactions.length
        ? "刚才看到的剧情片段：\n" + currentReactions
            .map((item) => `- ${mediaClock(item.media_position_seconds)}：${cleanText(item.text, 140)}`)
            .join("\n")
        : "";
    const earlier = Array.isArray(earlierReactions) && earlierReactions.length
        ? "更早看过的内容（只有用户主动问起更早的视频时才使用，不要自己提起）：\n" + earlierReactions
            .map((item) => `- ${mediaClock(item.media_position_seconds)}：${cleanText(item.text, 120)}`)
            .join("\n")
        : "";
    return [
        "我们正在同一场一起看中。用户从系统通知或共看区直接回了一句话。",
        `当前共看标题：${cleanText(session?.title, 180) || "未命名内容"}`,
        `用户发消息时画面大约在：${mediaClock(mediaPositionSeconds)}`,
        plot,
        earlier,
        `用户刚才说：${text}`,
        "请像坐在用户身边共同观看一样自然接话，结合现有聊天上下文和个性化信息，直接给出一两句可发送的回应。",
        "注意：围绕当前正在看的视频回答；只有用户主动问起更早看过的视频时，才使用“更早看过的内容”，平时不要自己串场。",
        "注意：你回复期间画面会继续播放，引用画面内容时请说“刚才看到…”，不要假装正看到某一瞬间。",
        "如果你想在画面里加一条带时间的弹幕，可以在回复末尾另起一行写：[弹幕] MM:SS 内容（时间用当前播放位置之后的 0-120 秒内）。不用弹幕就省略这行。"
    ].filter(Boolean).join("\n");
}

async function replayCoWatchReply({
    database,
    session,
    sessionId,
    requestId,
    assistant,
    settings,
    ensureDeliveryEvent
}) {
    await ensureDeliveryEvent({
        database,
        frame: { sessionId, epoch: "quick-reply", sequence: requestId },
        messageId: assistant.id
    });
    return {
        status: "replayed",
        request_id: requestId,
        reaction: assistant.content,
        danmaku: Array.isArray(assistant?.tool_calls?.co_watch_danmaku)
            ? assistant.tool_calls.co_watch_danmaku
            : [],
        assistant_message: assistant,
        session,
        notification: coWatchNotification({
            frame: { sessionId, sequence: 0 },
            messageId: assistant.id,
            reaction: assistant.content,
            aiName: settings.ai_name
        })
    };
}

async function runCoWatchQuickReply({
    database,
    sessionId,
    input = {},
    getSettings,
    loadChatContext,
    generateReply,
    saveMessage,
    touchConversation,
    findSession = findCoWatchSession,
    findUserMessage = findUserMessageByRequestId,
    findAssistantReply = findAssistantReplyByRequestId,
    ensureDeliveryEvent = ensureCoWatchDeliveryEvent,
    recordSessionReply = recordCoWatchTextReply,
    loadListeningContext = safeLoadListeningRuntimeContext,
    resolveWorldBookContext = async () => null,
    idFactory = randomUUID
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
        findSession,
        findUserMessage,
        findAssistantReply,
        ensureDeliveryEvent,
        recordSessionReply,
        resolveWorldBookContext
    })) {
        if (typeof dependency !== "function") {
            throw new TypeError(`${name} must be a function.`);
        }
    }
    if (!UUID_PATTERN.test(String(sessionId || ""))) {
        throw requestError(
            400,
            "co_watch_session_invalid",
            "共看会话编号格式不正确。"
        );
    }
    const text = cleanText(input.text, 2000);
    if (!text) {
        throw requestError(400, "co_watch_reply_empty", "请输入回复内容。");
    }
    const requestId = cleanText(input.request_id, 80) || idFactory();
    if (!UUID_PATTERN.test(requestId)) {
        throw requestError(
            400,
            "co_watch_request_id_invalid",
            "共看回复请求编号格式不正确。"
        );
    }
    const session = await findSession(database, sessionId);
    if (!session) {
        throw requestError(404, "co_watch_session_not_found", "找不到这场一起看。");
    }
    if (session.status !== "active") {
        throw requestError(
            409,
            "co_watch_session_finished",
            "这场一起看已经结束。"
        );
    }

    const settings = await getSettings(database);
    let savedUser = await findUserMessage(database, requestId);
    if (savedUser) {
        if (
            savedUser.conversation_id !== session.conversation_id ||
            cleanText(savedUser.content, 2000) !== text
        ) {
            throw requestError(
                409,
                "co_watch_request_conflict",
                "该共看回复请求已用于另一段对话。"
            );
        }
        const existingReply = await findAssistantReply(
            database,
            session.conversation_id,
            requestId
        );
        if (existingReply) {
            return replayCoWatchReply({
                database,
                session,
                sessionId,
                requestId,
                assistant: existingReply,
                settings,
                ensureDeliveryEvent
            });
        }
    }

    if (!savedUser) {
        try {
            savedUser = await saveMessage(
                session.conversation_id,
                "user",
                text,
                {
                    client_message_id: requestId,
                    visible: true,
                    tool_calls: {
                        is_co_watch: true,
                        is_co_watch_quick_reply: true,
                        co_watch_session_id: sessionId,
                        co_watch_media_position_seconds:
                            Number(input.media_position_seconds) || 0
                    },
                    database
                }
            );
        } catch (error) {
            if (String(error?.code || "") !== "23505") throw error;
            savedUser = await findUserMessage(database, requestId);
            if (
                !savedUser ||
                savedUser.conversation_id !== session.conversation_id ||
                cleanText(savedUser.content, 2000) !== text
            ) {
                throw requestError(
                    409,
                    "co_watch_request_conflict",
                    "该共看回复请求已用于另一段对话。"
                );
            }
            const concurrentReply = await findAssistantReply(
                database,
                session.conversation_id,
                requestId
            );
            if (concurrentReply) {
                return replayCoWatchReply({
                    database,
                    session,
                    sessionId,
                    requestId,
                    assistant: concurrentReply,
                    settings,
                    ensureDeliveryEvent
                });
            }
        }
    }
    const context = await loadChatContext(
        session.conversation_id,
        settings,
        database
    );
    const sessionStartedAt = session.started_at ? Date.parse(session.started_at) : 0;
    const sessionMessages = (Array.isArray(context?.messages) ? context.messages : [])
        .filter((msg) => {
            const calls = msg?.tool_calls || {};
            if (String(calls?.co_watch_session_id || "") === String(session.id || "")) return true;
            if (calls?.is_screen_glance === true && session.session_mode === "screen") return true;
            const at = Date.parse(msg?.created_at || "");
            return Number.isFinite(at) && sessionStartedAt > 0 && at >= sessionStartedAt;
        });
    const listeningRuntimeContext =
        session.session_mode === "listening"
            ? await loadListeningContext(database, { sessionId })
            : "";
    const recentReactions = session.session_mode === "listening"
        ? { current: [], earlier: [] }
        : await loadRecentCoWatchReactions(database, session.conversation_id, 6, session);
    const generationMessages = [
        ...sessionMessages,
        {
            role: "user",
            content: buildCoWatchReplyPrompt({
                text,
                session,
                mediaPositionSeconds: input.media_position_seconds,
                recentReactions,
                earlierReactions: recentReactions?.earlier || []
            })
        }
    ];
    const worldBookContext = await resolveWorldBookContext({
        database,
        settings,
        messages: generationMessages
    });
    const generated = await generateReply({
        settings,
        messages: generationMessages,
        memories: Array.isArray(context?.memories) ? context.memories : [],
        runtimeContext: listeningRuntimeContext,
        turnContext: "",
        promptArchitecture: "main-chat",
        purpose: "co_watch_reply",
        worldBookContext
    });
    const extracted = extractDanmaku(generated?.text);
    const reaction = cleanText(extracted.cleaned, 420);
    const danmaku = extracted.danmaku.slice(0, 4);
    if (!reaction) {
        throw requestError(
            502,
            "co_watch_reaction_empty",
            "伴侣这次没有生成可显示的共看回应。"
        );
    }
    let assistant;
    try {
        assistant = await saveMessage(
            session.conversation_id,
            "assistant",
            reaction,
            {
                visible: true,
                tool_calls: {
                    is_push: true,
                    is_co_watch: true,
                    is_co_watch_quick_reply: true,
                    notification_kind: "co_watch",
                    co_watch_session_id: sessionId,
                    reply_to_client_message_id: requestId,
                    reply_to_message_id: savedUser.id,
                    co_watch_media_position_seconds:
                        Number(input.media_position_seconds) || 0,
                    co_watch_danmaku: danmaku,
                    response_mode: generated?.mode || "unknown"
                },
                database
            }
        );
    } catch (error) {
        if (String(error?.code || "") !== "23505") throw error;
        const concurrentReply = await findAssistantReply(
            database,
            session.conversation_id,
            requestId
        );
        if (!concurrentReply) throw error;
        return replayCoWatchReply({
            database,
            session,
            sessionId,
            requestId,
            assistant: concurrentReply,
            settings,
            ensureDeliveryEvent
        });
    }
    await touchConversation(session.conversation_id, database);
    const updatedSession = await recordSessionReply({
        database,
        session,
        messageId: assistant.id,
        mediaPositionSeconds: input.media_position_seconds
    });
    await ensureDeliveryEvent({
        database,
        frame: { sessionId, epoch: "quick-reply", sequence: requestId },
        messageId: assistant.id
    });
    return {
        status: "created",
        request_id: requestId,
        reaction,
        danmaku,
        assistant_message: assistant,
        session: updatedSession,
        notification: coWatchNotification({
            frame: { sessionId, sequence: 0 },
            messageId: assistant.id,
            reaction,
            aiName: settings.ai_name
        }),
        prompt_receipt: generated?.prompt_receipt || null
    };
}

module.exports = {
    buildCoWatchReplyPrompt,
    findAssistantReplyByRequestId,
    findUserMessageByRequestId,
    recordCoWatchTextReply,
    runCoWatchQuickReply
};
