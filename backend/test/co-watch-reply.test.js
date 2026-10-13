const assert = require("node:assert/strict");
const { runCoWatchQuickReply } = require("../services/co-watch-replies");

const sessionId = "2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50";
const requestId = "4a5107cc-cf3f-4d03-9b42-58dac533e9bb";

async function main() {
    const calls = [];
    const worldBookContext = {
        beforeMemoryInstruction: "共看回复世界书前置参考",
        dynamicContext: "共看回复世界书动态参考",
        receipt: { applied_count: 1 }
    };
    const result = await runCoWatchQuickReply({
        database: { from() {} },
        sessionId,
        input: {
            text: "这个镜头刚才吓我一跳",
            request_id: requestId,
            media_position_seconds: 95
        },
        findSession: async () => ({
            id: sessionId,
            status: "active",
            conversation_id: "conversation-1",
            cadence_seconds: 90
        }),
        findUserMessage: async () => null,
        findAssistantReply: async () => null,
        getSettings: async () => ({ ai_name: "小灯", model: "vision-model" }),
        saveMessage: async (conversationId, role, content, options) => {
            calls.push(["save", conversationId, role, content, options]);
            return {
                id: role === "user" ? 101 : 102,
                conversation_id: conversationId,
                role,
                content,
                tool_calls: options.tool_calls
            };
        },
        loadChatContext: async () => ({
            messages: [
                { role: "user", content: "这个镜头刚才吓我一跳" }
            ],
            memories: []
        }),
        resolveWorldBookContext: async (input) => {
            calls.push(["world-book", input]);
            return worldBookContext;
        },
        generateReply: async (input) => {
            calls.push(["generate", input]);
            return { text: "我也被突然冒出来的画面吓到了。", mode: "responses" };
        },
        touchConversation: async () => calls.push(["touch"]),
        ensureDeliveryEvent: async (input) => calls.push(["delivery", input]),
        recordSessionReply: async (input) => {
            calls.push(["record", input]);
            return { id: sessionId, status: "active", reaction_count: 1 };
        }
    });

    assert.equal(result.status, "created");
    assert.equal(result.request_id, requestId);
    assert.equal(result.reaction, "我也被突然冒出来的画面吓到了。");
    assert.equal(result.notification.kind, "co_watch");
    assert.equal(calls.filter((call) => call[0] === "world-book").length, 1);
    assert.equal(calls.find((call) => call[0] === "generate")[1].worldBookContext, worldBookContext);
    assert.equal(calls.filter((call) => call[0] === "save").length, 2);
    const userSave = calls.find(
        (call) => call[0] === "save" && call[2] === "user"
    );
    assert.equal(userSave[4].client_message_id, requestId);
    assert.equal(userSave[4].tool_calls.co_watch_session_id, sessionId);
    const assistantSave = calls.find(
        (call) => call[0] === "save" && call[2] === "assistant"
    );
    assert.equal(assistantSave[4].tool_calls.is_push, true);
    assert.equal(
        assistantSave[4].tool_calls.reply_to_client_message_id,
        requestId
    );
    assert.equal(calls.filter((call) => call[0] === "delivery").length, 1);

    let generatedAgain = false;
    const replayed = await runCoWatchQuickReply({
        database: { from() {} },
        sessionId,
        input: { text: "这个镜头刚才吓我一跳", request_id: requestId },
        findSession: async () => ({
            id: sessionId,
            status: "active",
            conversation_id: "conversation-1"
        }),
        findUserMessage: async () => ({
            id: 101,
            conversation_id: "conversation-1",
            content: "这个镜头刚才吓我一跳"
        }),
        findAssistantReply: async () => ({
            id: 102,
            conversation_id: "conversation-1",
            content: "我也被突然冒出来的画面吓到了。"
        }),
        getSettings: async () => ({ ai_name: "小灯" }),
        saveMessage: async () => {
            throw new Error("replay must not save duplicate messages");
        },
        loadChatContext: async () => ({}),
        generateReply: async () => {
            generatedAgain = true;
        },
        touchConversation: async () => {},
        ensureDeliveryEvent: async () => {},
        recordSessionReply: async () => ({ id: sessionId, status: "active" })
    });
    assert.equal(replayed.status, "replayed");
    assert.equal(generatedAgain, false);

    const resumedCalls = [];
    const resumed = await runCoWatchQuickReply({
        database: { from() {} },
        sessionId,
        input: { text: "这个镜头刚才吓我一跳", request_id: requestId },
        findSession: async () => ({
            id: sessionId,
            status: "active",
            conversation_id: "conversation-1"
        }),
        findUserMessage: async () => ({
            id: 101,
            conversation_id: "conversation-1",
            content: "这个镜头刚才吓我一跳"
        }),
        findAssistantReply: async () => null,
        getSettings: async () => ({ ai_name: "小灯" }),
        saveMessage: async (conversationId, role, content, options) => {
            resumedCalls.push(["save", role]);
            assert.equal(role, "assistant", "重试不能重复保存用户消息");
            return {
                id: 103,
                conversation_id: conversationId,
                role,
                content,
                tool_calls: options.tool_calls
            };
        },
        loadChatContext: async () => ({ messages: [], memories: [] }),
        generateReply: async () => ({
            text: "刚才中断了，我也被那个镜头吓到了。",
            mode: "responses"
        }),
        touchConversation: async () => {},
        ensureDeliveryEvent: async () => {},
        recordSessionReply: async () => ({ id: sessionId, status: "active" })
    });
    assert.equal(resumed.status, "created");
    assert.equal(resumed.reaction, "刚才中断了，我也被那个镜头吓到了。");
    assert.deepEqual(resumedCalls, [["save", "assistant"]]);

    let assistantLookup = 0;
    const concurrent = await runCoWatchQuickReply({
        database: { from() {} },
        sessionId,
        input: { text: "这个镜头刚才吓我一跳", request_id: requestId },
        findSession: async () => ({
            id: sessionId,
            status: "active",
            conversation_id: "conversation-1"
        }),
        findUserMessage: async () => ({
            id: 101,
            conversation_id: "conversation-1",
            content: "这个镜头刚才吓我一跳"
        }),
        findAssistantReply: async () => {
            assistantLookup += 1;
            return assistantLookup === 1
                ? null
                : {
                      id: 104,
                      conversation_id: "conversation-1",
                      content: "另一条并发请求已经生成好了。"
                  };
        },
        getSettings: async () => ({ ai_name: "小灯" }),
        saveMessage: async (_conversationId, role) => {
            assert.equal(role, "assistant");
            throw Object.assign(new Error("duplicate reply"), { code: "23505" });
        },
        loadChatContext: async () => ({ messages: [], memories: [] }),
        generateReply: async () => ({ text: "并发生成的内容" }),
        touchConversation: async () => {
            throw new Error("losing concurrent request must not touch twice");
        },
        ensureDeliveryEvent: async () => {},
        recordSessionReply: async () => {
            throw new Error("losing concurrent request must not count twice");
        }
    });
    assert.equal(concurrent.status, "replayed");
    assert.equal(concurrent.assistant_message.id, 104);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
