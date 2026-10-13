import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogIn, RefreshCw, Smartphone } from "lucide-react";
import {
  beginBilibiliQrLogin,
  checkBilibiliQrLogin,
  disconnectBilibiliQrLogin,
  getBilibiliQrStatus,
  listBilibiliFavoriteFolders,
  listBilibiliFavoriteVideos,
} from "./bilibili-qr-login.js";
import { apiRequest } from "./api.js";
import { openBuiltInBrowser, readBrowserCookie } from "./browser-launcher.js";

const POLL_INTERVAL_MS = 2_000;
const FOCUSABLE_SELECTOR = 'button:not(:disabled), a[href], [tabindex]';

function pickError(caught) {
  return caught?.message || "哔哩哔哩扫码登录暂时失败。";
}

export default function BilibiliQrLogin({ onPickVideo = () => {} }) {
  const canvasRef = useRef(null);
  const qrPanelRef = useRef(null);
  const cancelRef = useRef(null);
  const qrOpeningFocusRef = useRef(null);
  const pollTimerRef = useRef(null);
  const autoRefreshCountRef = useRef(0);
  const startedAtRef = useRef(0);
  const [qrContent, setQrContent] = useState("");
  const [qrStatus, setQrStatus] = useState("idle"); // idle | waiting | scanned | confirmed | expired | risk_blocked | error
  const [connection, setConnection] = useState(null);
  const [nickname, setNickname] = useState("");
  const [faceUrl, setFaceUrl] = useState("");
  const [folders, setFolders] = useState([]);
  const [folderVideos, setFolderVideos] = useState([]);
  const [folderTitle, setFolderTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [qrOpen, setQrOpen] = useState(false);

  const settledRef = useRef(false);
  const lifetimeRef = useRef(null);
  const actionRef = useRef(null);
  const loginRef = useRef(null);
  const connectionEpochRef = useRef(0);
  const videosRequestRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const beginAction = useCallback((kind) => {
    const lifetime = lifetimeRef.current;
    if (!lifetime?.active || actionRef.current) return null;
    const action = { kind, lifetime };
    actionRef.current = action;
    setBusy(true);
    return action;
  }, []);
  const ownsAction = useCallback((action) => actionRef.current === action && action.lifetime.active, []);
  const finishAction = useCallback((action) => {
    if (actionRef.current !== action) return;
    actionRef.current = null;
    if (action.lifetime.active) setBusy(false);
  }, []);
  const applyConnection = useCallback((next) => {
    settledRef.current = next?.connected === true;
    setConnection(settledRef.current ? next : null);
    setNickname(next?.nickname || "");
    setFaceUrl(next?.face_url || "");
  }, []);

  useEffect(() => {
    const lifetime = { active: true };
    lifetimeRef.current = lifetime;
    return () => {
      lifetime.active = false;
      loginRef.current = null;
      actionRef.current = null;
      videosRequestRef.current = null;
      stopPolling();
    };
  }, [stopPolling]);

  // 弹窗挂载后再绘制:修复第一次点击时画布还没渲染导致二维码空白的问题。
  useEffect(() => {
    if (!qrOpen || !qrContent) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    import("qrcode")
      .then(({ default: QRCode }) => QRCode.toCanvas(canvas, qrContent, {
        width: 220,
        margin: 1,
        errorCorrectionLevel: "M",
      }))
      .catch(() => {
        if (!cancelled) setError("二维码渲染失败，请点击“重新生成”再试。");
      });
    return () => { cancelled = true; };
  }, [qrOpen, qrContent]);

  useEffect(() => {
    let cancelled = false;
    const epoch = connectionEpochRef.current;
    getBilibiliQrStatus()
      .then((next) => {
        if (cancelled || connectionEpochRef.current !== epoch) return;
        applyConnection(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [applyConnection]);

  async function startLogin(automatic = false) {
    if (settledRef.current) return; // 已登录成功后不再重开二维码
    const action = beginAction("login");
    if (!action) return;
    if (!automatic && !qrOpen) qrOpeningFocusRef.current = { element: globalThis.document?.activeElement };
    if (!automatic) autoRefreshCountRef.current = 0;
    const login = { lifetime: action.lifetime, polling: false };
    loginRef.current = login;
    connectionEpochRef.current += 1;
    stopPolling();
    const current = () => login.lifetime.active && loginRef.current === login;
    const renew = (message) => {
      if (autoRefreshCountRef.current < 6) {
        autoRefreshCountRef.current += 1;
        setFeedback(message);
        void startLogin(true);
      } else {
        stopPolling();
        setQrStatus("expired");
        setFeedback("二维码多次过期，请手动点击“重新生成”。");
      }
    };
    setError("");
    if (!automatic) setFeedback("");
    try {
      const session = await beginBilibiliQrLogin();
      if (!current() || !ownsAction(action)) return;
      if (!session?.key || !session.qr_content) throw new Error("没有拿到登录二维码。");
      startedAtRef.current = Date.now();
      setQrStatus("waiting");
      setQrOpen(true);
      setQrContent(session.qr_content);
      const key = session.key;
      pollTimerRef.current = window.setInterval(() => {
        void (async () => {
          // 扫码时用户切到哔哩 App,WebView 被节流;回到前台后下个周期立即补查。
          if (!current() || document.hidden || login.polling) return;
          login.polling = true;
          try {
            const result = await checkBilibiliQrLogin(key);
            if (!current()) return;
            if (result?.status === "confirmed") {
              connectionEpochRef.current += 1;
              loginRef.current = null;
              stopPolling();
              setQrStatus("confirmed");
              setQrOpen(false);
              setQrContent("");
              const next = result.connection;
              applyConnection(next);
              setFeedback("扫码登录成功，可以读取你的收藏夹了。");
              return; // 已成功：不再执行下面的 75 秒换新逻辑
            } else if (result?.status === "scanned") {
              setQrStatus("scanned");
              setFeedback("已扫码，请在手机上点击确认登录。");
              return; // 已扫码待确认：不要换新二维码
            } else if (result?.status === "expired") {
              stopPolling();
              renew("二维码已过期，正在为你自动刷新…");
              return;
            } else if (result?.status === "risk_blocked") {
              stopPolling();
              setQrStatus("risk_blocked");
              setFeedback(result.message || "登录被哔哩哔哩风控拦截，请稍后再试。");
              return;
            } else if (result?.status === "waiting") {
              setQrStatus("waiting");
            }
            // 主动换新:哔哩二维码约2分钟失效,每75秒自动换一张。
            if (Date.now() - startedAtRef.current > 75_000) renew("已为你换上新鲜二维码,请扫当前这张。");
          } catch (caught) {
            if (!current()) return;
            if (caught?.code === "bilibili_qr_session_expired") {
              stopPolling();
              setQrStatus("expired");
            } else {
              setError(pickError(caught));
            }
          } finally { login.polling = false; }
        })();
      }, POLL_INTERVAL_MS);
    } catch (caught) {
      if (current() && ownsAction(action)) setError(pickError(caught));
    } finally {
      finishAction(action);
    }
  }

  const cancelLogin = useCallback(() => {
    loginRef.current = null;
    connectionEpochRef.current += 1;
    stopPolling();
    const action = actionRef.current;
    if (action?.kind === "login") finishAction(action);
    setQrOpen(false);
    setQrContent("");
    setQrStatus("idle");
    setFeedback("");
  }, [finishAction, stopPolling]);

  useLayoutEffect(() => {
    const doc = globalThis.document;
    const panel = qrPanelRef.current;
    if (!qrOpen || !doc?.body?.style || !panel) return undefined;
    const openingFocus = qrOpeningFocusRef.current;
    const previousFocus = openingFocus?.element?.isConnected ? openingFocus.element : doc.activeElement;
    const previousOverflow = doc.body.style.overflow;
    doc.body.style.overflow = "hidden";
    const candidates = () => [...panel.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter(node => node.tabIndex >= 0 && !node.disabled && node.getClientRects().length);
    (cancelRef.current || candidates()[0] || panel).focus();
    const keydown = event => {
      if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelLogin();
      } else if (event.key === "Tab") {
        const entries = candidates(), first = entries[0], last = entries.at(-1);
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (doc.activeElement === first || !panel.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (doc.activeElement === last || !panel.contains(doc.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    doc.addEventListener("keydown", keydown, true);
    return () => {
      doc.body.style.overflow = previousOverflow;
      doc.removeEventListener("keydown", keydown, true);
      if (previousFocus?.isConnected && (doc.activeElement === doc.body || panel.contains(doc.activeElement))) previousFocus.focus();
      if (qrOpeningFocusRef.current === openingFocus) qrOpeningFocusRef.current = null;
    };
  }, [cancelLogin, qrOpen]);

  // 内置浏览器登录：扫码不方便或二维码无反应时，用内置浏览器打开 B 站网页，
  // 登录一次后点"提取登录态"，Cookie 直接保存给 AI 使用。
  const connectWithBrowser = useCallback(async () => {
    const action = beginAction("browser");
    if (!action) return;
    connectionEpochRef.current += 1;
    loginRef.current = null;
    stopPolling();
    setError("");
    setFeedback("");
    try {
      const opened = await openBuiltInBrowser({
        url: "https://www.bilibili.com/",
        title: "哔哩哔哩（内置浏览器）",
        site: "bilibili",
      });
      if (!ownsAction(action)) return;
      // 用系统返回键关闭也会走到这里：只要在页面里点过「提取登录态」，
      // 登录态已经保存在本机，这里必须继续读取，不能因为返回方式而丢失。
      const saved = await readBrowserCookie("bilibili");
      if (!ownsAction(action)) return;
      if (!saved.cookie) {
        setError(
          opened.ok
            ? "没有提取到登录态。请重新打开，在页面里登录后点「提取登录态」，再返回。"
            : (opened.error || "无法打开内置浏览器。") +
                " 且没有提取到登录态，请重试。"
        );
        return;
      }
      const imported = await apiRequest("/api/v2/co-watch/bilibili-qr/cookie", {
        method: "POST",
        timeoutMs: 20000,
        body: JSON.stringify({ cookie: saved.cookie }),
      }).catch(() => null);
      if (!ownsAction(action)) return;
      if (imported?.connection?.connected === true || imported?.connected === true) {
        applyConnection(imported.connection || imported);
        setFeedback("内置浏览器登录成功，登录态已保存，可以读取收藏夹了。");
      } else {
        setError(imported?.message || "登录态已提取，但保存失败，请重试。");
      }
    } catch (caught) {
      if (ownsAction(action)) setError(pickError(caught));
    } finally {
      finishAction(action);
    }
  }, [applyConnection, beginAction, finishAction, ownsAction, stopPolling]);

  const logout = useCallback(async () => {
    const action = beginAction("logout");
    if (!action) return;
    connectionEpochRef.current += 1;
    loginRef.current = null;
    videosRequestRef.current = null;
    setVideoBusy("");
    stopPolling();
    setError("");
    try {
      await disconnectBilibiliQrLogin();
      if (!ownsAction(action)) return;
      applyConnection(null);
      setFolders([]);
      setFolderVideos([]);
      setFolderTitle("");
      setFeedback("已退出哔哩哔哩登录。");
    } catch (caught) {
      if (ownsAction(action)) setError(pickError(caught));
    } finally {
      finishAction(action);
    }
  }, [applyConnection, beginAction, finishAction, ownsAction, stopPolling]);

  const loadFolders = useCallback(async () => {
    if (!settledRef.current) return;
    const action = beginAction("folders");
    if (!action) return;
    const epoch = connectionEpochRef.current;
    setError("");
    try {
      const rows = await listBilibiliFavoriteFolders();
      if (!ownsAction(action) || connectionEpochRef.current !== epoch) return;
      setFolders(rows);
      setFeedback(rows.length ? `共读取到 ${rows.length} 个收藏夹。` : "没有读取到收藏夹。");
    } catch (caught) {
      if (ownsAction(action) && connectionEpochRef.current === epoch) setError(pickError(caught));
    } finally {
      finishAction(action);
    }
  }, [beginAction, finishAction, ownsAction]);

  const loadFolderVideos = useCallback(async (folder) => {
    const lifetime = lifetimeRef.current;
    if (!lifetime?.active || !settledRef.current || actionRef.current) return;
    const request = { lifetime, epoch: connectionEpochRef.current };
    videosRequestRef.current = request;
    const current = () => lifetime.active && videosRequestRef.current === request && connectionEpochRef.current === request.epoch && settledRef.current;
    setVideoBusy(folder.media_id);
    setError("");
    try {
      const rows = await listBilibiliFavoriteVideos(folder.media_id, 1);
      if (!current()) return;
      setFolderVideos(rows);
      setFolderTitle(folder.title);
      setFeedback(rows.length ? `“${folder.title}”前 20 个视频已载入。` : "这个收藏夹没有可读取的视频。");
    } catch (caught) {
      if (current()) setError(pickError(caught));
    } finally {
      if (videosRequestRef.current === request) {
        videosRequestRef.current = null;
        if (lifetime.active) setVideoBusy("");
      }
    }
  }, []);

  const qrStatusText = {
    idle: "点击“扫码登录”开始。",
    waiting: "请用手机哔哩哔哩 App 扫描二维码。",
    scanned: "已扫码，请在手机上点击确认登录。",
    confirmed: "登录成功。",
    expired: "二维码已过期，请重新生成。",
    risk_blocked: "登录被风控拦截，请稍后再试。",
    error: "登录失败，请重试。",
  }[qrStatus] || "";

  return <div className="bilibili-qr-login">
    <div className="music-provider-connect-body">
      {connection ? <div className="netease-qr-connected" role="status">
        {faceUrl ? <img className="bilibili-avatar" src={faceUrl} alt="" /> : <Smartphone aria-hidden="true" />}
        <span>已登录哔哩哔哩：<strong>{nickname || "哔哩用户"}</strong></span>
        <button type="button" disabled={busy} onClick={() => void loadFolders()}>读取收藏夹</button>
        <button type="button" disabled={busy} onClick={() => void logout()}>{busy ? "处理中…" : "退出登录"}</button>
      </div> : <div className="netease-qr-disconnected">
        <p>用手机哔哩哔哩 App 扫码登录后，DengTa 可以读取你的收藏夹，并把收藏的视频一键载入网页一起看。密码不会经过 DengTa，登录凭据加密保存在你的账号下。</p>
        <button type="button" className="together-primary" disabled={busy} onClick={() => void startLogin()}><LogIn aria-hidden="true" />{busy ? "正在生成…" : "扫码登录哔哩哔哩"}</button>
        <button type="button" disabled={busy} onClick={() => void connectWithBrowser()} title="用内置浏览器打开 B 站网页登录，登录后点页面上的「提取登录态」">
          内置浏览器登录（登录态长期有效）
        </button>
      </div>}
      {qrOpen && createPortal(<div className="netease-qr-modal bilibili-qr-modal" ref={qrPanelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="哔哩哔哩扫码登录" aria-busy={busy}>
        <div className="netease-qr-card bilibili-qr-card">
          <strong>用手机哔哩哔哩 App 扫码</strong>
          <canvas ref={canvasRef} aria-label="登录二维码" />
          <p>{qrStatusText}</p>
          <small className="netease-qr-hint">二维码过期后会自动刷新，无需手动操作。</small>
          <div className="netease-qr-actions">
            <button type="button" disabled={busy} onClick={() => void startLogin()}><RefreshCw aria-hidden="true" />重新生成</button>
            <button type="button" ref={cancelRef} onClick={cancelLogin}>取消</button>
          </div>
          <small className="netease-qr-hint">
            推荐:用你手机上的哔哩哔哩 App 扫上面的码,App 里点确认即完成(凭证自动回到灯塔)。
            不想扫码的话,点下面按钮,在打开的网页里直接用账号密码或验证码登录——登录成功后本页会自动完成绑定,无需跳转任何 App。
          </small>
          {qrContent && (
            <a
              className="netease-qr-fallback-button"
              href={qrContent}
              target="_blank"
              rel="noopener noreferrer"
            >
              🔗 改用网页账号密码登录
            </a>
          )}
        </div>
      </div>, document.body)}
      {folders.length > 0 && <div className="netease-qr-playlists">
        <strong>我的收藏夹（点击查看视频）</strong>
        <ul>{folders.map((folder) => <li key={folder.media_id}>
          <button type="button" disabled={busy || videoBusy === folder.media_id} onClick={() => void loadFolderVideos(folder)}>
            {folder.title} · {folder.media_count} 个
            {videoBusy === folder.media_id ? " 正在读取…" : ""}
          </button>
        </li>)}</ul>
      </div>}
      {folderVideos.length > 0 && <div className="netease-qr-playlists">
        <strong>{folderTitle || "收藏视频"}（点击载入一起看）</strong>
        <ul>{folderVideos.map((video) => <li key={video.bvid}>
          <button type="button" onClick={() => void onPickVideo(video.page_url, video.title)}>
            {video.title || video.bvid}
          </button>
        </li>)}</ul>
      </div>}
      {feedback && <p className="music-provider-feedback" role="status">{feedback}</p>}
      {error && <p className="music-provider-feedback music-provider-error" role="alert">{error}</p>}
    </div>
  </div>;
}
