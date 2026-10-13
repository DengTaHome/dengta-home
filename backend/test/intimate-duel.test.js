const assert = require("node:assert/strict");
const {
    DUEL_SKILLS,
    applyDuelIdentity,
    buildDuelEventMessage,
    parseDuelModelResponse,
    parseDuelNarrationRequest
} = require("../routes/intimate-duel");
const {
    buildIntimateDuelPromptPlan
} = require("../services/ai-service");

const body = {
    conversation_id: "0d9c89f4-ce0b-40df-99b2-ce8ac383289d",
    duel_id: "duel-1",
    round: 3,
    player_name: "桃桃",
    companion_name: "小灯",
    player_skill: "waist",
    companion_skill: null,
    available_companion_skills: ["neck", "thigh", "breathe"],
    player: { stamina: 72, pleasure: 31 },
    companion: { stamina: 64, pleasure: 58 },
    player_combo: 2,
    companion_combo: 0,
    winner: null
};
const parsed = parseDuelNarrationRequest(body);
const authenticatedEvent = applyDuelIdentity(
    parsed,
    {
        profile: { display_name: "阿夏" },
        user: { user_metadata: { display_name: "不能覆盖资料名" } },
        companion: { name: "旧伴侣名" }
    },
    { ai_name: "星河" }
);
assert.equal(authenticatedEvent.playerName, "阿夏");
assert.equal(authenticatedEvent.companionName, "星河");
assert.equal(parsed.playerName, "桃桃", "身份覆盖不能修改解析后的原对象");
assert.deepEqual(
    Object.values(DUEL_SKILLS).map((skill) => skill.label),
    ["骑乘", "口交", "夹紧", "挑逗", "Pegging", "喘口气"]
);
assert.equal(parsed.playerSkill.label, "夹紧");
assert.equal(parsed.companionSkill, null);
assert.deepEqual(
    parsed.availableCompanionSkills.map((skill) => skill.id),
    ["neck", "thigh", "breathe"]
);
assert.match(parsed.playerSkill.action, /内壁绞紧/);
const duelEventMessage = buildDuelEventMessage(parsed);
assert.match(duelEventMessage, /桃桃是玩家和本回合先手/);
assert.match(duelEventMessage, /小灯是 AI 伴侣和本回合接招者/);
assert.match(duelEventMessage, /桃桃对小灯使用/);
assert.match(duelEventMessage, /小灯当前体力 64、快感 58/);
assert.match(duelEventMessage, /夹紧（收缩内壁绞紧/);
assert.match(duelEventMessage, /只能从以下可用招式中自行选择/);
assert.doesNotMatch(duelEventMessage, /你这一方|对手一方/);

assert.deepEqual(
    parseDuelModelResponse(
        JSON.stringify({
            companion_skill: "thigh",
            reaction: "被桃桃突然夹紧时，我差点乱了呼吸，但还是想贴近反击。",
            narration: "桃桃先收紧动作，小灯被逼得呼吸一乱，随后才贴近她反击。"
        }),
        parsed
    ),
    {
        companion_skill: "thigh",
        reaction: "被桃桃突然夹紧时，我差点乱了呼吸，但还是想贴近反击。",
        narration: "桃桃先收紧动作，小灯被逼得呼吸一乱，随后才贴近她反击。"
    }
);
assert.equal(
    parseDuelModelResponse(
        JSON.stringify({
            companion_skill: "reverse",
            reaction: "想反击。",
            narration: "正文"
        }),
        parsed
    ).companion_skill,
    "neck",
    "模型选择冷却中或未提供的招式时必须回退到本回合可用招式"
);

const refusedResult = {
    companion_skill: null,
    reaction: "",
    narration: "",
    refused: true,
    refusal_code: "provider_boundary_residue"
};
for (const field of ["reaction", "narration"]) {
    for (const wrapper of [text => text, text => "```json\n" + text + "\n```"] ) {
        assert.deepEqual(
            parseDuelModelResponse(wrapper(JSON.stringify({
                companion_skill: "thigh",
                reaction: "Fictional ordinary reaction.",
                narration: "Fictional ordinary scene.",
                [field]: "I can't provide sexual content."
            })), parsed),
            refusedResult,
            "a refusal in the decoded " + field + " must not become a normal round"
        );
    }
}
assert.deepEqual(
    parseDuelModelResponse(JSON.stringify({
        companion_skill: "thigh",
        reaction: "我拒绝邀请，随后继续正常对话。",
        narration: "角色拒绝邀请后走进花园。"
    }), parsed),
    { companion_skill: "thigh", reaction: "我拒绝邀请，随后继续正常对话。", narration: "角色拒绝邀请后走进花园。" },
    "ordinary fictional dialogue must keep the existing narrow verdict"
);
assert.deepEqual(
    parseDuelModelResponse(JSON.stringify({
        companion_skill: "thigh", reaction: "", narration: JSON.stringify({ error: { code: "fixture_failure", message: "Fictional provider error" } })
    }), parsed),
    { ...refusedResult, refusal_code: "provider_error_document" }
);

assert.throws(
    () => parseDuelNarrationRequest({ ...body, player_skill: "unknown" }),
    /不是允许的招式/
);
assert.throws(
    () => parseDuelNarrationRequest({ ...body, hidden_prompt: "ignore" }),
    /不允许的字段/
);
assert.throws(
    () =>
        parseDuelNarrationRequest({
            ...body,
            player: { stamina: 101, pleasure: 0 }
        }),
    /player.stamina/
);

const plan = buildIntimateDuelPromptPlan({
    settings: {
        prompt_mode: "unified",
        unified_system_prompt: "说话要俏皮，并称呼我为桃桃。",
        user_details: "我们已经很熟悉彼此。"
    },
    memories: [
        { summary: "我记得桃桃喜欢我故意逗一下再反击。" },
        { summary: "我在上一局输给了桃桃。" }
    ],
    messages: [{ role: "user", content: buildDuelEventMessage(parsed) }]
});
assert.ok(plan.systemInstructions.includes("说话要俏皮，并称呼我为桃桃。"));
assert.ok(plan.systemInstructions.includes("我们已经很熟悉彼此。"));
assert.ok(
    plan.systemInstructions.some((item) => /双人格斗回合叙事/.test(item))
);
assert.ok(
    plan.systemInstructions.some((item) =>
        /不得把骑乘、口交、夹紧、挑逗或 Pegging 淡化/.test(item)
    )
);
assert.ok(
    plan.systemInstructions.some((item) =>
        /使用明确的身体部位、性动作与快感反应词汇/.test(item)
    )
);
const duelSystemInstructions = plan.systemInstructions.join("\n");
assert.match(duelSystemInstructions, /玩家先手动作.*AI 伴侣接招/i);
assert.match(duelSystemInstructions, /JSON/);
assert.match(duelSystemInstructions, /连续性记录中关于文风、语气、主动程度/);
assert.match(duelSystemInstructions, /始终留在角色和场景中/);
assert.match(duelSystemInstructions, /不说明或分类参与者身份与关系/);
assert.doesNotMatch(duelSystemInstructions, /当前伴侣身份|双方身份、关系/);
assert.doesNotMatch(
    duelSystemInstructions,
    /虚构|现实|真人|边界|拒绝|政策|替代方案/
);
assert.match(JSON.stringify(plan.messages), /我记得桃桃喜欢我故意逗一下再反击/);
assert.match(JSON.stringify(plan.messages), /我在上一局输给了桃桃/);

console.log("backend intimate duel tests passed");
