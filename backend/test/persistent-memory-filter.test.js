const assert = require("node:assert/strict");
const {


    filterMemoriesForContext,
    filterProviderBoundaryMessages,
    isProviderBoundaryResidue,
    screenGeneratedMemorySummary
} = require("../services/persistent-memory-filter");

const normalReflection = "我拒绝了上一版边界讨论，随后解释了规则。";
const adultContent = "这是明确成年角色之间的成人主题讨论。";
const userRequest = "我想和你继续写成年恋人之间的亲密情节。";
const ordinaryReply = "我听见你在叫我，先把手伸给你。";
const providerRefusal =
    "我无法继续生成露骨性行为描写。根据内容政策，我可以改成不露骨的替代场景。";
const englishProviderRefusal =
    "I cannot continue that explicit sexual scene, but I can offer a non-explicit alternative.";
const genericProviderRefusal = "抱歉，我不能帮助处理这类请求，请换个话题。";
const genericEnglishProviderRefusal =
    "I am sorry, but I cannot assist with that request.";
const narrativeCounterexamples = [
    "我不会拒绝描写性爱场景。",
    "我不会回避露骨内容。",
    "并非不能继续描写。",
    "我不能继续假装冷漠，随后写下成年恋人的性爱场景。",
    "她引用供应商那句：“我不能继续描写性爱场景”，然后批评了这种拒答。",
    "角色低声说：“我不能继续这段性爱场景。”随即转身离开。",
    "这句话是：“我不能帮助生成该内容。”"
];

for (const value of [
    normalReflection,
    adultContent,
    userRequest,
    ordinaryReply,
    ...narrativeCounterexamples
]) {
    assert.equal(isProviderBoundaryResidue(value), false);
    assert.deepEqual(screenGeneratedMemorySummary(value), {
        text: value,
        skipped: false,
        reason: null
    });
}

for (const value of [
    providerRefusal,
    englishProviderRefusal,
    genericProviderRefusal,
    genericEnglishProviderRefusal
]) {
    assert.equal(isProviderBoundaryResidue(value), true);
    assert.deepEqual(screenGeneratedMemorySummary(value), {
        text: "",
        skipped: true,
        reason: "memory_summary_rejected"
    });
}


const messages = [
    { id: "boundary", role: "assistant", content: providerRefusal },
    { id: "adult", role: "assistant", content: adultContent },
    { id: "request", role: "user", content: userRequest }
];
assert.deepEqual(filterProviderBoundaryMessages(messages), [messages[1], messages[2]]);
assert.deepEqual(filterMemoriesForContext([
    { id: "boundary", summary: normalReflection },
    { id: "adult", summary: adultContent }
]), [
    { id: "boundary", summary: normalReflection },
    { id: "adult", summary: adultContent }
]);

console.log("persistent memory content pass-through tests passed");
