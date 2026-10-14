import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CircleStop,
  Heart,
  ListMusic,
  ListPlus,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";
import {
  applyCoWatchMusicQueueOperation,
  formatMediaTime,
  readCoWatchMusicQueue,
} from "./co-watch.js";
import {
  connectNeteaseMcp,
  cookieGetDailyRecommend,
  cookieGetMyPlaylists,
  cookieGetPlayHistory,
  cookieGetPlaylistTracks,
  cookieLikeSong,
  cookieSearchNetease,
  deleteMusicFavorite,
  getMusicPlaylist,
  importNeteaseShare,
  clearNeteaseCookieSession,
  readNeteaseCookieSession,
  saveNeteaseCookieSession,
  listNeteaseConnections,
  listMusicFavorites,
  listMusicPlaylists,
  putMusicFavorite,
  requestExternalMusicPlayback,
} from "./music-listening.js";
import { MUSIC_PLAYBACK_MODES, musicPlaybackIsInternal, resolveMusicPlayback } from "./music-playback.js";
import { openNeteasePlayback } from "./netease-playback.js";
import { browserLauncherAvailable, openBuiltInBrowser, readBrowserCookie } from "./browser-launcher.js";
import MusicUnderstandingPanel from "./MusicUnderstandingPanel.jsx";

import { createMusicQueueRequests } from "./music-queue-requests.js";
import { useMusicScope } from "./use-music-scope.js";
import { useLocalPlaybackHandoff } from "./useBuiltInNowPlaying.js";
import { runMusicTask, musicErrorMessage } from "./music-operation-feedback.js";
import { launchExternalMusic, externalMusicFeedback } from "./music-external-launch.js";

import MusicSettings from "./MusicSettings.jsx";
import MusicImportDialog from "./MusicImportDialog.jsx";
import MusicPagedList from "./MusicPagedList.jsx";
import MusicMoments from "./MusicMoments.jsx";
import { musicMomentError } from "./music-moments.js";
import { musicPlaylistStatus } from "./music-playlist-status.js";

const ERROR_MESSAGE = "音频无法播放。链接可能已过期、需要登录、受到防盗链限制，或使用了 DRM。DengTa 不会绕过这些限制。";
const REPEAT_LABELS = Object.freeze({ off: "不循环", all: "列表循环", one: "单曲循环" });
const COOKIE_READ_FEEDBACK = Object.freeze({
  search: ["正在搜索歌曲…", "搜索失败，请重试或重新连接网易云。", "重试搜索"],
  playlists: ["正在读取我的歌单…", "读取歌单失败，请重试。", "重试读取歌单"],
  detail: ["正在读取歌单内容…", "读取歌单内容失败，请重试。", "重试读取内容"],
  daily: ["正在读取每日推荐…", "每日推荐读取失败，请重试。", "重试读取推荐"],
  history: ["正在读取听歌记录…", "听歌记录读取失败，请重试。", "重试读取记录"],
});

function CookieReadFeedback({ kind, read, busy, onRetry, readyMessage = "" }) {
  if (!read || read.phase === "idle") return null;
  const message = read.phase === "loading" ? COOKIE_READ_FEEDBACK[kind][0] : read.phase === "error" ? read.message : read.phase === "cancelled" ? "读取已取消，可重新读取。" : readyMessage;
  if (!message) return null;
  return <div className="music-provider-feedback"><p role={read.phase === "error" ? "alert" : "status"}>{message}</p>{["error", "cancelled"].includes(read.phase) && <button type="button" disabled={busy} onClick={onRetry}>{COOKIE_READ_FEEDBACK[kind][2]}</button>}</div>;
}

export default function TogetherMusic({ session, busy = false, onStart, onEnd, onPlaybackChange, onLocalPlaybackChange, onPositionChange, onUnderstandingSaved, onOpenMcpDeviceCenter, request = null, accountScope = "", companionScope = "" }) {
  const musicScope = useMusicScope(accountScope, companionScope);
  const audioRef = useRef(null);
  const attachAudio = useCallback((node) => {
    const previous = audioRef.current;
    audioRef.current = node;
    if (previous && previous !== node) {
      previous.pause();
      previous.removeAttribute("src");
      previous.load();
    }
  }, []);
  const momentTargetRef = useRef(null);
  const mountedRef = useRef(true);
  const queueRef = useRef(null);
  const queueErrorRef = useRef("");
  const loadedPlaylistsRef = useRef({});
  const operationRef = useRef(null);
  const musicRequestOptions = useCallback(() => musicScope.capture().options, [musicScope]);
  const [retryQueue, setRetryQueue] = useState(null);
  const lastReportRef = useRef(0);
  const advanceJobRef = useRef(null);
  const resumeIntentRef = useRef(null);
  const playbackIntentRef = useRef({ version: 0, play: null });
  const mediaSessionOwnerRef = useRef(null);
  const [resumeIntent, setResumeIntent] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [loadedPlaylists, setLoadedPlaylists] = useState({});
  const [playlist, setPlaylist] = useState(null);
  const [localIndex, setLocalIndex] = useState(0);
  const [favorites, setFavorites] = useState([]);
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("正在读取歌单与收藏…");
  const [error, setError] = useState("");
  const [connections, setConnections] = useState([]);
  const [connectionId, setConnectionId] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [connectionEndpoint, setConnectionEndpoint] = useState("");
  const [connectionToken, setConnectionToken] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerStatus, setProviderStatus] = useState("");
  const RANDOM_PLAY_KEY = "dengta_random_play_enabled";
  const [randomPlayEnabled, setRandomPlayEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(RANDOM_PLAY_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleRandomPlay = useCallback((enabled) => {
    setRandomPlayEnabled(enabled);
    try {
      window.localStorage.setItem(RANDOM_PLAY_KEY, enabled ? "1" : "0");
    } catch {
      // 存储不可用时忽略
    }
  }, []);

  const [cookieStatus, setCookieStatus] = useState({
    checking: true,
    connected: false,
    account_name: "",
  });
  const [cookieBusy, setCookieBusy] = useState(false);
  const [cookieGeneration, setCookieGeneration] = useState(0);
  const cookieIdentityRef = useRef({ generation: 0, connected: false, changing: false, resetResults: false });
  const [importOpen, setImportOpen] = useState(false);
  const pendingMcpNavigation = useRef(null);
  useEffect(() => {
    if (importOpen || !pendingMcpNavigation.current) return;
    const destination = pendingMcpNavigation.current;
    pendingMcpNavigation.current = null;
    if (mountedRef.current) destination();
  }, [importOpen]);
  const openMcpFromImport = () => {
    if (!mountedRef.current || importBusyRef.current || typeof onOpenMcpDeviceCenter !== "function") return;
    pendingMcpNavigation.current = onOpenMcpDeviceCenter;
    setImportOpen(false);
  };
  const [importBusy, setImportBusy] = useState(false);
  const importBusyRef = useRef(false);
  const updateImportBusy = useCallback((value) => {
    importBusyRef.current = Boolean(value);
    setImportBusy(importBusyRef.current);
  }, []);
  const playlistSelectionRef = useRef(0);

  useLayoutEffect(() => () => {
    cookieIdentityRef.current.generation++;
    cookieIdentityRef.current.connected = false;
    cookieIdentityRef.current.changing = false;
    cookieIdentityRef.current.resetResults = true;
  }, [accountScope, companionScope]);

  const cookieIdentityCurrent = () => cookieGeneration === cookieIdentityRef.current.generation && musicScope.current(musicScope.capture());
  const canUseCookie = () => cookieIdentityCurrent() && cookieIdentityRef.current.connected && !cookieIdentityRef.current.changing;

  const active = session?.status === "active" && session?.sessionMode === "listening";
  const activeSessionId = active ? session.id : "";
  const queueConfirmed = active && queue?.sessionId === activeSessionId;
  const sessionPlaylist = active ? loadedPlaylists[session?.musicPlaylistId] || null : null;
  const sessionItem = sessionPlaylist?.items.find((entry) => entry.id === session?.musicPlaylistItemId) || null;
  const currentQueueItem = queueConfirmed
    ? queue?.items.find((entry) => entry.id === queue.currentQueueItemId) || null
    : null;
  const queuedPlaylist = currentQueueItem ? loadedPlaylists[currentQueueItem.playlistId] : null;
  const queuedSourceItem = queuedPlaylist?.items.find((entry) => entry.id === currentQueueItem?.itemId) || null;
  const item = active
    ? queueConfirmed ? queuedSourceItem || currentQueueItem : sessionItem
    : playlist?.items?.[localIndex] || null;
  const itemPlaylist = active ? queuedSourceItem ? queuedPlaylist : currentQueueItem ? loadedPlaylists[currentQueueItem.playlistId] || null : sessionPlaylist : playlist;
  const itemId = active ? queueConfirmed ? currentQueueItem?.itemId : sessionItem?.id : item?.id;
  const itemPlaylistId = active ? queueConfirmed ? currentQueueItem?.playlistId : sessionPlaylist?.id : itemPlaylist?.id;
  const favorite = Boolean(itemId && favorites.some((entry) => entry.itemId === itemId));
  const playback = resolveMusicPlayback(item);
  const internalPlayback = musicPlaybackIsInternal(playback);
  const externalSession = active && playback.mode === MUSIC_PLAYBACK_MODES.external;
  const playableItemUrl = internalPlayback ? playback.url : "";
  const queueItemId = currentQueueItem?.id || "";
  const mediaGeneration = useMemo(() => ({ accountScope, companionScope, activeSessionId, queueItemId, itemId, itemPlaylistId, internalPlayback, playableItemUrl }), [accountScope, companionScope, activeSessionId, queueItemId, itemId, itemPlaylistId, internalPlayback, playableItemUrl]);
  const localPlayback = useLocalPlaybackHandoff({ accountScope, companionScope, generation: mediaGeneration, onLocalPlaybackChange });

  useLayoutEffect(() => () => {
    advanceJobRef.current = null;
    resumeIntentRef.current = null;
    playbackIntentRef.current = { version: playbackIntentRef.current.version + 1, play: null };
  }, [accountScope, companionScope, activeSessionId]);

  useLayoutEffect(() => {
    momentTargetRef.current = { accountScope, companionScope, itemId, itemPlaylistId, title: item?.title, artist: item?.artist || "", internalPlayback, playableItemUrl, token: musicScope.capture(), mediaGeneration, activeSessionId, revision: session?.revision, durationSeconds: item?.durationSeconds || 0, onPositionChange, onPlaybackChange };
    return () => { momentTargetRef.current = null; };
  }, [accountScope, companionScope, itemId, itemPlaylistId, item?.title, item?.artist, item?.durationSeconds, internalPlayback, playableItemUrl, musicScope, mediaGeneration, activeSessionId, session?.revision, onPositionChange, onPlaybackChange]);

  const currentAudioTarget = useCallback((audio, metadata = true) => {
    const target = momentTargetRef.current;
    if (!mountedRef.current || !target || target.mediaGeneration !== mediaGeneration || !musicScope.current(target.token) || audio !== audioRef.current || !audio || !target.internalPlayback || !target.playableItemUrl) return null;
    if (metadata && (audio.currentSrc !== target.playableItemUrl || audio.readyState < 1 || !Number.isFinite(audio.currentTime) || audio.currentTime < 0)) return null;
    if (!metadata && (audio.getAttribute("src") !== target.playableItemUrl || (audio.currentSrc && audio.currentSrc !== target.playableItemUrl))) return null;
    return target;
  }, [mediaGeneration, musicScope]);
  const playCurrentAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!currentAudioTarget(audio, false)) return;
    const version = playbackIntentRef.current.version + 1;
    playbackIntentRef.current = { version, play: true };
    resumeIntentRef.current = null;
    const owner = localPlayback("pending");
    void audio.play().catch(() => {
      localPlayback("error", owner);
      if (playbackIntentRef.current.version === version && currentAudioTarget(audio, false)) setError("浏览器阻止了自动播放，请再次点击播放。");
    });
  }, [currentAudioTarget, localPlayback]);
  const pauseCurrentAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!currentAudioTarget(audio, false)) return;
    playbackIntentRef.current = { version: playbackIntentRef.current.version + 1, play: false };
    resumeIntentRef.current = null;
    audio.pause();
    setPlaying(false);
  }, [currentAudioTarget]);

  const readMomentTarget = (expectedScope) => {
    const target = momentTargetRef.current;
    if (!mountedRef.current || !target || !musicScope.current(target.token) || (expectedScope && (expectedScope.accountScope !== target.accountScope || expectedScope.companionScope !== target.companionScope))) throw musicMomentError("music_moment_scope_changed");
    if (!target.itemId || !target.itemPlaylistId) throw musicMomentError("music_moment_player_unready");
    return target;
  };
  const readyMomentAudio = (target) => {
    const audio = audioRef.current;
    if (!target.internalPlayback || !target.playableItemUrl || !audio || audio.currentSrc !== target.playableItemUrl || audio.readyState < 1 || !Number.isFinite(audio.duration) || audio.duration <= 0 || !Number.isFinite(audio.currentTime) || audio.currentTime < 0 || audio.currentTime > audio.duration) throw musicMomentError("music_moment_player_unready");
    return audio;
  };
  const captureMusicMoment = () => {
    const target = readMomentTarget();
    return { playlistId: target.itemPlaylistId, itemId: target.itemId, title: target.title, artist: target.artist, positionSeconds: target.internalPlayback ? readyMomentAudio(target).currentTime : 0, positionSource: target.internalPlayback ? "device" : "manual" };
  };
  const seekMusicMoment = (card, scope) => {
    const target = readMomentTarget(scope);
    if (card.positionSource !== "device" || card.itemId !== target.itemId || card.playlistId !== target.itemPlaylistId) throw musicMomentError("music_moment_player_unready");
    const audio = readyMomentAudio(target);
    if (!Number.isFinite(card.positionSeconds) || card.positionSeconds < 0 || card.positionSeconds > audio.duration) throw musicMomentError("music_moment_player_unready");
    audio.currentTime = card.positionSeconds;
  };

  const rememberPlaylist = (next) => {
    if (!next?.id) return;
    setLoadedPlaylists((current) => {
      const updated = { ...current, [next.id]: next };
      loadedPlaylistsRef.current = updated;
      return updated;
    });
  };

  const loadQueuePlaylists = useCallback(async (nextQueue, preferredPlaylist = null) => {
    const ids = new Set((nextQueue?.items || []).map((entry) => entry.playlistId).filter(Boolean));
    if (preferredPlaylist?.id) ids.delete(preferredPlaylist.id);
    const missing = Array.from(ids).filter((id) => !loadedPlaylistsRef.current[id]);
    const results = await Promise.allSettled(missing.map((id) => getMusicPlaylist(id, musicRequestOptions())));
    if (!mountedRef.current) return;
    const nextLoaded = {};
    if (preferredPlaylist?.id) nextLoaded[preferredPlaylist.id] = preferredPlaylist;
    for (const result of results) {
      if (result.status === "fulfilled" && result.value?.id) nextLoaded[result.value.id] = result.value;
    }
    if (Object.keys(nextLoaded).length) {
      setLoadedPlaylists((current) => {
        const updated = { ...current, ...nextLoaded };
        loadedPlaylistsRef.current = updated;
        return updated;
      });
    }
  }, [musicRequestOptions]);

  const queueRequestsRef = useRef(null);
  useLayoutEffect(() => {
    const requests = createMusicQueueRequests({
    getIdentity: () => ({ accountScope, companionScope }),
    readQueue: readCoWatchMusicQueue,
    applyOperation: applyCoWatchMusicQueueOperation,
    onBusy: setQueueBusy,
    onQueue: async (next) => {
      if (!mountedRef.current) return;
      queueRef.current = next; setQueue(next); await loadQueuePlaylists(next);
    },
    });
    queueRequestsRef.current = requests;
    return () => { requests.invalidate(); if (queueRequestsRef.current === requests) queueRequestsRef.current = null; };
  }, [accountScope, companionScope, loadQueuePlaylists]);
  useLayoutEffect(() => {
    queueRequestsRef.current.bind(session?.id || "");
  }, [session?.id, accountScope, companionScope, loadQueuePlaylists]);
  const runQueueOperation = async (operation, options) => {
    const requests = queueRequestsRef.current, token = musicScope.capture();
    const current = () => mountedRef.current && requests && queueRequestsRef.current === requests && musicScope.current(token) && momentTargetRef.current?.accountScope === accountScope && momentTargetRef.current?.companionScope === companionScope && (!activeSessionId || momentTargetRef.current.activeSessionId === activeSessionId);
    if (!current()) throw Object.assign(new Error("听歌会话已改变，旧队列操作已取消。"), { code: "music_queue_scope_changed" });
    const removingCurrent = operation.type === "remove" && operation.queue_item_id === queueRef.current?.currentQueueItemId;
    const shouldResume = removingCurrent && Boolean(audioRef.current && !audioRef.current.paused && !audioRef.current.ended);
    const playVersion = playbackIntentRef.current.version;
    try {
      const next = await requests.operate(operation, { ...options, sessionId: options?.sessionId ?? activeSessionId });
      if (!current()) throw Object.assign(new Error("听歌会话已改变，旧队列操作已取消。"), { code: "music_queue_scope_changed" });
      const previousError = queueErrorRef.current;
      queueErrorRef.current = "";
      setError(value => value === previousError ? "" : value);
      if (next.currentQueueItemId) setStatus(value => value === "队列已经播放完了。" ? "播放队列已更新，点击播放即可继续。" : value);
      const resume = removingCurrent && (playbackIntentRef.current.version === playVersion ? shouldResume : playbackIntentRef.current.play === true);
      if (resume && next.currentQueueItemId) {
        const source = next.items.find(entry => entry.id === next.currentQueueItemId);
        const intent = { token, sessionId: next.sessionId, queueItemId: next.currentQueueItemId, itemId: source?.itemId, playlistId: source?.playlistId, restart: false, play: true, playVersion: playbackIntentRef.current.version };
        resumeIntentRef.current = intent;
        setResumeIntent(intent);
      }
      return next;
    } catch (caught) {
      if (current() && !["music_queue_scope_changed", "music_queue_session_changed"].includes(caught?.code)) {
        const message = musicErrorMessage(caught, "播放队列同步失败，请重试刚才的操作。").replace("聊天已保存时使用同一条消息重试。", "请重试刚才的队列操作。");
        queueErrorRef.current = message;
        setError(message);
      }
      throw caught;
    }
  };

  const refreshLibrary = useCallback(async ({ initial = false } = {}) => {
    const token = musicScope.begin("library");
    if (!token) return;
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const [playlistResult, favoriteResult, connectionResult] = await Promise.allSettled([listMusicPlaylists(token.options), listMusicFavorites(token.options), listNeteaseConnections(token.options)]);
      if (!musicScope.current(token)) return;
      if (playlistResult.status === "fulfilled") {
        setPlaylists(playlistResult.value);
        setStatus(playlistResult.value.length ? "选择歌单后即可开始。" : "还没有可播放歌单，请先在设置中导入。");
      }
      if (favoriteResult.status === "fulfilled") setFavorites(favoriteResult.value);
      if (connectionResult.status === "fulfilled") {
        const availableConnections = connectionResult.value.filter((connection) => connection.enabled && connection.auth_configured);
        setConnections(availableConnections);
        setConnectionId((current) => availableConnections.some((connection) => connection.id === current) ? current : availableConnections[0]?.id || "");
      }
      const failure = playlistResult.status === "rejected" ? playlistResult.reason : favoriteResult.status === "rejected" ? favoriteResult.reason : connectionResult.status === "rejected" ? connectionResult.reason : null;
      if (failure) setError(musicErrorMessage(failure, "部分音乐资料暂时无法读取，可稍后重试。"));
    } finally {
      musicScope.finish(token);
      if (musicScope.current(token)) { setLoading(false); setRefreshing(false); }
    }
  }, [musicScope]);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.resolve().then(() => refreshLibrary({ initial: true }));
    return () => { mountedRef.current = false; operationRef.current = null; };
  }, [refreshLibrary]);

  useEffect(() => {
    if (!active || !session?.musicPlaylistId || loadedPlaylistsRef.current[session.musicPlaylistId]) return;
    let cancelled = false;
    getMusicPlaylist(session.musicPlaylistId, musicRequestOptions()).then((next) => {
      if (!cancelled && mountedRef.current) rememberPlaylist(next);
    }).catch((caught) => {
      if (!cancelled) setError(caught?.message || "本场歌曲暂时无法读取。");
    });
    return () => { cancelled = true; };
  }, [active, session?.musicPlaylistId, musicRequestOptions]);


  useEffect(() => {
    if (!active || !session.id) {
      queueRef.current = null;
      return;
    }
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled || !mountedRef.current) return;
      setLoading(true);
      setStatus("正在同步这场一起听的队列…");
      return queueRequestsRef.current.read(session.id);
    }).then(() => {
      if (cancelled || !mountedRef.current) return;
      setStatus("队列已与服务端同步。");
    }).catch((caught) => {
      if (!cancelled) setError(caught?.message || "播放队列暂时无法读取。");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [active, session?.id, loadQueuePlaylists]);

  useEffect(() => {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    let cancelled = false;
    Promise.resolve().then(() => {
      const target = momentTargetRef.current;
      if (cancelled || !mountedRef.current || target?.mediaGeneration !== mediaGeneration || !musicScope.current(target.token) || audio !== audioRef.current) return;
      if (!target.internalPlayback) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        setPlaying(false);
        setPosition(0);
        setDuration(target.durationSeconds);
        if (target.itemId) setStatus("只进入 Together 元数据队列，不进入 App audio；切歌后请点击在网易云播放");
        return;
      }
      audio.load();
      setPlaying(false);
      setPosition(0);
      setDuration(target.durationSeconds);
      lastReportRef.current = 0;
    });
    return () => { cancelled = true; };
  }, [mediaGeneration, musicScope]);

  useEffect(() => {
    if (!resumeIntent) return;
    Promise.resolve().then(() => {
      const target = momentTargetRef.current;
      const audio = audioRef.current;
      if (resumeIntentRef.current !== resumeIntent || playbackIntentRef.current.version !== resumeIntent.playVersion || !target || !musicScope.current(resumeIntent.token) || target.activeSessionId !== resumeIntent.sessionId || queueRef.current?.currentQueueItemId !== resumeIntent.queueItemId || target.itemId !== resumeIntent.itemId || target.itemPlaylistId !== resumeIntent.playlistId || !currentAudioTarget(audio, false)) return;
      resumeIntentRef.current = null;
      if (resumeIntent.restart) { audio.currentTime = 0; setPosition(0); }
      if (resumeIntent.play) {
        const owner = localPlayback("pending");
        void audio.play().catch(() => {
          localPlayback("error", owner);
          if (playbackIntentRef.current.version === resumeIntent.playVersion && currentAudioTarget(audio, false)) setStatus("下一首已准备好，请点击播放。");
        });
      }
    });
  }, [resumeIntent, mediaGeneration, musicScope, currentAudioTarget, localPlayback]);

  const report = (event, immediate = false) => {
    const audio = event?.currentTarget || audioRef.current;
    const target = currentAudioTarget(audio);
    if (!target) return false;
    const nextPosition = audio.currentTime;
    const nextDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : target.durationSeconds;
    setPosition(nextPosition);
    setDuration(nextDuration);
    if (!target.activeSessionId) return true;
    target.onPositionChange?.(nextPosition);
    if (immediate || Date.now() - lastReportRef.current >= 15_000) {
      lastReportRef.current = Date.now();
      target.onPlaybackChange?.({
        accountScope: target.accountScope, companionScope: target.companionScope,
        sessionId: target.activeSessionId,
        playbackState: audio.paused ? "paused" : "playing",
        mediaPositionSeconds: nextPosition,
        mediaDurationSeconds: nextDuration,
        musicPlaylistId: target.itemPlaylistId,
        musicPlaylistItemId: target.itemId,
        revision: target.revision,
      });
    }
    return true;
  };

  const selectPlaylist = async (id) => {
    const selection = ++playlistSelectionRef.current;
    if (!id) {
      setPlaylist(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await getMusicPlaylist(id, musicRequestOptions());
      if (!mountedRef.current || selection !== playlistSelectionRef.current) return;
      setPlaylist(next);
      rememberPlaylist(next);
      setLocalIndex(0);
      setPosition(0);
      setStatus(`${next.name} · ${next.itemCount} 首`);
    } catch (caught) {
      if (mountedRef.current && selection === playlistSelectionRef.current) setError(musicErrorMessage(caught, "歌单暂时无法读取，请刷新重试。"));
    } finally {
      if (mountedRef.current && selection === playlistSelectionRef.current) setLoading(false);
    }
  };

  const advance = async (userInitiated = true) => {
    const target = momentTargetRef.current;
    if (!active || queueBusy || advanceJobRef.current || !target || !musicScope.current(target.token) || target.mediaGeneration !== mediaGeneration) return;
    const job = { token: musicScope.capture(), sessionId: activeSessionId };
    advanceJobRef.current = job;
    setError("");
    const previousQueueItemId = queueRef.current?.currentQueueItemId;
    const shouldResume = !userInitiated || Boolean(audioRef.current && !audioRef.current.paused && !audioRef.current.ended);
    const playVersion = playbackIntentRef.current.version;
    resumeIntentRef.current = null;
    setResumeIntent(null);
    try {
      const next = await runQueueOperation({ type: "advance" }, { retryConflict: userInitiated });
      if (advanceJobRef.current !== job || !musicScope.current(job.token) || momentTargetRef.current?.activeSessionId !== job.sessionId) return;
      if (!next.currentQueueItemId) {
        setStatus("队列已经播放完了。");
      } else {
        const source = next.items.find(entry => entry.id === next.currentQueueItemId);
        const intent = { ...job, queueItemId: next.currentQueueItemId, itemId: source?.itemId, playlistId: source?.playlistId, restart: next.currentQueueItemId === previousQueueItemId, play: playbackIntentRef.current.version === playVersion ? shouldResume : playbackIntentRef.current.play === true, playVersion: playbackIntentRef.current.version };
        resumeIntentRef.current = intent;
        setResumeIntent(intent);
      }
    } catch {
      // Failed queue requests leave the current audio and its actual playing state intact.
    } finally { if (advanceJobRef.current === job) advanceJobRef.current = null; }
  };
  const advanceFromMediaSession = useEffectEvent(() => void advance(true));

  const seedQueue = async (intent) => {
    await runQueueOperation(intent.operation, { retryConflict: true, sessionId: intent.sessionId });
    if (!mountedRef.current) return;
    setRetryQueue(null);
    setStatus("一起听歌已开始，队列已保存。请点击播放开始聆听。");
  };
  const start = async () => {
    if (!item || !playlist || operationRef.current || busy) return;
    const validation = internalPlayback ? playback.validation || { ok: true } : { ok: true };
    if (!validation.ok) { setError(validation.message); return; }
    const token = {}; operationRef.current = token; setLoading(true); setError("");
    try {
      const started = await onStart?.({ accountScope, companionScope, title: item.title, sessionMode: "listening", musicPlaylistId: playlist.id, musicPlaylistItemId: item.id, mediaDurationSeconds: item.durationSeconds, mediaPositionSeconds: 0 });
      if (!mountedRef.current || operationRef.current !== token) return;
      if (!started || started.ok === false || !started.id) { setError(`${started?.message || "服务器未确认一起听歌开始。"}（${started?.code || "music_start_failed"}）`); return; }
      const intent = { sessionId: started.id, operation: { type: "replace", item_ids: [...playlist.items.slice(localIndex), ...playlist.items.slice(0, localIndex)].map(entry => entry.id) } };
      queueRequestsRef.current.bind(started.id); setRetryQueue(intent);
      await seedQueue(intent);
    } catch (caught) {
      if (mountedRef.current) setError(`${caught?.message || "暂时无法开始一起听歌。"}（${caught?.code || "music_start_failed"}）`);
    } finally { if (operationRef.current === token) { operationRef.current = null; if (mountedRef.current) setLoading(false); } }
  };
  const retrySeedQueue = async () => {
    if (!retryQueue || retryQueue.sessionId !== session?.id || operationRef.current || busy) return;
    const token = {}; operationRef.current = token; setLoading(true); setError("");
    try { await seedQueue(retryQueue); }
    catch (caught) { if (mountedRef.current) setError(`${caught?.message || "载入队列失败，请重试。"}（${caught?.code || "music_queue_operation_failed"}）`); }
    finally { if (operationRef.current === token) { operationRef.current = null; if (mountedRef.current) setLoading(false); } }
  };
  const end = async () => {
    if (operationRef.current || busy) return;
    const token = {}; operationRef.current = token; setLoading(true); setError("");
    try {
      const result = await onEnd?.({ accountScope, companionScope, sessionId: session?.id, title: item?.title, mediaPositionSeconds: position, musicPlaylistId: itemPlaylistId, musicPlaylistItemId: itemId });
      if (!mountedRef.current || operationRef.current !== token) return;
      if (!result || result.ok === false) { setError(`${result?.message || "服务器未确认结束，本机播放和队列仍保留。"}（${result?.code || "music_stop_failed"}）`); return; }
      audioRef.current?.pause(); setPlaying(false); setRetryQueue(null); queueRequestsRef.current.bind(""); setQueue(null);
    } catch (caught) { if (mountedRef.current) setError(`${caught?.message || "暂时无法结束一起听歌。"}（${caught?.code || "music_stop_failed"}）`); }
    finally { if (operationRef.current === token) { operationRef.current = null; if (mountedRef.current) setLoading(false); } }
  };

  const launchExternalTrack = async (resourceType, resourceId, cookie = false) => {
    if (cookie && !canUseCookie()) return;
    await runMusicTask(musicScope, cookie ? "cookie-external-playback" : "external-playback", (token) => launchExternalMusic({ scope: musicScope, token, resourceType, resourceId, open: openNeteasePlayback, request: requestExternalMusicPlayback }), {
      onStart: () => { setError(""); if (cookie) setCookieOpStatus("正在交给网易云打开…"); },
      onSuccess: (result) => { if (cookie) setCookieOpStatus(externalMusicFeedback(result)); else setStatus(externalMusicFeedback(result)); },
      onError: (caught) => { const message = musicErrorMessage(caught, "无法打开网易云，请检查设备和连接后重试。"); if (cookie) setCookieOpStatus(message); else setError(message); },
    });
  };
  const openExternal = async () => {
    if (playback.mode === MUSIC_PLAYBACK_MODES.external) await launchExternalTrack(playback.resourceType, playback.resourceId);
  };

  const connectProvider = async (event) => {
    event.preventDefault();
    await runMusicTask(musicScope, "provider", async (token) => {
      return connectNeteaseMcp({ name: connectionName, endpoint: connectionEndpoint, token: connectionToken }, token.options);
    }, {
      onStart: () => { setProviderBusy(true); setError(""); setProviderStatus("正在协商协议并自动识别接口能力…"); },
      onSuccess: async (connection, token) => {
        setConnections(current => [connection, ...current.filter(entry => entry.id !== connection.id)]); setConnectionId(connection.id); setConnectionToken("");
        setProviderStatus(`连接“${connection.name}”已保存，凭据已从页面清空。`);
        try {
          const next = (await listNeteaseConnections(token.options)).filter(entry => entry.enabled && entry.auth_configured);
          if (musicScope.current(token)) setConnections(next);
        } catch (caught) { if (musicScope.current(token)) setProviderStatus(`连接已保存，列表刷新失败，无需重复创建。${musicErrorMessage(caught, "请刷新曲库。")} `); }
      },
      onError: (caught) => { setError(musicErrorMessage(caught, "网易云 MCP 连接失败，请检查地址或登录状态后重试。")); setProviderStatus(""); },
      onFinish: () => setProviderBusy(false),
    });
  };

  const connectNeteaseCookie = async (options = {}) => {
    if (!cookieIdentityCurrent() || cookieIdentityRef.current.changing || cookieIdentityRef.current.connected) return;
    if (!browserLauncherAvailable()) { setError("内置浏览器登录仅 Android App 可用。"); return; }
    await runMusicTask(musicScope, "cookie-login", async (token) => {
      const outcome = await openBuiltInBrowser({ url: "https://music.163.com/", title: "网易云登录（内置浏览器）", site: "netease", desktop: options?.desktop === true });
      musicScope.assertCurrent(token);
      const saved = await readBrowserCookie("netease");
      musicScope.assertCurrent(token);
      if (!saved.cookie) throw Object.assign(new Error(outcome.ok ? "没有提取到登录态。请登录后点“提取登录态”，再返回重试。" : "浏览器未返回登录态，请重新打开网易云登录。"), { code: "netease_cookie_missing" });
      return saveNeteaseCookieSession(saved.cookie, token.options);
    }, {
      onStart: beginCookieIdentityChange,
      onSuccess: (saved) => { cookieIdentityRef.current.connected = true; clearCookieResults(request?.query ? "search" : "closed"); setCookieStatus({ checking: false, connected: true, account_name: saved.session.account_name || "" }); setStatus("网易云登录状态已保存，可以搜索或导入歌曲。"); void refreshLibrary(); },
      onError: (caught) => setError(musicErrorMessage(caught, "连接网易云失败，请重新登录后重试。")),
      onFinish: finishCookieIdentityChange,
    });
  };

  const disconnectNeteaseCookie = async () => {
    if (!canUseCookie()) return;
    await runMusicTask(musicScope, "cookie-login", (token) => clearNeteaseCookieSession(token.options), {
      onStart: beginCookieIdentityChange,
      onSuccess: () => { cookieIdentityRef.current.connected = false; clearCookieResults(); setCookieStatus({ checking: false, connected: false, account_name: "" }); setStatus("网易云登录已断开。"); },
      onError: (caught) => setError(musicErrorMessage(caught, "断开登录失败，当前登录状态仍保留。请重试。")),
      onFinish: finishCookieIdentityChange,
    });
  };

  // ---------- 网易云音乐操作面板（Cookie 登录后可用） ----------
  const [cookiePanel, setCookiePanel] = useState(() => request?.query ? "search" : "closed"); // closed | search | playlists | daily | history
  const [cookieSearchQuery, setCookieSearchQuery] = useState(() => request?.query || "");
  const [cookieSearchResults, setCookieSearchResults] = useState([]);
  const [cookieSearchBusy, setCookieSearchBusy] = useState(false);
  const automaticSearchRef = useRef("");
  const [cookieMyPlaylists, setCookieMyPlaylists] = useState(null);
  const [cookiePlaylistDetail, setCookiePlaylistDetail] = useState(null);
  const [cookieDaily, setCookieDaily] = useState([]);
  const [cookieHistory, setCookieHistory] = useState([]);
  const [cookieOpBusy, setCookieOpBusy] = useState(false);
  const [cookieOpStatus, setCookieOpStatus] = useState("");
  const [cookieReads, setCookieReads] = useState({});
  const cookieBrowseRef = useRef(null);
  const cookieSearchTaskRef = useRef("");

  function beginCookieIdentityChange() {
    cookieIdentityRef.current.changing = true;
    cookieIdentityRef.current.generation++;
    setCookieGeneration(cookieIdentityRef.current.generation);
    for (const key of ["cookie-check", "cookie-search", "cookie-browse", "cookie-write", "cookie-external-playback"]) musicScope.cancelKey(key);
    setCookieSearchBusy(false); setCookieOpBusy(false);
    setCookieReads(current => Object.fromEntries(Object.entries(current).map(([kind, read]) => [kind, read.phase === "loading" ? { ...read, phase: "cancelled" } : read])));
    setCookieStatus(current => ({ ...current, checking: false })); setCookieBusy(true); setError("");
  }
  function finishCookieIdentityChange() {
    cookieIdentityRef.current.changing = false;
    setCookieBusy(false);
  }
  const clearCookieResults = useCallback((panel = "closed") => {
    automaticSearchRef.current = "";
    setCookiePanel(panel); setCookieSearchResults([]); setCookieMyPlaylists(null); setCookiePlaylistDetail(null);
    setCookieDaily([]); setCookieHistory([]); setCookieOpStatus("");
    setCookieReads({}); cookieBrowseRef.current = null; cookieSearchTaskRef.current = "";
  }, []);

  const runCookieSearch = async (event) => {
    event?.preventDefault();
    if (!canUseCookie() || cookieSearchBusy || !cookieSearchQuery.trim()) return;
    await performCookieSearch(cookieSearchQuery);
  };
  const performCookieSearch = async (query) => {
    if (!canUseCookie() || (musicScope.busy("cookie-search") && cookieSearchTaskRef.current === query)) return;
    await runMusicTask(musicScope, "cookie-search", (token) => cookieSearchNetease(query, 12, token.options), {
      replace: true,
      onStart: () => { cookieSearchTaskRef.current = query; setCookieSearchBusy(true); setCookieReads(current => ({ ...current, search: { phase: "loading", query } })); },
      onSuccess: (items) => { setCookieSearchResults(items); setCookieReads(current => ({ ...current, search: { phase: "ready", query } })); },
      onError: (caught) => setCookieReads(current => ({ ...current, search: { phase: "error", query, message: musicErrorMessage(caught, COOKIE_READ_FEEDBACK.search[1]) } })),
      onFinish: () => setCookieSearchBusy(false),
    });
  };

  const searchFromActivity = useEffectEvent((query, id) => {
    if (!canUseCookie()) return;
    automaticSearchRef.current = id;
    void performCookieSearch(query);
  });
  useEffect(() => {
    if (!cookieStatus.connected || cookieBusy || !request?.id || !request.query || automaticSearchRef.current === request.id) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      searchFromActivity(request.query, request.id);
    });
    return () => { active = false; };
  }, [cookieStatus.connected, cookieBusy, cookieGeneration, request?.id, request?.query]);

  const runCookieBrowse = async (kind, resourceId, read, apply) => {
    if (!canUseCookie()) return;
    const previous = cookieBrowseRef.current;
    if (musicScope.busy("cookie-browse") && previous?.kind === kind && previous.resourceId === resourceId) return;
    await runMusicTask(musicScope, "cookie-browse", token => {
      cookieBrowseRef.current = { kind, resourceId, token };
      return read(token.options);
    }, {
      replace: true,
      onStart: () => {
        setCookieOpBusy(true);
        setCookieReads(current => ({ ...current,
          ...(previous && previous.kind !== kind && current[previous.kind]?.phase === "loading" ? { [previous.kind]: { ...current[previous.kind], phase: "cancelled" } } : {}),
          [kind]: { phase: "loading", resourceId },
        }));
        if (kind === "detail") setCookiePlaylistDetail(null);
      },
      onSuccess: data => { apply(data); setCookieReads(current => ({ ...current, [kind]: { phase: "ready", resourceId } })); },
      onError: caught => setCookieReads(current => ({ ...current, [kind]: { phase: "error", resourceId, message: musicErrorMessage(caught, COOKIE_READ_FEEDBACK[kind][1]) } })),
      onFinish: () => setCookieOpBusy(musicScope.busy("cookie-browse") || musicScope.busy("cookie-write")),
    });
  };
  const closeCookiePlaylist = resourceId => {
    if (!canUseCookie() || cookieBrowseRef.current?.kind !== "detail" || cookieBrowseRef.current.resourceId !== resourceId) return;
    musicScope.cancel(cookieBrowseRef.current.token); cookieBrowseRef.current = null;
    setCookiePlaylistDetail(null); setCookieReads(current => ({ ...current, detail: { phase: "idle" } }));
    setCookieOpBusy(musicScope.busy("cookie-browse") || musicScope.busy("cookie-write"));
  };

  const openCookiePlaylists = async () => {
    if (!canUseCookie()) return;
    setCookiePanel("playlists");
    await runCookieBrowse("playlists", "", cookieGetMyPlaylists, data => { setCookieMyPlaylists(data); setCookiePlaylistDetail(null); setCookieReads(current => ({ ...current, detail: { phase: "idle" } })); });
  };
  const openCookiePlaylist = async (playlistId) => {
    if (!canUseCookie() || !playlistId) return;
    await runCookieBrowse("detail", playlistId, options => cookieGetPlaylistTracks(playlistId, options), data => setCookiePlaylistDetail({ id: playlistId, ...(data?.playlist || {}) }));
  };
  const openCookieDaily = async () => {
    if (!canUseCookie()) return;
    setCookiePanel("daily");
    await runCookieBrowse("daily", "", cookieGetDailyRecommend, data => setCookieDaily(Array.isArray(data?.daily) ? data.daily : []));
  };
  const openCookieHistory = async () => {
    if (!canUseCookie()) return;
    setCookiePanel("history");
    await runCookieBrowse("history", "", options => cookieGetPlayHistory(20, options), data => setCookieHistory(Array.isArray(data?.records) ? data.records : []));
  };
  const cookieLikeTrack = async (songId, liked) => {
    if (!canUseCookie()) return;
    await runMusicTask(musicScope, "cookie-write", (token) => cookieLikeSong(songId, liked, token.options), {
      onStart: () => { setCookieOpBusy(true); setCookieOpStatus(""); },
      onSuccess: (result) => setCookieOpStatus(result?.liked ? "已红心。♥" : "已取消红心。"),
      onError: (caught) => setCookieOpStatus(musicErrorMessage(caught, "红心操作失败，请重试。")), onFinish: () => setCookieOpBusy(musicScope.busy("cookie-browse") || musicScope.busy("cookie-write")),
    });
  };
  const cookieImportPlaylist = async (playlistId) => {
    if (!canUseCookie() || !playlistId) return;
    await runMusicTask(musicScope, "cookie-write", (token) => importNeteaseShare("", `https://music.163.com/#/playlist?id=${playlistId}`, token.options), {
      onStart: () => { setCookieOpBusy(true); setCookieOpStatus(""); },
      onSuccess: async (imported, token) => {
        try { await acceptImportedPlaylist(imported, token); }
        catch (caught) { if (musicScope.current(token)) setCookieOpStatus(`歌单已保存，播放器读取失败，无需重复导入。${musicErrorMessage(caught, "请刷新播放器。")}`); return; }
        if (musicScope.current(token)) setCookieOpStatus(`已导入“${imported.name}”${imported.itemCount} 首，可以开始听了。`);
      },
      onError: (caught) => setCookieOpStatus(musicErrorMessage(caught, "导入失败，请检查登录状态后重试。")), onFinish: () => setCookieOpBusy(musicScope.busy("cookie-browse") || musicScope.busy("cookie-write")),
    });
  };



  useEffect(() => {
    const token = musicScope.begin("cookie-check");
    if (!token) return;
    readNeteaseCookieSession(token.options).then((data) => {
      if (!musicScope.current(token)) return;
      const session = data?.session || {};
      if (cookieIdentityRef.current.resetResults) clearCookieResults();
      cookieIdentityRef.current.resetResults = false;
      cookieIdentityRef.current.connected = session.connected === true;
      setCookieGeneration(cookieIdentityRef.current.generation);
      setCookieBusy(false); setCookieSearchBusy(false); setCookieOpBusy(false);
      setCookieStatus({ checking: false, connected: session.connected === true, account_name: session.account_name || "" });
    }).catch((caught) => {
      if (musicScope.current(token)) { cookieIdentityRef.current.connected = false; setCookieGeneration(cookieIdentityRef.current.generation); clearCookieResults(); setCookieBusy(false); setCookieSearchBusy(false); setCookieOpBusy(false); setCookieStatus({ checking: false, connected: false, account_name: "" }); setError(musicErrorMessage(caught, "网易云登录状态暂时无法检查，请刷新或重试连接。")); }
    }).finally(() => musicScope.finish(token));
    return () => musicScope.cancel(token);
  }, [musicScope, accountScope, companionScope, clearCookieResults]);

  const importShare = async (event) => {
    event.preventDefault();
    await runMusicTask(musicScope, "provider", (token) => importNeteaseShare(connectionId || "", shareUrl, token.options), {
      onStart: () => { setProviderBusy(true); setError(""); setProviderStatus("正在导入网易云歌单…"); },
      onSuccess: async (imported, token) => {
        setShareUrl("");
        try { await acceptImportedPlaylist(imported); }
        catch (caught) { if (musicScope.current(token)) setProviderStatus(`歌单已保存，播放器读取失败，无需重复导入。${musicErrorMessage(caught, "请刷新播放器。")}`); return; }
        if (musicScope.current(token)) setProviderStatus(`已导入“${imported.name}”，曲目现在可以直接查看。`);
      },
      onError: (caught) => { setError(musicErrorMessage(caught, "网易云歌单导入失败，请检查连接后重试。")); setProviderStatus(""); },
      onFinish: () => setProviderBusy(false),
    });
  };

  const acceptImportedPlaylist = async (imported, sourceToken = null) => {
    const request = ++playlistSelectionRef.current;
    const token = sourceToken || musicScope.capture();
    try {
      const selected = await getMusicPlaylist(imported.id, token.options);
      musicScope.assertCurrent(token);
      if (!mountedRef.current || request !== playlistSelectionRef.current) return;
      rememberPlaylist(selected);
      setPlaylist(selected); setLocalIndex(0); setPosition(0);
      setPlaylists(current => [selected, ...current.filter(entry => entry.id !== selected.id)]);
      setStatus(`已准备“${selected.name}”，选择曲目后开始一起听。`);
      updateImportBusy(false);
      setImportOpen(false);
    } finally {
      if (mountedRef.current && musicScope.current(token) && request === playlistSelectionRef.current) setLoading(false);
    }
  };

  const updateExternalPosition = (nextPosition) => {
    setPosition(nextPosition);
    onPositionChange?.(nextPosition);
    if (!active || !item) return;
    onPlaybackChange?.({
      accountScope, companionScope,
      sessionId: session.id,
      playbackState: "paused",
      mediaPositionSeconds: nextPosition,
      mediaDurationSeconds: duration || item.durationSeconds || 0,
      musicPlaylistId: itemPlaylistId,
      musicPlaylistItemId: itemId,
      revision: session.revision,
    });
  };

  const toggleFavorite = async () => {
    if (!itemId) return;
    await runMusicTask(musicScope, "favorite", (token) => favorite ? deleteMusicFavorite(itemId, token.options) : putMusicFavorite(itemId, token.options), {
      onStart: () => { setFavoriteBusy(true); setError(""); },
      onSuccess: (next) => {
        setFavorites((current) => favorite ? current.filter((entry) => entry.itemId !== itemId) : [next, ...current.filter((entry) => entry.itemId !== itemId)]);
        setStatus(favorite ? "已取消收藏当前曲目。" : "已收藏当前曲目。");
      },
      onError: (caught) => setError(musicErrorMessage(caught, "收藏更新失败，状态仍保留，请重试。")),
      onFinish: () => setFavoriteBusy(false),
    });
  };



  useEffect(() => {
    if (!item || !internalPlayback || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const platform = navigator.mediaSession;
    if (!platform) return;
    const owner = { platform, mediaGeneration };
    mediaSessionOwnerRef.current = owner;
    if (typeof globalThis.MediaMetadata === "function") {
      platform.metadata = new globalThis.MediaMetadata({
        title: item.title,
        artist: item.artist || "",
        album: item.album || itemPlaylist?.name || "一起听歌",
      });
    }
    const current = () => mediaSessionOwnerRef.current === owner && mountedRef.current && momentTargetRef.current?.mediaGeneration === mediaGeneration && musicScope.current(momentTargetRef.current.token);
    const handlers = {
      previoustrack: () => {
        if (current() && !active) setLocalIndex((index) => Math.max(0, index - 1));
      },
      nexttrack: () => {
        if (!current()) return;
        if (active) advanceFromMediaSession();
        else setLocalIndex((index) => Math.min((playlist?.items.length || 1) - 1, index + 1));
      },
      play: () => { if (current()) playCurrentAudio(); },
      pause: () => { if (current()) pauseCurrentAudio(); },
      seekto: (details) => {
        const audio = audioRef.current;
        if (current() && currentAudioTarget(audio) && Number.isFinite(audio.duration) && audio.duration > 0 && Number.isFinite(details?.seekTime) && details.seekTime >= 0) audio.currentTime = Math.min(details.seekTime, audio.duration);
      },
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { platform.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
    }
    return () => {
      if (mediaSessionOwnerRef.current !== owner) return;
      mediaSessionOwnerRef.current = null;
      for (const action of Object.keys(handlers)) {
        try { platform.setActionHandler(action, null); } catch { /* Unsupported action. */ }
      }
      platform.metadata = null;
      platform.playbackState = "none";
      try { platform.setPositionState?.(); } catch { /* Optional platform position state. */ }
    };
  }, [active, internalPlayback, item, itemPlaylist, playlist, playCurrentAudio, pauseCurrentAudio, currentAudioTarget, mediaGeneration, musicScope]);

  useEffect(() => {
    const owner = mediaSessionOwnerRef.current;
    if (!owner || owner.mediaGeneration !== mediaGeneration) return;
    const audio = audioRef.current;
    owner.platform.playbackState = currentAudioTarget(audio, false) ? audio.paused ? "paused" : "playing" : "none";
    try {
      if (currentAudioTarget(audio) && Number.isFinite(audio.duration) && audio.duration > 0) {
        owner.platform.setPositionState?.({ duration: audio.duration, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime, audio.duration) });
      } else owner.platform.setPositionState?.();
    } catch { /* Media position can race metadata changes. */ }
  }, [duration, playing, position, mediaGeneration, currentAudioTarget]);

  const currentQueueIndex = queue?.items.findIndex((entry) => entry.id === queue.currentQueueItemId) ?? -1;
  const localCanGoBack = !active && localIndex > 0;
  const controlsBusy = busy || loading || queueBusy;

  return <div className="together-setup together-music-setup" aria-busy={loading || queueBusy}>
    {!active && <section className="music-import-entry"><div><strong>把想听的歌带进来</strong><p>粘贴分享链接、选择歌单文件或导入本机音频，保存后直接选中。</p></div><button type="button" className="together-primary" aria-haspopup="dialog" aria-expanded={importOpen} onClick={() => { if (importBusyRef.current || importOpen) return; updateImportBusy(false); setImportOpen(true); }}><ListPlus aria-hidden="true" />导入歌曲</button></section>}
    {!active && importOpen && <MusicImportDialog busy={importBusy} onClose={() => { if (importBusyRef.current) return; updateImportBusy(false); setImportOpen(false); }}><MusicSettings accountScope={accountScope} companionScope={companionScope} compact onBusyChange={updateImportBusy} onImported={acceptImportedPlaylist} onOpenMcpDeviceCenter={openMcpFromImport} /></MusicImportDialog>}
    {!active && (
      <label className="music-random-play-toggle">
        <input
          type="checkbox"
          checked={randomPlayEnabled}
          onChange={(event) => toggleRandomPlay(event.target.checked)}
        />
        <span>
          <strong>打开软件后随机播放一首歌</strong>
          <small>在 DengTa 里已有的歌里随机挑一首内置播放（不跳转网易云）；没有可播的歌时会尝试抓取一首下载进来。勾选后每次打开 App 都会自动播放。</small>
        </span>
      </label>
    )}
      {!active && (
        <section className="music-provider-connect music-provider-cookie">
          <div className="music-provider-connect-heading">
            <div>
              <strong>内置浏览器登录网易云</strong>
              <span>
                {cookieStatus.checking
                  ? "正在检查登录状态…"
                  : cookieStatus.connected
                  ? `已连接：${cookieStatus.account_name || "网易云账号"}`
                  : "用内置浏览器打开网易云网页，登录后点「提取登录态」再返回。手机版不方便操作时可用桌面版，双指放大二维码。"}
              </span>
            </div>
            <div className="music-cookie-connect-actions">
              {cookieStatus.connected ? (
                <button type="button" disabled={cookieBusy} onClick={() => void disconnectNeteaseCookie()}>
                  断开
                </button>
              ) : (
                <>
                  <button type="button" className="music-cookie-connect-primary" disabled={cookieBusy} onClick={() => void connectNeteaseCookie()}>
                    {cookieBusy ? "处理中…" : "内置浏览器登录"}
                  </button>
                  <button type="button" disabled={cookieBusy} onClick={() => void connectNeteaseCookie({ desktop: true })}>
                    桌面版网页登录
                  </button>
                </>
              )}
            </div>
          </div>
          {!cookieStatus.connected && (
            <p className="music-cookie-desktop-hint">
              提取后会保存登录状态。网易云可能让登录过期；提示失效时重新登录即可。桌面版支持扫码，二维码可双指放大。
            </p>
          )}
          </section>
      )}
      {!active && cookieStatus.connected && (
        <section className="music-cookie-operations">
          <div className="music-cookie-operations-bar">
            <strong>网易云音乐操作</strong>
            <span className="music-cookie-operations-tabs">
              <button type="button" disabled={cookieBusy} className={cookiePanel === "search" ? "is-active" : ""} onClick={() => { if (canUseCookie()) setCookiePanel("search"); }}>搜歌</button>
              <button type="button" disabled={cookieBusy} className={cookiePanel === "playlists" ? "is-active" : ""} onClick={() => void openCookiePlaylists()}>我的歌单</button>
              <button type="button" disabled={cookieBusy} className={cookiePanel === "daily" ? "is-active" : ""} onClick={() => void openCookieDaily()}>每日推荐</button>
              <button type="button" disabled={cookieBusy} className={cookiePanel === "history" ? "is-active" : ""} onClick={() => void openCookieHistory()}>听歌记录</button>
            </span>
          </div>
          {cookiePanel === "search" && (
            <div className="music-cookie-operations-body">
              <form className="music-cookie-search" onSubmit={runCookieSearch}>
                <input type="search" maxLength={120} value={cookieSearchQuery} onChange={(event) => setCookieSearchQuery(event.target.value)} placeholder="说个关键词找歌…" />
                <button type="submit" disabled={cookieBusy || cookieSearchBusy || !cookieSearchQuery.trim()}>{cookieSearchBusy ? "搜索中…" : "搜歌"}</button>
              </form>
              <CookieReadFeedback kind="search" read={cookieReads.search} busy={cookieBusy} onRetry={() => void performCookieSearch(cookieReads.search?.query)} readyMessage={cookieSearchResults.length ? `找到 ${cookieSearchResults.length} 首。` : "没有找到相关歌曲。"} />
              {cookieSearchResults.length > 0 && (
                <ul className="music-cookie-track-list">
                  {cookieSearchResults.map((track) => (
                    <li key={track.providerTrackId}>
                      <span className="music-cookie-track-title">{track.title}<em>{track.artist}</em></span>
                      <span className="music-cookie-track-actions">
                        <button type="button" disabled={cookieBusy || cookieOpBusy} onClick={() => void cookieLikeTrack(track.providerTrackId, true)} title="红心">♥</button>
                        <button type="button" disabled={cookieBusy || cookieOpBusy} onClick={() => void launchExternalTrack("song", track.providerTrackId, true)}><Play aria-hidden="true" size={13} /><span style={{marginLeft:3}}>播放</span></button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {cookiePanel === "playlists" && (
            <div className="music-cookie-operations-body">
              <CookieReadFeedback kind="playlists" read={cookieReads.playlists} busy={cookieBusy} onRetry={() => void openCookiePlaylists()} />
              {cookieMyPlaylists && (
                <div>
                  {(cookieMyPlaylists.owned?.length > 0 || cookieMyPlaylists.subscribed?.length > 0) ? (
                    <>
                      {cookieMyPlaylists.owned?.length > 0 && (
                        <div className="music-cookie-playlist-group">
                          <p className="music-cookie-playlist-group-title">自建歌单</p>
                          <ul className="music-cookie-playlist-list">
                            {cookieMyPlaylists.owned.map((item) => (
                              <li key={item.playlist_id}>
                                <button type="button" disabled={cookieBusy} className="music-cookie-playlist-name" onClick={() => void openCookiePlaylist(item.playlist_id)}>{item.name}</button>
                                <span>{item.item_count} 首</span>
                                <button type="button" disabled={cookieBusy || cookieOpBusy} onClick={() => void cookieImportPlaylist(item.playlist_id)}>导入</button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {cookieMyPlaylists.subscribed?.length > 0 && (
                        <div className="music-cookie-playlist-group">
                          <p className="music-cookie-playlist-group-title">收藏歌单</p>
                          <ul className="music-cookie-playlist-list">
                            {cookieMyPlaylists.subscribed.map((item) => (
                              <li key={item.playlist_id}>
                                <button type="button" disabled={cookieBusy} className="music-cookie-playlist-name" onClick={() => void openCookiePlaylist(item.playlist_id)}>{item.name}</button>
                                <span>{item.item_count} 首</span>
                                <button type="button" disabled={cookieBusy || cookieOpBusy} onClick={() => void cookieImportPlaylist(item.playlist_id)}>导入</button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : cookieReads.playlists?.phase === "ready" ? (
                    <p>账号下还没有歌单。</p>
                  ) : null}
                  {(cookiePlaylistDetail || (cookieReads.detail && cookieReads.detail.phase !== "idle")) && (
                    <div className="music-cookie-playlist-detail">
                      <button type="button" disabled={cookieBusy} className="music-cookie-back" onClick={() => closeCookiePlaylist(cookieReads.detail?.resourceId)}>← 返回歌单列表</button>
                      <CookieReadFeedback kind="detail" read={cookieReads.detail} busy={cookieBusy} onRetry={() => void openCookiePlaylist(cookieReads.detail?.resourceId)} />
                      {cookiePlaylistDetail && <p className="music-cookie-playlist-detail-title">{cookiePlaylistDetail.name}（{cookiePlaylistDetail.tracks?.length || 0} 首）</p>}
                      {cookieReads.detail?.phase === "ready" && !cookiePlaylistDetail?.tracks?.length && <p role="status">这个歌单暂无歌曲。</p>}
                      <ul className="music-cookie-track-list">
                        {(cookiePlaylistDetail?.tracks || []).slice(0, 60).map((track, index) => (
                          <li key={track.id || index}>
                            <span className="music-cookie-track-title">{index + 1}. {track.title}<em>{track.artist}</em></span>
                            <span className="music-cookie-track-actions">
                              <button type="button" disabled={cookieBusy || cookieOpBusy} onClick={() => void cookieLikeTrack(track.id, true)} title="红心">♥</button>
                              <button type="button" disabled={cookieBusy || cookieOpBusy} onClick={() => void launchExternalTrack("song", track.id, true)}><Play aria-hidden="true" size={13} /><span style={{marginLeft:3}}>播放</span></button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {cookiePanel === "daily" && (
            <div className="music-cookie-operations-body">
              <CookieReadFeedback kind="daily" read={cookieReads.daily} busy={cookieBusy} onRetry={() => void openCookieDaily()} />
              {cookieDaily.length > 0 ? (
                <ul className="music-cookie-track-list">
                  {cookieDaily.map((track) => (
                    <li key={track.id}>
                      <span className="music-cookie-track-title">{track.title}<em>{track.artist}{track.reason ? ` · ${track.reason}` : ""}</em></span>
                      <span className="music-cookie-track-actions">
                        <button type="button" disabled={cookieBusy || cookieOpBusy} onClick={() => void cookieLikeTrack(track.id, true)} title="红心">♥</button>
                        <button type="button" disabled={cookieBusy || cookieOpBusy} onClick={() => void launchExternalTrack("song", track.id, true)}><Play aria-hidden="true" size={13} /><span style={{marginLeft:3}}>播放</span></button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : cookieReads.daily?.phase === "ready" ? (
                <p role="status">今天暂时没有推荐歌曲。</p>
              ) : null}
            </div>
          )}
          {cookiePanel === "history" && (
            <div className="music-cookie-operations-body">
              <CookieReadFeedback kind="history" read={cookieReads.history} busy={cookieBusy} onRetry={() => void openCookieHistory()} />
              {cookieHistory.length > 0 ? (
                <ul className="music-cookie-track-list">
                  {cookieHistory.map((track) => (
                    <li key={track.id}>
                      <span className="music-cookie-track-title">{track.title}<em>{track.artist}</em></span>
                      <span className="music-cookie-track-actions">{track.play_count > 0 && <small title={`播放 ${track.play_count} 次`}>播放 {track.play_count} 次</small>}
                        <button type="button" disabled={cookieBusy || cookieOpBusy} onClick={() => void cookieLikeTrack(track.id, true)} title="红心">♥</button>
                        <button type="button" disabled={cookieBusy || cookieOpBusy} onClick={() => void launchExternalTrack("song", track.id, true)}><Play aria-hidden="true" size={13} /><span style={{marginLeft:3}}>播放</span></button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : cookieReads.history?.phase === "ready" ? (
                <p role="status">还没有听歌记录。</p>
              ) : null}
            </div>
          )}
          {cookieOpStatus && <p className="music-provider-feedback" role="status">{cookieOpStatus}</p>}
        </section>
      )}

    {!active && <details className="music-provider-connect">
      <summary>高级用户：连接自己的网易云接口</summary>
      <div className="music-provider-connect-body">
        <p>填写完整的公开 HTTPS MCP 地址即可；DengTa 会协商协议版本、读取工具并自动识别网易云能力，不依赖固定路径。你可以在自己的服务端配置网易云 Cookie，再用独立 Token 保护接口；Token 不是网易云 Cookie，Cookie、MUSIC_U、__csrf 或 NETEASE_COOKIE 不会上传到 DengTa。</p>
        <form onSubmit={connectProvider}>
          <label>显示名称<input value={connectionName} maxLength={80} autoComplete="off" onChange={(event) => setConnectionName(event.target.value)} placeholder="我的网易云 MCP" /></label>
          <label>完整 HTTPS MCP 地址<input type="url" inputMode="url" maxLength={1000} autoCapitalize="off" autoCorrect="off" spellCheck="false" autoComplete="off" value={connectionEndpoint} onChange={(event) => setConnectionEndpoint(event.target.value)} placeholder="https://music.example.com/mcp" /></label>
          <label>接口 Token（可选）<input type="password" maxLength={4096} autoComplete="new-password" value={connectionToken} onChange={(event) => setConnectionToken(event.target.value)} placeholder="无鉴权接口可留空；不要填写网易云 Cookie" /></label>
          <button type="submit" className="together-primary" disabled={providerBusy || !connectionName.trim() || !connectionEndpoint.trim()}>{providerBusy ? "正在识别…" : "自动识别、保存并启用"}</button>
        </form>
        <form className="music-provider-import" onSubmit={importShare}>
          <label>网易云 MCP 连接<select value={connectionId} disabled={providerBusy || !connections.length} onChange={(event) => setConnectionId(event.target.value)}><option value="">选择已启用连接</option>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label>
          <label>网易云分享歌单 URL<input type="url" inputMode="url" maxLength={4096} autoCapitalize="off" autoCorrect="off" spellCheck="false" value={shareUrl} onChange={(event) => setShareUrl(event.target.value)} placeholder="https://music.163.com/playlist?id=…" /></label>
          <button type="submit" disabled={providerBusy || !connectionId || !shareUrl.trim()}>导入并查看曲目</button>
        </form>
        {providerStatus && <p className="music-provider-feedback" role="status">{providerStatus}</p>}
      </div>
    </details>}
    <div className="music-player-title">
      {item?.coverUrl ? <img className="music-cover" src={item.coverUrl} alt="" referrerPolicy="no-referrer" /> : <Music2 aria-hidden="true" />}
      <div><strong>{item?.title || (loading ? "正在读取音乐档案…" : "选择一首歌")}</strong><span>{item?.artist || "一起听歌"}</span></div>
      <button type="button" className={favorite ? "is-favorite" : ""} aria-label={favorite ? "取消收藏当前曲目" : "收藏当前曲目"} aria-pressed={favorite} disabled={!item || favoriteBusy} onClick={() => void toggleFavorite()}><Heart aria-hidden="true" /></button>
      <button type="button" aria-label="刷新音乐资料" disabled={refreshing} onClick={() => void refreshLibrary()}><RefreshCw aria-hidden="true" />{refreshing ? "刷新中" : "刷新"}</button>
    </div>
    <label>{active ? "加入曲目的来源歌单" : "歌单"}<select value={playlist?.id || ""} disabled={busy} onChange={(event) => void selectPlaylist(event.target.value)}><option value="">选择已导入歌单</option>{playlists.map((entry) => <option key={entry.id} value={entry.id} disabled={entry.saveState === "incomplete"}>{entry.name} · {musicPlaylistStatus(entry)}</option>)}</select></label>
    {playlists.some(entry => entry.saveState === "incomplete") && <p role="status">部分歌单保存未完成。请回到仍打开的导入面板继续保存；面板已关闭时重新导入原文件，然后刷新歌单列表。</p>}
    {!active && playlist && <label>曲目<select value={localIndex} onChange={(event) => setLocalIndex(Number(event.target.value))}>{playlist.items.map((entry, itemIndex) => <option key={entry.id || itemIndex} value={itemIndex}>{itemIndex + 1}. {entry.title}{entry.artist ? ` · ${entry.artist}` : ""}</option>)}</select></label>}
    <audio
      ref={attachAudio}
      src={playableItemUrl || undefined}
      preload="metadata"
      controls={false}
      onLoadedMetadata={(event) => report(event)}
      onTimeUpdate={(event) => report(event)}
      onPlay={(event) => { if (currentAudioTarget(event.currentTarget, false)) { localPlayback("pending"); setPlaying(!event.currentTarget.paused); report(event, true); } }}
      onPlaying={(event) => { if (!event.currentTarget.paused && report(event, true)) { localPlayback("playing"); setPlaying(true); } }}
      onPause={(event) => { if (currentAudioTarget(event.currentTarget, false) && event.currentTarget.paused) { localPlayback("paused"); setPlaying(false); if (!event.currentTarget.ended) report(event, true); } }}
      onSeeked={(event) => report(event, true)}
      onEnded={(event) => { if (currentAudioTarget(event.currentTarget) && event.currentTarget.ended) { localPlayback("ended"); setPlaying(false); void advance(false); } }}
      onError={(event) => { if (currentAudioTarget(event.currentTarget, false)) { localPlayback("error"); setPlaying(false); setError(ERROR_MESSAGE); } }}
      aria-label="一起听歌音频播放器"
    />
    <input className="music-progress-range" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(position, duration || position)} disabled={!duration || (!internalPlayback && !externalSession)} onChange={(event) => { const next = Number(event.target.value); if (internalPlayback && audioRef.current) audioRef.current.currentTime = next; if (externalSession) updateExternalPosition(next); else setPosition(next); }} aria-label={externalSession ? "手动同步播放进度" : "播放进度"} />
    {!active && playback.mode === MUSIC_PLAYBACK_MODES.external && <button type="button" className="together-primary" disabled={!item || controlsBusy} onClick={() => void start()}><Music2 aria-hidden="true" />开始 AI 陪听</button>}
    <div className="music-player-actions">
      <button type="button" aria-label="上一首" disabled={!localCanGoBack || controlsBusy} onClick={() => setLocalIndex((current) => Math.max(0, current - 1))}><SkipBack aria-hidden="true" /></button>
      {playback.mode === MUSIC_PLAYBACK_MODES.external ? <button type="button" className="together-primary" disabled={!item || controlsBusy} onClick={() => void openExternal()}><Play aria-hidden="true" />在网易云播放</button> : <button type="button" className="together-primary" disabled={!item || controlsBusy} onClick={() => { if (playing) pauseCurrentAudio(); else if (active) playCurrentAudio(); else void start(); }}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{playing ? "暂停" : active ? "播放" : "开始一起听"}</button>}
      <button type="button" aria-label="下一首" disabled={active ? controlsBusy || !queue?.currentQueueItemId : controlsBusy || !playlist || localIndex >= playlist.items.length - 1} onClick={() => active ? void advance(true) : setLocalIndex((current) => current + 1)}><SkipForward aria-hidden="true" /></button>
    </div>
    <MusicMoments accountScope={accountScope} companionScope={companionScope} available={Boolean(itemId && itemPlaylistId && !/^local-\d+$/.test(itemId))} getCapture={captureMusicMoment} onSeek={seekMusicMoment} currentPlaylistId={itemPlaylistId} currentItemId={itemId} internalPlayback={internalPlayback} />
    <MusicUnderstandingPanel accountScope={accountScope} companionScope={companionScope} providerTrackId={item?.providerTrackId || currentQueueItem?.providerTrackId || ""} title={item?.title || ""} artist={item?.artist || ""} sessionScope={JSON.stringify([activeSessionId, queueItemId, itemPlaylistId || "", itemId || ""])} onSaved={onUnderstandingSaved} />
    {active && <>
      <div className="music-mode-actions" aria-label="播放方式">
        <button type="button" aria-pressed={queue?.shuffleEnabled || false} disabled={controlsBusy} onClick={() => { const enabled = !queue?.shuffleEnabled; void runQueueOperation({ type: "set_mode", shuffle_enabled: enabled }, { retryConflict: true }).then(accepted => setStatus(accepted.shuffleEnabled ? "已开启随机播放。" : "已关闭随机播放。")).catch(() => {}); }}><Shuffle aria-hidden="true" />{queue?.shuffleEnabled ? "随机中" : "顺序"}</button>
        <button type="button" disabled={controlsBusy} onClick={() => { const modes = ["off", "all", "one"]; const next = modes[(modes.indexOf(queue?.repeatMode || "off") + 1) % modes.length]; void runQueueOperation({ type: "set_mode", repeat_mode: next }, { retryConflict: true }).then(accepted => setStatus(`播放方式：${REPEAT_LABELS[accepted.repeatMode]}。`)).catch(() => {}); }}><Repeat2 aria-hidden="true" />{REPEAT_LABELS[queue?.repeatMode || "off"]}</button>
      </div>
      <section className="music-queue" aria-labelledby="music-queue-title">
        <header><div><ListMusic aria-hidden="true" /><strong id="music-queue-title">本场队列</strong></div><span>{queue?.items.length || 0} 首 · revision {queue?.revision || 0}</span></header>
        {queue?.items.length ? <MusicPagedList key={queue.sessionId} items={queue.items} label="本场队列" listTag="ol" renderItem={(entry, entryIndex) => <li key={entry.id} className={entry.id === queue.currentQueueItemId ? "is-current" : ""}>
          <div><span>{entry.id === queue.currentQueueItemId ? playing ? "正在播放" : "当前曲目" : `第 ${entryIndex + 1} 首`}</span><strong>{entry.title || "未命名曲目"}</strong><small>{entry.artist || "未知艺术家"}</small></div>
          <div className="music-queue-actions">
            <button type="button" aria-label={`上移 ${entry.title}`} disabled={controlsBusy || entryIndex === 0} onClick={() => void runQueueOperation({ type: "move", queue_item_id: entry.id, position: entryIndex - 1 }, { retryConflict: true }).catch(() => {})}><ArrowUp aria-hidden="true" /></button>
            <button type="button" aria-label={`下移 ${entry.title}`} disabled={controlsBusy || entryIndex === queue.items.length - 1} onClick={() => void runQueueOperation({ type: "move", queue_item_id: entry.id, position: entryIndex + 1 }, { retryConflict: true }).catch(() => {})}><ArrowDown aria-hidden="true" /></button>
            <button type="button" aria-label={`移除 ${entry.title}`} disabled={controlsBusy} onClick={() => void runQueueOperation({ type: "remove", queue_item_id: entry.id }, { retryConflict: true }).catch(() => {})}><Trash2 aria-hidden="true" /></button>
          </div>
        </li>} /> : <p>队列是空的，可以从下面的歌单加入曲目。</p>}
      </section>
      {playlist && <section className="music-queue-picker" aria-label="从当前歌单加入队列"><strong>{playlist.name}</strong>{<MusicPagedList key={playlist.id} items={playlist.items} label="歌单曲目" renderItem={(entry) => { const entryPlayback = resolveMusicPlayback(entry); const external = entryPlayback.mode === MUSIC_PLAYBACK_MODES.external; return <div key={entry.id}><span>{entry.title}{external && <small> · Together 元数据队列</small>}</span><button type="button" disabled={controlsBusy} onClick={() => void runQueueOperation({ type: "add", item_id: entry.id, position: Math.max(0, currentQueueIndex + 1) }, { retryConflict: true }).catch(() => {})}><Play aria-hidden="true" />下一首播放</button><button type="button" disabled={controlsBusy} onClick={() => void runQueueOperation({ type: "add", item_id: entry.id }, { retryConflict: true }).catch(() => {})}><ListPlus aria-hidden="true" />加入队尾</button>{external && <button type="button" onClick={() => void launchExternalTrack(entryPlayback.resourceType, entryPlayback.resourceId)}><Play aria-hidden="true" />在网易云播放</button>}</div>; }} />}</section>}
    </>}
    {active && <button type="button" disabled={controlsBusy} onClick={() => void end()}><CircleStop aria-hidden="true" />结束本场</button>}
    <p className="together-device-note">{formatMediaTime(position)} / {duration ? formatMediaTime(duration) : "等待媒体信息"}。{playback.mode === MUSIC_PLAYBACK_MODES.external ? "只进入 Together 元数据队列，不进入 App audio；切歌后请点击在网易云播放" : "队列不保存音频 URL，播放地址仅从本机已加载歌单解析；不代理、不下载、不绕过 DRM。"}</p>
    {active && retryQueue?.sessionId === session.id && <button type="button" className="together-primary" disabled={controlsBusy} onClick={() => void retrySeedQueue()}><RefreshCw aria-hidden="true" />重试载入队列</button>}
    {status && <p className="together-feedback" role="status">{loading || queueBusy ? "正在处理 · " : ""}{status}</p>}
    {error && <p className="together-feedback is-error" role="alert">{error}</p>}
  </div>;
}
