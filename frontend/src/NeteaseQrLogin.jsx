import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogIn, RefreshCw, Smartphone } from "lucide-react";
import {
  beginNeteaseQrLogin,
  checkNeteaseQrLogin,
  disconnectNeteaseQrLogin,
  getNeteaseQrStatus,
  importNeteaseQrPlaylist,
  listNeteaseQrPlaylists,
} from "./netease-qr-login.js";

const POLL_INTERVAL_MS = 4_000; // 降低轮询频率,避免触发网易云频率风控

function pickError(caught) {
  return caught?.message || "网易云扫码登录暂时失败。";
}

export default function NeteaseQrLogin({ onImported = () => {} }) {
  const canvasRef = useRef(null);
  const pollTimerRef = useRef(null);
  const startedAtRef = useRef(0);
  const autoRefreshCountRef = useRef(0);
  const [qrContent, setQrContent] = useState("");
  const [qrStatus, setQrStatus] = useState("idle"); // idle | waiting | scanned | confirmed | expired | risk_blocked | error
  const [connection, setConnection] = useState(null);
  const [nickname, setNickname] = useState("");
  const [uid, setUid] = useState("");
  const [remotePlaylists, setRemotePlaylists] = useState([]);
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [deviceLine, setDeviceLine] = useState("");
  const [lastPollLine, setLastPollLine] = useState("");

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getNeteaseQrStatus();
      setConnection(next?.connected === true ? next : null);
      setNickname(next?.nickname || "");
      setUid(next?.uid || "");
      return next;
    } catch {
      return { connected: false };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getNeteaseQrStatus()
      .then((next) => {
        if (cancelled) return;
        setConnection(next?.connected === true ? next : null);
        setNickname(next?.nickname || "");
        setUid(next?.uid || "");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
      .catch((caught) => {
        if (cancelled) return;
        setError("二维码渲染失败，请点击“重新生成”再试。" + (caught?.message ? `（${caught.message}）` : ""));
      });
    return () => { cancelled = true; };
  }, [qrOpen, qrContent]);

  async function startLogin() {
    autoRefreshCountRef.current = 0;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const session = await beginNeteaseQrLogin();
      if (!session?.key || !session.qr_content) throw new Error("没有拿到登录二维码。");
      startedAtRef.current = Date.now();
      setQrStatus("waiting");
      setQrOpen(true);
      setDeviceLine(
        session.device_used === true
          ? "✅ 已上报本机真实设备信息"
          : "⚠️ 未上报设备信息(网页版无设备,或 App 版本过旧)"
      );
      setLastPollLine("正在等待服务器响应…");
      setQrContent(session.qr_content);
      stopPolling();
      pollTimerRef.current = window.setInterval(() => {
        void (async () => {
          if (!session.key) return;
          // 扫码时用户会切到网易云 App,WebView 被系统节流;回到前台立刻补查一次。
          if (document.hidden) return;

          try {
            const result = await checkNeteaseQrLogin(session.key);
            const statusNames = {
              waiting: "等待扫码",
              scanned: "已扫码待确认",
              confirmed: "登录成功",
              expired: "已过期",
              risk_blocked: "被风控拦截",
            };
            setLastPollLine(
              "服务器最近返回:" +
                (statusNames[result?.status] || result?.status || "未知") +
                (result?.raw_code !== undefined
                  ? " (code " + result.raw_code + ")"
                  : "") +
                (result?.message ? " " + result.message : "")
            );
            if (result?.status === "confirmed") {
              stopPolling();
              setQrStatus("confirmed");
              setQrOpen(false);
              setQrContent("");
              const next = result.connection || (await refreshStatus());
              setConnection(next?.connected === true ? next : null);
              setNickname(next?.nickname || "");
              setUid(next?.uid || "");
              setFeedback("扫码登录成功，现在可以直接导入你的网易云歌单。");
            } else if (result?.status === "scanned") {
              setQrStatus("scanned");
              setFeedback("已扫码，请在手机上确认登录。");
            } else if (result?.status === "expired") {
              stopPolling();
              if (autoRefreshCountRef.current < 6) {
                autoRefreshCountRef.current += 1;
                setFeedback("二维码已过期，正在为你自动刷新…");
                void startLogin();
              } else {
                setQrStatus("expired");
                setFeedback("二维码多次过期，请手动点击“重新生成”。");
              }
            }
            // 主动换新:网易云二维码约3分钟失效,每90秒自动换一张,保证扫到的永远新鲜。
            if (Date.now() - startedAtRef.current > 90_000 && autoRefreshCountRef.current < 6) {
              autoRefreshCountRef.current += 1;
              setFeedback("已为你换上新鲜二维码,请扫当前这张。");
              void startLogin();
            } else if (result?.status === "risk_blocked") {
              stopPolling();
              setQrStatus("risk_blocked");
              setFeedback(
                (result.message || "登录被网易云风控拦截。") +
                  " 大概率是短时间尝试过频,请等 2-5 分钟后再点一次。"
              );
            } else if (result?.status === "waiting") {
              setQrStatus("waiting");
            }
          } catch (caught) {
            if (caught?.code === "netease_qr_session_expired") {
              stopPolling();
              setQrStatus("expired");
            } else {
              setError(pickError(caught));
            }
          }
        })();
      }, POLL_INTERVAL_MS);
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setBusy(false);
    }
  }

  const cancelLogin = useCallback(() => {
    stopPolling();
    setQrOpen(false);
    setQrContent("");
    setQrStatus("idle");
    setFeedback("");
  }, [stopPolling]);

  const logout = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await disconnectNeteaseQrLogin();
      setConnection(null);
      setNickname("");
      setUid("");
      setRemotePlaylists([]);
      setFeedback("已退出网易云登录。");
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadRemotePlaylists = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const rows = await listNeteaseQrPlaylists();
      setRemotePlaylists(rows);
      setFeedback(rows.length ? `共读取到 ${rows.length} 个歌单。` : "没有读取到歌单。");
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const importPlaylist = useCallback(async (row) => {
    if (importBusy) return;
    setImportBusy(row.provider_playlist_id);
    setError("");
    try {
      const result = await importNeteaseQrPlaylist(row.provider_playlist_id);
      setFeedback(
        `已导入“${result.name || row.name}”：${result.total} 首，其中 ${result.playable_count} 首可直接一起听，${result.unavailable_count} 首需要会员或版权受限。`,
      );
      await onImported?.(result);
    } catch (caught) {
      setError(pickError(caught));
    } finally {
      setImportBusy("");
    }
  }, [importBusy, onImported]);

  const qrStatusText = {
    idle: "点击“扫码登录”开始。",
    waiting: "请用手机网易云音乐 App 扫描二维码。",
    scanned: "已扫码，请在手机上点击确认登录。",
    confirmed: "登录成功。",
    expired: "二维码已过期，请重新生成。",
    risk_blocked: "登录被风控拦截，请稍后再试。",
    error: "登录失败，请重试。",
  }[qrStatus] || "";

  return <div className="netease-qr-login">
    <div className="music-provider-connect-body">
      {connection ? <div className="netease-qr-connected" role="status">
        <Smartphone aria-hidden="true" />
        <span>已登录网易云：<strong>{nickname || "网易云用户"}</strong>{uid ? `（ID ${uid}）` : ""}</span>
        <button type="button" disabled={busy} onClick={() => void loadRemotePlaylists()}>读取我的歌单</button>
        <button type="button" disabled={busy} onClick={() => void logout()}>{busy ? "处理中…" : "退出登录"}</button>
      </div> : <div className="netease-qr-disconnected">
        <p>不需要自己搭 MCP：用手机网易云音乐 App 扫码登录后，DengTa 只读取你的歌单并解析可播放直链。密码不会经过 DengTa，登录凭据加密保存在你的账号下。</p>
        <button type="button" className="together-primary" disabled={busy} onClick={() => void startLogin()}><LogIn aria-hidden="true" />{busy ? "正在生成…" : "扫码登录网易云"}</button>
      </div>}
      {qrOpen && createPortal(<div className="netease-qr-modal" role="dialog" aria-label="网易云扫码登录">
        <div className="netease-qr-card">
          <strong>用手机网易云音乐 App 扫码</strong>
          <canvas ref={canvasRef} aria-label="登录二维码" />
          <p>{qrStatusText}</p>
          <p className="netease-qr-diag">{deviceLine}</p>
          <p className="netease-qr-diag">{lastPollLine}</p>
          <small className="netease-qr-hint">二维码过期后会自动刷新，无需手动操作。</small>
          <div className="netease-qr-actions">
            <button type="button" disabled={busy} onClick={() => void startLogin()}><RefreshCw aria-hidden="true" />重新生成</button>
            <button type="button" onClick={cancelLogin}>取消</button>
          </div>
          <small className="netease-qr-hint">
            推荐:用你手机上的网易云 App 扫上面的码,App 里点确认即完成(凭证自动回到灯塔)。
            不想扫码的话,点下面按钮,在打开的网页里直接用账号密码或验证码登录——登录成功后本页会自动完成绑定,无需跳转任何 App。
          </small>
          {qrContent && (
            <a
              className="netease-qr-fallback-button"
              href={qrContent.replace(/^http:/, "https:")}
              target="_blank"
              rel="noopener noreferrer"
            >
              🔗 改用网页账号密码登录
            </a>
          )}
        </div>
      </div>, document.body)}
      {remotePlaylists.length > 0 && <div className="netease-qr-playlists">
        <strong>我的网易云歌单（点击导入）</strong>
        <ul>{remotePlaylists.map((row) => <li key={row.provider_playlist_id}>
          <button type="button" disabled={importBusy === row.provider_playlist_id} onClick={() => void importPlaylist(row)}>
            {row.name} · {row.item_count} 首
            {row.creator_nickname ? `（${row.creator_nickname}）` : ""}
            {importBusy === row.provider_playlist_id ? " 正在解析直链…" : ""}
          </button>
        </li>)}</ul>
      </div>}
      {feedback && <p className="music-provider-feedback" role="status">{feedback}</p>}
      {error && <p className="music-provider-feedback music-provider-error" role="alert">{error}</p>}
    </div>
  </div>;
}
