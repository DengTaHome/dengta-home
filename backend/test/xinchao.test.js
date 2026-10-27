const assert = require("node:assert/strict");

const {
    DRIVE_DEFINITIONS,
    CALM_EMOTION_LABEL,
    BOOST_WINDOW_HOURS,
    MATERIAL_DELTA,
    decayTowardBaseline,
    conversationBoost,
    deriveDrives,
    deriveEmotionLabel,
    deriveConsciousness,
    deriveXinchaoState,
    hasMaterialChange,
    createXinchaoService
} = require("../services/xinchao");

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-10-27T12:00:00.000Z");

// 一个够用的 scoped database 替身：只实现心潮用到的链式调用。
function createFakeScope({ row = null, conversations = [] } = {}) {
    const state = { row, conversations, writes: [] };

    const from = (table) => {
        if (table === "conversations") {
            const query = {
                select: () => query,
                order: () => query,
                limit: async () => ({ data: state.conversations, error: null })
            };
            return query;
        }

        const query = {
            select: () => query,
            order: () => query,
            limit: async () => ({ data: state.row ? [state.row] : [], error: null }),
            maybeSingle: async () => ({ data: state.row, error: null }),
            upsert: async (values) => {
                state.writes.push(values);
                state.row = { ...(state.row || {}), ...values };
                return { error: null };
            }
        };
        return query;
    };

    return {
        scope: { userId: "user-1", companionId: "companion-1", db: { from } },
        state
    };
}

// --- 衰减 ---

assert.equal(
    decayTowardBaseline(0.8, 0.2, 12, 12).toFixed(3),
    "0.500",
    "one half-life closes half the distance to baseline"
);

assert.equal(
    decayTowardBaseline(0.8, 0.2, 12, 0),
    0.8,
    "zero elapsed time must not change the value"
);

assert.equal(
    decayTowardBaseline(0.05, 0.6, 12, 240).toFixed(3),
    "0.600",
    "long idle converges to baseline, never past it"
);

assert.ok(
    decayTowardBaseline(5, 0.2, 12, 0) === 1,
    "out-of-range stored values are clamped to 1"
);

// --- 对话抬升 ---

assert.equal(conversationBoost(0), 0.25, "right after a conversation the boost is maximal");
assert.equal(conversationBoost(BOOST_WINDOW_HOURS), 0, "boost is gone once the window closes");
assert.equal(conversationBoost(null), 0, "no conversation history means no boost");
assert.ok(
    conversationBoost(1) < conversationBoost(0) && conversationBoost(1) > 0,
    "boost decays monotonically inside the window"
);

// --- 驱动项推导 ---

const idle = deriveDrives({ storedDrives: null, lastConversationAt: null, stateUpdatedAt: null, now: NOW });
assert.equal(idle.length, DRIVE_DEFINITIONS.length, "every defined drive is present");
assert.ok(
    idle.every((drive) => drive.value >= 0 && drive.value <= 1),
    "drive values stay inside 0..1"
);
assert.deepEqual(
    idle.map((drive) => drive.key),
    DRIVE_DEFINITIONS.map((drive) => drive.key),
    "drive order follows the definition list"
);
assert.ok(
    idle.every((drive) => drive.value <= 0.34),
    "a never-used account sits at or below baseline, i.e. calm"
);

const justChatted = deriveDrives({
    storedDrives: null,
    lastConversationAt: new Date(NOW.getTime() - 60 * 1000),
    stateUpdatedAt: null,
    now: NOW
});
assert.ok(
    justChatted.every((drive, index) => drive.value > idle[index].value),
    "a fresh conversation lifts every drive"
);

const longAgo = deriveDrives({
    storedDrives: { curiosity: 0.9 },
    lastConversationAt: new Date(NOW.getTime() - 240 * HOUR),
    stateUpdatedAt: new Date(NOW.getTime() - 240 * HOUR),
    now: NOW
});
assert.ok(
    longAgo.find((drive) => drive.key === "curiosity").value < 0.4,
    "a high stored value decays back toward baseline after days of silence"
);

// --- 情绪标签 ---

assert.equal(
    deriveEmotionLabel([{ key: "curiosity", value: 0.55 }]),
    "好奇",
    "dominant curiosity surfaces as 好奇"
);
assert.equal(
    deriveEmotionLabel([
        { key: "crave", value: 0.2 },
        { key: "monitor", value: 0.19 }
    ]),
    CALM_EMOTION_LABEL,
    "everything below the threshold reads as 平静"
);
assert.equal(
    deriveEmotionLabel([{ key: "unknown_drive", value: 0.9 }]),
    CALM_EMOTION_LABEL,
    "an unknown drive never produces an invented label"
);

// --- 清醒状态：只允许 'awake' 或 null ---

assert.equal(
    deriveConsciousness(new Date(NOW.getTime() - 1 * HOUR), NOW),
    "awake",
    "a conversation an hour ago means awake"
);
assert.equal(
    deriveConsciousness(new Date(NOW.getTime() - 30 * HOUR), NOW),
    null,
    "a conversation 30 hours ago must be null, never an English token the UI would print raw"
);
assert.equal(deriveConsciousness(null, NOW), null, "no history means null");

// --- 落库判定 ---

const previousRow = {
    drives: { curiosity: 0.5 },
    emotion_label: "好奇",
    consciousness: "awake",
    revision: 3
};
assert.equal(
    hasMaterialChange(null, { drives: [], emotionLabel: "平静", consciousness: null }),
    true,
    "first read always writes"
);
assert.equal(
    hasMaterialChange(
        { ...previousRow, drives: { curiosity: 0.5 }, emotion_label: "好奇", consciousness: "awake" },
        {
            drives: [{ key: "curiosity", value: 0.5 }],
            emotionLabel: "好奇",
            consciousness: "awake"
        }
    ),
    false,
    "an unchanged state must not bump the revision on every poll"
);
assert.equal(
    hasMaterialChange(previousRow, {
        drives: [{ key: "curiosity", value: 0.5 + MATERIAL_DELTA }],
        emotionLabel: "好奇",
        consciousness: "awake"
    }),
    true,
    "drift at or above the material delta is persisted"
);
assert.equal(
    hasMaterialChange(previousRow, {
        drives: [{ key: "curiosity", value: 0.5 }],
        emotionLabel: "平静",
        consciousness: "awake"
    }),
    true,
    "an emotion change alone is material"
);

// --- 服务层 ---

(async () => {
    // 第一次读取：没有存量行，必须写入并给出 revision 1
    {
        const { scope, state } = createFakeScope({
            conversations: [{ updated_at: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString() }]
        });
        const service = createXinchaoService({ database: {}, now: () => NOW });
        const payload = await service.getState({ scope });

        assert.equal(payload.configured, true, "the endpoint reports the feature as configured");
        assert.equal(payload.state.revision, 1, "first materialised state is revision 1");
        assert.ok(Array.isArray(payload.state.drives), "drives is an array");
        assert.ok(
            payload.state.drives.every((drive) => typeof drive.key === "string" && typeof drive.label === "string"),
            "each drive carries key and label for the capsule title"
        );
        assert.equal(payload.state.consciousness, "awake", "a conversation 30 minutes ago counts as awake");
        assert.equal(typeof payload.state.emotion.label, "string", "emotion carries a label");
        assert.equal(state.writes.length, 1, "the first read persists exactly once");
        assert.equal(state.writes[0].revision, 1, "the persisted revision matches the response");
        assert.equal(
            state.writes[0].last_conversation_at,
            new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(),
            "the conversation timestamp is carried into the stored row"
        );
    }

    // 第二次读取：状态没变，不许把 revision 顶上去
    {
        const { scope, state } = createFakeScope({ conversations: [] });
        const service = createXinchaoService({ database: {}, now: () => NOW });

        const first = await service.getState({ scope });
        const writesAfterFirst = state.writes.length;
        assert.equal(writesAfterFirst, 1, "the materialising read writes once");

        const second = await service.getState({ scope });
        assert.equal(second.state.revision, first.state.revision, "an unchanged read keeps the stored revision");
        assert.equal(state.writes.length, writesAfterFirst, "an unchanged read performs no write");
    }

    // 数据库异常时要降级，不能把页面打挂
    {
        const scope = {
            userId: "u",
            companionId: "c",
            db: {
                from: () => ({
                    select: () => ({
                        order: () => ({ limit: async () => ({ data: null, error: { message: "offline" } }) }),
                        maybeSingle: async () => ({ data: null, error: { message: "offline" } })
                    }),
                    upsert: async () => ({ error: { message: "offline" } })
                })
            }
        };
        const warnings = [];
        const service = createXinchaoService({
            database: {},
            now: () => NOW,
            logger: { warn: (...args) => warnings.push(args.join(" ")) }
        });
        const payload = await service.getState({ scope });

        assert.equal(payload.configured, true, "a transient database failure still answers");
        assert.ok(payload.state.drives.length > 0, "fallback state is still renderable");
        assert.ok(warnings.length >= 2, "both failed lookups are logged");
    }

    console.log(
        "Xinchao state: decay, conversation boost, emotion labelling, awake window, revision dedupe and degraded reads passed"
    );
})();
