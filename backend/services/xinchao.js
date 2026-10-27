/**
 * 心潮 (xinchao) —— 伴侣情绪的连续状态。
 *
 * 线上契约（从生产前端产物中还原）：
 *   GET /api/v2/xinchao/state
 *   -> { configured: boolean, state: null | {
 *          emotion: { label: string },
 *          drives: [{ key, label, value }],   // value 0..1，前端按 value 降序取前 5
 *          consciousness: 'awake' | null,     // 非 'awake' 必须为 null，否则前端会显示英文原文
 *          revision: number,
 *          lastConversationAt: string | null
 *      }}
 *
 * 模型：两个分量相加，结果夹在 0..1。
 *   1. 长期分量：存在表里的水位，按半衰期向基线回归。
 *   2. 短期分量：距上次对话越近，整体抬升越多，3 小时后归零。
 *
 * 纯函数，不读时钟、不读全局状态，时间一律由调用方传入 —— 这样测试可复现。
 */

const HOUR_MS = 60 * 60 * 1000;

const TABLE = "companion_xinchao_state";

// 每个驱动项的半衰期不同：好奇衰减最快，思念最慢。
// baseline 是「安静一整天之后」会回到的水位。
// 所有 baseline 都刻意压在 CALM_THRESHOLD 之下 —— 不聊天时状态就是「平静」，
// 只有刚聊过天（抬升 +0.25）才会越过阈值显出具体情绪。
// 键名与标签逐字对齐线上：GET /api/v2/xinchao/state 实际返回的
// drives 就是这 13 个键，前端 App 包里的标签表是
//   possess 想靠近 / monitor 惦记 / share 想分享 / libido 渴望 /
//   curiosity 好奇 / social 想聊 / crave 馋 / boredom 空落 /
//   reflection 想心事 / grieve 难过 / anger 生气 /
//   safety 安全感 / confidence 自信
// 其中 duty 与 favored 在标签表里没有条目，线上一律回退成键名本身，
// 这里保持一致（label 直接写成键名）。
//
// 对齐键名不只是好看：线上的真实数据就是用这些键存的，键名不一致会导致
// 读不到用户已有的心潮水位。
//
// 注意：线上是服务端模型，具体的衰减曲线无法从打包产物里还原，
// 下面的 baseline / halfLifeHours 是本实现自己的近似，不是线上原值。
const DRIVE_DEFINITIONS = Object.freeze([
    Object.freeze({ key: "possess", label: "想靠近", baseline: 0.3, halfLifeHours: 72 }),
    Object.freeze({ key: "monitor", label: "惦记", baseline: 0.22, halfLifeHours: 48 }),
    Object.freeze({ key: "share", label: "想分享", baseline: 0.28, halfLifeHours: 16 }),
    Object.freeze({ key: "libido", label: "渴望", baseline: 0.2, halfLifeHours: 24 }),
    Object.freeze({ key: "curiosity", label: "好奇", baseline: 0.3, halfLifeHours: 16 }),
    Object.freeze({ key: "social", label: "想聊", baseline: 0.26, halfLifeHours: 20 }),
    Object.freeze({ key: "crave", label: "馋", baseline: 0.18, halfLifeHours: 12 }),
    Object.freeze({ key: "boredom", label: "空落", baseline: 0.14, halfLifeHours: 8 }),
    Object.freeze({ key: "reflection", label: "想心事", baseline: 0.2, halfLifeHours: 40 }),
    Object.freeze({ key: "grieve", label: "难过", baseline: 0.1, halfLifeHours: 120 }),
    Object.freeze({ key: "anger", label: "生气", baseline: 0.08, halfLifeHours: 6 }),
    Object.freeze({ key: "duty", label: "duty", baseline: 0.22, halfLifeHours: 48 }),
    Object.freeze({ key: "favored", label: "favored", baseline: 0.24, halfLifeHours: 60 })
]);

const EMOTION_BY_DRIVE = Object.freeze({
    possess: "想靠近",
    monitor: "惦记",
    share: "想分享",
    libido: "渴望",
    curiosity: "好奇",
    social: "想聊",
    crave: "馋",
    boredom: "空落",
    reflection: "想心事",
    grieve: "难过",
    anger: "生气",
    duty: "踏实",
    favored: "被偏爱"
});

const CALM_EMOTION_LABEL = "平静";
// 主导驱动项低于这个水位时，不认为有明确情绪，回落为「平静」。
// 必须高于任一 baseline，否则空闲状态永远显示不出「平静」。
const CALM_THRESHOLD = 0.34;
// 距上次对话 6 小时内算「醒着」。超过就返回 null，让前端显示「心潮流动」。
const AWAKE_WINDOW_HOURS = 6;
const BOOST_WINDOW_HOURS = 3;
const BOOST_MAX = 0.25;
// 变化小于这个量级不落库，避免每分钟轮询都把 revision 顶上去。
const MATERIAL_DELTA = 0.02;

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function round3(value) {
    return Math.round(clamp01(value) * 1000) / 1000;
}

function toTime(value) {
    if (!value) return null;
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
}

function hoursBetween(fromTime, toTimeMs) {
    if (fromTime === null || toTimeMs === null || !Number.isFinite(toTimeMs)) return null;
    const hours = (toTimeMs - fromTime) / HOUR_MS;
    return hours > 0 ? hours : 0;
}

/**
 * 向基线做指数回归。halfLifeHours 小时后，与基线的距离减半。
 */
function decayTowardBaseline(value, baseline, halfLifeHours, hours) {
    const start = clamp01(value);
    if (!Number.isFinite(hours) || hours <= 0) return start;
    if (!Number.isFinite(halfLifeHours) || halfLifeHours <= 0) return clamp01(baseline);
    const factor = Math.pow(0.5, hours / halfLifeHours);
    return clamp01(baseline + (start - baseline) * factor);
}

/**
 * 刚聊过天带来的整体抬升，BOOST_WINDOW_HOURS 小时后线性归零。
 */
function conversationBoost(hoursSinceConversation) {
    if (hoursSinceConversation === null) return 0;
    if (hoursSinceConversation >= BOOST_WINDOW_HOURS) return 0;
    return (1 - hoursSinceConversation / BOOST_WINDOW_HOURS) * BOOST_MAX;
}

function deriveDrives({ storedDrives, lastConversationAt, stateUpdatedAt, now }) {
    const nowMs = toTime(now);
    const hoursSinceConversation = hoursBetween(toTime(lastConversationAt), nowMs);
    const hoursSinceState = hoursBetween(toTime(stateUpdatedAt), nowMs);
    const boost = conversationBoost(hoursSinceConversation);

    return DRIVE_DEFINITIONS.map((definition) => {
        const stored = Number(storedDrives?.[definition.key]);
        const start = Number.isFinite(stored) ? clamp01(stored) : definition.baseline;
        const decayed = decayTowardBaseline(
            start,
            definition.baseline,
            definition.halfLifeHours,
            hoursSinceState
        );
        return {
            key: definition.key,
            label: definition.label,
            value: round3(decayed + boost)
        };
    });
}

function dominantDrive(drives) {
    if (!Array.isArray(drives) || drives.length === 0) return null;
    return drives.reduce((best, item) => (item.value > best.value ? item : best), drives[0]);
}

function deriveEmotionLabel(drives) {
    const dominant = dominantDrive(drives);
    if (!dominant || dominant.value < CALM_THRESHOLD) return CALM_EMOTION_LABEL;
    return EMOTION_BY_DRIVE[dominant.key] || CALM_EMOTION_LABEL;
}

function deriveConsciousness(lastConversationAt, now) {
    const hours = hoursBetween(toTime(lastConversationAt), toTime(now));
    if (hours === null) return null;
    return hours <= AWAKE_WINDOW_HOURS ? "awake" : null;
}

function drivesToRecord(drives) {
    const record = {};
    for (const drive of drives) record[drive.key] = drive.value;
    return record;
}

/**
 * 不落库的纯推导：给定存储行与上次对话时间，算出此刻状态。
 * revision 由调用方决定（只有真正写库时才 +1）。
 */
function deriveXinchaoState({ stored, lastConversationAt, now }) {
    const drives = deriveDrives({
        storedDrives: stored?.drives,
        lastConversationAt: lastConversationAt || stored?.last_conversation_at || null,
        stateUpdatedAt: stored?.updated_at || null,
        now
    });

    return {
        drives,
        drivesRecord: drivesToRecord(drives),
        emotionLabel: deriveEmotionLabel(drives),
        consciousness: deriveConsciousness(
            lastConversationAt || stored?.last_conversation_at || null,
            now
        ),
        lastConversationAt: lastConversationAt || stored?.last_conversation_at || null
    };
}

function hasMaterialChange(stored, next) {
    if (!stored) return true;
    if ((stored.emotion_label || CALM_EMOTION_LABEL) !== next.emotionLabel) return true;
    if ((stored.consciousness ?? null) !== (next.consciousness ?? null)) return true;

    const previous = stored.drives || {};
    for (const drive of next.drives) {
        const before = Number(previous[drive.key]);
        if (!Number.isFinite(before)) return true;
        if (Math.abs(before - drive.value) >= MATERIAL_DELTA) return true;
    }
    return false;
}

function toPublicState(next, revision) {
    return {
        emotion: { label: next.emotionLabel },
        drives: next.drives,
        // 只有 'awake' 或 null —— 前端会把非 awake 的原值直接显示出来。
        consciousness: next.consciousness,
        revision,
        lastConversationAt: next.lastConversationAt
    };
}

function createXinchaoService({ database, now = () => new Date(), logger = console } = {}) {
    if (!database) throw new Error("createXinchaoService requires a database client.");

    async function readLastConversationAt(scope) {
        const { data, error } = await scope.db
            .from("conversations")
            .select("updated_at")
            .order("updated_at", { ascending: false })
            .limit(1);
        if (error) {
            // 心潮是装饰性状态，读不到不该让整个页面报错。
            logger.warn?.("[xinchao] last conversation lookup failed:", error.message || error);
            return null;
        }
        const row = Array.isArray(data) ? data[0] : data;
        return row?.updated_at || null;
    }

    async function readStoredState(scope) {
        const { data, error } = await scope.db
            .from(TABLE)
            .select("drives, emotion_label, consciousness, revision, last_conversation_at, updated_at")
            .maybeSingle();
        if (error) {
            logger.warn?.("[xinchao] state lookup failed:", error.message || error);
            return null;
        }
        return data || null;
    }

    async function persist(scope, next, revision) {
        const { error } = await scope.db.from(TABLE).upsert({
            drives: next.drivesRecord,
            emotion_label: next.emotionLabel,
            consciousness: next.consciousness,
            revision,
            last_conversation_at: next.lastConversationAt,
            updated_at: new Date().toISOString()
        });
        if (error) {
            logger.warn?.("[xinchao] state persist failed:", error.message || error);
        }
    }

    async function getState({ scope }) {
        const [stored, lastConversationAt] = await Promise.all([
            readStoredState(scope),
            readLastConversationAt(scope)
        ]);

        const next = deriveXinchaoState({ stored, lastConversationAt, now: now() });
        const previousRevision = Number(stored?.revision) || 0;
        const changed = hasMaterialChange(stored, next);

        if (changed) await persist(scope, next, previousRevision + 1);

        return {
            configured: true,
            state: toPublicState(next, changed ? previousRevision + 1 : previousRevision)
        };
    }

    return { getState };
}

module.exports = {
    DRIVE_DEFINITIONS,
    CALM_EMOTION_LABEL,
    AWAKE_WINDOW_HOURS,
    BOOST_WINDOW_HOURS,
    MATERIAL_DELTA,
    TABLE,
    clamp01,
    decayTowardBaseline,
    conversationBoost,
    deriveDrives,
    deriveEmotionLabel,
    deriveConsciousness,
    deriveXinchaoState,
    hasMaterialChange,
    createXinchaoService
};
