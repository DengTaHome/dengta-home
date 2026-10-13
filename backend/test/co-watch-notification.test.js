const assert = require("node:assert/strict");
const { runCoWatchFrame } = require("../services/co-watch");

async function main() {
    const delivered = [];
    const frame = {
        sessionId: "2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50",
        epoch: 3,
        sequence: 7,
        capturedAt: "2026-08-13T02:30:00.000Z",
        mimeType: "image/jpeg"
    };

    const result = await runCoWatchFrame({
        database: { from() {} },
        frame,
        image: Buffer.from("jpeg"),
        findReaction: async () => null,
        findSession: async () => ({
            id: frame.sessionId,
            status: "active",
            conversation_id: "conversation-1",
            cadence_seconds: 90
        }),
        findConversation: async () => ({ id: "conversation-1" }),
        getSettings: async () => ({
            ai_name: "小灯",
            provider: "custom",
            model: "vision-model"
        }),
        loadChatContext: async () => ({ messages: [], memories: [] }),
        generateReply: async () => ({ text: "这个镜头好漂亮。", mode: "responses" }),
        saveMessage: async () => ({
            id: 101,
            conversation_id: "conversation-1",
            content: "这个镜头好漂亮。"
        }),
        touchConversation: async () => {},
        ensureDeliveryEvent: async (event) => delivered.push(event),
        recordSessionReaction: async () => ({
            id: frame.sessionId,
            status: "active"
        })
    });

    assert.equal(result.status, "created");
    assert.equal(delivered.length, 1, "后台共看回复生成后必须立即登记一次通知投递");
    assert.equal(delivered[0].messageId, 101);
    assert.equal(delivered[0].frame.sessionId, frame.sessionId);
    assert.equal(delivered[0].frame.sequence, frame.sequence);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
