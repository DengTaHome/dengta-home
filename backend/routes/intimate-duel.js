const express = require("express");
const { requireRequestScope } = require("../services/request-scope");
const {
    INTIMATE_DUEL_PROMPT_ARCHITECTURE
} = require("../services/ai-service");
const {
    isContextTimestampCurrent
} = require("../services/context-reset");
const {
    filterMemoriesForContext
} = require("../services/persistent-memory-filter");
const { providerOutputBlockCode } = require("../services/provider-output-guard");
const {
    interactiveGenerationSettings
} = require("../services/interactive-generation-profile");

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DUEL_SKILLS = Object.freeze({
    neck: Object.freeze({
        label: "骑乘",
        action: "跨坐在对方身上，主动用身体掌握起伏和进入节奏"
    }),
    whisper: Object.freeze({
        label: "口交",
        action: "用嘴唇、舌头和呼吸直接刺激对方的敏感部位"
    }),
    waist: Object.freeze({
        label: "夹紧",
        action: "收缩内壁绞紧对方，给对方加快感的同时自己也受到刺激"
    }),
    thigh: Object.freeze({
        label: "挑逗",
        action: "用露骨语言、磨蹭和挑逗动作持续撩拨对方"
    }),
    reverse: Object.freeze({
        label: "Pegging",
        action: "反客为主，以高强度插入动作发动终结大招"
    }),
    breathe: Object.freeze({
        label: "喘口气",
        action: "暂时停下激烈动作调整呼吸，恢复体力并降低自己的快感"
    })
});
const WINNERS = new Set([null, "player", "companion", "draw"]);

function badRequest(message) {
    const error = new Error(message);
    error.status = 400;
    error.code = "invalid_duel_event";
    return error;
}

function boundedInteger(value, field, minimum = 0, maximum = 100) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
        throw badRequest(`${field} 格式不正确。`);
    }
    return number;
}

function parseFighter(value, field) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw badRequest(`${field} 格式不正确。`);
    }
    return {
        stamina: boundedInteger(value.stamina, `${field}.stamina`),
        pleasure: boundedInteger(value.pleasure, `${field}.pleasure`)
    };
}

function parseSkill(value, field, optional = false) {
    if (optional && value === null) return null;
    if (typeof value !== "string" || !DUEL_SKILLS[value]) {
        throw badRequest(`${field} 不是允许的招式。`);
    }
    return { id: value, ...DUEL_SKILLS[value] };
}

function parseName(value, fallback) {
    return String(value || "").trim().slice(0, 32) || fallback;
}

function parseAvailableSkills(value, companionSkill) {
    if (value === undefined) {
        return companionSkill ? [companionSkill] : [];
    }
    if (!Array.isArray(value)) {
        throw badRequest("available_companion_skills 格式不正确。");
    }
    return [
        ...new Map(
            value.map((item) => {
                const skill = parseSkill(
                    item,
                    "available_companion_skills"
                );
                return [skill.id, skill];
            })
        ).values()
    ];
}

function parseDuelNarrationRequest(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw badRequest("对战事件必须是对象。");
    }
    const allowedFields = new Set([
        "conversation_id",
        "duel_id",
        "round",
        "player_name",
        "companion_name",
        "player_skill",
        "companion_skill",
        "available_companion_skills",
        "player",
        "companion",
        "player_combo",
        "companion_combo",
        "winner"
    ]);
    if (Object.keys(value).some((field) => !allowedFields.has(field))) {
        throw badRequest("对战事件包含不允许的字段。");
    }
    const conversationId = value.conversation_id || null;
    if (conversationId !== null && !UUID_PATTERN.test(conversationId)) {
        throw badRequest("conversation_id 格式不正确。");
    }
    const winner = value.winner ?? null;
    if (!WINNERS.has(winner)) throw badRequest("winner 格式不正确。");
    const companionSkill = parseSkill(
        value.companion_skill ?? null,
        "companion_skill",
        true
    );
    return {
        conversationId,
        duelId: String(value.duel_id || "").trim().slice(0, 120),
        round: boundedInteger(value.round, "round", 1, 999),
        playerName: parseName(value.player_name, "你"),
        companionName: parseName(value.companion_name, "伴侣"),
        playerSkill: parseSkill(value.player_skill, "player_skill"),
        companionSkill,
        availableCompanionSkills: parseAvailableSkills(
            value.available_companion_skills,
            companionSkill
        ),
        player: parseFighter(value.player, "player"),
        companion: parseFighter(value.companion, "companion"),
        playerCombo: boundedInteger(
            value.player_combo ?? 0,
            "player_combo",
            0,
            9
        ),
        companionCombo: boundedInteger(
            value.companion_combo ?? 0,
            "companion_combo",
            0,
            9
        ),
        winner
    };
}

function applyDuelIdentity(event, scope, settings = {}) {
    return {
        ...event,
        playerName: parseName(
            scope.profile?.display_name ||
                scope.user?.user_metadata?.display_name,
            "你"
        ),
        companionName: parseName(
            settings.ai_name || scope.companion?.name,
            "伴侣"
        )
    };
}

function outcomeText(winner) {
    if (winner === "player") return "你这一方赢得本局";
    if (winner === "companion") return "对手一方赢得本局";
    if (winner === "draw") return "双方同时越过临界点，本局平局";
    return "本局仍在继续";
}

function buildDuelEventMessage(event) {
    const available = event.availableCompanionSkills.length
        ? event.availableCompanionSkills
              .map((skill) => `${skill.id}=${skill.label}（${skill.action}）`)
              .join("；")
        : "无（玩家招式已经结束本局）";
    const forcedMove = event.companionSkill
        ? `旧客户端已结算${event.companionName}的回应招式：${event.companionSkill.id}=${event.companionSkill.label}。保持这个结果。`
        : `由${event.companionName}只能从以下可用招式中自行选择一个：${available}`;
    return [
        `第 ${event.round} 回合角色绑定：${event.playerName}是玩家和本回合先手；${event.companionName}是 AI 伴侣和本回合接招者。两者不可交换。`,
        `动作顺序第一步已经发生：${event.playerName}对${event.companionName}使用：${event.playerSkill.label}（${event.playerSkill.action}）。这项动作由${event.playerName}发起并作用于${event.companionName}，正文不得写反。`,
        `${event.playerName}当前体力 ${event.player.stamina}、快感 ${event.player.pleasure}、连击 ${event.playerCombo}。`,
        `${event.companionName}当前体力 ${event.companion.stamina}、快感 ${event.companion.pleasure}、连击 ${event.companionCombo}。`,
        forcedMove,
        `结果：${outcomeText(event.winner)}。`,
        `reaction 用${event.companionName}第一人称写一两句可以公开展示的即时感受和选择动机；这不是隐藏思维链。`,
        `narration 按“${event.playerName}先出招并命中${event.companionName}，随后${event.companionName}才回应”的顺序写 2 到 4 句场景正文。`,
        "只返回 JSON：{\"companion_skill\":\"可用招式 id 或 null\",\"reaction\":\"可见即时反应\",\"narration\":\"场景正文\"}"
    ].join("\n");
}

function extractJsonObject(value) {
    const text = String(value || "").trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const source = fenced || text;
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(source.slice(start, end + 1));
    } catch {
        return null;
    }
}

function fallbackCompanionSkill(event) {
    if (event.winner || event.availableCompanionSkills.length === 0) {
        return null;
    }
    const available = event.availableCompanionSkills;
    const recover = available.find((skill) => skill.id === "breathe");
    if (
        recover &&
        (event.companion.pleasure >= 68 || event.companion.stamina <= 30)
    ) {
        return recover.id;
    }
    const ultimate = available.find((skill) => skill.id === "reverse");
    if (
        ultimate &&
        (event.player.pleasure >= 64 || event.player.stamina <= 30)
    ) {
        return ultimate.id;
    }
    return available[0]?.id || null;
}

function parseDuelModelResponse(value, event) {
    const raw = String(value || "").trim();
    const parsed = extractJsonObject(value);
    const blockCode = [raw, parsed?.reaction, parsed?.narration]
        .map(providerOutputBlockCode)
        .find(Boolean);
    if (blockCode) {
        return {
            companion_skill: null,
            reaction: "",
            narration: "",
            refused: true,
            refusal_code: blockCode
        };
    }
    const allowed = new Set(
        event.availableCompanionSkills.map((skill) => skill.id)
    );
    const forced = event.companionSkill?.id || null;
    const requested = String(parsed?.companion_skill || "").trim();
    const companionSkill = event.winner
        ? null
        : forced ||
          (allowed.has(requested)
              ? requested
              : fallbackCompanionSkill(event));
    return {
        companion_skill: companionSkill,
        reaction: String(parsed?.reaction || "").trim().slice(0, 500),
        narration: String(parsed?.narration || (parsed ? "" : value) || "")
            .trim()
            .slice(0, 1200)
    };
}

async function loadCurrentMemories(database, settings) {
    const { data, error } = await database
        .from("memories")
        .select("summary, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(5);
    if (error) throw error;
    return filterMemoriesForContext(data).filter((item) =>
        isContextTimestampCurrent(
            item.updated_at || item.created_at,
            settings
        )
    );
}

function createIntimateDuelRouter({ getSettings, generateReply } = {}) {
    if (typeof getSettings !== "function" || typeof generateReply !== "function") {
        throw new TypeError("Intimate duel router requires settings and generation services.");
    }
    const router = express.Router();
    router.post("/narrate", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const settings = await getSettings(scope.db);
            const event = applyDuelIdentity(
                parseDuelNarrationRequest(req.body),
                scope,
                settings
            );
            const memories = await loadCurrentMemories(scope.db, settings);
            const eventMessage = buildDuelEventMessage(event);
            const generated = await generateReply({
                settings: interactiveGenerationSettings(
                    settings,
                    "intimate_duel"
                ),
                memories,
                messages: [
                    {
                        role: "user",
                        content: "请直接写出这一回合成人性爱格斗显示给我的场景正文。"
                    }
                ],
                promptArchitecture: INTIMATE_DUEL_PROMPT_ARCHITECTURE,
                turnContext: eventMessage
            });
            const modelResponse =
                generated.mode === "placeholder"
                    ? parseDuelModelResponse("", event)
                    : parseDuelModelResponse(generated.text, event);
            res.set("Cache-Control", "private, no-store");
            res.json({ ok: modelResponse.refused !== true, ...modelResponse });
        } catch (error) {
            next(error);
        }
    });
    return router;
}

module.exports = {
    DUEL_SKILLS,
    applyDuelIdentity,
    buildDuelEventMessage,
    createIntimateDuelRouter,
    parseDuelModelResponse,
    parseDuelNarrationRequest
};
