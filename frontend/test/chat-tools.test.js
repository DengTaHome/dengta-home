import assert from "node:assert/strict";
import {
  CHAT_ATTACHMENT_MAX_FILE_BYTES,
  attachmentKind,
  createAttachmentDraft,
  normalizeAttachmentFile,
  normalizedAttachmentMimeType,
  normalizeMessageAttachments,
  revokeAttachmentDraft,
  restoreAttachmentDrafts,
  shouldRestoreAttachmentDrafts,
  validateAttachmentFiles,
} from "../src/chat-attachments.js";
import {
  chooseChatModel,
  migrateLegacyChatModelToSession,
  normalizeModelsResponse,
  readServerSessionChatModel,
  readStoredChatModel,
  readStoredSessionChatModel,
  reconcileModelCatalog,
  storeChatModel,
  storeSessionChatModel,
} from "../src/chat-models.js";
import {
  attachThinkingTrace,
  appendThinkingSummary,
  appendThinkingStatus,
  mergeStreamedAssistantMessage,
  personalizedThinkingStatus,
  thinkingPanelCompleted,
  thinkingPanelVisible,
} from "../src/chat-thinking.js";
import { hydrateChatHistory } from "../src/chat-history.js";
import { buildStreamChatFormData, streamChat } from "../src/api.js";
import {
  canRetryChatClientMessage,
  chatRequestFingerprint,
  clearChatClientMessage,
  createChatClientMessageId,
  isChatGenerationInProgress,
  resolveChatClientMessage,
  restoreChatRetryText,
  updateChatClientMessage,
} from "../src/chat-idempotency.js";

function fakeFile(name, type, size) {
  return { name, type, size };
}

{
  const values = new Map([["dengta_chat_model_v1", "legacy-model"]]);
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };

  assert.equal(
    migrateLegacyChatModelToSession("first-session", storage),
    "legacy-model",
    "the old global selection must become the first active session model",
  );
  assert.equal(
    readStoredSessionChatModel("first-session", storage),
    "legacy-model",
  );
  assert.equal(
    readStoredChatModel(storage),
    "",
    "the global key must be consumed so later sessions keep the App default",
  );
  assert.equal(
    migrateLegacyChatModelToSession("later-session", storage),
    "",
  );
}

{
  const sessions = [
    { id: "session-a", model_id: "server-model-a" },
    { id: "session-b", model_id: null },
  ];
  assert.equal(
    readServerSessionChatModel(sessions, "session-a"),
    "server-model-a",
  );
  assert.equal(readServerSessionChatModel(sessions, "session-b"), "");
  assert.equal(readServerSessionChatModel(sessions, "missing"), "");
}

{
  const fixedId = "0f594d5c-e6d1-4f24-a583-cd5c66f81d75";
  const fakeCrypto = { randomUUID: () => fixedId };
  assert.equal(createChatClientMessageId(fakeCrypto), fixedId);

  const request = {
    sessionId: "session-a",
    message: "同一条消息",
    turnContext: "同一段临时背景",
    attachments: [
      {
        file: {
          name: "note.txt",
          type: "text/plain",
          size: 12,
          lastModified: 123,
        },
      },
    ],
  };
  const first = resolveChatClientMessage(null, request, fakeCrypto);
  const retry = resolveChatClientMessage(first, request, {
    randomUUID: () => "3a31c71b-cbed-4bbd-b16f-49e52176bc9b",
  });
  assert.equal(retry.clientMessageId, fixedId);
  assert.equal(retry.reused, true);
  assert.equal(retry.fingerprint, chatRequestFingerprint(request));

  const changed = resolveChatClientMessage(
    retry,
    { ...request, message: "已经修改" },
    { randomUUID: () => "3a31c71b-cbed-4bbd-b16f-49e52176bc9b" },
  );
  assert.equal(
    changed.clientMessageId,
    "3a31c71b-cbed-4bbd-b16f-49e52176bc9b",
  );
  assert.equal(changed.reused, false);
  const changedAttachmentMode = resolveChatClientMessage(
    retry,
    { ...request, attachmentInstructionMode: "system" },
    { randomUUID: () => "17c2cb36-635b-43b5-93d1-ea8f21ba9b2a" },
  );
  assert.equal(
    changedAttachmentMode.clientMessageId,
    "17c2cb36-635b-43b5-93d1-ea8f21ba9b2a",
  );
  assert.equal(changedAttachmentMode.reused, false);
  assert.notEqual(
    chatRequestFingerprint(request),
    chatRequestFingerprint({
      ...request,
      attachmentStorageMode: "ephemeral",
    }),
  );
  const changedAttachmentStorage = resolveChatClientMessage(
    retry,
    { ...request, attachmentStorageMode: "ephemeral" },
    { randomUUID: () => "27c2cb36-635b-43b5-93d1-ea8f21ba9b2a" },
  );
  assert.equal(
    changedAttachmentStorage.clientMessageId,
    "27c2cb36-635b-43b5-93d1-ea8f21ba9b2a",
  );
  assert.equal(changedAttachmentStorage.reused, false);
  const changedTurnContext = resolveChatClientMessage(
    retry,
    { ...request, turnContext: "临时背景已经改变" },
    { randomUUID: () => "47c2cb36-435b-43b5-93d1-ea8f21ba9b2a" },
  );
  assert.equal(
    changedTurnContext.clientMessageId,
    "47c2cb36-435b-43b5-93d1-ea8f21ba9b2a",
  );
  assert.equal(changedTurnContext.reused, false);
  const changedReference = resolveChatClientMessage(
    retry,
    {
      ...request,
      messageReference: {
        message_id: "quoted-message",
        role: "assistant",
        text: "换成了另一条引用",
      },
    },
    { randomUUID: () => "57c2cb36-435b-43b5-93d1-ea8f21ba9b2a" },
  );
  assert.equal(
    changedReference.clientMessageId,
    "57c2cb36-435b-43b5-93d1-ea8f21ba9b2a",
  );
  assert.equal(changedReference.reused, false);
  assert.equal(clearChatClientMessage(changed, fixedId), changed);
  assert.equal(clearChatClientMessage(changed, changed.clientMessageId), null);
  const committedRetry = updateChatClientMessage(first, fixedId, {
    userMessageCommitted: true,
    userMessageId: "saved-user-message",
    localAssistantId: "local-assistant",
  });
  assert.equal(committedRetry.clientMessageId, fixedId);
  assert.equal(committedRetry.userMessageCommitted, true);
  assert.equal(committedRetry.userMessageId, "saved-user-message");
  assert.equal(canRetryChatClientMessage(committedRetry, request), true);
  assert.equal(
    resolveChatClientMessage(committedRetry, request, {
      randomUUID: () => "3a31c71b-cbed-4bbd-b16f-49e52176bc9b",
    }).clientMessageId,
    fixedId,
  );
  assert.equal(restoreChatRetryText("", "原始文字"), "原始文字");
  assert.equal(
    restoreChatRetryText("用户已输入的新草稿", "原始文字"),
    "用户已输入的新草稿",
  );
  assert.equal(
    isChatGenerationInProgress({ code: "CHAT_GENERATION_IN_PROGRESS" }),
    true,
  );
  assert.equal(
    isChatGenerationInProgress("这条消息已经保存，AI 仍在处理中。"),
    true,
  );
  assert.equal(isChatGenerationInProgress(new Error("模型失败")), false);
}

{
  const androidAudio = fakeFile(
    "录音.wav",
    "application/octet-stream",
    300,
  );
  const androidImage = fakeFile("照片.jpg", "", 300);
  const result = validateAttachmentFiles([], [androidAudio, androidImage]);
  assert.equal(result.accepted.length, 2);
  assert.equal(result.rejected.length, 0);
  assert.equal(attachmentKind(androidAudio), "audio");
  assert.equal(attachmentKind(androidImage), "image");
  assert.equal(normalizedAttachmentMimeType(androidAudio), "audio/wav");
  assert.equal(normalizedAttachmentMimeType(androidImage), "image/jpeg");
}

{
  class FakeFile {
    constructor(parts, name, options = {}) {
      this.parts = parts;
      this.name = name;
      this.type = options.type || "";
      this.lastModified = options.lastModified || 0;
      this.size = parts.reduce((total, part) => total + Number(part.size || 0), 0);
    }
  }

  for (const [name, expectedType] of [
    ["说明.txt", "text/plain"],
    ["笔记.md", "text/markdown"],
    ["数据.csv", "text/csv"],
    ["配置.json", "application/json"],
    ["内容.xml", "application/xml"],
    ["文档.pdf", "application/pdf"],
    [
      "文档.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  ]) {
    const original = fakeFile(name, "application/octet-stream", 300);
    original.lastModified = 123;
    const normalized = normalizeAttachmentFile(original, FakeFile);
    assert.equal(normalized.type, expectedType);
    assert.equal(normalized.name, name);
    assert.equal(normalized.lastModified, 123);
    assert.equal(normalized.parts[0], original);
  }
}

{
  const result = validateAttachmentFiles([], [
    fakeFile("照片.jpg", "image/jpeg", 100),
    fakeFile("说明.pdf", "application/pdf", 200),
    fakeFile(
      "资料.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      200,
    ),
    fakeFile("片段.mp4", "video/mp4", 300),
  ]);
  assert.equal(result.accepted.length, 4);
  assert.equal(result.rejected.length, 0);
  assert.equal(attachmentKind(result.accepted[3]), "video");
}

{
  const result = validateAttachmentFiles([], [
    fakeFile("照片.heic", "image/heic", 100),
    fakeFile("声音.opus", "audio/ogg", 100),
    fakeFile("声音.caf", "audio/x-caf", 100),
    fakeFile("伪装.txt", "application/pdf", 100),
  ]);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 4);
  assert.equal(
    attachmentKind(fakeFile("兼容.wav", "audio/x-wav", 100)),
    "audio",
  );
  assert.equal(
    attachmentKind(fakeFile("兼容.md", "text/plain", 100)),
    "document",
  );
}

{
  const result = validateAttachmentFiles([], [
    fakeFile(
      "不支持.doc",
      "application/msword",
      100,
    ),
    fakeFile(
      "太大.pdf",
      "application/pdf",
      CHAT_ATTACHMENT_MAX_FILE_BYTES + 1,
    ),
  ]);
  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected.join(" "), /暂不支持/);
  assert.match(result.rejected.join(" "), /12MB/);
}

{
  const existing = Array.from({ length: 3 }, (_, index) => ({
    size: 1024,
    name: `${index}.txt`,
  }));
  const result = validateAttachmentFiles(existing, [
    fakeFile("可加入.txt", "text/plain", 100),
    fakeFile("第五个.txt", "text/plain", 100),
  ]);
  assert.equal(result.accepted.length, 1);
  assert.match(result.rejected[0], /最多添加 4 个/);
}

{
  const calls = [];
  const urlApi = {
    createObjectURL() {
      calls.push("create");
      return "blob:preview";
    },
    revokeObjectURL(value) {
      calls.push(`revoke:${value}`);
    },
  };
  const draft = createAttachmentDraft(
    fakeFile("照片.png", "image/png", 12),
    urlApi,
  );
  assert.equal(draft.previewUrl, "blob:preview");
  const audioDraft = createAttachmentDraft(
    fakeFile("语音.webm", "audio/webm", 24),
    urlApi,
  );
  assert.equal(audioDraft.previewUrl, "blob:preview");
  const videoDraft = createAttachmentDraft(
    fakeFile("片段.mp4", "video/mp4", 36),
    urlApi,
  );
  assert.equal(videoDraft.previewUrl, "blob:preview");
  revokeAttachmentDraft(draft, urlApi);
  revokeAttachmentDraft(audioDraft, urlApi);
  revokeAttachmentDraft(videoDraft, urlApi);
  assert.deepEqual(calls, [
    "create",
    "create",
    "create",
    "revoke:blob:preview",
    "revoke:blob:preview",
    "revoke:blob:preview",
  ]);
}

assert.equal(
  shouldRestoreAttachmentDrafts({ userMessageCommitted: true }),
  true,
);
assert.equal(
  shouldRestoreAttachmentDrafts({ userMessageCommitted: false }),
  true,
);
assert.equal(
  shouldRestoreAttachmentDrafts({
    requestWasAborted: true,
    cancelReason: "view-change",
  }),
  true,
);
assert.equal(
  shouldRestoreAttachmentDrafts({
    requestWasAborted: true,
    cancelReason: "view-change",
    userMessageCommitted: true,
  }),
  true,
);
assert.equal(
  shouldRestoreAttachmentDrafts({
    requestWasAborted: true,
    cancelReason: "user-cancel",
  }),
  true,
  "an explicit stop must preserve the draft for an idempotent retry",
);

{
  const imageFile = { name: "照片.png", type: "image/png", size: 12 };
  const pdfFile = { name: "资料.pdf", type: "application/pdf", size: 24 };
  const docxFile = {
    name: "文档.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 36,
  };
  const imageDraft = { id: "image", file: imageFile };
  const pdfDraft = { id: "pdf", file: pdfFile };
  const docxDraft = { id: "docx", file: docxFile };
  const restored = restoreAttachmentDrafts(
    [imageDraft, pdfDraft, docxDraft],
    [imageDraft],
  );
  assert.deepEqual(restored, [imageDraft, pdfDraft, docxDraft]);
  assert.equal(restored[0].file, imageFile);
  assert.equal(restored[1].file, pdfFile);
  assert.equal(restored[2].file, docxFile);
}

{
  const normalized = normalizeMessageAttachments(
    [
      { name: "安全.png", type: "image/png", url: "/files/safe.png" },
      { name: "语音.webm", type: "audio/webm", url: "/files/voice.webm" },
      { name: "危险.txt", type: "text/plain", url: "javascript:alert(1)" },
    ],
    "https://api.example.com",
  );
  assert.equal(normalized[0].url, "https://api.example.com/files/safe.png");
  assert.equal(normalized[1].kind, "audio");
  assert.equal(normalized[1].url, "https://api.example.com/files/voice.webm");
  assert.equal(normalized[2].url, "");
}

{
  const catalog = normalizeModelsResponse(
    {
      models: ["gpt-a", { id: "gpt-b", label: "模型 B" }, "gpt-a"],
      current_model: "gpt-b",
    },
    "fallback",
  );
  assert.deepEqual(catalog.models, [
    { id: "gpt-a", label: "gpt-a" },
    { id: "gpt-b", label: "模型 B" },
  ]);
  assert.equal(
    chooseChatModel({
      models: catalog.models,
      stored: "missing",
      current: catalog.currentModel,
      fallback: "gpt-a",
    }),
    "gpt-b",
  );
}

{
  assert.equal(
    chooseChatModel({
      models: [],
      stored: "gpt-5.4-mini",
      fallback: "gpt-5.5",
    }),
    "gpt-5.4-mini",
    "模型列表加载期间不能用服务端默认值覆盖设备保存的选择",
  );
}

{
  const models = [
    { id: "app-default", label: "App default" },
    { id: "saved-for-session", label: "Saved" },
    { id: "provider-current", label: "Provider current" },
  ];
  assert.equal(
    chooseChatModel({
      models,
      stored: "",
      current: "app-default",
      fallback: "provider-current",
    }),
    "app-default",
    "a new conversation must start from the App default",
  );
  assert.equal(
    chooseChatModel({
      models,
      stored: "saved-for-session",
      current: "app-default",
      fallback: "provider-current",
    }),
    "saved-for-session",
    "an existing conversation must restore its own model",
  );
}

{
  const retained = reconcileModelCatalog(
    { models: ["new-default", "still-valid"], current_model: "new-default" },
    { previous: "still-valid", fallback: "new-default" },
  );
  assert.equal(retained.selectedModel, "still-valid");

  const replaced = reconcileModelCatalog(
    { models: ["new-default", "another"], current_model: "new-default" },
    { previous: "removed-model", fallback: "another" },
  );
  assert.equal(replaced.selectedModel, "new-default");
}

{
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  storeChatModel("gpt-test", storage);
  assert.equal(readStoredChatModel(storage), "gpt-test");
}

{
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  storeSessionChatModel("session-a", "gpt-a", storage);
  storeSessionChatModel("session-b", "gpt-b", storage);
  assert.equal(readStoredSessionChatModel("session-a", storage), "gpt-a");
  assert.equal(readStoredSessionChatModel("session-b", storage), "gpt-b");
  assert.equal(
    readStoredSessionChatModel("new-session", storage),
    "",
    "a new conversation must not inherit another conversation's model",
  );
  storeSessionChatModel("session-a", "", storage);
  assert.equal(readStoredSessionChatModel("session-a", storage), "");
  assert.equal(readStoredSessionChatModel("session-b", storage), "gpt-b");
}

{
  let statuses = appendThinkingStatus([], "reading_attachments");
  statuses = appendThinkingStatus(statuses, "reading_attachments");
  statuses = appendThinkingStatus(statuses, "private hidden reasoning");
  statuses = appendThinkingStatus(statuses, "generating");
  assert.deepEqual(statuses, ["正在读取附件", "正在生成回复"]);
  assert.equal(
    appendThinkingStatus([], "processing_attachments")[0],
    "正在安全读取附件",
  );
  assert.equal(
    personalizedThinkingStatus("正在请求所选模型", {
      aiName: "祂",
      companionMood: "有点害羞",
    }),
    "正在请求所选模型",
  );
  assert.equal(
    personalizedThinkingStatus("正在生成回复", {
      aiName: "小灯",
      companionMood: "不开心",
    }),
    "正在生成回复",
  );
  assert.equal(
    thinkingPanelVisible({ isStreaming: false, thinkingStatuses: statuses }),
    true,
  );
  assert.equal(
    thinkingPanelCompleted({ isStreaming: false, generationInProgress: true }),
    false,
  );
  assert.equal(
    thinkingPanelCompleted({ isStreaming: false, generationInProgress: false }),
    true,
  );
  let publicSummary = appendThinkingSummary("", "先查看上下文。");
  publicSummary = appendThinkingSummary(
    publicSummary,
    "\u0000再整理本轮公开摘要。",
  );
  assert.equal(publicSummary, "先查看上下文。再整理本轮公开摘要。");
  assert.equal(
    thinkingPanelVisible({ thinkingSummary: publicSummary, thinkingSummarySource: "provider_summary" }),
    true,
  );
  const historyMessage = attachThinkingTrace(
    {
      id: "assistant-1",
      reasoning: "不应保留",
      tool_calls: { resolved_model: "gpt-test" },
    },
    { statuses, summary: publicSummary, lastReasoningSource: "provider_summary" },
  );
  assert.deepEqual(historyMessage.tool_calls, {
    resolved_model: "gpt-test",
  });
  assert.equal("reasoning" in historyMessage, false);
  assert.deepEqual(historyMessage.thinkingStatuses, statuses);
  assert.equal(historyMessage.thinkingSummary, publicSummary);
  assert.equal(historyMessage.thinkingSummarySource, "provider_summary");

  const hydratedHistory = hydrateChatHistory([
    {
      id: "assistant-history",
      role: "assistant",
      content: "完成",
      reasoning_content: "模型内部原始推理",
      reasoning_summary: "不应恢复的推理摘要",
      thinking: "不应恢复的思考字段",
      tool_calls: {
        reasoning: "嵌套的隐藏推理也不能恢复",
        reasoning_summary: "嵌套摘要也不能进入历史 UI",
        processing_stages: [
          "accepted",
          { stage: "calling_model" },
          "private_chain_of_thought",
          "completed",
        ],
      },
    },
    {
      id: "voice-history",
      role: "user",
      content: "语音历史",
      tool_calls: {
        voice_analysis: { emotion: "happy", confidence: 0.8 },
      },
    },
  ]);
  assert.deepEqual(hydratedHistory[0].thinkingStatuses, [
    "服务器已接收本轮消息",
    "正在请求所选模型",
    "本轮处理完成",
  ]);
  assert.equal("reasoning_content" in hydratedHistory[0], false);
  assert.equal("reasoning_summary" in hydratedHistory[0], false);
  assert.equal("thinking" in hydratedHistory[0], false);
  assert.equal("thinkingSummary" in hydratedHistory[0], false);
  assert.equal("reasoning" in hydratedHistory[0].tool_calls, false);
  assert.equal("reasoning_summary" in hydratedHistory[0].tool_calls, false);
  assert.equal(hydratedHistory[1].voiceAnalysis.emotion, "开心");
  const mergedMessage = mergeStreamedAssistantMessage(
    { id: "local", content: "流式内容" },
    {
      id: "assistant-1",
      content: "最终内容",
      tool_calls: { response_mode: "custom" },
    },
    { statuses, summary: publicSummary, lastReasoningSource: "provider_summary" },
  );
  assert.deepEqual(mergedMessage.tool_calls, { response_mode: "custom" });
  assert.equal(mergedMessage.content, "最终内容");
  assert.equal(mergedMessage.generationInProgress, false);
  assert.equal(mergedMessage.retryAvailable, false);
  assert.equal(mergedMessage.thinkingSummary, publicSummary);
}

{
  const first = new File(["图片"], "图片.txt", { type: "text/plain" });
  const second = new File(["声音"], "声音.webm", { type: "audio/webm" });
  const formData = buildStreamChatFormData({
    message: "请看看",
    session_id: "session-1",
    client_time: "2026-07-21 12:00",
    timezone: "Asia/Shanghai",
    emotion_understanding_enabled: true,
    public_reasoning_summary: true,
    attachment_instruction_mode: "system",
    companion_status: { mood: "平静" },
    environment_context: {
      timeZone: "Asia/Shanghai",
      weather: { temperatureC: 26, description: "晴朗" },
    },
    turn_context: "本轮接着雨天回家的剧情",
    message_reference: {
      message_id: "quoted-message",
      role: "assistant",
      text: "刚才说要抱一下",
      text_truncated: false,
      attachment_summary: null,
    },
    model: "gpt-test",
    client_message_id: "0f594d5c-e6d1-4f24-a583-cd5c66f81d75",
    attachment_storage_mode: "ephemeral",
    files: [{ file: first }, second],
  });
  assert.equal(formData.get("message"), "请看看");
  assert.equal(formData.get("session_id"), "session-1");
  assert.equal(formData.get("emotion_understanding_enabled"), "true");
  assert.equal(formData.get("public_reasoning_summary"), "true");
  assert.equal(formData.get("attachment_instruction_mode"), "system");
  assert.equal(formData.get("attachment_storage_mode"), "ephemeral");
  assert.deepEqual(JSON.parse(formData.get("companion_status")), {
    mood: "平静",
  });
  assert.deepEqual(JSON.parse(formData.get("environment_context")), {
    timeZone: "Asia/Shanghai",
    weather: { temperatureC: 26, description: "晴朗" },
  });
  assert.equal(formData.get("turn_context"), "本轮接着雨天回家的剧情");
  assert.deepEqual(JSON.parse(formData.get("message_reference")), {
    message_id: "quoted-message",
    role: "assistant",
    text: "刚才说要抱一下",
    text_truncated: false,
    attachment_summary: null,
  });
  assert.equal(formData.get("model"), "gpt-test");
  assert.equal(
    formData.get("client_message_id"),
    "0f594d5c-e6d1-4f24-a583-cd5c66f81d75",
  );
  assert.equal(formData.getAll("files").length, 2);

  const noReferenceFormData = buildStreamChatFormData({
    message: "QA-PING",
    message_reference: null,
  });
  assert.equal(
    noReferenceFormData.has("message_reference"),
    false,
    "a normal message without a quote must omit message_reference",
  );
  assert.equal(
    noReferenceFormData.get("attachment_storage_mode"),
    "persistent",
  );

  const androidAudio = new File(["RIFFtestWAVE"], "录音.wav", {
    type: "application/octet-stream",
    lastModified: 456,
  });
  const normalizedAudio = normalizeAttachmentFile(androidAudio);
  const normalizedFormData = buildStreamChatFormData({
    files: [normalizedAudio],
  });
  assert.equal(normalizedFormData.get("files").type, "audio/wav");
  assert.equal(normalizedFormData.get("files").name, "录音.wav");
}

{
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const events = [];
  let receivedSignal;
  let released = false;
  let readCount = 0;

  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async (_url, options) => {
    receivedSignal = options.signal;
    return {
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: {
        getReader() {
          return {
            async read() {
              readCount += 1;
              if (readCount === 1) {
                return {
                  done: false,
                  value: new TextEncoder().encode(
                    'data: {"type":"monologue","phase":"delta","source":"model_authored_visible_monologue","content":"我先认真回应你","offset":0}\n\ndata: {"type":"monologue","phase":"end","source":"model_authored_visible_monologue","state":"complete"}\n\ndata: {"type":"text","content":"你好"}\n\ndata: {"type":"done","ok":true}\n\n',
                  ),
                };
              }
              return { done: true, value: undefined };
            },
            async cancel() {},
            releaseLock() {
              released = true;
            },
          };
        },
      },
    };
  };

  try {
    const controller = new AbortController();
    const completion = await streamChat({}, (event) => events.push(event), {
      signal: controller.signal,
    });
    assert.equal(receivedSignal, controller.signal);
    assert.deepEqual(events, [
      {
        type: "monologue",
        phase: "delta",
        source: "model_authored_visible_monologue",
        content: "我先认真回应你",
        offset: 0,
      },
      {
        type: "monologue",
        phase: "end",
        source: "model_authored_visible_monologue",
        state: "complete",
      },
      { type: "text", content: "你好" },
      { type: "done", ok: true },
    ]);
    assert.deepEqual(completion, { type: "done", ok: true });
    assert.equal(released, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}


async function runTerminalStream(events) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let readCount = 0;

  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream" },
    body: {
      getReader() {
        return {
          async read() {
            readCount += 1;
            if (readCount > 1) return { done: true, value: undefined };
            return {
              done: false,
              value: new TextEncoder().encode(
                events
                  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                  .join(""),
              ),
            };
          },
          async cancel() {},
          releaseLock() {},
        };
      },
    },
  });

  try {
    return await streamChat({}, () => {});
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

await assert.rejects(
  runTerminalStream([
    { type: "error", content: "服务端没有提交" },
    { type: "done", ok: true },
  ]),
  /服务端没有提交/,
);
await assert.rejects(
  runTerminalStream([
    { type: "meta", user_message: { id: "saved-user-message" } },
    {
      type: "error",
      code: "CHAT_GENERATION_IN_PROGRESS",
      content: "这条消息已经保存，AI 仍在处理中。",
      user_message_committed: true,
    },
  ]),
  (error) => {
    assert.equal(error.code, "CHAT_GENERATION_IN_PROGRESS");
    assert.equal(error.userMessageCommitted, true);
    assert.equal(error.generationInProgress, true);
    return true;
  },
);
await assert.rejects(
  runTerminalStream([
    {
      type: "error",
      content: "模型失败",
      user_message_committed: true,
    },
  ]),
  (error) => {
    assert.equal(error.message, "模型失败");
    assert.equal(error.userMessageCommitted, true);
    return true;
  },
);
await assert.rejects(
  runTerminalStream([
    { type: "meta", user_message: { id: "saved-user-message" } },
    { type: "text", content: "未完成内容" },
  ]),
  (error) => {
    assert.match(error.message, /消息已经保存/);
    assert.equal(error.userMessageCommitted, true);
    return true;
  },
);
await assert.rejects(
  runTerminalStream([{ type: "done", ok: false, message: "保存失败" }]),
  /保存失败/,
);
await assert.rejects(
  runTerminalStream([{ type: "text", content: "未完成内容" }]),
  /没有确认本轮已保存/,
);

{
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let cancelled = false;
  let released = false;
  let notifyReaderStarted;
  const readerStarted = new Promise(resolve => { notifyReaderStarted = resolve; });

  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async (_url, options) => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream" },
    body: {
      getReader() {
        return {
          read() {
            notifyReaderStarted();
            return new Promise((resolve, reject) => {
              if (options.signal.aborted) {
                reject(options.signal.reason);
                return;
              }
              options.signal.addEventListener(
                "abort",
                () => reject(options.signal.reason),
                { once: true },
              );
            });
          },
          async cancel() {
            cancelled = true;
          },
          releaseLock() {
            released = true;
          },
        };
      },
    },
  });

  try {
    const controller = new AbortController();
    const promise = streamChat({}, () => {}, { signal: controller.signal });
    await readerStarted;
    controller.abort(new DOMException("页面已离开", "AbortError"));
    await assert.rejects(promise, { name: "AbortError" });
    assert.equal(cancelled, true);
    assert.equal(released, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

console.log("聊天附件、模型选择、处理摘要与 multipart 契约测试通过。");
