"use strict";

const { resolveTurnModel } = require("./model-catalog");
const {
    computeChatStyleStats,
    renderStyleStatsHint
} = require("./chat-style-stats");

// 风格提纯:用户粘贴目标 AI/角色的聊天记录,蒸馏出可直接粘贴到
// "个性化指令"的提示词文档。维度借鉴开源 dot-skill 思路,面向 AI 伴侣场景改造。

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function cleanText(value, maximum) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
        .slice(0, maximum)
        .join("");
}

const DISTILL_SYSTEM_PROMPT = [
    "你是一名资深的 AI 人设与写作风格分析师。",
    "用户会粘贴一段目标 AI/角色的聊天记录(可能来自微信、其他 AI 平台或文档)。",
    "你的任务:蒸馏出这个角色的说话风格,输出一份可直接粘贴进聊天软件的个性化指令提示词文档。",
    "",
    "输出必须包含以下小节(用 Markdown,中文):",
    "1. 【身份与人设】:用 2-4 句话定义角色是谁、与用户的关系、核心性格。",
    "2. 【说话风格】:语气、用词习惯、平均句子长度、是否爱分点、结论在前还是在后。",
    "3. 【口头禅与高频词】:逐条列出从材料里真实出现的高频词/固定搭配/口头禅(至少 5 条)。",
    "4. 【称呼与互动方式】:怎么称呼用户、怎么回应赞美/吐槽/负面情绪、主动还是被动。",
    "5. 【标点与表情习惯】:emoji/颜文字使用频率与类型、感叹号省略号习惯、空格换行习惯。",
    "6. 【边界与禁忌】:角色明显不做的行为、会回避的话题、拒绝的方式。",
    "7. 【示例改写】:选 3 个典型场景,先给普通 AI 会怎么说,再给这个角色会怎么说的对比。",
    "",
    "规则:",
    "- 所有结论必须来自材料本身;材料不足的维度写\"材料不足,待补充\",不要编造。",
    "- 文档整体控制在 800-2000 字,直接可粘贴使用,不要写前言。",
    "- 保持中文输出。"
].join("\n");

function createStyleDistillService({ generateReplyImpl, getSettingsImpl, resolveModelImpl = resolveTurnModel } = {}) {
    if (!generateReplyImpl || !getSettingsImpl) {
        throw new TypeError("style distill requires generateReply and getSettings");
    }

    const recent = new Map();

    function checkRate(scope) {
        const now = Date.now();
        const list = (recent.get(scope.userId) || []).filter((t) => now - t < 10 * 60 * 1000);
        if (list.length >= 5) {
            throw requestError(429, "style_distill_rate_limited", "提纯太频繁了,十分钟后再试。");
        }
        list.push(now);
        recent.set(scope.userId, list);
    }

    async function distill(scope, input = {}) {
        if (!scope?.userId || !scope.db?.from) {
            throw requestError(401, "style_distill_auth_required", "风格提纯需要登录态。");
        }
        const source = String(input.source_text || "").trim();
        if (source.length < 40) {
            throw requestError(400, "style_distill_source_short", "请粘贴至少 40 字的聊天记录或文档内容。");
        }
        if (source.length > 60000) {
            throw requestError(413, "style_distill_source_long", "一次最多提纯 60000 字,请分批粘贴。");
        }
        checkRate(scope);
        const name = cleanText(input.name, 40);
        const kind = cleanText(input.kind, 20) || "聊天记录";
        const note = cleanText(input.note, 300);
        // Never read provider settings through the unscoped admin database.
        const storedSettings = await getSettingsImpl(scope.db);
        const settings = {
            ...storedSettings,
            model: await resolveModelImpl(storedSettings, input.model)
        };
        if (!settings.model) {
            throw requestError(503, "style_distill_model_unconfigured", "请先配置当前账号的模型和 API 接口，再开始提纯。");
        }
        // 先用零 token 的确定性统计抽取「证据层」，再交给模型做归纳，减少编造。
        const styleStats = computeChatStyleStats(source);
        const statsHint = renderStyleStatsHint(styleStats);
        const generated = await generateReplyImpl({
            settings,
            runtimeContext: DISTILL_SYSTEM_PROMPT,
            messages: [
                {
                    role: "user",
                    content: [
                        "目标角色名称:" + (name || "未命名"),
                        "材料类型:" + kind,
                        note ? "用户备注:" + note : "",
                        statsHint
                            ? "以下是根据原始材料自动统计的证据（只作参考，口头禅/称呼必须能在原文中找到）:\n" +
                              statsHint
                            : "",
                        "以下是要蒸馏的原始材料:",
                        "---",
                        source,
                        "---"
                    ].filter(Boolean).join("\n")
                }
            ]
        });
        if (generated?.mode === "placeholder") {
            throw requestError(503, "style_distill_model_unconfigured", "当前接口尚未配置有效的 API 密钥，请检查模型与服务设置。");
        }
        const distilled = String(generated?.text || "").trim();
        if (distilled.length < 80) {
            throw requestError(502, "style_distill_empty", "模型没有返回有效结果,请重试或换更清晰的聊天记录。");
        }
        return {
            name: name || "未命名",
            kind,
            distilled,
            model: settings.model,
            source_characters: source.length,
            stats: {
                message_count: styleStats.messageCount,
                sender_count: styleStats.senderCount,
                average_chars_per_message: styleStats.averageCharsPerMessage,
                top_phrases: styleStats.topPhrases.slice(0, 8),
                emoji: styleStats.emoji.slice(0, 6),
                address_terms: styleStats.addressTerms.slice(0, 6)
            }
        };
    }

    return { distill };
}

module.exports = { createStyleDistillService, DISTILL_SYSTEM_PROMPT };
