import { useEffect, useEffectEvent, useRef, useState } from "react";
import { DlnaReceiver } from "./dlna-receiver";
import { awaitCastReceipt } from "./cast-receipt";
import { apiFetch } from "./api.js";
import {
  createCoWatchSession,
  readActiveCoWatchSession,
  sendCoWatchReply,
} from "./co-watch";
import {
  createWatchRoom,
  joinWatchRoom,
  readWatchRoom,
  readRoomMessages,
  sendRoomMessage,
  sendRoomAiMessage,
  subscribeRoomEvents,
  leaveWatchRoom,
} from "./watch-room";
import { peekPendingInvite, clearPendingInvite, fetchRoomInviteInfo } from "./room-invite";
import "./cast-player.css";

/**
 * B站放映厅风格 — 投屏/一起看播放器。
 * 窄屏（手机）→ 播放确认页；宽屏（桌面/平板）→ 完整播放器+聊天+AI分析。
 */
export default function DlnaCastPlayer({ info, userName = "你", aiName = "伴侣", onClose }) {
  const [launchResult, setLaunchResult] = useState(null);
  const [launchAttempt, setLaunchAttempt] = useState(0);
  const [playbackError, setPlaybackError] = useState("");
  const [captureNotice, setCaptureNotice] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const mediaContextRef = useRef(null);
  const captureBusyRef = useRef(false);
  const [urlInput, setUrlInput] = useState("");
  const [extracting, setExtracting] = useState(false);
  // 放映厅
  const [room, setRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [roomNotice, setRoomNotice] = useState("");
  const [roomCreateUnconfirmed, setRoomCreateUnconfirmed] = useState(false);
  const roomCreateUnconfirmedRef = useRef(false);
  const roomBusyRef = useRef(false);
  const roomSyncRef = useRef(0);
  const roomMessageIdsRef = useRef(new Set());
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const roomRef = useRef(null);
  const roomEpochRef = useRef(0);
  const participantsRef = useRef([]);
  const launchedRef = useRef(null);
  const sessionRef = useRef("");
  const sessionPromiseRef = useRef(null);
  const lifetimeRef = useRef(null);
  const lastFrameWarnRef = useRef(0);
  const scrollTimerRef = useRef(null);
  const shareTimerRef = useRef(null);
  const frameBusyRef = useRef(false);
  const playbackCommandBusyRef = useRef(false);
  const playbackRevisionRef = useRef(0);

  // 邀请弹窗
  const [inviteCode, setInviteCode] = useState(() => peekPendingInvite()?.code || "");
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");

  // 播放器控制
  const [isPlaying, setIsPlaying] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [position, setPosition] = useState({ positionMs: 0, durationMs: 0 });
  const [danmakuEnabled, setDanmakuEnabled] = useState(true);
  const danmakuEnabledRef = useRef(true);
  useEffect(() => { danmakuEnabledRef.current = danmakuEnabled; }, [danmakuEnabled]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatBusyRef = useRef(false);
  // AI 分析状态
  const [analysisState, setAnalysisState] = useState("never");
  // 聊天消息
  const [messages, setMessages] = useState([]);

  // 播放器控制自动隐藏
  const controlTimerRef = useRef(null);
  const chatEndRef = useRef(null);
  const speedOptions = [0.5, 1.0, 1.5, 2.0];

  /* ─── 分享邀请 ─── */
  const shareRoomInvite = async () => {
    const current = roomRef.current;
    const lifetime = lifetimeRef.current;
    if (!current?.joinCode) return;
    const code = current.joinCode;
    // 获取自己的显示ID
    let displayId = "";
    try {
      const resp = await apiFetch("/api/v2/co-watch/display-id", { timeoutMs: 5000 }).catch(() => null);
      if (resp) {
        const data = await resp.json().catch(() => ({}));
        displayId = data?.display_id || "";
      }
    } catch { /* 显示 ID 不影响分享。 */ }
    if (!lifetime?.active || roomRef.current?.id !== current.id) return;
    const webLink = `https://dengtahome.com/room/join?room_code=${encodeURIComponent(code)}${displayId ? `&host_id=${encodeURIComponent(displayId)}` : ""}`;
    const text = `🎬 ${userName} 邀请您和您的伴侣（${aiName}）一起观影《${current.title || "影片"}》！\n\n加入放映厅：${webLink}\n邀请码：${code}`;
    try {
      if (navigator.share && navigator.canShare?.({ text })) {
        await navigator.share({ title: "灯塔放映厅邀请", text, url: webLink });
      } else {
        await navigator.clipboard.writeText(text);
        if (!lifetime.active) return;
        setRoomNotice("已复制邀请链接");
        clearTimeout(shareTimerRef.current);
        shareTimerRef.current = setTimeout(() => setRoomNotice(""), 3000);
      }
    } catch { /* 系统分享可以由用户取消。 */ }
  };

  /* ─── 检查待处理邀请 ─── */
  const onPendingInvite = useEffectEvent(() => {
      const code = peekPendingInvite()?.code || "";
      if (code === inviteCode) return;
      setInviteCode(code);
      setInviteInfo(null);
      setInviteError("");
  });
  useEffect(() => {
    const onInvite = () => onPendingInvite();
    window.addEventListener("dengta:room-invite", onInvite);
    return () => window.removeEventListener("dengta:room-invite", onInvite);
  }, []);

  useEffect(() => {
    if (!inviteCode) return;
    let active = true;
    fetchRoomInviteInfo(inviteCode).then((data) => {
      if (!active) return;
      setInviteInfo(data);
      setInviteError(data ? "" : "邀请信息读取失败，邀请码可能已过期。");
    }).catch(() => {
      if (active) setInviteError("邀请信息读取失败，邀请码可能已过期。");
    });
    return () => { active = false; };
  }, [inviteCode]);

  /* ─── 接受/拒绝邀请 ─── */
  const handleAcceptInvite = async () => {
    if (!inviteCode || roomBusyRef.current || roomRef.current || closingRef.current) return;
    roomBusyRef.current = true;
    const lifetime = lifetimeRef.current;
    setInviteBusy(true);
    setInviteError("");
    try {
      const joined = await joinWatchRoom(inviteCode, { displayName: userName, aiName });
      if (!lifetime?.active) return;
      if (!joined?.id) throw new Error("join_failed");
      roomCreateUnconfirmedRef.current = false; setRoomCreateUnconfirmed(false);
      setRoom(joined);
      roomMessageIdsRef.current.clear(); setMessages([]);
      roomEpochRef.current += 1;
      roomRef.current = joined;
      if (peekPendingInvite()?.code === inviteCode) {
        setInviteCode("");
        setInviteInfo(null);
        clearPendingInvite();
      }
      await syncRoomData(joined.id);
    } catch (error) {
      if (lifetime?.active) setInviteError(error?.message || "加入失败，邀请码可能已过期或放映厅已结束。");
    } finally { roomBusyRef.current = false; if (lifetime?.active) setInviteBusy(false); }
  };
  const handleDeclineInvite = () => {
    setInviteCode("");
    setInviteInfo(null);
    setInviteError("");
    clearPendingInvite();
  };

  const mediaUrl = room?.mediaUrl || info?.uri || info?.mediaUrl || "";
  const title = room?.title || info?.title || "投屏播放";
  const durationSeconds = Number(info?.durationSeconds || info?.duration || 0);
  const cover = info?.cover || info?.thumb || "";
  const sourceApp = info?.sourceApp || "DLNA 投屏";

  /* ─── 异步会话 ─── */
  const ensureSession = async () => {
    if (sessionRef.current) return sessionRef.current;
    if (sessionPromiseRef.current) return sessionPromiseRef.current;
    const lifetime = lifetimeRef.current;
    const context = mediaContextRef.current;
    const pending = (async () => {
      try {
        const existing = await readActiveCoWatchSession({ sessionMode: "screen" });
        if (!lifetime?.active || !context?.active) return "";
        if (existing?.id) { sessionRef.current = existing.id; return existing.id; }
        const created = await createCoWatchSession({ title, sourceApp, sessionMode: "screen", mediaDurationSeconds: durationSeconds, mediaPositionSeconds: 0 });
        if (!created?.id) throw new Error("no_session");
        if (!lifetime.active || !context.active) return "";
        sessionRef.current = created.id;
        return created.id;
      } catch { return ""; }
    })();
    sessionPromiseRef.current = pending;
    try { return await pending; }
    finally { if (sessionPromiseRef.current === pending) sessionPromiseRef.current = null; }
  };

  /* ─── 原生聊天消息 ─── */
  const base64ToBytes = (base64) => {
    const binary = globalThis.atob(String(base64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const addMessage = (type, content, sender, roomMessage = null) => {
    if (roomMessage?.id != null) {
      const key = `${roomRef.current?.id}:${roomMessage.id}`;
      if (roomMessageIdsRef.current.has(key)) return false;
      roomMessageIdsRef.current.add(key);
    }
    const message = { type, content, sender, id: roomMessage?.id != null ? `room:${roomMessage.id}` : crypto.randomUUID(), fromRoom: Boolean(roomMessage), createdAt: roomMessage?.createdAt || new Date().toISOString() };
    setMessages((prev) => [...prev, message].sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)).slice(-100));
    clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    return true;
  };

  const handleCastChat = async (event) => {
    if (closingRef.current) return false;
    const text = String(event?.text || "").trim();
    if (!text) return false;
    const lifetime = lifetimeRef.current;
    const mediaContext = mediaContextRef.current;
    const currentMedia = () => lifetime?.active && mediaContext?.active && !closingRef.current;
    const originRoom = roomRef.current;
    const originRoomEpoch = roomEpochRef.current;
    const positionSeconds = Math.round((Number(event?.positionMs) || 0) / 1000);
    let userSaved = false;
    try {
      if (originRoom?.id) {
        const saved = await sendRoomMessage(originRoom.id, text, positionSeconds);
        if (!currentMedia() || roomRef.current?.id !== originRoom.id || roomEpochRef.current !== originRoomEpoch) return Boolean(saved?.id != null);
        if (saved?.id == null) throw new Error("房间未返回消息保存回执，请核对消息后再重试。");
        addMessage("user", saved.content, saved.senderName || userName, saved);
      } else addMessage("user", text, userName);
      userSaved = true;
      const session = await ensureSession();
      if (!currentMedia()) return userSaved;
      if (!session) throw new Error("no_session");
      const reply = await awaitCastReceipt(sendCoWatchReply(session, text, positionSeconds), { timeoutMs: 90_000, code: "cast_reply_timeout", signal: mediaContext.controller.signal });
      if (!currentMedia()) return userSaved;
      const replyText = String(reply?.reaction || "").trim();
      if (!replyText) throw new Error("empty_reply");
      if (roomEpochRef.current !== originRoomEpoch) return false;
      DlnaReceiver.showCastReply({ text: replyText, aiName }).catch(() => {});
      if (originRoom?.id && roomRef.current?.id === originRoom.id && roomEpochRef.current === originRoomEpoch) {
        try {
          const saved = await sendRoomAiMessage(originRoom.id, replyText, positionSeconds, aiName);
          if (!currentMedia() || roomEpochRef.current !== originRoomEpoch) return userSaved;
          if (saved?.id == null) throw new Error("房间未返回消息保存回执。");
          addMessage("ai", saved.content, saved.senderName || aiName, saved);
        } catch (error) {
          if (!currentMedia() || roomEpochRef.current !== originRoomEpoch) return userSaved;
          addMessage("ai", replyText, aiName);
          setRoomError(`回复仅在当前设备显示，房间同步未确认：${error?.message || "请检查网络并核对房间消息。"}`);
        }
      } else addMessage("ai", replyText, aiName);
      return true;
    } catch (error) {
      if (!currentMedia()) return userSaved;
      if (roomEpochRef.current === originRoomEpoch) setPlaybackError(error?.message || "回复获取失败，请稍后再试。");
      return userSaved;
    }
  };

  /* 同一时刻只分析一帧，避免原生周期事件积压请求。 */
  const handleCastFrame = useEffectEvent(async (event) => {
    const base64 = String(event?.frameBase64 || "");
    if (!base64 || frameBusyRef.current || closingRef.current) return;
    const lifetime = lifetimeRef.current;
    const mediaContext = mediaContextRef.current;
    if (!mediaContext?.active) return;
    const job = new AbortController();
    frameBusyRef.current = job;
    const current = () => lifetime?.active && mediaContext.active && !job.signal.aborted && !closingRef.current;
    setAnalysisState("loading");
    try {
      const session = await ensureSession();
      if (!current()) return;
      if (!session) throw new Error("no_session");
      const query = new URLSearchParams({ session_id: session, mode: "screen", epoch: "cast-renderer", sequence: String(Date.now()), captured_at: new Date().toISOString() });
      const response = await apiFetch('/api/v2/co-watch/frame?' + query.toString(), { method: "POST", signal: job.signal, timeoutMs: 90_000, headers: { "Content-Type": "image/jpeg" }, body: base64ToBytes(base64), retry: false });
      const data = await response.json();
      if (!current()) return;
      if (!response.ok) throw new Error("frame_failed");
      const reaction = String(data?.reaction || "").trim();
      if (reaction) {
        const sender = String(data?.ai_name || aiName);
        DlnaReceiver.showCastReaction({ text: reaction, aiName: sender }).catch(() => {});
        if (danmakuEnabledRef.current) DlnaReceiver.showCastDanmaku({ text: reaction, senderName: sender, colorHex: "#FFD9A8" }).catch(() => {});
        addMessage("ai", reaction, sender);
      }
      setAnalysisState("complete");
    } catch {
      if (!current()) return;
      setAnalysisState("error");
      const now = Date.now();
      if (now - lastFrameWarnRef.current > 60_000) {
        lastFrameWarnRef.current = now;
        console.warn("[DlnaCastPlayer] frame_failed");
      }
    } finally { if (frameBusyRef.current === job) frameBusyRef.current = false; }
  });

  const handleSendMessage = async () => {
    const text = chatInput.trim();
    if (!text || chatBusyRef.current || closingRef.current) return;
    const context = mediaContextRef.current;
    const job = {};
    chatBusyRef.current = job; setChatBusy(true);
    setPlaybackError("");
    try {
      const success = await handleCastChat({ text, positionMs: position.positionMs });
      if (success && lifetimeRef.current?.active && context?.active) setChatInput(current => current.trim() === text ? "" : current);
    } finally { if (chatBusyRef.current === job) { chatBusyRef.current = false; if (lifetimeRef.current?.active) setChatBusy(false); } }
  };

  const syncRoomData = async (roomId) => {
    if (!roomId) return;
    const lifetime = lifetimeRef.current;
    const epoch = roomEpochRef.current;
    const request = ++roomSyncRef.current;
    let data;
    try { data = await readWatchRoom(roomId); }
    catch (error) {
      if (lifetime?.active && roomRef.current?.id === roomId && roomEpochRef.current === epoch && request === roomSyncRef.current) setRoomError(error?.message || "房间状态读取失败，请检查网络后重连。");
      return;
    }
    if (!lifetime?.active || roomRef.current?.id !== roomId || roomEpochRef.current !== epoch || request !== roomSyncRef.current) return;
    if (data?.room && Number(data.room.playbackRevision || 0) >= Number(roomRef.current.playbackRevision || 0)) { setRoom(data.room); roomRef.current = data.room; }
    if (Array.isArray(data?.participants)) { setParticipants(data.participants); participantsRef.current = data.participants; }
  };

  const handleCreateRoom = async () => {
    if (roomBusyRef.current || roomRef.current || closingRef.current || roomCreateUnconfirmedRef.current) return;
    roomBusyRef.current = true;
    const lifetime = lifetimeRef.current;
    setRoomBusy(true);
    setRoomError("");
    try {
      const created = await createWatchRoom({ title, sourceApp, mediaUrl, mediaDurationSeconds: durationSeconds, displayName: userName, aiName, session_id: sessionRef.current || undefined });
      if (!lifetime?.active) return;
      if (typeof created?.id !== "string" || !created.id.trim()) throw new Error("no_room");
      roomEpochRef.current += 1;
      roomMessageIdsRef.current.clear(); setMessages([]);
      setRoom(created); roomRef.current = created;
      await syncRoomData(created.id);
    } catch (error) {
      if (!lifetime?.active) return;
      const rejected = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && error.status !== 408;
      if (rejected) setRoomError(error?.message || "服务拒绝创建放映厅，请检查连接或权限后重试。");
      else {
        roomCreateUnconfirmedRef.current = true; setRoomCreateUnconfirmed(true);
        setRoomError("没有收到创建确认，服务器可能已经建好房间。为避免重复建房，本次暂停再次创建；请向同场成员核对邀请码，再通过下方输入框加入。（错误代码：watch_room_create_unconfirmed）");
      }
    }
    finally { roomBusyRef.current = false; if (lifetime?.active) setRoomBusy(false); }
  };

  const handleJoinRoom = async () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code || roomBusyRef.current || roomRef.current || closingRef.current) return;
    roomBusyRef.current = true;
    const lifetime = lifetimeRef.current;
    setRoomBusy(true); setRoomError("");
    try {
      const joined = await joinWatchRoom(code, { displayName: userName, aiName });
      if (!lifetime?.active) return;
      if (!joined?.id) throw new Error("join_failed");
      roomCreateUnconfirmedRef.current = false; setRoomCreateUnconfirmed(false);
      roomEpochRef.current += 1;
      roomMessageIdsRef.current.clear(); setMessages([]);
      setRoom(joined); roomRef.current = joined;
      await syncRoomData(joined.id);
    } catch (error) { if (lifetime?.active) setRoomError(error?.message || "加入失败：邀请码可能无效或放映厅已结束。"); }
    finally { roomBusyRef.current = false; if (lifetime?.active) setRoomBusy(false); }
  };

  const handleLeaveRoom = async () => {
    const current = roomRef.current;
    if (!current || roomBusyRef.current) return;
    const lifetime = lifetimeRef.current;
    const epoch = roomEpochRef.current;
    roomBusyRef.current = true; setRoomBusy(true);
    try {
      const receipt = await leaveWatchRoom(current.id);
      if (!lifetime?.active || roomRef.current?.id !== current.id || roomEpochRef.current !== epoch) return;
      if (receipt?.status !== "left") throw new Error("服务未确认退出，当前房间与消息继续保留。请重连核对房间状态，再重试退出。（错误代码：watch_room_leave_unconfirmed）");
      roomEpochRef.current += 1;
      roomRef.current = null; participantsRef.current = [];
      roomMessageIdsRef.current.clear(); setMessages([]);
      setRoom(null); setParticipants([]); setRoomError(""); setRoomNotice("");
    } catch (error) { if (lifetime?.active && roomRef.current?.id === current.id && roomEpochRef.current === epoch) setRoomError(error?.message || "退出同步失败，仍保留当前房间，请稍后重试。"); }
    finally { roomBusyRef.current = false; if (lifetime?.active) setRoomBusy(false); }
  };

  const onRoomMessage = useEffectEvent((msg) => {
    if (!addMessage(msg.senderType === "ai" ? "ai" : "user", msg.content, msg.senderName || "成员", msg)) return;
    if (danmakuEnabledRef.current) DlnaReceiver.showCastDanmaku({ text: String(msg.content || "").slice(0, 40), colorHex: msg.senderType === "ai" ? "#FFD9A8" : "#8BD8FF" }).catch(() => {});
  });
  const onRoomConnected = useEffectEvent(async (id) => {
    setRoomError("");
    void syncRoomData(id);
    const epoch = roomEpochRef.current;
    try {
      const history = await readRoomMessages(id);
      if (!lifetimeRef.current?.active || roomRef.current?.id !== id || roomEpochRef.current !== epoch) return;
      for (const msg of history) addMessage(msg.senderType === "ai" ? "ai" : "user", msg.content, msg.senderName || "成员", msg);
    } catch (error) { if (lifetimeRef.current?.active && roomRef.current?.id === id && roomEpochRef.current === epoch) setRoomError(error?.message || "历史消息读取失败，实时消息仍可接收；重连后会再读取。"); }
  });
  const onRoomRefresh = useEffectEvent((id) => { void syncRoomData(id); });
  useEffect(() => {
    const id = room?.id;
    if (!id) return;
    let active = true;
    const valid = () => active && roomRef.current?.id === id;
    const stop = subscribeRoomEvents(id, {
      onConnected: () => { if (valid()) void onRoomConnected(id); },
      onPlaybackSync: (updated) => {
        if (!valid()) return;
        if (Number(updated.playbackRevision || 0) < Number(roomRef.current?.playbackRevision || 0)) return;
        setRoomError("");
        roomRef.current = { ...roomRef.current, ...updated };
        setRoom(roomRef.current);
      },
      onMessage: (msg) => { if (valid()) onRoomMessage(msg); },
      onParticipantJoin: () => {
        if (!valid()) return;
        onRoomRefresh(id);
      },
      onParticipantLeave: () => { if (valid()) onRoomRefresh(id); },
      onRoomEnded: () => {
        if (!valid()) return;
        roomEpochRef.current += 1;
        roomRef.current = null; participantsRef.current = [];
        roomMessageIdsRef.current.clear(); setMessages([]);
        setRoom(null); setParticipants([]);
      },
      onError: (error) => { if (valid()) setRoomError(error?.message || "放映厅连接中断，正在重连。"); },
      onDisconnect: () => { if (valid()) setRoomError(current => current ? current.includes("正在重连") ? current : `${current} 正在重连。` : "放映厅连接中断，正在重连。"); },
    });
    return () => { active = false; stop(); };
  }, [room?.id]);

  const onNativeChat = useEffectEvent((event) => { void handleCastChat(event); });
  useEffect(() => {
    const lifetime = { active: true };
    lifetimeRef.current = lifetime;
    const handles = [];
    const remove = (handle) => { Promise.resolve().then(() => handle?.remove?.()).catch(() => {}); };
    const listen = (name, callback) => {
      Promise.resolve().then(() => DlnaReceiver.addListener(name, (event) => {
        if (lifetime.active) callback(event);
      })).then((handle) => {
        if (lifetime.active) handles.push(handle);
        else remove(handle);
      }).catch(() => {});
    };
    listen("castChat", (event) => onNativeChat(event));
    listen("castFrame", (event) => { void handleCastFrame(event); });
    listen("castPosition", (event) => {
      const finite = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
      setPosition({ positionMs: finite(event?.positionMs), durationMs: finite(event?.durationMs) });
    });
    return () => {
      lifetime.active = false;
      frameBusyRef.current?.abort?.();
      handles.forEach(remove);
      clearTimeout(controlTimerRef.current);
      clearTimeout(scrollTimerRef.current);
      clearTimeout(shareTimerRef.current);
    };
  }, []);

  const resetMediaFeedback = useEffectEvent(() => {
    setAnalysisState("never");
    setPosition({ positionMs: 0, durationMs: 0 });
    setPlaybackSpeed(1);
    setCaptureNotice("");
    setPlaybackError("");
    setCapturing(false);
    setChatBusy(false);
  });
  useEffect(() => {
    const context = { active: true, uri: mediaUrl, controller: new AbortController() };
    mediaContextRef.current = context;
    queueMicrotask(() => { if (context.active && lifetimeRef.current?.active) resetMediaFeedback(); });
    return () => {
      context.active = false;
      context.controller.abort();
      sessionRef.current = "";
      sessionPromiseRef.current = null;
      frameBusyRef.current?.abort?.();
      frameBusyRef.current = false;
      playbackCommandBusyRef.current = false;
      captureBusyRef.current = false;
      chatBusyRef.current = false;
    };
  }, [mediaUrl, room?.id]);

  async function handleClose() {
    if (closingRef.current) return;
    if (!mediaUrl) { onClose?.(); return; }
    closingRef.current = true; setClosing(true);
    const lifetime = lifetimeRef.current;
    const context = mediaContextRef.current;
    frameBusyRef.current?.abort?.();
    setAnalysisState("never");
    try {
      await awaitCastReceipt(DlnaReceiver.stopPlayback({ expectedUri: mediaUrl }), { timeoutMs: 3000, code: "cast_stop_timeout", signal: context?.controller.signal });
      if (!lifetime?.active || !context?.active) return;
      lifetime.active = false;
      onClose?.();
    } catch (error) {
      if (lifetime?.active && context?.active && error?.name !== "AbortError") setPlaybackError(`停止播放未确认（${error?.code === "cast_stop_timeout" ? "cast_stop_timeout" : "cast_stop_failed"}）。可重试结束，或返回聊天后在原生播放器中停止。`);
    } finally {
      closingRef.current = false;
      if (lifetime?.active) setClosing(false);
    }
  }

  const showControls = () => {
    setControlsVisible(true);
    clearTimeout(controlTimerRef.current);
    controlTimerRef.current = setTimeout(() => setControlsVisible(false), 4000);
  };

  const runPlaybackCommand = async (command, onSuccess) => {
    if (playbackCommandBusyRef.current || closingRef.current) return;
    const context = mediaContextRef.current;
    if (!context?.active) return;
    const job = {};
    playbackCommandBusyRef.current = job;
    playbackRevisionRef.current += 1;
    const lifetime = lifetimeRef.current;
    try {
      const result = await awaitCastReceipt(DlnaReceiver.sendPlaybackCommand({ ...command, expectedUri: context.uri }), { timeoutMs: command.action === "fullscreen" ? 35_000 : 5000, signal: context.controller.signal });
      if (lifetime?.active && context.active && !closingRef.current) {
        onSuccess?.(result);
        if (typeof result?.playWhenReady === "boolean") setIsPlaying(result.playWhenReady);
        if (Number.isFinite(result?.speed) && result.speed >= 0.5 && result.speed <= 2) setPlaybackSpeed(result.speed);
        if (Number.isFinite(result?.positionMs) && Number.isFinite(result?.durationMs)) {
          setPosition({ positionMs: Math.max(0, result.positionMs), durationMs: Math.max(0, result.durationMs) });
        }
        setPlaybackError("");
      }
    } catch (error) {
      if (lifetime?.active && context.active && error?.name !== "AbortError") setPlaybackError(error?.code === "cast_command_timeout" ? "播放操作回执超时（cast_command_timeout），请核对原生播放器；未自动重发。" : error?.code === "playback_not_active"
        ? "播放器尚未就绪，请先打开视频。"
        : "播放操作未完成，请在原生播放器内操作或稍后重试。");
    } finally { if (playbackCommandBusyRef.current === job) { playbackCommandBusyRef.current = false; playbackRevisionRef.current += 1; } }
    if (lifetime?.active && context.active) showControls();
  };
  const handlePlayPause = () => { void runPlaybackCommand({ action: isPlaying ? "pause" : "play" }, () => setIsPlaying(!isPlaying)); };
  const handleToggleFullscreen = () => { void runPlaybackCommand({ action: "fullscreen" }); };
  const handleScreenshot = async () => {
    if (captureBusyRef.current || closingRef.current) return;
    const context = mediaContextRef.current;
    if (!context?.active) return;
    const job = {};
    captureBusyRef.current = job;
    setCapturing(true);
    setCaptureNotice("");
    setPlaybackError("");
    const lifetime = lifetimeRef.current;
    try {
      const result = await awaitCastReceipt(DlnaReceiver.captureFrame({ expectedUri: context.uri }), { timeoutMs: 35_000, code: "cast_capture_timeout", signal: context.controller.signal });
      if (result?.saved !== true || result?.completed !== true) throw new Error("capture_incomplete");
      if (lifetime?.active && context.active && !closingRef.current) setCaptureNotice("截帧已保存到应用图片目录。");
    } catch {
      if (lifetime?.active && context.active && !closingRef.current) setPlaybackError("截帧未完成，请在画面就绪后重试；旧版客户端可在原生播放器内截帧。");
    } finally {
      if (captureBusyRef.current === job) { captureBusyRef.current = false; if (lifetime?.active) setCapturing(false); }
    }
  };
  const handleCycleSpeed = () => {
    const next = speedOptions.find((speed) => speed > playbackSpeed) || speedOptions[0];
    void runPlaybackCommand({ action: "speed", value: next }, () => setPlaybackSpeed(next));
  };

  const onPlaybackSnapshot = useEffectEvent((result) => {
    if (playbackCommandBusyRef.current) return;
    if (typeof result?.playWhenReady === "boolean") setIsPlaying(result.playWhenReady);
    if (Number.isFinite(result?.speed) && result.speed >= 0.5 && result.speed <= 2) setPlaybackSpeed(result.speed);
    if (Number.isFinite(result?.positionMs) && Number.isFinite(result?.durationMs)) {
      setPosition({ positionMs: Math.max(0, result.positionMs), durationMs: Math.max(0, result.durationMs) });
    }
  });
  useEffect(() => {
    if (!mediaUrl) return;
    let active = true, busy = false, unsupported = false;
    let timer;
    const poll = async () => {
      if (!active || unsupported || busy || document.visibilityState === "hidden") return;
      busy = true;
      const revision = playbackRevisionRef.current;
      try {
        const result = await awaitCastReceipt(DlnaReceiver.getPlaybackState({ expectedUri: mediaUrl }), { timeoutMs: 3000, code: "cast_state_timeout" });
        if (active && lifetimeRef.current?.active && revision === playbackRevisionRef.current && document.visibilityState !== "hidden") onPlaybackSnapshot(result);
      } catch (error) {
        unsupported = error?.code === "UNIMPLEMENTED" || error?.code === "UNAVAILABLE";
      } finally {
        busy = false;
        if (active && !unsupported && document.visibilityState !== "hidden") timer = setTimeout(poll, 1000);
      }
    };
    const onVisibility = () => { clearTimeout(timer); if (document.visibilityState !== "hidden") void poll(); };
    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => { active = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [mediaUrl]);

  // StrictMode 重订阅复用同一个启动请求；仅当前媒体的结果可更新界面。
  const launchNativePlayer = useEffectEvent((uri) => {
    if (!lifetimeRef.current?.active || launchedRef.current?.uri !== uri) return Promise.reject(new Error("launch_cancelled"));
    return DlnaReceiver.launchPlayer({ uri, title, userName, aiName });
  });
  useEffect(() => {
    if (!mediaUrl) return;
    let active = true;
    if (launchedRef.current?.uri !== mediaUrl || launchedRef.current?.attempt !== launchAttempt) {
      launchedRef.current = { uri: mediaUrl, attempt: launchAttempt, promise: Promise.resolve().then(() => launchNativePlayer(mediaUrl)) };
    }
    launchedRef.current.promise.then(() => {
      if (active) { setLaunchResult({ uri: mediaUrl, attempt: launchAttempt, ok: true }); setIsPlaying(true); }
    }).catch(() => {
      if (active) setLaunchResult({ uri: mediaUrl, attempt: launchAttempt, ok: false });
    });
    return () => { active = false; };
  }, [mediaUrl, launchAttempt]);

  async function handleExtract() {
    const url = urlInput.trim();
    if (!url || extracting) return;
    const lifetime = lifetimeRef.current;
    setExtracting(true); setPlaybackError("");
    try {
      const { VideoExtractor } = await import("./video-extractor");
      if (lifetime?.active) await VideoExtractor.extractVideo({ url, title: url });
    } catch {
      if (!lifetime?.active) return;
      try { await DlnaReceiver.launchPlayer({ uri: url, title: url, userName, aiName }); }
      catch { if (lifetime.active) setPlaybackError("视频打开失败，请检查链接或稍后重试。"); }
    } finally { if (lifetime?.active) setExtracting(false); }
  }

  const currentTime = formatDuration(position.positionMs / 1000);
  const totalTime = formatDuration(position.durationMs / 1000 || durationSeconds);
  const launchCurrent = launchResult?.uri === mediaUrl && launchResult?.attempt === launchAttempt;
  const launching = Boolean(mediaUrl) && !launchCurrent;
  const launchFailed = launchCurrent && !launchResult.ok;
  const showWaitingOnly = !mediaUrl;

  const inviteDialog = (inviteCode && (inviteInfo || inviteError) && (
            <div className="cast-invite-overlay">
              <div className="cast-invite-card">
                <div className="cast-invite-icon">🎬</div>
                {inviteInfo ? (
                  <>
                    <h3 className="cast-invite-title">
                      <span className="cast-attr-user is-active">{inviteInfo.hostName || "发起人"}</span>
                      邀请您和您的伴侣（
                      <span className="cast-attr-ai is-dim">{inviteInfo.hostAiName || "伴侣"}</span>
                      ）一起观影
                    </h3>
                    <p className="cast-invite-meta">《{inviteInfo.title || "未命名内容"}》</p>
                    <p className="cast-invite-meta">👥 {inviteInfo.participantCount || 1} 人已加入 · 最多 {inviteInfo.maxParticipants || 50} 人</p>
                    <div className="cast-invite-actions">
                      <button type="button" className="cast-invite-accept" onClick={handleAcceptInvite} disabled={inviteBusy || roomBusy || Boolean(room)}>
                        {inviteBusy ? "加入中…" : "接受邀请"}
                      </button>
                      <button type="button" className="cast-invite-decline" onClick={handleDeclineInvite} disabled={inviteBusy}>
                        拒绝
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="cast-invite-title">邀请信息</h3>
                    {inviteError && <p className="cast-room-error">{inviteError}</p>}
                    <div className="cast-invite-actions">
                      <button type="button" className="cast-invite-decline" onClick={handleDeclineInvite}>关闭</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ));

  const roomActions = (<div className="cast-room-actions">
            {!room ? (
              <>
                <button type="button" className="cast-room-create-btn" onClick={handleCreateRoom} disabled={roomBusy || inviteBusy || !mediaUrl || roomCreateUnconfirmed}>
                  {roomBusy ? "创建中…" : roomCreateUnconfirmed ? "请先核对创建结果" : "🎬 创建放映厅"}
                </button>
                {!mediaUrl && <p className="cast-room-error" style={{ color: "#666" }}>先投屏或粘贴视频链接，才能创建放映厅</p>}
                <div className="cast-room-join-row">
                  <input className="cast-room-join-input" type="text" maxLength={20} placeholder="输入邀请码加入…" value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()} />
                  <button className="cast-room-join-btn" type="button" onClick={handleJoinRoom} disabled={roomBusy || inviteBusy || !joinCodeInput.trim()}>
                    {roomBusy ? "加入中…" : "加入"}
                  </button>
                </div>
              </>
            ) : (
              <div className="cast-room-code-area">
                <div className="cast-room-code-label">邀请码</div>
                <div className="cast-room-code">{room.joinCode}</div>
                <button type="button" className="cast-room-share-btn" onClick={shareRoomInvite}>📤 分享邀请</button>
                <p style={{ color: "#666", fontSize: 12, textAlign: "center" }}>最多 {room.maxParticipants || 50} 人</p>
                <button type="button" className="cast-room-leave-btn" disabled={roomBusy} onClick={handleLeaveRoom}>{roomBusy ? "退出中…" : "退出放映厅"}</button>
              </div>
            )}
            {roomError && <p role="alert" className="cast-room-error">{roomError}</p>}
            {roomNotice && <p role="status" className="cast-sync-label">{roomNotice}</p>}
          </div>);

  if (showWaitingOnly) {
    return (
      <div className="cast-root">
        <div className="cast-narrow-scroll">
          {inviteDialog}
          <div className="cast-status-bar">
            <span />
            <span />
          </div>

          <div className="cast-nav">
            <button type="button" className="cast-nav-back" onClick={handleClose}>← 返回</button>
            <span className="cast-nav-title">放映厅</span>
            <span className="cast-nav-right">票夹</span>
          </div>

          {playbackError && <p role="alert" className="cast-room-error">{playbackError}</p>}
          <div className="cast-waiting">
            <div className="cast-waiting-icon">📡</div>
            <div className="cast-waiting-title">等待投屏</div>
            <div className="cast-waiting-hint">在 B站 等视频 App 中点击投屏，选择「灯塔」。</div>

            <div className="cast-waiting-url-row">
              <input className="cast-waiting-url-input" type="url" placeholder="粘贴视频地址…" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleExtract()} />
              <button className="cast-waiting-extract-btn" type="button" onClick={handleExtract} disabled={extracting || !urlInput.trim()}>
                {extracting ? "提取中…" : "提取"}
              </button>
            </div>
          </div>

          {/* 放映厅: 创建/加入 */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "0 16px" }} />
          {roomActions}
        </div>
      </div>
    );
  }

  /* ================================================================
     渲染：播放器页（宽屏风格）
     ================================================================ */
  return (
    <div className="cast-root">
          <div className="cast-player-body">
        {inviteDialog}
        {/* 顶部标题 */}
        <div className="cast-player-header">
          <span className="cast-player-header-title">{title || "当前播放内容"}</span>
          <button type="button" className="cast-player-header-more" onClick={handleClose} disabled={closing}>{closing ? "正在结束…" : "结束放映"}</button>
        </div>

        {/* 同步标签 */}
        <div className={`cast-sync-label${launchFailed ? " is-error" : launching ? " is-pending" : ""}`}>{launching ? "正在打开播放器…" : launchFailed ? "播放器打开失败" : "已打开原生播放器"}</div>
        {launchFailed && <button type="button" className="cast-retry-button" onClick={() => setLaunchAttempt((value) => value + 1)}>重试打开播放器</button>}
        {playbackError && <p role="alert" className="cast-room-error">{playbackError}</p>}
        {playbackError.includes("停止播放未确认") && <button type="button" className="cast-retry-button" onClick={() => onClose?.()}>返回聊天</button>}
        {captureNotice && <p role="status" className="cast-sync-label">{captureNotice}</p>}

        {/* 视频播放器 */}
        <div className="cast-video-container">
          {/* 视频占位 */}
          <div className="cast-video-placeholder">
            {cover ? (
              <img className="cast-video-cover" src={cover} alt="" />
            ) : (
              <span className="cast-video-placeholder-text">视频预览区域</span>
            )}
          </div>

          {/* 进度条 */}
          <div className="cast-progress-track">
            <div className="cast-progress-fill" style={{ width: (position.durationMs > 0 ? Math.min(100, position.positionMs / position.durationMs * 100) : 0) + "%" }} />
          </div>

          {/* 控制栏 */}
          <div className={`cast-controls ${controlsVisible ? "" : "cast-controls-hidden"}`}>
            <div className="cast-controls-left">
              <button className="cast-control-btn" onClick={handlePlayPause} title={isPlaying ? "暂停" : "播放"}>
                {isPlaying ? "⏸" : "▶"}
              </button>
              <span className="cast-control-time">{currentTime} / {totalTime}</span>
            </div>
            <div className="cast-controls-right">
              <button className="cast-control-btn" onClick={handleScreenshot} title="截帧" disabled={capturing}>
                {capturing ? "…" : "📷"}
              </button>
              <button type="button" className="cast-control-speed" onClick={handleCycleSpeed} title="切换倍速">
                {playbackSpeed}x
              </button>
              <button type="button" className="cast-control-fullscreen" onClick={handleToggleFullscreen} title="全屏">
                ⛶
              </button>
            </div>
          </div>
        </div>

        {/* 分 P 信息 */}
        <div className="cast-episode">P1/1 · {totalTime}</div>

        {/* 内容标题 */}
        <div className="cast-content-title">{title || "内容标题"}</div>

        {/* 参与者 */}
        {participants.length > 0 && (
          <div className="cast-participants">
            {participants.slice(0, 5).map((p, i) => (
              <div
                key={i}
                className={`cast-participant-dot ${p.role === "host" || p.role === "user" ? "user" : "ai"}`}
                title={p.displayName || "成员"}
              >
                {(p.displayName || "?")[0]}
              </div>
            ))}
            {participants.length > 5 && <span className="cast-participant-count">+{participants.length - 5}</span>}
          </div>
        )}

        {/* AI 剧情分析 */}
        <div className="cast-analysis">
          {analysisState === "loading" && (
            <div className="cast-analysis-loading">
              <div className="cast-analysis-spinner" />
              <span className="cast-analysis-text">正在分析附近剧情</span>
            </div>
          )}
          {analysisState === "progress" && (
            <>
              <div className="cast-analysis-text">已提前分析部分内容</div>
              <div className="cast-analysis-progress">剧情图像仍在生成，当前暂用纯文字。</div>
            </>
          )}
          {analysisState === "degraded" && (
            <div className="cast-analysis-degraded">剧情图像仍在生成，当前暂用纯文字。</div>
          )}
          {analysisState === "error" && (
            <div className="cast-analysis-error">
              <span>连接暂时中断</span>
              <span>等待下一帧重试</span>
            </div>
          )}
          {analysisState === "complete" && (
            <div className="cast-analysis-complete">分析完成</div>
          )}
          {analysisState === "never" && (
            <div className="cast-analysis-never">等待分析内容</div>
          )}
        </div>

        {/* 放映厅房间信息 */}
        {!room && roomActions}
        {room && (
          <div className="cast-room-panel">
            <div className="cast-room-code-area" style={{ flexDirection: "row", justifyContent: "space-between", padding: "12px 16px" }}>
              <div>
                <div className="cast-room-code-label">邀请码</div>
                <div className="cast-room-code" style={{ fontSize: 18, letterSpacing: 2 }}>{room.joinCode}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" className="cast-room-share-btn" style={{ padding: "6px 14px", fontSize: 12 }} onClick={shareRoomInvite}>分享邀请</button>
                <button type="button" className="cast-room-leave-btn" disabled={roomBusy} onClick={handleLeaveRoom}>{roomBusy ? "退出中…" : "退出"}</button>
              </div>
            </div>
            {roomError && <p role="alert" className="cast-room-error">{roomError}</p>}
            {roomNotice && <p role="status" className="cast-sync-label">{roomNotice}</p>}
          </div>
        )}

        {/* 对话区域 */}
        <div className="cast-chat-header">
          <span className="cast-chat-title">对话区域</span>
          <button type="button" aria-pressed={danmakuEnabled} className={`cast-chat-danmaku-toggle ${danmakuEnabled ? "is-active" : ""}`} onClick={() => setDanmakuEnabled(!danmakuEnabled)}>
            {danmakuEnabled ? "弹幕已开启" : "弹幕已关闭"}
          </button>
        </div>

        {/* 聊天消息 */}
        <div className="cast-chat-messages">
          {messages.length === 0 ? (
            <div className="cast-chat-empty">暂无对话</div>
          ) : (
            messages.map((msg) => {
              const isUserMsg = msg.type === "user";
              const attr = isUserMsg
                ? { displayName: userName, aiName, userActive: true, full: `${userName}&${aiName}` }
                : { displayName: userName, aiName: msg.sender || aiName, userActive: false, full: `${userName}&${msg.sender || aiName}` };
              return (
              <div key={msg.id} className={`cast-message ${isUserMsg ? "cast-message-user" : "cast-message-ai"}`}>
                <div>
                  <div className="cast-message-sender">
                    {msg.fromRoom ? <span>{msg.sender || "成员"}</span> : <><span className={`cast-attr-user ${isUserMsg ? "is-active" : "is-dim"}`}>{attr.displayName}</span>
                    <span className="cast-attr-amp">&</span>
                    <span className={`cast-attr-ai ${isUserMsg ? "is-dim" : "is-active"}`}>{attr.aiName}</span></>}
                  </div>
                  <div className="cast-message-bubble">{msg.content}</div>
                </div>
              </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 底部输入区 */}
        <div className="cast-input-area">
          <input
            className="cast-input"
            type="text"
            placeholder="输入消息…"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
          />
          <button className="cast-send-btn" type="button" onClick={handleSendMessage} disabled={chatBusy || !chatInput.trim()}>
            {chatBusy ? "回复中…" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
