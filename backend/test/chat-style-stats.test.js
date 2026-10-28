/**
 * 聊天风格统计测试（零 token 证据层）。
 */
"use strict";

const assert = require("node:assert/strict");
const {
    computeChatStyleStats,
    renderStyleStatsHint,
    splitMessages,
    topPhrases
} = require("../services/chat-style-stats");

const TRANSCRIPT = [
    "小明: 今天好累啊，不想加班了……",
    "小美: 抱抱你，晚上早点睡呀 🥺",
    "小明: 嗯嗯，听你的！",
    "小美: 那说好了，不许熬夜哦 (｡•́︿•̀｡)",
    "小明: 知道啦知道啦",
    "小美: 明天给你带你爱吃的芋泥波波奶茶，好不好呀",
    "小明: 好呀好呀，你最好了"
].join("\n");

function main() {
    const { messages, droppedLines } = splitMessages(TRANSCRIPT);
    assert.equal(messages.length, 7);
    assert.equal(messages[0].sender, "小明");
    assert.match(messages[0].content, /今天好累/);
    assert.equal(droppedLines, 0);

    const stats = computeChatStyleStats(TRANSCRIPT);
    assert.equal(stats.messageCount, 7);
    assert.equal(stats.senderCount, 2);
    const xiaoming = stats.messagesBySender.find((item) => item.sender === "小明");
    const xiaomei = stats.messagesBySender.find((item) => item.sender === "小美");
    assert.equal(xiaoming.count, 4);
    assert.equal(xiaomei.count, 3);
    assert.equal(stats.messagesBySender[0].sender, "小明");
    assert.ok(stats.averageCharsPerMessage > 0);
    assert.ok(stats.sentence.count >= 5);
    assert.ok(stats.emoji.some((item) => item.value === "🥺"));
    assert.ok(stats.kaomoji.some((item) => item.value.includes("•́")));
    assert.ok(stats.addressTerms.some((item) => item.term === "你"));
    assert.ok(stats.topPhrases.some((item) => item.value.includes("好呀")));
    assert.ok(stats.punctuation.ellipsis >= 1);
    assert.ok(stats.evidence.length >= 2);
    assert.equal(stats.evidence[0].sender, "小明");

    const hint = renderStyleStatsHint(stats);
    assert.match(hint, /材料统计：7 条消息/);
    assert.match(hint, /高频/);
    assert.match(hint, /代表性原句/);

    // 通用 JSON 转录（带 [时间] 前缀）也能拆分
    const withTimes = [
        "[2024-01-01 12:00] 小明: 你好",
        "[2024-01-01 12:01] 小美: 晚上好呀，今天辛苦啦"
    ].join("\n");
    const timed = computeChatStyleStats(withTimes);
    assert.equal(timed.messageCount, 2);
    assert.equal(timed.senderCount, 2);

    // 空输入/无发送者不崩
    assert.equal(computeChatStyleStats("").messageCount, 0);
    assert.equal(renderStyleStatsHint(null), "");
    const plain = computeChatStyleStats("只有一段没有发送者的内容，也应当被当成一条消息。");
    assert.equal(plain.messageCount, 1);
    assert.equal(plain.messagesBySender[0].sender, "未署名");

    // 高频短语按出现次数排序
    const phrases = topPhrases("抱抱抱抱 晚安晚安晚安 hello hello hello");
    assert.ok(phrases.length >= 2);
    assert.ok(phrases[0].count >= 2);

    // 原始微信/QQ 文本（时间行 + 发送者）也能正确统计，不把时间当发送者
    const rawWechat = [
        "2024-01-01 12:00:00 小明",
        "今天好累啊",
        "2024-01-01 12:01:00 小美",
        "抱抱你，早点睡",
        "2024-01-01 12:02:00 小明",
        "12:30 老地方见"
    ].join("\n");
    const rawStats = computeChatStyleStats(rawWechat);
    assert.equal(rawStats.messageCount, 3);
    assert.equal(rawStats.senderCount, 2);
    assert.ok(rawStats.messagesBySender.every((item) => !item.sender.includes("2024")));
    assert.ok(rawStats.messagesBySender.some((item) => item.sender === "小明" && item.count === 2));

    console.log("chat style stats tests passed");
}

main();
