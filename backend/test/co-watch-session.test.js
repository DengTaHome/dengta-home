const assert = require("node:assert/strict");
const {
    endCoWatchSession,
    listCoWatchSessionMessages,
    normalizeSessionId,
    recordCoWatchReaction,
    reserveCoWatchFrameSession,
    startCoWatchSession
} = require("../services/co-watch-sessions");

const sessionId = "2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50";
const now = () => new Date("2026-08-13T04:00:00.000Z");

async function main() {
    const legacySessionId = "abcdef0123456789-abcdef0123456789";
    const normalizedLegacyId = normalizeSessionId(legacySessionId);
    assert.match(
        normalizedLegacyId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    assert.equal(normalizeSessionId(legacySessionId), normalizedLegacyId);

    let activeLookup = 0;
    const concurrentWinner = await reserveCoWatchFrameSession({
        database: { from() {} },
        frame: {
            sessionId: legacySessionId,
            capturedAt: "2026-08-13T03:59:00.000Z"
        },
        conversationId: "conversation-legacy",
        findSession: async () => null,
        findActiveSession: async () => {
            activeLookup += 1;
            return activeLookup === 1
                ? null
                : {
                      id: sessionId,
                      status: "active",
                      conversation_id: "conversation-winner"
                  };
        },
        insertSession: async () => {
            throw Object.assign(new Error("active session race"), {
                code: "23505"
            });
        }
    });
    assert.equal(concurrentWinner.id, sessionId);
    assert.equal(concurrentWinner.conversation_id, "conversation-winner");

    const inserted = [];
    const started = await startCoWatchSession({
        database: { from() {} },
        input: {
            session_id: sessionId,
            title: "一起看电影",
            source_app: "bilibili",
            cadence_seconds: 2700,
            media_duration_seconds: 6420
        },
        now,
        findConversation: async () => ({ id: "conversation-1" }),
        findSession: async () => null,
        findActiveSession: async () => null,
        insertSession: async (_database, values) => {
            inserted.push(values);
            return values;
        }
    });

    assert.equal(started.status, "created");
    assert.equal(started.session.id, sessionId);
    assert.equal(started.session.status, "active");
    assert.equal(started.session.cadence_seconds, 2700);
    assert.equal(inserted[0].conversation_id, "conversation-1");
    assert.equal(inserted[0].started_at, now().toISOString());

    const replayed = await startCoWatchSession({
        database: { from() {} },
        input: { session_id: sessionId, cadence_seconds: 200 },
        now,
        findConversation: async () => {
            throw new Error("idempotent replay must not select a new conversation");
        },
        findSession: async () => inserted[0],
        findActiveSession: async () => null,
        insertSession: async () => {
            throw new Error("idempotent replay must not insert twice");
        }
    });
    assert.equal(replayed.status, "resumed");
    assert.equal(replayed.session.cadence_seconds, 2700);

    const retired = [];
    const replaced = await startCoWatchSession({
        database: { from() {} },
        input: {
            session_id: "ac8cc607-58bd-4037-ad13-1dffb3bcebe2"
        },
        now,
        findConversation: async () => ({ id: "conversation-2" }),
        findSession: async () => null,
        findActiveSession: async () => ({
            id: sessionId,
            status: "active"
        }),
        updateSession: async (_database, activeId, values) => {
            retired.push([activeId, values]);
        },
        insertSession: async (_database, values) => values
    });
    assert.equal(replaced.status, "created");
    assert.equal(retired.length, 1);
    assert.equal(retired[0][0], sessionId);
    assert.equal(retired[0][1].status, "ended");

    const updates = [];
    const ended = await endCoWatchSession({
        database: { from() {} },
        sessionId,
        input: { media_position_seconds: 3600 },
        now,
        findSession: async () => inserted[0],
        updateSession: async (_database, _sessionId, values) => {
            updates.push(values);
            return { ...inserted[0], ...values };
        }
    });
    assert.equal(ended.status, "ended");
    assert.equal(ended.session.media_position_seconds, 3600);
    assert.equal(ended.session.ended_at, now().toISOString());
    assert.equal(updates.length, 1);

    const recorded = [];
    const firstReaction = await recordCoWatchReaction({
        database: { from() {} },
        frame: {
            sessionId,
            capturedAt: "2026-08-13T04:01:00.000Z"
        },
        conversationId: "conversation-1",
        messageId: 101,
        now,
        findSession: async () => null,
        insertSession: async (_database, values) => {
            recorded.push(values);
            return values;
        },
        updateSession: async () => {
            throw new Error("first reaction inserts the implicit legacy session");
        }
    });
    assert.equal(firstReaction.frame_count, 1);
    assert.equal(firstReaction.reaction_count, 1);
    assert.equal(firstReaction.last_reaction_message_id, 101);

    let duplicateUpdated = false;
    const duplicate = await recordCoWatchReaction({
        database: { from() {} },
        frame: {
            sessionId,
            capturedAt: "2026-08-13T04:01:00.000Z"
        },
        conversationId: "conversation-1",
        messageId: 101,
        now,
        findSession: async () => recorded[0],
        insertSession: async () => {},
        updateSession: async () => {
            duplicateUpdated = true;
        }
    });
    assert.equal(duplicate.last_reaction_message_id, 101);
    assert.equal(duplicateUpdated, false, "同一条回复重试不能重复累计统计");

    const history = await listCoWatchSessionMessages({
        database: { from() {} },
        sessionId,
        findSession: async () => ({
            id: sessionId,
            conversation_id: "conversation-1"
        }),
        listMessages: async () => [
            {
                id: 301,
                role: "user",
                content: "刚才那是谁？",
                created_at: "2026-08-13T04:02:00.000Z",
                tool_calls: {
                    is_co_watch: true,
                    is_co_watch_quick_reply: true,
                    co_watch_session_id: sessionId
                }
            },
            {
                id: 302,
                role: "assistant",
                content: "是刚出场的新人物。",
                created_at: "2026-08-13T04:02:01.000Z",
                tool_calls: {
                    is_co_watch: true,
                    co_watch_session_id: sessionId,
                    hidden: "never expose"
                }
            }
        ]
    });
    assert.equal(history.length, 2);
    assert.equal(history[1].tool_calls.hidden, undefined);
    assert.equal(history[1].tool_calls.co_watch_session_id, sessionId);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
