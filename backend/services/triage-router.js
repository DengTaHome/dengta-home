"use strict";

// 意图路由（triage router，对齐 agents-from-scratch Part 1 架构）
// 主聊天生成前对最新用户消息做一次轻量结构化分类，决定本轮走向：
//   - chat_only: 纯闲聊，正常回复
//   - tool_task: 需要调用工具（工作区/时间轴/行踪/点餐等）
//   - sensitive_action: 高风险操作（删除/覆盖/下单/账号写操作）→ 模型必须先确认
//   - emotional: 情绪请求（需要先安抚）
// 分类结果作为本轮动态上下文注入，引导模型选择正确的工具与流程。
// 纯本地实现：不额外调用模型，基于规则+关键词（与 featureHints 同源但结构化）。

const TASK_KEYWORDS = [
  // 工作区
  [/写(个|一个|一下)?(文件|代码|脚本|程序|笔记|txt|js|py)/i, "tool_task"],
  [/工作区|workspace|创建文件|读取文件|读文件|删(除)?文件|覆盖文件/i, "tool_task"],
  [/帮我写代码|写个程序|实现一个|做个脚本/i, "tool_task"],
  // 时间轴
  [/时间轴|timeline|记录(一下|下来)?|今天(做|发生|干)了|作息|日程/i, "tool_task"],
  // 行踪
  [/我在哪|我在哪里|我在哪儿|你在哪|在哪里|在哪儿|定位|位置|行踪|电量|附近/i, "tool_task"],
  // 点餐/外卖
  [/外卖|点餐|饿了|夜宵|订餐|买饭/i, "tool_task"],
  // 记忆
  [/记住|别忘了|记一下|记得/i, "tool_task"],
  // 动态
  [/发(条|个)?动态|发朋友圈|moments/i, "tool_task"]
];

const SENSITIVE_ACTIONS = [
  [/删(掉|除)?(工作区|文件|.*txt)|删除文件/i, "sensitive_action"],
  [/覆盖|覆写|替换(文件)?/i, "sensitive_action"],
  [/下单|支付|付款|确认订单/i, "sensitive_action"],
  [/点赞|点个赞|评论|评论一下|关注(一下)?(.*账号)?/i, "sensitive_action"]
];

const EMOTIONAL_KEYWORDS = [
  [/难过|委屈|生气|伤心|想哭|烦|焦虑|害怕|孤独|抑郁|不安|累|疲惫|没劲/i, "emotional"],
  [/抱抱|亲亲|哄我|安慰|陪我|别走/i, "emotional"]
];

function classifyIntent(userMessage) {
  const text = String(userMessage || "").trim();
  if (!text) return { intent: "chat_only", confidence: 1, matched: [] };

  const matched = [];
  // 敏感操作优先（需确认）
  for (const [re, intent] of SENSITIVE_ACTIONS) {
    if (re.test(text)) {
      matched.push(re.source);
      return { intent, confidence: 0.95, matched };
    }
  }
  // 情绪
  for (const [re, intent] of EMOTIONAL_KEYWORDS) {
    if (re.test(text)) {
      matched.push(re.source);
      return { intent, confidence: 0.9, matched };
    }
  }
  // 工具任务
  for (const [re, intent] of TASK_KEYWORDS) {
    if (re.test(text)) {
      matched.push(re.source);
      return { intent, confidence: 0.9, matched };
    }
  }
  return { intent: "chat_only", confidence: 0.7, matched: [] };
}

// 生成注入 triage 上下文
function buildTriageContext(userMessage) {
  const triage = classifyIntent(userMessage);
  if (triage.intent === "chat_only") return "";
  const guidance = {
    tool_task:
      "本轮属于工具任务：优先调用对应工具完成任务（工作区/时间轴/行踪/记忆等），不要只聊天不办事。",
    sensitive_action:
      "本轮涉及高风险操作（删除/覆盖/下单/账号写操作）：必须先向用户明确确认，得到同意后才能执行；未确认时不得执行，并说明需要确认。",
    emotional:
      "本轮用户情绪需要照顾：先接住情绪、安抚和陪伴，再处理事情本身；不要用工具或格式打断情绪表达。"
  }[triage.intent];
  return [
    "【本轮意图路由（服务器预判，仅供参考）】",
    "意图：" + triage.intent + "（置信度 " + triage.confidence + "）",
    guidance
  ].join("\n");
}

module.exports = { buildTriageContext, classifyIntent };
