const {
    assertPromptFieldsDoNotContainSecrets
} = require("./prompt-security");
const { publicRuntimeSettings } = require("./ai-provider-center");
const { buildGenderChanges } = require("./companion-gender");

const DEFAULT_SETTINGS = Object.freeze({
    ai_name: "伴侣",
    system_prompt: "",
    additional_prompt: "",
    personality: "",
    prompt_mode: "unified",
    unified_system_prompt: "",
    user_details: "",
    intimate_expression_enabled: true,
    provider: "custom",
    api_url: "",
    model: "",
    reasoning_effort: "",
    temperature: 0.7,
    context_turns: 0,
    max_tokens: 0,
    compression_threshold: 8000,
    compression_keep: 20,
    timezone: "Asia/Shanghai",
    push_enabled: false,
    max_push_per_day: 7
});

// These columns are retained for database migration compatibility only. Chat
// routing always comes from ai_provider_profiles, never from this legacy row.
const LEGACY_PROVIDER_FIELDS = Object.freeze([
    "provider",
    "api_url",
    "model",
    "reasoning_effort"
]);

function cleanText(value, maxLength = 10000) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function cleanPromptText(value) {
    return String(value ?? "");
}

function toNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function normalizePromptMode(value, fallback = "legacy") {
    const normalized = String(value ?? fallback)
        .trim()
        .toLowerCase();
    if (["legacy", "unified"].includes(normalized)) return normalized;

    const error = new Error("prompt_mode 只能是 legacy 或 unified。");
    error.status = 400;
    error.code = "invalid_prompt_mode";
    throw error;
}

function cleanUnifiedSystemPrompt(value) {
    return String(value ?? "");
}

function cleanUserDetails(value) {
    return String(value ?? "");
}

function stripLegacyProviderFields(body = {}) {
    const next =
        body && typeof body === "object" && !Array.isArray(body)
            ? { ...body }
            : {};
    for (const field of LEGACY_PROVIDER_FIELDS) {
        delete next[field];
    }
    return next;
}

function providerCenterBaseSettings(settings = {}) {
    return {
        ...settings,
        provider: DEFAULT_SETTINGS.provider,
        api_url: "",
        model: "",
        reasoning_effort: ""
    };
}

async function getStoredSettings(database) {
    const { data, error } = await database
        .from("settings")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    if (data) return data;

    const { data: created, error: createError } = await database
        .from("settings")
        .insert({ ...DEFAULT_SETTINGS })
        .select("*")
        .single();
    if (!createError) return created;

    if (String(createError.code || "") !== "23505") {
        throw createError;
    }
    const retry = await database
        .from("settings")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (retry.error) throw retry.error;
    if (!retry.data) throw createError;
    return retry.data;
}

async function getBaseSettings(database) {
    const stored = await getStoredSettings(database);
    return providerCenterBaseSettings(stored);
}

function buildSettingsChanges(stored, body = {}) {
    const current = stored || DEFAULT_SETTINGS;
    const nextBody = stripLegacyProviderFields(body);
    const has = (field) =>
        Object.prototype.hasOwnProperty.call(nextBody, field);
    const changes = {
        ...buildGenderChanges(current, nextBody),
        ai_name: has("ai_name")
            ? cleanText(nextBody.ai_name, 50) || current.ai_name
            : current.ai_name,
        system_prompt: has("system_prompt")
            ? cleanPromptText(nextBody.system_prompt)
            : cleanPromptText(current.system_prompt),
        additional_prompt: has("additional_prompt")
            ? cleanPromptText(nextBody.additional_prompt)
            : cleanPromptText(current.additional_prompt),
        personality: has("personality")
            ? cleanPromptText(nextBody.personality)
            : cleanPromptText(current.personality),
        prompt_mode: has("prompt_mode")
            ? normalizePromptMode(nextBody.prompt_mode)
            : normalizePromptMode(current.prompt_mode),
        unified_system_prompt: has("unified_system_prompt")
            ? cleanUnifiedSystemPrompt(nextBody.unified_system_prompt)
            : cleanUnifiedSystemPrompt(current.unified_system_prompt),
        user_details: has("user_details")
            ? cleanUserDetails(nextBody.user_details)
            : cleanUserDetails(current.user_details),
        intimate_expression_enabled: has(
            "intimate_expression_enabled"
        )
            ? nextBody.intimate_expression_enabled === true
            : current.intimate_expression_enabled === true,
        provider: current.provider || DEFAULT_SETTINGS.provider,
        api_url: current.api_url || "",
        model: current.model || "",
        reasoning_effort: current.reasoning_effort || "",
        temperature: toNumber(
            nextBody.temperature,
            current.temperature,
            0,
            2
        ),
        context_turns: has("context_turns") && Number.isFinite(Number(nextBody.context_turns))
            ? Math.round(toNumber(nextBody.context_turns, current.context_turns, 0, 1000000))
            : current.context_turns,
        max_tokens: Number.isFinite(Number(nextBody.max_tokens))
            ? Math.round(Number(nextBody.max_tokens))
            : current.max_tokens,
        compression_threshold: has("compression_threshold") && Number.isFinite(
            Number(nextBody.compression_threshold)
        )
            ? Math.round(toNumber(nextBody.compression_threshold, current.compression_threshold, 0, 10000000))
            : current.compression_threshold,
        compression_keep: Number.isFinite(Number(nextBody.compression_keep))
            ? Math.round(Number(nextBody.compression_keep))
            : current.compression_keep,
        timezone:
            cleanText(nextBody.timezone, 80) ||
            current.timezone ||
            "Asia/Shanghai",
        push_enabled: has("push_enabled")
            ? nextBody.push_enabled === true
            : current.push_enabled === true,
        max_push_per_day: Math.round(
            toNumber(
                nextBody.max_push_per_day,
                current.max_push_per_day ?? 7,
                0,
                50
            )
        ),
        updated_at: new Date().toISOString()
    };
    assertPromptFieldsDoNotContainSecrets(changes);
    return changes;
}

async function updateStoredSettings(
    database,
    body = {}
) {
    const stored = await getStoredSettings(database);
    const changes = buildSettingsChanges(stored, body);
    const genderFields = ["ai_gender", "ai_pronouns", "ai_gender_label"];
    if (genderFields.some(field => Object.hasOwn(changes, field)) && genderFields.some(field => !Object.hasOwn(stored, field))) {
        // Gender rollout is deferred; older clients must still save supported settings.
        for (const field of genderFields) delete changes[field];
    }
    const { data, error } = await database
        .from("settings")
        .update(changes)
        .eq("id", stored.id)
        .select("*")
        .single();
    if (error) throw error;
    return providerCenterBaseSettings(data);
}

async function publicStoredSettings(database) {
    return publicRuntimeSettings(await getBaseSettings(database));
}

module.exports = {
    DEFAULT_SETTINGS,
    buildSettingsChanges,
    cleanUserDetails,
    cleanUnifiedSystemPrompt,
    getBaseSettings,
    getStoredSettings,
    normalizePromptMode,
    providerCenterBaseSettings,
    publicStoredSettings,
    stripLegacyProviderFields,
    toNumber,
    updateStoredSettings
};
