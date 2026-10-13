import { reasoningEffortForProvider } from "./provider-reasoning-effort.js";

export const emptySettings = {
  ai_name: "伴侣",
  user_display_name: "",
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
  max_push_per_day: 7,
  context_reset_at: "",
  account_role: "member",
  account_status: "active",
  storage_used_bytes: 0,
  storage_quota_bytes: 0,
};

export const PROMPT_FIELD_LIMITS = {
  ai_name: 50,
  user_display_name: 80,
     system_prompt: Number.POSITIVE_INFINITY,
     additional_prompt: Number.POSITIVE_INFINITY,
     personality: Number.POSITIVE_INFINITY,
     unified_system_prompt: Number.POSITIVE_INFINITY,
     user_details: Number.POSITIVE_INFINITY,
     turn_context: Number.POSITIVE_INFINITY,
};

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function textOrFallback(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

const LEGACY_PROMPT_SECTIONS = [
  ["system_prompt", "原最高优先级系统提示词"],
  ["additional_prompt", "原普通补充提示词"],
  ["personality", "原独立人设词"],
];

export function settingsNeedsUnifiedPromptMigration(value) {
  const source = objectOrEmpty(value);
  if (textOrFallback(source.unified_system_prompt).length > 0) return false;
  return LEGACY_PROMPT_SECTIONS.some(
    ([field]) => textOrFallback(source[field]).length > 0,
  );
}

export function mergeLegacyPromptFields(value) {
  const source = objectOrEmpty(value);
  return LEGACY_PROMPT_SECTIONS.flatMap(([field, label]) => {
    const content = textOrFallback(source[field]);
    return content.length > 0 ? [`【${label}】\n${content}`] : [];
  }).join("\n\n");
}

export function normalizeSettingsDraft(value) {
  const source = objectOrEmpty(value);
  const promptMode = ["legacy", "unified"].includes(source.prompt_mode)
    ? source.prompt_mode : settingsNeedsUnifiedPromptMigration(source) ? "legacy" : "unified";

  return {
    ...emptySettings,
    ...source,
    ai_name: textOrFallback(source.ai_name, emptySettings.ai_name),
    user_display_name: textOrFallback(source.user_display_name),
    system_prompt: textOrFallback(source.system_prompt),
    additional_prompt: textOrFallback(source.additional_prompt),
    personality: textOrFallback(source.personality),
    provider: textOrFallback(source.provider, emptySettings.provider),
    reasoning_effort: reasoningEffortForProvider(
      textOrFallback(source.provider, emptySettings.provider),
      source.reasoning_effort,
    ),
    prompt_mode: promptMode,
    unified_system_prompt: textOrFallback(source.unified_system_prompt),
    user_details: textOrFallback(source.user_details),
    intimate_expression_enabled:
      source.intimate_expression_enabled === true,
    context_reset_at: textOrFallback(source.context_reset_at),
  };
}

export function createSettingsPayload(value) {
  const normalized = normalizeSettingsDraft(value);
  const readOnlyFields = new Set([
    "companion_gender_available",
    "context_reset_at",
    "account_role",
    "account_status",
    "storage_used_bytes",
    "storage_quota_bytes",
  ]);
  if (normalized.companion_gender_available === false) {
    for (const field of ["ai_gender", "ai_pronouns", "ai_gender_label"]) readOnlyFields.add(field);
  }
  const editableSettings = Object.fromEntries(
    Object.entries(normalized).filter(([key]) => !readOnlyFields.has(key)),
  );
  return {
    ...editableSettings,
    ai_name: normalized.ai_name.slice(0, PROMPT_FIELD_LIMITS.ai_name),
    user_display_name: normalized.user_display_name.slice(
      0,
      PROMPT_FIELD_LIMITS.user_display_name,
    ),
    system_prompt: normalized.system_prompt,
    additional_prompt: normalized.additional_prompt,
    personality: normalized.personality,
    prompt_mode: normalized.prompt_mode,
    unified_system_prompt: normalized.unified_system_prompt,
    user_details: normalized.user_details,
    intimate_expression_enabled:
      normalized.intimate_expression_enabled === true,
  };
}

export function settingsPayloadFingerprint(value) {
  return JSON.stringify(createSettingsPayload(value));
}

function boundedCharacterCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(1_000_000, Math.round(parsed));
}

function firstCharacterCount(source, keys) {
  for (const key of keys) {
    const parsed = boundedCharacterCount(source[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function normalizedIsoTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function optionalText(value, limit = 80) {
  const text = textOrFallback(value).trim().slice(0, limit);
  return text || null;
}

function safeReceiptMetadata(value, limit = 80) {
  const redacted = textOrFallback(value)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[已隐藏密钥]")
    .replace(/\b(?:gsk_|AIza|xai-)[A-Za-z0-9_-]{8,}\b/g, "[已隐藏密钥]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [已隐藏密钥]")
    .replace(
      /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\b(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[已隐藏密钥]",
    )
    .replace(
      /\b(?=[A-Za-z0-9_-]{24,}\b)(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g,
      "[已隐藏密钥]",
    );
  const text = Array.from(redacted)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text).slice(0, limit).join("") || null;
}

function safeReceiptProviderProtocol(value) {
  const protocol = safeReceiptMetadata(value, 40)?.toLowerCase() || null;
  return ["openai-chat", "openai-responses", "anthropic", "gemini"].includes(
    protocol,
  )
    ? protocol
    : null;
}

function safeReceiptReasoningEffort(value) {
  const effort = safeReceiptMetadata(value, 16)?.toLowerCase() || null;
  return ["none", "low", "medium", "high", "xhigh", "max"].includes(effort)
    ? effort
    : null;
}

function safeReceiptReasoningField(value) {
  const field = safeReceiptMetadata(value, 32);
  return ["reasoning_effort", "reasoning.effort"].includes(field)
    ? field
    : null;
}

export function formatPromptReceiptProvider(receipt = {}) {
  const profileName = safeReceiptMetadata(receipt.providerProfileName, 80);
  const profileId = safeReceiptMetadata(receipt.providerProfileId, 80);
  const protocol = safeReceiptProviderProtocol(receipt.providerProtocol);
  const provider = safeReceiptMetadata(receipt.provider, 50);
  const model = safeReceiptMetadata(receipt.model, 160);
  const profileLabel = profileName || profileId;
  const parts = profileLabel
    ? [profileLabel, protocol || provider || "未知协议"]
    : [provider || "未知接口"];
  parts.push(model || "未报告模型");
  return parts.join(" · ");
}

function deliveryBlock(source, fields) {
  const result = {};
  for (const [target, key, type] of fields) {
    if (type === "boolean") {
      result[target] = source[key] === true;
    } else if (type === "text") {
      result[target] = safeReceiptMetadata(source[key]);
    } else {
      result[target] = firstCharacterCount(source, [key]);
    }
  }
  return result;
}

export function normalizePromptReceipt(value, fallbackAppliedAt) {
  const source = objectOrEmpty(value);
  const systemPromptChars = firstCharacterCount(source, [
    "system_prompt_chars",
    "system_prompt_length",
  ]);
  const additionalPromptChars = firstCharacterCount(source, [
    "additional_prompt_chars",
    "additional_prompt_length",
  ]);
  const personalityChars = firstCharacterCount(source, [
    "personality_chars",
    "personality_length",
  ]);
  const hasLegacyReceipt =
    systemPromptChars === null ||
    additionalPromptChars === null ||
    personalityChars === null
      ? false
      : true;
  const unifiedSystemPromptChars = firstCharacterCount(source, [
    "unified_system_prompt_chars",
  ]);
  const customInstructionsChars = firstCharacterCount(source, [
    "custom_instructions_chars",
  ]);
  const userDetailsChars = firstCharacterCount(source, [
    "user_details_chars",
  ]);
  const rawDelivery = objectOrEmpty(source.delivery);
  const hasUnifiedReceipt =
    unifiedSystemPromptChars !== null ||
    customInstructionsChars !== null ||
    userDetailsChars !== null ||
    Boolean(optionalText(source.prompt_architecture)) ||
    Boolean(optionalText(source.prompt_mode)) ||
    Object.keys(rawDelivery).length > 0;

  if (!hasLegacyReceipt && !hasUnifiedReceipt) {
    return null;
  }

  const appliedAt =
    normalizedIsoTime(source.applied_at) ||
    normalizedIsoTime(fallbackAppliedAt) ||
    new Date().toISOString();
  const promptContractVersion = safeReceiptMetadata(
    source.prompt_contract_version,
    80,
  );
  const transport = safeReceiptMetadata(source.transport, 80);
  const provider = safeReceiptMetadata(source.provider, 50);
  const model = safeReceiptMetadata(source.model, 160);
  const providerProfileId = safeReceiptMetadata(
    source.provider_profile_id,
    80,
  );
  const providerProfileName = safeReceiptMetadata(
    source.provider_profile_name,
    80,
  );
  const providerProtocol = safeReceiptProviderProtocol(
    source.provider_protocol,
  );
  const reasoningEffortRequested = safeReceiptReasoningEffort(
    source.reasoning_effort_requested,
  );
  const reasoningEffortApplied = safeReceiptReasoningEffort(
    source.reasoning_effort_applied,
  );
  const reasoningEffortField = safeReceiptReasoningField(
    source.reasoning_effort_field,
  );

  const common = {
    promptContractVersion,
    backendRequestSent: source.backend_request_sent === true,
    transport,
    provider,
    model,
    ...(providerProfileId ? { providerProfileId } : {}),
    ...(providerProfileName ? { providerProfileName } : {}),
    ...(providerProtocol ? { providerProtocol } : {}),
    ...(reasoningEffortRequested ? { reasoningEffortRequested } : {}),
    ...(reasoningEffortApplied ? { reasoningEffortApplied } : {}),
    ...(reasoningEffortField ? { reasoningEffortField } : {}),
    systemInstructionBlocks: firstCharacterCount(source, [
      "system_instruction_blocks",
    ]),
    systemMessageCount: firstCharacterCount(source, [
      "system_message_count",
    ]),
    systemPayloadChars: firstCharacterCount(source, [
      "system_payload_chars",
    ]),
    conversationMessageCount: firstCharacterCount(source, [
      "conversation_message_count",
    ]),
    requestMessageCount: firstCharacterCount(source, [
      "request_message_count",
    ]),
    systemPromptChars,
    additionalPromptChars,
    personalityChars,
    settingsUpdatedAt: normalizedIsoTime(source.settings_updated_at),
    appliedAt,
  };

  if (!hasUnifiedReceipt) return common;

  const mainSystem = objectOrEmpty(rawDelivery.main_system);
  const persistentInstructions = objectOrEmpty(
    rawDelivery.persistent_instructions,
  );
  const customInstructions = objectOrEmpty(
    persistentInstructions.custom_instructions,
  );
  const userDetails = objectOrEmpty(persistentInstructions.user_details);
  const stableMemory = objectOrEmpty(rawDelivery.stable_memory);
  const history = objectOrEmpty(rawDelivery.history);
  const dynamicContext = objectOrEmpty(rawDelivery.dynamic_context);

  return {
    ...common,
    promptArchitecture: safeReceiptMetadata(source.prompt_architecture),
    promptMode: safeReceiptMetadata(source.prompt_mode),
    unifiedSystemPromptChars,
    unifiedSystemPromptApplied:
      source.unified_system_prompt_applied === true,
    customInstructionsChars,
    customInstructionsApplied:
      source.custom_instructions_applied === true,
    userDetailsChars,
    userDetailsApplied: source.user_details_applied === true,
    intimateExpressionEnabled:
      source.intimate_expression_enabled === true,
    delivery: {
      mainSystem: deliveryBlock(mainSystem, [
        ["applied", "applied", "boolean"],
        ["source", "source", "text"],
        ["chars", "chars", "count"],
      ]),
      persistentInstructions: {
        position: safeReceiptMetadata(persistentInstructions.position),
        customInstructions: deliveryBlock(customInstructions, [
          ["applied", "applied", "boolean"],
          ["chars", "chars", "count"],
          ["blockIndex", "block_index", "count"],
        ]),
        userDetails: deliveryBlock(userDetails, [
          ["applied", "applied", "boolean"],
          ["chars", "chars", "count"],
          ["blockIndex", "block_index", "count"],
        ]),
      },
      stableMemory: deliveryBlock(stableMemory, [
        ["applied", "applied", "boolean"],
        ["count", "count", "count"],
        ["chars", "chars", "count"],
        ["position", "position", "text"],
      ]),
      history: deliveryBlock(history, [
        ["count", "count", "count"],
        ["position", "position", "text"],
      ]),
      dynamicContext: deliveryBlock(dynamicContext, [
        ["applied", "applied", "boolean"],
        ["chars", "chars", "count"],
        ["messageCount", "message_count", "count"],
        ["position", "position", "text"],
      ]),
    },
  };
}
