import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import DeviceActionReceipts from "./DeviceActionReceipts";
import CompanionActivityCards from "./CompanionActivityCards.jsx";
import { MessageAttachments, ThinkingPanel } from "./ChatMessageExtras";
import { AuthenticatedImage } from "./PrivateMedia";
import {
  longPressMovementExceeded,
  messageCanBeReferenced,
  messageReferenceFromMessage,
} from "./message-reference";
import { getStickerById } from "./sticker-catalog";
import { refusalDisplayFields } from "./refusal-diagnostic.js";
import "./refusal-diagnostic.css";
import { formatVoiceConfidence } from "./voice";
import ChatSkinOrnament from "./ChatSkinOrnament";
import { privateMediaAsset, privateMediaContentPath } from "./private-media";
import ChatErrorLog from "./ChatErrorLog";
import { readChatDisplayContent } from "./chat-display-content.js";
import ChatTextImpact from "./ChatTextImpact.jsx";
import PartialReplyNote from './PartialReplyNote.jsx';
import { shouldShowPartialReplyNote } from './partial-reply.js';
import './partial-reply.css';

const messageTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
});

function formatMessageTime(value) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return messageTimeFormatter.format(date);
}

function ChatMessage({
  item,
  aiName = "伴侣",
  aiPronoun = "TA",
  userName = "你",
  companionMood = "",
  skin = "classic-glass",
  skinPresentation = null,
  apiBaseUrl,
  onPreview,
  onReference,
  onDismissError,
  onOpenActivity,
  innerMonologue,
  innerMonologuePending = false,
  innerMonologueError = "",
  onRequestInnerMonologue,
  onCancelInnerMonologue,
  userAvatar = "",
  companionAvatar = "",
  privateMediaCatalog = null,
  textImpactScope = "",
  reduceMotion = false,
  // 情绪理解关闭后，历史消息里的语音情绪标签也要隐藏（数据保留，重新开启可恢复）。
  showEmotion = true,
}) {
  const rowRef = useRef(null);
  const isUser = item.role === "user";
  const displayName = isUser ? userName : aiName;
  const quotedMessage = messageReferenceFromMessage(item);
  const canReference =
    item.chatError !== true &&
    typeof onReference === "function" &&
    messageCanBeReferenced(item);
  const longPressRef = useRef(null);
  const sticker = !isUser
    ? getStickerById(item.tool_calls?.sticker_id)
    : null;
  const customSticker = !isUser
    ? privateMediaAsset(
        privateMediaCatalog,
        String(item.tool_calls?.custom_sticker_id || ""),
        "custom_sticker",
      )
    : null;
  const avatar = isUser ? userAvatar : companionAvatar;

  const refusalLogId = item.tool_calls?.refusal_detected?.error_log_id || item.error_log_id;

  function formatErrorTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", { hour12: false });
  }
  const avatarLetter = isUser
    ? Array.from(userName || "我")[0] || "我"
    : Array.from(aiName || "伴")[0] || "伴";
  const artworkId = !isUser
    ? String(item.tool_calls?.artwork_id || "")
    : "";
  const artworkAlt =
    item.tool_calls?.artwork_alt || `${aiName}创作的图片`;
  const isGenerating = item.isStreaming === true || item.generationInProgress === true;
  const displayContent = useMemo(() => readChatDisplayContent(item), [item]);
  const formattedTime = useMemo(() =>
    typeof item.formattedTime === "string" && item.formattedTime
      ? item.formattedTime : formatMessageTime(item.created_at),
  [item.formattedTime, item.created_at]);

  // 流式进度条：将 thinkingStatuses 映射到 0~100% + 已接收字数
  const streamProgress = useMemo(() => {
    if (!isGenerating) return null;
    const statuses = Array.isArray(item.thinkingStatuses) ? item.thinkingStatuses : [];
    const last = statuses.length > 0 ? statuses[statuses.length - 1] : "";
    const chars = Math.max(0, String(item.content || "").length);
    // 阶段 → 百分比映射（与 STATUS_LABELS 对齐）
    const PHASE_WEIGHT = {
      "正在准备并发送这条消息": 3,
      "服务器已接收本轮消息": 8,
      "服务器已识别并复用先前保存的消息": 8,
      "消息已保存，AI 仍在处理中": 10,
      "正在读取附件": 12,
      "正在安全读取附件": 14,
      "附件已经读取完成": 16,
      "正在整理对话上下文": 22,
      "正在生成回复": 28,
      "正在请求所选模型": 30,
      "模型推理中": 36,
      "模型深度推理中": 40,
      "模型深入推理中": 44,
      "模型扩展推理中": 46,
      "正在保存本轮对话": 94,
      "本轮处理完成": 98,
    };
    const base = PHASE_WEIGHT[last] || 0;
    // 收到首字后按字数增长（45% ~ 92%）
    const textProgress = chars > 0
      ? Math.min(45 + Math.min(chars, 2000) / 2000 * 47, 92)
      : base;
    const pct = Math.max(base, textProgress);
    return { pct: Math.min(pct, 98), chars, phase: last };
  }, [isGenerating, item.thinkingStatuses, item.content]);

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current?.timerId) {
      window.clearTimeout(longPressRef.current.timerId);
    }
    longPressRef.current = null;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  function beginLongPress(event) {
    if (
      !canReference ||
      (event.button !== undefined && event.button !== 0) ||
      event.target?.closest?.("button, a, input, textarea, select")
    ) {
      return;
    }
    cancelLongPress();
    const gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      triggered: false,
      timerId: null,
    };
    gesture.timerId = window.setTimeout(() => {
      if (longPressRef.current !== gesture) return;
      gesture.triggered = true;
      onReference(item);
      globalThis.navigator?.vibrate?.(8);
    }, 520);
    longPressRef.current = gesture;
  }

  function moveLongPress(event) {
    const gesture = longPressRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (
      longPressMovementExceeded(
        gesture.startX,
        gesture.startY,
        event.clientX,
        event.clientY,
      )
    ) {
      cancelLongPress();
    }
  }

  function endLongPress(event) {
    const gesture = longPressRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.triggered) event.preventDefault();
    cancelLongPress();
  }

  function preventTriggeredContextMenu(event) {
    if (longPressRef.current?.triggered) event.preventDefault();
  }

  const quotedDisplayName =
    quotedMessage?.role === "user" ? userName : aiName;

  return (
    <article
      ref={rowRef}
      data-text-impact-scope={textImpactScope}
      className={`message-row ${isUser ? "user" : "assistant"}${
        canReference ? " can-reference" : ""
      }${skin === "taotao-cream" ? " chat-skin-cream-message" : ""}${
        skinPresentation?.groupStart ? " group-start" : ""
      }${skinPresentation?.groupEnd ? " group-end" : ""}${
        item.chatError === true ? " chat-error-message" : ""
      }`}
      onPointerDown={beginLongPress}
      onPointerMove={moveLongPress}
      onPointerUp={endLongPress}
      onPointerCancel={cancelLongPress}
      onContextMenu={preventTriggeredContextMenu}
    >
      {avatar ? (
        <AuthenticatedImage
          src={avatar}
          loading="eager"
          alt={`${displayName}的头像`}
          className={`message-avatar message-avatar-image ${
            isUser ? "is-user" : "is-assistant"
          }`}
          fallback={
            <span
              className={`message-avatar message-avatar-letter ${
                isUser ? "is-user" : "is-assistant"
              }`}
              role="img"
              aria-label={`${displayName}的标记`}
            >
              {avatarLetter}
            </span>
          }
        />
      ) : <span
        className={`message-avatar message-avatar-letter ${
          isUser ? "is-user" : "is-assistant"
        }`}
        role="img"
        aria-label={`${displayName}的标记`}
      >
        {avatarLetter}
      </span>}
      <div className="message-column">
        <div className="message-role">{displayName}</div>
        <div className="message-bubble">
          {skin === "taotao-cream" && skinPresentation?.showOrnament && (
            <ChatSkinOrnament
              role={item.role}
              mood={companionMood}
            />
          )}
          {!isUser && item.tool_calls?.refusal_detected && (() => {
            const refusal = refusalDisplayFields(item.tool_calls.refusal_detected);
            return (
              <div className="chat-refusal-banner" role="alert">
                <span className="chat-refusal-badge">⚠ 拒绝回答</span>
                <span className="chat-refusal-source">来源: {refusal.sourceLabel}</span>
                {refusal.reason ? (
                  <span className="chat-refusal-reason">{refusal.reason}</span>
                ) : null}
                {refusal.excerpt ? (
                  <span className="chat-refusal-excerpt">原文: {refusal.excerpt}</span>
                ) : null}
                {refusal.provenance ? (
                  <span className="chat-refusal-provenance">{refusal.provenance}</span>
                ) : null}
                <span className="chat-refusal-code">错误码: {refusal.code}</span>
                <ChatErrorLog key={refusalLogId || "local"} logId={refusalLogId} diagnostic={item} />
              </div>
            );
          })()}
          {quotedMessage && (
            <div className="message-reference-block">
              <strong>引用 {quotedDisplayName}</strong>
              <span>
                {quotedMessage.text ||
                  `${quotedMessage.attachment_summary?.count || 0} 个附件`}
                {quotedMessage.text_truncated ? "…" : ""}
              </span>
            </div>
          )}
          {!isUser && (
            <ThinkingPanel
              message={item}
              aiName={aiName}
              aiPronoun={aiPronoun}
              companionMood={companionMood}
              innerMonologue={innerMonologue}
              innerMonologuePending={innerMonologuePending}
              innerMonologueError={innerMonologueError}
              onRequestInnerMonologue={onRequestInnerMonologue}
              onCancelInnerMonologue={onCancelInnerMonologue}
            />
          )}
          {shouldShowPartialReplyNote(item.tool_calls, item.content) && (
            <PartialReplyNote content={item.content} />
          )}
          {item.chatError && item.partialContent && (
            <div className="message-content" role="note">
              <small>回复中断 · 以下是本轮已经生成并保留的片段</small>
              <p>{item.partialContent}</p>
            </div>
          )}
          {item.content && (
            <div className="message-content">{displayContent.content}</div>
          )}
          {displayContent.nextActions.length > 0 && <aside className="message-next-actions" aria-label="伴侣的小提议"><strong>接下来可以…</strong><ul>{displayContent.nextActions.map((action, index) => <li key={index}>{action}</li>)}</ul></aside>}
          {!isUser && streamProgress && (
            <div className="stream-progress-bar" aria-label="回复进度">
              <i className="stream-progress-track"><b style={{ width: `${streamProgress.pct}%` }} /></i>
              <span className="stream-progress-phase">{streamProgress.phase}</span>
              <span className="stream-progress-chars">{streamProgress.chars}字</span>
            </div>
          )}
          {sticker && (
            <button
              type="button"
              className="message-sticker"
              aria-label={`查看表情：${sticker.alt}`}
              onClick={() => onPreview?.(sticker.assetPath, sticker.alt)}
            >
              <img src={sticker.assetPath} alt={sticker.alt} loading="lazy" />
            </button>
          )}
          {customSticker && (
            <AuthenticatedImage
              src={privateMediaContentPath(customSticker.id)}
              alt={customSticker.alt_text || customSticker.display_name || "自定义表情"}
              className="message-sticker-image"
              animationControls
              width={customSticker.width}
              height={customSticker.height}
              buttonClassName="message-sticker"
              onPreview={onPreview}
            />
          )}
          {artworkId && (
            <div className="message-artwork">
              {item.tool_calls?.is_surprise_reveal === true && (
                <span className="message-artwork-reveal">
                  悄悄准备的惊喜，现在揭晓
                </span>
              )}
              <AuthenticatedImage
                src={`/api/v2/creative/artworks/${encodeURIComponent(
                  artworkId,
                )}/image`}
                alt={artworkAlt}
                className="message-artwork-image"
                buttonClassName="message-artwork-preview"
                onPreview={onPreview}
              />
            </div>
          )}
          <MessageAttachments
            value={item.attachments || item.files}
            apiBaseUrl={apiBaseUrl}
            onPreview={onPreview}
          />
          {isUser &&
            item.tool_calls?.attachment_instruction_mode === "system" && (
              <div className="attachment-instruction-badge">
                本轮附件已作为系统指令
              </div>
            )}
          {!isUser && (
            <>
              <DeviceActionReceipts actions={item.tool_calls?.mcp_actions} />
              <CompanionActivityCards actions={item.tool_calls?.activity_actions} onOpen={onOpenActivity} />
            </>
          )}
          {item.chatError === true && (
            <div className="chat-error-panel">
              <div className="chat-error-meta-row">
                <span className="chat-error-code-badge">
                  ⚠ {item.error_code || 'ERROR'}{' '}
                  {item.error_source ? `· ${item.error_source}` : ''}
                </span>
                {item.error_location && (
                  <span className="chat-error-location" title={item.error_location}>
                    位置: {item.error_location}
                  </span>
                )}
                <time className="chat-error-time">
                  {formatErrorTime(item.error_time || item.created_at)}
                </time>
              </div>
              <ChatErrorLog key={refusalLogId || "local"} logId={refusalLogId} diagnostic={item} />
            </div>
          )}
          {showEmotion && item.voiceAnalysis && (
            <div className="voice-message-meta">
              <span>语音转写</span>
              <strong>
                {item.voiceAnalysis.emotion} ·{" "}
                {formatVoiceConfidence(item.voiceAnalysis.confidence)}
              </strong>
            </div>
          )}
          {item.isStreaming && (
            <span className="stream-caret" aria-label="正在回复">
              ♥
            </span>
          )}
          <div className="message-footer">
            {!item.chatError && !item.tool_calls?.refusal_detected && String(item.content || "").trim() && (
              <ChatTextImpact rowRef={rowRef} scopeKey={textImpactScope} messageId={item.id}
                recent={!isUser && item.monologueAutoOpen === true} generating={isGenerating} reducedMotion={reduceMotion} />
            )}
            {item.chatError === true &&
              typeof onDismissError === "function" && (
                <button
                  type="button"
                  className="message-error-dismiss"
                  aria-label="关闭这条错误提示"
                  title="关闭错误提示"
                  onClick={() => onDismissError(item.id)}
                >
                  ×
                </button>
              )}
            {canReference && (
              <button
                type="button"
                className="message-reference-button"
                aria-label={`引用${displayName}的这条消息`}
                onClick={() => onReference(item)}
              >
                引用
              </button>
            )}
            <time>
              {formattedTime}
            </time>
          </div>
        </div>
      </div>
    </article>
  );
}

export default memo(ChatMessage);
