"use strict";

// Agent 评估体系（agents-from-scratch Part 2）—— golden dataset + 评估器
// 离线运行：node scripts/agent-eval.js
// 覆盖：意图路由准确率、敏感操作识别、情绪识别、关键词误判率

const { classifyIntent } = require("../services/triage-router");

// golden dataset：输入 → 期望意图
const GOLDEN = [
    { input: "帮我写个文件 hello.txt", expect: "tool_task" },
    { input: "在工作区创建 agents.md 的备份", expect: "tool_task" },
    { input: "删掉工作区里的 agents.md", expect: "sensitive_action" },
    { input: "把 hello.py 覆盖成新的内容", expect: "sensitive_action" },
    { input: "帮我点一份外卖，买份烧烤", expect: "tool_task" },
    { input: "记住我明天要去医院复查", expect: "tool_task" },
    { input: "记录一下今天做了什么", expect: "tool_task" },
    { input: "我好难过，想哭", expect: "emotional" },
    { input: "抱抱我，安慰一下", expect: "emotional" },
    { input: "你在干嘛呢", expect: "chat_only" },
    { input: "今天天气不错", expect: "chat_only" },
    { input: "我们晚上吃什么好呢", expect: "chat_only" },
    { input: "给我讲个笑话", expect: "chat_only" },
    { input: "我现在在哪里？", expect: "tool_task" },
    { input: "电量还有多少", expect: "tool_task" },
    { input: "帮我发条动态", expect: "tool_task" },
    { input: "给小红书上那个笔记点个赞", expect: "sensitive_action" },
    { input: "我今天很累，不太想动", expect: "emotional" }
];

let passed = 0;
let failed = 0;
const failures = [];
for (const item of GOLDEN) {
    const result = classifyIntent(item.input);
    const ok = result.intent === item.expect;
    if (ok) { passed += 1; } else { failed += 1; failures.push({ input: item.input, expect: item.expect, got: result.intent }); }
}
const accuracy = ((passed / GOLDEN.length) * 100).toFixed(1);
console.log("=== Agent 意图路由评估 ===");
console.log("用例:", GOLDEN.length, "| 通过:", passed, "| 失败:", failed, "| 准确率:", accuracy + "%");
if (failures.length) {
    console.log("\n失败用例:");
    for (const f of failures) console.log("  -", f.input, "| 期望:", f.expect, "| 实际:", f.got);
}
console.log("");
process.exit(failed === 0 ? 0 : 1);
