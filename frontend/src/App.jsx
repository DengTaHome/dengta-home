import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resizeComposerInput } from "./composer-size.js";
import { useMemoryUiRequest as useScopedUiRequest } from "./memory-ui-feedback.js";
import { MAX_SESSION_TITLE, readSessionDelete, readSessionRename, sessionDialogFailure } from "./session-dialog-feedback.js";
import SessionDialog from "./SessionDialog.jsx";
import { createCoWatchLifecycle } from "./co-watch-lifecycle.js";
import { createScreenGlanceLifecycle } from "./screen-glance-lifecycle.js";
import { createMusicPlaybackSync } from "./music-playback-sync.js";
import { runNowPlayingControl, sameNowPlaying } from "./now-playing-controls.js";
import { createNowPlayingSync } from "./music-now-playing-sync.js";
import { getMusicPlaylist, listAiMusicPlayRequests, claimAiMusicPlayRequest, commitAiMusicPlayRequest, reportAiMusicPlayResult } from "./music-listening.js";
import { useMusicScope } from "./use-music-scope.js";
import { useBuiltInNowPlaying } from "./useBuiltInNowPlaying.js";
import { chooseNowPlayingCard } from "./built-in-now-playing.js";
import { createAiMusicConsumer } from "./ai-music-consumer.js";
import MemoryGatewayStatus from "./MemoryGatewayStatus.jsx";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { App as CapacitorApp } from "@capacitor/app";
import {
  ArrowLeft,
  BrainCircuit,
  DatabaseZap,
  FileDown,
  Mic2,
  MonitorSmartphone,
  Music,
  Palette,
  ScrollText,
  ServerCog,
  Trophy,
} from "lucide-react";
import {
  API_BASE_URL,
  apiFetch,
  apiRequest,
  streamChat,
} from "./api";
import WebInstallButton from "./WebInstallButton.jsx";
import TypewriterText from "./TypewriterText.jsx";
import DlnaCastPlayer from "./DlnaCastPlayer.jsx";
import { activityRequestInScope, buildCompanionActivityRequest, normalizeCompanionActivities } from "./companion-activities.js";
import { TakeoutQueryPanel } from "./ActivityQueryPanels.jsx";
import {
  BackgroundNotifications,
  openReminderNotificationSettings,
  reminderChannelSettingsAvailable,
} from "./background-notification-identity";
import {
  accountStorageKey,
  readAccountStorage,
  writeAccountStorage,
} from "./account-storage";
import CompanionStatus from "./CompanionStatus";
import CompanionGenderFields from "./CompanionGenderFields";
import ChatContextSettings from "./ChatContextSettings.jsx";
import ChatErrorLog from "./ChatErrorLog.jsx";
import { requestErrorLogs } from "./error-log-request.js";
import { requestDistill, distillDiagnostic, DISTILL_ERROR_FEEDBACK } from "./style-distill.js";
import { companionPronoun } from "./companion-gender";
import { isTextFile } from "./large-text-file.js";
import { readLargeTextSample } from "./large-text-reader.js";
import AmbientContextBadge from "./AmbientContextBadge";
import ChatTranscript from "./ChatTranscript.jsx";
import { awaitChatPreparation, CHAT_SEND_PREPARATION_LABELS } from "./chat-send-preparation.js";
import ChatActivities from "./ChatActivities.jsx";
import ActivityReturnBar from "./ActivityReturnBar.jsx";
import { createActivityReturn, resolveActivityReturn } from "./activity-return.js";
import AchievementGuide from "./AchievementGuide.jsx";
import CompanionInspiration from "./CompanionInspiration.jsx";
import OperationErrorHelp from "./OperationErrorHelp.jsx";
import { describeOperationError } from "./operation-error-help.js";
import SettingsHome from "./SettingsHome.jsx";
import { useSettingsCategoryNavigation } from "./useSettingsCategoryNavigation.js";
import { useSettingsSheetNavigation } from "./useSettingsSheetNavigation.js";
import { copyDiscoveryLink, emptyDiscoveryState, refreshDiscovery, DISCOVERY_ERROR_FEEDBACK } from "./discovery-feed.js";
import PersonalizationEditor from "./PersonalizationEditor.jsx";
import { authSession } from "./auth-session.js";
import { createScopedSettingsSession, registerSettingsSaveGuard, settingsSaveScope } from "./settings-save-scope.js";
import { createCoWatchViewScope } from "./co-watch-view-scope.js";
import LocalDiagnostics from "./LocalDiagnostics.jsx";
import { diagnosticScopeKey } from "./operation-diagnostics.js";
import FeatureNavigation from "./FeatureNavigation.jsx";
import { FEATURE_LABELS, QUICK_FEATURES } from "./feature-navigation.js";
import AchievementNotice from "./AchievementNotice.jsx";
import FunLabsFeedback from "./FunLabsFeedback.jsx";
import { emptyFunLabsState, refreshFunLabsSections, removeFunDate, FUN_LABS_ERROR_FEEDBACK } from "./fun-labs-refresh.js";
import { validateAchievementReceipt, achievementFailure, withAchievementDeadline, ACHIEVEMENT_ERROR_FEEDBACK } from "./achievement-action.js";
import { recordOperationFailure } from "./operation-diagnostics.js";
import { ACHIEVEMENT_ACTIONS, freshAchievements, guideStorageKey } from "./achievement-guide.js";
import { appendActivityDraft } from "./chat-activities.js";
import { useChatDraft } from "./use-chat-draft.js";
import ChatBackground from "./ChatBackground";
import CelestialBackdrop from "./CelestialBackdrop";
import SunGlassTimeDeck from "./SunGlassTimeDeck";
import FeatureAtmosphere from "./FeatureAtmosphere";
import RainbowAgentMark from "./RainbowAgentMark";
import SettingsFlowField from "./SettingsFlowField";
import { AuthenticatedImage } from "./PrivateMedia";
import { usePrivateMediaCatalog } from "./use-private-media-catalog.js";
import {
  privateMediaContentPath,
  selectedPrivateMedia,
} from "./private-media.js";
import { SelectedAttachmentStrip } from "./ChatMessageExtras";
import {
  attachmentKind,
  createAttachmentDraft,
  draftsForLocalMessage,
  normalizeAttachmentFile,
  revokeAttachmentDraft,
  restoreAttachmentDrafts,
  shouldRestoreAttachmentDrafts,
  validateAttachmentFiles,
} from "./chat-attachments";
import {
  chooseChatModel,
  migrateLegacyChatModelToSession,
  readServerSessionChatModel,
  readStoredSessionChatModel,
  reconcileModelCatalog,
  storeSessionChatModel,
} from "./chat-models";
import {
  resolveComposerSendActivation,
  shouldHandleComposerPointerDown,
  shouldSubmitComposerKeyDown,
  transitionComposerOverlays,
} from "./composer-interactions";
import {
  pendingAutosaveAfterFailure,
  shouldFlushSettingsForLifecycle,
  shouldScheduleSettingsOnViewChange,
} from "./settings-autosave";
import {
  canRetryChatClientMessage,
  clearChatClientMessage,
  isChatGenerationInProgress,
  resolveChatClientMessage,
  restoreChatRetryText,
  updateChatClientMessage,
} from "./chat-idempotency";
import {
  applyStoredMessageReferences,
  attachMessageReference,
  clearStoredMessageReferencesForSession,
  createMessageReference,
  normalizeMessageReference,
  storeMessageReferenceForMessage,
} from "./message-reference";
import {
  attachThinkingTrace,
  appendThinkingStatus,
  mergeStreamedAssistantMessage,
} from "./chat-thinking";
import {
  VISIBLE_MONOLOGUE_SOURCE,
  beginVisibleMonologueStream,
  innerMonologueForMessage,
  readInnerMonologues,
  reduceVisibleMonologueEvent,
  storeInnerMonologue,
  canRequestVisibleMonologue,
} from "./inner-monologue";
import { hydrateChatHistory } from "./chat-history";
import { createChatScrollController } from "./chat-scroll-controller";
import { usePrivateMediaSource } from "./use-private-media";
import {
  COMPANION_INTERACTION_TYPES,
  enqueueCompanionInteraction,
} from "./companion-interaction";
import {
  companionStatusForRequest,
  createDefaultCompanionInteractionStats,
  createResetCompanionStatus,
  mergeCompanionStatus,
  normalizeCompanionInteractionStats,
  normalizeCompanionStatus,
  readCompanionInteractionStats,
  readCompanionStatus,
  recordCompanionInteraction,
  saveCompanionInteractionStats,
  saveCompanionStatus,
} from "./companion-status";
import {
  PROMPT_FIELD_LIMITS,
  createSettingsPayload,
  emptySettings,
  formatPromptReceiptProvider,
  normalizePromptReceipt,
  normalizeSettingsDraft,
  mergeLegacyPromptFields,
  settingsNeedsUnifiedPromptMigration,
  settingsPayloadFingerprint,
} from "./settings";
import { applyPersonaResetToLocalStorage } from "./persona-reset";
import {
  reasoningEffortForProvider,
} from "./provider-reasoning-effort";
import { readReplySuggestions } from "./chat-reply-suggestions";
import DlnaDiscoveryFeedback from "./DlnaDiscoveryFeedback.jsx";
import {
  readCachedCoordinates,
  readCachedWeather,
  SHANGHAI_TIME_ZONE,
} from "./ambient-context";
import {
  DEVICE_ACTIVITY_REFRESH_MS,
  DEVICE_ACTIVITY_WINDOW_MINUTES,
  DeviceActivity,
  deviceActivityPluginAvailable,
  mergeCurrentAppContext,
  mergeDeviceActivityContext,
  normalizeDeviceActivityState,
  normalizeDeviceActivitySummary,
  controlNowPlaying,
  readCurrentApp,
  readDeviceActivityState,
  readNowPlaying,
} from "./device-activity";
import { useNotificationAccess } from "./use-notification-access";
import { playNeteaseSilent } from "./netease-playback";
import { openBuiltInBrowser, readBrowserCookie } from "./browser-launcher.js";
import {
  DEVICE_SIGNALS_REPORT_MS,
  ackDeviceInjects,
  deviceSignalsPluginAvailable,
  mergeDeviceSignalsContext,
  readDeviceSignals,
  readPendingDeviceInjects,
  reportDeviceState,
} from "./device-signals.js";
import {
  requestWhereaboutsPermissions,
  startWhereaboutsScheduler,
} from "./whereabouts.js";
import {
  TAKEOUT_PLATFORMS,
  openTakeoutLogin,
  readTakeoutLoginState,
  startTakeoutRunner,
  takeoutPluginAvailable,
} from "./takeout-executor.js";
import {
  logoutXhs,
  readXhsLoginStatus,
  readXhsMe,
  startXhsLogin,
} from "./xhs-login.js";
import {
  SCREEN_GLANCE_DEFAULT_CONFIG,
  ScreenGlance,
  buildScreenGlanceTurn,
  clearPendingScreenGlanceTurn,
  normalizeScreenGlanceConfig,
  normalizeScreenGlanceState,
  readCoWatchPreview,
  readScreenGlanceState,
  screenGlanceCaptureToFile,
  screenCaptureMatchesIdentity,
  screenGlancePluginAvailable,
} from "./screen-glance";
import {
  DlnaReceiver,
  dlnaPluginAvailable,
  normalizeDlnaState,
  readDlnaState,
  startDlnaReceiver,
  stopDlnaReceiver,
} from "./dlna-receiver";
import { maybeNotifyNewCompanionReplies } from "./companion-reply-notifier";
import {
  createCoWatchSession,
  createCoWatchPairingCode,
  endCoWatchSession,
  patchCoWatchPlayback,
  readActiveCoWatchSession,
  readCoWatchDialog,
  sendCoWatchReply,
} from "./co-watch";
import {
  clearDirectMediaSession,
  DIRECT_MEDIA_SOURCE_APP,
  WEB_PAGE_SOURCE_APP,
} from "./direct-media.js";
import { installInnerHeightViewportFallback } from "./mobile-viewport";
import { toggleMomentLikeOptimistically } from "./moment-like";
import {
  BACKEND_WAKE_TIMEOUT_MS,
  STARTUP_REQUEST_OPTIONS,
  createStartupReconnectController,
  mergeRecoveredStartupData,
} from "./startup-reconnect";
import {
  VOICE_MAX_DURATION_MS,
  VOICE_PLAYBACK_MODES,
  VOICE_STATES,
  VOICE_STATE_LABELS,
  voiceBlocksComposer,
  buildVoiceTurnFormData,
  createVoiceTurnRequest,
  formatVoiceConfidence,
  normalizeVoiceAnalysis,
  normalizeVoicePlaybackMode,
  selectRecorderMimeType,
  speakVoiceText,
  stopVoiceSpeech,
  validateVoiceDuration,
  voiceCaptureErrorMessage,
  voiceRecordingSupported,
} from "./voice";
import {
  getVoiceOutput,
  shouldRequestVoiceOutputForText,
  voiceOutputServiceState,
} from "./voice-output";
import {
  SERVICE_LINKS,
  buildServiceStatusCards,
  describeExpressiveTts,
  describeGroqExpiry,
  readGroqExpiryDate,
  storeGroqExpiryDate,
} from "./service-status";
import { useDengTaTheme } from "./dengta-theme";
import {
  chatSkinPreferencesApiPayload,
  normalizeChatSkinPreferences,
  readStoredChatSkinPreferences,
  writeStoredChatSkinPreferences,
} from "./chat-skin";
import {
    dismissChatErrorMessage,
    publicChatErrorMessage,
    temporaryReplyOnFailure,
} from "./chat-errors";

const AiProviderCenter = lazy(() => import("./AiProviderCenter"));
const CompanionCreativeSettings = lazy(
  () => import("./CompanionCreativeStudio"),
);
const CompanionArtStudio = lazy(() => import("./CompanionArtStudio.jsx"));
const CompanionDiary = lazy(() => import("./CompanionDiary"));
const StoryChapters = lazy(() => import("./StoryChapters.jsx"));
const CompanionProfile = lazy(() => import("./CompanionProfile"));
const ContentImport = lazy(() => import("./ContentImport"));
const AccountExport = lazy(() => import("./AccountExport"));
const MusicSettings = lazy(() => import("./MusicSettings"));
const ExternalMemoryConnections = lazy(
  () => import("./ExternalMemoryConnections"),
);
const McpDeviceCenter = lazy(() => import("./McpDeviceCenter"));
const Nursery = lazy(() => import("./Nursery"));
const IntimateDuel = lazy(() => import("./IntimateDuel"));
const OmbreMemories = lazy(() => import("./OmbreMemories"));
const LocalMemorySummaries = lazy(() => import("./LocalMemorySummaries.jsx"));
const Together = lazy(() => import("./Together.jsx"));
const ThemeStudio = lazy(() => import("./ThemeStudio"));
const MediaSettings = lazy(() => import("./MediaSettings"));
const VoiceProviderSettings = lazy(
  () => import("./VoiceProviderSettings"),
);
const WorkspaceManager = lazy(() => import("./WorkspaceManager"));
const CottonPet = lazy(() => import("./CottonPet.jsx"));
const CottonChatDock = lazy(() => import("./CottonChatDock.jsx"));

function DeferredFeature({ label }) {
  return (
    <div className="deferred-feature" role="status" aria-live="polite">
      <span aria-hidden="true" />
      {label}
    </div>
  );
}

const PUSH_CURSOR_KEY = "dengta_push_cursor";
const PUSH_SEEN_IDS_KEY = "dengta_push_seen_ids";
const PUSH_POLL_INTERVAL_MS = 30 * 1000;
const MOMENTS_POLL_INTERVAL_MS = 15 * 1000;
const EMOTION_UNDERSTANDING_KEY = "dengta_emotion_understanding_enabled";
const COMPANION_INTERACTION_DEBOUNCE_MS = 220;
const COMPANION_INTERACTION_RATE_LIMIT = 6;
const COMPANION_INTERACTION_RATE_WINDOW_MS = 60 * 1000;
const LOCAL_NOTIFICATION_CHANNEL_ID = "dengta-home-reminders-v2";
const PROMPT_RECEIPT_STORAGE_KEY = "dengta_prompt_receipt_v1";
const VOICE_PLAYBACK_MODE_KEY = "dengta_voice_playback_mode";
const SETTINGS_SAVE_RETRY_DELAYS_MS = [1200, 3500, 8000];

const SETTINGS_CATEGORIES = [
  {
    id: "appearance",
    label: "外观与聊天",
    description: "天空、玻璃、气泡与动效",
    Icon: Palette,
  },
  {
    id: "persona",
    label: "个性化与记忆",
    description: "提示词、长期详情与主动消息",
    Icon: BrainCircuit,
  },
  {
    id: "services",
    label: "模型与服务",
    description: "接口、模型、服务状态与创作",
    Icon: ServerCog,
  },
  {
    id: "voice",
    label: "语音与情绪",
    description: "语音理解、播放与麦克风",
    Icon: Mic2,
  },
  {
    id: "devices",
    label: "设备与共看",
    description: "通知、活动感知、屏幕共看与设备",
    Icon: MonitorSmartphone,
  },
  {
    id: "fun",
    label: "成就与新玩法",
    description: "成就、纪念日、外卖与小红书",
    Icon: Trophy,
  },
  {
    id: "data-import",
    label: "数据导入",
    description: "世界书与聊天记录",
    Icon: DatabaseZap,
  },
  {
    id: "data-export",
    label: "数据导出",
    description: "全量备份：聊天、人设、记忆与创作",
    Icon: FileDown,
  },
  {
    id: "music-import",
    label: "音乐导入",
    description: "网易云歌单导入与搜索",
    Icon: Music,
  },
  {
    id: "logs",
    label: "错误日志",
    description: "最近错误代码、位置与排查记录",
    Icon: ScrollText,
  },
];

function ErrorLogsPanel({ accountScope, companionScope, onOpenSettings }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const requestRevision = useRef(0);
  const pendingLogRequest = useRef(null);

  const refresh = useCallback(async () => {
    if (pendingLogRequest.current) return;
    const request = ++requestRevision.current;
    const controller = new AbortController();
    pendingLogRequest.current = controller;
    const owner = diagnosticScopeKey(accountScope, companionScope);
    const isCurrent = () => request === requestRevision.current && !controller.signal.aborted && settingsSaveScope(authSession.getSnapshot()) === owner;
    setLoading(true);
    setLoadError("");
    try {
      const scopedSession = createScopedSettingsSession(authSession, owner, controller.signal);
      const items = await requestErrorLogs(apiRequest, 50, 15000, { authSession: scopedSession, signal: controller.signal });
      if (!isCurrent()) return;
      setLogs(items);
    } catch (error) {
      if (isCurrent()) {
        if (["request_timeout", "error_logs_receipt_invalid"].includes(error?.code)) recordOperationFailure(owner, "/api/errors", error);
        setLoadError({ code: error?.code, status: error?.status });
      }
    } finally {
      if (pendingLogRequest.current === controller) pendingLogRequest.current = null;
      if (isCurrent()) setLoading(false);
    }
  }, [accountScope, companionScope]);

  useEffect(() => {
    const revision = requestRevision;
    const pending = pendingLogRequest;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => { window.clearTimeout(timer); revision.current++; pending.current?.abort(); pending.current = null; };
  }, [refresh]);

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  return (
    <div>
      <LocalDiagnostics scope={diagnosticScopeKey(accountScope, companionScope)} />
    <div className="settings-card error-logs-card">
      <h3>错误日志（最近 {logs.length} 条）</h3>
      <p className="card-hint">
        点击可查看错误代码、业务文件位置和请求阶段。展示技术信息，不展示异常原文；旧记录可能没有可用位置。
      </p>
      <div className="error-logs-actions">
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>
      {loadError && <div className="error-logs-load-error" role="alert"><OperationErrorHelp diagnostic={loadError} onOpenSettings={onOpenSettings} /><small>读取错误代码：{describeOperationError(loadError).code}</small></div>}
      {!loadError && logs.length === 0 && !loading && (
        <div className="error-logs-empty">暂无错误记录 🎉</div>
      )}
      <ul className="error-logs-list">
        {logs.map((log) => {
          const expanded = expandedId === log.id;
          return (
            <li
              key={log.id}
              className={"error-log-item" + (expanded ? " expanded" : "")}
            >
              <button
                type="button"
                className="error-log-summary"
                onClick={() => setExpandedId(expanded ? null : log.id)}
              >
                <span className="error-log-time">{formatTime(log.created_at)}</span>
                <span className="error-log-code">{log.error_code || "unknown"}</span>
                <span className="error-log-path">{log.method} {log.path}</span>
              </button>
              {expanded && (
                <div className="error-log-detail">
                  <OperationErrorHelp diagnostic={{ code: log.error_code }} onOpenSettings={onOpenSettings} />
                  <details className="error-log-technical"><summary>错误代码与技术详情</summary>
                  <p className="error-log-message">{log.message || ""}</p>
                  {log.error_location && <p>业务位置：{log.error_location}</p>}
                  <p className="error-log-meta">
                    来源 / Source: {log.error_source || "dengta"} · 阶段 / Phase:{" "}
                    {log.provider_phase || "-"} · 上游 / Upstream:{" "}
                    {log.provider_code || "-"} · HTTP: {log.upstream_status ?? "-"}{" "}
                    · 会话: {log.conversation_id || "-"}
                  </p>
                  {log.stack_trace && (
                    <pre className="error-log-stack">{log.stack_trace}</pre>
                  )}
                  </details>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
    </div>
  );
}

function MemoryImportCard() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [diagnostic, setDiagnostic] = useState(null);

  async function runImport() {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    setDiagnostic(null);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('旧记忆直传最大 20MB；大文本请打开设置中的「数据导入」，可分段处理至 1GB。');
      const form = new FormData();
      form.append('file', file);
      const response = await apiFetch('/api/v2/memory/import-file', {
        method: 'POST',
        body: form,
        retry: false,
        timeoutMs: 90000,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        throw Object.assign(new Error(data?.message || '导入未完成，请先核对记忆库再重试，避免重复保存。'), { status: response.status, code: data?.code, logId: data?.error_log_id, source: data?.error_source, upstreamStatus: data?.upstream_status });
      }
      setResult(data);
    } catch (importError) {
      setError(importError?.message || '导入失败，请稍后重试。');
      setDiagnostic({error_code:importError.code,error_log_id:importError.logId,error_source:importError.source,upstream_status:importError.upstreamStatus});
    } finally {
      setBusy(false);
    }
  }

  async function runHistoryImport() {
    if (historyBusy) return;
    setHistoryBusy(true);
    setError('');
    setResult(null);
    setDiagnostic(null);
    try {
      const response = await apiFetch('/api/v2/memory/import-history', {
        method: 'POST',
        retry: false,
        timeoutMs: 300000,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        throw Object.assign(new Error(data?.message || '导入历史未完成，请先检查记忆服务状态。'), { status: response.status, code: data?.code, logId: data?.error_log_id, source: data?.error_source, upstreamStatus: data?.upstream_status });
      }
      setResult(data);
    } catch (importError) {
      setError(importError?.message || '导入历史失败，请稍后重试。');
      setDiagnostic({error_code:importError.code,error_log_id:importError.logId,error_source:importError.source,upstream_status:importError.upstreamStatus});
    } finally {
      setHistoryBusy(false);
    }
  }

  return (
    <div className="settings-card memory-import-card">
      <h3>导入旧记忆（可选）</h3>
      <p className="card-hint">
        把你以前和 AI 聊过的内容导入到这个账号自己的长期记忆库（与其他用户隔离）。
        支持 txt / md / json / csv / pdf / docx / xlsx / zip 文件；
        服务器会自动提取文字并整理成记忆（AI 可用时智能提炼，否则按段落保存）。
        此旧版入口最大 20MB，可能只整理部分内容；大记录建议使用「数据导入」的分段预览与确认。
      </p>
      <div className="memory-import-actions">
        <input
          type="file"
          accept=".txt,.md,.json,.csv,.pdf,.docx,.xlsx,.zip"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0] || null);
            setResult(null);
            setError('');
          }}
        />
        <button
          type="button"
          className="memory-import-run"
          disabled={!file || busy}
          onClick={() => void runImport()}
        >
          {busy ? '导入中…' : '开始导入'}
        </button>
        <button
          type="button"
          className="memory-import-history"
          disabled={historyBusy}
          onClick={() => void runHistoryImport()}
        >
          {historyBusy ? '整理中…' : '从灯塔历史导入（最多 5000 条、30 万字）'}
        </button>
      </div>
      {error && <p className="memory-import-error">{error}</p>}
      {error && diagnostic && <ChatErrorLog key={diagnostic.error_log_id || error} logId={diagnostic.error_log_id} diagnostic={diagnostic} />}
      {result && result.ok === true && (
        <div className="memory-import-result">
          <strong>导入完成</strong>
          <span>
            成功 {result.imported || 0} 条，跳过 {result.skipped || 0} 条，
            记忆库现有 {result.total ?? '?'} 条
            {result.mode === 'ai' ? '（AI 智能整理）' : '（按段落保存）'}
          </span>
          {result.coverage_notice && <small>{result.coverage_notice}</small>}
        </div>
      )}
      {result && result.ok !== true && !error && (
        <p className="memory-import-error">
          {result?.message || result?.error || '导入失败'}
        </p>
      )}
    </div>
  );
}
function shanghaiClientTime(value = new Date()) {
  return value.toLocaleString("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    hour12: false,
  });
}

const initialNotificationPermissionState = {
  status: "idle",
  message: "开启主动消息后，Android App 会自动准备通知权限和后台检查。",
};

async function prepareLocalNotificationPermission() {
  if (!Capacitor.isNativePlatform()) {
    return {
      status: "web",
      message:
        "网页会同步主动消息，但网页暂无后台声音和震动提醒；锁屏提醒由安装在手机上的 Android App 接收。",
    };
  }

  if (!Capacitor.isPluginAvailable("LocalNotifications")) {
    return {
      status: "error",
      message: "当前安装包缺少通知插件，请安装最新 Android 版本。",
    };
  }

  try {
    let permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted") {
      permission = await LocalNotifications.requestPermissions();
    }
    if (permission.display !== "granted") {
      return {
        status: "error",
        message:
          "通知权限没有开启。请到“手机设置 → 应用 → DengTa home → 通知”中允许通知。",
      };
    }

    const enabled = await LocalNotifications.areEnabled();
    if (!enabled.value) {
      return {
        status: "error",
        message:
          "手机系统仍在拦截通知。请到 DengTa home 的系统通知设置中打开总开关。",
      };
    }

    if (Capacitor.getPlatform() === "android") {
      await LocalNotifications.createChannel({
        id: LOCAL_NOTIFICATION_CHANNEL_ID,
        name: "DengTa home 主动消息",
        description: "AI 伙伴在合适时间主动想说的话",
        importance: 4,
        visibility: 1,
        vibration: true,
      });
    }

    return {
      status: "success",
      message:
        "主动通知已准备好。App 退到后台后会由手机系统定期检查，不需要再点测试按钮。",
    };
  } catch (error) {
    return {
      status: "error",
      message: `通知准备失败：${error?.message || "手机通知插件返回了未知错误"}`,
    };
  }
}

function readPromptReceipt(accountScope = "") {
  try {
    const stored = readAccountStorage(
      localStorage,
      PROMPT_RECEIPT_STORAGE_KEY,
      accountScope,
      { migrateLegacy: true },
    );
    return stored ? normalizePromptReceipt(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

function storePromptReceipt(receipt, accountScope = "") {
  try {
    writeAccountStorage(
      localStorage,
      PROMPT_RECEIPT_STORAGE_KEY,
      accountScope,
      JSON.stringify(receipt),
    );
  } catch {
    // 本地存储不可用时，只影响重启后的回执显示。
  }
}

const navItems = [
  { id: "chat", icon: "⌁", label: "Chat" },
  { id: "moments", icon: "◌", label: "Moments" },
  { id: "diary", icon: "▱", label: "Diary" },
  { id: "art", icon: "✎", label: "涂鸦画室" },
  { id: "nursery", icon: "♡", label: "Family" },
  { id: "cotton", icon: "✿", label: "小棉花" },
  { id: "together", icon: "▻", label: "Together" },
  { id: "music", icon: "🎵", label: "听歌" },
  { id: "duel", icon: "⚔", label: "Duel" },
  { id: "memories", icon: "◇", label: "Memory" },
  { id: "takeout", icon: "🛵", label: "外卖" },
  { id: "achievements", icon: "🏆", label: "成就" },
  { id: "workspace", icon: "📁", label: "工作区" },
  { id: "discover", icon: "🔭", label: "发现" },
];

function formatDateTime(value) {
  if (!value) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function readSeenPushIds(accountScope = "") {
  try {
    const stored = readAccountStorage(
      localStorage,
      PUSH_SEEN_IDS_KEY,
      accountScope,
      { migrateLegacy: true },
    );
    const value = JSON.parse(stored || "[]");
    return Array.isArray(value) ? value.filter(Boolean).slice(-200) : [];
  } catch {
    return [];
  }
}

function readEmotionUnderstandingSetting(accountScope = "") {
  try {
    const stored = readAccountStorage(
      localStorage,
      EMOTION_UNDERSTANDING_KEY,
      accountScope,
      { migrateLegacy: true },
    );
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function readVoicePlaybackMode(accountScope = "") {
  try {
    const stored = readAccountStorage(
      localStorage,
      VOICE_PLAYBACK_MODE_KEY,
      accountScope,
      { migrateLegacy: true },
    );
    return normalizeVoicePlaybackMode(stored);
  } catch {
    return VOICE_PLAYBACK_MODES.off;
  }
}

function voiceInputBusy(state) {
  return [
    VOICE_STATES.requesting,
    VOICE_STATES.recording,
    VOICE_STATES.uploading,
    VOICE_STATES.thinking,
  ].includes(state);
}

function createCompanionInteractionEventId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  );
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择。"));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片压缩失败，请换一张图片重试。"));
      },
      type,
      quality,
    );
  });
}

async function prepareImageUpload(file) {
  const supportedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ];

  if (!supportedTypes.includes(file.type)) {
    throw new Error("图片只支持 JPG、PNG、WebP 或 GIF。");
  }

  if (file.type === "image/gif") {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("GIF 图片必须小于 5MB。");
    }
    return {
      name: file.name,
      type: file.type,
      blob: file,
      warning: `${file.name} 是 GIF，为保留动画不会重新编码，文件内可能仍含拍摄设备等元数据。`,
    };
  }

  if (file.size > 15 * 1024 * 1024) {
    throw new Error("相机原图不能超过 15MB。");
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("这张图片无法安全重新编码。为避免保留照片元数据，请换一张图片。");
  }

  const longestSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, 1800 / longestSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close?.();
    throw new Error("浏览器无法处理这张图片，请换一张重试。");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const compressed = await canvasToBlob(canvas, "image/jpeg", 0.82);
  if (compressed.size > 5 * 1024 * 1024) {
    throw new Error("图片压缩后仍超过 5MB，请换一张较小的图片。");
  }

  return {
    name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
    type: "image/jpeg",
    blob: compressed,
    warning: "",
  };
}

function momentFailureMessage(error) {
  const { code, reason, action } = describeOperationError(error);
  const localFailures = {
    moments_response_invalid: { reason: "动态列表回执不完整，已有列表已保留。", action: "请刷新动态重新读取。" },
    moment_post_receipt_invalid: { reason: "动态发布回执不完整。", action: "请先刷新动态核对，避免重复发布。" },
    moment_comment_receipt_invalid: { reason: "评论保存回执不完整。", action: "请先刷新动态核对，避免重复评论。" },
    moment_like_receipt_invalid: { reason: "点赞回执不完整。", action: "请刷新动态核对结果。" },
    moment_image_prepare_failed: { reason: "图片准备没有完成。", action: "请重新选择 JPG、PNG、WebP 或 GIF；GIF 须小于 5MB，其他原图须小于 15MB。" },
  };
  const feedback = Object.hasOwn(localFailures, code) ? localFailures[code] : { reason, action };
  return `${feedback.reason}${feedback.action}（错误代码：${code}）`;
}

async function prepareMomentImage(file) {
  const prepared = await prepareImageUpload(file);
  const dataUrl = await readFileAsDataUrl(prepared.blob);
  return {
    name: prepared.name,
    type: prepared.type,
    data: dataUrl.split(",")[1] || "",
    preview: dataUrl,
    warning: prepared.warning || "",
  };
}

async function prepareChatAttachmentFile(file) {
  const normalizedFile = normalizeAttachmentFile(file);
  if (attachmentKind(normalizedFile) !== "image") {
    return { file: normalizedFile, warning: "" };
  }
  const prepared = await prepareImageUpload(normalizedFile);
  return {
    file:
      prepared.blob === normalizedFile
        ? normalizedFile
        : new File([prepared.blob], prepared.name, {
            type: prepared.type,
            lastModified: Date.now(),
          }),
    warning: prepared.warning || "",
  };
}

function releaseChatRequestAttachments(request) {
  if (!request || request.attachmentsReleased) return;
  request.attachments.forEach((item) => revokeAttachmentDraft(item));
  request.attachmentsReleased = true;
}

function releasePendingScreenGlanceTurn(pendingRef) {
  const pending = pendingRef?.current;
  clearPendingScreenGlanceTurn(pending, revokeAttachmentDraft);
  if (pendingRef) pendingRef.current = null;
  return pending;
}

function abortChatRequest(requestRef, reason = "cancelled") {
  const request = requestRef.current;
  if (!request || request.controller.signal.aborted) return;
  request.cancelReason = reason;
  request.controller.abort(reason);
  if (!["view-change", "user-cancel"].includes(reason)) {
    releaseChatRequestAttachments(request);
  }
}

function hydrateSessionChatHistory(messages, sessionId) {
  return applyStoredMessageReferences(hydrateChatHistory(messages), sessionId);
}

function App({ accountControl = null, accountScope = "", userName = "" }) {
  const VOICE_LONG_PRESS_MS = 300;
  const visualPreview = arguments[0]?.visualPreview === true;
  const companionScope = String(arguments[0]?.companionScope || "").trim();
  const accountStorageScope = String(accountScope || "").trim();
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage, setSessionDraft, moveSessionDraft] = useChatDraft(accountStorageScope, companionScope, activeSessionId);
  const [messageReference, setMessageReference] = useState(null);
  const [turnContext, setTurnContext] = useState("");
  const [chatAttachments, setChatAttachments] = useState([]);
  const [attachmentSafetyEnabled, setAttachmentSafetyEnabled] = useState(true);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedChatModel, setSelectedChatModel] = useState("");
  const [modelsLoadMessage, setModelsLoadMessage] = useState("");
  const [settings, setSettings] = useState(emptySettings);
  const [draftSettings, setDraftSettings] = useState(emptySettings);
  const [settingsExitBusy, setSettingsExitBusy] = useState(false);
  const settingsExitBusyRef = useRef(false);
  const effectiveUserName =
    String(settings.user_display_name || userName || "").trim() || "你";
  const effectiveAiName =
    String(settings.ai_name || "").trim() || "伴侣";
  const [activeView, setActiveView] = useState("chat");
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const workspaceLeaveGuardRef = useRef(null);
  const canLeaveWorkspace = useCallback(view => activeViewRef.current !== "workspace" || view === activeViewRef.current || !workspaceLeaveGuardRef.current || workspaceLeaveGuardRef.current(), []);
  const registerWorkspaceLeaveGuard = useCallback(guard => {
    workspaceLeaveGuardRef.current = guard;
    return () => { if (workspaceLeaveGuardRef.current === guard) workspaceLeaveGuardRef.current = null; };
  }, []);
  const [togetherEntryMode, setTogetherEntryMode] = useState("external");
  const coWatchViewKindRef = useRef(activeView);
  coWatchViewKindRef.current = activeView;
  const [musicActivityRequest, setMusicActivityRequest] = useState(null);
  const [watchActivityRequest, setWatchActivityRequest] = useState(null);
  const [takeoutActivityRequest, setTakeoutActivityRequest] = useState(null);
  const [activityReturn, setActivityReturn] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState(null);
  const [settingsFocusTarget, setSettingsFocusTarget] = useState("");
  const [chatSkinPreferences, setChatSkinPreferences] = useState(
    () =>
      readStoredChatSkinPreferences(
        globalThis.localStorage,
        accountStorageScope,
      ),
  );
  const [composerHint, setComposerHint] = useState("");
  const [celestialCoordinates, setCelestialCoordinates] = useState(
    () => readCachedCoordinates().coordinates,
  );
  const [ambientWeather, setAmbientWeather] = useState(
    () => readCachedWeather().weather,
  );
  const [weatherPreviewMode, setWeatherPreviewMode] = useState(null);
  const {
    preferences: themePreferences,
    snapshot: celestialSnapshot,
    updateTheme,
    previewMinute,
    setPreviewMinute,
  } = useDengTaTheme(celestialCoordinates, accountStorageScope);
  const [memories, setMemories] = useState([]);
  const [memoryDrafts, setMemoryDrafts] = useState({});
  const [moments, setMoments] = useState([]);
  const [momentsAvailable, setMomentsAvailable] = useState(null);
  const [momentsLoading, setMomentsLoading] = useState(false);
  const [momentsLoadError, setMomentsLoadError] = useState("");
  const [momentDraft, setMomentDraft] = useState("");
  const [momentImages, setMomentImages] = useState([]);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [isLoading, setIsLoading] = useState(!visualPreview);
  const [isSending, setIsSending] = useState(false);
  const [sendPreparationStage, setSendPreparationStage] = useState("");
  const [isCompanionResponding, setIsCompanionResponding] = useState(false);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [settingsAutosaveState, setSettingsAutosaveState] = useState("idle");
  const [settingsSaveError, setSettingsSaveError] = useState("");
  const [settingsSaveReceipt, setSettingsSaveReceipt] = useState(null);
  const privateMediaScope = JSON.stringify([accountStorageScope, companionScope]);
  const {
    catalog: privateMediaCatalog, loading: privateMediaLoading, error: privateMediaError,
    refresh: refreshPrivateMediaCatalog, updateCatalog: setPrivateMediaCatalog,
  } = usePrivateMediaCatalog(privateMediaScope, visualPreview);
  const [lastPromptReceipt, setLastPromptReceipt] = useState(() =>
    readPromptReceipt(accountStorageScope),
  );
  const [notificationPermissionState, setNotificationPermissionState] = useState(
    initialNotificationPermissionState,
  );
  const [deviceActivityState, setDeviceActivityState] = useState(() =>
    normalizeDeviceActivityState({}),
  );
  const [dlnaState, setDlnaState] = useState(() => normalizeDlnaState({}));
  const [dlnaBusy, setDlnaBusy] = useState(false);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [nowPlayingBusy, setNowPlayingBusy] = useState(false);
  const nowPlayingDismissedRef = useRef(false);
  const lastNowPlayingRef = useRef(null);

  const { state: notificationAccess, request: requestNotificationAccess, refresh: refreshNotificationAccess } = useNotificationAccess();

  const aiMusicScope = useMusicScope(accountStorageScope, companionScope);
  const { control: controlBuiltInNowPlaying, yieldToExternal: yieldBuiltInNowPlaying, onLocalPlaybackChange } = useBuiltInNowPlaying({
    scope: aiMusicScope, accountScope: accountStorageScope, companionScope, enabled: hasLoadedSettings,
    externalAvailable: deviceActivityPluginAvailable, readExternal: readNowPlaying,
    onSong: song => setNowPlaying(current => nowPlayingDismissedRef.current ? current : song || (current?.source === "dengta" ? null : current)),
    onBusy: setNowPlayingBusy, onFeedback: message => setNotice(message),
    onStartupFeedback: value => setScreenGlanceFeedback(value),
  });
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || visualPreview || !accountStorageScope || !companionScope) return;
    const consumer = createAiMusicConsumer({ scope: aiMusicScope, list: listAiMusicPlayRequests, claim: claimAiMusicPlayRequest, commit: commitAiMusicPlayRequest, report: reportAiMusicPlayResult, open: playNeteaseSilent, storage: globalThis.sessionStorage, onFeedback: message => setNotice(message) });
    void consumer.drain();
    const timer = window.setInterval(() => void consumer.drain(), 5000);
    return () => { window.clearInterval(timer); consumer.cancel(); };
  }, [aiMusicScope, accountStorageScope, companionScope, visualPreview]);

  // Listening to system media notifications is separate from consuming explicit AI song requests.
  useEffect(() => {
    if (!deviceActivityPluginAvailable() || !notificationAccess.granted) {
      setNowPlaying(current => current?.source === "dengta" ? current : null);
      return;
    }
    let alive = true, busy = false;
    const token = aiMusicScope.capture();
    const poll = async () => {
      if (busy || !alive || !aiMusicScope.current(token)) return;
      busy = true;
      try {
        const song = await readNowPlaying().catch(() => null);
        if (!alive || !aiMusicScope.current(token)) return;
        if (song?.title) {
          const previous = lastNowPlayingRef.current;
          const changed = !sameNowPlaying(previous, song);
          if (changed) nowPlayingDismissedRef.current = false;
          if (song.isPlaying === true && song.playbackStateKnown !== false) yieldBuiltInNowPlaying();
          if (!nowPlayingDismissedRef.current) setNowPlaying(current => chooseNowPlayingCard(current, song));
          lastNowPlayingRef.current = song;
          if (changed) void syncNowPlayingToSession(song);
        } else if (!nowPlayingDismissedRef.current) {
          setNowPlaying(current => current?.source === "dengta" ? current : null);
        }
      } finally { busy = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => { alive = false; window.clearInterval(timer); lastNowPlayingRef.current = null; };
    // syncNowPlayingToSession is a stable callback declared after this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMusicScope, accountStorageScope, companionScope, notificationAccess.granted, yieldBuiltInNowPlaying]);

  useEffect(() => {
    setNowPlayingBusy(false);
    setNowPlaying(null);
    nowPlayingDismissedRef.current = false;
  }, [accountStorageScope, companionScope]);

  const handleNowPlayingControl = useCallback(action => {
    if (nowPlaying?.source === "dengta") {
      void controlBuiltInNowPlaying(action, nowPlaying);
      return;
    }
    void runNowPlayingControl({ scope: aiMusicScope, song: nowPlaying, action, control: controlNowPlaying, read: readNowPlaying,
      onBusy: setNowPlayingBusy,
      onSong: song => { if (!nowPlayingDismissedRef.current) setNowPlaying(song); },
      onFeedback: message => setNotice(message),
    });
  }, [aiMusicScope, nowPlaying, controlBuiltInNowPlaying]);
  const handleNowPlayingPlayPause = useCallback(() => handleNowPlayingControl(nowPlaying?.isPlaying ? "pause" : "play"), [handleNowPlayingControl, nowPlaying?.isPlaying]);
  const handleNowPlayingNext = useCallback(() => handleNowPlayingControl("next"), [handleNowPlayingControl]);

  const handleDismissNowPlaying = useCallback(() => {
    nowPlayingDismissedRef.current = true;
    setNowPlaying(null);
  }, []);
  const [deviceActivityFeedback, setDeviceActivityFeedback] = useState({
    status: "idle",
    message: "默认关闭。开启后只提供最近使用过的 App 名称和粗略时长。",
  });
  const [isDeviceActivityBusy, setIsDeviceActivityBusy] = useState(false);
  const [screenGlanceState, setScreenGlanceState] = useState(() =>
    normalizeScreenGlanceState({}),
  );
  const [screenGlanceConfig, setScreenGlanceConfig] = useState(
    SCREEN_GLANCE_DEFAULT_CONFIG,
  );
  const [screenGlanceFeedback, setScreenGlanceFeedback] = useState({
    status: "idle",
    message: "默认关闭。只有 Android 系统明确显示共享状态时才可能取得画面。",
  });
  const [isScreenGlanceBusy, setIsScreenGlanceBusy] = useState(false);
  const [coWatchSession, setCoWatchSession] = useState(null);
  const coWatchSessionRef = useRef(null);
  // DLNA 投屏专用信息（与屏幕共看完全独立）
  const [dlnaCastInfo, setDlnaCastInfo] = useState(null);
  useEffect(() => {
    coWatchSessionRef.current = coWatchSession;
  }, [coWatchSession]);
  const [coWatchReceipt, setCoWatchReceipt] = useState(null);
  const [coWatchPreview, setCoWatchPreview] = useState(null);
  const [coWatchDialog, setCoWatchDialog] = useState([]);
  const [castPairing, setCastPairing] = useState(null);
  const coWatchIdentityRef = useRef(null);
  coWatchIdentityRef.current = { accountScope: accountStorageScope, companionScope };
  const coWatchViewScopeRef = useRef(null);
  const coWatchPollStampRef = useRef(null);
  if (!coWatchViewScopeRef.current) coWatchViewScopeRef.current = createCoWatchViewScope({
    getIdentity: () => coWatchIdentityRef.current,
    getViewKind: () => coWatchViewKindRef.current,
  });
  const coWatchBusyRef = useRef(false);
  const coWatchReplyJobRef = useRef(null);
  coWatchBusyRef.current = isScreenGlanceBusy;
  const coWatchLifecycleRef = useRef(null);
  if (!coWatchLifecycleRef.current) coWatchLifecycleRef.current = createCoWatchLifecycle({
    getIdentity: () => coWatchIdentityRef.current,
    getSession: () => coWatchSessionRef.current,
    isBusy: () => coWatchBusyRef.current,
    createSession: createCoWatchSession,
    endSession: endCoWatchSession,
    onBusy: (value) => { coWatchBusyRef.current = value; setIsScreenGlanceBusy(value); },
    onStarted: (next) => {
      musicPlaybackSyncRef.current?.invalidate(); nowPlayingSyncRef.current?.invalidate();
      coWatchSessionRef.current = next;
      setCoWatchSession(next); setCoWatchReceipt(null); setCoWatchDialog([]); setCoWatchDanmaku([]);
    },
    onEnded: (ended) => {
      musicPlaybackSyncRef.current?.invalidate(); nowPlayingSyncRef.current?.invalidate();
      coWatchSessionRef.current = null;
      setCoWatchSession(null); setCoWatchReceipt(ended); setCoWatchDialog([]); setCoWatchDanmaku([]);
      const identity = coWatchIdentityRef.current;
      clearDirectMediaSession(globalThis.sessionStorage, identity.accountScope, identity.companionScope);
    },
  });
  const screenGlanceConfigRef = useRef(screenGlanceConfig);
  screenGlanceConfigRef.current = screenGlanceConfig;
  const screenGlanceLifecycleRef = useRef(null);
  if (!screenGlanceLifecycleRef.current) screenGlanceLifecycleRef.current = createScreenGlanceLifecycle({
    getIdentity: () => coWatchIdentityRef.current,
    getSession: () => coWatchSessionRef.current,
    getConfig: () => screenGlanceConfigRef.current,
    isBusy: () => coWatchBusyRef.current,
    plugin: {
      getState: () => readScreenGlanceState(),
      startSession: (options) => ScreenGlance.startSession(options),
      configure: (config) => screenGlancePluginAvailable() ? ScreenGlance.configure(config) : Promise.resolve(config),
      stopSession: (options) => screenGlancePluginAvailable() ? ScreenGlance.stopSession(options) : Promise.resolve({}),
    },
    preparePermission: prepareLocalNotificationPermission,
    createSession: createCoWatchSession,
    endSession: endCoWatchSession,
    onBusy: (value) => { coWatchBusyRef.current = value; setIsScreenGlanceBusy(value); },
    onState: (value) => applyScreenGlanceState(value),
    onStarted: (next) => {
      musicPlaybackSyncRef.current?.invalidate(); nowPlayingSyncRef.current?.invalidate();
      coWatchSessionRef.current = next; setCoWatchSession(next); setCoWatchReceipt(null); setCoWatchDanmaku([]);
    },
    onEnded: (ended) => {
      musicPlaybackSyncRef.current?.invalidate(); nowPlayingSyncRef.current?.invalidate();
      coWatchSessionRef.current = null; setCoWatchSession(null); setCoWatchReceipt(ended); setCoWatchDialog([]); setCoWatchDanmaku([]);
    },
    onStopped: () => {
      setCoWatchPreview(null); releasePendingScreenGlanceTurn(pendingScreenGlanceTurnRef);
    },
  });
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isPostingMoment, setIsPostingMoment] = useState(false);
  const [pendingMomentLikes, setPendingMomentLikes] = useState({});
  const [pendingMomentComments, setPendingMomentComments] = useState({});
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState(null);
  const dialogRef = useRef(dialog);
  const sessionsRef = useRef(sessions);
  const sessionDialogPendingRef = useRef(null);
  const [sessionDialogBusy, setSessionDialogBusy] = useState(false);
  const [sessionDialogFeedback, setSessionDialogFeedback] = useState("");
  const sessionDialogRequest = useScopedUiRequest(privateMediaScope);
  useLayoutEffect(() => { dialogRef.current = dialog; sessionsRef.current = sessions; }, [dialog, sessions]);
  useLayoutEffect(() => {
    sessionDialogPendingRef.current = null;
    setSessionDialogBusy(false);
    setSessionDialogFeedback("");
    setDialog(null);
  }, [privateMediaScope]);
  const [imageViewer, setImageViewer] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    function refreshAfterImport() {
      void refreshPrivateMediaCatalog();
    }
    window.addEventListener("dengta:memories-imported", refreshAfterImport);
    return () =>
      window.removeEventListener("dengta:memories-imported", refreshAfterImport);
  }, [refreshPrivateMediaCatalog]);

  useLayoutEffect(
    () => () => {
      if (coWatchReplyJobRef.current) {
        coWatchReplyJobRef.current = null;
        coWatchBusyRef.current = false;
        setIsScreenGlanceBusy(false);
      }
      coWatchLifecycleRef.current.invalidate();
      coWatchViewScopeRef.current.invalidate();
      musicPlaybackSyncRef.current?.invalidate(); nowPlayingSyncRef.current?.invalidate();
      screenGlanceLifecycleRef.current.invalidate();
      releasePendingScreenGlanceTurn(pendingScreenGlanceTurnRef);
      coWatchSessionRef.current = null;
      clearDirectMediaSession(globalThis.sessionStorage, accountStorageScope, companionScope);
      setCoWatchSession(null);
      setActivityReturn(null);
      setCoWatchDialog([]);
      setCoWatchDanmaku([]);
    },
    [accountStorageScope, companionScope],
  );
  const [startupConnection, setStartupConnection] = useState({
    status: visualPreview ? "connected" : "connecting",
    failureCount: 0,
    nextRetryDelayMs: null,
    lastError: null,
  });
  const [emotionUnderstandingEnabled, setEmotionUnderstandingEnabled] =
    useState(() => readEmotionUnderstandingSetting(accountStorageScope));
  const [voiceState, setVoiceState] = useState(VOICE_STATES.idle);
  const [voiceElapsedMs, setVoiceElapsedMs] = useState(0);
  const [voiceError, setVoiceError] = useState("");
  const [lastVoiceAnalysis, setLastVoiceAnalysis] = useState(null);
  const [isComposerMenuOpen, setIsComposerMenuOpen] = useState(false);
  const [isStatusPanelExpanded, setIsStatusPanelExpanded] = useState(false);
  const [statusPanelCloseRequest, setStatusPanelCloseRequest] = useState(0);
  const [voicePlaybackMode, setVoicePlaybackMode] = useState(
    () => readVoicePlaybackMode(accountStorageScope),
  );
  const [voiceService, setVoiceService] = useState({
    checked: false,
    available: false,
    message: "正在检查服务器语音能力…",
    expressiveEnabled: true,
    expressiveAvailable: false,
    expressiveChineseFallbackAvailable: false,
    expressiveApiKeyConfigured: null,
    expressiveVoiceConfigured: null,
    expressiveProvider: "none",
  });
  const [voiceOutputStatus, setVoiceOutputStatus] = useState(null);
  const [serviceHealth, setServiceHealth] = useState({
    checking: true,
    data: null,
    error: "",
    checkedAt: "",
  });
  const [providerStatus, setProviderStatus] = useState(null);
  const [groqExpiryDate, setGroqExpiryDate] = useState(() =>
    readGroqExpiryDate(globalThis.localStorage, accountStorageScope),
  );
  const [companionStatus, setCompanionStatus] = useState(() =>
    readCompanionStatus(accountStorageScope),
  );
  const [companionInteractionStats, setCompanionInteractionStats] = useState(
    () => readCompanionInteractionStats(accountStorageScope),
  );
  const [innerMonologues, setInnerMonologues] = useState(() =>
    readInnerMonologues(globalThis.localStorage, accountStorageScope),
  );
  const [innerMonologuePending, setInnerMonologuePending] = useState({});
  const [innerMonologueErrors, setInnerMonologueErrors] = useState({});
  const messageListRef = useRef(null);
  const chatScrollControllerRef = useRef(null);
  const settingsScrollRef = useRef(null);
  const settingsPanelRef = useRef(null);
  useSettingsSheetNavigation({
    isOpen: isSettingsOpen, scopeKey: privateMediaScope,
    panelRef: settingsPanelRef, onClose: closeSettingsPanel,
  });
  const settingsCategoryNavigation = useSettingsCategoryNavigation({
    isOpen: isSettingsOpen, category: settingsCategory, scopeKey: privateMediaScope,
    scrollRef: settingsScrollRef, focusTarget: settingsFocusTarget, onSelect: setSettingsCategory,
  });
  const settingsScrollIdleTimerRef = useRef(null);
  const messageInputRef = useRef(null);
  useLayoutEffect(() => {
    resizeComposerInput(messageInputRef.current);
  }, [message, activeView]);
  useLayoutEffect(() => {
    const input = messageInputRef.current;
    if (!input) return undefined;
    // Width and viewport-based height limits can change independently.
    let previousWidth = input.parentElement.clientWidth;
    let previousMaximum = window.getComputedStyle(input).maxHeight;
    const widthObserver = new ResizeObserver(([entry]) => {
      const maximum = window.getComputedStyle(input).maxHeight;
      if (entry.contentRect.width === previousWidth && maximum === previousMaximum) return;
      previousWidth = entry.contentRect.width;
      previousMaximum = maximum;
      resizeComposerInput(input);
    });
    widthObserver.observe(input.parentElement);
    return () => widthObserver.disconnect();
  }, [activeView]);
  const composerMenuTriggerRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const chatFileInputRef = useRef(null);
  const chatImageInputRef = useRef(null);
  const chatVideoInputRef = useRef(null);
  const chatAttachmentsRef = useRef([]);
  const streamThinkingRef = useRef({
    statuses: [],
    summary: "",
    lastReasoningSource: "",
  });
  const activeSessionIdRef = useRef(null);
  const innerMonologueRequestsRef = useRef(new Map());
  const innerMonologueRequestScopeRef = useRef({ active: false, generation: 0 });
  useLayoutEffect(() => {
    const lifecycle = {
      active: true,
      generation: innerMonologueRequestScopeRef.current.generation + 1,
    };
    innerMonologueRequestScopeRef.current = lifecycle;
    setInnerMonologuePending({});
    setInnerMonologueErrors({});
    const requests = innerMonologueRequestsRef.current;
    return () => {
      lifecycle.active = false;
      for (const operation of requests.values()) {
        operation.controller.abort();
      }
      requests.clear();
    };
  }, [privateMediaScope, activeSessionId]);
  const messagesSessionIdRef = useRef(null);
  const messageLoadTokenRef = useRef(0);
  const streamingSessionIdRef = useRef(null);
  const companionStatusRef = useRef(companionStatus);
  const ambientContextRef = useRef({});
  const deviceActivitySummaryRef = useRef(null);
  const deviceActivityRefreshRunRef = useRef(null);
  const screenGlanceConsumeRunRef = useRef(null);
  const pendingScreenGlanceTurnRef = useRef(null);
  const sendMessageRef = useRef(null);
  const environmentContextRef = useRef({});
  const turnContextRef = useRef("");
  const companionInteractionStatsRef = useRef(companionInteractionStats);
  const runtimeStateHydratedRef = useRef(false);
  const companionInteractionHandlerRef = useRef(null);
  const companionInteractionQueueRef = useRef([]);
  const companionInteractionTimerRef = useRef(null);
  const companionInteractionInFlightRef = useRef(false);
  const companionReplyTimesRef = useRef([]);
  const isSendingRef = useRef(false);
  const voiceStateRef = useRef(VOICE_STATES.idle);
  const voicePointerHeldRef = useRef(false);
  const voicePointerIdRef = useRef(null);
  const voiceTapToSendRef = useRef(false);
  const voiceLongPressArmedRef = useRef(false);
  const voiceLongPressTimerRef = useRef(null);
  const voiceCaptureRunRef = useRef(0);
  const voicePermissionReadyRef = useRef(false);
  const voiceStreamRef = useRef(null);
  const voiceRecorderRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceStartedAtRef = useRef(0);
  const voiceElapsedTimerRef = useRef(null);
  const voiceMaxTimerRef = useRef(null);
  const voiceRequestRef = useRef(null);
  const chatRequestRef = useRef(null);
  const pendingChatClientMessageRef = useRef(null);
  const createSessionPendingRef = useRef(false);
  const pendingMomentLikesRef = useRef({});
  const pendingMomentCommentsRef = useRef({});
  const momentPostPendingRef = useRef(null);
  const momentsLoadTokenRef = useRef(0);
  const draftSettingsRef = useRef(draftSettings);
  const hasLoadedSettingsRef = useRef(false);
  const confirmedSettingsRef = useRef(settings);
  const latestDraftFingerprintRef = useRef("");
  const lastSavedSettingsFingerprintRef = useRef("");
  const settingsAutosaveTimerRef = useRef(null);
  const pendingSettingsSaveRef = useRef(null);
  const settingsSaveInFlightRef = useRef(false);
  const settingsSaveRunRef = useRef(null);
  const settingsSaveRetryTimerRef = useRef(null);
  const settingsSaveRetryCountRef = useRef(0);
  const settingsSaveFailureRef = useRef(false);
  const settingsWriteRevisionRef = useRef(0);
  const settingsScopeControllerRef = useRef(null);
  const chatSkinPreferencesRef = useRef(chatSkinPreferences);
  const chatSkinSaveTimerRef = useRef(null);
  const chatSkinSaveRunRef = useRef(Promise.resolve());
  const chatSkinEditRevisionRef = useRef(0);
  const composerHintSessionRef = useRef(null);
  const composerHintLoadTokenRef = useRef(0);
  const settingsLifecycleFlushPendingRef = useRef(false);
  const flushLatestSettingsDraftRef = useRef(() => Promise.resolve(true));
  const componentMountedRef = useRef(true);
  const musicPlaybackSyncRef = useRef(null);
  if (!musicPlaybackSyncRef.current) musicPlaybackSyncRef.current = createMusicPlaybackSync({
    getIdentity: () => coWatchIdentityRef.current,
    getSession: () => coWatchSessionRef.current,
    capture: () => coWatchLifecycleRef.current.capture(),
    current: (stamp) => coWatchLifecycleRef.current.current(stamp),
    patchPlayback: patchCoWatchPlayback,
    readSession: readActiveCoWatchSession,
    onApplied: (next) => { coWatchSessionRef.current = next; setCoWatchSession(next); },
    onError: (error) => setScreenGlanceFeedback({ status: "error", message: `${error?.message || "播放状态同步失败，播放器仍可在本机使用。"}（${error?.code || "music_playback_sync_failed"}）` }),
  });
  const nowPlayingSyncRef = useRef(null);
  if (!nowPlayingSyncRef.current) nowPlayingSyncRef.current = createNowPlayingSync({
    getIdentity: () => coWatchIdentityRef.current,
    getSession: () => coWatchSessionRef.current,
    capture: () => coWatchLifecycleRef.current.capture(),
    current: (stamp) => coWatchLifecycleRef.current.current(stamp),
    readPlaylist: getMusicPlaylist,
    submit: (snapshot) => musicPlaybackSyncRef.current.submit(snapshot),
    onUnmatched: () => setScreenGlanceFeedback({ status: "idle", message: "当前歌单没有唯一匹配的曲目，请在一起听中选择已导入的歌曲。（music_now_playing_unmatched）" }),
  });
  const startupReconnectRef = useRef(null);
  const sessionModelSaveQueueRef = useRef(Promise.resolve());
  const speechRunRef = useRef(0);
  const voiceLifecycleRef = useRef({ cancel() {}, stopPlayback() {} });
  const voiceOutputStatusRef = useRef(null);
  const sendPointerDownHandledRef = useRef(false);

  const activeSession = sessions.find(
    (session) => session.id === activeSessionId,
  );
  const isVoiceInputBusy = voiceBlocksComposer(voiceState);
  const voiceServiceAvailable = voiceService.available;
  const voiceAutoSpeakEnabled =
    voicePlaybackMode === VOICE_PLAYBACK_MODES.expressive &&
    voiceService.expressiveAvailable;
  const activeChatModel = selectedChatModel || settings.model;
  const chatRetryReady = canRetryChatClientMessage(
    pendingChatClientMessageRef.current,
    {
      sessionId: activeSessionId,
      message: message.trim(),
      turnContext: turnContext.trim(),
      messageReference,
      attachments: chatAttachments,
      attachmentInstructionMode: attachmentSafetyEnabled
        ? "untrusted"
        : "system",
    },
  );
  const chatRetryIsProcessing =
    chatRetryReady &&
    pendingChatClientMessageRef.current?.generationInProgress === true;

  const loadAmbientWeather = useCallback(async ({ latitude, longitude }) => {
    const data = await apiRequest("/api/weather/current", {
      method: "POST",
      body: JSON.stringify({ latitude, longitude }),
      timeoutMs: BACKEND_WAKE_TIMEOUT_MS,
    });
    return data?.weather || data;
  }, []);

  const handleAmbientContextChange = useCallback((context) => {
    ambientContextRef.current =
      context && typeof context === "object" ? context : {};
    setAmbientWeather(ambientContextRef.current.weather || null);
    environmentContextRef.current = mergeDeviceActivityContext(
      ambientContextRef.current,
      deviceActivitySummaryRef.current,
    );
  }, []);

  const refreshDeviceActivityContext = useCallback(
    async ({ force = false, silent = false } = {}) => {
      if (!deviceActivityPluginAvailable()) {
        const unavailable = normalizeDeviceActivityState({});
        setDeviceActivityState(unavailable);
        deviceActivitySummaryRef.current = null;
        environmentContextRef.current = mergeDeviceActivityContext(
          ambientContextRef.current,
          null,
        );
        if (!silent) {
          setDeviceActivityFeedback({
            status: "idle",
            message: "活动感知只在安装到 Android 手机后的 App 内可用。",
          });
        }
        return null;
      }

      if (deviceActivityRefreshRunRef.current) {
        return deviceActivityRefreshRunRef.current;
      }

      const run = (async () => {
        try {
          const state = await readDeviceActivityState();
          setDeviceActivityState(state);
          if (!state.enabled || !state.permissionGranted) {
            deviceActivitySummaryRef.current = null;
            environmentContextRef.current = mergeDeviceActivityContext(
              ambientContextRef.current,
              null,
            );
            if (!silent) {
              setDeviceActivityFeedback({
                status: state.enabled ? "checking" : "idle",
                message: state.enabled
                  ? "开关已打开，还需要在系统页授予使用情况访问权限。"
                  : "默认关闭。开启后只提供最近使用过的 App 名称和粗略时长。",
              });
            }
            return null;
          }

          const previous = deviceActivitySummaryRef.current;
          const previousTime = Date.parse(previous?.capturedAt);
          if (
            !force &&
            Number.isFinite(previousTime) &&
            Date.now() - previousTime < DEVICE_ACTIVITY_REFRESH_MS
          ) {
            return previous;
          }

          const summary = normalizeDeviceActivitySummary(
            await DeviceActivity.getRecentSummary({
              windowMinutes: DEVICE_ACTIVITY_WINDOW_MINUTES,
            }),
          );
          deviceActivitySummaryRef.current = summary;
          environmentContextRef.current = mergeDeviceActivityContext(
            ambientContextRef.current,
            summary,
          );
          const currentApp = await readCurrentApp();
          environmentContextRef.current = mergeCurrentAppContext(
            environmentContextRef.current,
            currentApp,
          );
          if (!silent) {
            setDeviceActivityFeedback({
              status: "success",
              message: summary
                ? `摘要已更新：仅包含 ${summary.apps.length} 个 App 名称和粗略使用时长。`
                : "最近没有可用的活动摘要；不会上传空记录。",
            });
          }
          return summary;
        } catch (error) {
          deviceActivitySummaryRef.current = null;
          environmentContextRef.current = mergeDeviceActivityContext(
            ambientContextRef.current,
            null,
          );
          if (!silent) {
            setDeviceActivityFeedback({
              status: "error",
              message:
                error?.message || "暂时无法读取活动摘要，请检查系统授权。",
            });
          }
          return null;
        }
      })();

      deviceActivityRefreshRunRef.current = run.finally(() => {
        deviceActivityRefreshRunRef.current = null;
      });
      return deviceActivityRefreshRunRef.current;
    },
    [],
  );

  const applyScreenGlanceState = useCallback((value) => {
    const next = normalizeScreenGlanceState(value);
    setScreenGlanceState(next);
    setScreenGlanceConfig(
      normalizeScreenGlanceConfig({
        randomEnabled: next.randomEnabled,
        minimumMinutes: next.minimumMinutes,
        maximumMinutes: next.maximumMinutes,
        wifiOnly: next.wifiOnly,
        chargingOnly: next.chargingOnly,
        watchTogetherEnabled: next.watchTogetherEnabled,
        watchIntervalSeconds: next.watchIntervalSeconds,
        coWatchSessionId: next.coWatchSessionId,
      }),
    );
    return next;
  }, []);

  const refreshScreenGlanceState = useCallback(async () => {
    const stamp = screenGlanceLifecycleRef.current.capture();
    if (!screenGlancePluginAvailable()) {
      return applyScreenGlanceState({});
    }
    try {
      const state = await readScreenGlanceState();
      if (!screenGlanceLifecycleRef.current.current(stamp)) return null;
      return applyScreenGlanceState(state);
    } catch (error) {
      if (!screenGlanceLifecycleRef.current.current(stamp)) return null;
      setScreenGlanceFeedback({
        status: "error",
        message: error?.message || "暂时无法读取屏幕共看状态。",
      });
      return null;
    }
  }, [applyScreenGlanceState]);

  // DLNA 投屏接收：开关 + 状态刷新（仅原生平台可用）。
  const refreshDlnaState = useCallback(async () => {
    if (!dlnaPluginAvailable()) {
      setDlnaState(normalizeDlnaState({}));
      return null;
    }
    try {
      const next = await readDlnaState();
      setDlnaState(next);
      return next;
    } catch {
      setDlnaState(normalizeDlnaState({ supported: true, discoveryStatus: "error", errorCode: "dlna_state_unavailable" }));
      return null;
    }
  }, []);

  const toggleDlnaReceiver = useCallback(async () => {
    if (dlnaBusy) return;
    setDlnaBusy(true);
    try {
      if (dlnaState.active || dlnaState.discoveryStatus === "starting") {
        await stopDlnaReceiver();
      } else {
        await startDlnaReceiver();
      }
      await refreshDlnaState();
    } catch {
      setDlnaState(normalizeDlnaState({ supported: true, discoveryStatus: "error", errorCode: "dlna_state_unavailable" }));
    } finally {
      setDlnaBusy(false);
    }
  }, [dlnaBusy, dlnaState.active, dlnaState.discoveryStatus, refreshDlnaState]);

  // 一起看模式 -> 会话模式：听歌只认 listening，一起看只认各自视频模式，
  // 避免把残留的听歌会话标题（如 Fever Pitch）显示在视频播放器下方。
  const resolveCoWatchSessionMode = (entryMode) => {
    if (entryMode === "music") return "listening";
    if (entryMode === "web") return "web_page";
    if (entryMode === "direct") return "direct_media";
    return "screen";
  };

  const refreshCoWatchExperience = useCallback(
    async ({ silent = false, mode = "", poll = false } = {}) => {
      const lifecycle = coWatchLifecycleRef.current;
      const stamp = lifecycle.capture();
      const identity = coWatchIdentityRef.current;
      if (poll && coWatchViewScopeRef.current.current(coWatchPollStampRef.current)) return { session: coWatchSessionRef.current, state: null };
      const viewStamp = coWatchViewScopeRef.current.capture({
        mode,
        fallbackMode: resolveCoWatchSessionMode(togetherEntryMode),
        channel: poll ? "poll" : "manual",
      });
      if (poll) coWatchPollStampRef.current = viewStamp;
      try {
        const sessionMode = viewStamp.sessionMode;
        const [sessionResult, previewResult, stateResult] = await Promise.allSettled([
          readActiveCoWatchSession({ sessionMode }, identity),
          readCoWatchPreview(identity),
          refreshScreenGlanceState(),
        ]);
        if (!lifecycle.current(stamp) || !coWatchViewScopeRef.current.current(viewStamp) || (coWatchSessionRef.current?.id || "") !== stamp.sessionId) return { session: null, state: null };
        if (sessionResult.status === "fulfilled") {
          const next = (() => {
            const current = coWatchSessionRef.current;
            const remote = sessionResult.value;
            if (!remote) return null;
            if (
              current?.id === remote.id &&
              (current.sourceApp === DIRECT_MEDIA_SOURCE_APP ||
                current.sourceApp === WEB_PAGE_SOURCE_APP)
            ) {
              return Object.freeze({
                ...remote,
                mediaPositionSeconds: current.mediaPositionSeconds,
                mediaDurationSeconds:
                  current.mediaDurationSeconds || remote.mediaDurationSeconds,
              });
            }
            return remote;
          })();
          if (coWatchSessionRef.current?.id !== next?.id) setCoWatchDanmaku([]);
          coWatchSessionRef.current = next;
          setCoWatchSession(next);
          if (sessionResult.value) {
            const currentDialog = await readCoWatchDialog(
              sessionResult.value,
              identity,
            ).catch(() => null);
            if (!lifecycle.current(stamp) || !coWatchViewScopeRef.current.current(viewStamp) || coWatchSessionRef.current?.id !== sessionResult.value.id) return { session: null, state: null };
            if (currentDialog) {
              setCoWatchDialog(
                currentDialog.map((item) => ({ ...item, key: item.id })),
              );
            }
          }
        } else if (!silent) {
          setScreenGlanceFeedback({
            status: "error",
            message: sessionResult.reason?.message || "暂时无法读取共看会话。",
          });
        }
        if (previewResult.status === "fulfilled") {
          setCoWatchPreview(previewResult.value);
        }
        return {
          session:
            sessionResult.status === "fulfilled" ? sessionResult.value : null,
          state: stateResult.status === "fulfilled" ? stateResult.value : null,
        };
      } finally {
        if (coWatchPollStampRef.current === viewStamp) coWatchPollStampRef.current = null;
      }
    },
    [refreshScreenGlanceState, togetherEntryMode],
  );

  const flushPendingScreenGlanceTurn = useCallback(() => {
    const pending = pendingScreenGlanceTurnRef.current;
    if (pending && !screenGlanceLifecycleRef.current.current(pending.stamp)) {
      releasePendingScreenGlanceTurn(pendingScreenGlanceTurnRef);
      return false;
    }
    if (
      !pending ||
      !hasLoadedSettingsRef.current ||
      !navigator.onLine ||
      isSendingRef.current ||
      companionInteractionInFlightRef.current ||
      voiceInputBusy(voiceStateRef.current) ||
      typeof sendMessageRef.current !== "function"
    ) {
      return false;
    }

    if (!canLeaveWorkspace("chat")) return false;
    pendingScreenGlanceTurnRef.current = null;
    setActiveView("chat");
    setIsSettingsOpen(false);
    setScreenGlanceFeedback({
      status: "checking",
      message: `画面已在本机清除，正在让${effectiveAiName}按此刻心情回应。`,
    });
    void sendMessageRef
      .current({
        text: pending.turn.displayText,
        turnContext: pending.turn.turnContext,
        attachments: [pending.attachment],
        attachmentInstructionMode: "untrusted",
        attachmentStorageMode: "ephemeral",
        preserveComposer: true,
      })
      .finally(() => {
        if (!componentMountedRef.current || !screenGlanceLifecycleRef.current.current(pending.stamp)) return;
        setScreenGlanceFeedback({
          status: "success",
          message: `这次画面已交给${effectiveAiName}；原始截图没有保存在作品库或长期记忆中。`,
        });
        void refreshScreenGlanceState();
      });
    return true;
  }, [effectiveAiName, refreshScreenGlanceState, canLeaveWorkspace]);

  const consumeLatestScreenGlance = useCallback(async () => {
    if (!screenGlancePluginAvailable()) return null;
    if (screenGlanceConsumeRunRef.current) {
      return screenGlanceConsumeRunRef.current;
    }

    const stamp = screenGlanceLifecycleRef.current.capture();
    const isCurrent = () => componentMountedRef.current && screenGlanceLifecycleRef.current.current(stamp);
    let preparedDraft = null;
    const run = (async () => {
      try {
        const capture = await ScreenGlance.consumeLatestCapture();
        if (!isCurrent()) return null;
        if (capture?.available === true && !screenCaptureMatchesIdentity(capture, coWatchIdentityRef.current)) return null;
        if (capture?.available !== true) {
          await refreshScreenGlanceState();
          return null;
        }
        const file = screenGlanceCaptureToFile(capture);
        const checked = validateAttachmentFiles([], [file]);
        if (checked.accepted.length !== 1) {
          throw new Error(checked.rejected[0] || "这次屏幕画面无法作为图片附件发送。");
        }
        const prepared = await prepareChatAttachmentFile(checked.accepted[0]);
        if (!isCurrent()) return null;
        const attachment = createAttachmentDraft(prepared.file);
        preparedDraft = attachment;
        releasePendingScreenGlanceTurn(pendingScreenGlanceTurnRef);
        pendingScreenGlanceTurnRef.current = {
          attachment, stamp,
          turn: buildScreenGlanceTurn(capture),
        };
        const nativeState = await ScreenGlance.getState();
        if (!isCurrent()) {
          if (pendingScreenGlanceTurnRef.current?.attachment === attachment) releasePendingScreenGlanceTurn(pendingScreenGlanceTurnRef);
          return null;
        }
        applyScreenGlanceState({
          ...nativeState,
          pendingCapture: false,
        });
        if (prepared.warning) {
          setScreenGlanceFeedback({
            status: "checking",
            message: prepared.warning,
          });
        }
        flushPendingScreenGlanceTurn();
        return capture;
      } catch (error) {
        if (pendingScreenGlanceTurnRef.current?.attachment === preparedDraft) releasePendingScreenGlanceTurn(pendingScreenGlanceTurnRef);
        if (!isCurrent()) return null;
        setScreenGlanceFeedback({
          status: "error",
          message: error?.message || "刚才的屏幕画面读取失败，原图已经清除。",
        });
        return null;
      }
    })();

    screenGlanceConsumeRunRef.current = run.finally(() => {
      screenGlanceConsumeRunRef.current = null;
    });
    return screenGlanceConsumeRunRef.current;
  }, [applyScreenGlanceState, flushPendingScreenGlanceTurn, refreshScreenGlanceState]);

  const handleImagePreview = useCallback((url, alt) => {
    setImageViewer({ url, alt });
  }, []);

  const handleCompanionInteraction = useCallback(
    (zoneId) => companionInteractionHandlerRef.current?.(zoneId),
    [],
  );

  const requestStatusPanelClose = useCallback(() => {
    setIsStatusPanelExpanded(false);
    setStatusPanelCloseRequest((current) => current + 1);
  }, []);

  const handleStatusPanelExpandedChange = useCallback((expanded) => {
    const next = transitionComposerOverlays(
      {
        statusExpanded: expanded,
        composerMenuOpen: false,
      },
      expanded ? "open-status" : "close-status",
    );
    setIsStatusPanelExpanded(next.statusExpanded);
    if (next.statusExpanded) setIsComposerMenuOpen(next.composerMenuOpen);
  }, []);

  const closeComposerMenu = useCallback((restoreFocus = false) => {
    setIsComposerMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => composerMenuTriggerRef.current?.focus());
    }
  }, []);

  const toggleComposerMenu = useCallback(() => {
    setIsComposerMenuOpen((current) => {
      const action = current ? "close-composer-menu" : "open-composer-menu";
      const next = transitionComposerOverlays(
        {
          statusExpanded: isStatusPanelExpanded,
          composerMenuOpen: current,
        },
        action,
      );
      if (!current && !next.statusExpanded) {
        setStatusPanelCloseRequest((request) => request + 1);
        setIsStatusPanelExpanded(false);
      }
      return next.composerMenuOpen;
    });
  }, [isStatusPanelExpanded]);

  function queueChatSkinPreferences(next) {
    const controller = settingsScopeControllerRef.current;
    if (!componentMountedRef.current || !controller || controller.signal.aborted) return;
    const scopedSession = createScopedSettingsSession(authSession, privateMediaScope, controller.signal);
    window.clearTimeout(chatSkinSaveTimerRef.current);
    chatSkinSaveTimerRef.current = window.setTimeout(() => {
      chatSkinSaveTimerRef.current = null;
      if (!componentMountedRef.current || controller.signal.aborted) return;
      const payload = chatSkinPreferencesApiPayload(next);
      chatSkinSaveRunRef.current = chatSkinSaveRunRef.current
        .catch(() => {})
        .then(() => {
          if (!componentMountedRef.current || controller.signal.aborted) return;
          return apiRequest("/api/v2/chat-skin/preferences", {
            method: "PUT",
            body: JSON.stringify(payload),
            signal: controller.signal,
            authSession: scopedSession,
          });
        })
        .catch(() => {});
    }, 260);
  }

  function updateChatSkinPreferences(patch) {
    if (!componentMountedRef.current) return;
    chatSkinEditRevisionRef.current += 1;
    setChatSkinPreferences((current) => {
      const next = normalizeChatSkinPreferences({
        ...current,
        ...(typeof patch === "function" ? patch(current) : patch),
      });
      chatSkinPreferencesRef.current = next;
      writeStoredChatSkinPreferences(
        next,
        globalThis.localStorage,
        accountStorageScope,
      );
      queueChatSkinPreferences(next);
      return next;
    });
  }

  const loadChatSkinPreferences = useCallback(async () => {
    const controller = settingsScopeControllerRef.current;
    if (!componentMountedRef.current || !controller || controller.signal.aborted) return;
    const editRevision = chatSkinEditRevisionRef.current;
    try {
      const data = await apiRequest(
        "/api/v2/chat-skin/preferences",
        {
          ...STARTUP_REQUEST_OPTIONS,
          signal: controller.signal,
          authSession: createScopedSettingsSession(authSession, privateMediaScope, controller.signal),
        },
      );
      if (!componentMountedRef.current || controller.signal.aborted || editRevision !== chatSkinEditRevisionRef.current) return;
      const next = normalizeChatSkinPreferences(data.preferences);
      chatSkinPreferencesRef.current = next;
      writeStoredChatSkinPreferences(
        next,
        globalThis.localStorage,
        accountStorageScope,
      );
      if (componentMountedRef.current) setChatSkinPreferences(next);
    } catch {
      // Local skin preferences remain available during a backend reconnect.
    }
  }, [accountStorageScope, privateMediaScope]);

  const loadComposerHint = useCallback(async (sessionId) => {
    const token = ++composerHintLoadTokenRef.current;
    composerHintSessionRef.current = sessionId || null;
    if (!sessionId) {
      setComposerHint("");
      return;
    }
    try {
      const data = await apiRequest(
        `/api/v2/chat-skin/conversations/${encodeURIComponent(sessionId)}/hint`,
      );
      if (
        token === composerHintLoadTokenRef.current &&
        composerHintSessionRef.current === sessionId
      ) {
        setComposerHint(data.hint?.hint || "");
      }
    } catch {
      if (token === composerHintLoadTokenRef.current) setComposerHint("");
    }
  }, []);

  const refreshComposerHint = useCallback(async (sessionId) => {
    if (
      !sessionId ||
      chatSkinPreferencesRef.current.dynamicComposerHint !== true
    ) {
      return;
    }
    try {
      const data = await apiRequest(
        `/api/v2/chat-skin/conversations/${encodeURIComponent(
          sessionId,
        )}/hint/refresh`,
        {
          method: "POST",
          body: JSON.stringify({
            mood_summary: companionStatusRef.current.mood || "",
          }),
        },
      );
      if (
        data?.updated === true &&
        activeSessionIdRef.current === sessionId &&
        composerHintSessionRef.current === sessionId
      ) {
        setComposerHint(data.hint?.hint || "");
      }
    } catch {
      // Hint generation is optional and must never affect message delivery.
    }
  }, []);

  useEffect(() => {
    if (!isComposerMenuOpen) return undefined;

    function closeComposerMenuFromEscape(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeComposerMenu(true);
    }

    document.addEventListener("keydown", closeComposerMenuFromEscape);
    return () =>
      document.removeEventListener("keydown", closeComposerMenuFromEscape);
  }, [closeComposerMenu, isComposerMenuOpen]);

  const applyVoiceOutputStatus = useCallback((config) => {
    voiceOutputStatusRef.current = config;
    setVoiceOutputStatus(config);
    setVoiceService((current) => ({
      ...current,
      ...voiceOutputServiceState(config, current),
    }));
  }, []);

  const refreshVoiceOutputStatus = useCallback(async () => {
    const controller = settingsScopeControllerRef.current;
    if (!componentMountedRef.current || !controller || controller.signal.aborted) return;
    try {
      const config = await getVoiceOutput({
        signal: controller.signal,
        authSession: createScopedSettingsSession(authSession, privateMediaScope, controller.signal),
      });
      if (!componentMountedRef.current || controller.signal.aborted) return;
      applyVoiceOutputStatus(config);
    } catch {
      // The regular health request remains the fallback. This account-scoped
      // request must never delay or block the main startup path.
    }
  }, [applyVoiceOutputStatus, privateMediaScope]);

  const refreshServiceHealth = useCallback(async () => {
    const controller = settingsScopeControllerRef.current;
    if (!componentMountedRef.current || !controller || controller.signal.aborted) return;
    const requestOptions = {
      signal: controller.signal,
      authSession: createScopedSettingsSession(authSession, privateMediaScope, controller.signal),
    };
    setServiceHealth((current) => ({
      ...current,
      checking: true,
      error: "",
    }));

    try {
      const data = await apiRequest("/health", requestOptions);
      if (!componentMountedRef.current || controller.signal.aborted) return;
      const available = data?.features?.hervoice_proxy_configured === true;
      const expressiveAvailable =
        data?.features?.expressive_tts_configured === true;
      const expressiveApiKeyConfigured =
        typeof data?.features?.expressive_tts_api_key_configured === "boolean"
          ? data.features.expressive_tts_api_key_configured
          : null;
      const expressiveVoiceConfigured =
        typeof data?.features?.expressive_tts_voice_configured === "boolean"
          ? data.features.expressive_tts_voice_configured
          : null;
      const baseVoiceService = {
        checked: true,
        available,
        message: available
          ? "语音理解服务已连接。"
          : "服务器尚未配置语音理解服务。麦克风和音频附件暂不可用；图片与文档仍可正常发送。",
        expressiveEnabled: true,
        expressiveAvailable,
        expressiveChineseFallbackAvailable: expressiveAvailable,
        expressiveApiKeyConfigured,
        expressiveVoiceConfigured,
        expressiveProvider:
          data?.features?.expressive_tts_provider || "none",
      };
      setVoiceService({
        ...baseVoiceService,
        ...(voiceOutputStatusRef.current
          ? voiceOutputServiceState(
              voiceOutputStatusRef.current,
              baseVoiceService,
            )
          : {}),
      });
      if (available) {
        void apiRequest("/voice/warmup", {
          ...requestOptions,
          method: "POST",
          timeoutMs: 5_000,
          retry: false,
        }).catch(() => {
          // Prewarming is optional; voice upload still reports its own error.
        });
      }
      setServiceHealth({
        checking: false,
        data,
        error: "",
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (!componentMountedRef.current || controller.signal.aborted) return;
      setVoiceService({
        checked: true,
        available: false,
        message:
          "暂时无法确认服务器语音能力。为避免录音后发送失败，麦克风和音频附件已停用；图片与文档不受影响。",
        expressiveEnabled: true,
        expressiveAvailable: false,
        expressiveChineseFallbackAvailable: false,
        expressiveApiKeyConfigured: null,
        expressiveVoiceConfigured: null,
        expressiveProvider: "none",
      });
      setServiceHealth((current) => ({
        ...current,
        checking: false,
        error: error?.message || "服务器状态检查失败",
        checkedAt: new Date().toISOString(),
      }));
    }
  }, [privateMediaScope]);

  useEffect(() => {
    let cancelled = false;

    const startupController = new AbortController();
    const startupRequestOptions = {
      ...STARTUP_REQUEST_OPTIONS,
      signal: startupController.signal,
      authSession: createScopedSettingsSession(authSession, privateMediaScope, startupController.signal),
    };

    voiceOutputStatusRef.current = null;
    setVoiceOutputStatus(null);

    if (visualPreview) {
      const previewSettings = {
        ...emptySettings,
        ai_name: "小灯",
      };
      confirmedSettingsRef.current = previewSettings;
      draftSettingsRef.current = previewSettings;
      hasLoadedSettingsRef.current = true;
      setSettings(previewSettings);
      setDraftSettings(previewSettings);
      setHasLoadedSettings(true);
      setIsLoading(false);
      setStartupConnection({
        status: "connected",
        failureCount: 0,
        nextRetryDelayMs: null,
        lastError: null,
      });
      return () => {
        cancelled = true;
        startupController.abort();
      };
    }

    function applyInitialModelCatalog(data, fallbackModel = "") {
      if (cancelled) return;
      const catalog = reconcileModelCatalog(data, {
        previous: readStoredSessionChatModel(activeSessionIdRef.current),
        fallback: fallbackModel,
      });
      setAvailableModels(catalog.models);
      setSelectedChatModel(
        chooseChatModel({
          models: catalog.models,
          stored: readStoredSessionChatModel(activeSessionIdRef.current),
          current: fallbackModel,
          fallback: catalog.currentModel,
        }),
      );
    }

    async function loadInitialModels(fallbackModel = "") {
      const pendingSelection = chooseChatModel({
        models: [],
        stored: readStoredSessionChatModel(activeSessionIdRef.current),
        current: fallbackModel,
      });
      if (!cancelled) setSelectedChatModel(pendingSelection);
      try {
        const data = await apiRequest("/models", startupRequestOptions);
        applyInitialModelCatalog(data, fallbackModel);
        if (!cancelled) setModelsLoadMessage("");
      } catch {
        if (!cancelled) {
          setModelsLoadMessage(
            fallbackModel
              ? "模型列表暂时无法读取，仍会使用当前已保存的模型。"
              : "模型列表暂时无法读取，将由服务器选择默认模型。",
          );
        }
      }
    }

    async function loadInitialData() {
      const settingsRevisionAtRead = settingsWriteRevisionRef.current;
      const bootstrapData = await apiRequest(
        "/api/v2/bootstrap",
        startupRequestOptions,
      );
      const settingsData = { settings: bootstrapData.settings };
      const sessionsData = { sessions: bootstrapData.sessions };
      const runtimeData = { state: bootstrapData.state };

      if (cancelled) return null;
      const acceptReadSettings = settingsRevisionAtRead === settingsWriteRevisionRef.current &&
        !settingsSaveInFlightRef.current && !pendingSettingsSaveRef.current && !settingsSaveFailureRef.current;
      const nextSettings = acceptReadSettings ? normalizeSettingsDraft(settingsData.settings) : confirmedSettingsRef.current;
      const localPersonaResetApplied = applyPersonaResetToLocalStorage(
        nextSettings.context_reset_at,
        globalThis.localStorage,
        accountStorageScope,
      );
      const nextSessions = sessionsData.sessions || [];
      const serverRuntimeState = runtimeData?.state || {};
      const legacyOwnerStatus =
        nextSettings.account_role === "owner" && !serverRuntimeState.status
          ? readCompanionStatus()
          : null;
      const legacyOwnerInteractionStats =
        nextSettings.account_role === "owner" &&
        !serverRuntimeState.interaction_stats
          ? readCompanionInteractionStats()
          : null;
      const nextCompanionStatus = normalizeCompanionStatus(
        serverRuntimeState.status ||
          legacyOwnerStatus ||
          readCompanionStatus(accountStorageScope),
      );
      const nextCompanionInteractionStats =
        normalizeCompanionInteractionStats(
          serverRuntimeState.interaction_stats ||
            legacyOwnerInteractionStats ||
            readCompanionInteractionStats(accountStorageScope),
        );
      const settingsFingerprint = settingsPayloadFingerprint(nextSettings);
      const hadLoadedSettings = hasLoadedSettingsRef.current;
      const hasUnsavedSettingsDraft =
        hadLoadedSettings &&
        latestDraftFingerprintRef.current !==
          lastSavedSettingsFingerprintRef.current;
      const recovered = mergeRecoveredStartupData(
        { activeSessionId: activeSessionIdRef.current },
        { settings: nextSettings, sessions: nextSessions },
      );

      if (localPersonaResetApplied) {
        const resetStatus = createResetCompanionStatus();
        const resetInteractionStats = createDefaultCompanionInteractionStats();
        setMessages([]);
        setSessionDraft(activeSessionIdRef.current, "");
        setMessageReference(null);
        setTurnContext("");
        setMemories([]);
        setMoments([]);
        setLastPromptReceipt(null);
        setCompanionStatus(resetStatus);
        setCompanionInteractionStats(resetInteractionStats);
        setInnerMonologues({});
        setInnerMonologuePending({});
        setInnerMonologueErrors({});
        companionStatusRef.current = resetStatus;
        messagesSessionIdRef.current = null;
      } else {
        setCompanionStatus(nextCompanionStatus);
        setCompanionInteractionStats(nextCompanionInteractionStats);
        companionStatusRef.current = nextCompanionStatus;
        companionInteractionStatsRef.current =
          nextCompanionInteractionStats;
      }
      runtimeStateHydratedRef.current = true;

      if (acceptReadSettings) {
        confirmedSettingsRef.current = nextSettings;
        if (!hasUnsavedSettingsDraft) {
          draftSettingsRef.current = nextSettings;
          latestDraftFingerprintRef.current = settingsFingerprint;
          setDraftSettings(nextSettings);
        }
        lastSavedSettingsFingerprintRef.current = settingsFingerprint;
        setSettings(nextSettings);
        setSettingsAutosaveState(hasUnsavedSettingsDraft ? "pending" : "saved");
      }
      setHasLoadedSettings(true);
      setSessions(recovered.sessions);
      activeSessionIdRef.current = recovered.activeSessionId;
      const serverSessionModel = readServerSessionChatModel(
        recovered.sessions,
        recovered.activeSessionId,
      );
      if (serverSessionModel) {
        storeSessionChatModel(recovered.activeSessionId, serverSessionModel);
      } else {
        migrateLegacyChatModelToSession(
          recovered.activeSessionId,
          globalThis.localStorage,
          accountStorageScope,
        );
      }
      setActiveSessionId(recovered.activeSessionId);
      hasLoadedSettingsRef.current = true;
      setIsLoading(false);
      void loadInitialModels(nextSettings.model);
      void refreshServiceHealth();
      void refreshVoiceOutputStatus();
      void loadChatSkinPreferences();
      return { settings: nextSettings, sessions: nextSessions };
    }

    const reconnectController = createStartupReconnectController({
      attempt: loadInitialData,
      onStateChange(nextState) {
        if (cancelled) return;
        setStartupConnection(nextState);
        if (nextState.status === "waiting") setIsLoading(false);
      },
    });
    startupReconnectRef.current = reconnectController;
    void reconnectController.start();
    return () => {
      cancelled = true;
      startupController.abort();
      reconnectController.stop();
      if (startupReconnectRef.current === reconnectController) {
        startupReconnectRef.current = null;
      }
    };
  }, [
    accountStorageScope,
    privateMediaScope,
    loadChatSkinPreferences,
    refreshServiceHealth,
    refreshVoiceOutputStatus,
    setSessionDraft,
    visualPreview,
  ]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    setMessageReference(null);
    void loadComposerHint(activeSessionId);
  }, [activeSessionId, loadComposerHint]);

  useEffect(() => {
    if (!hasLoadedSettingsRef.current) return;
    const serverModel = readServerSessionChatModel(sessions, activeSessionId);
    if (serverModel) {
      storeSessionChatModel(activeSessionId, serverModel);
    }
    const stored =
      serverModel || readStoredSessionChatModel(activeSessionId);
    setSelectedChatModel(
      chooseChatModel({
        models: availableModels,
        stored,
        current: settings.model,
        fallback: availableModels[0]?.id || "",
      }),
    );
  }, [activeSessionId, availableModels, sessions, settings.model]);

  useEffect(() => {
    chatAttachmentsRef.current = chatAttachments;
  }, [chatAttachments]);

  useLayoutEffect(() => {
    componentMountedRef.current = true;
    const controller = new AbortController();
    settingsScopeControllerRef.current = controller;
    const unregisterSettingsGuard = registerSettingsSaveGuard(privateMediaScope, async () => {
      const saved = await flushLatestSettingsDraftRef.current?.();
      if (saved === true && !canLeaveWorkspace("account-exit")) throw new Error("退出已取消，工作区草稿和当前页面仍保留。可先保存或下载草稿，再退出账号。");
      return saved;
    }, busy => {
      settingsExitBusyRef.current = busy;
      if (componentMountedRef.current) setSettingsExitBusy(busy);
    });
    return () => {
      componentMountedRef.current = false;
      hasLoadedSettingsRef.current = false;
      controller.abort();
      unregisterSettingsGuard();
      pendingSettingsSaveRef.current = null;
      window.clearTimeout(chatSkinSaveTimerRef.current);
      chatSkinSaveTimerRef.current = null;
      window.clearTimeout(settingsSaveRetryTimerRef.current);
      abortChatRequest(chatRequestRef, "component-unmount");
      releaseChatRequestAttachments(chatRequestRef.current);
      chatRequestRef.current = null;
      releasePendingScreenGlanceTurn(pendingScreenGlanceTurnRef);
      chatAttachmentsRef.current.forEach((item) =>
        revokeAttachmentDraft(item),
      );
      chatAttachmentsRef.current = [];
      window.clearTimeout(settingsAutosaveTimerRef.current);
      window.clearTimeout(settingsScrollIdleTimerRef.current);
    };
  }, [privateMediaScope, canLeaveWorkspace]);

  useEffect(() => {
    if (!deviceActivityPluginAvailable()) {
      void refreshDeviceActivityContext();
      return undefined;
    }

    void refreshDeviceActivityContext({ force: true });
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshDeviceActivityContext({ force: true });
      }
    };
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshDeviceActivityContext({ silent: true });
      }
    }, DEVICE_ACTIVITY_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshDeviceActivityContext]);

  useEffect(() => {
    if (!deviceSignalsPluginAvailable()) return undefined;

    const consumeInjects = async () => {
      const injects = await readPendingDeviceInjects();
      if (!injects.length) return;
      const lines = injects
        .map((inject) => `【设备事件·${inject.tag}】${inject.text}`)
        .join("\n");
      environmentContextRef.current = {
        ...environmentContextRef.current,
        pending_device_injects: lines,
      };
      await ackDeviceInjects(injects.map((inject) => inject.id));
    };

    const tick = async (trigger) => {
      const signals = await readDeviceSignals();
      environmentContextRef.current = mergeDeviceSignalsContext(
        environmentContextRef.current,
        signals,
      );
      const powerEvent = signals.powerEvent;
      const payload = {
        battery_pct: signals.batteryPct,
        charging: signals.charging,
        low_power: false,
        app_state: signals.appState,
        trigger,
        emulator: signals.emulator,
      };
      await reportDeviceState(payload);
      if (powerEvent) {
        await reportDeviceState({ ...payload, trigger: "charging" });
      }
    };

    void consumeInjects();
    void tick("launch");
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void tick("probe");
    }, DEVICE_SIGNALS_REPORT_MS);
    const onVisibility = () => {
      void tick(document.visibilityState === "visible" ? "scene_change" : "scene_change");
      if (document.visibilityState === "visible") void consumeInjects();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    const stopWhereabouts = startWhereaboutsScheduler({
      apiRequest,
    });
    void requestWhereaboutsPermissions();
    return stopWhereabouts;
  }, []);

  useEffect(() => {
    if (!screenGlancePluginAvailable()) {
      void refreshScreenGlanceState();
      return undefined;
    }

    const refreshAndConsume = () => {
      if (document.visibilityState !== "visible") return;
      void refreshScreenGlanceState().then((state) => {
        if (state?.pendingCapture) void consumeLatestScreenGlance();
      });
    };
    refreshAndConsume();
    const timer = window.setInterval(refreshAndConsume, 10_000);
    document.addEventListener("visibilitychange", refreshAndConsume);
    window.addEventListener("focus", refreshAndConsume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshAndConsume);
      window.removeEventListener("focus", refreshAndConsume);
    };
  }, [consumeLatestScreenGlance, refreshScreenGlanceState]);

  useEffect(() => {
    if (activeView !== "together" && activeView !== "music") return undefined;
    void refreshCoWatchExperience({ poll: true });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshCoWatchExperience({ silent: true, poll: true });
      }
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [activeView, refreshCoWatchExperience]);

  useEffect(() => {
    flushPendingScreenGlanceTurn();
  }, [
    flushPendingScreenGlanceTurn,
    hasLoadedSettings,
    isCompanionResponding,
    isOnline,
    isSending,
    voiceState,
  ]);

  useEffect(() => {
    companionStatusRef.current = companionStatus;
    saveCompanionStatus(companionStatus, accountStorageScope);
  }, [accountStorageScope, companionStatus]);

  useEffect(() => {
    companionInteractionStatsRef.current = companionInteractionStats;
    saveCompanionInteractionStats(
      companionInteractionStats,
      accountStorageScope,
    );
  }, [accountStorageScope, companionInteractionStats]);

  useEffect(() => {
    if (
      visualPreview ||
      !accountStorageScope ||
      !runtimeStateHydratedRef.current
    ) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void apiRequest("/api/v2/companion-state", {
        method: "PUT",
        body: JSON.stringify({
          status: companionStatus,
          interaction_stats: companionInteractionStats,
        }),
        retry: false,
      }).catch(() => {
        // 本机的账号隔离副本仍保留，后端恢复后会由下一次状态变化重试。
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    accountStorageScope,
    companionInteractionStats,
    companionStatus,
    visualPreview,
  ]);

  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    if (
      activeView !== "chat" &&
      [VOICE_STATES.requesting, VOICE_STATES.recording].includes(
        voiceStateRef.current,
      )
    ) {
      voiceLifecycleRef.current.cancel({
        message: "离开聊天页后，录音已取消，原始语音没有保存或发送。",
      });
    }
    if (
      activeView !== "chat" &&
      voiceStateRef.current === VOICE_STATES.speaking
    ) {
      void voiceLifecycleRef.current.stopPlayback();
    }
  }, [activeView]);

  useEffect(() => {
    function releaseVoiceWhenPageLeaves() {
      if (document.visibilityState === "hidden") {
        voiceLifecycleRef.current.cancel({ updateState: false });
        void voiceLifecycleRef.current.stopPlayback({ updateState: false });
      }
    }

    function releaseVoiceOnPageHide() {
      abortChatRequest(chatRequestRef, "pagehide");
      voiceLifecycleRef.current.cancel({ updateState: false });
      voiceRequestRef.current?.abort();
      voiceRequestRef.current = null;
      void voiceLifecycleRef.current.stopPlayback({ updateState: false });
    }

    document.addEventListener("visibilitychange", releaseVoiceWhenPageLeaves);
    window.addEventListener("pagehide", releaseVoiceOnPageHide);
    return () => {
      document.removeEventListener(
        "visibilitychange",
        releaseVoiceWhenPageLeaves,
      );
      window.removeEventListener("pagehide", releaseVoiceOnPageHide);
      releaseVoiceOnPageHide();
    };
  }, []);

  useEffect(
    () => () => window.clearTimeout(companionInteractionTimerRef.current),
    [],
  );

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    let localListener;
    let nativeListener;
    const openNativeTarget = (target) => {
      if (target?.available !== true) return;
      if (!canLeaveWorkspace(target.view === "together" ? "together" : "chat")) return;
      if (target.view === "together") {
        setActiveView("together");
        setIsSidebarOpen(false);
        setIsMobileNavOpen(false);
        return;
      }
      if (!target.sessionId) return;
      activeSessionIdRef.current = target.sessionId;
      setActiveSessionId(target.sessionId);
      setActiveView("chat");
      setIsSidebarOpen(false);
    };

    if (reminderChannelSettingsAvailable()) {
      BackgroundNotifications.consumeLaunchTarget()
        .then(openNativeTarget)
        .catch(() => {});
      BackgroundNotifications.addListener(
        "notificationTarget",
        openNativeTarget,
      )
        .then((handle) => {
          nativeListener = handle;
        })
        .catch(() => {});
    }
    LocalNotifications.addListener(
      "localNotificationActionPerformed",
      (event) => {
        const sessionId = event.notification.extra?.sessionId;
        if (!sessionId) return;
        if (!canLeaveWorkspace("chat")) return;

        activeSessionIdRef.current = sessionId;
        setActiveSessionId(sessionId);
        setActiveView("chat");
        setIsSidebarOpen(false);
      },
    ).then((handle) => {
      localListener = handle;
    });

    return () => {
      localListener?.remove();
      nativeListener?.remove();
    };
  }, [canLeaveWorkspace]);

  // DLNA 投屏接收：视频 App 投屏到灯塔时，自动进入一起看并播放投过来的媒体。
  useEffect(() => {
    if (!dlnaPluginAvailable()) return undefined;

    let handle;
    let stateHandle;
    const processMedia = async (payload) => {
      const uri = String(payload?.uri || payload?.pendingUri || "").trim();
      if (!uri) return;
      if (!canLeaveWorkspace("cast")) return;
      const title = String(payload?.title || payload?.pendingTitle || "").trim().slice(0, 180) || "投屏播放";
      // 独立投屏频道：只用专用播放器播放，不进入屏幕共看/一起看
      setDlnaCastInfo({ uri, title, receivedAt: Date.now() });
      setActiveView("cast");
      setIsSidebarOpen(false);
      setIsMobileNavOpen(false);
      setScreenGlanceFeedback({
        status: "success",
        message: `已接收投屏：${title}`,
      });
      // 清除持久化的待处理媒体
      DlnaReceiver.clearPending().catch(() => {});
    };

    void DlnaReceiver.addListener("mediaReceived", async (event) => {
      await processMedia(event);
    }).then((listener) => {
      handle = listener;
    }).catch(() => {});

    // 启动时检查是否有后台收到的待处理媒体（App 在后台时广播可能未送达 JS）
    void DlnaReceiver.getState().then((state) => {
      if (state?.pendingUri) {
        processMedia(state);
      }
    }).catch(() => {});

    // 启动时刷新 DLNA 开关状态（服务可能已经在后台运行，但前端尚未同步）
    void readDlnaState().then((state) => {
      setDlnaState(state);
    }).catch(() => {});

    // 监听 DLNA 服务状态变化，实时刷新开关显示
    void DlnaReceiver.addListener("stateChanged", async () => {
      const state = await readDlnaState().catch(() => null);
      if (state) setDlnaState(state);
    }).then((listener) => {
      stateHandle = listener;
    }).catch(() => {});

    // App 从后台回到前台时，检查是否有投屏期间收到的待处理媒体
    // （App 在后台时 WebView JS 暂停，mediaReceived 事件到不了前端）
    let appStateHandle;
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      void DlnaReceiver.getState().then((state) => {
        if (state?.pendingUri) {
          processMedia(state);
        }
      }).catch(() => {});
    }).then((listener) => {
      appStateHandle = listener;
    }).catch(() => {});

    return () => {
      handle?.remove();
      stateHandle?.remove();
      appStateHandle?.remove();
    };
  }, [canLeaveWorkspace]);

  useEffect(() => {
    if (!hasLoadedSettings || settings.push_enabled !== true) {
      setNotificationPermissionState(initialNotificationPermissionState);
      return undefined;
    }

    let cancelled = false;
    setNotificationPermissionState({
      status: "checking",
      message: "正在自动检查手机通知权限…",
    });
    void prepareLocalNotificationPermission().then((result) => {
      if (!cancelled) setNotificationPermissionState(result);
    });

    return () => {
      cancelled = true;
    };
  }, [hasLoadedSettings, settings.push_enabled]);

  useEffect(() => {
    if (settings.push_enabled !== true) return undefined;

    let cancelled = false;
    let pollInFlight = false;
    let timerId;
    const pushCursorKey = accountStorageKey(
      PUSH_CURSOR_KEY,
      accountStorageScope,
    );
    const pushSeenIdsKey = accountStorageKey(
      PUSH_SEEN_IDS_KEY,
      accountStorageScope,
    );

    if (!localStorage.getItem(pushCursorKey)) {
      const legacyCursor = readAccountStorage(
        localStorage,
        PUSH_CURSOR_KEY,
        accountStorageScope,
        { migrateLegacy: true },
      );
      if (!legacyCursor) {
        localStorage.setItem(pushCursorKey, new Date().toISOString());
      }
    }

    async function pollPushMessages() {
      if (cancelled || pollInFlight || !navigator.onLine) return;

      const since = localStorage.getItem(pushCursorKey);
      if (!since) return;

      pollInFlight = true;
      try {
        const data = await apiRequest(
          `/api/v2/push/messages?since=${encodeURIComponent(since)}&limit=50`,
        );
        if (cancelled) return;

        const seenIds = readSeenPushIds(accountStorageScope);
        const seenSet = new Set(seenIds);
        const incoming = (data.messages || []).filter(
          (item) => item.id && !seenSet.has(item.id),
        );
        const allMessages = data.messages || [];
        const latest = allMessages[allMessages.length - 1];

        if (latest?.created_at) {
          localStorage.setItem(pushCursorKey, latest.created_at);
        }

        if (incoming.length === 0) return;

        const nextSeenIds = [
          ...seenIds,
          ...incoming.map((item) => item.id),
        ].slice(-200);
        localStorage.setItem(pushSeenIdsKey, JSON.stringify(nextSeenIds));

        const currentSessionId = activeSessionIdRef.current;
        const sessionsData = await apiRequest("/api/v2/sessions");
        if (!cancelled) setSessions(sessionsData.sessions || []);

        if (
          currentSessionId &&
          !streamingSessionIdRef.current &&
          incoming.some((item) => item.conversation_id === currentSessionId)
        ) {
          const history = await apiRequest(
            `/api/v2/sessions/${currentSessionId}/messages`,
          );
          if (!cancelled && activeSessionIdRef.current === currentSessionId) {
            setMessages(
              hydrateSessionChatHistory(history.messages, currentSessionId),
            );
          }
        }

        // 主动消息通知栏弹出（声音+震动由系统通知渠道提供）：
        // app 可见时由前端弹本地通知（每 30 秒轮询一次），
        // app 被杀后由 Android 原生 WorkManager 兜底（15 分钟周期）。
        const isForeground = document.visibilityState === "visible";
        if (isForeground && Capacitor.isPluginAvailable("LocalNotifications")) {
          const notifiable = incoming.filter((item) => {
            const text = String(item.content || "").trim();
            return text.length >= 2 && text.length <= 500;
          });
          for (const item of notifiable.slice(-3)) {
            try {
              await LocalNotifications.schedule({
                notifications: [
                  {
                    id: Number(String(item.id).replace(/\D/g, "").slice(0, 8) || 0) % 100000 + 50000,
                    title: `${settings.ai_name || "DengTa"} 主动想对你说`,
                    body: String(item.content || "").slice(0, 500),
                    smallIcon: "ic_launcher",
                    channelId: LOCAL_NOTIFICATION_CHANNEL_ID,
                    extra: item.conversation_id ? { sessionId: item.conversation_id } : undefined,
                  },
                ],
              });
            } catch {
              // 通知失败不影响聊天同步。
            }
          }
        }
      } catch (error) {
        console.warn("主动消息检查失败：", error.message);
      } finally {
        pollInFlight = false;
      }
    }

    async function runAndScheduleNext() {
      await pollPushMessages();
      if (!cancelled) {
        timerId = window.setTimeout(
          runAndScheduleNext,
          PUSH_POLL_INTERVAL_MS,
        );
      }
    }

    function pollWhenVisible() {
      if (document.visibilityState === "visible") {
        void pollPushMessages();
      }
    }

    void runAndScheduleNext();
    document.addEventListener("visibilitychange", pollWhenVisible);
    window.addEventListener("online", pollWhenVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", pollWhenVisible);
      window.removeEventListener("online", pollWhenVisible);
    };
  }, [accountStorageScope, settings.ai_name, settings.push_enabled]);

  useEffect(() => {
    if (!hasLoadedSettings || settings.push_enabled !== true) return undefined;
    void maybeNotifyNewCompanionReplies(messages, {
      aiName: effectiveAiName,
      sessionId: activeSessionIdRef.current || "",
      scope: accountStorageScope,
      hidden: document.hidden,
    });

  }, [messages, settings.push_enabled, effectiveAiName, hasLoadedSettings, accountStorageScope]);

  useEffect(() => {
    let cancelled = false;

    async function loadMessages() {
      if (!activeSessionId) {
        messagesSessionIdRef.current = null;
        messageLoadTokenRef.current += 1;
        setMessages([]);
        return;
      }

      if (
        streamingSessionIdRef.current === activeSessionId &&
        messagesSessionIdRef.current === activeSessionId
      ) {
        return;
      }

      const loadToken = messageLoadTokenRef.current + 1;
      messageLoadTokenRef.current = loadToken;
      messagesSessionIdRef.current = activeSessionId;
      setMessages([]);

      try {
        const data = await apiRequest(
          `/api/v2/sessions/${activeSessionId}/messages`,
        );
        if (
          !cancelled &&
          messageLoadTokenRef.current === loadToken &&
          activeSessionIdRef.current === activeSessionId
        ) {
          setMessages(
            hydrateSessionChatHistory(data.messages, activeSessionId),
          );
        }
      } catch (error) {
        if (!cancelled) setNotice(error.message);
      }
    }

    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  const getMomentsRequestScope = useCallback(() => {
    const controller = settingsScopeControllerRef.current;
    const current = () => componentMountedRef.current && controller &&
      controller === settingsScopeControllerRef.current && !controller.signal.aborted &&
      settingsSaveScope(authSession.getSnapshot()) === privateMediaScope;
    if (!current()) return null;
    return {
      current,
      options: {
        signal: controller.signal,
        authSession: createScopedSettingsSession(authSession, privateMediaScope, controller.signal),
      },
    };
  }, [privateMediaScope]);

  const loadMoments = useCallback(async ({ silent = false } = {}) => {
    const request = getMomentsRequestScope();
    if (!request) return false;
    const token = ++momentsLoadTokenRef.current;
    if (!silent) setMomentsLoading(true);
    try {
      const data = await apiRequest("/api/v2/moments", request.options);
      if (!request.current() || token !== momentsLoadTokenRef.current) return false;
      if (typeof data?.available !== "boolean" || !Array.isArray(data?.entries) ||
        data.entries.some((entry) => !entry?.id || !Array.isArray(entry.images) || !Array.isArray(entry.comments))) {
        throw Object.assign(new Error("动态列表回执不完整。"), { code: "moments_response_invalid" });
      }
      setMomentsAvailable(data.available);
      setMoments(
        data.entries.map((entry) => {
          const pending = pendingMomentLikesRef.current[String(entry.id)];
          return pending ? { ...entry, user_liked: pending.liked } : entry;
        }),
      );
      setMomentsLoadError("");
      return true;
    } catch (error) {
      if (request.current() && token === momentsLoadTokenRef.current) {
        const feedback = momentFailureMessage(error);
        setMomentsLoadError(feedback);
        if (!silent) setNotice(feedback);
      }
      return false;
    } finally {
      if (request.current() && token === momentsLoadTokenRef.current) setMomentsLoading(false);
    }
  }, [getMomentsRequestScope]);

  useEffect(() => {
    if (activeView === "moments") {
      void loadMoments();
      const refreshTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          void loadMoments({ silent: true });
        }
      }, MOMENTS_POLL_INTERVAL_MS);
      const refreshWhenVisible = () => {
        if (document.visibilityState === "visible") {
          void loadMoments({ silent: true });
        }
      };
      document.addEventListener("visibilitychange", refreshWhenVisible);
      return () => {
        momentsLoadTokenRef.current += 1;
        window.clearInterval(refreshTimer);
        document.removeEventListener("visibilitychange", refreshWhenVisible);
      };
    }

    return undefined;
  }, [activeView, loadMoments]);

  useLayoutEffect(() => {
    if (activeView !== "chat" || !messageListRef.current) return undefined;
    const controller = createChatScrollController(
      messageListRef.current,
      shouldAutoScrollRef,
    );
    chatScrollControllerRef.current = controller;
    return () => {
      controller.dispose();
      chatScrollControllerRef.current = null;
    };
  }, [activeView, activeSessionId]);

  useLayoutEffect(() => {
    chatScrollControllerRef.current?.sync();
  }, [messages, isSending]);

  useEffect(() => {
    if (
      !isSettingsOpen ||
      !settingsFocusTarget
    ) {
      return undefined;
    }

    let cancelled = false;
    let retryTimer;
    let attempt = 0;
    const revealTarget = () => {
      if (cancelled) return;
      const target = document.getElementById(settingsFocusTarget);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        setSettingsFocusTarget("");
        return;
      }
      attempt += 1;
      if (attempt < 20) {
        retryTimer = window.setTimeout(revealTarget, 100);
      } else {
        setSettingsFocusTarget("");
      }
    };
    const animationFrame = window.requestAnimationFrame(revealTarget);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(retryTimer);
    };
  }, [isSettingsOpen, settingsCategory, settingsFocusTarget]);

  // 设置页打开时清除屏幕共看残留错误消息（例如旧流程投屏失败留下的 500 错误）
  useEffect(() => {
    if (isSettingsOpen && screenGlanceFeedback.status === "error") {
      setScreenGlanceFeedback({
        status: "idle",
        message: "默认关闭。只有 Android 系统明确显示共享状态时才可能取得画面。",
      });
    }
    // 打开设置时刷新 DLNA 状态（确保开关显示真实状态）
    if (isSettingsOpen) {
      void readDlnaState().then((state) => {
        setDlnaState(state);
      }).catch(() => {});
    }
  }, [isSettingsOpen, screenGlanceFeedback.status]);

  function handleSettingsScroll(event) {
    const settingsScroll = event.currentTarget;
    const settingsSheet = settingsScroll.closest(".settings-sheet");
    settingsSheet?.classList.add("is-scrolling");
    window.clearTimeout(settingsScrollIdleTimerRef.current);
    settingsScrollIdleTimerRef.current = window.setTimeout(() => {
      settingsSheet?.classList.remove("is-scrolling");
    }, 180);
  }

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      if (shouldFlushSettingsForLifecycle("online")) {
        window.clearTimeout(settingsSaveRetryTimerRef.current);
        settingsSaveRetryTimerRef.current = null;
        settingsSaveRetryCountRef.current = 0;
        void flushLatestSettingsDraftRef.current();
      }
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return installInnerHeightViewportFallback();

    const root = document.documentElement;
    let fullHeight = Math.max(
      window.innerHeight,
      viewport.height + viewport.offsetTop,
    );
    let viewportWidth = viewport.width || window.innerWidth;

    function editableElementIsFocused() {
      const activeElement = document.activeElement;
      return Boolean(
        activeElement instanceof HTMLElement &&
          (activeElement.matches("input, textarea, select") ||
            activeElement.isContentEditable),
      );
    }

    function fitViewport() {
      const visibleBottom = viewport.height + viewport.offsetTop;
      const nextViewportWidth = viewport.width || window.innerWidth;
      if (Math.abs(nextViewportWidth - viewportWidth) > 48) {
        viewportWidth = nextViewportWidth;
        fullHeight = Math.max(window.innerHeight, visibleBottom);
      }
      const rawGap = Math.max(0, fullHeight - viewport.height);
      const keyboardOpen = editableElementIsFocused() && rawGap > 100;

      if (!keyboardOpen && rawGap <= 100) {
        fullHeight = Math.max(fullHeight, visibleBottom, window.innerHeight);
      }

      root.dataset.keyboardOpen = keyboardOpen ? "true" : "false";
      const height = keyboardOpen ? viewport.height : fullHeight;
      root.style.setProperty(
        "--app-height",
        `${Math.round(height)}px`,
      );
      if (!keyboardOpen && window.scrollY) window.scrollTo(0, 0);
    }

    fitViewport();
    viewport.addEventListener("resize", fitViewport);
    viewport.addEventListener("scroll", fitViewport);
    window.addEventListener("resize", fitViewport);
    window.addEventListener("orientationchange", fitViewport);
    document.addEventListener("focusin", fitViewport);
    document.addEventListener("focusout", fitViewport);
    return () => {
      viewport.removeEventListener("resize", fitViewport);
      viewport.removeEventListener("scroll", fitViewport);
      window.removeEventListener("resize", fitViewport);
      window.removeEventListener("orientationchange", fitViewport);
      document.removeEventListener("focusin", fitViewport);
      document.removeEventListener("focusout", fitViewport);
      delete root.dataset.keyboardOpen;
    };
  }, []);

  useEffect(() => {
    function resetSettingsLifecycleFlush() {
      settingsLifecycleFlushPendingRef.current = false;
    }

    function flushSettingsBeforePageLeaves(event) {
      if (
        event.type === "visibilitychange" &&
        document.visibilityState === "visible"
      ) {
        settingsLifecycleFlushPendingRef.current = false;
        return;
      }
      if (
        !shouldFlushSettingsForLifecycle(
          event.type,
          document.visibilityState,
        )
      ) {
        return;
      }
      if (settingsLifecycleFlushPendingRef.current) return;
      settingsLifecycleFlushPendingRef.current = true;
      void flushLatestSettingsDraftRef.current({ keepalive: true });
    }

    document.addEventListener(
      "visibilitychange",
      flushSettingsBeforePageLeaves,
    );
    window.addEventListener("pagehide", flushSettingsBeforePageLeaves);
    window.addEventListener("pageshow", resetSettingsLifecycleFlush);
    return () => {
      document.removeEventListener(
        "visibilitychange",
        flushSettingsBeforePageLeaves,
      );
      window.removeEventListener("pagehide", flushSettingsBeforePageLeaves);
      window.removeEventListener("pageshow", resetSettingsLifecycleFlush);
    };
  }, []);

  function setVoiceMode(nextState) {
    voiceStateRef.current = nextState;
    setVoiceState(nextState);
  }

  function setVoiceTapToSendMode(enabled) {
    voiceTapToSendRef.current = enabled;
  }

  function clearVoiceRecordingTimers() {
    window.clearInterval(voiceElapsedTimerRef.current);
    window.clearTimeout(voiceMaxTimerRef.current);
    voiceElapsedTimerRef.current = null;
    voiceMaxTimerRef.current = null;
  }

  function releaseVoiceStream(stream = voiceStreamRef.current) {
    stream?.getTracks?.().forEach((track) => track.stop());
    if (voiceStreamRef.current === stream) {
      voiceStreamRef.current = null;
    }
  }

  function setVoiceFailure(errorOrMessage) {
    const message =
      typeof errorOrMessage === "string"
        ? errorOrMessage
        : voiceCaptureErrorMessage(errorOrMessage);
    setVoiceError(message);
    setVoiceMode(VOICE_STATES.error);
    setNotice(message);
  }

  function cancelVoiceCapture({ message = "", updateState = true } = {}) {
    voiceCaptureRunRef.current += 1;
    voicePointerHeldRef.current = false;
    voicePointerIdRef.current = null;
    voiceLongPressArmedRef.current = false;
    if (voiceLongPressTimerRef.current) {
      window.clearTimeout(voiceLongPressTimerRef.current);
      voiceLongPressTimerRef.current = null;
    }
    setVoiceTapToSendMode(false);
    clearVoiceRecordingTimers();

    const pendingRequest = voiceRequestRef.current;
    voiceRequestRef.current = null;
    pendingRequest?.abort?.();

    const recorder = voiceRecorderRef.current;
    voiceRecorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // 录音器已经自行结束时，只需继续释放麦克风。
      }
    }

    voiceChunksRef.current = [];
    releaseVoiceStream();
    if (updateState) {
      setVoiceElapsedMs(0);
      setVoiceMode(VOICE_STATES.idle);
      if (message) setNotice(message);
    }
  }

  async function stopVoicePlayback({ updateState = true } = {}) {
    speechRunRef.current += 1;
    await stopVoiceSpeech();
    if (updateState && voiceStateRef.current === VOICE_STATES.speaking) {
      setVoiceMode(VOICE_STATES.idle);
    }
  }

  async function playAssistantReply(
    value,
    messageId = "",
    speechToken = "",
    sessionId = activeSessionIdRef.current,
  ) {
    if (!voiceAutoSpeakEnabled || !String(value || "").trim()) return;
    if (
      !shouldRequestVoiceOutputForText(
        value,
        voiceOutputStatusRef.current,
      )
    ) {
      return;
    }

    const runId = speechRunRef.current + 1;
    speechRunRef.current = runId;
    await stopVoiceSpeech();
    if (speechRunRef.current !== runId) return;

    setVoiceError("");
    setVoiceMode(VOICE_STATES.speaking);
    try {
      await speakVoiceText(value, {
        mode: VOICE_PLAYBACK_MODES.expressive,
        messageId,
        sessionId,
        speechToken,
      });
    } catch (error) {
      if (speechRunRef.current === runId) {
        setVoiceFailure(
          `自然语音播放失败，本轮只显示文字：${error?.message || "请稍后重试"}`,
        );
      }
      return;
    }

    if (speechRunRef.current === runId) {
      setVoiceMode(VOICE_STATES.idle);
    }
  }

  async function submitVoiceBlob(blob, durationMs) {
    setVoiceError("");
    setVoiceMode(VOICE_STATES.uploading);
    const turnContextDraftAtRequest = turnContextRef.current;
    const turnContextSnapshot = turnContextDraftAtRequest
      .trim()
      ;
    let sessionId = activeSessionIdRef.current;
    let voiceSessionId = sessionId;
    let requestHandle;
    let voiceModel =
      readStoredSessionChatModel(sessionId) ||
      selectedChatModel ||
      settings.model ||
      "";

    try {
      if (!(await flushLatestSettingsDraft())) {
        throw new Error(
          "最新角色设置还没有保存成功，语音没有发送。请恢复网络后再试一次。",
        );
      }
      await refreshDeviceActivityContext({ silent: true });
      if (activeSessionIdRef.current) {
        await sessionModelSaveQueueRef.current;
      }

      if (!sessionId) {
        const created = await apiRequest("/api/v2/sessions", {
          method: "POST",
          body: JSON.stringify({ title: "语音对话" }),
        });
        sessionId = created.session.id;
        moveSessionDraft(null, sessionId);
        voiceSessionId = sessionId;
        setSessions((current) =>
          current.some((item) => item.id === sessionId)
            ? current
            : [created.session, ...current],
        );
        activeSessionIdRef.current = sessionId;
        messagesSessionIdRef.current = sessionId;
        setActiveSessionId(sessionId);
        setMessages([]);
        voiceModel = String(created.session.model_id || "").trim();
        initializeSessionChatModel(sessionId, voiceModel);
      }

      streamingSessionIdRef.current = sessionId;
      const formData = buildVoiceTurnFormData({
        blob,
        sessionId,
        clientTime: shanghaiClientTime(),
        timezone: SHANGHAI_TIME_ZONE,
        model: voiceModel,
        emotionUnderstandingEnabled,
        companionStatus: companionStatusForRequest(
          companionStatusRef.current,
        ),
        environmentContext: environmentContextRef.current,
        turnContext: turnContextSnapshot,
      });

      requestHandle = createVoiceTurnRequest(formData, {
        onUploadComplete() {
          if (voiceRequestRef.current === requestHandle) {
            setVoiceMode(VOICE_STATES.thinking);
          }
        },
      });
      voiceRequestRef.current = requestHandle;
      const data = await requestHandle.promise;

      const responseSessionId = data.session_id || sessionId;
      voiceSessionId = responseSessionId;
      streamingSessionIdRef.current = responseSessionId;
      const serverUserMessage = data.user_message;
      const serverAssistantMessage = data.assistant_message;
      const normalizedAnalysis = normalizeVoiceAnalysis(data.voice_analysis);
      const transcript =
        normalizedAnalysis.text ||
        String(serverUserMessage?.content || "").trim();

      if (!transcript) {
        throw new Error("服务器没有返回可显示的语音转写，请重新说一次。");
      }
      if (
        !serverAssistantMessage ||
        serverAssistantMessage.role !== "assistant" ||
        typeof serverAssistantMessage.content !== "string" ||
        !serverAssistantMessage.content.trim()
      ) {
        throw new Error("服务器没有返回可播放的 AI 回复，请稍后再试。");
      }

      const voiceAnalysis = {
        ...normalizedAnalysis,
        text: transcript,
        durationMs,
      };
      const userMessage = {
        ...(serverUserMessage || {}),
        id: serverUserMessage?.id || `voice-user-${Date.now()}`,
        role: "user",
        content: transcript,
        created_at:
          serverUserMessage?.created_at || new Date().toISOString(),
        voiceAnalysis,
      };

      applyPromptReceipt(data.prompt_receipt);
      if (data.companion_status) {
        setCompanionStatus((current) =>
          mergeCompanionStatus(current, data.companion_status),
        );
      }

      activeSessionIdRef.current = responseSessionId;
      setActiveSessionId(responseSessionId);
      const messagesBelongToSession =
        messagesSessionIdRef.current === responseSessionId;
      messagesSessionIdRef.current = responseSessionId;
      messageLoadTokenRef.current += 1;
      setMessages((current) => {
        const next = messagesBelongToSession ? [...current] : [];
        for (const incoming of [userMessage, serverAssistantMessage]) {
          const index = next.findIndex((item) => item.id === incoming.id);
          if (index >= 0) next[index] = incoming;
          else next.push(incoming);
        }
        return next;
      });
      if (
        turnContextSnapshot &&
        turnContextRef.current === turnContextDraftAtRequest
      ) {
        turnContextRef.current = "";
        setTurnContext("");
      }
      setLastVoiceAnalysis(voiceAnalysis);
      setNotice(
        `语音已转写。声音情绪线索：${voiceAnalysis.emotion}，${formatVoiceConfidence(voiceAnalysis.confidence)}。这不是心理诊断。`,
      );
      try {
        await refreshSessions(responseSessionId);
      } catch (error) {
        console.warn("语音回复已保存，但刷新会话列表失败：", error.message);
      }

      if (voiceAutoSpeakEnabled) {
        await playAssistantReply(
          serverAssistantMessage.content,
          serverAssistantMessage.id,
          serverAssistantMessage.speech_token,
          responseSessionId,
        );
      } else {
        setVoiceMode(VOICE_STATES.idle);
      }
    } catch (error) {
      if (requestHandle && voiceRequestRef.current !== requestHandle) return;
      setVoiceFailure(error);
    } finally {
      if (voiceRequestRef.current === requestHandle) {
        voiceRequestRef.current = null;
      }
      if (streamingSessionIdRef.current === voiceSessionId) {
        streamingSessionIdRef.current = null;
      }
      if (
        [VOICE_STATES.uploading, VOICE_STATES.thinking].includes(
          voiceStateRef.current,
        )
      ) {
        setVoiceMode(VOICE_STATES.idle);
      }
    }
  }

  async function finishVoiceCapture({ send = true } = {}) {
    const recorder = voiceRecorderRef.current;
    if (!recorder) return;

    voiceRecorderRef.current = null;
    setVoiceTapToSendMode(false);
    clearVoiceRecordingTimers();
    const durationMs = Math.max(0, Date.now() - voiceStartedAtRef.current);

    try {
      await new Promise((resolve) => {
        if (recorder.state === "inactive") {
          resolve();
          return;
        }
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.stop();
      });
    } catch (error) {
      releaseVoiceStream();
      voiceChunksRef.current = [];
      setVoiceFailure(error);
      return;
    }

    releaseVoiceStream();
    setVoiceElapsedMs(durationMs);
    if (!send) {
      voiceChunksRef.current = [];
      setVoiceMode(VOICE_STATES.idle);
      return;
    }

    const durationCheck = validateVoiceDuration(durationMs);
    if (!durationCheck.ok) {
      voiceChunksRef.current = [];
      setVoiceFailure(durationCheck.message);
      return;
    }

    const chunks = voiceChunksRef.current;
    voiceChunksRef.current = [];
    const mimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size === 0) {
      setVoiceFailure("没有收到麦克风声音，请检查权限后重试。");
      return;
    }

    await submitVoiceBlob(blob, durationMs);
  }

  async function beginVoiceCapture(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();

    // 如果已经在录音中（长按门控后的正常录音），松开即发送 → 这不发生；
    // 保留安全分支：如果录音中且已松手，finishVoiceCapture 已在 endVoiceCapture 处理。
    // 此处仅负责门控触发：长按达到阈值后才开始录音。

    if (!voiceServiceAvailable) {
      setVoiceFailure(voiceService.message);
      return;
    }

    if (
      isSendingRef.current ||
      companionInteractionInFlightRef.current ||
      voiceInputBusy(voiceStateRef.current)
    ) {
      return;
    }

    if (!voiceRecordingSupported()) {
      setVoiceFailure(
        "当前浏览器或 App 不支持录音。请安装最新版 DengTa home Android App。",
      );
      return;
    }

    // 清除之前的计时器
    if (voiceLongPressTimerRef.current) {
      window.clearTimeout(voiceLongPressTimerRef.current);
      voiceLongPressTimerRef.current = null;
    }
    voiceLongPressArmedRef.current = false;
    voicePointerHeldRef.current = true;
    voicePointerIdRef.current = event.pointerId;

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // 某些 WebView 不支持显式指针捕获，pointerup 仍会正常工作。
    }

    // 保留 captureRun 递增，用于权限/超时后校验是否仍是本次操作
    const captureRun = voiceCaptureRunRef.current + 1;
    voiceCaptureRunRef.current = captureRun;

    // 长按门控计时器：达到阈值后才真正开始录音
    voiceLongPressTimerRef.current = window.setTimeout(async () => {
      voiceLongPressTimerRef.current = null;
      voiceLongPressArmedRef.current = true;

      if (!voicePointerHeldRef.current || voiceCaptureRunRef.current !== captureRun) return;

      setVoiceError("");
      setNotice("");
      setLastVoiceAnalysis(null);
      setVoiceElapsedMs(0);

      if (voiceStateRef.current === VOICE_STATES.speaking) {
        await stopVoicePlayback();
      }
      if (!voicePointerHeldRef.current) return;

      setVoiceMode(VOICE_STATES.requesting);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        if (voiceCaptureRunRef.current !== captureRun) {
          releaseVoiceStream(stream);
          return;
        }
        voicePermissionReadyRef.current = true;
        // 长按门控后进入录音，不启用 tapToSend
        voiceStreamRef.current = stream;
        voiceChunksRef.current = [];
        const mimeType = selectRecorderMimeType(MediaRecorder);
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );
        voiceRecorderRef.current = recorder;
        recorder.addEventListener("dataavailable", (chunkEvent) => {
          if (chunkEvent.data?.size > 0) {
            voiceChunksRef.current.push(chunkEvent.data);
          }
        });
        recorder.addEventListener("error", (recorderEvent) => {
          cancelVoiceCapture({ updateState: false });
          setVoiceFailure(recorderEvent.error || recorderEvent);
        });
        recorder.start(250);

        voiceStartedAtRef.current = Date.now();
        setVoiceTapToSendMode(false);
        setVoiceMode(VOICE_STATES.recording);
        voiceElapsedTimerRef.current = window.setInterval(() => {
          setVoiceElapsedMs(Date.now() - voiceStartedAtRef.current);
        }, 200);
        voiceMaxTimerRef.current = window.setTimeout(() => {
          voicePointerHeldRef.current = false;
          void finishVoiceCapture({ send: true });
        }, VOICE_MAX_DURATION_MS);
        navigator.vibrate?.(18);
      } catch (error) {
        if (voiceCaptureRunRef.current !== captureRun) return;
        cancelVoiceCapture({ updateState: false });
        setVoiceFailure(error);
      }
    }, VOICE_LONG_PRESS_MS);
  }

  function endVoiceCapture(event) {
    if (
      voicePointerIdRef.current !== null &&
      voicePointerIdRef.current !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    voicePointerHeldRef.current = false;
    voicePointerIdRef.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // 指针已经被 WebView 释放时无需再处理。
    }
    // 未达到长按阈值就松手：取消门控计时器，不录音、不提示。
    if (!voiceLongPressArmedRef.current) {
      if (voiceLongPressTimerRef.current) {
        window.clearTimeout(voiceLongPressTimerRef.current);
        voiceLongPressTimerRef.current = null;
      }
      voiceCaptureRunRef.current += 1;
      return;
    }
    if (voiceStateRef.current === VOICE_STATES.recording) {
      setVoiceTapToSendMode(false);
      void finishVoiceCapture({ send: true });
    }
  }

  function updateVoicePlaybackMode(value) {
    const mode = normalizeVoicePlaybackMode(value);
    setVoicePlaybackMode(mode);
    try {
      writeAccountStorage(
        localStorage,
        VOICE_PLAYBACK_MODE_KEY,
        accountStorageScope,
        mode,
      );
      localStorage.removeItem("dengta_voice_auto_speak_enabled");
    } catch {
      // 本地存储不可用时，本次运行仍保持选择。
    }
    if (mode === VOICE_PLAYBACK_MODES.off) {
      void stopVoicePlayback();
    }
    const labels = {
      [VOICE_PLAYBACK_MODES.off]: "AI 回复自动语音已关闭。",
      [VOICE_PLAYBACK_MODES.expressive]: voiceService.expressiveAvailable
        ? "AI 自然语音已开启。"
        : "已选择自然语音；云端尚未连接时只显示文字。",
    };
    setNotice(labels[mode]);
  }

  voiceLifecycleRef.current.cancel = cancelVoiceCapture;
  voiceLifecycleRef.current.stopPlayback = stopVoicePlayback;

  async function refreshSessions(preferredId = activeSessionId) {
    const data = await apiRequest("/api/v2/sessions");
    const nextSessions = data.sessions || [];
    nextSessions.forEach((session) => {
      if (session.model_id) {
        storeSessionChatModel(session.id, session.model_id);
      }
    });
    setSessions(nextSessions);

    if (preferredId && nextSessions.some((item) => item.id === preferredId)) {
      setActiveSessionId(preferredId);
    } else {
      setActiveSessionId(nextSessions[0]?.id || null);
    }
  }

  async function createSession() {
    if (createSessionPendingRef.current) return;
    if (!canLeaveWorkspace("chat")) return;
    createSessionPendingRef.current = true;
    setIsCreatingSession(true);
    abortChatRequest(chatRequestRef, "session-change");
    closeComposerMenu();
    requestStatusPanelClose();
    try {
      if (!(await flushLatestSettingsDraft())) {
        setNotice("最新角色设置还没有保存成功，这次新对话没有创建。请恢复网络后重试。");
        return;
      }
      const data = await apiRequest("/api/v2/sessions", {
        method: "POST",
        body: JSON.stringify({
          title: "新对话",
        }),
      });
      setSessions((current) => [data.session, ...current]);
      activeSessionIdRef.current = data.session.id;
      setActiveSessionId(data.session.id);
      setMessages([]);
      initializeSessionChatModel(data.session.id, data.session.model_id);
      setActiveView("chat");
      setIsSidebarOpen(false);
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    } finally {
      createSessionPendingRef.current = false;
      setIsCreatingSession(false);
    }
  }

  function chooseSession(sessionId) {
    if (!canLeaveWorkspace("chat")) return;
    chatScrollControllerRef.current?.open();
    if (sessionId !== activeSessionIdRef.current) {
      abortChatRequest(chatRequestRef, "session-change");
    }
    closeComposerMenu();
    requestStatusPanelClose();
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    setActiveView("chat");
    setIsSidebarOpen(false);
  }

  function openSessionDialog(next) {
    if (sessionDialogPendingRef.current) return;
    closeComposerMenu();
    requestStatusPanelClose();
    setSessionDialogFeedback("");
    setDialog(next);
  }

  function closeSessionDialog() {
    if (sessionDialogPendingRef.current) return;
    setDialog(null);
    setSessionDialogFeedback("");
  }

  async function confirmSessionDialog(event) {
    event.preventDefault();
    if (!dialog?.session || sessionDialogPendingRef.current || !sessionDialogRequest.isCurrent()) return;
    const submitted = dialog;
    const title = String(submitted.value || "").trim();
    if (submitted.type === "rename" && (!title || title.length > MAX_SESSION_TITLE)) return;
    const pending = {};
    const path = `/api/v2/sessions/${encodeURIComponent(submitted.session.id)}`;
    sessionDialogPendingRef.current = pending;
    setSessionDialogBusy(true);
    setSessionDialogFeedback("");

    try {
      if (submitted.type === "rename") {
        const saved = await sessionDialogRequest.request(path, {
          method: "PATCH",
          body: { title },
          responseReader: (response) => readSessionRename(response, submitted.session.id, title),
        });
        if (!sessionDialogRequest.isCurrent()) return;
        setSessions((current) =>
          current.map((item) =>
            item.id === submitted.session.id ? { ...item, ...saved } : item,
          ),
        );
      } else {
        await sessionDialogRequest.request(path, {
          method: "DELETE",
          responseReader: readSessionDelete,
        });
        if (!sessionDialogRequest.isCurrent()) return;
        storeSessionChatModel(submitted.session.id, "");
        clearStoredMessageReferencesForSession(submitted.session.id);
        const remaining = sessionsRef.current.filter(
          (item) => item.id !== submitted.session.id,
        );
        setSessions((current) => current.filter((item) => item.id !== submitted.session.id));
        if (activeSessionIdRef.current === submitted.session.id) {
          abortChatRequest(chatRequestRef, "session-deleted");
          activeSessionIdRef.current = remaining[0]?.id || null;
          setActiveSessionId(activeSessionIdRef.current);
          setMessages([]);
        }
      }
      if (dialogRef.current === submitted) setDialog(null);
    } catch (error) {
      if (sessionDialogRequest.isCurrent()) {
        recordOperationFailure(privateMediaScope, path, error);
        const feedback = sessionDialogFailure(error);
        if (dialogRef.current === submitted) setSessionDialogFeedback(feedback);
        else setNotice(feedback);
      }
    } finally {
      if (sessionDialogPendingRef.current === pending) {
        sessionDialogPendingRef.current = null;
        if (sessionDialogRequest.isCurrent()) setSessionDialogBusy(false);
      }
    }
  }

  function scheduleCompanionInteraction(
    delay = COMPANION_INTERACTION_DEBOUNCE_MS,
  ) {
    window.clearTimeout(companionInteractionTimerRef.current);
    companionInteractionTimerRef.current = window.setTimeout(() => {
      companionInteractionTimerRef.current = null;
      void processCompanionInteractionQueue();
    }, delay);
  }

  async function syncDisplayedMessages(sessionId) {
    if (!sessionId || activeSessionIdRef.current !== sessionId) return;

    const loadToken = messageLoadTokenRef.current + 1;
    messageLoadTokenRef.current = loadToken;
    messagesSessionIdRef.current = sessionId;
    const history = await apiRequest(
      `/api/v2/sessions/${sessionId}/messages`,
    );

    if (
      activeSessionIdRef.current === sessionId &&
      messageLoadTokenRef.current === loadToken
    ) {
      messagesSessionIdRef.current = sessionId;
      setMessages(hydrateSessionChatHistory(history.messages, sessionId));
    }
  }

  function registerCompanionInteraction(zoneId) {
    if (!COMPANION_INTERACTION_TYPES.includes(zoneId)) {
      return companionInteractionStatsRef.current;
    }

    const now = Date.now();
    const preInteractionStatus = companionStatusForRequest(
      companionStatusRef.current,
    );
    const nextStats = recordCompanionInteraction(
      companionInteractionStatsRef.current,
      zoneId,
      now,
    );
    companionInteractionStatsRef.current = nextStats;
    setCompanionInteractionStats(nextStats);

    if (visualPreview) return nextStats;

    const sessionId = activeSessionIdRef.current;
    companionInteractionQueueRef.current = enqueueCompanionInteraction({
      queue: companionInteractionQueueRef.current,
      zoneId,
      stats: nextStats,
      sessionId,
      preInteractionStatus,
      now,
      eventId: createCompanionInteractionEventId(),
      debounceMs: COMPANION_INTERACTION_DEBOUNCE_MS,
      maxBatchSize: 100,
    });

    scheduleCompanionInteraction();
    return nextStats;
  }

  companionInteractionHandlerRef.current = registerCompanionInteraction;

  async function requestVisibleInnerMonologue(item) {
    if (!item || !canRequestVisibleMonologue(item)) return;
    const sessionId =
      item?.conversation_id || item?.session_id || activeSessionIdRef.current;
    const sourceId = String(item.id || "");
    const lifecycle = innerMonologueRequestScopeRef.current;
    if (
      !sourceId || !sessionId || sessionId !== activeSessionIdRef.current ||
      !lifecycle.active || settingsSaveScope(authSession.getSnapshot()) !== privateMediaScope ||
      innerMonologueRequestsRef.current.has(sourceId) ||
      innerMonologueForMessage(innerMonologues, sourceId)
    ) return;
    const operation = { controller: new AbortController() };
    const requestIds = new Set([sourceId]);
    let messageId = sourceId;
    innerMonologueRequestsRef.current.set(sourceId, operation);
    const isCurrent = () =>
      lifecycle.active && innerMonologueRequestScopeRef.current === lifecycle &&
      !operation.controller.signal.aborted && sessionId === activeSessionIdRef.current &&
      settingsSaveScope(authSession.getSnapshot()) === privateMediaScope;
    const scopedSession = createScopedSettingsSession(authSession, privateMediaScope, operation.controller.signal);
    setInnerMonologuePending((current) => ({
      ...current,
      [sourceId]: true,
    }));
    setInnerMonologueErrors((current) => ({
      ...current,
      [sourceId]: "",
    }));
    try {
      const { recoverSynchronizedAssistantMessage } = await import(
        "./inner-monologue-sync.js"
      );
      if (!isCurrent()) return;
      const synchronized = await recoverSynchronizedAssistantMessage({
        message: item,
        sessionId,
        loadMessages: async () => {
          const history = await apiRequest(`/api/v2/sessions/${sessionId}/messages`, {
            authSession: scopedSession, signal: operation.controller.signal,
          });
          return hydrateSessionChatHistory(history.messages, sessionId);
        },
      });
      if (!isCurrent()) return;
      const targetMessage = synchronized.message;
      if (!targetMessage) throw synchronized.cause || new Error(synchronized.error);
      if (!canRequestVisibleMonologue(targetMessage)) return;
      messageId = targetMessage.id;
      if (innerMonologueForMessage(innerMonologues, messageId)) return;
      const existing = innerMonologueRequestsRef.current.get(messageId);
      if (existing && existing !== operation) return;
      requestIds.add(messageId);
      innerMonologueRequestsRef.current.set(messageId, operation);
      if (messageId !== sourceId) {
        setMessages((current) => current.map(row => row.id === sourceId ? targetMessage : row));
        setInnerMonologuePending((current) => ({ ...current, [sourceId]: false, [messageId]: true }));
        setInnerMonologueErrors((current) => ({ ...current, [messageId]: "" }));
      }
      if (!(await flushLatestSettingsDraft())) {
        throw new Error("最新个性化指令尚未保存成功，请恢复网络后重试。");
      }
      if (!isCurrent()) return;
      const data = await apiRequest("/companion/inner-monologue", {
        authSession: scopedSession,
        signal: operation.controller.signal,
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          message_id: messageId,
          model:
            readStoredSessionChatModel(sessionId) ||
            selectedChatModel ||
            settings.model ||
            "",
          companion_status: companionStatusForRequest(
            companionStatusRef.current,
          ),
        }),
        timeoutMs: 300 * 1000,
      });
      if (!isCurrent()) return;
      if (
        typeof data?.inner_monologue !== "string" || !data.inner_monologue.trim() ||
        data.message_id !== messageId || data.session_id !== sessionId ||
        (data.conversation_id && data.conversation_id !== sessionId)
      ) {
        const error = new Error("心声回复为空或与这条聊天不匹配，请重试；如重复出现，可查看日志核对接口。");
        error.code = "inner_monologue_receipt_invalid";
        throw error;
      }
      const next = storeInnerMonologue(
        {
          messageId,
          text: data?.inner_monologue,
          createdAt: new Date().toISOString(),
        },
        globalThis.localStorage,
        accountStorageScope,
      );
      setInnerMonologues(next);
    } catch (error) {
      if (!isCurrent()) return;
      if (error?.code === "inner_monologue_receipt_invalid") {
        recordOperationFailure(privateMediaScope, "/companion/inner-monologue", error);
      }
      const codeText = error?.code ? '[' + error.code + '] ' : '';
      const locationText = error?.error_location
        ? '\n位置: ' + error.error_location
        : '';
      setInnerMonologueErrors((current) => ({
        ...current,
        [messageId]:
          codeText +
          (error?.message || "这次心声没有生成成功，请稍后再试。") +
          locationText,
      }));
    } finally {
      for (const id of requestIds) {
        if (innerMonologueRequestsRef.current.get(id) === operation) innerMonologueRequestsRef.current.delete(id);
      }
      if (isCurrent()) setInnerMonologuePending((current) => {
        const next = { ...current };
        for (const id of requestIds) next[id] = false;
        return next;
      });
    }
  }

  async function processCompanionInteractionQueue() {
    if (companionInteractionQueueRef.current.length === 0) return;

    if (
      companionInteractionInFlightRef.current ||
      isSendingRef.current ||
      voiceInputBusy(voiceStateRef.current)
    ) {
      scheduleCompanionInteraction(350);
      return;
    }

    if (!navigator.onLine) {
      companionInteractionQueueRef.current = [];
      setNotice(
        "这次互动已保留在状态记录中；离线时不会调用模型，联网后下一次互动再回应。",
      );
      return;
    }

    const now = Date.now();
    companionReplyTimesRef.current = companionReplyTimesRef.current.filter(
      (timestamp) =>
        now - timestamp < COMPANION_INTERACTION_RATE_WINDOW_MS,
    );
    if (
      companionReplyTimesRef.current.length >=
      COMPANION_INTERACTION_RATE_LIMIT
    ) {
      const oldest = companionReplyTimesRef.current[0];
      const waitFor = Math.max(
        500,
        COMPANION_INTERACTION_RATE_WINDOW_MS - (now - oldest) + 100,
      );
      setNotice("互动都收到了，我会把连续的靠近合在一起回应。");
      scheduleCompanionInteraction(waitFor);
      return;
    }

    if (!(await flushLatestSettingsDraft())) {
      setNotice(
        "互动已经记下了，但最新角色设置还没有保存成功；恢复网络后再碰一下，我会按新设置回应。",
      );
      return;
    }

    await refreshDeviceActivityContext({ silent: true });

    const interaction = companionInteractionQueueRef.current.shift();
    // The model reacts from before this batch; optimistic revisions only guard
    // the UI against responses that finish after a newer local interaction.
    const requestCompanionStatus = companionStatusForRequest(
      interaction.preInteractionStatus || companionStatusRef.current,
    );
    const responseBaseRevision = Math.min(
      Number.MAX_SAFE_INTEGER,
      requestCompanionStatus.revision + interaction.burstCount,
    );
    companionInteractionInFlightRef.current = true;
    setIsCompanionResponding(true);
    setNotice("");

    let sessionId = interaction.sessionId || activeSessionIdRef.current;
    const localAssistantId = `local-interaction-${Date.now()}`;

    try {
      if (!sessionId) {
        const created = await apiRequest("/api/v2/sessions", {
          method: "POST",
          body: JSON.stringify({
            title: `和${effectiveAiName}的互动`,
          }),
        });
        sessionId = created.session.id;
        setSessions((current) =>
          current.some((item) => item.id === sessionId)
            ? current
            : [created.session, ...current],
        );
        if (!activeSessionIdRef.current) {
          moveSessionDraft(null, sessionId);
          activeSessionIdRef.current = sessionId;
          messagesSessionIdRef.current = sessionId;
          setActiveSessionId(sessionId);
        }
        initializeSessionChatModel(sessionId);
      }

      streamingSessionIdRef.current = sessionId;
      if (activeSessionIdRef.current === sessionId) {
        const messagesBelongToSession =
          messagesSessionIdRef.current === sessionId;
        messageLoadTokenRef.current += 1;
        messagesSessionIdRef.current = sessionId;
        setMessages((current) => [
          ...(messagesBelongToSession ? current : []),
          {
            id: localAssistantId,
            role: "assistant",
            content: "正在感受刚才的互动…",
            created_at: new Date().toISOString(),
            isStreaming: true,
          },
        ]);
      }

      companionReplyTimesRef.current.push(Date.now());
      const data = await apiRequest("/companion/interact", {
        method: "POST",
        body: JSON.stringify({
          event_id: interaction.eventId,
          session_id: sessionId,
          interaction_type: interaction.interactionType,
          interaction_count: interaction.interactionCount,
          burst_count: interaction.burstCount,
          streak_count: interaction.streakCount,
          interaction_counts: interaction.interactionCounts,
          batch_counts: interaction.batchCounts,
          recent_sequence: interaction.recentSequence,
          client_time: shanghaiClientTime(),
          timezone: SHANGHAI_TIME_ZONE,
          model:
            readStoredSessionChatModel(sessionId) ||
            (sessionId === activeSessionIdRef.current
              ? selectedChatModel
              : "") ||
            settings.model ||
            "",
          companion_status: requestCompanionStatus,
          environment_context: environmentContextRef.current,
        }),
        timeoutMs: 60 * 1000,
      });

      if (data.companion_status) {
        setCompanionStatus((current) =>
          mergeCompanionStatus(current, data.companion_status, {
            baseRevision: responseBaseRevision,
          }),
        );
      }

      const assistantMessage = data?.assistant_message;
      if (
        !assistantMessage ||
        assistantMessage.role !== "assistant" ||
        typeof assistantMessage.content !== "string" ||
        !assistantMessage.content.trim()
      ) {
        throw new Error("服务器没有返回可保存的互动回复，请稍后再试。");
      }

      if (voiceAutoSpeakEnabled) {
        void playAssistantReply(
          assistantMessage.content,
          assistantMessage.id,
          assistantMessage.speech_token,
          sessionId,
        );
      }

      if (activeSessionIdRef.current === sessionId) {
        const messagesBelongToSession =
          messagesSessionIdRef.current === sessionId;
        messageLoadTokenRef.current += 1;
        messagesSessionIdRef.current = sessionId;
        setMessages((current) => {
          const currentSessionMessages = messagesBelongToSession ? current : [];
          if (
            currentSessionMessages.some(
              (item) => item.id === localAssistantId,
            )
          ) {
            return currentSessionMessages.map((item) =>
              item.id === localAssistantId ? assistantMessage : item,
            );
          }
          if (
            currentSessionMessages.some(
              (item) => item.id === assistantMessage.id,
            )
          ) {
            return currentSessionMessages;
          }
          return [...currentSessionMessages, assistantMessage];
        });
      }

      await refreshSessions(activeSessionIdRef.current || sessionId);
      void refreshComposerHint(sessionId);
    } catch (error) {
      if (activeSessionIdRef.current === sessionId) {
        messageLoadTokenRef.current += 1;
        setMessages((current) =>
          current.filter((item) => item.id !== localAssistantId),
        );
      }
      setNotice(
        error.message ||
          "这次互动已经记下，但刚才没连上模型；不会自动重复请求。",
      );
    } finally {
      if (streamingSessionIdRef.current === sessionId) {
        streamingSessionIdRef.current = null;
      }
      companionInteractionInFlightRef.current = false;
      setIsCompanionResponding(false);
      if (activeSessionIdRef.current === sessionId) {
        void syncDisplayedMessages(sessionId).catch((error) => {
          console.warn("互动后刷新聊天记录失败：", error.message);
        });
      }

      const next = companionInteractionQueueRef.current[0];
      if (next) {
        const elapsed = Date.now() - next.lastClickedAt;
        scheduleCompanionInteraction(
          Math.max(250, COMPANION_INTERACTION_DEBOUNCE_MS - elapsed),
        );
      }
    }
  }

  async function selectChatAttachments(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    try {
      const blockedAudioFiles = voiceServiceAvailable
        ? []
        : files.filter((file) => attachmentKind(file) === "audio");
      const selectableFiles = voiceServiceAvailable
        ? files
        : files.filter((file) => attachmentKind(file) !== "audio");
      const checked = validateAttachmentFiles(
        chatAttachmentsRef.current,
        selectableFiles,
      );
      const preparedFiles = [];
      const warnings = [];
      for (const file of checked.accepted) {
        const prepared = await prepareChatAttachmentFile(file);
        preparedFiles.push(prepared.file);
        if (prepared.warning) warnings.push(prepared.warning);
      }
      const drafts = preparedFiles.map((file) => createAttachmentDraft(file));
      const next = [...chatAttachmentsRef.current, ...drafts];
      chatAttachmentsRef.current = next;
      setChatAttachments(next);

      const messages = [
        ...(blockedAudioFiles.length > 0 ? [voiceService.message] : []),
        ...checked.rejected,
        ...warnings,
      ];
      setNotice(messages.join("；"));
    } catch (error) {
      setNotice(error.message || "附件处理失败，请换一个文件重试。");
    }
  }

  function removeChatAttachment(id) {
    const removed = chatAttachmentsRef.current.find((item) => item.id === id);
    if (removed) revokeAttachmentDraft(removed);
    const next = chatAttachmentsRef.current.filter((item) => item.id !== id);
    chatAttachmentsRef.current = next;
    setChatAttachments(next);
    if (next.length === 0) setAttachmentSafetyEnabled(true);
  }

  function selectChatModel(value) {
    const sessionId = activeSessionIdRef.current;
    const previousModel = readStoredSessionChatModel(sessionId);
    const model = storeSessionChatModel(sessionId, value);
    setSelectedChatModel(model);
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? { ...session, model_id: model }
          : session,
      ),
    );
    if (!sessionId || !model) return;

    const saveOperation = sessionModelSaveQueueRef.current
      .catch(() => {})
      .then(() =>
        apiRequest(`/api/v2/sessions/${sessionId}`, {
          method: "PATCH",
          body: JSON.stringify({ model_id: model }),
        }),
      );
    sessionModelSaveQueueRef.current = saveOperation.catch(() => {});
    void saveOperation
      .then((data) => {
        const savedModel = data.session?.model_id || model;
        if (readStoredSessionChatModel(sessionId) !== model) return;
        storeSessionChatModel(sessionId, savedModel);
        if (activeSessionIdRef.current === sessionId) {
          setSelectedChatModel(savedModel);
        }
        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId ? data.session : session,
          ),
        );
      })
      .catch((error) => {
        if (readStoredSessionChatModel(sessionId) !== model) return;
        storeSessionChatModel(sessionId, previousModel);
        if (activeSessionIdRef.current === sessionId) {
          setSelectedChatModel(previousModel);
        }
        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? { ...session, model_id: previousModel || null }
              : session,
          ),
        );
        setNotice(
          `${error.message || "会话模型保存失败。"} 已恢复之前的模型。`,
        );
      });
  }

  function initializeSessionChatModel(sessionId, serverModel = "") {
    const migratedModel = migrateLegacyChatModelToSession(
      sessionId,
      globalThis.localStorage,
      accountStorageScope,
    );
    const model = serverModel || migratedModel || settings.model || "";
    if (model) storeSessionChatModel(sessionId, model);
    return model;
  }

  function selectMessageForReference(item) {
    const reference = createMessageReference(item);
    if (!reference) return;
    setMessageReference(reference);
    closeComposerMenu();
    requestStatusPanelClose();
    window.requestAnimationFrame(() => messageInputRef.current?.focus());
  }

  async function sendMessage() {
    const options =
      arguments[0] && typeof arguments[0] === "object" ? arguments[0] : {};
    const preserveComposer = options?.preserveComposer === true;
    const text = String(options?.text ?? message).trim();
    const turnContextDraftAtRequest = String(
      options?.turnContext ?? turnContextRef.current,
    );
    const turnContextSnapshot = turnContextDraftAtRequest
      .trim()
      ;
    const messageReferenceAtRequest = normalizeMessageReference(
      options?.messageReference ?? messageReference,
    );
    const attachmentsToSend = Array.isArray(options?.attachments)
      ? [...options.attachments]
      : [...chatAttachmentsRef.current];
    const attachmentInstructionMode =
      options?.attachmentInstructionMode === "system"
        ? "system"
        : options?.attachmentInstructionMode === "untrusted"
          ? "untrusted"
          : attachmentSafetyEnabled
            ? "untrusted"
            : "system";
    const attachmentStorageMode =
      options?.attachmentStorageMode === "ephemeral"
        ? "ephemeral"
        : "persistent";
    if (
      (!text && attachmentsToSend.length === 0) ||
      isSendingRef.current ||
      companionInteractionInFlightRef.current ||
      voiceBlocksComposer(voiceStateRef.current)
    ) {
      return;
    }

    isSendingRef.current = true;
    setIsSending(true);
    const startingSessionId = activeSessionIdRef.current;
    abortChatRequest(chatRequestRef, "replaced");
    const request = {
      controller: new AbortController(),
      attachments: preserveComposer ? attachmentsToSend : [],
      attachmentsReleased: false,
      cancelReason: "",
    };
    chatRequestRef.current = request;
    const deviceActivityRefresh = refreshDeviceActivityContext({ silent: true });
    try {
      setSendPreparationStage("settings");
      if (!(await awaitChatPreparation(flushLatestSettingsDraft, request.controller.signal))) {
        throw Object.assign(new Error("发送前设置未保存"), { code: "chat_preparation_settings_unsaved" });
      }
      if (startingSessionId) {
        setSendPreparationStage("model");
        await awaitChatPreparation(() => sessionModelSaveQueueRef.current, request.controller.signal);
      }
      if (request.controller.signal.aborted || chatRequestRef.current !== request ||
          !componentMountedRef.current || activeSessionIdRef.current !== startingSessionId) {
        throw new DOMException("发送准备已取消", "AbortError");
      }
    } catch (error) {
      if (preserveComposer) releaseChatRequestAttachments(request);
      if (chatRequestRef.current === request) {
        chatRequestRef.current = null;
        isSendingRef.current = false;
        if (componentMountedRef.current) {
          setIsSending(false);
          setSendPreparationStage("");
          setNotice(error?.name === "AbortError"
            ? `发送准备已停止，本轮尚未发送。${preserveComposer ? "临时画面已释放。" : "文字和附件仍保留在输入框中。"}`
            : error?.code === "chat_preparation_settings_unsaved"
              ? "最新角色设置还没有保存成功，这条消息没有发送。请恢复网络后重试。（Code: chat_preparation_settings_unsaved）"
              : "最新设置或模型未确认，本轮没有发送，请检查设置保存状态后重试。（Code: chat_preparation_failed）");
        }
      }
      return;
    }
    setSendPreparationStage("");
    request.attachments = attachmentsToSend;
    request.attachmentsReleased = false;

    if (voiceStateRef.current === VOICE_STATES.speaking) {
      void stopVoicePlayback();
    }

    if (!preserveComposer) {
      setMessage("");
      setMessageReference(null);
      chatAttachmentsRef.current = [];
      setChatAttachments([]);
      setAttachmentSafetyEnabled(true);
    }
    setNotice("");

    let sessionId = startingSessionId;
    let localUserId = `local-user-${Date.now()}`;
    let localAssistantId = `local-assistant-${Date.now()}`;
    let sendSucceeded = false;
    let streamFailed = false;
    let userMessageCommitted = false;
    let generationInProgress = false;
    let completedUserMessageId = "";
    let completedAssistantMessageId = "";
    streamThinkingRef.current = {
      statuses: appendThinkingStatus([], "preparing_request"),
      summary: "",
      lastReasoningSource: "",
    };

    try {
      if (!sessionId) {
        const created = await apiRequest("/api/v2/sessions", {
          method: "POST",
          body: JSON.stringify({
            title: (text || attachmentsToSend[0]?.name || "附件对话").slice(
              0,
              30,
            ),
          }),
          signal: request.controller.signal,
        });
        sessionId = created.session.id;
        activeSessionIdRef.current = sessionId;
        moveSessionDraft(null, sessionId);
        messagesSessionIdRef.current = sessionId;
        streamingSessionIdRef.current = sessionId;
        setSessions((current) => [created.session, ...current]);
        setActiveSessionId(sessionId);
        initializeSessionChatModel(sessionId, created.session.model_id);
      }

      const clientMessage = resolveChatClientMessage(
        pendingChatClientMessageRef.current,
        {
          sessionId,
          message: text,
          turnContext: turnContextSnapshot,
          messageReference: messageReferenceAtRequest,
          attachments: attachmentsToSend,
          attachmentInstructionMode,
          attachmentStorageMode,
        },
      );
      userMessageCommitted = clientMessage.userMessageCommitted === true;
      if (clientMessage.reused) {
        localUserId =
          clientMessage.userMessageId ||
          clientMessage.localUserId ||
          localUserId;
        localAssistantId = clientMessage.localAssistantId || localAssistantId;
      }
      pendingChatClientMessageRef.current = {
        ...clientMessage,
        localUserId,
        localAssistantId,
        generationInProgress: false,
      };
      request.clientMessageId = clientMessage.clientMessageId;

      streamingSessionIdRef.current = sessionId;
      messageLoadTokenRef.current += 1;
      messagesSessionIdRef.current = sessionId;

      setMessages((current) => {
        const next = [...current];
        const hasUserMessage = next.some(
          (item) =>
            item.id === localUserId ||
            item.id === clientMessage.userMessageId,
        );
        if (!hasUserMessage) {
          next.push(
            attachMessageReference(
              {
                id: localUserId,
                role: "user",
                content: text || "（发送了附件）",
                attachments: draftsForLocalMessage(attachmentsToSend),
                tool_calls:
                  attachmentInstructionMode === "system" ||
                  attachmentStorageMode === "ephemeral"
                    ? {
                        ...(attachmentInstructionMode === "system"
                          ? { attachment_instruction_mode: "system" }
                          : {}),
                        ...(attachmentStorageMode === "ephemeral"
                          ? { ephemeral_visual: true }
                          : {}),
                      }
                    : undefined,
                created_at: new Date().toISOString(),
              },
              messageReferenceAtRequest,
            ),
          );
        }

        const assistantDraft = {
          id: localAssistantId,
          role: "assistant",
          conversation_id: sessionId,
          content: "",
          created_at: new Date().toISOString(),
          isStreaming: true,
          generationInProgress: false,
          retryAvailable: false,
          thinkingStatuses: appendThinkingStatus([], "preparing_request"),
          visibleMonologue: beginVisibleMonologueStream(),
        };
        const assistantIndex = next.findIndex(
          (item) => item.id === localAssistantId,
        );
        if (assistantIndex >= 0) {
          next[assistantIndex] = {
            ...next[assistantIndex],
            ...assistantDraft,
          };
        } else {
          next.push(assistantDraft);
        }
        return next;
      });

      // Device context refresh is optional; an unresponsive native plugin must not hold the message.
      await Promise.race([
        deviceActivityRefresh,
        new Promise((resolve) => window.setTimeout(resolve, 250)),
      ]);

      await streamChat(
        {
          session_id: sessionId,
          message: text,
          client_time: shanghaiClientTime(),
          timezone: SHANGHAI_TIME_ZONE,
          emotion_understanding_enabled: emotionUnderstandingEnabled,
          attachment_instruction_mode: attachmentInstructionMode,
          attachment_storage_mode: attachmentStorageMode,
          companion_status: companionStatusForRequest(companionStatus),
          environment_context: environmentContextRef.current,
          turn_context: turnContextSnapshot,
          message_reference: messageReferenceAtRequest,
          files: attachmentsToSend,
          client_message_id: request.clientMessageId,
        },
        (event) => {
          if (
            request.controller.signal.aborted ||
            chatRequestRef.current !== request
          ) {
            return;
          }
          if (activeSessionIdRef.current !== sessionId) return;

          if (event.type === "meta" && event.user_message) {
            userMessageCommitted = true;
            completedUserMessageId = event.user_message.id;
            if (messageReferenceAtRequest) {
              storeMessageReferenceForMessage(
                sessionId,
                completedUserMessageId,
                messageReferenceAtRequest,
              );
            }
            pendingChatClientMessageRef.current = updateChatClientMessage(
              pendingChatClientMessageRef.current,
              request.clientMessageId,
              {
                userMessageCommitted: true,
                userMessageId: event.user_message.id,
                localUserId,
                localAssistantId,
              },
            );
            setMessages((current) =>
              current.map((item) =>
                item.id === localUserId
                  ? attachMessageReference(
                      {
                        ...event.user_message,
                        attachments:
                          event.user_message.attachments || item.attachments,
                        tool_calls: {
                          ...(item.tool_calls || {}),
                          ...(event.user_message.tool_calls || {}),
                        },
                      },
                      messageReferenceAtRequest,
                    )
                  : item,
              ),
            );
          }

          if (event.type === "status") {
            const statuses = appendThinkingStatus(
              streamThinkingRef.current.statuses,
              event.content || event.status || event.stage,
            );
            streamThinkingRef.current.statuses = statuses;
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? { ...item, thinkingStatuses: statuses }
                  : item,
              ),
            );
          }

          if (event.type === "monologue") {
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? {
                      ...item,
                      visibleMonologue: reduceVisibleMonologueEvent(
                        item.visibleMonologue,
                        event,
                      ),
                    }
                  : item,
              ),
            );
          }

          if (event.type === "text") {
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? { ...item, content: item.content + event.content }
                  : item,
              ),
            );
          }

          if (event.type === "error") {
            const eventGenerationInProgress =
              isChatGenerationInProgress(event);
            const eventErrorMessage = publicChatErrorMessage(
              event,
              "模型服务暂时无法完成这次回复，请稍后重试。",
            );
            generationInProgress =
              generationInProgress || eventGenerationInProgress;
            if (event.user_message_committed === true) {
              userMessageCommitted = true;
              pendingChatClientMessageRef.current = updateChatClientMessage(
                pendingChatClientMessageRef.current,
                request.clientMessageId,
                { userMessageCommitted: true },
              );
            }
            streamFailed = true;
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? {
                      ...item,
                      content: eventGenerationInProgress
                        ? "这条消息已经保存，AI 仍在服务器处理中。"
                        : eventErrorMessage,
                      partialContent: temporaryReplyOnFailure(item, event),
                      isStreaming: false,
                      chatError: true,
                      generationInProgress: eventGenerationInProgress,
                      retryAvailable: true,
                      visibleMonologue: reduceVisibleMonologueEvent(
                        item.visibleMonologue,
                        {
                          type: "monologue",
                          phase: "end",
                          source: VISIBLE_MONOLOGUE_SOURCE,
                          state: "failed",
                        },
                      ),
                      thinkingStatuses: eventGenerationInProgress
                        ? appendThinkingStatus(
                            streamThinkingRef.current.statuses,
                            "generation_in_progress",
                          )
                        : streamThinkingRef.current.statuses,
                    }
                  : item,
              ),
            );
          }

          if (event.type === "done") {
            if (event.ok === false || streamFailed) {
              streamFailed = true;
              return;
            }
            pendingChatClientMessageRef.current = clearChatClientMessage(
              pendingChatClientMessageRef.current,
              request.clientMessageId,
            );
            completedAssistantMessageId =
              event.assistant_message?.id || localAssistantId;
            applyPromptReceipt(event.prompt_receipt);
            if (event.companion_status) {
              setCompanionStatus((current) =>
                mergeCompanionStatus(current, event.companion_status),
              );
            }
            setMessages((current) =>
              current.map((item) =>
                item.id === localAssistantId
                  ? mergeStreamedAssistantMessage(
                      item,
                      event.assistant_message,
                      streamThinkingRef.current,
                    )
                  : item,
              ),
            );
            const activity = normalizeCompanionActivities(event.assistant_message?.tool_calls?.activity_actions).find(action => action.kind !== "bilibili");
            if (activity) openCompanionActivity(activity);
            if (
              voiceAutoSpeakEnabled &&
              event.assistant_message?.content
            ) {
              void playAssistantReply(
                event.assistant_message.content,
                event.assistant_message.id,
                event.assistant_message.speech_token,
                sessionId,
              );
            }
          }
        },
        { signal: request.controller.signal },
      );

      if (streamFailed) {
        const error = new Error(
          generationInProgress
            ? "这条消息已经保存，AI 仍在服务器处理中。"
            : userMessageCommitted
            ? "AI 回复失败，但你的消息已经保存。"
            : "回复没有成功保存，附件仍保留，可稍后重试。",
        );
        error.userMessageCommitted = userMessageCommitted;
        if (generationInProgress) {
          error.code = "CHAT_GENERATION_IN_PROGRESS";
          error.generationInProgress = true;
        }
        throw error;
      }
      sendSucceeded = true;
      void refreshFunLabs();
      if (
        !preserveComposer &&
        turnContextSnapshot &&
        turnContextRef.current === turnContextDraftAtRequest
      ) {
        turnContextRef.current = "";
        setTurnContext("");
      }
      pendingChatClientMessageRef.current = clearChatClientMessage(
        pendingChatClientMessageRef.current,
        request.clientMessageId,
      );
      releaseChatRequestAttachments(request);
      if (chatRequestRef.current === request) {
        chatRequestRef.current = null;
      }

      const history = await apiRequest(
        `/api/v2/sessions/${sessionId}/messages`,
      );
      if (activeSessionIdRef.current === sessionId) {
        messageLoadTokenRef.current += 1;
        messagesSessionIdRef.current = sessionId;
        const hydratedMessages = hydrateSessionChatHistory(
          history.messages,
          sessionId,
        );
        setMessages(
          hydratedMessages.map((item) =>
            item.id === completedAssistantMessageId
              ? attachThinkingTrace(item, streamThinkingRef.current)
              : item,
          ),
        );
      }
      await refreshSessions(activeSessionIdRef.current || sessionId);
      void refreshComposerHint(sessionId);
    } catch (error) {
      const publicErrorMessage = publicChatErrorMessage(
        error,
        "回复暂时中断，请稍后重试。",
      );
      if (sendSucceeded) {
        if (componentMountedRef.current) {
          setNotice(
            `AI 回复已经保存，但刷新聊天记录失败：${publicErrorMessage}`,
          );
        }
        return;
      }
      const requestWasAborted = request.controller.signal.aborted;
      const userMessageWasCommitted =
        userMessageCommitted || error?.userMessageCommitted === true;
      const generationStillInProgress =
        generationInProgress ||
        error?.generationInProgress === true ||
        isChatGenerationInProgress(error);
      const restoreDraft =
        !preserveComposer &&
        shouldRestoreAttachmentDrafts({
          requestWasAborted,
          cancelReason: request.cancelReason,
        });
      if (restoreDraft) {
        pendingChatClientMessageRef.current = updateChatClientMessage(
          pendingChatClientMessageRef.current,
          request.clientMessageId,
          {
            userMessageCommitted: userMessageWasCommitted,
            generationInProgress: generationStillInProgress,
            localUserId,
            localAssistantId,
          },
        );
      } else {
        pendingChatClientMessageRef.current = clearChatClientMessage(
          pendingChatClientMessageRef.current,
          request.clientMessageId,
        );
      }
      if (!componentMountedRef.current) {
        releaseChatRequestAttachments(request);
        return;
      }

      if (requestWasAborted) {
        if (sendSucceeded) {
          releaseChatRequestAttachments(request);
          return;
        }
        if (restoreDraft) {
          if (messageReferenceAtRequest) {
            setMessageReference(
              (current) => current || messageReferenceAtRequest,
            );
          }
          if (text) {
            setSessionDraft(sessionId, (current) =>
              restoreChatRetryText(current, text),
            );
          }
          const restored = restoreAttachmentDrafts(
            attachmentsToSend,
            chatAttachmentsRef.current,
          );
          chatAttachmentsRef.current = restored;
          setChatAttachments(restored);
          setAttachmentSafetyEnabled(attachmentInstructionMode !== "system");
        } else {
          releaseChatRequestAttachments(request);
        }
        setMessages((current) =>
          current.filter(
            (item) => item.id !== localUserId && item.id !== localAssistantId,
          ),
        );
        if (restoreDraft) {
          setNotice("发送已取消，文字和附件已保留，可以返回聊天页后重试。");
        }
        return;
      }

      const retryGuidance = preserveComposer
        ? userMessageWasCommitted
          ? "这次屏幕画面消息已经保存；原图不会在本机长期保留。"
          : "这次屏幕画面没有确认保存，原图已从临时缓存清除。"
        : generationStillInProgress
          ? "这条消息正在服务器处理中，文字和附件已保留。稍后点“检查进度”即可继续使用同一条消息。"
          : userMessageWasCommitted
            ? `你的消息${
                attachmentsToSend.length > 0 ? "和附件" : ""
              }已经保存。文字和附件仍保留，点“重试”会继续生成，不会重复保存。`
            : "本轮没有确认保存，文字和附件已保留，可以直接点“重试”。";
      setNotice(`${publicErrorMessage} ${retryGuidance}`);
      if (!sendSucceeded) {
        if (restoreDraft) {
          if (messageReferenceAtRequest) {
            setMessageReference(
              (current) => current || messageReferenceAtRequest,
            );
          }
          if (text) {
            setSessionDraft(sessionId, (current) =>
              restoreChatRetryText(current, text),
            );
          }
          const restored = restoreAttachmentDrafts(
            attachmentsToSend,
            chatAttachmentsRef.current,
          );
          chatAttachmentsRef.current = restored;
          setChatAttachments(restored);
          setAttachmentSafetyEnabled(attachmentInstructionMode !== "system");
        } else {
          releaseChatRequestAttachments(request);
        }
        setMessages((current) =>
          current.map((item) =>
            item.id === localAssistantId
              ? {
                  ...item,
                  content:
                    (generationStillInProgress
                      ? "这条消息已经保存，AI 仍在服务器处理中。稍后可以直接检查进度。"
                      : `${publicErrorMessage}\n\n${retryGuidance}`) ||
                    "连接暂时中断了，请检查后端后再试一次。",
                  isStreaming: false,
                  chatError: true,
                  error_code: error?.code || 'CHAT_REQUEST_FAILED',
                  partialContent: temporaryReplyOnFailure(item, error),
                  error_location: error?.error_location || '',
                  error_log_id: error?.error_log_id || '',
                  error_source: error?.error_source || '',
                  provider_code: error?.provider_code || '',
                  provider_phase: error?.provider_phase || '',
                  upstream_status: error?.upstream_status,
                  error_time: new Date().toISOString(),
                  generationInProgress: generationStillInProgress,
                  retryAvailable: restoreDraft,
                  visibleMonologue: reduceVisibleMonologueEvent(
                    item.visibleMonologue,
                    {
                      type: "monologue",
                      phase: "end",
                      source: VISIBLE_MONOLOGUE_SOURCE,
                      state: "failed",
                    },
                  ),
                  thinkingStatuses: generationStillInProgress
                    ? appendThinkingStatus(
                        item.thinkingStatuses ||
                          streamThinkingRef.current.statuses,
                        "generation_in_progress",
                      )
                    : item.thinkingStatuses,
                }
              : item,
          ),
        );
      }
    } finally {
      if (sendSucceeded) {
        releaseChatRequestAttachments(request);
      }
      if (chatRequestRef.current === request) {
        chatRequestRef.current = null;
      }
      if (streamingSessionIdRef.current === sessionId) {
        streamingSessionIdRef.current = null;
      }
      isSendingRef.current = false;
      if (componentMountedRef.current) setIsSending(false);
      if (
        componentMountedRef.current &&
        companionInteractionQueueRef.current.length > 0
      ) {
        scheduleCompanionInteraction(250);
      }
    }
  }

  sendMessageRef.current = sendMessage;

  function scheduleSettingsAutosave(value, { immediate = false } = {}) {
    if (!hasLoadedSettingsRef.current) {
      setNotice(
        "服务器设置尚未加载成功。为防止覆盖现有模型和接口配置，请先恢复网络并重新打开 App。",
      );
      return;
    }

    const draftRevision = Symbol("pending-settings-draft");
    window.clearTimeout(settingsSaveRetryTimerRef.current);
    settingsSaveRetryTimerRef.current = null;
    settingsSaveRetryCountRef.current = 0;
    settingsSaveFailureRef.current = false;
    latestDraftFingerprintRef.current = draftRevision;
    pendingSettingsSaveRef.current = null;
    window.clearTimeout(settingsAutosaveTimerRef.current);
    settingsAutosaveTimerRef.current = null;

    setSettingsAutosaveState("pending");
    setSettingsSaveError("");
    setSettingsSaveReceipt(null);

    const enqueue = () => {
      settingsAutosaveTimerRef.current = null;
      if (!componentMountedRef.current || latestDraftFingerprintRef.current !== draftRevision) return;
      const payload = createSettingsPayload(value);
      const fingerprint = settingsPayloadFingerprint(payload);
      latestDraftFingerprintRef.current = fingerprint;
      if (
        fingerprint === lastSavedSettingsFingerprintRef.current &&
        !settingsSaveInFlightRef.current &&
        !settingsSaveFailureRef.current
      ) {
        pendingSettingsSaveRef.current = null;
        window.clearTimeout(settingsSaveRetryTimerRef.current);
        settingsSaveRetryTimerRef.current = null;
        setSettingsAutosaveState("saved");
        return;
      }
      pendingSettingsSaveRef.current = { payload, fingerprint };
      void flushSettingsSaveQueue();
    };

    if (immediate) {
      enqueue();
      return;
    }

    settingsAutosaveTimerRef.current = window.setTimeout(enqueue, 800);
  }

  function flushSettingsSaveQueue() {
    if (!componentMountedRef.current || !hasLoadedSettingsRef.current) return Promise.resolve(false);
    if (settingsSaveRunRef.current) return settingsSaveRunRef.current;
    if (!pendingSettingsSaveRef.current) {
      return Promise.resolve(
        latestDraftFingerprintRef.current ===
          lastSavedSettingsFingerprintRef.current,
      );
    }

    let pausedForOnlineRetry = false;
    const run = (async () => {
      while (pendingSettingsSaveRef.current) {
        const queued = pendingSettingsSaveRef.current;
        pendingSettingsSaveRef.current = null;
        settingsSaveInFlightRef.current = true;
        const controller = settingsScopeControllerRef.current;
        settingsWriteRevisionRef.current++;
        setSettingsAutosaveState("saving");
        if (!settingsSaveFailureRef.current) {
          setSettingsSaveError("");
        }

        try {
          const requestBody = JSON.stringify(queued.payload);
          const keepalive =
            queued.keepalive === true &&
            new TextEncoder().encode(requestBody).byteLength <= 60 * 1024;
          const data = await apiRequest("/api/v2/settings", {
            method: "PUT",
            body: requestBody,
            keepalive,
            signal: controller.signal,
            authSession: createScopedSettingsSession(authSession, privateMediaScope, controller.signal),
          });
          if (!componentMountedRef.current || controller.signal.aborted) return false;
          const nextSettings = normalizeSettingsDraft(data.settings);
          const savedFingerprint = settingsPayloadFingerprint(nextSettings);
          const previousSettings = confirmedSettingsRef.current;
          const connectionChanged =
            previousSettings.provider !== nextSettings.provider ||
            previousSettings.api_url !== nextSettings.api_url ||
            previousSettings.model !== nextSettings.model;

          confirmedSettingsRef.current = nextSettings;
          lastSavedSettingsFingerprintRef.current = savedFingerprint;
          window.clearTimeout(settingsSaveRetryTimerRef.current);
          settingsSaveRetryTimerRef.current = null;
          settingsSaveRetryCountRef.current = 0;
          settingsSaveFailureRef.current = false;
          setSettings(nextSettings);
          setSettingsSaveError("");

          if (latestDraftFingerprintRef.current === queued.fingerprint) {
            draftSettingsRef.current = nextSettings;
            latestDraftFingerprintRef.current = savedFingerprint;
            setDraftSettings(nextSettings);
            setSettingsAutosaveState("saved");
          } else {
            setSettingsAutosaveState("pending");
          }

          const receipt = {
            customInstructionsLength:
              nextSettings.unified_system_prompt.length,
            userDetailsLength: nextSettings.user_details.length,
            promptMode: nextSettings.prompt_mode,
            intimateExpressionEnabled:
              nextSettings.intimate_expression_enabled === true,
          };
          setSettingsSaveReceipt(receipt);

          if (connectionChanged) {
            try {
              const modelsData = await apiRequest("/models", {
                signal: controller.signal,
                authSession: createScopedSettingsSession(authSession, privateMediaScope, controller.signal),
              });
              if (!componentMountedRef.current || controller.signal.aborted) return false;
              const catalog = reconcileModelCatalog(modelsData, {
                previous: readStoredSessionChatModel(
                  activeSessionIdRef.current,
                ),
                fallback: nextSettings.model,
              });
              setAvailableModels(catalog.models);
              setSelectedChatModel(
                chooseChatModel({
                  models: catalog.models,
                  stored: readStoredSessionChatModel(
                    activeSessionIdRef.current,
                  ),
                  current: nextSettings.model,
                  fallback: catalog.currentModel,
                }),
              );
              setModelsLoadMessage("");
            } catch {
              if (!componentMountedRef.current || controller.signal.aborted) return false;
              setModelsLoadMessage(
                "设置已保存，但新的模型列表暂时无法读取。重新打开 App 后会再次加载。",
              );
            }
          }
        } catch (error) {
          if (!componentMountedRef.current || controller.signal.aborted) return false;
          settingsSaveFailureRef.current = true;
          if (latestDraftFingerprintRef.current === queued.fingerprint) {
            pendingSettingsSaveRef.current = pendingAutosaveAfterFailure(
              queued,
              pendingSettingsSaveRef.current,
            );
          }
          pausedForOnlineRetry = true;
          if (latestDraftFingerprintRef.current === queued.fingerprint) {
            setSettingsAutosaveState("error");
            setSettingsSaveError(error.message || "自动保存失败");
          } else {
            setSettingsAutosaveState("pending");
          }
          setNotice(error.message);
          scheduleSettingsSaveRetry();
          break;
        } finally {
          settingsSaveInFlightRef.current = false;
        }
      }

      return (
        latestDraftFingerprintRef.current ===
        lastSavedSettingsFingerprintRef.current
      );
    })();

    settingsSaveRunRef.current = run.finally(() => {
      settingsSaveRunRef.current = null;
      if (pendingSettingsSaveRef.current && !pausedForOnlineRetry) {
        void flushSettingsSaveQueue();
      }
    });
    return settingsSaveRunRef.current;
  }

  function scheduleSettingsSaveRetry() {
    if (
      !pendingSettingsSaveRef.current ||
      settingsSaveRetryTimerRef.current ||
      !navigator.onLine ||
      settingsSaveRetryCountRef.current >=
        SETTINGS_SAVE_RETRY_DELAYS_MS.length
    ) {
      return;
    }

    const delay =
      SETTINGS_SAVE_RETRY_DELAYS_MS[settingsSaveRetryCountRef.current];
    settingsSaveRetryCountRef.current += 1;
    settingsSaveRetryTimerRef.current = window.setTimeout(() => {
      settingsSaveRetryTimerRef.current = null;
      void flushSettingsSaveQueue();
    }, delay);
  }

  async function flushLatestSettingsDraft({ keepalive = false } = {}) {
    if (!hasLoadedSettingsRef.current) return true;

    const payload = createSettingsPayload(draftSettingsRef.current);
    const fingerprint = settingsPayloadFingerprint(payload);
    latestDraftFingerprintRef.current = fingerprint;
    window.clearTimeout(settingsAutosaveTimerRef.current);
    settingsAutosaveTimerRef.current = null;
    window.clearTimeout(settingsSaveRetryTimerRef.current);
    settingsSaveRetryTimerRef.current = null;

    if (
      fingerprint === lastSavedSettingsFingerprintRef.current &&
      !settingsSaveInFlightRef.current &&
      !settingsSaveFailureRef.current &&
      !pendingSettingsSaveRef.current
    ) {
      return true;
    }

    pendingSettingsSaveRef.current = { payload, fingerprint, keepalive };
    setSettingsAutosaveState("pending");
    const saved = await flushSettingsSaveQueue();
    return (
      saved &&
      fingerprint === lastSavedSettingsFingerprintRef.current
    );
  }

  flushLatestSettingsDraftRef.current = flushLatestSettingsDraft;

  function saveSettings(event) {
    event.preventDefault();
    scheduleSettingsAutosave(draftSettingsRef.current, { immediate: true });
  }

  function updateDraft(field, value) {
    if (settingsExitBusyRef.current) return;
    const nextDraft = {
      ...draftSettingsRef.current,
      [field]: value,
    };
    if (field === "provider") {
      nextDraft.reasoning_effort = reasoningEffortForProvider(
        value,
        nextDraft.reasoning_effort,
      );
    }
    draftSettingsRef.current = nextDraft;
    setSettingsSaveReceipt(null);
    setDraftSettings(nextDraft);
    scheduleSettingsAutosave(nextDraft);
  }

  async function setDeviceActivityEnabled(enabled) {
    if (!deviceActivityPluginAvailable() || isDeviceActivityBusy) return;
    setIsDeviceActivityBusy(true);
    try {
      const nextState = normalizeDeviceActivityState(
        await DeviceActivity.setEnabled({ enabled }),
      );
      setDeviceActivityState(nextState);
      if (!enabled) {
        deviceActivitySummaryRef.current = null;
        environmentContextRef.current = mergeDeviceActivityContext(
          ambientContextRef.current,
          null,
        );
        setDeviceActivityFeedback({
          status: "idle",
          message: "活动感知已关闭，后续对话不会附带 App 活动摘要。",
        });
      } else if (!nextState.permissionGranted) {
        setDeviceActivityFeedback({
          status: "checking",
          message: "开关已打开。请继续点“打开系统授权”并允许 DengTa home。",
        });
      } else {
        await refreshDeviceActivityContext({ force: true });
      }
    } catch (error) {
      setDeviceActivityFeedback({
        status: "error",
        message: error?.message || "活动感知开关暂时无法更改。",
      });
    } finally {
      setIsDeviceActivityBusy(false);
    }
  }

  async function openDeviceActivityPermission() {
    if (!deviceActivityPluginAvailable() || isDeviceActivityBusy) return;
    setIsDeviceActivityBusy(true);
    try {
      const nextState = normalizeDeviceActivityState(
        await DeviceActivity.setEnabled({ enabled: true }),
      );
      setDeviceActivityState(nextState);
      setDeviceActivityFeedback({
        status: "checking",
        message: "请在系统页允许 DengTa home；返回 App 后会自动检查。",
      });
      await DeviceActivity.openUsageAccessSettings();
    } catch (error) {
      setDeviceActivityFeedback({
        status: "error",
        message: error?.message || "无法打开系统使用情况访问授权页。",
      });
    } finally {
      setIsDeviceActivityBusy(false);
    }
  }

  async function clearDeviceActivity() {
    if (!deviceActivityPluginAvailable() || isDeviceActivityBusy) return;
    setIsDeviceActivityBusy(true);
    try {
      const nextState = normalizeDeviceActivityState(
        await DeviceActivity.clear(),
      );
      setDeviceActivityState(nextState);
      deviceActivitySummaryRef.current = null;
      environmentContextRef.current = mergeDeviceActivityContext(
        ambientContextRef.current,
        null,
      );
      setDeviceActivityFeedback({
        status: "idle",
        message: "本机活动感知状态已清除；系统授权可在 Android 设置中单独撤销。",
      });
    } catch (error) {
      setDeviceActivityFeedback({
        status: "error",
        message: error?.message || "暂时无法清除本机活动感知状态。",
      });
    } finally {
      setIsDeviceActivityBusy(false);
    }
  }

  const [takeoutLoginFeedback, setTakeoutLoginFeedback] = useState({
    status: "idle",
    message: "",
  });
  const [takeoutLoginState, setTakeoutLoginState] = useState({
    checked: false,
    loggedIn: false,
    hasCookie: false,
  });

  // 读取本机外卖登录态（WebView CookieStore），登录成功后显示"已登录"。
  async function refreshTakeoutLoginState() {
    const state = await readTakeoutLoginState().catch(() => ({
      loggedIn: false,
      hasCookie: false,
    }));
    setTakeoutLoginState({ checked: true, ...state });
    return state;
  }

  useEffect(() => {
    void refreshTakeoutLoginState();
    // 从内置浏览器返回后（可能刚登录完）自动刷新登录状态。
    const onResume = () => void refreshTakeoutLoginState();
    window.addEventListener("focus", onResume);
    return () => window.removeEventListener("focus", onResume);
  }, []);

  useEffect(() => {
    if (!takeoutPluginAvailable()) return undefined;
    setTakeoutLoginFeedback({ status: "idle", message: "" });
    return startTakeoutRunner({
      scope: diagnosticScopeKey(accountStorageScope, companionScope),
      onCommandDone: (_command, outcome) => setTakeoutLoginFeedback({
        status: outcome.ok && outcome.receipt_synced ? "success" : "error",
        message: outcome.message ? `${outcome.message}（代码：${outcome.code}）` : "外卖页面操作完成，结果已同步。请在外卖页面确认商品和支付。",
      }),
    });
  }, [accountStorageScope, companionScope]);
  const [xhsState, setXhsState] = useState({
    status: "idle",
    qr: "",
    session: "",
    feedback: "",
  });
  const xhsPollTimerRef = useRef(null);

  async function openTakeoutQrLogin(platformId = "eleme") {
    setTakeoutLoginFeedback({ status: "busy", message: "正在打开外卖登录页…" });
    const platform = TAKEOUT_PLATFORMS.find((item) => item.id === platformId) || TAKEOUT_PLATFORMS[0];
    const outcome = await openTakeoutLogin({ url: platform.url });
    if (outcome?.ok) {
      setTakeoutLoginFeedback({
        status: "success",
        message: `已打开${platform.label}登录页。登录成功后即可让 AI 帮你点单(登录态只保存在本机)。`,
      });
    } else {
      setTakeoutLoginFeedback({
        status: "error",
        message: outcome?.error || "暂时无法打开外卖登录页。",
      });
    }
  }

  async function startXhsQrLogin() {
    clearInterval(xhsPollTimerRef.current);
    setXhsState({
      status: "busy",
      qr: "",
      session: "",
      feedback: "正在生成登录二维码…",
    });
    try {
      const data = await startXhsLogin();
      const session = data?.login?.session || "";
      const qr = data?.login?.qr || "";
      if (!qr) {
        setXhsState({
          status: "error",
          qr: "",
          session: "",
          feedback:
            data?.login?.note || "小红书服务还没有部署，暂时无法登录。",
        });
        return;
      }
      setXhsState({
        status: "pending",
        qr,
        session,
        feedback: "请用小红书 App 扫码并确认登录",
      });
      xhsPollTimerRef.current = setInterval(async () => {
        try {
          const result = await readXhsLoginStatus(session);
          const loginStatus = result?.status?.status;
          if (loginStatus === "done") {
            clearInterval(xhsPollTimerRef.current);
            setXhsState((previous) => ({
              ...previous,
              status: "logged_in",
              qr: "",
              feedback: "小红书登录成功！AI 可以帮你刷帖、搜笔记了。",
            }));
          } else if (loginStatus === "expired") {
            clearInterval(xhsPollTimerRef.current);
            setXhsState((previous) => ({
              ...previous,
              status: "error",
              qr: "",
              feedback: "二维码已过期，请重新发起登录。",
            }));
          }
        } catch {
          // 轮询失败继续。
        }
      }, 3000);
    } catch (error) {
      setXhsState({
        status: "error",
        qr: "",
        session: "",
        feedback: error?.message || "无法发起小红书登录。",
      });
    }
  }

  // 内置浏览器登录小红书：登录态长住，登录后点「提取登录态」返回即可。
  async function connectXhsWithBrowser() {
    setXhsState({
      status: "busy",
      qr: "",
      session: "",
      feedback: "正在打开内置浏览器…",
    });
    try {
      const opened = await openBuiltInBrowser({
        url: "https://www.xiaohongshu.com/",
        title: "小红书（内置浏览器）",
        site: "xhs",
      });
      // 用系统返回键关闭也会走到这里：只要点过「提取登录态」，
      // 登录态已保存在本机，必须继续读取，不能因为返回方式而丢失。
      const saved = await readBrowserCookie("xhs");
      if (!saved.cookie) {
        setXhsState({
          status: "error",
          qr: "",
          session: "",
          feedback: opened.ok
            ? "没有提取到登录态。请重新打开，在页面里登录后点「提取登录态」，再返回。"
            : (opened.error || "无法打开内置浏览器。") +
              " 且没有提取到登录态，请重试。",
        });
        return;
      }
      const imported = await apiRequest("/api/v2/xhs/login/cookie", {
        method: "POST",
        timeoutMs: 20000,
        body: JSON.stringify({ cookie: saved.cookie }),
      }).catch(() => null);
      if (imported?.ok) {
        setXhsState({
          status: "logged_in",
          qr: "",
          session: "",
          feedback:
            imported.mode === "local"
              ? "小红书登录态已保存到账号（服务部署后就绪即可使用）。"
              : "小红书登录成功！AI 可以帮你刷帖、搜笔记了。",
        });
      } else {
        setXhsState({
          status: "error",
          qr: "",
          session: "",
          feedback: imported?.message || "登录态已提取，但保存失败，请重试。",
        });
      }
    } catch (error) {
      setXhsState({
        status: "error",
        qr: "",
        session: "",
        feedback: error?.message || "无法发起小红书登录。",
      });
    }
  }

  async function logoutXhsAccount() {
    try {
      await logoutXhs();
      setXhsState({
        status: "idle",
        qr: "",
        session: "",
        feedback: "已退出小红书登录。",
      });
    } catch {
      setXhsState((previous) => ({
        ...previous,
        feedback: "退出失败，请稍后再试。",
      }));
    }
  }

  useEffect(() => {
    let cancelled = false;
    void readXhsMe()
      .then(() => {
        if (!cancelled) {
          setXhsState((previous) => ({
            ...previous,
            status: "logged_in",
            feedback: "小红书已登录。",
          }));
        }
      })
      .catch(() => {
        // 未登录或服务未部署，保持默认。
      });
    return () => {
      cancelled = true;
      clearInterval(xhsPollTimerRef.current);
    };

  }, []);


  const funScope = JSON.stringify([accountStorageScope, companionScope]);
  const funToken = useMemo(() => ({ scope: funScope, requestId: 0 }), [funScope]);
  const funTokenRef = useRef(funToken);
  funTokenRef.current = funToken;
  const [funLabsSnapshot, setFunLabsState] = useState(emptyFunLabsState);
  const funLabsState = funLabsSnapshot.scope === funToken ? funLabsSnapshot : emptyFunLabsState();
  const [dateDeleteState, setDateDeleteState] = useState(null);
  const dateDeleteRef = useRef(null);
  const [guideRevision, setGuideRevision] = useState(0);
  const [guideOpenScope, setGuideOpenScope] = useState(null);
  const achievementMutationRef = useRef(null);
  const [achievementAction, setAchievementAction] = useState(null);
  const [customAchievement, setCustomAchievement] = useState({
    title: "",
    emoji: "",
    description: "",
  });
  const customAchievementSubmitRef = useRef(null);
  const [customAchievementBusyScope, setCustomAchievementBusyScope] = useState(null);
  const customAchievementBusy = customAchievementBusyScope === funToken;
  const customAchievementRecoveryRef = useRef(null);
  const [customAchievementRecoveryState, setCustomAchievementRecovery] = useState(null);
  const customAchievementRecovery = customAchievementRecoveryState?.scope === funToken ? customAchievementRecoveryState : null;

  const [coWatchDanmaku, setCoWatchDanmaku] = useState([]);
  const [discoverSnapshot, setDiscoverState] = useState(emptyDiscoveryState);
  const discoverState = discoverSnapshot.scope === funToken ? discoverSnapshot : emptyDiscoveryState();
  const discoverLockRef = useRef(null);
  const discoverControllerRef = useRef(null);
  const discoverFeedRef = useRef(null);
  useLayoutEffect(() => { discoverFeedRef.current = { scope: funToken, videos: discoverState.recommend?.videos || [] }; }, [funToken, discoverState.recommend]);

  const loadDiscover = useCallback(async () => {
    const request = getMomentsRequestScope();
    if (!request || discoverLockRef.current?.scope === funToken) return;
    const controller = new AbortController();
    discoverControllerRef.current = controller;
    const parent = request.options.signal;
    const cancel = () => controller.abort(parent.reason);
    if (parent.aborted) cancel();
    else parent.addEventListener("abort", cancel, { once: true });
    try {
      return await refreshDiscovery({
        token: funToken, currentToken: () => funTokenRef.current, isMounted: request.current,
        lock: discoverLockRef, update: setDiscoverState,
        previousVideos: discoverFeedRef.current?.scope === funToken ? discoverFeedRef.current.videos : [],
        request: (path, options) => withAchievementDeadline({ ...request.options, signal: controller.signal }, deadline =>
          apiRequest(path, { ...deadline, timeoutMs: options.timeoutMs, retry: false }), options.timeoutMs),
      });
    } finally {
      controller.abort();
      parent.removeEventListener("abort", cancel);
      if (discoverControllerRef.current === controller) discoverControllerRef.current = null;
    }
  }, [funToken, getMomentsRequestScope]);

  useEffect(() => {
    void loadDiscover();
    return () => {
      discoverControllerRef.current?.abort();
      if (discoverLockRef.current?.scope === funToken) discoverLockRef.current = null;
    };
  }, [funToken, loadDiscover]);

  const [distillState, setDistillState] = useState({
    busy: false,
    fileBusy: false,
    source: "",
    name: "",
    error: "",
    result: null,
    edited: "",
    modalOpen: false,
    fileInfo: null,
    model: "",
    diagnostic: null,
  });
  const distillFileControllerRef = useRef(null);
  useEffect(() => () => distillFileControllerRef.current?.abort(), [accountScope, companionScope]);

  async function runDistill() {
    const source = distillState.source.trim();
    if (source.length < 40 || distillState.busy) return;
    setDistillState((previous) => ({
      ...previous,
      busy: true,
      error: "",
      diagnostic: null,
      result: null,
      modalOpen: false,
    }));
    try {
      const data = await requestDistill("/api/v2/style-distill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_text: source,
          name: distillState.name.trim(),
          kind: "聊天记录",
          model: distillState.model,
        }),
      }, apiFetch);
      const distilled = data?.result?.distilled || "";
      if (!distilled) throw new Error("提纯结果为空，请换一段更清晰的聊天记录。");
      setDistillState((previous) => ({
        ...previous,
        busy: false,
        result: data.result,
        edited: distilled,
        modalOpen: true,
      }));
    } catch (error) {
      setDistillState((previous) => ({
        ...previous,
        busy: false,
        error: error?.message || "提纯失败，请稍后再试。",
        diagnostic: distillDiagnostic(error),
      }));
    }
  }

  function applyDistilledToPrompt() {
    const text = distillState.edited.trim();
    if (!text) return;
    updateUnifiedPrompt(text);
    setDistillState((previous) => ({ ...previous, modalOpen: false }));
    setNotice("已应用到「个性化指令」，正在自动保存。");
  }
  async function parseDistillFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024 && !isTextFile(file)) {
      setDistillState((previous) => ({ ...previous, error: "PDF、DOCX 和邮件文件直传最多 20MB；纯文本可分块读取至 1GB。" }));
      return;
    }
    const controller = new AbortController();
    distillFileControllerRef.current = controller;
    setDistillState((previous) => ({ ...previous, busy: true, error: "", diagnostic: null, fileBusy: true, readPercent: 0 }));
    try {
      let parsed;
      if (file.size > 20 * 1024 * 1024) {
        if (["eml", "mbox"].includes(file.name.split('.').pop().toLowerCase())) throw new Error("大邮件文件请先导出为纯文本；邮件编码需要服务器解析，直传最多 20MB。");
        parsed = await readLargeTextSample(file, { signal: controller.signal, onProgress: progress =>
          setDistillState(previous => ({ ...previous, readPercent: Math.floor(progress.readBytes / progress.totalBytes * 100) })) });
      } else {
        const formData = new FormData();
        formData.append("file", file, file.name);
        const data = await requestDistill("/api/v2/style-distill/parse-file", {
          method: "POST", body: formData,
        }, apiFetch, 60_000);
        parsed = data?.parsed;
      }
      if (controller.signal.aborted) throw new Error("文件读取已取消，原材料仍保留。");
      if (!parsed?.text) throw new Error("文件里没有解析出可用文字。");
      setDistillState((previous) => ({
        ...previous,
        busy: false,
        fileBusy: false,
        error: "",
        source: parsed.text,
        fileInfo: { filename: parsed.filename, format: parsed.format, characters: parsed.text.length, truncated: parsed.truncated, sampled: parsed.sampled, totalCharacters: parsed.characters },
      }));
      setNotice(`已解析「${parsed.filename}」（${parsed.format}，本次导入 ${parsed.text.length} 字）。${parsed.sampled ? "已扫描全文件，按位置取样；模型仅分析这些样本。" : parsed.truncated ? "文件较长，只导入前 6 万字，请分批处理剩余内容。" : "可直接开始提纯。"}`);
    } catch (caught) {
      setDistillState((previous) => ({
        ...previous,
        busy: false,
        fileBusy: false,
        error: caught?.message || "文件解析失败，请换一个文件。",
        diagnostic: distillDiagnostic(caught),
      }));
    }
  }

  const [achievementPopup, setAchievementPopup] = useState({
    visible: false,
    items: [],
  });
  const unlockedCodesRef = useRef(null);
  const dismissAchievement = useCallback(() => setAchievementPopup({ visible: false, items: [] }), []);

  const refreshFunLabs = useCallback((sections) => {
    const request = getMomentsRequestScope();
    if (!request) return Promise.resolve(null);
    return refreshFunLabsSections({
    token: funToken, currentToken: () => funTokenRef.current,
    isMounted: () => request.current(), request: (path, options) => withAchievementDeadline(request.options, deadline => apiRequest(path, { ...options, ...deadline }), options.timeoutMs),
    update: setFunLabsState, sections,
    onAchievements: items => {
      const previous = unlockedCodesRef.current?.scope === funToken ? unlockedCodesRef.current.codes : null;
      const fresh = freshAchievements(previous, items);
      unlockedCodesRef.current = { scope: funToken, codes: items.filter(item => item.unlocked).map(item => item.code || item.id) };
      if (fresh.length) setAchievementPopup({ scope: funToken, visible: true, items: fresh });
    },
    });
  }, [funToken, getMomentsRequestScope]);

  const handleMusicUnderstandingSaved = useCallback((record) => {
    if (!componentMountedRef.current || record?.scope !== funScope || funTokenRef.current !== funToken || settingsSaveScope(authSession.getSnapshot()) !== funScope) return Promise.resolve(null);
    return refreshFunLabs(["achievements"]);
  }, [funScope, funToken, refreshFunLabs]);

  async function runAchievementMutation(kind, path, options, identity, onConfirmed, onUnconfirmed) {
    const request = getMomentsRequestScope();
    if (!request || achievementMutationRef.current?.scope === funToken) return null;
    const operation = { scope: funToken, kind, status: "busy" };
    achievementMutationRef.current = operation;
    setAchievementAction(operation);
    const current = () => request.current() && funTokenRef.current === funToken;
    let saved = false;
    let confirmedReceipt = null;
    try {
      const result = await withAchievementDeadline(request.options, deadline => apiRequest(path, { ...options, ...deadline, timeoutMs: 12_000, retry: false }));
      if (!current()) return null;
      if (kind === "create" && result?.ok === false) throw Object.assign(new Error("Achievement creation was rejected"), { achievementRejected: true });
      validateAchievementReceipt(kind, result, identity);
      if (kind === "create" && (!identity || ["title", "description", "emoji"].some(key => result.achievement[key] !== identity[key]))) {
        throw Object.assign(new Error("Achievement creation receipt does not match the submitted fields"), { code: "achievements_receipt_invalid" });
      }
      confirmedReceipt = result;
      saved = true;
      onConfirmed?.(result);
      setAchievementAction({ scope: funToken, kind, status: "success", message: kind === "delete" ? "这份自定义成就已删除。" : kind === "create" ? "已留下你的新目标，什么时候完成由你决定。" : "这份纪念已收好。" });
      const refreshed = await refreshFunLabs(["achievements"]);
      if (current() && refreshed?.achievements === "error") {
        const feedback = achievementFailure(null, true);
        setAchievementAction({ scope: funToken, kind, status: "error", ...feedback });
      }
      return result;
    } catch (error) {
      if (current()) {
        if (error?.code === "achievements_receipt_invalid") recordOperationFailure(privateMediaScope, path, error);
        const feedback = achievementFailure(error, saved);
        if (kind === "create" && !saved) {
          const rejected = error?.achievementRejected === true || (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && error.status !== 408);
          if (rejected) feedback.message = `这次添加未被接受，原草稿仍保留。请确认输入或账号状态后再试。错误代码：${feedback.diagnostic.error_code}${feedback.diagnostic.http_status ? ` · HTTP ${feedback.diagnostic.http_status}` : ""}`;
          onUnconfirmed?.(rejected, feedback);
        }
        setAchievementAction({ scope: funToken, kind, status: "error", ...feedback });
        setNotice(feedback.message);
      }
      if (kind === "onboarding" && current() && !saved) throw error;
      return confirmedReceipt;
    } finally {
      if (achievementMutationRef.current === operation) achievementMutationRef.current = null;
    }
  }

  async function addCustomAchievement() {
    if (!componentMountedRef.current || !customAchievement.title.trim() || customAchievementSubmitRef.current?.scope === funToken || achievementMutationRef.current?.scope === funToken || customAchievementRecoveryRef.current?.scope === funToken) return;
    const submitted = { ...customAchievement };
    const request = getMomentsRequestScope();
    if (!request) return;
    if (["title", "description", "emoji"].some((key, index) => Array.from(submitted[key].replace(/\s+/g, " ").trim()).length > [40, 120, 4][index])) {
      const feedback = achievementFailure({ code: "achievements_input_too_long" });
      setAchievementAction({ scope: funToken, status: "error", ...feedback });
      setNotice(feedback.message);
      return;
    }
    const operation = { scope: funToken };
    customAchievementSubmitRef.current = operation;
    setCustomAchievementBusyScope(funToken);
    const current = () => request.current() && funTokenRef.current === funToken;
    try {
      await runAchievementMutation("create", "/api/v2/fun-labs/achievements/custom", {
        method: "POST",
        timeoutMs: 12_000,
        body: JSON.stringify({
          title: submitted.title.trim(),
          emoji: submitted.emoji.trim(),
          description: submitted.description.trim(),
        }),
      }, {
        title: submitted.title.replace(/\s+/g, " ").trim(),
        description: submitted.description.replace(/\s+/g, " ").trim(),
        emoji: submitted.emoji.trim() || "🏆",
      }, () => setCustomAchievement(previous =>
        current() && Object.keys(submitted).every(key => previous[key] === submitted[key])
          ? { title: "", emoji: "", description: "" } : previous), (rejected, feedback) => {
        if (rejected || !current()) return;
        const recovery = { scope: funToken, submitted, status: "pending", diagnostic: feedback.diagnostic };
        customAchievementRecoveryRef.current = recovery;
        setCustomAchievementRecovery(recovery);
      });
    } finally {
      if (customAchievementSubmitRef.current === operation) customAchievementSubmitRef.current = null;
      if (current()) setCustomAchievementBusyScope(previous => previous === funToken ? null : previous);
    }
  }

  async function reviewCustomAchievementCreation() {
    const recovery = customAchievementRecoveryRef.current;
    const request = getMomentsRequestScope();
    if (!request || recovery?.scope !== funToken || recovery.status === "busy") return;
    const review = { ...recovery, status: "busy" };
    customAchievementRecoveryRef.current = review;
    setCustomAchievementRecovery(review);
    const current = () => request.current() && funTokenRef.current === funToken && customAchievementRecoveryRef.current === review;
    try {
      const result = await refreshFunLabs(["achievements"]);
      if (!current()) return;
      const next = { ...review, status: result?.achievements === "success" ? "reviewed" : "error" };
      customAchievementRecoveryRef.current = next;
      setCustomAchievementRecovery(next);
    } catch {
      if (!current()) return;
      const next = { ...review, status: "error" };
      customAchievementRecoveryRef.current = next;
      setCustomAchievementRecovery(next);
    }
  }

  function resumeCustomAchievementCreation() {
    const recovery = customAchievementRecoveryRef.current;
    const request = getMomentsRequestScope();
    if (!request || recovery?.scope !== funToken || recovery.status !== "reviewed" || funTokenRef.current !== funToken) return;
    customAchievementRecoveryRef.current = null;
    setCustomAchievementRecovery(null);
    setAchievementAction(previous => previous?.scope === funToken && previous.kind === "create" ? null : previous);
    setNotice("已完成列表核对，添加已恢复；原草稿仍保留，请按核对结果调整后提交。");
  }

  async function unlockCustomAchievement(code) {
    return runAchievementMutation("unlock", `/api/v2/fun-labs/achievements/${encodeURIComponent(code)}/unlock`,
      { method: "POST", body: JSON.stringify({}) }, code);
  }

  async function removeCustomAchievement(id) {
    return runAchievementMutation("delete", `/api/v2/fun-labs/achievements/custom/${encodeURIComponent(id)}`,
      { method: "DELETE" }, id);
  }

  async function completeOnboarding() {
    return runAchievementMutation("onboarding", "/api/v2/fun-labs/onboarding", { method: "POST", body: JSON.stringify({}) }, "onboarding_1",
      result => setFunLabsState(previous => ({ ...previous, scope: funToken, achievements: result.achievements })));
  }

  function handleGuideAction(action) {
    if (action === "connect") { openProviderRecovery(); return; }
    changeView("chat");
    if (action === "explore") setIsComposerMenuOpen(true);
    else requestAnimationFrame(() => messageInputRef.current?.focus());
  }

  function renderAchievementGuide() {
    return <AchievementGuide key={funScope + guideRevision} storageKey={guideStorageKey(accountStorageScope, companionScope)}
      startExpanded={guideOpenScope === funScope} achievements={funLabsState.achievements} loading={funLabsState.sections.achievements.status === "busy" || (achievementAction?.scope === funToken && achievementAction.status === "busy")}
      onOpenHandled={() => setGuideOpenScope(previous => previous === funScope ? null : previous)}
      onAction={handleGuideAction} onClaim={completeOnboarding} />;
  }

  function openAchievementGuide() {
    const key = guideStorageKey(accountStorageScope, companionScope);
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(key) || "{}");
      if (key) globalThis.localStorage?.setItem(key, JSON.stringify({ ...saved, collapsed: false }));
    } catch { /* The guide remains available without storage. */ }
    setGuideRevision(value => value + 1);
    setGuideOpenScope(funScope);
    changeView("achievements");
  }

  async function removeSpecialDate(id) {
    const request = getMomentsRequestScope();
    if (!request) return;
    await removeFunDate({ id, token: funToken, currentToken: () => funTokenRef.current,
      isMounted: () => request.current(), lock: dateDeleteRef, request: (path, options) => apiRequest(path, { ...options, ...request.options }),
      update: setFunLabsState, feedback: setDateDeleteState, refresh: refreshFunLabs });
  }

  useEffect(() => {
    void refreshFunLabs();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refreshFunLabs();
    }, 90_000);
    return () => clearInterval(timer);
  }, [refreshFunLabs]);


  async function saveScreenGlanceConfig(nextValue = screenGlanceConfig) {
    if (!screenGlancePluginAvailable() || isScreenGlanceBusy) return;
    const next = normalizeScreenGlanceConfig(nextValue);
    setScreenGlanceConfig(next);
    setIsScreenGlanceBusy(true);
    try {
      applyScreenGlanceState(await ScreenGlance.configure(next));
      setScreenGlanceFeedback({
        status: "success",
        message: next.randomEnabled
          ? `随机查看范围已设为 ${next.minimumMinutes}–${next.maximumMinutes} 分钟；敏感 App 无法确认时会跳过。`
          : "随机查看已关闭；仍可从系统常驻通知手动允许看一眼。",
      });
    } catch (error) {
      setScreenGlanceFeedback({
        status: "error",
        message: error?.message || "屏幕共看设置暂时无法保存。",
      });
    } finally {
      setIsScreenGlanceBusy(false);
    }
  }

  async function startScreenGlanceSession(options = {}) {
    if (!screenGlancePluginAvailable()) return;
    const stamp = screenGlanceLifecycleRef.current.capture();
    setScreenGlanceFeedback({ status: "checking", message: "正在交给 Android 系统确认共享范围…" });
    const result = await screenGlanceLifecycleRef.current.start(options);
    if (result.code === "screen_glance_scope_changed" || stamp.scope !== screenGlanceLifecycleRef.current.capture().scope) return;
    if (!result.ok) {
      setScreenGlanceFeedback({ status: "error", message: `${result.message}（${result.code}）` });
      return result;
    }
    if (result.cancelled) {
      setScreenGlanceFeedback({ status: "idle", message: "系统屏幕共享没有开始，原有听歌和共看记录仍保留。" });
      return result;
    }
    const nextStamp = screenGlanceLifecycleRef.current.capture();
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    if (stamp.scope !== nextStamp.scope || !screenGlanceLifecycleRef.current.current(nextStamp)) return;
    const state = await refreshScreenGlanceState();
    if (!screenGlanceLifecycleRef.current.current(nextStamp)) return;
    if (options.watchTogether) await refreshCoWatchExperience({ silent: true });
    if (!screenGlanceLifecycleRef.current.current(nextStamp)) return;
    setScreenGlanceFeedback({
      status: state?.active ? "success" : state?.lastError ? "error" : result.starting ? "checking" : "error",
      message: state?.active
        ? options.watchTogether
          ? `已经开始一起看。共享会一直持续到你主动结束；画面明显变化时，${effectiveAiName}会主动说出感受。`
          : "屏幕共看已开始。Android 常驻通知可随时看一眼、暂停或结束。"
        : state?.lastError || (result.starting ? "系统正在建立共享，可查看 Android 的常驻通知。" : "系统没有建立共享，请重新确认一次。"),
    });
    return result;
  }

  async function startDirectMediaCoWatchSession(options = {}) {
    const pageMode = options.sessionMode === "web_page";
    const sourceApp = pageMode ? WEB_PAGE_SOURCE_APP : DIRECT_MEDIA_SOURCE_APP;
    const result = await coWatchLifecycleRef.current.start({
      ...options,
      sessionMode: pageMode ? "web_page" : "direct_media",
      sourceApp,
      mediaUrl: options.mediaUrl,
      cadenceSeconds: 60,
    });
    return result.ok ? { ...result, message: pageMode ? "网页一起看已经开始。" : "直链共看已经开始。" } : result;
  }

  async function startMusicCoWatchSession(options = {}) {
    const result = await coWatchLifecycleRef.current.start({ ...options, sessionMode: "listening", sourceApp: "local_playlist", cadenceSeconds: 90, reuseActiveMode: true });
    return result.ok ? { ...result.session, ok: true } : result;
  }

  const syncNowPlayingToSession = useCallback((song) => nowPlayingSyncRef.current.sync(song), []);

  function updateMusicCoWatchPlayback(snapshot = {}) {
    return musicPlaybackSyncRef.current.submit(snapshot);
  }

  async function stopMusicCoWatchSession(options = {}) {
    return coWatchLifecycleRef.current.stop({ ...options, sessionMode: "listening" });
  }

  async function updateDirectMediaCoWatchPlayback(snapshot = {}) {
    const position = Math.max(
      0,
      Math.min(604800, Number(snapshot.mediaPositionSeconds) || 0),
    );
    const duration = Math.max(
      0,
      Math.min(604800, Number(snapshot.mediaDurationSeconds) || 0),
    );
    const lifecycle = coWatchLifecycleRef.current;
    const stamp = lifecycle.capture();
    const identity = coWatchIdentityRef.current;
    const current = coWatchSessionRef.current;
    if (
      !current?.id ||
      (current.sourceApp !== DIRECT_MEDIA_SOURCE_APP &&
        current.sourceApp !== WEB_PAGE_SOURCE_APP) ||
      (snapshot.sessionId && snapshot.sessionId !== current.id)
    ) return;
    const target = Object.freeze({
      ...current,
      mediaPositionSeconds: position,
      mediaDurationSeconds: duration || current.mediaDurationSeconds,
      playbackState: snapshot.playbackState === "playing" ? "playing" : "paused",
    });
    setCoWatchSession((current) => {
      if (
        !current?.id ||
        (current.sourceApp !== DIRECT_MEDIA_SOURCE_APP &&
          current.sourceApp !== WEB_PAGE_SOURCE_APP) ||
        (snapshot.sessionId && snapshot.sessionId !== current.id)
      ) {
        return current;
      }
      if (
        Math.floor(current.mediaPositionSeconds) === Math.floor(position) &&
        Math.floor(current.mediaDurationSeconds) === Math.floor(duration) &&
        current.playbackState === (snapshot.playbackState === "playing" ? "playing" : "paused")
      ) {
        return current;
      }
      return target;
    });
    try {
      const next = await patchCoWatchPlayback(target.id, {
        ...snapshot,
        revision: target.revision,
        mediaPositionSeconds: position,
        mediaDurationSeconds: duration || target.mediaDurationSeconds,
      }, identity);
      if (!lifecycle.current(stamp) || coWatchSessionRef.current?.id !== target.id) return;
      if (next) { coWatchSessionRef.current = next; setCoWatchSession(next); }
    } catch (error) {
      if (!lifecycle.current(stamp) || coWatchSessionRef.current?.id !== target.id) return;
      if (error?.status === 409 || error?.code === "revision_conflict") {
        await refreshCoWatchExperience({ silent: true });
        return;
      }
      setScreenGlanceFeedback({ status: "error", message: error?.message || "电视播放状态同步失败，本机播放器仍可继续使用。" });
    }
  }

  async function generateCastPairingCode() {
    if (!coWatchSession?.id || isScreenGlanceBusy) return;
    setIsScreenGlanceBusy(true);
    try {
      setCastPairing(await createCoWatchPairingCode(coWatchSession.id));
    } catch (error) {
      setScreenGlanceFeedback({ status: "error", message: error?.message || "暂时无法生成电视配对码。" });
    } finally {
      setIsScreenGlanceBusy(false);
    }
  }

  async function stopDirectMediaCoWatchSession(options = {}) {
    const result = await coWatchLifecycleRef.current.stop(options);
    return result.ok ? { ...result, message: "这场共看已经结束。" } : result;
  }

  async function setScreenGlancePaused(paused) {
    if (!screenGlancePluginAvailable() || isScreenGlanceBusy) return;
    setIsScreenGlanceBusy(true);
    try {
      await ScreenGlance.setPaused({ paused });
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const state = await refreshScreenGlanceState();
      setScreenGlanceFeedback({
        status: "success",
        message: state?.paused
          ? "已经暂停，不会读取新的画面；系统共享提示仍保留。"
          : "已经继续，仍只在获准条件内读取单帧。",
      });
    } catch (error) {
      setScreenGlanceFeedback({
        status: "error",
        message: error?.message || "暂时无法改变屏幕共看状态。",
      });
    } finally {
      setIsScreenGlanceBusy(false);
    }
  }

  async function stopScreenGlanceSession(options = {}) {
    const stamp = screenGlanceLifecycleRef.current.capture();
    const result = await screenGlanceLifecycleRef.current.stop(options);
    if (result.code === "screen_glance_scope_changed" || stamp.scope !== screenGlanceLifecycleRef.current.capture().scope) return;
    setScreenGlanceFeedback({
      status: result.ok ? "idle" : "error",
      message: result.ok ? "屏幕共看已结束，尚未发送的临时画面已经清除。" : `${result.message}（${result.code}）`,
    });
    return result;
  }

  function updateUnifiedPrompt(value) {
    if (settingsExitBusyRef.current) return;
    const nextDraft = {
      ...draftSettingsRef.current,
      prompt_mode: "unified",
      unified_system_prompt: value,
    };
    draftSettingsRef.current = nextDraft;
    setSettingsSaveReceipt(null);
    setDraftSettings(nextDraft);
    scheduleSettingsAutosave(nextDraft);
  }

  function updateTurnContext(value) {
    const nextValue = String(value || "");
    turnContextRef.current = nextValue;
    setTurnContext(nextValue);
  }

  function applyPromptReceipt(value) {
    const receipt = normalizePromptReceipt(value, new Date().toISOString());
    if (!receipt) return;
    setLastPromptReceipt(receipt);
    storePromptReceipt(receipt, accountStorageScope);
  }

  function updateEmotionUnderstanding(value) {
    setEmotionUnderstandingEnabled(value);
    try {
      writeAccountStorage(
        localStorage,
        EMOTION_UNDERSTANDING_KEY,
        accountStorageScope,
        String(value),
      );
    } catch {
      // WebView 禁止本地存储时，本次运行仍然保持开关状态。
    }
    setNotice(
      value
        ? "文字与语音情绪理解已开启。结果只作为回应语气参考，不是心理诊断。"
        : "情绪理解已关闭；语音仍可转写和聊天。",
    );
  }

  async function postMoment(event) {
    event.preventDefault();
    const content = momentDraft.trim();
    if ((!content && momentImages.length === 0) || momentPostPendingRef.current) return;
    const request = getMomentsRequestScope();
    if (!request) return;
    const pending = {};
    momentPostPendingRef.current = pending;
    momentsLoadTokenRef.current += 1;
    setMomentsLoading(false);
    const submittedDraft = momentDraft;
    const submittedImageIds = new Set(momentImages.map((item) => item.id));

    setIsPostingMoment(true);
    try {
      const data = await apiRequest("/api/v2/moments", {
        ...request.options,
        method: "POST",
        body: JSON.stringify({
          content,
          session_id: activeSessionId,
          images: momentImages.map((item) => ({
            type: item.type,
            data: item.data,
          })),
        }),
      });
      if (!request.current()) return;
      if (!data?.moment?.id || data.moment.author !== "user") {
        throw Object.assign(new Error("动态发布回执不完整。"), { code: "moment_post_receipt_invalid" });
      }
      setMomentDraft((current) => current === submittedDraft ? "" : current);
      setMomentImages((current) => current.filter((item) => !submittedImageIds.has(item.id)));
      const refreshed = await loadMoments({ silent: true });
      if (request.current()) setNotice(refreshed
        ? "动态已经发布。对方会不会留下痕迹，由当下的心情决定。"
        : "动态已经保存，但列表暂时无法确认。请刷新动态核对。对方是否回应由当下的心情决定。");
    } catch (error) {
      if (request.current()) setNotice(`${momentFailureMessage(error)} 发布结果尚未确认，草稿已保留。请先刷新动态核对，再决定是否重试。`);
    } finally {
      if (momentPostPendingRef.current === pending) momentPostPendingRef.current = null;
      if (request.current()) setIsPostingMoment(false);
    }
  }

  async function selectMomentImages(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;
    const request = getMomentsRequestScope();
    if (!request) return;

    const remaining = Math.max(0, 4 - momentImages.length);
    if (remaining === 0) {
      setNotice("一条动态最多添加 4 张图片。");
      return;
    }

    try {
      const next = [];
      const warnings = [];
      for (const file of files.slice(0, remaining)) {
        const prepared = await prepareMomentImage(file);
        if (prepared.warning) warnings.push(prepared.warning);
        next.push({
          id: `${file.name}-${file.lastModified}-${Math.random()}`,
          ...prepared,
        });
      }

      if (!request.current()) return;
      setMomentImages((current) => [...current, ...next].slice(0, 4));
      const messages = [
        ...(files.length > remaining
          ? ["一条动态最多添加 4 张图片，多余图片没有加入。"]
          : []),
        ...warnings,
      ];
      setNotice(messages.join("；"));
    } catch (error) {
      if (request.current()) setNotice(momentFailureMessage({ code: "moment_image_prepare_failed", status: error?.status }));
    }
  }

  function removeMomentImage(id) {
    setMomentImages((current) => current.filter((item) => item.id !== id));
  }

  async function toggleMomentLike(moment) {
    const momentId = String(moment?.id ?? "");
    if (!momentId || pendingMomentLikesRef.current[momentId]) return;
    const request = getMomentsRequestScope();
    if (!request) return;
    momentsLoadTokenRef.current += 1;
    setMomentsLoading(false);

    const pending = { liked: moment?.user_liked !== true };
    pendingMomentLikesRef.current = {
      ...pendingMomentLikesRef.current,
      [momentId]: pending,
    };
    setPendingMomentLikes(pendingMomentLikesRef.current);

    try {
      await toggleMomentLikeOptimistically({
        moment,
        updateMoments(update) {
          if (request.current()) setMoments(update);
        },
        async persist(liked) {
          const data = await apiRequest(`/api/v2/moments/${moment.id}/like`, {
            ...request.options,
            method: "POST",
            body: JSON.stringify({ liked }),
          });
          if (!request.current()) return;
          if (String(data?.moment?.id || "") !== momentId || data.moment.user_liked !== liked) {
            throw Object.assign(new Error("点赞回执不完整。"), { code: "moment_like_receipt_invalid" });
          }
        },
        async refresh() {
          if (!request.current()) return;
          const refreshed = await loadMoments({ silent: true });
          if (!refreshed && request.current()) setNotice("点赞已经保存，但列表刷新失败。请刷新动态核对。");
        },
      });
    } catch (error) {
      if (request.current()) setNotice(momentFailureMessage(error));
    } finally {
      const nextPending = { ...pendingMomentLikesRef.current };
      delete nextPending[momentId];
      pendingMomentLikesRef.current = nextPending;
      if (request.current()) setPendingMomentLikes(nextPending);
    }
  }

  async function postComment(momentId) {
    const submittedDraft = commentDrafts[momentId] || "";
    const content = submittedDraft.trim();
    if (!content || pendingMomentCommentsRef.current[momentId]) return;
    const request = getMomentsRequestScope();
    if (!request) return;
    const pending = {};
    pendingMomentCommentsRef.current = { ...pendingMomentCommentsRef.current, [momentId]: pending };
    setPendingMomentComments(pendingMomentCommentsRef.current);
    momentsLoadTokenRef.current += 1;
    setMomentsLoading(false);

    try {
      const data = await apiRequest(`/api/v2/moments/${momentId}/comments`, {
        ...request.options,
        method: "POST",
        body: JSON.stringify({ content }),
      });
      if (!request.current()) return;
      if (!data?.comment?.id || String(data.comment.moment_id) !== String(momentId) || data.comment.author !== "user") {
        throw Object.assign(new Error("评论保存回执不完整。"), { code: "moment_comment_receipt_invalid" });
      }
      setCommentDrafts((current) => current[momentId] === submittedDraft ? { ...current, [momentId]: "" } : current);
      const refreshed = await loadMoments({ silent: true });
      if (request.current()) setNotice(refreshed ? "评论已经保存。" : "评论已经保存，但列表刷新失败。请刷新动态核对。");
    } catch (error) {
      if (request.current()) setNotice(`${momentFailureMessage(error)} 评论结果尚未确认，草稿已保留。请先刷新动态核对，再决定是否重试。`);
    } finally {
      if (pendingMomentCommentsRef.current[momentId] === pending) {
        const next = { ...pendingMomentCommentsRef.current };
        delete next[momentId];
        pendingMomentCommentsRef.current = next;
        if (request.current()) setPendingMomentComments(next);
      }
    }
  }

  function changeView(view) {
    if (!canLeaveWorkspace(view)) return;
    if (view !== activeViewRef.current && ["music", "together"].includes(activeViewRef.current)) {
      setActivityReturn(createActivityReturn(coWatchSessionRef.current, coWatchIdentityRef.current, activeViewRef.current));
    }
    if (
      shouldScheduleSettingsOnViewChange({
        activeView,
        nextView: view,
        hasLoadedSettings: hasLoadedSettingsRef.current,
      })
    ) {
      scheduleSettingsAutosave(draftSettingsRef.current, {
        immediate: true,
      });
    }
    closeComposerMenu();
    requestStatusPanelClose();
    setActiveView(view);
    setIsSidebarOpen(false);
    setIsMobileNavOpen(false);
  }

  function returnToActivity() {
    const destination = resolveActivityReturn(activityReturn, coWatchIdentityRef.current, coWatchSessionRef.current);
    if (!destination) { setActivityReturn(null); return; }
    setTogetherEntryMode(destination.entryMode);
    changeView(destination.view);
  }

  function openSettingsPanel() {
    closeComposerMenu();
    requestStatusPanelClose();
    setIsSidebarOpen(false);
    setIsMobileNavOpen(false);
    setSettingsCategory(null);
    setSettingsFocusTarget("");
    setIsSettingsOpen(true);
  }

  function openProviderRecovery() {
    closeComposerMenu();
    requestStatusPanelClose();
    setIsSidebarOpen(false);
    setIsMobileNavOpen(false);
    setSettingsCategory("services");
    setSettingsFocusTarget("");
    setIsSettingsOpen(true);
  }

  function openCreativeProviderSettings() {
    closeComposerMenu();
    requestStatusPanelClose();
    setIsSidebarOpen(false);
    setIsMobileNavOpen(false);
    setSettingsCategory("services");
    setSettingsFocusTarget("creative-provider-settings");
    setIsSettingsOpen(true);
  }

  function openExternalMemorySettings() {
    closeComposerMenu();
    requestStatusPanelClose();
    setIsSidebarOpen(false);
    setIsMobileNavOpen(false);
    setSettingsCategory("persona");
    setSettingsFocusTarget("external-memory-connections");
    setIsSettingsOpen(true);
  }

  function closeSettingsPanel() {
    if (hasLoadedSettingsRef.current) {
      scheduleSettingsAutosave(draftSettingsRef.current, {
        immediate: true,
      });
    }
    window.clearTimeout(settingsScrollIdleTimerRef.current);
    settingsScrollRef.current
      ?.closest(".settings-sheet")
      ?.classList.remove("is-scrolling");
    setSettingsFocusTarget("");
    setIsSettingsOpen(false);
  }

  function dismissChatError(messageId) {
    setMessages((current) => dismissChatErrorMessage(current, messageId));
    setNotice("");
  }

  function retryStartupConnection() {
    void startupReconnectRef.current?.retryNow("manual");
  }

  function handleSendButton() {
    if (isSendingRef.current) {
      abortChatRequest(chatRequestRef, "user-cancel");
      return;
    }
    void sendMessage();
  }

  function handleSendActivation(action, event) {
    const activation = resolveComposerSendActivation(
      action,
      event,
      sendPointerDownHandledRef.current,
    );
    sendPointerDownHandledRef.current = activation.pointerDownHandled;
    if (!activation.dispatch) return;
    if (action === "pointerdown") event.preventDefault();
    handleSendButton();
  }

  // Resolve each private avatar once per account/companion, not once per message.
  const userAvatarMedia = usePrivateMediaSource(privateMediaContentPath(
    selectedPrivateMedia(privateMediaCatalog, "user_avatar")?.id,
  ));
  const companionAvatarMedia = usePrivateMediaSource(privateMediaContentPath(
    selectedPrivateMedia(privateMediaCatalog, "companion_avatar")?.id,
  ));

  function renderChat() {
    const chatBackgroundAsset = selectedPrivateMedia(
      privateMediaCatalog,
      "chat_background",
    );
    const userAvatar = userAvatarMedia.url;
    const companionAvatar = companionAvatarMedia.url;
    const chatBackground = privateMediaContentPath(chatBackgroundAsset?.id);
    const latestMessage = messages[messages.length - 1];
    const replySuggestions =
      latestMessage?.role === "assistant" &&
      !latestMessage.isStreaming &&
      !isSending &&
      !isCompanionResponding &&
      !isVoiceInputBusy
        ? readReplySuggestions(latestMessage)
        : [];
    const attachmentsAtLimit = chatAttachments.length >= 4;
    const sendButtonLabel = isSending
      ? "停止等待"
      : isCompanionResponding
        ? "互动回应中"
        : chatRetryReady
          ? chatRetryIsProcessing
            ? "检查进度"
            : "重试"
          : "发送";

    return (
      <>
        {chatBackground && <ChatBackground src={chatBackground} />}
        <section
          ref={messageListRef}
          className="message-list"
          aria-live="polite"
          tabIndex={0}
          aria-label="聊天记录"
        >
          <div className="message-list-content">
          {!isLoading && renderAchievementGuide()}
          {isLoading ? (
            <div className="empty-state">正在加载 DengTa home…</div>
          ) : messages.length === 0 ? (
            <div className="empty-state">
              {settings.user_display_name || settings.ai_name !== "伴侣" ? (
                <h2>{effectiveAiName}</h2>
              ) : null}
              {activeChatModel ? (
                <p>当前模型：{activeChatModel}</p>
              ) : null}
            </div>
          ) : (
              <ChatTranscript
                messages={messages}
                preferences={chatSkinPreferences}
                aiName={effectiveAiName}
                aiPronoun={companionPronoun(settings)}
                userName={effectiveUserName}
                companionMood={companionStatus.mood}
                apiBaseUrl={API_BASE_URL}
                onPreview={handleImagePreview}
                onReference={selectMessageForReference}
                onDismissError={dismissChatError}
                onOpenActivity={openCompanionActivity}
                innerMonologues={innerMonologues}
                innerMonologuePending={innerMonologuePending}
                innerMonologueErrors={innerMonologueErrors}
                onRequestInnerMonologue={requestVisibleInnerMonologue}
                userAvatar={userAvatar}
                companionAvatar={companionAvatar}
                privateMediaCatalog={privateMediaCatalog}
              />
          )}
          </div>
        </section>

        <div className="composer-wrap">
          <ActivityReturnBar
            activity={resolveActivityReturn(activityReturn, coWatchIdentityRef.current, coWatchSession)}
            onOpen={returnToActivity}
            onDismiss={() => setActivityReturn(null)}
          />
          {sendPreparationStage && (
            <small role="status" aria-live="polite" className="composer-send-preparation">
              {CHAT_SEND_PREPARATION_LABELS[sendPreparationStage]}
            </small>
          )}
          <Suspense fallback={null}>
            <CottonChatDock
              accountScope={accountStorageScope}
              companionScope={companionScope}
              blocked={isSettingsOpen || isSidebarOpen || isMobileNavOpen || isComposerMenuOpen || isStatusPanelExpanded || Boolean(imageViewer)}
              onOpenHouse={() => changeView("cotton")}
            />
          </Suspense>
          {isComposerMenuOpen && (
            <button
              type="button"
              className="composer-tool-scrim"
              aria-label="关闭更多功能"
              onClick={() => closeComposerMenu()}
            />
          )}
          {replySuggestions.length > 0 && (
            <div className="reply-suggestions" aria-label="可以这样回复">
              {replySuggestions.map((suggestion, index) => (
                <button
                  type="button"
                  key={suggestion}
                  onClick={() => {
                    setMessage(suggestion);
                    window.requestAnimationFrame(() =>
                      messageInputRef.current?.focus(),
                    );
                  }}
                >
                  <span>{String.fromCharCode(65 + index)}</span>
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          {messageReference && (
            <div className="composer-message-reference" role="status">
              <div>
                <strong>
                  引用{" "}
                  {messageReference.role === "user"
                    ? effectiveUserName
                    : effectiveAiName}
                </strong>
                <span>
                  {messageReference.text ||
                    `${messageReference.attachment_summary?.count || 0} 个附件`}
                  {messageReference.text_truncated ? "…" : ""}
                </span>
                {messageReference.attachment_summary?.count > 0 &&
                  messageReference.text && (
                    <small>
                      另有 {messageReference.attachment_summary.count} 个附件
                    </small>
                  )}
              </div>
              <button
                type="button"
                aria-label="取消引用"
                title="取消引用"
                onClick={() => setMessageReference(null)}
              >
                ×
              </button>
            </div>
          )}
          <SelectedAttachmentStrip
            items={chatAttachments}
            onRemove={removeChatAttachment}
          />
          {chatAttachments.length > 0 && (
            <label className="attachment-safety-control">
              <input
                type="checkbox"
                checked={attachmentSafetyEnabled}
                disabled={isSending || chatRetryReady}
                onChange={(event) =>
                  setAttachmentSafetyEnabled(event.target.checked)
                }
              />
              <span>
                <strong>附件安全隔离</strong>
                <small>
                  {attachmentSafetyEnabled
                    ? "已开启（默认）：附件只作为资料，不会变成系统指令"
                    : "已关闭：本轮文档或语音文字将作为高优先级附件指令"}
                </small>
              </span>
            </label>
          )}
          <div className="composer">
            <textarea
              ref={messageInputRef}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onFocus={() => {
                const next = transitionComposerOverlays(
                  {
                    statusExpanded: isStatusPanelExpanded,
                    composerMenuOpen: isComposerMenuOpen,
                  },
                  "focus-input",
                );
                setIsComposerMenuOpen(next.composerMenuOpen);
                requestStatusPanelClose();
              }}
              onKeyDown={(event) => {
                if (shouldSubmitComposerKeyDown(event)) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={
                chatSkinPreferences.dynamicComposerHint && composerHint
                  ? composerHint
                  : "想和祂说点什么……"
              }
              rows="1"
            />
            <div className="composer-toolbar">
              <input
                ref={chatFileInputRef}
                className="visually-hidden-file-input"
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.csv,.json,.xml"
                onChange={(event) => {
                  setIsComposerMenuOpen(false);
                  void selectChatAttachments(event);
                }}
                tabIndex="-1"
              />
              <input
                ref={chatImageInputRef}
                className="visually-hidden-file-input"
                type="file"
                multiple
                accept="image/*"
                onChange={(event) => {
                  setIsComposerMenuOpen(false);
                  void selectChatAttachments(event);
                }}
                tabIndex="-1"
              />
              <input
                ref={chatVideoInputRef}
                className="visually-hidden-file-input"
                type="file"
                multiple
                accept="video/mp4,video/webm,video/quicktime"
                onChange={(event) => {
                  setIsComposerMenuOpen(false);
                  void selectChatAttachments(event);
                }}
                tabIndex="-1"
              />
              <button
                ref={composerMenuTriggerRef}
                className={`chat-attach-button${isComposerMenuOpen ? " active" : ""}`}
                type="button"
                title={isComposerMenuOpen ? "关闭更多功能" : "更多功能"}
                aria-label={
                  isComposerMenuOpen ? "关闭更多功能" : "打开更多功能"
                }
                aria-expanded={isComposerMenuOpen}
                disabled={isVoiceInputBusy}
                onPointerDown={(event) => {
                  if (shouldHandleComposerPointerDown(event)) {
                    event.preventDefault();
                  }
                }}
                onClick={toggleComposerMenu}
              >
                <RainbowAgentMark />
              </button>
              <button
                className="send-button"
                type="button"
                aria-label={sendButtonLabel}
                title={sendButtonLabel}
                onPointerDown={(event) =>
                  handleSendActivation("pointerdown", event)
                }
                onPointerCancel={(event) =>
                  handleSendActivation("pointercancel", event)
                }
                onClick={(event) => handleSendActivation("click", event)}
                disabled={
                  isCompanionResponding ||
                  isVoiceInputBusy ||
                  (!isSending &&
                    !message.trim() &&
                    chatAttachments.length === 0)
                }
              >
                <span className="send-paw-icon" aria-hidden="true">
                  {isSending ? "■" : "🐾"}
                </span>
                <span className="send-button-label">{sendButtonLabel}</span>
              </button>
            </div>
          </div>
          {isComposerMenuOpen && (
            <section className="composer-tool-menu" aria-label="更多输入功能">
              <SunGlassTimeDeck
                snapshot={celestialSnapshot}
                previewMinute={previewMinute}
                onPreviewMinute={setPreviewMinute}
                onNow={() => setPreviewMinute(null)}
                weather={ambientWeather}
                weatherMode={weatherPreviewMode}
                onWeatherMode={setWeatherPreviewMode}
                glassLevel={themePreferences.cardOpacity * 100}
                onGlassLevel={(value) =>
                  updateTheme({ cardOpacity: Number(value) / 100 })
                }
              />
              <div className="composer-tool-grid">
                <button
                  type="button"
                  disabled={attachmentsAtLimit}
                  aria-disabled={attachmentsAtLimit}
                  onClick={() => chatImageInputRef.current?.click()}
                >
                  <span aria-hidden="true">▧</span>
                  <strong>图片</strong>
                  <small>相册或拍照</small>
                </button>
                <button
                  type="button"
                  disabled={attachmentsAtLimit}
                  aria-disabled={attachmentsAtLimit}
                  onClick={() => chatVideoInputRef.current?.click()}
                >
                  <span aria-hidden="true">▶</span>
                  <strong>视频</strong>
                  <small>MP4 / WebM / MOV</small>
                </button>
                <button
                  type="button"
                  disabled={attachmentsAtLimit}
                  aria-disabled={attachmentsAtLimit}
                  onClick={() => chatFileInputRef.current?.click()}
                >
                  <span aria-hidden="true">▤</span>
                  <strong>文件</strong>
                  <small>PDF、文档与文本</small>
                </button>
              </div>
              <ChatActivities key={JSON.stringify([accountStorageScope, companionScope, activeSessionId])} disabled={isVoiceInputBusy}
                onChoose={(text) => {
                  setMessage((current) => appendActivityDraft(current, text));
                  setIsComposerMenuOpen(false);
                  requestAnimationFrame(() => messageInputRef.current?.focus());
                }} />
              <label className="chat-model-picker">
                <span>模型</span>
                <select
                  aria-label="本会话模型"
                  value={selectedChatModel}
                  onChange={(event) => selectChatModel(event.target.value)}
                  disabled={
                    isSending || isCompanionResponding || isVoiceInputBusy
                  }
                >
                  {availableModels.length === 0 && (
                    <option value={selectedChatModel || settings.model || ""}>
                      {activeChatModel || "由服务器自动选择"}
                    </option>
                  )}
                  {availableModels.map((modelOption) => (
                    <option value={modelOption.id} key={modelOption.id}>
                      {modelOption.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className={`voice-controls voice-${voiceState}`}>
                <button
                  className="voice-hold-button"
                  type="button"
                  aria-label={
                    voiceServiceAvailable
                      ? "长按说话，松开发送"
                      : "语音服务暂不可用"
                  }
                  aria-pressed={voiceState === VOICE_STATES.recording}
                  disabled={
                    !voiceServiceAvailable ||
                    isSending ||
                    isCompanionResponding ||
                    [VOICE_STATES.uploading, VOICE_STATES.thinking].includes(
                      voiceState,
                    )
                  }
                  onPointerDown={beginVoiceCapture}
                  onPointerUp={endVoiceCapture}
                  onPointerCancel={endVoiceCapture}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <span className="voice-mic-icon" aria-hidden="true">
                    {voiceState === VOICE_STATES.recording ? "●" : "🎙"}
                  </span>
                  <span>
                    {!voiceServiceAvailable
                      ? "语音暂不可用"
                      : voiceState === VOICE_STATES.recording
                        ? `松开发送 · ${(voiceElapsedMs / 1000).toFixed(1)} 秒`
                        : VOICE_STATE_LABELS[voiceState] || "按住说话"}
                  </span>
                </button>
                {voiceState === VOICE_STATES.speaking && (
                  <button
                    className="voice-stop-button"
                    type="button"
                    onClick={() => void stopVoicePlayback()}
                  >
                    停止朗读
                  </button>
                )}
                {[VOICE_STATES.uploading, VOICE_STATES.thinking].includes(
                  voiceState,
                ) && (
                  <button
                    className="voice-stop-button"
                    type="button"
                    onClick={() =>
                      cancelVoiceCapture({
                        message: "语音处理已取消，文字聊天仍可继续。",
                      })
                    }
                  >
                    取消语音处理
                  </button>
                )}
                <span
                  className="voice-status-text"
                  role="status"
                  aria-live="polite"
                >
                  {voiceServiceAvailable
                    ? "长按说话，松开发送 · 最长 60 秒"
                    : voiceService.message}
                </span>
              </div>
              {voiceError && (
                <div className="voice-inline-error" role="alert">
                  {voiceError}
                </div>
              )}
              {lastVoiceAnalysis && (
                <div className="voice-analysis-card" role="status">
                  <div>
                    <strong>刚才的语音转写</strong>
                    <span>
                      {lastVoiceAnalysis.emotion} ·{" "}
                      {formatVoiceConfidence(lastVoiceAnalysis.confidence)}
                    </span>
                  </div>
                  <p>{lastVoiceAnalysis.text}</p>
                  <small>
                    {lastVoiceAnalysis.hint ||
                      "情绪结果只是声音与文字线索，不是心理诊断；你的自述永远优先。"}
                  </small>
                </div>
              )}
            </section>
          )}
          {modelsLoadMessage && (
            <div className="chat-model-note" role="status">
              {modelsLoadMessage}
            </div>
          )}
          <small>
            {isCompanionResponding
              ? `${effectiveAiName}正在回应刚才的互动`
              : isOnline
                ? "已连接"
                : "网络已断开，暂时不能聊天"} · 聊天记录保存在 Supabase
          </small>
        </div>
      </>
    );
  }

  function renderMoments() {
    if (momentsAvailable === false) {
      return (
        <section className="feature-page centered-feature">
          <div className="feature-symbol">◌</div>
          <h2>动态空间暂时无法加载</h2>
          <p>
            请确认后端服务器正在运行，然后重新打开这个页面。
          </p>
          <span className="status-chip pending">暂时不可用</span>
          {momentsLoadError && <p role="alert">{momentsLoadError}</p>}
          <button type="button" onClick={() => void loadMoments()} disabled={momentsLoading}>
            {momentsLoading ? "正在读取动态…" : "刷新动态"}
          </button>
        </section>
      );
    }

    return (
      <section className="feature-page moments-page">
        <FeatureAtmosphere kind="moments" />
        <form className="moment-composer" onSubmit={postMoment}>
          <div className="moment-avatar user-avatar" aria-hidden="true">
            我
          </div>
          <div className="moment-compose-main">
            <textarea
              value={momentDraft}
              onChange={(event) => setMomentDraft(event.target.value)}
              placeholder="留下一句话，或者只发图片…"
              rows="3"
            />

            {momentImages.length > 0 && (
              <div className="moment-preview-grid">
                {momentImages.map((image) => (
                  <div className="moment-preview" key={image.id}>
                    <img src={image.preview} alt={image.name} />
                    <button
                      type="button"
                      aria-label={`移除 ${image.name}`}
                      onClick={() => removeMomentImage(image.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="moment-compose-tools">
              <label className="image-picker">
                ＋ 添加图片
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  onChange={selectMomentImages}
                />
              </label>
              <span>{momentImages.length}/4</span>
              <button type="button" onClick={() => void loadMoments()}>
                刷新动态
              </button>
            </div>
          </div>
          <button
            className="moment-submit"
            disabled={
              (!momentDraft.trim() && momentImages.length === 0) ||
              isPostingMoment
            }
          >
            {isPostingMoment ? "发布中" : "发布动态"}
          </button>
        </form>

        <div className="moment-list">
          {momentsLoadError && <div className="empty-card" role="alert">{momentsLoadError}</div>}
          {moments.length === 0 ? (
            <div className="empty-card">{momentsLoading ? "正在读取动态…" : momentsLoadError ? "暂时无法确认动态列表，请刷新重试。" : momentsAvailable === null ? "动态列表尚未读取。" : "这里还没有动态。"}</div>
          ) : (
            moments.map((item) => (
              <article className="moment-card" key={item.id}>
                <header>
                  {item.author === "assistant" ? (
                    <img
                      className="moment-avatar"
                      src="/app-icon.svg"
                      alt="DengTa"
                    />
                  ) : (
                    <div className="moment-avatar user-avatar" aria-hidden="true">
                      我
                    </div>
                  )}
                  <div>
                    <strong>
                      {item.author === "assistant"
                        ? effectiveAiName
                        : "我"}
                    </strong>
                    <time>{formatDateTime(item.created_at)}</time>
                  </div>
                </header>
                {item.content && (
                  <p>
                    {item.author === "assistant" ? (
                      <TypewriterText text={item.content} stepMs={18} />
                    ) : (
                      item.content
                    )}
                  </p>
                )}
                {Array.isArray(item.images) && item.images.length > 0 && (
                  <div className={`moment-image-grid count-${item.images.length}`}>
                    {item.images.map((url, index) => (
                      <AuthenticatedImage
                        src={url}
                        alt={`动态图片 ${index + 1}`}
                        buttonClassName="moment-image-button"
                        onPreview={(previewUrl, alt) =>
                          setImageViewer({ url: previewUrl, alt })
                        }
                        key={`${url}-${index}`}
                      />
                    ))}
                  </div>
                )}
                {item.author === "assistant" && (
                  <div className="moment-actions">
                    <button
                      type="button"
                      aria-pressed={item.user_liked === true}
                      aria-busy={Boolean(pendingMomentLikes[item.id])}
                      disabled={Boolean(pendingMomentLikes[item.id])}
                      onClick={() => toggleMomentLike(item)}
                    >
                      {pendingMomentLikes[item.id]
                        ? item.user_liked
                          ? "♥ 保存中"
                          : "♡ 保存中"
                          : item.user_liked
                            ? "♥ 已喜欢"
                            : "♡ 喜欢"}
                    </button>
                  </div>
                )}

                {item.liked && item.author === "user" && (
                  <div className="ai-like">
                    ♥ {effectiveAiName} 喜欢了这条动态
                  </div>
                )}

                {item.reply_content && (
                  <div className="comment assistant-comment">
                    <strong>{effectiveAiName}：</strong>
                    {item.reply_content}
                  </div>
                )}

                {(item.comments || []).map((comment) => (
                  <div
                    className={`comment ${
                      comment.author === "assistant" ? "assistant-comment" : ""
                    }`}
                    key={comment.id}
                  >
                    <strong>
                      {comment.author === "assistant"
                        ? effectiveAiName
                        : "我"}
                      ：
                    </strong>
                    {comment.content}
                  </div>
                ))}

                {item.author === "assistant" && (
                  <div className="comment-box">
                    <input
                      value={commentDrafts[item.id] || ""}
                      onChange={(event) =>
                        setCommentDrafts((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          postComment(item.id);
                        }
                      }}
                      placeholder="写一条评论"
                    />
                    <button disabled={Boolean(pendingMomentComments[item.id])} aria-busy={Boolean(pendingMomentComments[item.id])}
                      onClick={() => postComment(item.id)}>{pendingMomentComments[item.id] ? "保存中" : "发送"}</button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    );
  }


  function renderDiscover() {
    return (
      <div className="fun-view">
        <header className="fun-view-header">
          <h2>🔭 发现</h2>
          <p>基于你的一起看记录,AI 帮你从 B 站找到感兴趣的视频</p>
        </header>
        <div className="notification-feature-panel device-activity-panel">
          <div className="device-activity-heading">
            <div>
              <strong>兴趣画像</strong>
              <span>
                {discoverState.interests.length > 0
                  ? discoverState.interests
                      .slice(0, 6)
                      .map((item) => item.term)
                      .join("、")
                  : "一起看几个视频后,这里会出现你的兴趣关键词"}
              </span>
            </div>
            <div className="device-activity-actions">
              <button
                type="button"
                disabled={discoverState.busy}
                onClick={() => void loadDiscover()}
              >
                {discoverState.busy ? "正在找…" : "换一批"}
              </button>
            </div>
          </div>
          {["interests", "recommend"].map(section => {
            const feedback = discoverState.sections[section];
            return feedback.status === "error" ? <div key={section} className="fun-labs-feedback is-error">
              <p role="status">{section === "interests" ? "兴趣档案" : "视频推荐"}暂时无法读取。{feedback.reason} {feedback.action}</p>
              <small>错误代码：{feedback.diagnostic.error_code}{feedback.diagnostic.http_status ? ` · HTTP ${feedback.diagnostic.http_status}` : ""}</small>
              <ChatErrorLog key={feedback.diagnostic.error_log_id || feedback.diagnostic.error_code} logId={feedback.diagnostic.error_log_id} diagnostic={feedback.diagnostic} feedbackByCode={DISCOVERY_ERROR_FEEDBACK} />
            </div> : null;
          })}
        </div>
        {discoverState.recommend?.reason ? (
          <p className="fun-labs-line">💡 {discoverState.recommend.reason}</p>
        ) : null}
        {discoverState.recommend?.videos?.length > 0 ? (
          <div className="discover-grid">
            {discoverState.recommend.videos.map((video) => (
              <article key={video.bvid} className="discover-card">
                <div className="discover-card-cover">
                  {video.cover ? (
                    <img
                      src={video.cover.startsWith("//") ? "https:" + video.cover : video.cover.replace(/^http:\/\//, "https://")}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                        const fallback = event.currentTarget.parentElement?.querySelector(".discover-card-cover-fallback");
                        if (fallback) fallback.style.display = "grid";
                      }}
                    />
                  ) : null}
                  <div className="discover-card-cover-fallback">📺</div>
                </div>
                <div className="discover-card-body">
                  <strong>{video.title}</strong>
                  <small>
                    {video.author} · 播放 {video.play} · {video.duration}
                  </small>
                  <div className="discover-card-actions">
                    <button
                      type="button"
                      onClick={() => {
                        openCompanionActivity({ id: "discover-" + video.bvid, kind: "watch", query: video.title, pageUrl: "https://www.bilibili.com/video/" + video.bvid });
                      }}
                    >
                      ▶ 一起看
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const request = getMomentsRequestScope();
                        if (request) void copyDiscoveryLink(video.bvid, { current: () => request.current() && funTokenRef.current === funToken, feedback: setNotice });
                      }}
                    >
                      复制链接
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : discoverState.busy ? (
          <p className="fun-labs-line">正在根据你的口味找视频…</p>
        ) : discoverState.sections.recommend.status === "success" ? (
          <p className="fun-labs-line">
            这次没有找到匹配的视频。可以换一批，或继续一起看，让推荐逐渐了解你的口味。
          </p>
        ) : null}
      </div>
    );
  }

  function renderTakeout() {
    const available = takeoutPluginAvailable();
    return (
      <div className="fun-view">
        <header className="fun-view-header">
          <h2>🛵 外卖点单</h2>
          <p>让 AI 帮你搜店、挑店、加购；付款永远由你在页面里亲自确认。</p>
        </header>
        <TakeoutQueryPanel
          key={JSON.stringify([accountStorageScope, companionScope, takeoutActivityRequest?.id || "takeout"])}
          initialQuery={activityRequestInScope(takeoutActivityRequest, accountStorageScope, companionScope)?.query || ""}
          onPrepare={query => {
            setMessage(current => appendActivityDraft(current, "帮我搜索外卖店铺：" + query));
            changeView("chat");
          }}
        />
        <div className="notification-feature-panel device-activity-panel">
          <div className="device-activity-heading">
            <div>
              <strong>登录外卖平台</strong>
              <span>{available ? "Android · 本机执行" : "仅 Android App 可用"}</span>
            </div>
            <div className="device-activity-actions">
              {takeoutLoginState.checked && (
                <em
                  className={
                    takeoutLoginState.loggedIn
                      ? "takeout-login-state is-logged-in"
                      : "takeout-login-state"
                  }
                >
                  {takeoutLoginState.loggedIn
                    ? "检测到本机登录 Cookie"
                    : takeoutLoginState.hasCookie
                      ? "有 Cookie，登录状态待确认"
                      : "未登录"}
                </em>
              )}
            </div>
          </div>
          <p>
            登录后，AI 可以在聊天里帮你找吃的（例如“帮我找家附近的烧烤，预算 30”）。平台登录态只保存在本机
            WebView，不会上传服务器。
          </p>
          <p
            className={`notification-feature-feedback ${takeoutLoginFeedback.status}`}
            role="status"
            aria-live="polite"
          >
            {takeoutLoginFeedback.message}
          </p>
          <div className="device-activity-actions">
            <button type="button" onClick={() => void openTakeoutQrLogin()}>
              扫码登录外卖
            </button>
          </div>
          <small>
            {available
              ? "本机 Cookie 仅用于初步检测；平台可能要求重新登录或验证。AI 只在你主动要求点单时派发命令。"
              : "外卖扫码登录与点单由手机本地执行，仅 Android App 可用；网页版请使用聊天里的其它玩法。"}
          </small>
        </div>
        <div className="notification-feature-panel device-activity-panel">
          <p>
            <strong>怎么用：</strong>
            回到聊天页直接说“帮我点个吃的”，AI 会先搜索店铺挑出最合适的一家，再把商品加进购物车并停在结算页，由你人工确认付款。
          </p>
        </div>
      </div>
    );
  }

  function renderAchievements() {
    const unlockedCount = funLabsState.achievements.filter(
      (item) => item.unlocked,
    ).length;
    return (
      <div className="fun-view">
        <header className="fun-view-header">
          <h2>🏆 成就</h2>
          <p>
            {funLabsState.achievements.length > 0
              ? `已经留下 ${unlockedCount} 份小纪念 · 按自己的节奏慢慢发现`
              : funLabsState.sections.achievements.status === "error" ? "暂时无法读取，刷新后继续。" : funLabsState.sections.achievements.status === "success" ? "还没有小纪念，可以留一个自己的目标。" : "正在读取小纪念…"}
          </p>
        </header>
        {renderAchievementGuide()}
        <CompanionInspiration key={funScope} disabled={isVoiceInputBusy} onUse={text => {
          setMessage(current => current ? `${current}\n${text}` : text);
          changeView("chat");
        }} />
        <div className="notification-feature-panel device-activity-panel">
          <div className="device-activity-heading">
            <div>
              <strong>成就墙</strong>
              <span>完成后自动记录 · 不必集齐，也没有截止日期</span>
            </div>
            <div className="device-activity-actions">
              <button type="button" onClick={() => void refreshFunLabs()}>
                刷新
              </button>
              <button
                type="button"
                className="fun-onboarding-button"
                onClick={openAchievementGuide}
              >
                ✧ 使用路线
              </button>
            </div>
          </div>
          <FunLabsFeedback key={funScope + ":achievements"} section={funLabsState.sections.achievements} title="成就"
            hasSavedData={funLabsState.achievements.length > 0} onRetry={() => void refreshFunLabs(["achievements"])} />
          {achievementAction?.scope === funToken && <div className="fun-labs-feedback">
            <p role="status">{achievementAction.status === "busy" ? "正在确认成就操作…" : achievementAction.message}</p>
            {achievementAction.status === "error" && <>
              <button type="button" onClick={() => void refreshFunLabs(["achievements"])}>刷新列表核对</button>
              <ChatErrorLog key={achievementAction.diagnostic.error_log_id || achievementAction.diagnostic.error_code}
                logId={achievementAction.diagnostic.error_log_id} diagnostic={achievementAction.diagnostic} feedbackByCode={ACHIEVEMENT_ERROR_FEEDBACK} />
            </>}
          </div>}
          {
            <div className="fun-achievements-wrap">
              <div className="fun-achievements-grid">
                {funLabsState.achievements.map((item) => (
                  <div
                    key={item.code || item.id}
                    className={`fun-achievement-card${
                      item.unlocked ? " is-unlocked" : ""
                    }`}
                  >
                    <span className="fun-achievement-emoji" aria-hidden="true">
                      {item.emoji || "✧"}
                    </span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                    <small>{item.unlocked ? "✓ 已留下这份纪念" : "有兴趣时再试试"}</small>
                    {!item.unlocked && !item.custom && ACHIEVEMENT_ACTIONS[item.code] && <button type="button" onClick={() => {
                      const target = ACHIEVEMENT_ACTIONS[item.code].view;
                      if (target === "guide") openAchievementGuide();
                      else changeView(target);
                    }}>{ACHIEVEMENT_ACTIONS[item.code].label}</button>}
                    {item.custom && !item.unlocked ? (
                      <div className="fun-achievement-card-actions">
                        <button
                          type="button"
                          disabled={achievementAction?.scope === funToken && achievementAction.status === "busy"}
                          onClick={() =>
                            void unlockCustomAchievement(item.code)
                          }
                        >
                          完成
                        </button>
                        <button
                          type="button"
                          disabled={achievementAction?.scope === funToken && achievementAction.status === "busy"}
                          onClick={() =>
                            void removeCustomAchievement(item.id)
                          }
                        >
                          删除
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="fun-achievement-form">
                <input
                  value={customAchievement.emoji}
                  onChange={(event) =>
                    setCustomAchievement((previous) => ({
                      ...previous,
                      emoji: event.target.value,
                    }))
                  }
                  placeholder="🎯"
                  aria-label="成就图标"
                  className="fun-achievement-emoji-input"
                />
                <input
                  value={customAchievement.title}
                  onChange={(event) =>
                    setCustomAchievement((previous) => ({
                      ...previous,
                      title: event.target.value,
                    }))
                  }
                  placeholder="自定义成就名，如：一起看 100 部电影"
                  aria-label="成就名称"
                />
                <input
                  value={customAchievement.description}
                  onChange={(event) =>
                    setCustomAchievement((previous) => ({
                      ...previous,
                      description: event.target.value,
                    }))
                  }
                  placeholder="完成条件（可选）"
                  aria-label="完成条件"
                />
                <button
                  type="button"
                  aria-label="添加自定义成就"
                  disabled={customAchievementBusy || !!customAchievementRecovery || (achievementAction?.scope === funToken && achievementAction.status === "busy") || !customAchievement.title.trim()}
                  aria-busy={customAchievementBusy}
                  onClick={() => void addCustomAchievement()}
                >
                  {customAchievementBusy ? "正在保存…" : "＋ 添加自定义成就"}
                </button>
                {customAchievementRecovery && <>
                  <p role="status">保存结果尚未确认，本页已暂停添加。请先读取当前账号和伴侣的成就列表，人工核对是否已保存。</p>
                  <small>本次提交：{customAchievementRecovery.submitted.title} · {customAchievementRecovery.submitted.description || "未填写完成条件"}</small>
                  <button type="button" disabled={customAchievementRecovery.status === "busy"} onClick={() => void reviewCustomAchievementCreation()}>
                    {customAchievementRecovery.status === "busy" ? "正在读取当前成就列表…" : "读取当前成就列表核对"}
                  </button>
                  {customAchievementRecovery.status === "error" && <p role="status">列表读取未确认，添加继续暂停。请重试读取后再核对。</p>}
                  {customAchievementRecovery.status === "reviewed" && <>
                    <p role="status">当前列表已读取。请核对本次目标；同名目标不代表本次创建成功，核对后再决定是否调整草稿继续添加。</p>
                    <button type="button" onClick={resumeCustomAchievementCreation}>我已核对列表，恢复添加</button>
                  </>}
                </>}
              </div>
              <small>名称最多 40 字，完成条件最多 120 字，图标最多 4 个字符。手动完成的小目标由你决定。</small>
              <div className="achievement-starter-actions" aria-label="小目标灵感">
                <span>不知道写什么？</span>
                {[{ title: "今天分享一首歌", emoji: "🎵", description: "挑一首喜欢的歌，在一起听歌中分享。" },
                  { title: "一起完成两分钟小任务", emoji: "✨", description: "从一起玩里选个小任务，完成后回来留下纪念。" }].map(starter =>
                  <button key={starter.title} type="button" disabled={!!customAchievement.title || !!customAchievement.description || !!customAchievement.emoji || customAchievementBusy}
                    onClick={() => setCustomAchievement(starter)}>{starter.emoji} {starter.title}</button>)}
                <small>只填入草稿，点添加后才保存。</small>
              </div>
            </div>
          }
        </div>
        <div className="notification-feature-panel device-activity-panel">
          <div className="device-activity-heading">
            <div>
              <strong>纪念日 · 追番 · 每日一拍</strong>
              <span>聊天中管理，这里查看</span>
            </div>
          </div>
          <h3 className="fun-labs-section-title">纪念日与追番</h3>
          <FunLabsFeedback key={funScope + ":dates"} section={funLabsState.sections.dates} title="纪念日"
            hasSavedData={funLabsState.dates.length > 0} onRetry={() => void refreshFunLabs(["dates"])} />
          {dateDeleteState?.scope === funToken && dateDeleteState.status === "error" && <div className="fun-labs-feedback">
            <p role="status">删除结果尚未确认。请先刷新核对，暂勿重复删除。</p>
            <button type="button" onClick={() => { setDateDeleteState(null); void refreshFunLabs(["dates"]); }}>刷新核对</button>
            <ChatErrorLog key={dateDeleteState.diagnostic.error_log_id || dateDeleteState.diagnostic.error_code} logId={dateDeleteState.diagnostic.error_log_id} diagnostic={dateDeleteState.diagnostic} feedbackByCode={FUN_LABS_ERROR_FEEDBACK} />
          </div>}
          {funLabsState.dates.length > 0 ? (
            <div className="fun-labs-list">
              {funLabsState.dates.slice(0, 10).map((date) => (
                <div key={date.id} className="fun-labs-row">
                  <span>
                    {date.kind === "show" ? "📺" : "💝"} {date.title}
                  </span>
                  <small>
                    {date.event_date}
                    {date.next_episode ? " " + date.next_episode : ""}
                  </small>
                  <button
                    type="button"
                    disabled={dateDeleteState?.scope === funToken && dateDeleteState.status === "busy"}
                    onClick={() => void removeSpecialDate(date.id)}
                  >
                    {dateDeleteState?.scope === funToken && dateDeleteState.status === "busy" && dateDeleteState.id === date.id ? "删除中…" : "删除"}
                  </button>
                </div>
              ))}
            </div>
          ) : funLabsState.sections.dates.status === "success" ? (
            <p className="fun-labs-line">
              还没有保存的日子。在聊天里说“记住我们的纪念日”“追番鬼灭之刃”即可添加。
            </p>
          ) : null}
          <h3 className="fun-labs-section-title">每日一拍</h3>
          <FunLabsFeedback key={funScope + ":shots"} section={funLabsState.sections.shots} title="照片"
            hasSavedData={Boolean(funLabsState.shots.today || funLabsState.shots.recent.length)} onRetry={() => void refreshFunLabs(["shots"])} />
          {funLabsState.shots?.today ? (
            <p className="fun-labs-line">
              今天已拍每日一拍
              {funLabsState.shots.today.note
                ? `：${funLabsState.shots.today.note}`
                : ""}
            </p>
          ) : funLabsState.sections.shots.status === "success" ? <p className="fun-labs-line">今天还没有照片，可以在聊天中发送照片并说“记下今天的每日一拍”。</p> : null}
          <small>在聊天里直接说“看看我的纪念日/成就”也能查。</small>
        </div>
      </div>
    );
  }

  function renderMemories() {
    return (
      <section className="feature-page memory-page">
        <FeatureAtmosphere kind="memory" />
        <Suspense fallback={<DeferredFeature label="正在打开伴侣画像…" />}>
          <CompanionProfile
            aiName={effectiveAiName}
            onNotice={setNotice}
            onOpenCreativeStudio={() => changeView("art")}
          />
        </Suspense>
        <div className="section-intro">
          <span className="eyebrow">长期记忆</span>
          <h2>留在家里的事情</h2>
          <p>这些摘要会作为真实模型回复时的长期背景。</p>
        </div>
          <MemoryGatewayStatus key={privateMediaScope} scopeKey={privateMediaScope} />
        <Suspense fallback={<DeferredFeature label="正在打开记忆档案…" />}>
          <OmbreMemories onManageConnections={openExternalMemorySettings} />
        </Suspense>
        <Suspense fallback={<DeferredFeature label="正在打开对话摘要…" />}>
          <LocalMemorySummaries
            key={privateMediaScope}
            scopeKey={privateMediaScope}
            items={memories}
            drafts={memoryDrafts}
            onItemsChange={setMemories}
            onDraftsChange={setMemoryDrafts}
            onNotice={setNotice}
          />
        </Suspense>
      </section>
    );
  }

  function renderDiary() {
    return (
      <div className="diary-library">
      <Suspense fallback={<DeferredFeature label="正在打开记忆手记…" />}>
        <CompanionDiary
          key={privateMediaScope}
          scopeKey={privateMediaScope}
          aiName={effectiveAiName}
          onNotice={setNotice}
        />
      </Suspense>
      <Suspense fallback={<DeferredFeature label="正在打开故事章节…" />}>
        <StoryChapters key={privateMediaScope} accountScope={accountStorageScope} companionScope={companionScope} />
      </Suspense>
      </div>
    );
  }

  function renderArtStudio() {
    return <Suspense fallback={<DeferredFeature label="正在打开涂鸦画室…" />}><CompanionArtStudio key={privateMediaScope} scopeKey={privateMediaScope} aiName={effectiveAiName} onNotice={setNotice} onOpenImageProviderSettings={openCreativeProviderSettings} /></Suspense>;
  }

  function renderNursery() {
    return (
      <Suspense
        fallback={
          <section className="feature-page nursery-page is-loading">
            正在回家…
          </section>
        }
      >
        <Nursery
          key={privateMediaScope}
          aiName={effectiveAiName}
          onNotice={setNotice}
        />
      </Suspense>
    );
  }

  function renderIntimateDuel() {
    return (
      <Suspense fallback={<DeferredFeature label="正在打开双人对战…" />}>
        <IntimateDuel
          key={JSON.stringify([accountStorageScope, companionScope])}
          aiName={effectiveAiName}
          userName={effectiveUserName}
          conversationId={activeSessionId}
          accountScope={accountStorageScope}
          companionScope={companionScope}
        />
      </Suspense>
    );
  }

  function openCompanionActivity(action) {
    const request = buildCompanionActivityRequest(action, accountStorageScope, companionScope);
    if (!request) return;
    if (request.kind === "music") {
      setMusicActivityRequest(request);
      setTogetherEntryMode("music"); changeView("music");
    } else if (request.kind === "watch") {
      setWatchActivityRequest(request);
      setTogetherEntryMode("external"); changeView("together");
    } else if (request.kind === "takeout") {
      setTakeoutActivityRequest(request); changeView("takeout");
    } else if (request.kind === "art") {
      changeView("art");
    }
  }

  function renderDlnaCastPlayer() {
    return (
      <DlnaCastPlayer
        key={JSON.stringify([accountStorageScope, companionScope, dlnaCastInfo?.receivedAt || "cast"])}
        info={dlnaCastInfo}
        userName={effectiveUserName}
        aiName={effectiveAiName}
        onClose={() => {
          setDlnaCastInfo(null);
          setActiveView("chat");
        }}
      />
    );
  }

  function renderTogether(viewKind = "together") {
    return (
      <Suspense fallback={<DeferredFeature label="正在打开一起看…" />}>
        <Together
          key={JSON.stringify(["together", accountStorageScope, companionScope, togetherEntryMode])}
          musicRequest={musicActivityRequest?.accountScope === accountStorageScope && musicActivityRequest?.companionScope === companionScope ? musicActivityRequest : null}
          aiName={effectiveAiName}
          accountScope={accountStorageScope}
          companionScope={companionScope}
          watchRequest={activityRequestInScope(watchActivityRequest, accountStorageScope, companionScope)}
          session={coWatchSession}
          receipt={coWatchReceipt}
          screenState={screenGlanceState}
          preview={coWatchPreview}
          feedback={screenGlanceFeedback}
          dialog={coWatchDialog}
          busy={isScreenGlanceBusy}
          onStart={(options) =>
            void startScreenGlanceSession({ ...options, watchTogether: true })
          }
          onStartDirect={startDirectMediaCoWatchSession}
          onPause={(paused) => void setScreenGlancePaused(paused)}
          onStop={(options) => void stopScreenGlanceSession(options)}
          onStopDirect={stopDirectMediaCoWatchSession}
          onStartMusic={startMusicCoWatchSession}
          onStopMusic={stopMusicCoWatchSession}
          onMusicPlaybackChange={(snapshot) => void updateMusicCoWatchPlayback(snapshot)}
          onLocalPlaybackChange={onLocalPlaybackChange}
          onMusicUnderstandingSaved={handleMusicUnderstandingSaved}
          onPlaybackChange={updateDirectMediaCoWatchPlayback}
          castPairing={castPairing}
          castReceiver={coWatchSession?.castReceiver}
          onGenerateCastPairing={generateCastPairingCode}
          onRefresh={(mode) =>
            void refreshCoWatchExperience({ mode: resolveCoWatchSessionMode(mode) })
          }
          onReply={async (text, playbackPositionSeconds) => {
            const target = coWatchSessionRef.current;
            if (!target?.id || target.id !== coWatchSession?.id || coWatchBusyRef.current || coWatchReplyJobRef.current || settingsSaveScope(authSession.getSnapshot()) !== privateMediaScope) return false;
            const lifecycle = coWatchLifecycleRef.current;
            const stamp = lifecycle.capture();
            const viewScope = coWatchViewScopeRef.current;
            const viewStamp = viewScope.capture({ mode: target.sessionMode, channel: "reply" });
            const job = {};
            coWatchReplyJobRef.current = job;
            const ownsOperation = () => coWatchReplyJobRef.current === job && lifecycle.current(stamp) && settingsSaveScope(authSession.getSnapshot()) === privateMediaScope;
            const current = () => ownsOperation() && coWatchSessionRef.current?.id === target.id && viewScope.current(viewStamp);
            const pendingId = `pending-${Date.now()}`;
            setCoWatchDialog((current) => [
              ...current,
              {
                key: pendingId,
                id: pendingId,
                role: "user",
                text,
                at: new Date().toISOString(),
              },
            ]);
            coWatchBusyRef.current = true;
            setIsScreenGlanceBusy(true);
            setScreenGlanceFeedback(previous => previous?.operation === "co-watch-reply"
              ? { status: "checking", operation: "co-watch-reply", message: "正在发送这句共看消息…" }
              : previous);
            try {
              const result = await sendCoWatchReply(
                target.id,
                text,
                playbackPositionSeconds ?? target.mediaPositionSeconds,
              );
              if (!current()) return false;
              if (result?.session && result.session.id !== target.id) {
                throw new Error("共看回复的会话确认不匹配，请重新读取当前会话。（错误代码：co_watch_reply_receipt_invalid）");
              }
              const reactionText = String(result?.reaction || (typeof result?.assistantMessage?.content === "string" ? result.assistantMessage.content : "")).trim();
              if (!reactionText) {
                throw new Error("服务没有返回可显示的共看回复，本次未确认成功，输入仍保留。请先刷新当前对话核对是否已发送，再决定重试。（错误代码：co_watch_reply_receipt_invalid）");
              }
              if (result?.session) {
                coWatchSessionRef.current = result.session;
                setCoWatchSession(result.session);
              }
              // 把 AI 的本场回应加入对话气泡（之前只刷新会话，回复没显示出来）
              if (reactionText) {
                setCoWatchDialog((current) => [
                  ...current.filter((item) => item.key !== pendingId),
                  {
                    key: "reply-" + (result?.requestId || Date.now()),
                    id: "reply-" + (result?.requestId || Date.now()),
                    role: "assistant",
                    text: reactionText,
                    at: new Date().toISOString(),
                  },
                ]);
              }
              if (Array.isArray(result?.danmaku) && result.danmaku.length) {
                setCoWatchDanmaku((current) => [
                  ...current,
                  ...result.danmaku.map((item) => ({
                    ...item,
                    media_time_seconds: Number(item.media_time_seconds) || 0,
                  })),
                ]);
              }
              setScreenGlanceFeedback(previous => previous?.operation === "co-watch-reply"
                ? { status: "idle", message: "这句共看消息已收到回复。" }
                : previous);
              await refreshCoWatchExperience({ silent: true });
              return true;
            } catch (error) {
              if (!current()) return false;
              setCoWatchDialog((current) =>
                current.filter((item) => item.key !== pendingId),
              );
              setScreenGlanceFeedback({
                status: "error",
                operation: "co-watch-reply",
                message: error?.message || "这句共看消息没有发送成功。",
              });
              return false;
            } finally {
              const releaseBusy = ownsOperation();
              if (coWatchReplyJobRef.current === job) coWatchReplyJobRef.current = null;
              if (releaseBusy) {
                coWatchBusyRef.current = false;
                setIsScreenGlanceBusy(false);
              }
            }
          }}
          viewKind={viewKind}
          danmaku={coWatchDanmaku}
          externalPageUrl={activityRequestInScope(watchActivityRequest, accountStorageScope, companionScope)?.pageUrl || ""}
        />
      </Suspense>
    );
  }

  function renderSettings() {
    const serviceCards = buildServiceStatusCards({
      health: serviceHealth.data,
      settings,
      hasLoadedSettings,
      isOnline,
      error: serviceHealth.error,
      voiceOutput: voiceOutputStatus,
      providerStatus,
    });
    const groqExpiry = describeGroqExpiry(groqExpiryDate);

    return (
      <section className="feature-page settings-page">
        {settingsExitBusy && <p role="status">正在保存设置并退出账号，请稍候…</p>}
        <fieldset disabled={settingsExitBusy} style={{ display: "contents" }}>
        <div className="section-intro settings-intro">
          <div>
            <span className="eyebrow">控制中心</span>
            <h2>AI 与应用设置</h2>
            <p>
              把外观、伴侣和日常陪伴调成你喜欢的样子。
            </p>
          </div>
          <WebInstallButton
            className="install-button"
            promptLabel="⤓ 安装到手机/电脑"
            guidanceLabel="⤓ 安装到手机/电脑"
            onFeedback={setNotice}
            showFeedback={false}
          />
        </div>

        <div hidden={Boolean(settingsCategory)}>
          <SettingsHome key={privateMediaScope} categories={SETTINGS_CATEGORIES} onSelectCategory={settingsCategoryNavigation.selectCategory} preferenceScope={privateMediaScope} />
        </div>
        {settingsCategory ? (
          <>
            <div className="settings-category-heading">
              <button
                type="button"
                className="settings-category-back"
                aria-label="返回设置分类"
                onClick={settingsCategoryNavigation.returnHome}
              >
                <ArrowLeft aria-hidden="true" />
              </button>
              <div>
                <span className="eyebrow">设置文件夹</span>
                <h3>
                  {SETTINGS_CATEGORIES.find(
                    (category) => category.id === settingsCategory,
                  )?.label || "设置"}
                </h3>
              </div>
            </div>

            {settingsCategory === "appearance" && (
              <>
                <Suspense fallback={<DeferredFeature label="正在打开外观设置…" />}>
                  <ThemeStudio
                    preferences={themePreferences}
                    updateTheme={updateTheme}
                    chatSkinPreferences={chatSkinPreferences}
                    updateChatSkin={updateChatSkinPreferences}
                  />
                </Suspense>
                <Suspense fallback={<DeferredFeature label="正在打开私密媒体设置…" />}>
                  <MediaSettings
                    key={privateMediaScope}
                    catalog={privateMediaCatalog}
                    loading={privateMediaLoading}
                    error={privateMediaError}
                    onRefresh={refreshPrivateMediaCatalog}
                    onCatalogChange={setPrivateMediaCatalog}
                    onPreview={handleImagePreview}
                  />
                </Suspense>
              </>
            )}

            {settingsCategory === "data-import" && (
              <Suspense fallback={<DeferredFeature label="正在打开导入手记…" />}>
                <ContentImport key={JSON.stringify([accountStorageScope, companionScope])} accountScope={accountStorageScope} companionScope={companionScope} />
              </Suspense>
            )}

            {settingsCategory === "data-export" && (
              <Suspense fallback={<DeferredFeature label="正在打开数据导出…" />}>
                <AccountExport />
              </Suspense>
            )}

            {settingsCategory === "music-import" && (
              <Suspense fallback={<DeferredFeature label="正在打开音乐导入…" />}>
                <MusicSettings key={JSON.stringify([accountStorageScope, companionScope])} accountScope={accountStorageScope} companionScope={companionScope} />
              </Suspense>
            )}

            {settingsCategory !== "data-import" && settingsCategory !== "music-import" && settingsCategory !== "data-export" && (
            <form className="settings-form" onSubmit={saveSettings}>
          {settingsCategory === "services" && (
            <div className="settings-card service-manager-card">
            <div className="service-manager-heading">
              <div>
                <h3>服务管理与故障检查</h3>
                <p className="card-hint">
                  这里只显示安全状态，不显示或保存任何 API Key。密钥、额度和账单仍由对应服务商管理。
                </p>
              </div>
              <button
                type="button"
                className="service-refresh-button"
                disabled={serviceHealth.checking}
                onClick={() => void refreshServiceHealth()}
              >
                {serviceHealth.checking ? "检查中…" : "重新检查"}
              </button>
            </div>

            <div className="service-status-grid">
              {serviceCards.map((service) => (
                <article
                  className={`service-status ${service.status}`}
                  key={service.id}
                >
                  <div className="service-status-title">
                    <span className="service-status-dot" aria-hidden="true" />
                    <strong>{service.name}</strong>
                    <em>{service.summary}</em>
                  </div>
                  <p>{service.detail}</p>
                  {service.link && (
                    <a href={service.link} target="_blank" rel="noreferrer">
                      {service.linkLabel} ↗
                    </a>
                  )}
                </article>
              ))}
            </div>

            <div className="service-expiry-panel">
              <label>
                Groq 密钥到期提醒
                <input
                  type="date"
                  value={groqExpiryDate}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setGroqExpiryDate(nextValue);
                    storeGroqExpiryDate(
                      nextValue,
                      globalThis.localStorage,
                      accountStorageScope,
                    );
                  }}
                />
              </label>
              <div className={`service-expiry-message ${groqExpiry.status}`}>
                <strong>本机提醒</strong>
                <span>{groqExpiry.text}</span>
                <small>日期只保存在当前设备，不会上传密钥或付款信息。</small>
              </div>
              <div className="service-quick-links">
                <a
                  href={SERVICE_LINKS.groqUsage}
                  target="_blank"
                  rel="noreferrer"
                >
                  Groq 用量
                </a>
                <a
                  href={SERVICE_LINKS.minimax}
                  target="_blank"
                  rel="noreferrer"
                >
                  MiniMax 账单
                </a>
                <a
                  href={SERVICE_LINKS.backend}
                  target="_blank"
                  rel="noreferrer"
                >
                  Render 后端
                </a>
              </div>
            </div>

            <div className="service-last-checked" role="status">
              {serviceHealth.checkedAt
                ? `最后检查：${formatDateTime(serviceHealth.checkedAt)}`
                : "尚未完成第一次检查"}
            </div>
            </div>
          )}

          {settingsCategory === "persona" && (
            <div className="settings-card prompt-settings-card">
            <div className="prompt-settings-heading">
              <div>
                <h3>个性化与长期详情</h3>
                <p className="card-hint">
                  “个性化指令”和“你的详情”都会原样进入 DengTa
                  可控范围内最高应用级的 instructions / system，不会改成普通聊天消息；稳定长期记忆、聊天历史和本轮临时补充仍保持独立。
                </p>
              </div>
              <span className="prompt-compatibility-badge">最高应用级</span>
            </div>

            <label className="prompt-name-field">
              <span>你的称呼</span>
              <small>每个账号单独保存，伴侣会用这个名字称呼当前账号。</small>
              <input
                data-setting-field="user_display_name"
                maxLength={PROMPT_FIELD_LIMITS.user_display_name}
                value={draftSettings.user_display_name || ""}
                onChange={(event) =>
                  updateDraft("user_display_name", event.target.value)
                }
                placeholder="你的名字或昵称"
              />
            </label>

            <label className="prompt-name-field">
              <span>AI 昵称</span>
              <small>当前伴侣独立保存，可以随时更名。</small>
              <input
                data-setting-field="ai_name"
                maxLength={PROMPT_FIELD_LIMITS.ai_name}
                value={draftSettings.ai_name || ""}
                onChange={(event) =>
                  updateDraft("ai_name", event.target.value)
                }
                placeholder="例如：星河"
              />
            </label>

            <CompanionGenderFields settings={draftSettings} onChange={updateDraft} />

            <div className="service-last-checked" role="status">
              当前账号权限：
              {settings.account_role === "owner"
                ? "所有者"
                : settings.account_role === "admin"
                  ? "管理员"
                  : "普通成员"}
              。账号状态、提示词、模型配置、密钥配置与伴侣数据均按账号隔离保存。
            </div>

            <div className="prompt-layer-list unified-prompt-layout">
              {settingsNeedsUnifiedPromptMigration(draftSettings) && <div className="mcp-setup-required">
                <p>当前使用旧版个性化字段。修改昵称或性别不会合并或改写它们；点击下方按钮可将原文带标题复制到个性化指令。</p>
                <button type="button" className="secondary-button" onClick={() => updateUnifiedPrompt(mergeLegacyPromptFields(draftSettings))}>将旧版字段复制到个性化指令</button>
              </div>}
              <div className="prompt-layer highest-priority unified-prompt-layer">
                <span className="prompt-layer-title">
                  <span className="prompt-priority-number">指</span>
                  <span>
                    <strong>个性化指令</strong>
                    <small>
                      原文进入模型的 instructions / system
                    </small>
                  </span>
                  <em>长期保存</em>
                </span>
                <p>
                  写下希望伴侣长期遵循的身份、关系、表达方式和规则。保存时保留原文的空格与换行；旧版字段只在你主动选择复制时合并。
                </p>
                <PersonalizationEditor
                  field="unified_system_prompt"
                  label="个性化指令"
                  scopeKey={privateMediaScope}
                  value={draftSettings.unified_system_prompt || ""}
                  onChange={updateUnifiedPrompt}
                  placeholder="写清楚稳定身份、关系和表达习惯……"
                  disabled={!hasLoadedSettings || settingsExitBusy}
                />
              </div>

              <div className="prompt-layer highest-priority unified-prompt-layer">
                <span className="prompt-layer-title">
                  <span className="prompt-priority-number">详</span>
                  <span>
                    <strong>你的详情</strong>
                    <small>
                      与个性化指令同属最高应用级
                    </small>
                  </span>
                  <em>长期保存</em>
                </span>
                <p>
                  写下希望伴侣在每轮对话都了解的长期详情。这里的原文同样不做语义解析或
                  trim，并与个性化指令一起放入最高应用级 instructions / system。
                </p>
                <PersonalizationEditor
                  field="user_details"
                  label="你的详情"
                  scopeKey={privateMediaScope}
                  value={draftSettings.user_details || ""}
                  onChange={value => updateDraft("user_details", value)}
                  placeholder="例如：称呼、长期偏好、重要背景，以及希望伴侣始终记得的个人详情……"
                  disabled={!hasLoadedSettings || settingsExitBusy}
                />
              </div>

              <div className="prompt-layer style-distill-panel">
                <span className="prompt-layer-title">
                  <span className="prompt-priority-number">蒸</span>
                  <span>
                    <strong>风格提纯</strong>
                    <small>
                      粘贴目标 AI 的聊天记录，蒸馏出可直接使用的提示词文档
                    </small>
                  </span>
                </span>
                <p>
                  把你想模仿的那个 AI 的聊天记录(微信/其他平台/文档)导入进来，或直接粘贴文本；提纯后会在新窗口展示一份「个性化指令」文档，你可以修改、复制，再一键填到上方。
                </p>
                <input
                  value={distillState.name}
                  onChange={(event) =>
                    setDistillState((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                  placeholder="目标角色名字(可选)，如：小灯"
                  aria-label="目标角色名字"
                  disabled={distillState.busy}
                />
                <label>
                  提纯使用的模型
                  <select aria-label="提纯使用的模型" value={distillState.model}
                    disabled={distillState.busy}
                    onChange={(event) => setDistillState((previous) => ({ ...previous, model: event.target.value }))}>
                    <option value="">当前账号默认模型（{settings.model || "由服务器解析"}）</option>
                    {availableModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                </label>
                <label className="style-distill-file-row">
                  <input
                    type="file"
                    accept=".md,.markdown,.txt,.text,.json,.jsonl,.ndjson,.html,.htm,.csv,.tsv,.log,.srt,.vtt,.eml,.pdf,.docx,.xml,.yaml,.yml,.ini,.conf"
                    onChange={(event) => void parseDistillFile(event)}
                    disabled={distillState.busy}
                  />
                  <span>导入聊天记录文件（自动识别 md / txt / json / html / csv / srt / eml / pdf / docx）</span>
                  <small>纯文本最大 1GB，超过 20MB 分块扫描取样；文档直传最大 20MB。提纯一次分析最多 6 万字。</small>
                </label>
                {distillState.fileInfo ? (
                  <p className="style-distill-file-info" role="status">
                    已导入：{distillState.fileInfo.filename}（{distillState.fileInfo.format} · {distillState.fileInfo.characters} 字），可直接提纯或继续编辑。
                    {distillState.fileInfo.sampled ? `已扫描约 ${distillState.fileInfo.totalCharacters} 字，当前为位置取样；模型只分析样本。` : distillState.fileInfo.truncated ? "文件较长，本次只导入前 6 万字，请分批处理剩余材料。" : ""}
                  </p>
                ) : null}
                <textarea
                  value={distillState.source}
                  onChange={(event) =>
                    setDistillState((previous) => ({
                      ...previous,
                      source: event.target.value,
                    }))
                  }
                  placeholder="粘贴聊天记录，或先导入文件……（至少 40 字，最多 6 万字）"
                  rows="6"
                  disabled={distillState.busy}
                />
                <div className="device-activity-actions">
                  {distillState.fileBusy && <button type="button" onClick={() => distillFileControllerRef.current?.abort()}>取消读取（{distillState.readPercent || 0}%）</button>}
                  <button
                    type="button"
                    disabled={distillState.busy || distillState.source.trim().length < 40}
                    onClick={() => void runDistill()}
                  >
                    {distillState.busy
                      ? distillState.fileBusy
                        ? "正在解析文件…"
                        : "正在提纯…"
                      : "开始提纯"}
                  </button>
                </div>
                {distillState.error ? (
                  <div className="notification-feature-feedback error">
                    <p role="alert">{distillState.error}</p>
                    <p>材料仍然保留。检查模型与接口设置后，可再次点「开始提纯」。</p>
                    {distillState.diagnostic ? <ChatErrorLog key={distillState.diagnostic.error_log_id || distillState.error}
                      logId={distillState.diagnostic.error_log_id} diagnostic={distillState.diagnostic} feedbackByCode={DISTILL_ERROR_FEEDBACK} /> : null}
                  </div>
                ) : null}
              </div>

              <section className="prompt-memory-summary" aria-label="稳定长期记忆摘要">
                <div>
                  <span className="prompt-memory-icon" aria-hidden="true">∞</span>
                  <span>
                    <strong>稳定长期记忆摘要</strong>
                    <small>由后端筛选，独立放在两项最高应用级指令之后</small>
                  </span>
                </div>
                <p>
                  这里不重复展示或编辑记忆正文，避免意外覆盖。最近回执记录了{" "}
                  {lastPromptReceipt?.delivery?.stableMemory?.count ??
                    memories.length}{" "}
                  条记忆
                  {lastPromptReceipt?.delivery?.stableMemory?.chars !== null &&
                    lastPromptReceipt?.delivery?.stableMemory?.chars !==
                      undefined &&
                    `，共 ${lastPromptReceipt.delivery.stableMemory.chars} 字`}
                  。
                </p>
              </section>

              <label className="prompt-layer additional-priority temporary-context-layer">
                <span className="prompt-layer-title">
                  <span className="prompt-priority-number">+</span>
                  <span>
                    <strong>本轮临时补充</strong>
                    <small>只随下一条文字或语音消息发送</small>
                  </span>
                  <em>不长期保存</em>
                </span>
                <p>
                  写当前剧情背景、这一次必须注意的细节或临时语气。成功收到回复后自动清空；发送失败或你在等待时继续编辑，都不会丢失。
                </p>
                <textarea
                  data-setting-field="turn_context"
                  value={turnContext}
                  onChange={(event) => updateTurnContext(event.target.value)}
                  placeholder="例如：这一轮接着昨晚雨天回家的剧情……"
                  rows="5"
                />
              </label>

              <label className="prompt-intimacy-toggle">
                <input
                  type="checkbox"
                  checked={draftSettings.intimate_expression_enabled === true}
                  onChange={(event) =>
                    updateDraft(
                      "intimate_expression_enabled",
                      event.target.checked,
                    )
                  }
                />
                <span className="prompt-toggle-visual" aria-hidden="true" />
                <span className="prompt-toggle-copy">
                  <span>
                    <strong>亲密与成人表达</strong>
                    <small>
                      允许亲密、暧昧和明确成人表达；具体内容服从个性化指令、你的详情和当前对话
                    </small>
                  </span>
                  <em>
                    {draftSettings.intimate_expression_enabled
                      ? "已开启"
                      : "已关闭"}
                  </em>
                </span>
              </label>
            </div>

            {((draftSettings.unified_system_prompt || "").length >= 12000 ||
              (draftSettings.user_details || "").length >= 12000) && (
              <div className="prompt-effect-warning" role="note">
                <strong>最高应用级指令较长</strong>
                <p>
                  个性化指令当前有{" "}
                  {(draftSettings.unified_system_prompt || "").length} 字，你的详情有{" "}
                  {(draftSettings.user_details || "").length} 字。
                  后端仍会完整尝试发送，但中转供应商可能有自己的上下文上限；把最重要且稳定的规则放在前面更可靠。
                </p>
              </div>
            )}
            </div>
          )}

          {settingsCategory === "voice" && (
            <div className="settings-card voice-settings-card">
            <h3>语音与情绪理解</h3>
            <p className="card-hint">
              文字聊天会参考本轮文字；按住说话时才会申请麦克风并分析转写、语气和声音线索。
              结果不是心理诊断；如果理解不对，请直接告诉 AI，以你的自述为准。两个开关只保存在当前设备。
            </p>
            <div className="settings-grid">
              <label>
                情绪理解
                <select
                  value={String(emotionUnderstandingEnabled)}
                  onChange={(event) =>
                    updateEmotionUnderstanding(event.target.value === "true")
                  }
                >
                  <option value="false">关闭</option>
                  <option value="true">开启</option>
                </select>
              </label>
              <label>
                AI 回答的声音
                <select
                  value={voicePlaybackMode}
                  onChange={(event) => updateVoicePlaybackMode(event.target.value)}
                >
                  <option value={VOICE_PLAYBACK_MODES.off}>关闭</option>
                  <option value={VOICE_PLAYBACK_MODES.expressive}>
                    自然云端语音（推荐）
                  </option>
                </select>
              </label>
            </div>
            <div className="voice-privacy-note">
              <strong>当前发声方式</strong>
              <p>
                {
                  describeExpressiveTts({
                    expressive_tts_configured:
                      voiceService.expressiveAvailable,
                    expressive_tts_enabled:
                      voiceService.expressiveEnabled,
                    expressive_tts_chinese_fallback_available:
                      voiceService.expressiveChineseFallbackAvailable,
                    expressive_tts_api_key_configured:
                      voiceService.expressiveApiKeyConfigured,
                    expressive_tts_voice_configured:
                      voiceService.expressiveVoiceConfigured,
                    expressive_tts_provider:
                      voiceService.expressiveProvider,
                  }).settingsText
                }
              </p>
            </div>
            <div className="voice-privacy-note">
              <strong>麦克风与隐私</strong>
              <p>
                只有按住聊天页的“按住说话”按钮时才录音；松开后立即发送，最长 60 秒。
                手机端不会把录音写入相册、本地文件或本地存储，但松开后会上传到 DengTa / HerVoice 服务。
                语音文件会发送给服务器配置的语音转写服务（例如 Groq Whisper）；转写文字和声学特征会发送给情绪分类模型，再交给 AI 生成回复。
                麦克风录音的原文件默认在本次处理结束后删除；通过“附件”选择的文件（包括音频）会随聊天记录私密保存。
                页面隐藏、切换离开聊天页或取消录音时会关闭麦克风轨道；尚未发送的录音会丢弃。摄像头不会被调用。
                情绪理解流程基于 HerVoice 开源项目，由 DengTa home 接入并做了服务端安全加固。
              </p>
            </div>
            </div>
          )}

          {(["persona", "devices"].includes(settingsCategory)) && (
            <div className={`settings-card settings-shared-card settings-shared-card--${settingsCategory}`}>
            <h3>
              {settingsCategory === "persona"
                ? "记忆与主动消息"
                : "设备、活动感知与屏幕共看"}
            </h3>
            <p className="card-hint">
              {settingsCategory === "persona"
                ? "记忆压缩和影子主动消息均已启用；系统会定时判断是否应该主动联系你。"
                : "管理本机活动摘要、屏幕共享和一起看会话。"}
            </p>
            {settingsCategory === "persona" && (
              <>
            <ChatContextSettings settings={draftSettings} onChange={updateDraft} />
            <div className="settings-grid">
              <label>
                所在时区
                <input
                  value={draftSettings.timezone || "Asia/Shanghai"}
                  onChange={(event) =>
                    updateDraft("timezone", event.target.value)
                  }
                  placeholder="Asia/Shanghai"
                />
              </label>
              <label>
                主动消息
                <select
                  value={String(draftSettings.push_enabled === true)}
                  onChange={(event) =>
                    updateDraft("push_enabled", event.target.value === "true")
                  }
                >
                  <option value="false">关闭</option>
                  <option value="true">开启</option>
                </select>
              </label>
              <label>
                记忆压缩阈值（0 为自动）
                <input
                  type="number"
                  min="0"
                  max="10000000"
                  step="1000"
                  value={draftSettings.compression_threshold ?? 0}
                  onChange={(event) =>
                    updateDraft("compression_threshold", event.target.value)
                  }
                />
              </label>
              <label>
                压缩后保留的近期对话轮数
                <input
                  type="number"
                  min="1"
                  max="1000000"
                  value={draftSettings.compression_keep ?? 40}
                  onChange={(event) =>
                    updateDraft("compression_keep", event.target.value)
                  }
                />
              </label>
              <label>
                每日主动消息上限
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={draftSettings.max_push_per_day ?? 7}
                  onChange={(event) =>
                    updateDraft("max_push_per_day", event.target.value)
                  }
                />
              </label>
            </div>
            <div className="notification-feature-panel">
              <strong>主动通知</strong>
              <p>
                AI 会结合时间、最近聊天、记忆和每日上限，偶尔主动留下一两句话；不会每次检查都发送。
              </p>
              <p
                className={`notification-feature-feedback ${notificationPermissionState.status}`}
                role="status"
                aria-live="polite"
              >
                {notificationPermissionState.message}
              </p>
              {reminderChannelSettingsAvailable() && (
                <div className="device-activity-actions">
                  <button
                    type="button"
                    onClick={() =>
                      void openReminderNotificationSettings().catch(
                        (error) => {
                          setNotificationPermissionState({
                            status: "error",
                            message:
                              error?.message || "无法打开手机通知设置。",
                          });
                        },
                      )
                    }
                  >
                    打开手机通知设置
                  </button>
                </div>
              )}
              {Capacitor.isNativePlatform() ? (
                <small>
                  Android 为省电可能把后台检查延后；声音、震动和静音模式均由手机系统控制。
                </small>
              ) : (
                <small>
                  网页暂无后台声音和震动提醒；安装 Android App 后可在手机通知设置中控制。
                </small>
              )}
            </div>
            <MemoryImportCard />
              </>
            )}
            {settingsCategory === "logs" && (
              <ErrorLogsPanel key={JSON.stringify([accountStorageScope, companionScope])} accountScope={accountStorageScope} companionScope={companionScope} onOpenSettings={setSettingsCategory} />
            )}

            {settingsCategory === "devices" && (
              <>
            <div className="notification-feature-panel device-activity-panel">
              <div className="device-activity-heading">
                <div>
                  <strong>活动感知（只读取 App 名称）</strong>
                  <span>Android · 默认关闭</span>
                </div>
                <button
                  type="button"
                  className={`privacy-switch${
                    deviceActivityState.enabled ? " is-on" : ""
                  }`}
                  role="switch"
                  aria-checked={deviceActivityState.enabled}
                  aria-label={
                    deviceActivityState.enabled
                      ? "关闭活动感知"
                      : "开启活动感知"
                  }
                  disabled={
                    isDeviceActivityBusy || !deviceActivityState.supported
                  }
                  onClick={() =>
                    void setDeviceActivityEnabled(!deviceActivityState.enabled)
                  }
                >
                  <span aria-hidden="true" />
                </button>
              </div>
              <p>
                开启后，AI 最多会看到最近 30 分钟内少量 App
                的名称、打开次数和粗略前台时长。不会读取屏幕文字、截图、通知、键盘输入、剪贴板或账号内容。
              </p>
              <p>
                银行、支付、钱包、密码和验证器类 App 默认排除；摘要只用于当前对话背景，不会仅凭它写入长期记忆。
              </p>
              <p
                className={`notification-feature-feedback ${deviceActivityFeedback.status}`}
                role="status"
                aria-live="polite"
              >
                {deviceActivityFeedback.message}
              </p>
              <div className="device-activity-actions">
                <button
                  type="button"
                  disabled={
                    isDeviceActivityBusy || !deviceActivityState.supported
                  }
                  onClick={() => void openDeviceActivityPermission()}
                >
                  打开系统授权
                </button>
                <button
                  type="button"
                  disabled={
                    isDeviceActivityBusy ||
                    !deviceActivityState.enabled ||
                    !deviceActivityState.permissionGranted
                  }
                  onClick={() =>
                    void refreshDeviceActivityContext({ force: true })
                  }
                >
                  更新摘要
                </button>
                <button
                  type="button"
                  disabled={isDeviceActivityBusy || !deviceActivityState.enabled}
                  onClick={() => void clearDeviceActivity()}
                >
                  关闭并清除
                </button>
              </div>
              <small>
                Android 的“使用情况访问”是单独的系统权限；关闭本功能会立即停止附带摘要，撤销系统权限仍需在授权页操作。
              </small>
            </div>
            <div className="notification-feature-panel device-activity-panel">
              <div className="device-activity-heading">
                <div>
                  <strong>音乐识别（彩虹胶囊显示正在播放）</strong>
                  <span>
                    {!notificationAccess.supported
                      ? "仅 Android 客户端支持系统音乐识别"
                      : notificationAccess.errorMessage
                        ? notificationAccess.errorMessage
                        : notificationAccess.checking
                      ? "正在检查…"
                      : notificationAccess.granted
                        ? "已授权 · 播放时自动显示"
                        : "需要通知使用权"}
                  </span>
                </div>
              </div>
              <p>
                授权后，只要你在网易云、QQ 音乐或系统播放器里放歌，聊天页的彩虹胶囊就会变成旋转唱片，显示歌名、歌手、封面和播放控制（暂停 / 下一首）。仅读取媒体通知，不读取消息内容。
              </p>
              {notificationAccess.supported && (!notificationAccess.granted || notificationAccess.errorCode) && (
                <div className="device-activity-actions">
                  <button
                    type="button"
                    disabled={notificationAccess.checking || notificationAccess.opening}
                    onClick={() => void requestNotificationAccess()}
                  >
                    {notificationAccess.opening ? "正在打开系统设置…" : "去授权通知使用权"}
                  </button>
                  <button type="button" disabled={notificationAccess.checking || notificationAccess.opening} onClick={() => void refreshNotificationAccess()}>重新检查</button>
                </div>
              )}
              <small>
                授权入口在系统设置 → 通知与状态栏 → 通知使用权 → 允许“灯塔”。授权后回到本页，状态会自动更新。
              </small>
            </div>
            <div className="notification-feature-panel screen-glance-panel">
              <div className="device-activity-heading">
                <div>
                  <strong>屏幕共看</strong>
                  <span>
                    {screenGlanceState.active
                      ? screenGlanceState.paused
                        ? "Android · 已暂停"
                        : "Android · 系统正在共享"
                      : "Android · 默认关闭"}
                  </span>
                </div>
                <button
                  type="button"
                  className={`privacy-switch${
                    screenGlanceConfig.randomEnabled ? " is-on" : ""
                  }`}
                  role="switch"
                  aria-checked={screenGlanceConfig.randomEnabled}
                  aria-label={
                    screenGlanceConfig.randomEnabled
                      ? "关闭随机查看"
                      : "允许随机查看"
                  }
                  disabled={isScreenGlanceBusy || !screenGlanceState.supported}
                  onClick={() =>
                    void saveScreenGlanceConfig({
                      ...screenGlanceConfig,
                      randomEnabled: !screenGlanceConfig.randomEnabled,
                    })
                  }
                >
                  <span aria-hidden="true" />
                </button>
              </div>
              <p>
                每次会话都由 Android 系统确认，并持续显示共享通知。邀请一起看后，手机会在后台稀疏采样，只有画面明显变化才调用当前伴侣模型。
              </p>
              <div className="screen-glance-options">
                <label>
                  最短间隔（分钟）
                  <input
                    type="number"
                    min="1"
                    max="180"
                    value={screenGlanceConfig.minimumMinutes}
                    disabled={isScreenGlanceBusy}
                    onChange={(event) =>
                      setScreenGlanceConfig((current) =>
                        normalizeScreenGlanceConfig({
                          ...current,
                          minimumMinutes: event.target.value,
                        }),
                      )
                    }
                    onBlur={() => void saveScreenGlanceConfig()}
                  />
                </label>
                <label>
                  最长间隔（分钟）
                  <input
                    type="number"
                    min="1"
                    max="180"
                    value={screenGlanceConfig.maximumMinutes}
                    disabled={isScreenGlanceBusy}
                    onChange={(event) =>
                      setScreenGlanceConfig((current) =>
                        normalizeScreenGlanceConfig({
                          ...current,
                          maximumMinutes: event.target.value,
                        }),
                      )
                    }
                    onBlur={() => void saveScreenGlanceConfig()}
                  />
                </label>
                <label className="screen-glance-check">
                  <input
                    type="checkbox"
                    checked={screenGlanceConfig.wifiOnly}
                    disabled={isScreenGlanceBusy}
                    onChange={(event) =>
                      void saveScreenGlanceConfig({
                        ...screenGlanceConfig,
                        wifiOnly: event.target.checked,
                      })
                    }
                  />
                  仅 Wi-Fi
                </label>
                <label className="screen-glance-check">
                  <input
                    type="checkbox"
                    checked={screenGlanceConfig.chargingOnly}
                    disabled={isScreenGlanceBusy}
                    onChange={(event) =>
                      void saveScreenGlanceConfig({
                        ...screenGlanceConfig,
                        chargingOnly: event.target.checked,
                      })
                    }
                  />
                  仅充电时
                </label>
              </div>
              <div className="screen-glance-toggle-row">
                <span>
                  <strong>一起看时主动回应</strong>
                  <small>开启后持续共看，直到你主动暂停或结束。</small>
                </span>
                <button
                  type="button"
                  className={`privacy-switch${
                    screenGlanceConfig.watchTogetherEnabled ? " is-on" : ""
                  }`}
                  role="switch"
                  aria-checked={screenGlanceConfig.watchTogetherEnabled}
                  aria-label="一起看时主动回应"
                  disabled={isScreenGlanceBusy || !screenGlanceState.supported}
                  onClick={() =>
                    void saveScreenGlanceConfig({
                      ...screenGlanceConfig,
                      watchTogetherEnabled:
                        !screenGlanceConfig.watchTogetherEnabled,
                    })
                  }
                >
                  <span aria-hidden="true" />
                </button>
              </div>
              {(screenGlanceState.capturedAt ||
                screenGlanceState.nextCaptureAt) && (
                <div className="screen-glance-times">
                  {screenGlanceState.capturedAt && (
                    <span>
                      最近查看：{formatDateTime(screenGlanceState.capturedAt)}
                    </span>
                  )}
                  {screenGlanceState.nextCaptureAt && (
                    <span>
                      下次随机窗口：
                      {formatDateTime(screenGlanceState.nextCaptureAt)}
                    </span>
                  )}
                  {screenGlanceState.lastReactionAt && (
                    <span>
                      最近共看回应：
                      {formatDateTime(screenGlanceState.lastReactionAt)}
                    </span>
                  )}
                </div>
              )}
              <p
                className={`notification-feature-feedback ${screenGlanceFeedback.status}`}
                role="status"
                aria-live="polite"
              >
                {screenGlanceFeedback.message}
              </p>
              <div className="device-activity-actions">
                {!screenGlanceState.active ? (
                  <>
                    <button
                      type="button"
                      disabled={
                        isScreenGlanceBusy || !screenGlanceState.supported
                      }
                      onClick={() =>
                        void startScreenGlanceSession({ watchTogether: true })
                      }
                    >
                      邀请一起看
                    </button>
                    <button
                      type="button"
                      disabled={
                        isScreenGlanceBusy || !screenGlanceState.supported
                      }
                      onClick={() => void startScreenGlanceSession()}
                    >
                      只共享屏幕
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={isScreenGlanceBusy}
                      onClick={() =>
                        void setScreenGlancePaused(!screenGlanceState.paused)
                      }
                    >
                      {screenGlanceState.paused ? "继续捕获" : "暂停捕获"}
                    </button>
                    <button
                      type="button"
                      disabled={isScreenGlanceBusy}
                      onClick={() => void stopScreenGlanceSession()}
                    >
                      结束并清除
                    </button>
                  </>
                )}
              </div>
              <small>
                共看没有倒计时，会持续到你手动暂停或结束；锁屏会暂停采样，结束系统共享后，本机临时画面会立即清除。
              </small>
            </div>
              </>
            )}
            {/* DLNA 投屏接收开关 */}
            <div className="notification-feature-panel device-activity-panel">
              <div className="device-activity-heading">
                <div>
                  <strong>
                    <svg className="dlna-cast-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2 16v2a4 4 0 0 1 4 4h2" />
                      <path d="M2 12v2a8 8 0 0 1 8 8h2" />
                      <path d="M2 8v2a12 12 0 0 1 12 12h2" />
                      <path d="M22 2H6a2 2 0 0 0-2 2v6" />
                      <path d="M22 14h-6l-2 3h-2" />
                      <path d="M22 22h-2" />
                    </svg>
                    DLNA 投屏接收</strong>
                  <span>视频 App 点投屏 → 选择「灯塔 DENGTA」→ 一起看</span>
                </div>
                <button
                  type="button"
                  className={`privacy-switch${
                    dlnaState.active || dlnaState.discoveryStatus === "starting" ? " is-on" : ""
                  }`}
                  role="switch"
                  aria-checked={dlnaState.active || dlnaState.discoveryStatus === "starting"}
                  aria-label={
                    dlnaState.active || dlnaState.discoveryStatus === "starting" ? "关闭投屏接收" : "开启投屏接收"
                  }
                  disabled={dlnaBusy}
                  onClick={toggleDlnaReceiver}
                >
                  <span aria-hidden="true" />
                </button>
              </div>
              <p>
                开启并就绪后，灯塔会在局域网注册为 DLNA 媒体接收器。在同一 Wi-Fi 下，用支持 DLNA 的视频 App 搜索「灯塔 DENGTA」。选中后，可在灯塔内置播放器播放并开始一起看；部分 App 使用其他投屏协议，可能不会列出 DLNA 接收器。
              </p>
              <DlnaDiscoveryFeedback state={dlnaState} />
              {dlnaState.active && (
                <small>
                  端口：{dlnaState.port || "—"}
                  {dlnaState.wifiName ? ` · Wi-Fi：${dlnaState.wifiName}` : ""}
                  {dlnaState.transportState !== "STOPPED" && (
                    <>
                      {" · "}
                      状态：{dlnaState.transportState === "PLAYING" ? "播放中" : dlnaState.transportState === "PAUSED_PLAYBACK" ? "已暂停" : "已停止"}
                    </>
                  )}
                </small>
              )}
            </div>
          </div>
          )}

            {settingsCategory === "fun" && (
              <>
            <div className="notification-feature-panel device-activity-panel">
              <div className="device-activity-heading">
                <div>
                  <strong>外卖点单与成就系统</strong>
                  <span>已移到左侧边栏</span>
                </div>
              </div>
              <p>点左侧的「🛵 外卖」和「🏆 成就」即可使用；这里保留小红书登录。</p>
            </div>
            <div className="notification-feature-panel device-activity-panel">
              <div className="device-activity-heading">
                <div>
                  <strong>小红书</strong>
                  <span>
                    {xhsState.status === "logged_in"
                      ? "已登录 · AI 可帮你刷帖搜索"
                      : "写操作前会先征求你的同意"}
                  </span>
                </div>
                <div className="device-activity-actions">
                  <button type="button" onClick={() => void connectXhsWithBrowser()}>
                    内置浏览器登录
                  </button>
                  <button type="button" onClick={() => void startXhsQrLogin()}>
                    扫码登录
                  </button>
                  <button type="button" onClick={() => void logoutXhsAccount()}>
                    退出登录
                  </button>
                </div>
              </div>
              <p>
                登录后 AI 可以用你的小红书账号搜索笔记、读评论、一起吐槽；点赞、发评论、关注属于写操作，AI
                必须先征得你同意才会执行。
              </p>
              {xhsState.feedback ? (
                <p
                  className={`notification-feature-feedback ${
                    xhsState.status === "error" ? "error" : "busy"
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {xhsState.feedback}
                </p>
              ) : null}
              {xhsState.qr ? (
                <div className="xhs-qr-wrap">
                  <img src={xhsState.qr} alt="小红书登录二维码" />
                  <small>打开小红书 App → 扫一扫 → 确认登录</small>
                </div>
              ) : null}
              <small>登录态只存在服务端，随时可在这里退出。</small>
            </div>
              </>
            )}

          {settingsCategory === "persona" && settingsSaveReceipt && (
            <div className="settings-save-receipt" role="status">
              <strong>✓ 服务器已保存并回读</strong>
              <span>
                个性化指令 {settingsSaveReceipt.customInstructionsLength} 字
              </span>
              <span>
                你的详情 {settingsSaveReceipt.userDetailsLength} 字
              </span>
              <span>
                统一提示词模式 · 亲密与成人表达
                {settingsSaveReceipt.intimateExpressionEnabled
                  ? "已开启"
                  : "已关闭"}
              </span>
            </div>
          )}

          {settingsCategory === "persona" && lastPromptReceipt && (
            <div className="prompt-application-receipt" role="status">
              <strong>
                {lastPromptReceipt.backendRequestSent
                  ? "最近一次后端模型请求已发送"
                  : "最近回复的提示词字数回执"}
              </strong>
              <div className="prompt-receipt-details">
                {lastPromptReceipt.delivery ? (
                  <>
                    <span>
                      个性化指令：
                      {lastPromptReceipt.delivery.persistentInstructions
                        ?.customInstructions?.applied
                        ? `已发送 ${lastPromptReceipt.delivery.persistentInstructions.customInstructions.chars ?? "—"} 字`
                        : "未发送"}
                    </span>
                    <span>
                      你的详情：
                      {lastPromptReceipt.delivery.persistentInstructions
                        ?.userDetails?.applied
                        ? `已发送 ${lastPromptReceipt.delivery.persistentInstructions.userDetails.chars ?? "—"} 字`
                        : "未发送"}
                    </span>
                    <span>
                      应用 system 指令合计：
                      {lastPromptReceipt.delivery.mainSystem.applied
                        ? `${lastPromptReceipt.delivery.mainSystem.chars ?? "—"} 字`
                        : "未发送"}
                    </span>
                    <span>
                      稳定长期记忆：
                      {lastPromptReceipt.delivery.stableMemory.applied
                        ? `${lastPromptReceipt.delivery.stableMemory.count ?? "—"} 条 / ${lastPromptReceipt.delivery.stableMemory.chars ?? "—"} 字`
                        : "本轮未注入"}
                    </span>
                    <span>
                      聊天历史：
                      {lastPromptReceipt.delivery.history.count ?? "—"} 条
                    </span>
                    <span>
                      动态上下文：
                      {lastPromptReceipt.delivery.dynamicContext.applied
                        ? `已注入 ${lastPromptReceipt.delivery.dynamicContext.chars ?? "—"} 字`
                        : "本轮未注入"}
                    </span>
                    <span>
                      本轮使用的 DengTa 接口：
                      {formatPromptReceiptProvider(lastPromptReceipt)} ·{" "}
                      {lastPromptReceipt.transport || "未知传输格式"}
                    </span>
                    {lastPromptReceipt.reasoningEffortApplied && (
                      <span>
                        本轮推理强度请求：
                        {lastPromptReceipt.reasoningEffortApplied} ·{" "}
                        {lastPromptReceipt.reasoningEffortField || "未知字段"}
                      </span>
                    )}
                  </>
                ) : (
                  <span>
                    旧版三层字数：系统{" "}
                    {lastPromptReceipt.systemPromptChars ?? "—"} / 普通{" "}
                    {lastPromptReceipt.additionalPromptChars ?? "—"} / 人设{" "}
                    {lastPromptReceipt.personalityChars ?? "—"}
                  </span>
                )}
              </div>
              <div className="prompt-receipt-times">
                <time dateTime={lastPromptReceipt.appliedAt}>
                  请求时间：{formatDateTime(lastPromptReceipt.appliedAt)}
                </time>
                {lastPromptReceipt.settingsUpdatedAt && (
                  <time dateTime={lastPromptReceipt.settingsUpdatedAt}>
                    设置版本：{formatDateTime(lastPromptReceipt.settingsUpdatedAt)}
                  </time>
                )}
              </div>
              <small>
                回执只显示是否发送、顺序和字数，不包含提示词正文、记忆正文或密钥。它能验证 DengTa
                后端的投递过程，但上游模型仍可能受自身规则与上下文上限影响。
              </small>
            </div>
          )}

          <div className="save-bar">
            <span className={`autosave-status ${settingsAutosaveState}`}>
              <strong>
                {settingsAutosaveState === "pending"
                  ? "等待自动保存"
                  : settingsAutosaveState === "saving"
                    ? "正在自动保存"
                    : settingsAutosaveState === "error"
                      ? "自动保存失败"
                      : hasLoadedSettings
                        ? "已自动保存"
                        : "等待服务器设置"}
              </strong>
              <small>
                {settingsSaveError ||
                  (settings.model
                    ? `当前模型：${settings.model}`
                    : "当前未配置模型，使用演示回复")}
              </small>
            </span>
            <span className="autosave-hint">
              修改后会自动保存，不需要滑到这里操作
            </span>
          </div>
            </form>
            )}
            {settingsCategory === "services" && (
              <>
                <Suspense fallback={<DeferredFeature label="正在打开 AI 接口管理…" />}>
                  <AiProviderCenter onStatusChange={setProviderStatus} />
                </Suspense>
                <Suspense fallback={<DeferredFeature label="正在打开创作中心…" />}>
                  <CompanionCreativeSettings />
                </Suspense>
              </>
            )}
            {settingsCategory === "persona" && (
              <Suspense fallback={<DeferredFeature label="正在打开外部记忆连接…" />}>
                    <ExternalMemoryConnections key={privateMediaScope} scopeKey={privateMediaScope} />
              </Suspense>
            )}
            {settingsCategory === "devices" && (
              <Suspense fallback={<DeferredFeature label="正在打开设备连接…" />}>
                <div id="mcp-device-center"><McpDeviceCenter /></div>
              </Suspense>
            )}
            {settingsCategory === "voice" && (
              <Suspense fallback={<DeferredFeature label="正在打开发声接口…" />}>
                <VoiceProviderSettings
                  accountScope={accountStorageScope}
                  onStatusChange={applyVoiceOutputStatus}
                />
              </Suspense>
            )}
          </>
        ) : null}
        </fieldset>
      </section>
    );
  }

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.dengtaReducedMotion;
    root.dataset.dengtaReducedMotion = String(chatSkinPreferences.reduceMotion);
    return () => {
      if (previous === undefined) delete root.dataset.dengtaReducedMotion;
      else root.dataset.dengtaReducedMotion = previous;
    };
  }, [chatSkinPreferences.reduceMotion]);

  const viewTitle = activeView === "chat"
    ? activeSession?.title || "欢迎回家"
    : FEATURE_LABELS[activeView] || (activeView === "cast" ? "放映厅" : "灯塔");
  const showStartupRecovery =
    !visualPreview &&
    (startupConnection.status === "connecting" ||
    (startupConnection.failureCount > 0 &&
      startupConnection.status !== "connected"));
  const startupRetrySeconds = Math.ceil(
    Number(startupConnection.nextRetryDelayMs || 0) / 1_000,
  );

  return (
    <div
      className={`app-shell${
        chatSkinPreferences.reduceMotion ? " reduce-chat-motion" : ""
      }${isSettingsOpen ? " is-settings-open" : ""}`}
      data-chat-skin={chatSkinPreferences.skin}
      data-ornament-activity={chatSkinPreferences.ornamentActivity}
      data-chat-streaming={isSending ? "true" : "false"}
    >
      <CelestialBackdrop
        snapshot={celestialSnapshot}
        weather={ambientWeather}
        weatherModeOverride={weatherPreviewMode}
      />

      {isSidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="关闭菜单"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-icon">D</span>
          <div>
            <strong>DengTa home</strong>
            <small>给 AI 一个家</small>
          </div>
        </div>

        <FeatureNavigation items={navItems} activeView={activeView} onNavigate={changeView} />

        <div className="session-heading">
          <span>最近对话</span>
          <button
            onClick={createSession}
            title={isCreatingSession ? "正在创建新对话" : "新建对话"}
            aria-label={isCreatingSession ? "正在创建新对话" : "新建对话"}
            aria-busy={isCreatingSession}
            disabled={isCreatingSession}
          >
            {isCreatingSession ? "…" : "＋"}
          </button>
        </div>

        <div className="session-list" aria-label="会话列表">
          {sessions.map((session) => (
            <div
              className={`session-item ${
                activeSessionId === session.id ? "active" : ""
              }`}
              key={session.id}
            >
              <button
                className="session-select"
                onClick={() => chooseSession(session.id)}
                title={session.title}
              >
                <span>⌁</span>
                <span>{session.title}</span>
              </button>
              <div className="session-actions">
                <button
                  onClick={() =>
                    openSessionDialog({
                      type: "rename",
                      session,
                      value: session.title,
                    })
                  }
                  title="重命名"
                >
                  ✎
                </button>
                <button
                  onClick={() =>
                    openSessionDialog({ type: "delete", session, value: "" })
                  }
                  title="删除"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        {accountControl && (
          <div className="sidebar-account-slot">{accountControl}</div>
        )}

        <div className="sidebar-footer">
          <span className={`connection-dot ${isOnline ? "online" : ""}`} />
          {isOnline ? "服务可连接" : "网络已断开"}
        </div>
      </aside>

      <main
        className={`main-panel view-${activeView}${
          isStatusPanelExpanded ? " status-panel-open" : ""
        }`}
      >
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="打开菜单"
          >
            ☰
          </button>
          <div
            className={`topbar-context${
              activeView === "chat" ? " is-chat" : ""
            }`}
          >
            {activeView === "chat" ? (
              <div className="sun-glass-topbar-identity">
                <strong>{effectiveAiName}</strong>
                <span>
                  <i aria-hidden="true" />
                  {companionStatus.resetBlank === true
                    ? "在这里"
                    : companionStatus.mood || "平静"}
                </span>
              </div>
            ) : (
              <>
                <h1>{viewTitle}</h1>
                <p>DengTa home</p>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className="new-chat-top"
              aria-label={isCreatingSession ? "正在创建新对话" : "新对话"}
              aria-busy={isCreatingSession}
              disabled={isCreatingSession}
              title={isCreatingSession ? "正在创建新对话" : "新对话"}
              onClick={createSession}
            >
              <span aria-hidden="true">{isCreatingSession ? "…" : "＋"}</span>
              <span className="new-chat-label">
                {isCreatingSession ? "创建中" : "新对话"}
              </span>
            </button>
            <button
              type="button"
              className="settings-gear-button"
              aria-label="打开设置"
              aria-haspopup="dialog"
              aria-expanded={isSettingsOpen}
              onClick={openSettingsPanel}
            >
              <svg viewBox="0 0 24 24" role="presentation">
                <path d="M9.7 2.8h4.6l.7 2.4 2.2 1.3 2.4-.6 2.3 4-1.7 1.8v2.6l1.7 1.8-2.3 4-2.4-.6-2.2 1.3-.7 2.4H9.7L9 20.8l-2.2-1.3-2.4.6-2.3-4 1.7-1.8v-2.6L2.1 9.9l2.3-4 2.4.6L9 5.2l.7-2.4Z" />
                <circle cx="12" cy="13" r="3.1" />
              </svg>
            </button>
          </div>
        </header>

        {achievementPopup.visible && achievementPopup.scope === funToken && !isSettingsOpen ? (
          <AchievementNotice items={achievementPopup.items} onDismiss={dismissAchievement}
            onView={() => { dismissAchievement(); changeView("achievements"); }} />
        ) : null}

        {distillState.modalOpen ? (
          <div
            className="achievement-popup-backdrop distill-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="风格提纯结果"
            onClick={() => setDistillState((previous) => ({ ...previous, modalOpen: false }))}
          >
            <div className="distill-modal-card" onClick={(event) => event.stopPropagation()}>
              <header className="distill-modal-header">
                <strong>🎯 提纯结果 · {distillState.result?.name || "未命名"}</strong>
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={() => setDistillState((previous) => ({ ...previous, modalOpen: false }))}
                >
                  ×
                </button>
              </header>
              <p className="distill-modal-hint">
                这是蒸馏出的「个性化指令」文档，可直接修改。满意后点「应用到个性化指令」一键填入设置。
                {distillState.result?.model ? ` 本次模型：${distillState.result.model}。` : ""}
              </p>
              <textarea
                className="distill-modal-editor"
                value={distillState.edited}
                onChange={(event) =>
                  setDistillState((previous) => ({
                    ...previous,
                    edited: event.target.value,
                  }))
                }
                rows={18}
                aria-label="提纯结果编辑"
              />
              <div className="distill-modal-actions">
                <button
                  type="button"
                  className="is-secondary"
                  onClick={async () => {
                    try {
                      if (!navigator.clipboard?.writeText) throw new Error();
                      await navigator.clipboard.writeText(distillState.edited);
                      setNotice("已复制到剪贴板。");
                    } catch { setNotice("复制失败，请手动选择文字复制，或下载文档。"); }
                  }}
                >
                  复制全文
                </button>
                <button type="button" className="is-secondary" onClick={() => {
                  const url = URL.createObjectURL(new Blob([distillState.edited], { type: "text/markdown;charset=utf-8" }));
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "灯塔-风格提纯.md";
                  link.click();
                  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}>下载 Markdown</button>
                <button type="button" onClick={applyDistilledToPrompt}>
                  应用到个性化指令
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div
          className={`chat-presence-stack${
            activeView === "chat" ? "" : " is-hidden"
          }`}
          aria-hidden={activeView === "chat" ? undefined : "true"}
        >
          <CompanionStatus
            active={activeView === "chat"}
            closeRequest={statusPanelCloseRequest}
            aiName={effectiveAiName}
            userName={effectiveUserName}
            status={companionStatus}
            aiPronoun={companionPronoun(settings)}
            interactionStats={companionInteractionStats}
            intimateExpressionEnabled={
              settings.intimate_expression_enabled === true
            }
            isResponding={isCompanionResponding}
            onChange={setCompanionStatus}
            onExpandedChange={handleStatusPanelExpandedChange}
            onInteract={handleCompanionInteraction}
            onListenTogether={() => { setTogetherEntryMode("music"); changeView("music"); }}
            onWatchTogether={() => { setTogetherEntryMode("external"); changeView("together"); }}
            onOpenNavigation={() => setIsSidebarOpen(true)}
            onOpenSettings={openSettingsPanel}
            nowPlaying={nowPlaying}
            nowPlayingBusy={nowPlayingBusy}
            onNowPlayingPlayPause={handleNowPlayingPlayPause}
            onNowPlayingNext={handleNowPlayingNext}
            onDismissNowPlaying={handleDismissNowPlaying}
          />
          <AmbientContextBadge
            accountScope={accountStorageScope}
            onLoadWeather={loadAmbientWeather}
            onContextChange={handleAmbientContextChange}
            onCoordinatesChange={setCelestialCoordinates}
            celestialSnapshot={celestialSnapshot}
          />
        </div>

        {showStartupRecovery && (
          <div className="connection-recovery" role="status" aria-live="polite">
            <div>
              <strong>
                {startupConnection.status === "connecting"
                  ? startupConnection.failureCount > 0
                    ? "正在重新连接 DengTa 后端…"
                    : "正在唤醒 DengTa 后端…"
                  : "DengTa 后端暂时没有响应"}
              </strong>
              <span>
                {startupConnection.status === "connecting" &&
                startupConnection.failureCount === 0
                  ? "服务休眠后的首次连接可能需要约一分钟，完成后会自动恢复设置和会话。"
                  : startupConnection.status === "waiting" &&
                      startupRetrySeconds
                  ? `将在 ${startupRetrySeconds} 秒后自动重试。`
                  : startupConnection.lastError?.message ||
                    "正在恢复设置和会话。"}
              </span>
            </div>
            <div className="connection-recovery-actions">
              {startupConnection.failureCount > 0 && (
                <button type="button" onClick={openProviderRecovery}>
                  修复聊天接口 / Fix chat API
                </button>
              )}
              <button type="button" onClick={retryStartupConnection}>
                立即重试
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}

        <div className="view-content">
          {activeView === "chat" && renderChat()}
          {activeView === "moments" && renderMoments()}
          {activeView === "diary" && renderDiary()}
          {activeView === "art" && renderArtStudio()}
          {activeView === "nursery" && renderNursery()}
          {activeView === "cotton" && (
            <Suspense fallback={<DeferredFeature label="正在打开小棉花的小屋…" />}>
              <CottonPet accountScope={accountStorageScope} companionScope={companionScope} onShare={(text) => { setMessage((current) => current ? `${current}\n${text}` : text); changeView("chat"); }} />
            </Suspense>
          )}
          {activeView === "together" && renderTogether("together")}
          {activeView === "music" && renderTogether("music")}
          {activeView === "cast" && renderDlnaCastPlayer()}
          {activeView === "duel" && renderIntimateDuel()}
          {activeView === "memories" && renderMemories()}
          {activeView === "takeout" && renderTakeout()}
          {activeView === "achievements" && renderAchievements()}
          {activeView === "workspace" && (
            <div className="workspace-page">
              <Suspense fallback={<DeferredFeature label="正在打开工作区…" />}>
                <WorkspaceManager key={privateMediaScope} accountScope={accountStorageScope} registerLeaveGuard={registerWorkspaceLeaveGuard} />
              </Suspense>
            </div>
          )}
          {activeView === "discover" && renderDiscover()}
        </div>
      </main>

      <div
        className={`mobile-edge-navigation${isMobileNavOpen ? " is-open" : ""}`}
      >
        <button
          type="button"
          className="mobile-nav-handle"
          aria-label={isMobileNavOpen ? "收起页面导航" : "展开页面导航"}
          aria-expanded={isMobileNavOpen}
          onClick={() => setIsMobileNavOpen((current) => !current)}
        >
          <span aria-hidden="true">{isMobileNavOpen ? "‹" : "›"}</span>
        </button>
        <nav className="mobile-nav" aria-label="手机侧边导航">
          {navItems.filter(item => QUICK_FEATURES.includes(item.id)).map((item) => (
            <button
              className={activeView === item.id ? "active" : ""}
              key={item.id}
              onClick={() => changeView(item.id)}
            >
              <span>{item.icon}</span>
              <small>{FEATURE_LABELS[item.id] || item.label}</small>
            </button>
          ))}
                  <button type="button" className={!QUICK_FEATURES.includes(activeView) ? "active" : ""} aria-label="查看全部玩法" onClick={() => { setIsMobileNavOpen(false); setIsSidebarOpen(true); }}><span aria-hidden="true">···</span><small>更多</small></button>
        </nav>
      </div>

      {isSettingsOpen && (
        <div
          className="settings-sheet-backdrop"
          role="presentation"
          onPointerDown={closeSettingsPanel}
        >
          <section
            ref={settingsPanelRef}
            tabIndex={-1}
            className="settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-sheet-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <SettingsFlowField />
            <header className="settings-sheet-header">
              <div>
                <span>PERSONAL SPACE</span>
                <h2 id="settings-sheet-title">Settings</h2>
              </div>
              <button type="button" onClick={closeSettingsPanel}>
                Done
              </button>
            </header>
            <div
              ref={settingsScrollRef}
              className="settings-sheet-scroll"
              onScroll={handleSettingsScroll}
            >
              {renderSettings()}
            </div>
          </section>
        </div>
      )}

      {dialog && (
        <SessionDialog dialog={dialog} busy={sessionDialogBusy} feedback={sessionDialogFeedback}
          onChange={value => { if (!sessionDialogPendingRef.current) setDialog(current => current ? { ...current, value } : current); }}
          onClose={closeSessionDialog} onConfirm={confirmSessionDialog}
          onInspect={() => { closeSessionDialog(); setSettingsCategory("logs"); setIsSettingsOpen(true); }} />
      )}

      {imageViewer && (
        <div
          className="image-viewer"
          role="dialog"
          aria-modal="true"
          aria-label="动态图片预览"
          onMouseDown={() => setImageViewer(null)}
        >
          <button
            type="button"
            className="image-viewer-close"
            aria-label="关闭图片预览"
            onClick={() => setImageViewer(null)}
          >
            ×
          </button>
          <img
            src={imageViewer.url}
            alt={imageViewer.alt}
            onMouseDown={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

export default App;
