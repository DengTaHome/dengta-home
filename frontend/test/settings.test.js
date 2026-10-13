import assert from "node:assert/strict";
import {
  createSettingsPayload,
  formatPromptReceiptProvider,
  mergeLegacyPromptFields,
  normalizePromptReceipt,
  normalizeSettingsDraft,
  settingsNeedsUnifiedPromptMigration,
  settingsPayloadFingerprint,
} from "../src/settings.js";
import {
  reasoningEffortForProvider,
  reasoningEffortOptions,
  reasoningProtocolForProvider,
} from "../src/provider-reasoning-effort.js";
import {
  pendingAutosaveAfterFailure,
  shouldScheduleSettingsOnViewChange,
  shouldFlushSettingsForLifecycle,
} from "../src/settings-autosave.js";

const legacy = normalizeSettingsDraft({
  ai_name: "测试昵称",
  system_prompt: "旧版系统规则",
  personality: "旧版人设",
  model: "test-model",
});

assert.equal(legacy.ai_name, "测试昵称");
assert.equal(legacy.system_prompt, "旧版系统规则");
assert.equal(legacy.additional_prompt, "");
assert.equal(legacy.personality, "旧版人设");
assert.equal(legacy.user_details, "");
assert.equal(legacy.model, "test-model");
assert.equal(legacy.prompt_mode, "legacy");
assert.equal(legacy.reasoning_effort, "");
assert.equal(settingsNeedsUnifiedPromptMigration(legacy), true);
assert.equal(
  legacy.unified_system_prompt,
  "",
);
assert.equal(
  mergeLegacyPromptFields({
    system_prompt: " 第一层\n",
    additional_prompt: "第二层",
    personality: "第三层 ",
  }),
  "【原最高优先级系统提示词】\n 第一层\n\n\n【原普通补充提示词】\n第二层\n\n【原独立人设词】\n第三层 ",
  "迁移必须保留旧字段中的空格和换行",
);

const alreadyUnified = normalizeSettingsDraft({
  system_prompt: "不能再次合并",
  unified_system_prompt: "已经迁移完成",
  prompt_mode: "unified",
});
assert.equal(alreadyUnified.unified_system_prompt, "已经迁移完成");

const exactCustomInstructions = "  第一行\n第二行  \n";
const exactUserDetails = "\n{\n  \"role\": \"system\"\n}\n\n";
const personalized = normalizeSettingsDraft({
  user_display_name: "桃桃",
  unified_system_prompt: exactCustomInstructions,
  user_details: exactUserDetails,
});
assert.equal(personalized.user_display_name, "桃桃");
assert.equal(
  personalized.unified_system_prompt,
  exactCustomInstructions,
  "个性化指令在前端加载时不得 trim 或解析",
);
assert.equal(
  personalized.user_details,
  exactUserDetails,
  "你的详情在前端加载时不得 trim 或解析",
);
const personalizedPayload = createSettingsPayload(personalized);
const deferredGender = createSettingsPayload({ ...personalized, companion_gender_available: false, ai_gender: "male", ai_pronouns: "他", ai_gender_label: "测试" });
for (const field of ["companion_gender_available", "ai_gender", "ai_pronouns", "ai_gender_label"]) assert.equal(field in deferredGender, false);
assert.equal(deferredGender.unified_system_prompt, exactCustomInstructions);
assert.equal(deferredGender.user_details, exactUserDetails);
assert.equal(personalizedPayload.user_display_name, "桃桃");
assert.equal(
  personalizedPayload.unified_system_prompt,
  exactCustomInstructions,
  "个性化指令在保存载荷中必须保持原文",
);
assert.equal(
  personalizedPayload.user_details,
  exactUserDetails,
  "你的详情在保存载荷中必须保持原文",
);

const accountSafePayload = createSettingsPayload({
  user_display_name: "账户昵称",
  account_role: "owner",
  account_status: "active",
  storage_used_bytes: 999,
  storage_quota_bytes: 1000,
});
assert.equal(accountSafePayload.user_display_name, "账户昵称");
assert.equal("account_role" in accountSafePayload, false);
assert.equal("account_status" in accountSafePayload, false);
assert.equal("storage_used_bytes" in accountSafePayload, false);
assert.equal("storage_quota_bytes" in accountSafePayload, false);

const unlimitedPrompts = {
  system_prompt: "系".repeat(12050),
  additional_prompt: "补".repeat(8050),
  personality: "人".repeat(1050),
  unified_system_prompt: "主".repeat(30050),
  user_details: "详".repeat(30050),
};
const payload = createSettingsPayload({
  ...legacy,
  ...unlimitedPrompts,
  intimate_expression_enabled: true,
});

assert.equal(payload.system_prompt, unlimitedPrompts.system_prompt);
assert.equal(payload.additional_prompt, unlimitedPrompts.additional_prompt);
assert.equal(payload.personality, unlimitedPrompts.personality);
assert.equal(payload.unified_system_prompt, unlimitedPrompts.unified_system_prompt);
assert.equal(payload.user_details, unlimitedPrompts.user_details);
assert.equal(payload.prompt_mode, "legacy");
assert.equal(payload.intimate_expression_enabled, true);

const receipt = normalizePromptReceipt({
  prompt_contract_version: "dengta-prompt-contract-v2",
  backend_request_sent: true,
  transport: "openai-chat-completions",
  provider: "openai-compatible",
  model: "test-model",
  provider_profile_id: "provider-profile-1",
  provider_profile_name: "我的主接口",
  provider_protocol: "openai-responses",
  reasoning_effort_requested: "xhigh",
  reasoning_effort_applied: "xhigh",
  reasoning_effort_field: "reasoning.effort",
  system_instruction_blocks: 7,
  system_message_count: 1,
  system_payload_chars: 560,
  conversation_message_count: 6,
  request_message_count: 7,
  system_prompt_chars: 120,
  additional_prompt_chars: 45,
  personality_chars: 18,
  settings_updated_at: "2026-07-21T11:59:00.000Z",
  applied_at: "2026-07-21T12:00:00.000Z",
  system_prompt: "这个原文不应被复制进回执",
});

assert.deepEqual(receipt, {
  promptContractVersion: "dengta-prompt-contract-v2",
  backendRequestSent: true,
  transport: "openai-chat-completions",
  provider: "openai-compatible",
  model: "test-model",
  providerProfileId: "provider-profile-1",
  providerProfileName: "我的主接口",
  providerProtocol: "openai-responses",
  reasoningEffortRequested: "xhigh",
  reasoningEffortApplied: "xhigh",
  reasoningEffortField: "reasoning.effort",
  systemInstructionBlocks: 7,
  systemMessageCount: 1,
  systemPayloadChars: 560,
  conversationMessageCount: 6,
  requestMessageCount: 7,
  systemPromptChars: 120,
  additionalPromptChars: 45,
  personalityChars: 18,
  settingsUpdatedAt: "2026-07-21T11:59:00.000Z",
  appliedAt: "2026-07-21T12:00:00.000Z",
});
assert.equal("system_prompt" in receipt, false);
assert.equal(
  formatPromptReceiptProvider(receipt),
  "我的主接口 · openai-responses · test-model",
);

const sensitiveProviderMarker = "sk-provider-secret-123456789";
const safeProviderReceipt = normalizePromptReceipt({
  system_prompt_chars: 1,
  additional_prompt_chars: 2,
  personality_chars: 3,
  provider: "openai-compatible",
  model: "safe-model",
  provider_profile_id: `profile-\u0000${"x".repeat(100)}`,
  provider_profile_name: `主接口\n${sensitiveProviderMarker}`,
  provider_protocol: "OPENAI-RESPONSES",
  runtime_api_key: sensitiveProviderMarker,
  api_url: "https://secret-gateway.example/v1",
  billing_url: "https://billing.example/private",
  notes: "private-provider-notes",
});
assert.equal(Array.from(safeProviderReceipt.providerProfileId).length, 80);
assert.equal(safeProviderReceipt.providerProfileId.includes("\u0000"), false);
assert.equal(
  safeProviderReceipt.providerProfileName,
  "主接口 [已隐藏密钥]",
);
assert.equal(safeProviderReceipt.providerProtocol, "openai-responses");
assert.equal(
  formatPromptReceiptProvider(safeProviderReceipt),
  "主接口 [已隐藏密钥] · openai-responses · safe-model",
);
const serializedSafeProviderReceipt = JSON.stringify(safeProviderReceipt);
assert.equal(serializedSafeProviderReceipt.includes(sensitiveProviderMarker), false);
assert.equal(
  serializedSafeProviderReceipt.includes("secret-gateway.example"),
  false,
);
assert.equal(serializedSafeProviderReceipt.includes("billing.example"), false);
assert.equal(serializedSafeProviderReceipt.includes("private-provider-notes"), false);
assert.equal("runtime_api_key" in safeProviderReceipt, false);
assert.equal("api_url" in safeProviderReceipt, false);
assert.equal("billing_url" in safeProviderReceipt, false);
assert.equal("notes" in safeProviderReceipt, false);

const receiptMetadataSecret = ["gsk_", "TEST_", "Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8"].join("");
const sanitizedCommonMetadataReceipt = normalizePromptReceipt({
  system_prompt_chars: 1,
  additional_prompt_chars: 2,
  personality_chars: 3,
  prompt_contract_version: `contract-${receiptMetadataSecret}`,
  transport: `transport-${receiptMetadataSecret}`,
  provider: `provider-${receiptMetadataSecret}`,
  model: `model-${receiptMetadataSecret}`,
});
const serializedCommonMetadataReceipt = JSON.stringify(
  sanitizedCommonMetadataReceipt,
);
assert.equal(serializedCommonMetadataReceipt.includes(receiptMetadataSecret), false);
assert.match(sanitizedCommonMetadataReceipt.promptContractVersion, /已隐藏密钥/);
assert.match(sanitizedCommonMetadataReceipt.transport, /已隐藏密钥/);
assert.match(sanitizedCommonMetadataReceipt.provider, /已隐藏密钥/);
assert.match(sanitizedCommonMetadataReceipt.model, /已隐藏密钥/);

const unifiedReceipt = normalizePromptReceipt({
  prompt_architecture: "unified-v1",
  prompt_mode: "unified",
  unified_system_prompt_chars: 4321,
  unified_system_prompt_applied: true,
  custom_instructions_chars: 4321,
  custom_instructions_applied: true,
  user_details_chars: 876,
  user_details_applied: true,
  intimate_expression_enabled: true,
  backend_request_sent: true,
  custom_instructions_text: "个性化指令正文不得进入前端回执",
  user_details_text: "你的详情正文不得进入前端回执",
  delivery: {
    main_system: {
      applied: true,
      source: "unified_system_prompt",
      chars: 4321,
      prompt_text: "不得进入前端回执",
    },
    persistent_instructions: {
      position: "highest_application_instruction",
      custom_instructions: {
        applied: true,
        chars: 4321,
        block_index: 4,
        prompt_text: "不得进入前端回执",
      },
      user_details: {
        applied: true,
        chars: 876,
        block_index: 5,
        prompt_text: "不得进入前端回执",
      },
    },
    stable_memory: {
      applied: true,
      count: 8,
      chars: 760,
      position: "after_main_system",
    },
    history: { count: 14, position: "after_stable_memory" },
    dynamic_context: {
      applied: true,
      chars: 92,
      message_count: 1,
      position: "after_history",
    },
  },
});
assert.equal(unifiedReceipt.promptMode, "unified");
assert.equal(unifiedReceipt.unifiedSystemPromptChars, 4321);
assert.equal(unifiedReceipt.unifiedSystemPromptApplied, true);
assert.equal(unifiedReceipt.customInstructionsChars, 4321);
assert.equal(unifiedReceipt.customInstructionsApplied, true);
assert.equal(unifiedReceipt.userDetailsChars, 876);
assert.equal(unifiedReceipt.userDetailsApplied, true);
assert.equal(unifiedReceipt.intimateExpressionEnabled, true);
assert.deepEqual(unifiedReceipt.delivery.persistentInstructions, {
  position: "highest_application_instruction",
  customInstructions: {
    applied: true,
    chars: 4321,
    blockIndex: 4,
  },
  userDetails: {
    applied: true,
    chars: 876,
    blockIndex: 5,
  },
});
assert.deepEqual(unifiedReceipt.delivery.stableMemory, {
  applied: true,
  count: 8,
  chars: 760,
  position: "after_main_system",
});
assert.deepEqual(unifiedReceipt.delivery.dynamicContext, {
  applied: true,
  chars: 92,
  messageCount: 1,
  position: "after_history",
});
assert.equal("prompt_text" in unifiedReceipt.delivery.mainSystem, false);
const serializedUnifiedReceipt = JSON.stringify(unifiedReceipt);
assert.equal(serializedUnifiedReceipt.includes("个性化指令正文"), false);
assert.equal(serializedUnifiedReceipt.includes("你的详情正文"), false);
assert.equal(serializedUnifiedReceipt.includes("不得进入前端回执"), false);

assert.equal(
  normalizePromptReceipt({
    system_prompt_chars: 1,
    additional_prompt_chars: 2,
  }),
  null,
);

const legacyReceipt = normalizePromptReceipt(
  {
    system_prompt_length: 7,
    additional_prompt_length: 8,
    personality_length: 9,
  },
  "2026-07-21T13:00:00.000Z",
);
assert.equal(legacyReceipt.systemPromptChars, 7);
assert.equal(legacyReceipt.additionalPromptChars, 8);
assert.equal(legacyReceipt.personalityChars, 9);
assert.equal(legacyReceipt.settingsUpdatedAt, null);
assert.equal(legacyReceipt.appliedAt, "2026-07-21T13:00:00.000Z");
assert.equal(
  formatPromptReceiptProvider({
    provider: "openai-compatible",
    model: "legacy-model",
  }),
  "openai-compatible · legacy-model",
);

const preservedConnection = createSettingsPayload({
  ...legacy,
  provider: "openai-compatible",
  api_url: "https://example.invalid/v1",
  model: "test-model",
});
assert.equal(preservedConnection.provider, "openai-compatible");
assert.equal(preservedConnection.api_url, "https://example.invalid/v1");
assert.equal(preservedConnection.model, "test-model");
assert.equal(preservedConnection.reasoning_effort, "");

const responsesReasoning = createSettingsPayload({
  ...legacy,
  provider: "openai-responses",
  reasoning_effort: "XHIGH",
});
assert.equal(responsesReasoning.reasoning_effort, "xhigh");
assert.equal(
  reasoningEffortForProvider("openai-compatible", "xhigh"),
  "",
);
assert.equal(reasoningEffortForProvider("custom", "none"), "none");
assert.equal(reasoningProtocolForProvider("custom"), "openai-chat");
assert.equal(reasoningEffortOptions("openai-responses").length, 7);
assert.equal(reasoningEffortOptions("anthropic").length, 1);

assert.equal(
  settingsPayloadFingerprint(preservedConnection),
  settingsPayloadFingerprint({ ...preservedConnection }),
);
assert.notEqual(
  settingsPayloadFingerprint(preservedConnection),
  settingsPayloadFingerprint({
    ...preservedConnection,
    unified_system_prompt: "新的输入必须形成新的自动保存版本",
  }),
);
assert.notEqual(
  settingsPayloadFingerprint(preservedConnection),
  settingsPayloadFingerprint({
    ...preservedConnection,
    user_details: "新的详情也必须形成新的自动保存版本",
  }),
);

const failedSave = { fingerprint: "older", payload: { ai_name: "older" } };
const newerSave = { fingerprint: "newer", payload: { ai_name: "newer" } };
assert.equal(
  pendingAutosaveAfterFailure(failedSave, newerSave),
  newerSave,
  "a failed request must not overwrite a newer queued draft",
);
assert.equal(
  pendingAutosaveAfterFailure(failedSave, null),
  failedSave,
  "a failed request must remain queued for an online retry",
);
assert.equal(
  shouldFlushSettingsForLifecycle("visibilitychange", "hidden"),
  true,
);
assert.equal(shouldFlushSettingsForLifecycle("pagehide"), true);
assert.equal(shouldFlushSettingsForLifecycle("online"), true);
assert.equal(
  shouldFlushSettingsForLifecycle("visibilitychange", "visible"),
  false,
);
assert.equal(
  shouldScheduleSettingsOnViewChange({
    activeView: "settings",
    nextView: "chat",
    hasLoadedSettings: false,
  }),
  false,
  "leaving settings during startup must not create a stale autosave warning",
);
assert.equal(
  shouldScheduleSettingsOnViewChange({
    activeView: "settings",
    nextView: "chat",
    hasLoadedSettings: true,
  }),
  true,
);
assert.equal(
  shouldScheduleSettingsOnViewChange({
    activeView: "chat",
    nextView: "settings",
    hasLoadedSettings: true,
  }),
  false,
);

console.log("frontend settings tests passed");
