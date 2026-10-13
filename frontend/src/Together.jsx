import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CircleStop,
  Clock3,
  Globe,
  Link2,
  MessageCircleMore,
  Music2,
  MonitorPlay,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { formatMediaTime, resolveCoWatchPage } from "./co-watch";
import { API_BASE_URL } from "./api.js";
import { mediaPlaybackFeedback } from "./media-playback-errors.js";
import { detectPlannedCastProviders } from "./receiver-playback.js";
import {
  clearDirectMediaSession,
  DIRECT_MEDIA_SOURCE_APP,
  WEB_PAGE_SOURCE_APP,
  readDirectMediaSession,
  storeDirectMediaSession,
  validateDirectMediaUrl,
} from "./direct-media.js";
import "./together.css";
import TogetherMusic from "./TogetherMusic.jsx";
import { useLocalPlaybackHandoff } from "./useBuiltInNowPlaying.js";
import BilibiliQrLogin from "./BilibiliQrLogin.jsx";
import { WatchQueryPanel } from "./ActivityQueryPanels.jsx";


function webPageStorageKey(accountScope, companionScope) {
  return "dengta_together_web_page_v2:" + JSON.stringify([accountScope, companionScope]);
}

function readStoredWebPage(accountScope, companionScope) {
  if (!accountScope || !companionScope) return null;
  try {
    const raw = globalThis.sessionStorage?.getItem(webPageStorageKey(accountScope, companionScope));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.page_url ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredWebPage(accountScope, companionScope, page) {
  if (!accountScope || !companionScope) return;
  try {
    if (page?.page_url) {
      globalThis.sessionStorage?.setItem(
        webPageStorageKey(accountScope, companionScope),
        JSON.stringify(page),
      );
    } else {
      globalThis.sessionStorage?.removeItem(webPageStorageKey(accountScope, companionScope));
    }
  } catch {
    // 存储不可用时仅影响切换页面后的恢复。
  }
}


function formatMoment(value, fallback = "等待画面") {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function finiteMediaSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function releaseVideo(video) {
  if (!video) return;
  try { video.pause(); } catch { /* 已卸载的播放器可能不再接受操作。 */ }
  try { video.removeAttribute?.("src"); video.load?.(); } catch { /* 释放失败不影响页面切换。 */ }
}

export default function Together({
  aiName = "伴侣",
  accountScope = "",
  companionScope = "",
  watchRequest = null,
  session,
  receipt,
  screenState,
  preview,
  feedback,
  busy: externalBusy = false,
  onStart,
  onStartDirect,
  onPause,
  onStop,
  onStopDirect,
  onStartMusic,
  onStopMusic,
  onMusicPlaybackChange,
  onLocalPlaybackChange,
  onMusicUnderstandingSaved,
  onPlaybackChange,
  onRefresh,
  castPairing,
  castReceiver,
  onGenerateCastPairing,
  dialog = [],
  onReply,
  viewKind = "together",
  externalPageUrl = "",
  musicRequest = null,
  danmaku = [],
}) {
  const [restoredDirectMedia] = useState(() =>
    readDirectMediaSession(globalThis.sessionStorage, accountScope, companionScope),
  );
  const [mode, setMode] = useState(() =>
    viewKind === "music"
      ? "music"
      : session?.sessionMode === "listening"
      ? "external"
      : session?.sourceApp === WEB_PAGE_SOURCE_APP
      ? "web"
      : readStoredWebPage(accountScope, companionScope)?.page_url
      ? "web"
      : session?.sourceApp === DIRECT_MEDIA_SOURCE_APP || restoredDirectMedia?.url
      ? "direct"
      : "external",
  );
  const webVideoRef = useRef(null);
  const [activeDanmaku, setActiveDanmaku] = useState([]);
  const danmakuCursorRef = useRef(0);
  const danmakuSpawnedRef = useRef(new Set());
  const pageRequestRef = useRef(null);
  const replyPendingRef = useRef(false);
  const replyFeedbackId = useId();
  const mediaPendingRef = useRef(null);
  const [mediaPending, setMediaPending] = useState(false);
  const busy = externalBusy || mediaPending;
  const [pendingWatchLink, setPendingWatchLink] = useState(null);
  const pendingWatchLinkRef = useRef(null);
  const watchLinkContextRef = useRef(null);
  const watchLinkScope = JSON.stringify([accountScope, companionScope]);
  useEffect(() => () => {
    pageRequestRef.current?.abort();
    pageRequestRef.current = null;
    mediaPendingRef.current = null;
  }, []);

  const [title, setTitle] = useState(
    session?.title || restoredDirectMedia?.title || "",
  );
  const [durationMinutes, setDurationMinutes] = useState(
    session?.mediaDurationSeconds
      ? String(Math.round(session.mediaDurationSeconds / 60))
      : "",
  );
  const [positionMinutes, setPositionMinutes] = useState(
    session?.mediaPositionSeconds
      ? String(Math.round(session.mediaPositionSeconds / 60))
      : "",
  );
  const [cadenceMinutes, setCadenceMinutes] = useState("1.5");
  const [reply, setReply] = useState("");
  const [musicPositionSeconds, setMusicPositionSeconds] = useState(0);
  const [directUrlInput, setDirectUrlInput] = useState(
    restoredDirectMedia?.url || "",
  );
  const [directMediaUrl, setDirectMediaUrl] = useState(
    restoredDirectMedia?.url || "",
  );
  const [directPositionSeconds, setDirectPositionSeconds] = useState(
    restoredDirectMedia?.positionSeconds || 0,
  );
  const [directDurationSeconds, setDirectDurationSeconds] = useState(
    restoredDirectMedia?.durationSeconds || 0,
  );
  const [directPlaying, setDirectPlaying] = useState(false);
  const [directFeedback, setDirectFeedback] = useState({
    status: "idle",
    message: "视频链接只用于本场直链播放与已配对的浏览器接收端，不会在投屏界面公开显示。",
  });
  const [webUrlInput, setWebUrlInput] = useState(() =>
    readStoredWebPage(accountScope, companionScope)?.page_url || "",
  );
  const [webPage, setWebPage] = useState(() => readStoredWebPage(accountScope, companionScope));
  const loadedWebInputRef = useRef(webUrlInput);
  const [webFeedback, setWebFeedback] = useState({
    status: "idle",
    message: "粘贴哔哩哔哩、爱奇艺等官方网页链接，先解析再开始一起看。",
  });
  const videoRef = useRef(null);
  const mediaSelectionRef = useRef("");
  useLayoutEffect(() => {
    mediaSelectionRef.current = JSON.stringify([directMediaUrl, webPage?.page_url || ""]);
  }, [directMediaUrl, webPage?.page_url]);
  const resumedUrlRef = useRef("");
  const restoredResumeRef = useRef(
    restoredDirectMedia?.url
      ? {
          url: restoredDirectMedia.url,
          positionSeconds: restoredDirectMedia.positionSeconds || 0,
        }
      : null,
  );
  const lastPlaybackSecondRef = useRef(-1);
  const lastPlaybackPatchRef = useRef(0);
  const castProviders = useMemo(() => detectPlannedCastProviders(globalThis), []);

  const active =
    screenState.active &&
    screenState.watchTogetherEnabled &&
    session?.status === "active";
  const directActive =
    session?.status === "active" &&
    session?.sourceApp === DIRECT_MEDIA_SOURCE_APP;
  const pageActive =
    session?.status === "active" &&
    session?.sourceApp === WEB_PAGE_SOURCE_APP;
  const musicActive = session?.status === "active" && session?.sessionMode === "listening";
  // viewKind 优先：用户明确选了"一起听歌"才进 music；"一起看"页面即使有
  // 残留的 music 会话也不能抢占，避免点"一起看"却跳到听歌界面。
  const selectedMode = viewKind === "music"
    ? "music"
    : musicActive && viewKind !== "together"
      ? "music"
      : pageActive && viewKind !== "music"
        ? "web"
        : directActive && viewKind !== "music"
          ? "direct"
          : active && viewKind !== "music"
            ? "external"
            : mode;
  const selectedActive = selectedMode === "music" ? musicActive : selectedMode === "web" ? pageActive : selectedMode === "direct" ? directActive : active;
  const modeLocked = viewKind === "music" ? musicActive : active || directActive || pageActive;
  const selectedModeRef = useRef(selectedMode);
  const localVideoGeneration = JSON.stringify([accountScope, companionScope, selectedMode, directMediaUrl]);
  const localVideoPlayback = useLocalPlaybackHandoff({ accountScope, companionScope, generation: localVideoGeneration, onLocalPlaybackChange });
  const modeLockRef = useRef(modeLocked);
  useLayoutEffect(() => {
    selectedModeRef.current = selectedMode;
    modeLockRef.current = modeLocked;
  }, [selectedMode, modeLocked]);
  const watchLinkBlocked = Boolean(busy || session?.status === "active" || active);
  useLayoutEffect(() => {
    watchLinkContextRef.current = { scope: watchLinkScope, blocked: watchLinkBlocked };
  }, [watchLinkScope, watchLinkBlocked]);
  useLayoutEffect(() => () => {
    watchLinkContextRef.current = null;
    pendingWatchLinkRef.current = null;
  }, []);
  const webVideoUrl = webPage?.provider === "bilibili" && webPage.bvid
    ? `${API_BASE_URL}/api/v2/co-watch/bilibili-stream?bvid=${encodeURIComponent(webPage.bvid)}` : "";
  const attachDirectVideo = useCallback((node) => {
    const previous = videoRef.current;
    videoRef.current = node;
    if (previous && previous !== node) releaseVideo(previous);
    if (node) {
      if (node.getAttribute && !node.getAttribute("src")) node.setAttribute("src", directMediaUrl);
      setDirectPlaying(!node.paused && !node.ended);
    }
  }, [directMediaUrl]);
  const attachWebVideo = useCallback((node) => {
    const previous = webVideoRef.current;
    webVideoRef.current = node;
    if (previous && previous !== node) releaseVideo(previous);
    if (node?.getAttribute && !node.getAttribute("src")) node.setAttribute("src", webVideoUrl);
  }, [webVideoUrl]);
  const danmakuScope = JSON.stringify([accountScope, companionScope, session?.id || "", selectedMode, webPage?.page_url || "", directMediaUrl]);
  const danmakuScopeRef = useRef(danmakuScope);
  const danmakuInputRef = useRef(danmaku);
  const blockedDanmakuRef = useRef(null);
  useLayoutEffect(() => {
    if (danmakuScopeRef.current !== danmakuScope) {
      blockedDanmakuRef.current = danmakuInputRef.current === danmaku ? danmaku : null;
      danmakuScopeRef.current = danmakuScope;
      danmakuCursorRef.current = 0;
      danmakuSpawnedRef.current.clear();
      setActiveDanmaku([]);
    } else if (danmakuInputRef.current !== danmaku) {
      blockedDanmakuRef.current = null;
    }
    danmakuInputRef.current = danmaku;
  }, [danmakuScope, danmaku]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden || danmakuScopeRef.current !== danmakuScope || selectedMode !== "web" || !pageActive) return;
      const video = webVideoRef.current;
      const current = video && Number.isFinite(video.currentTime) ? video.currentTime : -1;
      const now = Date.now();
      if (current < 0) return;
      setActiveDanmaku((prev) => {
        const next = prev.filter((item) => now - item.spawnedAt < 9000);
        return next.length === prev.length ? prev : next;
      });
      const items = blockedDanmakuRef.current !== danmaku && Array.isArray(danmaku) ? danmaku : [];
      for (let index = danmakuCursorRef.current; index < items.length; index += 1) {
        const item = items[index];
        const at = Number(item.media_time_seconds || 0);
        if (at > current + 8) break;
        const key = index + ":" + (item.text || "");
        if (danmakuSpawnedRef.current.has(key)) continue;
        danmakuSpawnedRef.current.add(key);
        danmakuCursorRef.current = index + 1;
        setActiveDanmaku((prev) => [...prev.slice(-24), { ...item, id: key + "-" + now, spawnedAt: now, lane: Math.floor(Math.random() * 3) }]);
      }
    }, 400);
    return () => window.clearInterval(timer);
  }, [danmaku, danmakuScope, selectedMode, pageActive]);

  const chooseMode = (nextMode, refresh = false) => {
    if (busy || mediaPendingRef.current || (modeLockRef.current && selectedModeRef.current !== nextMode)) return false;
    if (selectedModeRef.current !== nextMode) {
      if (pageRequestRef.current) setWebFeedback({ status: "idle", message: "已取消上一条网页解析。返回后可以重新解析。" });
      pageRequestRef.current?.abort();
      pageRequestRef.current = null;
      if (selectedModeRef.current === "direct") setDirectPlaying(false);
    }
    selectedModeRef.current = nextMode;
    setMode(nextMode);
    if (refresh) onRefresh?.(nextMode);
    return true;
  };

  const currentDirectVideo = (video) => video && video === videoRef.current && selectedModeRef.current === "direct" && (!video.currentSrc || video.currentSrc === directMediaUrl);
  const currentWebVideo = (video) => video && video === webVideoRef.current && selectedModeRef.current === "web" && (!video.currentSrc || video.currentSrc === webVideoUrl);
  const reportWebReady = (video, playing = false) => {
    if (!currentWebVideo(video)) return;
    setWebFeedback(current => current.code?.startsWith("media_")
      ? { status: "success", code: "media_ready", message: playing ? "视频已经开始播放。" : "播放器准备好了，请手动播放。" }
      : current);
  };

  const fallbackDialog = useMemo(() => {
    const text = String(screenState.lastReaction || "").trim();
    if (!text) return [];
    const key = `${screenState.lastReactionAt}:${text}`;
    return [{ key, text, at: screenState.lastReactionAt }];
  }, [screenState.lastReaction, screenState.lastReactionAt]);
  const visibleDialog = dialog.length ? dialog : fallbackDialog;
  const lastAssistantLine = visibleDialog.length
    ? [...visibleDialog].reverse().find((item) => item?.role === "assistant") || null
    : null;

  const progress = useMemo(() => {
    const duration = Number(session?.mediaDurationSeconds || 0);
    const position = Number(session?.mediaPositionSeconds || 0);
    return duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0;
  }, [session]);

  const persistDirectPlayback = (positionSeconds, durationSeconds) => {
    if (!directMediaUrl) return;
    storeDirectMediaSession(globalThis.sessionStorage, accountScope, {
      url: directMediaUrl,
      title,
      positionSeconds,
      durationSeconds,
    }, companionScope);
  };

  const reportDirectPlayback = (video, immediate = false) => {
    if (!currentDirectVideo(video) || !directMediaUrl) return;
    const positionSeconds = finiteMediaSeconds(video.currentTime);
    const durationSeconds = finiteMediaSeconds(video.duration);
    setDirectPositionSeconds(positionSeconds);
    setDirectDurationSeconds(durationSeconds);
    const roundedSecond = Math.floor(positionSeconds);
    if (roundedSecond !== lastPlaybackSecondRef.current) {
      lastPlaybackSecondRef.current = roundedSecond;
      persistDirectPlayback(positionSeconds, durationSeconds);
    }
    if (session?.id && (immediate || Date.now() - lastPlaybackPatchRef.current >= 5_000)) {
      lastPlaybackPatchRef.current = Date.now();
      onPlaybackChange?.({
        sessionId: session?.id || "",
        playbackState: video.paused ? "paused" : "playing",
        mediaPositionSeconds: positionSeconds,
        mediaDurationSeconds: durationSeconds,
      });
    }
  };

  const loadDirectMedia = () => {
    if (busy || mediaPendingRef.current) return "";
    const validation = validateDirectMediaUrl(directUrlInput);
    if (!validation.ok) {
      setDirectFeedback({ status: "error", message: validation.message });
      return "";
    }
    const changed = validation.url !== directMediaUrl;
    if (changed) {
      setDirectPlaying(false);
      setDirectPositionSeconds(0);
      setDirectDurationSeconds(0);
      resumedUrlRef.current = "";
      restoredResumeRef.current = null;
      lastPlaybackSecondRef.current = -1;
    }
    setDirectMediaUrl(validation.url);
    storeDirectMediaSession(globalThis.sessionStorage, accountScope, {
      url: validation.url,
      title,
      positionSeconds: changed ? 0 : directPositionSeconds,
      durationSeconds: changed ? 0 : directDurationSeconds,
    }, companionScope);
    setDirectFeedback({
      status: "success",
      message: "视频直链已载入。若播放器仍失败，通常是地址已过期、需要登录或来源网站禁止外部播放。",
    });
    return validation.url;
  };

  const startExternal = () =>
    onStart?.({
      title,
      mediaDurationSeconds: Math.round(Number(durationMinutes || 0) * 60),
      mediaPositionSeconds: Math.round(Number(positionMinutes || 0) * 60),
      cadenceSeconds: Math.min(
        10_800,
        Math.max(60, Math.round(Number(cadenceMinutes || 1.5) * 60)),
      ),
    });

  const runMediaOperation = async (invoke, setFeedback, fallback, onSuccess) => {
    if (busy || mediaPendingRef.current) return;
    pageRequestRef.current?.abort();
    pageRequestRef.current = null;
    const token = { selection: mediaSelectionRef.current };
    mediaPendingRef.current = token;
    setMediaPending(true);
    const accepted = () => mediaPendingRef.current === token && mediaSelectionRef.current === token.selection;
    try {
      const result = await invoke();
      if (!accepted()) return;
      if (!result) throw new Error(fallback);
      const localCodes = ["co_watch_operation_busy", "co_watch_scope_changed", "co_watch_receipt_invalid", "co_watch_session_changed", "co_watch_active_conflict", "co_watch_start_failed", "co_watch_stop_failed"];
      const suffix = result.ok === false && localCodes.includes(result.code) ? `（错误代码：${result.code}）` : "";
      setFeedback({ status: result.ok === false ? "error" : "success", message: (result.message || fallback) + suffix });
      if (result.ok !== false) onSuccess?.();
    } catch (error) {
      if (accepted()) setFeedback({ status: "error", message: error?.message || fallback });
    } finally {
      if (mediaPendingRef.current === token) { mediaPendingRef.current = null; setMediaPending(false); }
    }
  };

  const startDirect = async () => {
    if (busy || mediaPendingRef.current) return;
    const validation = validateDirectMediaUrl(directUrlInput);
    if (!validation.ok) {
      setDirectFeedback({ status: "error", message: validation.message });
      return;
    }
    if (validation.url !== directMediaUrl) {
      setDirectFeedback({
        status: "error",
        message: "链接已经改变，请先重新载入播放器，再开始一起看。",
      });
      return;
    }
    const video = videoRef.current;
    const positionSeconds = finiteMediaSeconds(video?.currentTime);
    const durationSeconds = finiteMediaSeconds(video?.duration);
    persistDirectPlayback(positionSeconds, durationSeconds);
    setDirectFeedback({ status: "checking", message: "正在建立直链共看会话…" });
    await runMediaOperation(() => onStartDirect?.({
      title, sessionMode: "direct_media", mediaUrl: validation.url,
      accountScope, companionScope,
      mediaDurationSeconds: durationSeconds, mediaPositionSeconds: positionSeconds,
    }), setDirectFeedback, "暂时无法开始视频直链共看。");
  };

  const stopExternal = () =>
    onStop?.({
      title,
      mediaPositionSeconds: Math.round(Number(positionMinutes || 0) * 60),
    });

  const stopDirect = async () => {
    if (busy || mediaPendingRef.current) return;
    const video = videoRef.current;
    const positionSeconds = finiteMediaSeconds(video?.currentTime);
    video?.pause();
    setDirectFeedback({ status: "checking", message: "正在结束这场共看…" });
    await runMediaOperation(() => onStopDirect?.({
      title, sessionId: session?.id, accountScope, companionScope, mediaPositionSeconds: positionSeconds,
    }), setDirectFeedback, "暂时无法结束视频直链共看，可以稍后重试。", () => {
      clearDirectMediaSession(globalThis.sessionStorage, accountScope, companionScope);
      setDirectMediaUrl("");
      setDirectUrlInput(current => current === directUrlInput ? "" : current);
      setDirectPositionSeconds(0); setDirectDurationSeconds(0);
    });
  };

  const loadWebPage = async (explicitUrl = "") => {
    if (busy || mediaPendingRef.current) return;
    const input = explicitUrl || webUrlInput;
    if (!input.trim()) {
      setWebFeedback({ status: "error", message: "请先粘贴网页链接。" });
      return;
    }
    if (explicitUrl) setWebUrlInput(explicitUrl);
    pageRequestRef.current?.abort();
    const controller = new AbortController();
    pageRequestRef.current = controller;
    setWebFeedback({ status: "checking", message: "正在解析网页链接…" });
    try {
      const page = await resolveCoWatchPage(input, { signal: controller.signal });
      if (pageRequestRef.current !== controller || controller.signal.aborted || selectedModeRef.current !== "web") return;
      if (!page?.embed_url) throw new Error("没有拿到可用的内嵌地址。");
      loadedWebInputRef.current = input.trim();
      setWebPage(page);
      writeStoredWebPage(accountScope, companionScope, page);
      if (page.title) setTitle(page.title);
      setWebFeedback({ status: "success", message: page.message || "网页已解析，可以开始一起看了。" });
    } catch (error) {
      if (pageRequestRef.current !== controller || controller.signal.aborted) return;
      setWebFeedback({ status: "error", message: error?.message || "网页链接解析失败。" });
    } finally {
      if (pageRequestRef.current === controller) pageRequestRef.current = null;
    }
  };

  const acceptWatchLink = (candidate) => {
    const current = watchLinkContextRef.current;
    if (!candidate || pendingWatchLinkRef.current !== candidate || current?.scope !== candidate.scope || current.blocked || mediaPendingRef.current) return false;
    if (!chooseMode("web")) return false;
    pendingWatchLinkRef.current = null;
    setPendingWatchLink(null);
    void loadWebPage(candidate.url);
    return true;
  };

  const ignoreWatchLink = (candidate) => {
    if (pendingWatchLinkRef.current !== candidate || watchLinkContextRef.current?.scope !== candidate.scope) return;
    pendingWatchLinkRef.current = null;
    setPendingWatchLink(null);
  };

  // Keep an incoming selection separate from the active session and later user edits.
  useEffect(() => {
    if (!externalPageUrl || viewKind === "music") {
      pendingWatchLinkRef.current = null;
      const timer = window.setTimeout(() => setPendingWatchLink(null), 0);
      return () => window.clearTimeout(timer);
    }
    const candidate = { url: externalPageUrl, scope: watchLinkScope, title: watchRequest?.query || "推荐视频" };
    pendingWatchLinkRef.current = candidate;
    const timer = window.setTimeout(() => {
      if (pendingWatchLinkRef.current !== candidate) return;
      setPendingWatchLink(candidate);
      acceptWatchLink(candidate);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (pendingWatchLinkRef.current === candidate) pendingWatchLinkRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPageUrl, watchRequest, watchLinkScope, viewKind]);

  const pickBilibiliVideo = (pageUrl, videoTitle) => {
    if (!chooseMode("web")) return;
    if (videoTitle) setTitle(videoTitle);
    void loadWebPage(pageUrl);
  };

  const startWebPage = async () => {
    if (busy || mediaPendingRef.current) return;
    if (!webPage?.page_url) {
      setWebFeedback({ status: "error", message: "请先解析网页链接。" });
      return;
    }
    if (webUrlInput.trim() !== loadedWebInputRef.current) {
      setWebFeedback({ status: "error", message: "网页链接已改变，请先解析并载入新链接，再开始一起看。" });
      return;
    }
    setWebFeedback({ status: "checking", message: "正在建立网页共看会话…" });
    await runMediaOperation(() => onStartDirect?.({
      title: webPage.title || title, sessionMode: "web_page", mediaUrl: webPage.page_url,
      accountScope, companionScope, mediaDurationSeconds: 0, mediaPositionSeconds: 0,
    }), setWebFeedback, "暂时无法开始网页一起看。");
  };

  const stopWebPage = async () => {
    if (busy || mediaPendingRef.current) return;
    setWebFeedback({ status: "checking", message: "正在结束这场共看…" });
    await runMediaOperation(() => onStopDirect?.({
      title, sessionId: session?.id, accountScope, companionScope, mediaPositionSeconds: 0,
    }), setWebFeedback, "暂时无法结束网页一起看。", () => {
      writeStoredWebPage(accountScope, companionScope, null);
      setWebPage(null);
      setWebUrlInput(current => current === webUrlInput ? "" : current);
    });
  };

  const submitReply = async (event) => {
    event.preventDefault();
    const text = reply.trim();
    if (!text || busy || replyPendingRef.current || !session?.id || !onReply) return;
    replyPendingRef.current = true;
    try {
      const sent = await onReply(
        text,
        selectedMode === "music" ? musicPositionSeconds : selectedMode === "direct" ? directPositionSeconds : undefined,
      );
      if (sent !== false) setReply(current => current.trim() === text ? "" : current);
    } catch (error) {
      const message = error?.message || "这条共看消息未发送，可以重试。";
      if (selectedMode === "web") setWebFeedback({ status: "error", message });
      else setDirectFeedback({ status: "error", message });
    } finally { replyPendingRef.current = false; }
  };

  const currentFeedback =
    selectedMode === "web" ? webFeedback : selectedMode === "direct" ? directFeedback : feedback;
  const replyError = (selectedMode === "web" || selectedMode === "direct") &&
    feedback?.status === "error" && feedback.message !== currentFeedback?.message
    ? feedback.message : "";

  return (
    <section className="feature-page together-page" aria-label={viewKind === "music" ? "一起听歌" : "一起看"}>
      <header className="together-heading">
        <div>
          <small>{viewKind === "music" ? "LISTENING" : "TOGETHER"}</small>
          <h2>{viewKind === "music" ? "和 " + aiName + " 一起听歌" : "和 " + aiName + " 一起看"}</h2>
          <p>
            {selectedMode === "music"
              ? "在前台用浏览器音频播放器，和伴侣同步听同一份歌单。"
              : selectedMode === "web"
              ? "在 DengTa 内打开哔哩哔哩、爱奇艺等官方网页一起看；AI 依据标题和你的消息陪聊。"
              : selectedMode === "direct"
              ? "在 DengTa 内播放 HTTPS 视频直链；AI 不会抓取或自动观看视频。"
              : "切到任意视频 App，DengTa 会在画面有变化时陪你聊。"}
          </p>
        </div>
        <span className={`together-live${selectedActive ? " is-live" : ""}`}>
          <i aria-hidden="true" />
          {selectedActive
            ? selectedMode === "web"
              ? "网页共看中"
              : selectedMode === "direct"
              ? directPlaying
                ? "播放共看中"
                : "播放器已暂停"
              : screenState.paused
                ? "已暂停"
                : "共看中"
            : "未开始"}
        </span>
      </header>

      {externalPageUrl && viewKind !== "music" && pendingWatchLink?.scope === watchLinkScope && <section className="together-watch-handoff" aria-label="待选视频">
        <div><strong>已收到待选视频</strong><p>{pendingWatchLink.title}</p></div>
        <p role="status">{watchLinkBlocked ? busy ? "当前操作完成后可载入，推荐已保留。" : "结束当前活动后可载入，正在看的内容保持不变。" : "现在可以载入这条推荐，再由你决定是否开始一起看。"}</p>
        <div className="together-direct-actions">
          <button type="button" disabled={watchLinkBlocked} onClick={() => acceptWatchLink(pendingWatchLink)}>载入待选视频</button>
          <button type="button" onClick={() => ignoreWatchLink(pendingWatchLink)}>忽略这条推荐</button>
        </div>
      </section>}
      {selectedMode !== "music" && <WatchQueryPanel key={watchRequest?.id || "watch-search"} initialQuery={watchRequest?.query || ""} active={selectedActive} />}

      {selectedMode !== "music" && <div className="together-mode-switch" role="tablist" aria-label="一起看方式">
        <button
          type="button"
          role="tab"
          aria-selected={selectedMode === "external"}
          className={selectedMode === "external" ? "is-selected" : ""}
          disabled={busy || (modeLocked && selectedMode !== "external")}
          onClick={() => chooseMode("external", true)}
        >
          <MonitorPlay aria-hidden="true" />
          外部 App 屏幕共看
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={selectedMode === "direct"}
          className={selectedMode === "direct" ? "is-selected" : ""}
          disabled={busy || (modeLocked && selectedMode !== "direct")}
          onClick={() => chooseMode("direct", true)}
        >
          <Link2 aria-hidden="true" />
          DengTa 视频直链
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={selectedMode === "web"}
          className={selectedMode === "web" ? "is-selected" : ""}
          disabled={busy || (modeLocked && selectedMode !== "web")}
          onClick={() => chooseMode("web", true)}
        >
          <Globe aria-hidden="true" />
          网页一起看
        </button>
      </div>}

      <div className="together-layout">
        <div className="together-stage">
          {selectedMode === "music" ? (
            <div className="together-stage-empty together-music-stage"><Music2 aria-hidden="true" /><strong>一起听歌</strong><span>播放器保持在前台运行，歌单与进度会同步到本场会话。</span></div>
          ) : selectedMode === "web" ? (
            webPage ? (
              <div className="together-web-stage">
                {webPage.provider === "bilibili" && webPage.bvid ? (
                  <div className="together-video-wrap">
                    <video
                      key={webVideoUrl}
                      ref={attachWebVideo}
                      controls
                      playsInline
                      poster={webPage.poster || ""}
                      src={webVideoUrl}
                      preload="metadata"
                      onLoadedMetadata={(event) => reportWebReady(event.currentTarget)}
                      onCanPlay={(event) => reportWebReady(event.currentTarget)}
                      onPlaying={(event) => reportWebReady(event.currentTarget, true)}
                      onError={(event) => { if (currentWebVideo(event.currentTarget)) setWebFeedback(mediaPlaybackFeedback(event.currentTarget.error)); }}
                    />
                    {webFeedback.status === "error" && <button type="button" onClick={() => {
                      setWebFeedback({ status: "checking", code: "media_loading", message: "正在重新载入视频，请准备好后手动播放。" });
                      webVideoRef.current?.load();
                    }}><RefreshCw aria-hidden="true" />重新载入视频</button>}
                    <div className="together-danmaku-layer">
                      {activeDanmaku.map((item) => (
                        <div
                          key={item.id}
                          className={`together-danmaku-item lane-${item.lane || 0}`}
                        >
                          {item.text}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <iframe
                    src={webPage.embed_url}
                    title={webPage.title || "网页一起看"}
                    allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                    referrerPolicy="no-referrer"
                    allowFullScreen
                  />
                )}
                {webPage.embed_likely_blocked && webPage.provider !== "bilibili" && (
                  <p className="together-device-note">
                    若上方画面空白，可能是该网站自身不支持外部内嵌；DengTa 不做任何内嵌限制，也可改用视频直链或哔哩哔哩链接。
                  </p>
                )}
                <a
                  className="together-device-note together-web-open"
                  href={webPage.page_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  画面点不开？在新窗口打开 ↗
                </a>
              </div>
            ) : (
              <div className="together-stage-empty">
                <Globe aria-hidden="true" />
                <strong>等待网页链接</strong>
                <span>在右侧粘贴哔哩哔哩、爱奇艺等官方链接并解析。</span>
              </div>
            )
          ) : selectedMode === "direct" ? (
            directMediaUrl ? (
              <video
                key={directMediaUrl}
                ref={attachDirectVideo}
                src={directMediaUrl}
                controls
                playsInline
                preload="metadata"
                referrerPolicy="no-referrer"
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  if (!currentDirectVideo(video)) return;
                  if (resumedUrlRef.current !== directMediaUrl) {
                    const restoredResume = restoredResumeRef.current;
                    const resumeAt = Math.min(
                      restoredResume?.url === directMediaUrl
                        ? restoredResume.positionSeconds
                        : 0,
                      finiteMediaSeconds(video.duration),
                    );
                    if (resumeAt > 0) video.currentTime = resumeAt;
                    restoredResumeRef.current = null;
                    resumedUrlRef.current = directMediaUrl;
                  }
                  reportDirectPlayback(video);
                  setDirectPlaying(!video.paused && !video.ended);
                  setDirectFeedback({
                    status: "success",
                    message: "播放器准备好了。点击播放后，可开始这场直链共看。",
                  });
                }}
                onDurationChange={(event) => reportDirectPlayback(event.currentTarget)}
                onTimeUpdate={(event) => reportDirectPlayback(event.currentTarget)}
                onPlay={(event) => { if (currentDirectVideo(event.currentTarget)) { localVideoPlayback("pending"); setDirectPlaying(true); reportDirectPlayback(event.currentTarget, true); } }}
                onPlaying={(event) => { if (currentDirectVideo(event.currentTarget) && !event.currentTarget.paused) localVideoPlayback("playing"); }}
                onPause={(event) => { if (currentDirectVideo(event.currentTarget) && event.currentTarget.paused) { localVideoPlayback("paused"); setDirectPlaying(false); reportDirectPlayback(event.currentTarget, true); } }}
                onSeeked={(event) => reportDirectPlayback(event.currentTarget, true)}
                onEnded={(event) => { if (currentDirectVideo(event.currentTarget) && event.currentTarget.ended) { localVideoPlayback("ended"); setDirectPlaying(false); reportDirectPlayback(event.currentTarget, true); } }}
                onError={(event) => {
                  if (!currentDirectVideo(event.currentTarget)) return;
                  localVideoPlayback("error");
                  setDirectPlaying(false);
                  setDirectFeedback(mediaPlaybackFeedback(event.currentTarget.error));
                }}
              >
                当前浏览器不支持 HTML5 视频播放。
              </video>
            ) : (
              <div className="together-stage-empty">
                <Link2 aria-hidden="true" />
                <strong>等待 HTTPS 视频直链</strong>
                <span>先在右侧粘贴并载入媒体直链，视频将在这里播放。</span>
              </div>
            )
          ) : preview?.src ? (
            <img src={preview.src} alt="上次用于共看回应的屏幕画面" />
          ) : (
            <div className="together-stage-empty">
              <MonitorPlay aria-hidden="true" />
              <strong>等待外部 App 画面</strong>
              <span>回到 DengTa 后，这里只保留最近一次临时预览。</span>
            </div>
          )}

        </div>

        {lastAssistantLine ? (
          <p className="together-plot-line">
            <span>📺 {aiName} 剧情：</span>
            {lastAssistantLine.text}
          </p>
        ) : null}

        <div className="together-controls">
          {selectedMode === "music" ? (
            <TogetherMusic
              key={JSON.stringify([accountScope, companionScope, musicRequest?.id || "music"])}
              accountScope={accountScope}
              companionScope={companionScope}
              request={musicRequest}
              session={musicActive ? session : null}
              busy={busy}
              onStart={onStartMusic}
              onEnd={onStopMusic}
              onPlaybackChange={onMusicPlaybackChange}
              onLocalPlaybackChange={onLocalPlaybackChange}
              onUnderstandingSaved={onMusicUnderstandingSaved}
              onPositionChange={setMusicPositionSeconds}
            />
          ) : selectedMode === "web" ? (
            <div className="together-setup together-web-setup">
              {!pageActive && (
                <>
                  <label>
                    <span>网页链接</span>
                    <input
                      type="url"
                      inputMode="url"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck="false"
                      value={webUrlInput}
                      onChange={(event) => setWebUrlInput(event.target.value)}
                      placeholder="https://www.bilibili.com/video/BV…"
                      aria-describedby="web-page-guidance"
                    />
                  </label>
                  <div className="together-direct-actions">
                    <button type="button" disabled={busy} onClick={() => void loadWebPage()}>
                      <Globe aria-hidden="true" />
                      解析并载入
                    </button>
                    <button
                      type="button"
                      className="together-primary"
                      disabled={busy || !webPage}
                      onClick={() => void startWebPage()}
                    >
                      <Play aria-hidden="true" />
                      {busy ? "正在准备…" : "开始网页一起看"}
                    </button>
                  </div>
                  <p id="web-page-guidance" className="together-device-note">
                    支持哔哩哔哩官方链接（自动切换内嵌播放器）与其它 HTTPS 网页；DengTa 不做内嵌限制，部分站点自身可能不支持外部内嵌。网页画面不会发送给 AI，AI 依据标题与你发送的文字陪聊。
                  </p>
                  <details className="music-provider-connect bilibili-provider">
                    <summary>扫码登录哔哩哔哩，从收藏夹挑视频</summary>
                    <BilibiliQrLogin onPickVideo={pickBilibiliVideo} />
                  </details>
                </>
              )}
              {pageActive && (
                <div className="together-session-actions">
                  <button type="button" disabled={busy} onClick={() => void stopWebPage()}>
                    <CircleStop aria-hidden="true" />
                    结束本场
                  </button>
                </div>
              )}
            </div>
          ) : selectedMode === "direct" ? (
            <div className="together-setup together-direct-setup">
              {!directActive && (
                <>
                  <label>
                    <span>正在看什么（可选）</span>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={180}
                      placeholder="电影、剧集或视频标题"
                    />
                  </label>
                  <label>
                    <span>HTTPS 视频直链</span>
                    <input
                      type="url"
                      inputMode="url"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck="false"
                      value={directUrlInput}
                      onChange={(event) => setDirectUrlInput(event.target.value)}
                      placeholder="https://example.com/video.mp4"
                      aria-describedby="direct-media-guidance"
                    />
                  </label>
                  <div className="together-direct-actions">
                    {directFeedback.status === "error" && directMediaUrl && <button type="button" onClick={() => {
                      setDirectFeedback({ status: "checking", message: "正在重新载入视频，请准备好后手动播放。" });
                      videoRef.current?.load();
                    }}><RefreshCw aria-hidden="true" />重新载入视频</button>}
                    <button type="button" disabled={busy} onClick={loadDirectMedia}>
                      <Link2 aria-hidden="true" />
                      载入播放器
                    </button>
                    <button
                      type="button"
                      className="together-primary"
                      disabled={busy || !directMediaUrl}
                      onClick={startDirect}
                    >
                      <Play aria-hidden="true" />
                      {busy ? "正在准备…" : "开始直链共看"}
                    </button>
                  </div>
                </>
              )}
              {directActive && (
                <div className="together-now">
                  <div>
                    <Clock3 aria-hidden="true" />
                    <span>播放器进度</span>
                    <strong>{formatMediaTime(directPositionSeconds)}</strong>
                  </div>
                  <div>
                    <Play aria-hidden="true" />
                    <span>本机状态</span>
                    <strong>{directPlaying ? "正在播放" : "已暂停"}</strong>
                  </div>
                </div>
              )}
              {directActive && (
                <div className="together-session-actions">
                  {directFeedback.status === "error" && <button type="button" onClick={() => {
                    setDirectFeedback({ status: "checking", message: "正在重新载入视频，请准备好后手动播放。" });
                    videoRef.current?.load();
                  }}><RefreshCw aria-hidden="true" />重新载入视频</button>}
                  <button type="button" disabled={busy} onClick={stopDirect}>
                    <CircleStop aria-hidden="true" />
                    结束本场
                  </button>
                </div>
              )}
              <p id="direct-media-guidance" className="together-device-note">
                只支持播放器可直接读取的 HTTPS 媒体地址。普通爱奇艺、哔哩哔哩网页链接不是视频直链，受平台授权与防盗链限制，不能在这里提取播放。
              </p>
              <p className="together-device-note">
                直链模式只负责本机播放，不上传视频画面。AI 只能根据你填写的标题、播放进度和你主动发送的文字陪聊；如需让 AI 观察画面，请使用 Android 的“外部 App 屏幕共看”。
              </p>
              {directActive && <section className="together-cast" aria-label="电视接收">
                <header><strong>在电视上接收</strong><span>{castReceiver?.status === "online" ? "接收端在线" : castReceiver?.status || "等待接收端"}</span></header>
                <p>在电视浏览器打开 <strong>{globalThis.location?.origin || ""}/receive</strong>，再输入短期配对码。这里不会显示媒体 URL 或接收端凭据。</p>
                {castPairing?.pairingCode ? <div className="together-pairing-code"><b>{castPairing.pairingCode}</b><small>会话编号：{castPairing.sessionId}</small><small>有效期至 {castPairing.expiresAt ? new Date(castPairing.expiresAt).toLocaleTimeString("zh-CN") : "短期有效"}</small></div> : <button type="button" disabled={busy} onClick={onGenerateCastPairing}>生成配对码</button>}
                {castReceiver?.lastAckAt && <small>最近确认：{formatMoment(castReceiver.lastAckAt)}</small>}
                <div className="cast-provider-list">{castProviders.map((provider) => <span key={provider.id}><b>{provider.label}</b><small>{provider.status === "ready" ? "可用" : `计划中${provider.detected ? " · 检测到浏览器能力" : ""}`}</small></span>)}</div>
              </section>}
            </div>
          ) : !active ? (
            <div className="together-setup">
              <label>
                <span>正在看什么（可选）</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={180}
                  placeholder="电影、剧集或视频标题"
                />
              </label>
              <div className="together-time-inputs">
                <label>
                  <span>总时长 / 分钟</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(event.target.value)}
                  />
                </label>
                <label>
                  <span>当前位置 / 分钟</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={positionMinutes}
                    onChange={(event) => setPositionMinutes(event.target.value)}
                  />
                </label>
              </div>
              <label>
                <span>查看间隔 · 1–180 分钟</span>
                <input
                  type="number"
                  min="1"
                  max="180"
                  step="0.5"
                  inputMode="decimal"
                  value={cadenceMinutes}
                  onChange={(event) => setCadenceMinutes(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="together-primary"
                disabled={busy || !screenState.supported}
                onClick={startExternal}
              >
                <Play aria-hidden="true" />
                {busy ? "正在准备…" : "开始一起看"}
              </button>
              {!screenState.supported && (
                <p className="together-device-note">
                  屏幕共看需要 DengTa Android 客户端；网页端仍可查看会话回执。
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="together-now">
                <div>
                  <Clock3 aria-hidden="true" />
                  <span>上次回应</span>
                  <strong>
                    {formatMoment(screenState.lastReactionAt, "还在一起看")}
                  </strong>
                </div>
                <div>
                  <RefreshCw aria-hidden="true" />
                  <span>下次观察</span>
                  <strong>
                    {screenState.paused
                      ? "暂停中"
                      : formatMoment(screenState.nextWatchCaptureAt, "约 90 秒")}
                  </strong>
                </div>
              </div>
              <div className="together-session-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPause?.(!screenState.paused)}
                >
                  {screenState.paused ? <Play /> : <Pause />}
                  {screenState.paused ? "继续共看" : "暂停观察"}
                </button>
                <button type="button" disabled={busy} onClick={stopExternal}>
                  <CircleStop />
                  结束本场
                </button>
              </div>
            </>
          )}

          <p
            className={`together-feedback is-${currentFeedback?.status || "idle"}`}
            role="status"
          >
            {currentFeedback?.message || "等待开始。"}
          </p>
          {selectedMode === "external" && (
            <p className="together-cadence">
              默认每 90 秒检查一次，也可在开始前设为 1–180 分钟；每次检查只在画面有明显变化时回应。默认节奏最长 8 分钟会再次检查，自定义超过 8 分钟时按设定间隔。模型生成时间另计。
            </p>
          )}
        </div>
      </div>

      {session && (
        <section className="together-progress" aria-label="共看进度">
          <div>
            <strong>{session.title || "这一场共看"}</strong>
            <span>
              {formatMediaTime(session.mediaPositionSeconds)} / {session.mediaDurationSeconds
                ? formatMediaTime(session.mediaDurationSeconds)
                : "未填写"}
            </span>
          </div>
          <i aria-hidden="true"><b style={{ width: `${progress}%` }} /></i>
          <small>{session.frameCount} 次观察 · {session.reactionCount} 次回应</small>
        </section>
      )}

      <section className="together-dialog" aria-label="本场回应">
        <header>
          <MessageCircleMore aria-hidden="true" />
          <div><strong>本场回应</strong><span>{selectedMode === "music" ? `和${aiName}围绕当前歌曲聊聊` : `${aiName} 看到有意思的地方会主动说话`}</span></div>
          <button type="button" onClick={() => onRefresh?.(selectedMode)} disabled={busy} aria-label="刷新本场状态">
            <RefreshCw aria-hidden="true" />
          </button>
        </header>

        {replyError && <p id={replyFeedbackId} className="together-feedback is-error" role="alert">{replyError}</p>}
        {visibleDialog.length ? visibleDialog.map((item) => (
          <article key={item.key}>
            <span>{item.role === "user" ? "我" : aiName}</span>
            <p>{item.text}</p>
            <time>{formatMoment(item.at, "刚刚")}</time>
          </article>
        )) : (
          <p className="together-dialog-empty">
            {selectedMode === "music"
              ? "开始后可在这里复用本场回复区聊歌曲；曲名和歌词不会在前端过滤。"
              : selectedMode === "web"
              ? "开始后，可以按网页标题与内容手动聊天；网页地址不会随消息发送，AI 不会自动读取网页画面。"
              : selectedMode === "direct"
              ? "开始后，可以按标题和当前进度手动聊天；AI 不会自动读取视频画面，视频地址也不会随消息发送。"
              : "开始后，主动回应会出现在这里，也会以声音和振动提醒你。"}
          </p>
        )}
        {session?.status === "active" && (
          <form className="together-reply" onSubmit={submitReply}>
            <input
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              maxLength={500}
              placeholder={selectedMode === "music" ? `和${aiName}聊聊当前歌曲` : `和${aiName}聊聊正在看的内容`}
              aria-label="共看消息"
              aria-describedby={replyError ? replyFeedbackId : undefined}
            />
            <button type="submit" disabled={busy || !reply.trim()}>
              发送
            </button>
          </form>
        )}
      </section>

      {receipt?.status === "ended" && (
        <section className="together-receipt" aria-label="本场回执">
          <small>SESSION RECEIPT</small>
          <strong>这一场已经结束</strong>
          <span>{receipt.frameCount} 次观察 · {receipt.reactionCount} 次回应</span>
          <time>{formatMoment(receipt.endedAt, "刚刚结束")}</time>
        </section>
      )}
    </section>
  );
}
