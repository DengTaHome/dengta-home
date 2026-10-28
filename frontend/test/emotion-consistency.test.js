// 情绪理解开关一致性（产品口径：关闭后历史情绪标签也隐藏，数据保留）
// 真机行为由 tools/browser-verify/verify-emotion-toggle.mjs 覆盖。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (name) => fs.readFileSync(path.join(SRC, name), "utf8");

const app = read("App.jsx");
const message = read("ChatMessage.jsx");
const transcript = read("ChatTranscript.jsx");

// 消息组件必须接收并遵守开关
assert.match(message, /showEmotion\s*=\s*true/, "ChatMessage 需要 showEmotion 开关（默认开，兼容旧调用）");
assert.match(
  message,
  /\{showEmotion && item\.voiceAnalysis && \(/,
  "关闭情绪理解后，历史消息里的语音情绪标签必须隐藏",
);

// App 必须把真实状态传下来
assert.match(
  app,
  /showEmotion=\{emotionUnderstandingEnabled\}/,
  "聊天记录必须收到真实的情绪理解开关状态",
);
assert.match(
  app,
  /dengta_emotion_understanding_enabled/,
  "开关仍按账号维度持久化",
);

// 最近一次语音分析卡片：关闭时不显示情绪/置信度，但仍保留转写
assert.match(
  app,
  /emotionUnderstandingEnabled \? \(\s*<span>\s*\{lastVoiceAnalysis\.emotion\}/s,
  "关闭后分析卡不能继续显示情绪与置信度",
);
assert.match(app, /情绪理解已关闭，只保留这次语音的文字转写。/, "关闭后需要明确说明只保留转写");
assert.match(app, /关闭情绪理解后，历史消息里的情绪标签也会隐藏/, "设置页要说明历史标签行为");

// 转写记录与上下文传递链路不变
assert.match(transcript, /<ChatMessage \{\.\.\.props\}/, "ChatTranscript 必须把开关透传给 ChatMessage");
assert.match(app, /emotion_understanding_enabled: emotionUnderstandingEnabled/, "请求仍带情绪理解开关");

// 关闭后提示条也不能泄露情绪/置信度（外部裁判发现的漏点）
assert.match(
  app,
  /emotionUnderstandingEnabledRef\.current/,
  "提示语要读当前开关（覆盖请求在途时切换）",
);
assert.match(
  app,
  /语音已转写。情绪理解已关闭，这次只记录文字。/,
  "关闭后提示条必须只说转写，不出现情绪线索",
);

// thinking 状态文案：关闭时不能声称"理解语音和情绪"
assert.match(app, /正在理解语音…/, "关闭情绪理解后状态文案要同步调整");

// 历史缓存必须保留语音情绪元数据（否则重载首屏会丢标签）
const cache = read("chat-history-cache.js");
assert.match(cache, /voice_analysis/, "缓存需要保留 tool_calls 里的语音元数据");
assert.match(cache, /trimmed\.voiceAnalysis/, "缓存需要保留已 hydrate 的 top-level 情绪分析");

// 语音表单请求必须带开关（false 时后端不再据此生成情绪上下文）
assert.match(
  app,
  /buildVoiceTurnFormData\(\{[\s\S]{0,500}?emotionUnderstandingEnabled/,
  "语音轮次请求必须带情绪理解开关",
);

console.log("emotion-consistency: 结构断言通过");
