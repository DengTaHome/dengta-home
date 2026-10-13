import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { mediaPlaybackFeedback } from "./media-playback-errors.js";
import {
  acknowledgeCastReceiver,
  clearReceiverToken,
  pairCastReceiver,
  readCastReceiverSession,
  readReceiverToken,
  storeReceiverToken,
} from "./cast-receiver-api.js";
import {
  applyReceiverPlayback,
  normalizeReceiverSession,
  RECEIVER_ACK_INTERVAL_MS,
  RECEIVER_POLL_INTERVAL_MS,
  shouldApplyReceiverRevision,
} from "./receiver-playback.js";
import "./receiver.css";

function receiverLabel() {
  const platform = String(globalThis.navigator?.platform || "").trim();
  return platform ? `客厅屏幕 · ${platform.slice(0, 32)}` : "客厅屏幕";
}

function receiverStorage() {
  try { return globalThis.sessionStorage; } catch { return null; }
}

function receiverFailure(error) {
  const reasons = {
    cast_receiver_receipt_invalid: "服务器没有返回有效的会话状态。请重新读取状态；仍失败时在控制端重新配对。",
    cast_receiver_request_timeout: "接收端读取或配对超时。检查网络后重试；配对码已用过时需要生成新的配对码。",
    cast_pair_invalid: "配对码或会话编号无效。请检查输入，或在控制端重新生成配对码。",
    cast_pair_unavailable: "配对码已被使用或暂时无法配对。请在控制端生成新配对码后重试。",
    cast_receiver_playback_failed: "视频未能开始播放。请再次准备播放；仍失败时重新载入视频或更换媒体链接。",
  };
  const code = Object.hasOwn(reasons, error?.code) ? error.code : "cast_receiver_request_failed";
  const status = Number(error?.status);
  return `${reasons[code] || "接收端暂时无法连接服务。检查网络后重新读取状态或重新配对。"}（错误代码：${code}${Number.isInteger(status) && status >= 400 && status <= 599 ? `；HTTP ${status}` : ""}）`;
}

function readSessionReceipt(data) {
  const receipt = data?.session;
  if (!receipt || typeof receipt.id !== "string" || !receipt.id.trim() || !["active", "ended"].includes(receipt.status)
    || !Number.isSafeInteger(receipt.playback_revision) || receipt.playback_revision < 0) {
    throw Object.assign(new Error("接收状态回执无效。"), { code: "cast_receiver_receipt_invalid" });
  }
  return normalizeReceiverSession(data);
}

export default function ReceiverApp() {
  const videoRef = useRef(null);
  const revisionRef = useRef(-1);
  const sequenceRef = useRef(0);
  const [token, setToken] = useState(() => readReceiverToken(receiverStorage()));
  const [pairingCode, setPairingCode] = useState("");
  const [pairingSessionId, setPairingSessionId] = useState("");
  const [receiverName, setReceiverName] = useState(receiverLabel);
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [message, setMessage] = useState(token ? "正在恢复接收会话…" : "在控制端生成配对码后填写到这里。");
  const sessionId = session?.id || "";
  const mountedRef = useRef(false);
  const scopeRef = useRef(null);
  const pairRef = useRef(null);
  const pollRef = useRef(null);
  const playbackRef = useRef(null);
  const sessionRef = useRef(null);
  const readyRef = useRef(false);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pairRef.current?.abort();
    };
  }, []);

  useLayoutEffect(() => {
    const scope = { token, controller: new AbortController(), active: true };
    scopeRef.current = scope;
    return () => { scope.active = false; scope.controller.abort(); };
  }, [token]);

  const currentScope = useCallback((scope) => mountedRef.current && scope?.active && scopeRef.current === scope && !scope.controller.signal.aborted, []);

  const finish = useCallback((nextMessage = "投屏已结束，可以重新配对。") => {
    const scope = scopeRef.current;
    if (scope) { scope.active = false; scope.controller.abort(); }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    clearReceiverToken(receiverStorage());
    revisionRef.current = -1;
    sequenceRef.current = 0;
    setToken("");
    setSession(null);
    setReady(false);
    readyRef.current = false;
    sessionRef.current = null;
    setReadFailed(false);
    setMediaFailed(false);
    setMessage(nextMessage);
  }, []);

  const ack = useCallback(async (event = "heartbeat") => {
    const scope = scopeRef.current;
    const video = videoRef.current;
    if (!token || !video || !currentScope(scope) || scope.token !== token) return;
    await acknowledgeCastReceiver(token, {
      revision: revisionRef.current,
      sequence: ++sequenceRef.current,
      playbackState: video.paused ? "paused" : "playing",
      mediaPositionSeconds: video.currentTime,
      event,
    }, { signal: scope.controller.signal }).catch(() => {});
  }, [currentScope, token]);

  const applyPlayback = useCallback(async (scope, next) => {
    const video = videoRef.current;
    if (!currentScope(scope) || !video || !next?.mediaUrl || video.getAttribute("src") !== next.mediaUrl || video.readyState < 1
      || (playbackRef.current?.scope === scope)) return;
    const operation = { scope, next };
    playbackRef.current = operation;
    try {
      const result = await applyReceiverPlayback(video, next);
      if (!currentScope(scope) || playbackRef.current !== operation) return;
      if (result.autoplayBlocked) {
        readyRef.current = false;
        setReady(false);
        setMessage("电视浏览器阻止了自动播放，请在电视上再次确认播放。");
        return;
      }
      revisionRef.current = next.revision;
      readyRef.current = true;
      setReady(true);
      setMediaFailed(false);
      setMessage("已连接，播放状态会自动同步。");
      void ack(result.seeked ? "seek" : next.playbackState);
    } catch {
      if (!currentScope(scope) || playbackRef.current !== operation) return;
      readyRef.current = false;
      setReady(false);
      setMessage(receiverFailure({ code: "cast_receiver_playback_failed" }));
    } finally {
      if (playbackRef.current === operation) playbackRef.current = null;
    }
  }, [ack, currentScope]);

  const poll = useCallback(async () => {
    const scope = scopeRef.current;
    if (!token || !currentScope(scope) || scope.token !== token || pollRef.current?.scope === scope) return;
    const operation = { scope };
    pollRef.current = operation;
    try {
      const receipt = await readCastReceiverSession(token, { signal: scope.controller.signal });
      if (!currentScope(scope)) return;
      const next = readSessionReceipt(receipt);
      if (sessionRef.current && next.id !== sessionRef.current.id) {
        throw Object.assign(new Error("会话编号不匹配。"), { code: "cast_receiver_receipt_invalid" });
      }
      if (next.status === "ended") {
        finish();
        return;
      }
      if (sessionRef.current && next.revision < sessionRef.current.revision) return;
      if (sessionRef.current && (next.revision !== sessionRef.current.revision || next.mediaUrl !== sessionRef.current.mediaUrl)) {
        if (playbackRef.current?.scope === scope && !readyRef.current) videoRef.current?.pause();
        playbackRef.current = null;
      }
      if (sessionRef.current?.mediaUrl !== next.mediaUrl) {
        readyRef.current = false;
        setReady(false);
        setMediaFailed(false);
      }
      sessionRef.current = next;
      setSession(next);
      setReadFailed(false);
      if (!next.mediaUrl) {
        setMessage(next.mediaError || "控制端尚未提供可播放的视频直链。");
        return;
      }
      setMessage(readyRef.current ? "已连接，播放状态会自动同步。" : "已连接。请在电视上确认一次“准备播放”。");
      if (!readyRef.current || !shouldApplyReceiverRevision(revisionRef.current, next.revision)) return;
      void applyPlayback(scope, next);
    } catch (error) {
      if (!currentScope(scope)) return;
      if ([401, 403, 404, 410].includes(error?.status)) {
        finish("配对已失效，请在控制端生成新的配对码。");
      } else {
        setReadFailed(true);
        setMessage(receiverFailure(error));
      }
    } finally {
      if (pollRef.current === operation) pollRef.current = null;
    }
  }, [applyPlayback, currentScope, finish, token]);

  useEffect(() => {
    if (!token) return undefined;
    const initialTimer = window.setTimeout(() => void poll(), 0);
    const timer = window.setInterval(() => void poll(), RECEIVER_POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [poll, token]);

  useEffect(() => {
    if (!token || !sessionId) return undefined;
    const timer = window.setInterval(() => void ack("heartbeat"), RECEIVER_ACK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [ack, sessionId, token]);

  const pair = async (event) => {
    event.preventDefault();
    if (!mountedRef.current || !pairingSessionId.trim() || !pairingCode.trim() || !receiverName.trim() || pairRef.current) return;
    const controller = new AbortController();
    pairRef.current = controller;
    setBusy(true);
    setMessage("正在配对…");
    try {
      const data = await pairCastReceiver(pairingSessionId, pairingCode, receiverName, { signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted || pairRef.current !== controller) return;
      const nextToken = typeof data?.receiver_token === "string" ? storeReceiverToken(receiverStorage(), data.receiver_token) : "";
      if (!nextToken) throw Object.assign(new Error("接收凭据无效。"), { code: "cast_receiver_receipt_invalid" });
      setToken(nextToken);
      setPairingCode(current => current === pairingCode ? "" : current);
      setPairingSessionId(current => current === pairingSessionId ? "" : current);
      setMessage("配对成功。请在电视上确认一次“准备播放”。");
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted) setMessage(receiverFailure(error));
    } finally {
      if (pairRef.current === controller) {
        pairRef.current = null;
        if (mountedRef.current) setBusy(false);
      }
    }
  };

  const preparePlayback = async () => {
    const next = sessionRef.current;
    if (!next?.mediaUrl) { setMessage("控制端尚未提供可播放的视频直链，请先在控制端选择视频。"); return; }
    if (videoRef.current?.readyState < 1) { setMessage("视频信息尚未载入。稍后再次准备播放，或重新载入视频。"); return; }
    await applyPlayback(scopeRef.current, next);
  };

  const reloadMedia = () => {
    playbackRef.current = null;
    revisionRef.current = -1;
    readyRef.current = false;
    setReady(false);
    setMediaFailed(false);
    videoRef.current?.load();
    setMessage("正在重新载入视频，载入后请再次准备播放。");
  };

  return (
    <main className="receiver-app">
      <header><small>DENGTA CAST RECEIVER</small><h1>在这块屏幕上接收</h1><p>无需登录。配对凭据只保存在当前标签页会话中。</p></header>
      {!token ? (
        <form className="receiver-card" onSubmit={pair}>
          <label>会话编号<input value={pairingSessionId} onChange={(event) => setPairingSessionId(event.target.value.trim())} autoComplete="off" maxLength={80} /></label>
          <label>配对码<input value={pairingCode} onChange={(event) => setPairingCode(event.target.value.replace(/\s/g, ""))} inputMode="numeric" autoComplete="one-time-code" maxLength={20} autoFocus /></label>
          <label>接收端名称<input value={receiverName} onChange={(event) => setReceiverName(event.target.value)} maxLength={100} /></label>
          <button type="submit" disabled={busy || !pairingSessionId.trim() || !pairingCode.trim() || !receiverName.trim()}>{busy ? "正在配对…" : "连接控制端"}</button>
        </form>
      ) : (
        <section className="receiver-stage">
          <video ref={videoRef} src={session?.mediaUrl || undefined} controls playsInline preload="metadata" referrerPolicy="no-referrer" onPlay={() => void ack("play")} onPause={() => void ack("pause")} onSeeked={() => void ack("seek")} onEnded={() => void ack("ended")} onError={(event) => { if (!sessionRef.current?.mediaUrl) return; playbackRef.current = null; readyRef.current = false; setReady(false); setMediaFailed(true); setMessage(mediaPlaybackFeedback(event.currentTarget.error).message); }}>当前浏览器不支持 HTML5 视频。</video>
          <div className="receiver-overlay"><strong>{session?.title || "等待控制端的视频"}</strong>{!ready && <button type="button" onClick={() => void preparePlayback()}>准备播放</button>}</div>
        </section>
      )}
      {token && <nav className="receiver-actions" aria-label="接收端操作">{readFailed && <button type="button" onClick={() => void poll()}>重新读取状态</button>}{(mediaFailed || session?.mediaUrl) && <button type="button" onClick={reloadMedia}>重新载入视频</button>}<button type="button" onClick={() => finish("请在控制端生成新的配对码后重新连接。")}>重新配对</button></nav>}
      <p className="receiver-message" role="status">{message}</p>
      <aside>只播放控制端提交的公开 HTTPS 视频直链；不支持平台网页、HTTP、私网地址，也不会绕过 DRM、登录或防盗链限制。</aside>
    </main>
  );
}
