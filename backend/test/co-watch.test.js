const assert = require("node:assert/strict");
const fs = require("node:fs");
const { publicMessage } = require("../services/chat-attachments");
const {
    buildCoWatchPrompt,
    normalizeCoWatchFrame,
    parseCoWatchReaction,
    runCoWatchFrame
} = require("../services/co-watch");

async function main() {

const frame = normalizeCoWatchFrame({
    sessionId: "2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50",
    epoch: "3",
    sequence: "7",
    capturedAt: "2026-08-03T02:30:00.000Z",
    mimeType: "image/jpeg"
});
assert.equal(frame.sequence, 7);
assert.equal(frame.capturedAt, "2026-08-03T02:30:00.000Z");
assert.equal(frame.minimumMinutes, 1);
assert.equal(frame.maximumMinutes, 180);
assert.match(buildCoWatchPrompt(frame), /一起看|真正想说/);
assert.throws(
    () => normalizeCoWatchFrame({ sessionId: "bad" }),
    (error) =>
        error?.status === 400 && error?.code === "co_watch_session_invalid"
);
assert.deepEqual(
    parseCoWatchReaction(
        "[[NEXT_CHECK_MINUTES:12]]\n这个镜头让我有点紧张。",
        2
    ),
    {
        reaction: "这个镜头让我有点紧张。",
        nextCheckMinutes: 12
    }
);
assert.deepEqual(
    publicMessage({
        id: 201,
        role: "assistant",
        content: "共看回应",
        created_at: "2026-08-13T04:00:00.000Z",
        tool_calls: {
            is_co_watch: true,
            is_co_watch_quick_reply: true,
            co_watch_session_id: frame.sessionId,
            notification_kind: "co_watch",
            secret_internal_value: "must-not-leak"
        }
    }).tool_calls,
    {
        is_co_watch: true,
        is_co_watch_quick_reply: true,
        co_watch_session_id: frame.sessionId,
        notification_kind: "co_watch"
    }
);
assert.deepEqual(parseCoWatchReaction("纯文本回应", 2), {
    reaction: "纯文本回应",
    nextCheckMinutes: 2
});
assert.deepEqual(
    parseCoWatchReaction("[[NEXT_CHECK_MINUTES:999]]\n继续看。", 2),
    { reaction: "继续看。", nextCheckMinutes: 180 }
);
assert.deepEqual(
    parseCoWatchReaction(
        "[[NEXT_CHECK_MINUTES:2]]\n我一会儿再看看。",
        null,
        { minimumMinutes: 7, maximumMinutes: 45 }
    ),
    { reaction: "我一会儿再看看。", nextCheckMinutes: 7 }
);
assert.deepEqual(
    parseCoWatchReaction("没有指定下一次时间。", null, {
        minimumMinutes: 7,
        maximumMinutes: 45
    }),
    { reaction: "没有指定下一次时间。", nextCheckMinutes: null }
);

const calls = [];
const database = { from() {} };
const coWatchWorldBookContext = {
    beforeMemoryInstruction: "共看世界书前置参考",
    dynamicContext: "共看世界书动态参考",
    receipt: { applied_count: 1 }
};
const result = await runCoWatchFrame({
    database,
    frame,
    image: Buffer.from("jpeg"),
    findReaction: async () => null,
    findConversation: async () => ({ id: "conversation-latest" }),
    findSession: async () => ({
        id: frame.sessionId,
        status: "active",
        conversation_id: "conversation-1",
        cadence_seconds: 90
    }),
    getSettings: async () => ({
        ai_name: "小灯",
        provider: "custom",
        model: "vision-model",
        temperature: 0.5,
        max_tokens: 900
    }),
    loadChatContext: async () => ({
        messages: [{ role: "user", content: "我们刚刚在选电影。" }],
        memories: [{ summary: "我喜欢和桃桃一起看悬疑片。" }]
    }),
    resolveWorldBookContext: async (input) => {
        calls.push(["resolveWorldBookContext", input]);
        return coWatchWorldBookContext;
    },
    generateReply: async (input) => {
        calls.push(["generateReply", input]);
        return {
            text: "[[NEXT_CHECK_MINUTES:3]]\n这个镜头让我有点紧张，先别快进。",
            mode: "responses"
        };
    },
    saveMessage: async (...args) => {
        calls.push(["saveMessage", ...args]);
        return { id: 101 };
    },
    touchConversation: async (...args) => calls.push(["touch", ...args]),
    ensureDeliveryEvent: async (...args) => calls.push(["delivery", ...args]),
    recordSessionReaction: async () => ({
        id: frame.sessionId,
        status: "active",
        cadence_seconds: 90
    })
});
assert.equal(result.status, "created");
assert.equal(result.messageId, 101);
assert.equal(result.reaction, "这个镜头让我有点紧张，先别快进。");
assert.equal(result.nextCheckMinutes, 3);
const generation = calls.find((call) => call[0] === "generateReply")[1];
assert.equal(generation.promptArchitecture, "main-chat");
assert.equal(generation.attachments[0].data, Buffer.from("jpeg").toString("base64"));
assert.deepEqual(generation.memories, [
    { summary: "我喜欢和桃桃一起看悬疑片。" }
]);
assert.equal(calls.filter((call) => call[0] === "resolveWorldBookContext").length, 1);
assert.equal(calls.find((call) => call[0] === "resolveWorldBookContext")[1].database, database);
assert.equal(generation.worldBookContext, coWatchWorldBookContext);
const save = calls.find((call) => call[0] === "saveMessage");
assert.equal(save[1], "conversation-1");
assert.equal(save[2], "assistant");
assert.equal(save[4].tool_calls.is_push, true);
assert.equal(save[4].tool_calls.is_co_watch, true);
assert.equal(save[4].tool_calls.notification_kind, "co_watch");
assert.equal(save[4].tool_calls.co_watch_sequence, 7);
assert.equal(calls.filter((call) => call[0] === "delivery").length, 1);

let generatedAgain = false;
const replayed = await runCoWatchFrame({
    database,
    frame,
    image: Buffer.from("jpeg"),
    findReaction: async () => ({
        id: 101,
        conversation_id: "conversation-1",
        content: "已经生成过的反应"
    }),
    findConversation: async () => null,
    findSession: async () => ({
        id: frame.sessionId,
        status: "active",
        conversation_id: "conversation-1",
        cadence_seconds: 90
    }),
    getSettings: async () => ({}),
    loadChatContext: async () => ({}),
    generateReply: async () => {
        generatedAgain = true;
    },
    saveMessage: async () => {},
    touchConversation: async () => {},
    ensureDeliveryEvent: async () => {},
    recordSessionReaction: async () => ({
        id: frame.sessionId,
        status: "active",
        cadence_seconds: 90
    })
});
assert.equal(replayed.status, "replayed");
assert.equal(generatedAgain, false);

let lateFrameGenerated = 0;
let lateFrameSaved = 0;
await assert.rejects(
    runCoWatchFrame({
        database,
        frame: { ...frame, sequence: 8 },
        image: Buffer.from("jpeg"),
        findReaction: async () => null,
        findConversation: async () => ({ id: "conversation-latest" }),
        findSession: async () => ({
            id: frame.sessionId,
            status: "ended",
            conversation_id: "conversation-1",
            cadence_seconds: 90
        }),
        getSettings: async () => ({}),
        loadChatContext: async () => ({}),
        generateReply: async () => {
            lateFrameGenerated += 1;
            return { text: "must not be generated" };
        },
        saveMessage: async () => {
            lateFrameSaved += 1;
            return { id: 102 };
        },
        touchConversation: async () => {},
        ensureDeliveryEvent: async () => {},
        recordSessionReaction: async () => {}
    }),
    (error) =>
        error?.status === 409 && error?.code === "co_watch_session_finished"
);
assert.equal(lateFrameGenerated, 0);
assert.equal(lateFrameSaved, 0);

const glanceFrame = normalizeCoWatchFrame({
    ...frame,
    mode: "glance",
    sequence: 9,
    minimumMinutes: 10,
    maximumMinutes: 60
});
assert.equal(glanceFrame.mode, "glance");
assert.match(buildCoWatchPrompt(glanceFrame), /获准偶尔看一眼当前屏幕/);
assert.match(buildCoWatchPrompt(glanceFrame), /10 到 60/);
let glanceSessionReads = 0;
let glanceSessionWrites = 0;
const glanceCalls = [];
const glanceResult = await runCoWatchFrame({
    database,
    frame: glanceFrame,
    image: Buffer.from("jpeg"),
    findReaction: async () => null,
    findConversation: async () => ({ id: "conversation-glance" }),
    findSession: async () => {
        glanceSessionReads += 1;
        return null;
    },
    getSettings: async () => ({ ai_name: "小灯" }),
    loadChatContext: async () => ({ messages: [], memories: [] }),
    generateReply: async (input) => {
        glanceCalls.push(["generateReply", input]);
        return {
            text: "[[NEXT_CHECK_MINUTES:17]]\n刚才那个画面让我有点好奇。",
            mode: "responses"
        };
    },
    saveMessage: async (...args) => {
        glanceCalls.push(["saveMessage", ...args]);
        return { id: 103 };
    },
    touchConversation: async () => {},
    ensureDeliveryEvent: async (...args) =>
        glanceCalls.push(["delivery", ...args]),
    recordSessionReaction: async () => {
        glanceSessionWrites += 1;
        return null;
    }
});
assert.equal(glanceSessionReads, 0);
assert.equal(glanceSessionWrites, 0);
assert.equal(glanceResult.session, null);
assert.equal(glanceResult.nextCheckMinutes, 17);
assert.equal(glanceResult.notification.kind, "screen_glance");
assert.equal("session_id" in glanceResult.notification, false);
assert.equal(
    glanceCalls.find((call) => call[0] === "generateReply")[1].purpose,
    "screen_glance"
);
const glanceSave = glanceCalls.find((call) => call[0] === "saveMessage");
assert.equal(glanceSave[1], "conversation-glance");
assert.equal(glanceSave[4].tool_calls.is_push, true);
assert.equal(glanceSave[4].tool_calls.is_screen_glance, true);
assert.equal(glanceSave[4].tool_calls.is_co_watch, undefined);
assert.equal(
    glanceSave[4].tool_calls.notification_kind,
    "screen_glance"
);
assert.equal(
    glanceCalls.filter((call) => call[0] === "delivery").length,
    1
);

const legacyFrameId = "abcdef0123456789-abcdef0123456789";
const activeSessionId = "ac8cc607-58bd-4037-ad13-1dffb3bcebe2";
const legacyCalls = [];
const legacyResult = await runCoWatchFrame({
    database,
    frame: {
        sessionId: legacyFrameId,
        epoch: 5,
        sequence: 1,
        capturedAt: "2026-08-13T04:05:00.000Z",
        mimeType: "image/jpeg"
    },
    image: Buffer.from("jpeg"),
    findSession: async (_database, requestedSessionId) =>
        requestedSessionId === activeSessionId
            ? {
                  id: activeSessionId,
                  status: "active",
                  conversation_id: "conversation-active",
                  cadence_seconds: 120
              }
            : null,
    findActiveSession: async () => ({
        id: activeSessionId,
        status: "active",
        conversation_id: "conversation-active",
        cadence_seconds: 120
    }),
    findReaction: async (_database, resolvedFrame) => {
        legacyCalls.push(["findReaction", resolvedFrame]);
        return null;
    },
    findConversation: async () => {
        throw new Error("active session conversation must be reused");
    },
    getSettings: async () => ({ ai_name: "小灯" }),
    loadChatContext: async () => ({ messages: [], memories: [] }),
    generateReply: async () => ({ text: "我还在和你一起看。" }),
    saveMessage: async (...args) => {
        legacyCalls.push(["saveMessage", ...args]);
        return { id: 104 };
    },
    touchConversation: async () => {},
    ensureDeliveryEvent: async () => {},
    recordSessionReaction: async ({ frame: resolvedFrame }) => {
        legacyCalls.push(["record", resolvedFrame]);
        return { id: activeSessionId, status: "active" };
    }
});
assert.equal(legacyResult.conversationId, "conversation-active");
assert.equal(
    legacyCalls.find((call) => call[0] === "findReaction")[1].sessionId,
    activeSessionId
);
assert.equal(
    legacyCalls.find((call) => call[0] === "saveMessage")[4].tool_calls
        .co_watch_session_id,
    activeSessionId
);
assert.equal(
    legacyCalls.find((call) => call[0] === "record")[1].sessionId,
    activeSessionId
);

const serverSource = fs.readFileSync(
    new URL("../server.js", `file://${__filename.replace(/\\/g, "/")}`),
    "utf8"
);
const authSource = fs.readFileSync(
    new URL("../services/auth-context.js", `file://${__filename.replace(/\\/g, "/")}`),
    "utf8"
);
const routeSource = fs.readFileSync(
    new URL("../routes/co-watch.js", `file://${__filename.replace(/\\/g, "/")}`),
    "utf8"
);
assert.match(serverSource, /createCoWatchRouter/);
assert.match(serverSource, /"\/api\/v2\/co-watch"/);
assert.match(authSource, /"\/api\/v2\/co-watch\/frame"/);
assert.match(routeSource, /express\.raw/);
assert.match(routeSource, /MAX_FRAME_BYTES/);
assert.match(routeSource, /mode:\s*req\.query\.mode/);
assert.match(routeSource, /minimumMinutes:\s*req\.query\.minimum_minutes/);
assert.match(routeSource, /maximumMinutes:\s*req\.query\.maximum_minutes/);
assert.match(
    routeSource,
    /next_check_minutes:\s*result\.nextCheckMinutes \|\| null/
);

console.log("co-watch frame, prompt, image and idempotency tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
