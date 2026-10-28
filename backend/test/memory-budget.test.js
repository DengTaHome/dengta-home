const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
    DEFAULT_MEMORY_CHAR_BUDGET,
    lexicalRelevance,
    memoryBudgetEnabled,
    selectMemoriesForContext
} = require("../services/memory-budget");

assert.equal(memoryBudgetEnabled("false"), false);
assert.equal(memoryBudgetEnabled("off"), false);
assert.equal(memoryBudgetEnabled("0"), false);
assert.equal(memoryBudgetEnabled(""), true);

const now = new Date("2026-08-02T03:30:00+08:00");
const memories = [
    {
        id: "recent-noise",
        summary: "我刚才随口提到桌面上有一支蓝色的笔。",
        updated_at: "2026-08-02T03:20:00+08:00"
    },
    {
        id: "old-relevant",
        summary:
            "我记得对方已经搬到杭州，之后讨论天气、出行和日程时都应该以杭州的生活为背景。",
        updated_at: "2026-04-01T08:00:00+08:00"
    },
    {
        id: "warm-preference",
        summary: "我记得对方一直喜欢早餐喝热牛奶，不喜欢冰饮。",
        updated_at: "2026-07-30T08:00:00+08:00"
    },
    {
        id: "long-memory",
        summary: `我想记住这段很长的经历：${"重要细节".repeat(180)}`,
        updated_at: "2026-07-29T08:00:00+08:00"
    }
];

const selected = selectMemoriesForContext(memories, {
    query: "杭州今天下雨，我出门要带伞吗？",
    now,
    maxItems: 3,
    charBudget: 260
});

assert.equal(selected[0].id, "old-relevant");
assert.ok(selected.some((memory) => memory.id === "warm-preference"));
assert.ok(selected.length <= 3);
assert.ok(
    selected.reduce(
        (total, memory) => total + Array.from(memory.summary).length,
        0
    ) <= 260,
    "selected memory text must stay inside the explicit prompt budget"
);
assert.ok(
    selected.every(
        (memory) =>
            Number.isFinite(memory.recall_score) &&
            Number.isFinite(memory.heat)
    )
);

const defaultBudgetSelection = selectMemoriesForContext(memories, {
    query: "早餐喝什么？",
    now
});
assert.ok(defaultBudgetSelection.length > 0);
assert.ok(
    defaultBudgetSelection.reduce(
        (total, memory) => total + Array.from(memory.summary).length,
        0
    ) <= DEFAULT_MEMORY_CHAR_BUDGET
);
assert.equal(
    lexicalRelevance("早餐", "早。餐"),
    0,
    "CJK bigrams must not cross punctuation boundaries"
);

const contextSource = fs.readFileSync(
    require.resolve("../services/context-reset"),
    "utf8"
);
assert.match(contextSource, /selectMemoriesForContext/);
assert.match(contextSource, /memoryBudgetEnabled/);
assert.match(contextSource, /useMemoryBudget \? 80 : 12/);


// 网关（kiwi-mem）已经算好热度：必须直接采用，不能被本地半衰期重算覆盖。
// 场景：一条 200 天前的旧记忆，网关刚因为它被想起而把 heat 升到 0.95；
// 本地公式按 updated_at 算只会给出接近 0 的热度。若采用网关热度，它应当排在最前。
const gatewayHeated = [
    {
        id: "gateway-hot",
        summary: "我记得对方小时候养过一只叫豆豆的猫。",
        updated_at: "2026-01-01T00:00:00+08:00",
        heat: 0.95,
        importance: 6
    },
    {
        id: "local-fresh",
        summary: "我刚才随口提到桌面上有一支蓝色的笔。",
        updated_at: "2026-08-02T03:20:00+08:00"
    }
];
const heatedSelection = selectMemoriesForContext(gatewayHeated, {
    query: "豆豆",
    now,
    maxItems: 2,
    charBudget: 400
});
assert.equal(heatedSelection[0].id, "gateway-hot", "网关热度必须优先于本地重算");
assert.ok(heatedSelection[0].heat >= 0.9, "选中的热度应保留网关值");

// 网关标记为冷（heat < 0.3）且与查询无关的记忆不应打扰上下文
const coldGateway = [
    {
        id: "gateway-cold",
        summary: "很久以前提过一次的某个无关话题。",
        updated_at: "2026-08-02T03:20:00+08:00",
        heat: 0.05
    }
];
assert.deepEqual(
    selectMemoriesForContext(coldGateway, { query: "杭州天气", now, maxItems: 5, charBudget: 400 }),
    [],
    "冷且无关的网关记忆不应注入"
);

console.log("budgeted memory recall tests passed");
