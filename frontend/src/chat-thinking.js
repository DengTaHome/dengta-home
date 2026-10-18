import {
  mergeAuthoritativeVisibleMonologue,
  visibleMonologueForMessage,
} from "./inner-monologue.js";

const STATUS_LABELS = {
  preparing_request: "正在准备并发送这条消息",
  accepted: "服务器已接收本轮消息",
  already_received: "服务器已识别并复用先前保存的消息",
  generation_in_progress: "消息已保存，AI 仍在处理中",
  reading_attachments: "正在读取附件",
  reading_files: "正在读取附件",
  processing_attachments: "正在安全读取附件",
  attachments_ready: "附件已经读取完成",
  organizing_context: "正在整理对话上下文",
  preparing_context: "正在整理对话上下文",
  generating: "正在生成回复",
  calling_model: "正在请求所选模型",
  model_reasoning: "模型推理中",
  model_deep_reasoning: "模型深度推理中",
  model_still_reasoning: "模型深入推理中",
  model_extended_reasoning: "模型扩展推理中",
  saving: "正在保存本轮对话",
  completed: "本轮处理完成",
};

function removeControlCharacters(value) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join("");
}

function cleanText(value, limit = 2_000) {
  return removeControlCharacters(value).trim().slice(0, limit);
}

export function appendThinkingSummary(current = "", value, limit = 6_000) {
  const previous = removeControlCharacters(current).slice(-limit);
  const chunk = removeControlCharacters(value);
  if (!chunk) return previous;
  return `${previous}${chunk}`.slice(-limit);
}

export function appendPublicProviderSummary(trace = {}, event = {}) {
  if (event?.type !== "reasoning" || event?.source !== "provider_summary" ||
      event?.public !== true || typeof event?.content !== "string") return trace;
  const chunk = removeControlCharacters(event.content);
  if (!chunk) return trace;
  const previous = trace?.lastReasoningSource === "provider_summary"
    ? removeControlCharacters(trace.summary)
    : "";
  const summary = Array.from(`${previous}${chunk}`).slice(0, 6_000).join("");
  if (summary === trace?.summary && trace?.lastReasoningSource === "provider_summary") return trace;
  return { ...trace, summary, lastReasoningSource: "provider_summary" };
}

export function localizedThinkingStatus(value) {
  const text = cleanText(value, 120);
  if (!text) return "";
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  return STATUS_LABELS[key] || "";
}

export function appendThinkingStatus(current = [], value) {
  const next = localizedThinkingStatus(value);
  const statuses = Array.isArray(current) ? current.filter(Boolean).slice(-7) : [];
  if (!next || statuses.at(-1) === next) return statuses;
  return [...statuses, next].slice(-8);
}

export function personalizedThinkingStatus(
  value,
  { aiName = "伴侣", companionMood = "" } = {},
) {
  const status = cleanText(value, 160);
  void aiName;
  void companionMood;
  return status;
}

export function thinkingPanelVisible(message = {}) {
  return (
    (Array.isArray(message.thinkingStatuses) &&
      message.thinkingStatuses.length > 0) ||
    (message.thinkingSummarySource === "provider_summary" &&
      cleanText(message.thinkingSummary, 6_000).length > 0)
  );
}

export function thinkingPanelCompleted(message = {}) {
  return (
    message?.isStreaming !== true && message?.generationInProgress !== true
  );
}

function publicMessageFields(message = {}) {
  const safeMessage = { ...message };
  delete safeMessage.reasoningSummary;
  delete safeMessage.reasoning_summary;
  delete safeMessage.reasoning;
  delete safeMessage.reasoning_content;
  delete safeMessage.thinking;
  delete safeMessage.thinking_content;
  delete safeMessage.thinkingSummary;
  delete safeMessage.thinking_summary;
  delete safeMessage.thinkingSummarySource;
  delete safeMessage.thinking_summary_source;
  delete safeMessage.lastReasoningSource;
  if (
    safeMessage.tool_calls &&
    typeof safeMessage.tool_calls === "object" &&
    !Array.isArray(safeMessage.tool_calls)
  ) {
    safeMessage.tool_calls = { ...safeMessage.tool_calls };
    delete safeMessage.tool_calls.reasoningSummary;
    delete safeMessage.tool_calls.reasoning_summary;
    delete safeMessage.tool_calls.reasoning;
    delete safeMessage.tool_calls.reasoning_content;
    delete safeMessage.tool_calls.thinking;
    delete safeMessage.tool_calls.thinking_content;
    delete safeMessage.tool_calls.thinkingSummary;
    delete safeMessage.tool_calls.thinking_summary;
    delete safeMessage.tool_calls.thinkingSummarySource;
    delete safeMessage.tool_calls.thinking_summary_source;
    delete safeMessage.tool_calls.lastReasoningSource;
  }
  return safeMessage;
}

function stageValue(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return value.stage || value.status || value.content || "";
}

function publicStageKey(value) {
  const text = cleanText(stageValue(value), 120);
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  return Object.hasOwn(STATUS_LABELS, key) ? key : "";
}

export function hydrateStoredThinkingTrace(message = {}) {
  const storedStages = message?.tool_calls?.processing_stages;
  const source = Array.isArray(storedStages)
    ? storedStages
    : message.thinkingStatuses;
  const thinkingStatuses = Array.isArray(source)
    ? source.reduce(
        (current, stage) =>
          appendThinkingStatus(current, publicStageKey(stage)),
        [],
      )
    : [];

  const safeMessage = publicMessageFields(message);
  const visibleMonologue = visibleMonologueForMessage(safeMessage);
  return {
    ...safeMessage,
    thinkingStatuses,
    ...(visibleMonologue ? { visibleMonologue } : {}),
  };
}

export function attachThinkingTrace(message = {}, trace = {}) {
  const publicSummary = trace.lastReasoningSource === "provider_summary";
  return {
    ...publicMessageFields(message),
    thinkingStatuses: Array.isArray(trace.statuses) ? trace.statuses : [],
    thinkingSummary: publicSummary
      ? Array.from(removeControlCharacters(trace.summary)).slice(0, 6_000).join("")
      : "",
    ...(publicSummary ? { thinkingSummarySource: "provider_summary" } : {}),
  };
}

function clearChatFailureFields(message) {
  const next = { ...message };
  for (const field of [
    "chatError", "partialContent", "error_code", "error_location", "error_log_id",
    "error_source", "provider_code", "provider_phase", "upstream_status", "error_time",
    "monologueAutoOpen", "monologueUserMessageId",
  ]) delete next[field];
  return next;
}

export function restartStreamedAssistantMessage(previous = {}, draft = {}) {
  const next = clearChatFailureFields({ ...previous, ...draft });
  delete next.visible_monologue;
  delete next.thinkingSummary;
  delete next.thinkingSummarySource;
  if (!Object.hasOwn(draft, "visibleMonologue")) delete next.visibleMonologue;
  if (next.tool_calls && typeof next.tool_calls === "object" && !Array.isArray(next.tool_calls)) {
    next.tool_calls = { ...next.tool_calls };
    delete next.tool_calls.visible_monologue;
  }
  return next;
}

export function mergeStreamedAssistantMessage(
  localMessage = {},
  serverMessage = {},
  trace = {},
) {
  const visibleMonologue = mergeAuthoritativeVisibleMonologue(
    localMessage.visibleMonologue,
    serverMessage,
  );
  const previous = restartStreamedAssistantMessage(localMessage, {
    visibleMonologue: localMessage.visibleMonologue,
  });
  return attachThinkingTrace(
    clearChatFailureFields({
      ...previous,
      ...serverMessage,
      renderKey: localMessage.renderKey ?? localMessage.id ?? serverMessage.id,
      content: serverMessage?.content ?? localMessage?.content ?? "",
      isStreaming: false,
      generationInProgress: false,
      retryAvailable: false,
      visibleMonologue,
    }),
    trace,
  );
}
