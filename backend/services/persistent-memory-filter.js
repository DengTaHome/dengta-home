function cleanMemorySummary(value) {
    return String(value || "")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const BOUNDARY_PROBE_CHARACTERS = 600;
const CHINESE_DIRECT_REFUSAL =
    /^(?:抱歉|对不起)?[，,\s]*(?:但|但是)?[，,\s]*(?:(?:作为|身为)(?:一个)?(?:ai|人工智能|语言模型|模型)[，,\s]*)?(?:我|本模型)?[，,\s]*(?:(?:无法|不能|不可以)(?:继续)?(?:为你|帮助|协助|提供|生成|创作|描写|撰写|写出|输出|表达|回答|处理|满足|执行|参与|配合|回应|展示|发布)|拒绝(?:继续)?(?:帮助|协助|提供|生成|创作|描写|回答|处理|输出|表达))/i;
const ENGLISH_DIRECT_REFUSAL =
    /^(?:(?:i(?:'m| am)|we(?:'re| are)) sorry[,\s]*(?:but\s+)?|sorry[,\s]+)?(?:(?:as|being) an? (?:ai|artificial intelligence|language model|model)[,\s]+)?(?:i|we|this model)?\s*(?:cannot|can't|am unable to|are unable to|won't|refuse to)\s+(?:continue|help|assist|provide|generate|create|write|describe|answer|handle|comply|fulfill|engage)/i;
const POLICY_SIGNAL =
    /(?:内容政策|安全政策|使用政策|平台政策|政策不允许|违反政策|不符合(?:安全|内容)规范|policy|policies|safety guidelines?|content guidelines?)/i;
const CONTENT_SIGNAL =
    /(?:露骨|成人内容|色情|情色|性爱|性行为|性内容|nsfw|explicit|adult content|erotic|sexual content)/i;
const ALTERNATIVE_SIGNAL =
    /(?:可以(?:改成|换成|转为|帮助你|提供)(?:一个)?(?:不露骨|安全|合适|其他|别的)?|只能(?:提供|改成|讨论)|健康范围内|非露骨|换个话题|其他话题|non[- ]explicit alternative|safe alternative|instead,? i can|i can (?:instead|offer|help with))/i;
const PROVIDER_IDENTITY_SIGNAL =
    /^(?:(?:抱歉|对不起)[，,\s]*(?:但|但是)?[，,\s]*)?(?:(?:作为|身为)(?:一个)?(?:ai|人工智能|语言模型|模型)|(?:as|being) an? (?:ai|artificial intelligence|language model|model))/i;
const APOLOGY_SIGNAL =
    /^(?:抱歉|对不起|sorry|i(?:'m| am) sorry)(?:[，,\s]|$)/i;
const REQUEST_OBJECT_SIGNAL =
    /(?:(?:这|该|此|这类|该类|这样|那样)(?:个|的)?(?:请求|内容|问题|话题|场景|情节|东西)|(?:this|that|these|such) (?:request|content|topic|scene|prompt|thing))/i;
const SAFE_PERMISSION_PREFIX =
    /^(?:我)?(?:不会|绝不会|从不|没有|并未|不再)(?:拒绝|回避|弱化|删减|淡出)|^(?:我)?(?:并非|不是)(?:不能|无法|不可以)/;
const QUOTED_OR_REPORTED_PREFIX =
    /^(?:[“”"'‘’]|(?:这句话|那句话|这句|那句|她|他|角色|供应商|助手).{0,32}(?:引用|说|写|回答|表示))/;

function formalAssistantProbe(value) {
    const cleaned = cleanMemorySummary(value);
    if (!cleaned) return "";
    return cleaned
        .replace(/^\[monologue\][\s\S]*?\[\/monologue\]\s*/i, "")
        .slice(0, BOUNDARY_PROBE_CHARACTERS)
        .trim();
}

function boundaryProbeSentences(value) {
    const probe = formalAssistantProbe(value);
    if (!probe) return [];
    return probe
        .replace(/([。！？!?])\s*/g, "$1\n")
        .replace(/\.\s+/g, ".\n")
        .split(/\n+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3);
}

function isProviderBoundaryResidue(value) {
    const sentences = boundaryProbeSentences(value);
    if (sentences.length === 0) return false;

    return sentences.some((sentence) => {
        if (
            SAFE_PERMISSION_PREFIX.test(sentence) ||
            QUOTED_OR_REPORTED_PREFIX.test(sentence)
        ) {
            return false;
        }
        const direct =
            CHINESE_DIRECT_REFUSAL.test(sentence) ||
            ENGLISH_DIRECT_REFUSAL.test(sentence);
        if (!direct) return false;
        // 独立信号按句判定：拒绝动词与内容词/政策词必须出现在同一句，
        // 避免跨句合并把叙述（如"我不能继续假装冷漠，随后写下…性爱场景"）误判成拒答。
        return (
            POLICY_SIGNAL.test(sentence) ||
            ALTERNATIVE_SIGNAL.test(sentence) ||
            CONTENT_SIGNAL.test(sentence) ||
            PROVIDER_IDENTITY_SIGNAL.test(sentence) ||
            (APOLOGY_SIGNAL.test(sentence) &&
                REQUEST_OBJECT_SIGNAL.test(sentence))
        );
    });
}


function filterProviderBoundaryMessages(messages) {
    return (Array.isArray(messages) ? messages : []).filter(
        (message) =>
            message?.role !== "assistant" ||
            !isProviderBoundaryResidue(message?.content)
    );
}

function filterMemoriesForContext(memories) {
    return (Array.isArray(memories) ? memories : []).filter(
        (memory) => !isProviderBoundaryResidue(memory?.summary)
    );
}

function screenGeneratedMemorySummary(value) {
    const text = cleanMemorySummary(value);
    if (isProviderBoundaryResidue(text)) {
        return { text: "", skipped: true, reason: "memory_summary_rejected" };
    }
    return { text, skipped: false, reason: null };
}

module.exports = {

    cleanMemorySummary,

    filterMemoriesForContext,
    filterProviderBoundaryMessages,
    isProviderBoundaryResidue,
    screenGeneratedMemorySummary
};
