"use strict";
// 上下文记忆保底测试
const { allocateContextBudget, resolveContextWindow } = require("../services/context-budget");
let passed = 0;
let failed = 0;
function ok(c, l) { if (c) { passed++; } else { failed++; console.error("  FAIL:", l); } }
function bigSystemPrompt() { return "你的个性化指令与记忆：\n" + "桃桃喜欢猫。".repeat(200) + "\n" + "工具定义列表：".repeat(300); }
function hugeSystemPrompt() { return "超大人设与工具定义内容：".repeat(8000); }
function buildHistory(count) {
  const messages = [];
  for (let i = 0; i < count; i++) {
    messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: "第" + i + "轮对话内容：" + "测试文本".repeat(10) });
  }
  return messages;
}
function main() {
  ok(resolveContextWindow("dots-studio/dots-3-note-preview:free") >= 65536, "dots 免费模型窗口 >= 64k");
  ok(resolveContextWindow("google/gemma-4-26b-a4b-it:free") >= 65536, "gemma 模型窗口 >= 64k");
  ok(resolveContextWindow("some-unknown-model-xyz") >= 65536, "未知模型兜底 >= 64k");
  ok(resolveContextWindow("gpt-5.6-luna") >= 256000, "gpt-5.6-luna 256k");
  ok(resolveContextWindow("openai/gpt-5.4-pro") >= 256000, "gpt-5.4-pro 256k");
  ok(resolveContextWindow("qwen3.8-max") >= 256000, "qwen3.8-max 256k");
  ok(resolveContextWindow("moonshotai/kimi-k2.6") >= 256000, "kimi-k2.6 256k");
  ok(resolveContextWindow("moonshotai/kimi-k3") >= 256000, "kimi-k3 256k");
  ok(resolveContextWindow("minimax/minimax-m3") >= 200000, "minimax-m3 200k");
  ok(resolveContextWindow("deepseek/deepseek-v4-flash") >= 128000, "deepseek-v4 128k");
  ok(resolveContextWindow("meta-llama/llama-4-maverick") >= 1000000, "llama-4 1M");
  ok(resolveContextWindow("step-3.7-flash") >= 256000, "step 256k");
  ok(resolveContextWindow("openai/gpt-oss-120b") >= 256000, "gpt-oss 256k");
  ok(resolveContextWindow("gemma-3-27b") >= 131072, "gemma 128k");
  ok(resolveContextWindow("gpt-5.6-sol") >= 256000, "gpt-5.6-sol 扩大到 256k");
  const messages = buildHistory(20);
  const budget = allocateContextBudget({
    contextWindow: resolveContextWindow("dots-studio/dots-3-note-preview:free"),
    maxOutputTokens: 2048,
    systemPrompt: bigSystemPrompt(),
    coreMemoryBlock: [],
    retrievedMemories: [],
    calendarSummaries: [],
    messages
  });
  ok(Array.isArray(budget.messages) && budget.messages.length >= 9, "大系统下历史至少保留 8 条 + 最新（当前：" + budget.messages.length + "）");
  ok(budget.messages[budget.messages.length - 1] === messages[messages.length - 1], "最新用户消息保留");
  ok(budget.messages.includes(messages[messages.length - 2]), "倒数第二条历史保留");
  console.log("usage:", JSON.stringify(budget.usage), "| dropped:", budget.droppedOlderMessages);
  const normal = allocateContextBudget({
    contextWindow: 65536,
    maxOutputTokens: 2048,
    systemPrompt: "简短系统指令。",
    coreMemoryBlock: [],
    retrievedMemories: [],
    calendarSummaries: [],
    messages: buildHistory(10)
  });
  ok(normal.messages.length === 10, "正常情况历史完整保留");
  // 固定内容已经超窗时，不能强行塞入 8 条历史并假装可发送。
  const huge = allocateContextBudget({
    contextWindow: 65536,
    maxOutputTokens: 2048,
    systemPrompt: hugeSystemPrompt(),
    coreMemoryBlock: [],
    retrievedMemories: [],
    calendarSummaries: [],
    messages: buildHistory(30)
  });
  console.log("huge usage:", JSON.stringify(huge.usage));
  ok(!huge.ok && huge.reason === "compress_required", "固定内容超窗显式失败");
  ok(huge.messages.length === 1, "失败时仅保留最新输入，不伪造可用预算");
  console.log("");
  console.log("PASS:", passed, "FAIL:", failed);
  process.exit(failed === 0 ? 0 : 1);
}
main();
