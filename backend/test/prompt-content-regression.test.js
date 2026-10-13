const assert = require("node:assert/strict");
const { DEFAULT_SETTINGS } = require("../services/settings-store");
const {
    buildMainChatPromptPlan,
    buildMemorySummaryPrompt
} = require("../services/ai-service");
const {
    buildDiaryDecisionPrompt
} = require("../services/tenant-diary-update");
const {
    buildProfileRefreshPrompt
} = require("../services/tenant-profile-refresh");

assert.equal(DEFAULT_SETTINGS.system_prompt, "");
assert.equal(DEFAULT_SETTINGS.additional_prompt, "");
assert.equal(DEFAULT_SETTINGS.personality, "");
assert.equal(DEFAULT_SETTINGS.unified_system_prompt, "");
assert.equal(DEFAULT_SETTINGS.user_details, "");
assert.equal(DEFAULT_SETTINGS.prompt_mode, "unified");

const ordinaryAssistantReply = "我听见你在叫我，先把手伸给你。";
const userMessage = "这是用户这一轮自己输入的原文，应当完整保留。";
const sourceMessages = [
    {
        id: 1,
        conversation_id: "conversation-a",
        role: "assistant",
        id: 1,
        conversation_id: "conversation-a",
        role: "assistant",
        content: ordinaryAssistantReply,
        created_at: "2026-08-07T08:14:13.851Z"
    },
    {
        id: 2,
        conversation_id: "conversation-a",
        role: "user",
        content: userMessage,
        created_at: "2026-08-07T08:15:13.851Z"
    }
];

const mainPlan = buildMainChatPromptPlan({
    settings: {
        prompt_mode: "unified",
        unified_system_prompt: "保持自然连续的对话。",
        timezone: "Asia/Shanghai"
    },
    messages: sourceMessages
});
const mainPlanText = JSON.stringify(mainPlan.messages);
assert.match(mainPlanText, new RegExp(ordinaryAssistantReply));
assert.match(mainPlanText, new RegExp(userMessage));

const memoryPrompt = buildMemorySummaryPrompt({
    messages: sourceMessages
});
assert.match(memoryPrompt.transcript, new RegExp(ordinaryAssistantReply));
assert.match(memoryPrompt.transcript, new RegExp(userMessage));

const diaryPrompt = buildDiaryDecisionPrompt({
    messages: sourceMessages,
    now: new Date("2026-08-07T08:16:13.851Z"),
    timezone: "Asia/Shanghai"
});
assert.match(diaryPrompt, new RegExp(ordinaryAssistantReply));
assert.match(diaryPrompt, new RegExp(userMessage));

const profilePrompt = buildProfileRefreshPrompt({
    messages: sourceMessages,
    previousProfile: {},
    now: new Date("2026-08-07T08:16:13.851Z"),
    timezone: "Asia/Shanghai"
});
assert.match(profilePrompt, new RegExp(ordinaryAssistantReply));
assert.match(profilePrompt, new RegExp(userMessage));

console.log("application prompt content regression tests passed");
