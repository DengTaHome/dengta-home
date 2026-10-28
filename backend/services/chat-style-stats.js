/**
 * 聊天记录风格统计（确定性、零 token）。
 *
 * 目的：在调用 LLM 蒸馏之前，先把“可量化、可引用”的证据抽出来，喂给蒸馏 prompt，
 * 降低模型编造、提升精细度。也用于导入页/蒸馏页给用户展示“这份材料到底能提炼出什么”。
 *
 * 输入是自适应解析器输出的规范化文本（每行 `发送者: 内容`，可带时间戳行）。
 * 输出纯 JSON，便于缓存/测试/前端展示；不依赖分词服务，中文用字符 n-gram 近似。
 */
"use strict";

const MAX_INPUT_CHARS = 1_000_000;
const SENTENCE_ENDS = /[。！？!?…∼~]+/;

const { parseMessengerText } = require("./adaptive-file-parser");

const STOPWORDS = new Set([
    "的", "了", "是", "我", "你", "他", "她", "它", "们", "在", "有", "和", "就",
    "不", "也", "都", "还", "又", "很", "太", "吗", "呢", "吧", "啊", "呀", "哦",
    "嗯", "哈", "这", "那", "什么", "怎么", "一个", "没有", "可以", "就是", "觉得",
    "然后", "但是", "因为", "所以", "如果", "而且", "还是", "已经", "自己", "现在",
    "今天", "真的", "感觉", "一下", "有点", "其实", "应该", "知道", "想要", "时候",
    "the", "and", "you", "that", "this", "with", "have", "for", "not", "are",
    "was", "but", "what", "just", "like", "your", "from", "they", "will", "can"
]);

const ADDRESS_TERMS = [
    "宝贝", "宝宝", "亲爱的", "老婆", "老公", "主人", "先生", "小姐", "姐姐", "哥哥",
    "妹妹", "弟弟", "孩子", "小家伙", "小可爱", "傻瓜", "笨蛋", "你", "您", "大大"
];

const KAOMOJI_RE = /(\([^()\n]{1,16}\)|（[^（）\n]{1,16}）)/g;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

function cleanLine(value) {
    return String(value || "").replace(/\uFEFF/g, "").replace(/\s+$/g, "").trim();
}

/**
 * 把规范文本拆成消息：`发送者: 内容`；支持 QQ/微信常见的“时间戳行 + 内容行”。
 * 返回 {messages, droppedLines}。
 */
function isValidSenderName(name, content) {
    const sender = String(name || "").trim();
    if (!sender || sender.length > 40) return false;
    if (/^\d{1,2}:\d{2}/.test(sender)) return false;
    if (/^\d+$/.test(sender)) return false;
    if (/^[\[(]/.test(sender)) return false;
    if (/https?:|www\./i.test(sender)) return false;
    if (/^(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|NOTICE|FATAL)$/i.test(sender)) return false;
    if (/^[\d\s:：/-]+$/.test(sender)) return false;
    // "时间 发送者" 或整行被误当发送者时，内容为空且名字里带时间 → 不是发送者
    if (!content && /\d{1,2}:\d{2}/.test(sender)) return false;
    return true;
}

function splitMessages(text) {
    // 原始微信/QQ/WhatsApp 文本先规范化成 `发送者: 内容`，避免把时间戳当发送者
    const normalized = parseMessengerText(String(text || "")) || String(text || "");
    const lines = normalized.split(/\r?\n/);
    const messages = [];
    let current = null;
    let dropped = 0;
    const flush = () => {
        if (current && current.content.trim()) messages.push(current);
        current = null;
    };
    for (const raw of lines) {
        // 解析器产出的 `[2024-01-01 12:00] 发送者: 内容`：先去掉时间前缀，避免把时间里的冒号当分隔符
        const line = cleanLine(raw).replace(/^\[[^\]]{1,40}\]\s*/, "");
        if (!line) {
            flush();
            continue;
        }
        // 时间戳行（只有时间/日期，或“时间 发送者”无内容）→ 作为下一条消息时间
        const timestampOnly = line.match(
            /^(?:\[\s*)?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}:\d{2}(?::\d{2})?)(?:\s*\])?$/
        );
        if (timestampOnly) {
            flush();
            dropped += 1;
            continue;
        }
        const senderMatch = line.match(/^([^\s:：][^:：]{0,39}?)\s*[:：]\s*(.*)$/);
        if (senderMatch && isValidSenderName(senderMatch[1], senderMatch[2])) {
            flush();
            current = {
                sender: senderMatch[1].trim(),
                content: senderMatch[2].trim()
            };
            continue;
        }
        if (current) current.content += (current.content ? "\n" : "") + line;
        else {
            current = { sender: "", content: line };
        }
    }
    flush();
    return { messages, droppedLines: dropped };
}

function countBy(items) {
    const map = new Map();
    for (const item of items) map.set(item, (map.get(item) || 0) + 1);
    return [...map.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
        .map(([value, count]) => ({ value, count }));
}

function cjkNgrams(text, sizes = [2, 3]) {
    const counts = new Map();
    const runs = String(text || "").match(/[\u3400-\u9fff]+/g) || [];
    for (const run of runs) {
        for (const size of sizes) {
            for (let i = 0; i + size <= run.length; i += 1) {
                const gram = run.slice(i, i + size);
                if (STOPWORDS.has(gram)) continue;
                counts.set(gram, (counts.get(gram) || 0) + 1);
            }
        }
    }
    return counts;
}

function latinWords(text) {
    return (String(text || "").toLowerCase().match(/[a-z][a-z0-9'_]{1,24}/g) || [])
        .filter((word) => !STOPWORDS.has(word));
}

function topPhrases(text, limit = 12) {
    const merged = new Map();
    for (const [gram, count] of cjkNgrams(text)) {
        merged.set(gram, (merged.get(gram) || 0) + count);
    }
    for (const word of latinWords(text)) {
        merged.set(word, (merged.get(word) || 0) + 1);
    }
    return [...merged.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
        .slice(0, limit)
        .map(([value, count]) => ({ value, count }));
}

function sentenceLengths(text) {
    const sentences = String(text || "")
        .split(/[。！？!?…∼~]+|\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
    if (!sentences.length) return { count: 0, average: 0, longRatio: 0 };
    const lengths = sentences.map((sentence) => Array.from(sentence).length);
    const average = lengths.reduce((sum, n) => sum + n, 0) / lengths.length;
    const longRatio = lengths.filter((n) => n >= 40).length / lengths.length;
    return {
        count: sentences.length,
        average: Math.round(average * 10) / 10,
        longRatio: Math.round(longRatio * 100) / 100
    };
}

function perSenderStats(messages) {
    const bySender = new Map();
    for (const message of messages) {
        const key = message.sender || "未署名";
        const entry = bySender.get(key) || { sender: key, count: 0, chars: 0, samples: [] };
        entry.count += 1;
        entry.chars += Array.from(message.content).length;
        if (entry.samples.length < 3 && message.content.length >= 8) {
            entry.samples.push(message.content.slice(0, 160));
        }
        bySender.set(key, entry);
    }
    return [...bySender.values()]
        .map((entry) => ({ ...entry, averageChars: Math.round((entry.chars / entry.count) * 10) / 10 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
}

/**
 * 计算风格统计。
 * @param {string} text 规范化聊天文本
 * @param {{maxEvidence?: number}} options
 */
function computeChatStyleStats(text, options = {}) {
    const source = String(text || "").slice(0, MAX_INPUT_CHARS);
    const { messages } = splitMessages(source);
    const joined = messages.map((message) => message.content).join("\n");
    const stats = {
        chars: Array.from(source).length,
        messageCount: messages.length,
        senderCount: new Set(messages.map((m) => m.sender || "未署名")).size,
        messagesBySender: perSenderStats(messages),
        averageCharsPerMessage:
            messages.length > 0
                ? Math.round(
                      (messages.reduce((sum, m) => sum + Array.from(m.content).length, 0) /
                          messages.length) *
                          10
                  ) / 10
                : 0,
        sentence: sentenceLengths(joined),
        topPhrases: topPhrases(joined),
        punctuation: {
            question: (joined.match(/[?？]/g) || []).length,
            exclamation: (joined.match(/[!！]/g) || []).length,
            ellipsis: (joined.match(/…|\.{3,}|。{2,}/g) || []).length,
            comma: (joined.match(/[，,]/g) || []).length,
            newlineInsideMessage: messages.filter((m) => m.content.includes("\n")).length
        },
        emoji: countBy([...joined.matchAll(EMOJI_RE)].map((m) => m[0])).slice(0, 15),
        kaomoji: countBy([...joined.matchAll(KAOMOJI_RE)].map((m) => m[1])).slice(0, 10),
        addressTerms: ADDRESS_TERMS.map((term) => ({
            term,
            count: (joined.match(new RegExp(term, "g")) || []).length
        }))
            .filter((item) => item.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 8),
        evidence: messages
            .filter((message) => Array.from(message.content).length >= 10)
            .slice(0, options.maxEvidence || 12)
            .map((message) => ({
                sender: message.sender || "未署名",
                text: message.content.slice(0, 200)
            }))
    };
    return stats;
}

/**
 * 把统计结果渲染成一段“证据层”提示词，注入蒸馏 prompt。
 */
function renderStyleStatsHint(stats) {
    if (!stats || !stats.messageCount) return "";
    const lines = [
        `材料统计：${stats.messageCount} 条消息，${stats.senderCount} 个说话人，平均每条 ${stats.averageCharsPerMessage} 字，` +
            `平均句长 ${stats.sentence.average} 字，长句占比 ${Math.round(stats.sentence.longRatio * 100)}%。`,
        stats.messagesBySender.length
            ? "发言分布：" +
              stats.messagesBySender
                  .slice(0, 5)
                  .map((item) => `${item.sender} ${item.count} 条/均 ${item.averageChars} 字`)
                  .join("；")
            : "",
        stats.topPhrases.length
            ? "高频词/短语（可能含口头禅，需结合原文判断）：" +
              stats.topPhrases.map((item) => `${item.value}×${item.count}`).join("、")
            : "",
        stats.emoji.length
            ? "高频 emoji：" + stats.emoji.map((item) => `${item.value}×${item.count}`).join("、")
            : "",
        stats.kaomoji.length
            ? "高频颜文字：" + stats.kaomoji.map((item) => `${item.value}×${item.count}`).join("、")
            : "",
        stats.addressTerms.length
            ? "称呼词：" + stats.addressTerms.map((item) => `${item.term}×${item.count}`).join("、")
            : "",
        `标点习惯：问号 ${stats.punctuation.question} 次，感叹号 ${stats.punctuation.exclamation} 次，` +
            `省略号 ${stats.punctuation.ellipsis} 次，逗号 ${stats.punctuation.comma} 次，` +
            `含换行消息 ${stats.punctuation.newlineInsideMessage} 条。`,
        "代表性原句（仅作证据，不要逐字模仿）："
    ].filter(Boolean);
    for (const item of stats.evidence.slice(0, 6)) {
        lines.push(`- ${item.sender}：${item.text}`);
    }
    return lines.join("\n");
}

module.exports = {
    ADDRESS_TERMS,
    STOPWORDS,
    computeChatStyleStats,
    renderStyleStatsHint,
    splitMessages,
    topPhrases
};
