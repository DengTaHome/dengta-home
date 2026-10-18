import { useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { openTakeoutLogin, readTakeoutLoginState, takeoutLoginFailure, takeoutPluginAvailable } from "./takeout-executor.js";
import { recordOperationFailure } from "./operation-diagnostics.js";
import "./takeout-login.css";

function removeListener(handle) {
  try { void Promise.resolve(handle?.remove()).catch(() => {}); } catch { /* The native bridge may already be gone. */ }
}

export default function TakeoutLoginPanel(props) {
  return <ScopedTakeoutLoginPanel key={props.scope} {...props} />;
}

function ScopedTakeoutLoginPanel({ scope, feedback, available = takeoutPluginAvailable(), readLogin = readTakeoutLoginState, openLogin = openTakeoutLogin, appEvents = CapacitorApp }) {
  const [state, setState] = useState(null), [opening, setOpening] = useState(null), [notice, setNotice] = useState(null);
  const lifecycle = useRef(null), openingRequest = useRef(null);
  useEffect(() => {
    const owner = { active: true, scope, pending: null };
    lifecycle.current = owner;
    const current = () => owner.active && lifecycle.current === owner;
    const check = () => {
      if (!current() || !scope || !available) return Promise.resolve(null);
      if (owner.pending) return owner.pending;
      setState({ scope, status: "checking" });
      owner.pending = Promise.resolve().then(() => current() ? readLogin() : null)
        .catch(() => takeoutLoginFailure()).then(result => {
          if (!current() || !result) return null;
          setState({ ...result, scope });
          if (result.status === "error") recordOperationFailure(scope, "/api/v2/takeout/login", result);
          return result;
        }).finally(() => { owner.pending = null; });
      return owner.pending;
    };
    owner.check = check;
    const resume = () => { if (document.visibilityState !== "hidden") void check(); };
    if (scope && available) {
      void check();
      window.addEventListener("focus", resume);
      document.addEventListener("visibilitychange", resume);
    }
    let nativeListener;
    if (scope && available) void Promise.resolve().then(() => current() ? appEvents.addListener("appStateChange", event => { if (event.isActive) resume(); }) : null)
      .then(handle => { if (current()) nativeListener = handle; else removeListener(handle); }).catch(() => {});
    return () => {
      owner.active = false;
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
      removeListener(nativeListener);
    };
  }, [scope, available, readLogin, appEvents]);

  async function openPlatform() {
    const owner = lifecycle.current;
    if (!owner?.active || owner.scope !== scope || !available || !scope || openingRequest.current?.owner === owner) return;
    const request = { owner };
    openingRequest.current = request;
    setOpening(scope);
    setNotice({ scope, status: "busy", message: "正在打开外卖平台页面…", feedbackAtOpen: feedback });
    try {
      const result = await openLogin();
      if (!owner.active || lifecycle.current !== owner) return;
      if (result?.ok) {
        setNotice({ scope, status: "success", message: "已返回灯塔，正在重新检测本机登录凭据；平台登录是否有效仍以网页为准。", feedbackAtOpen: feedback });
      } else {
        const failure = takeoutLoginFailure(result?.code || "takeout_login_open_failed");
        setNotice({ ...failure, scope, feedbackAtOpen: feedback });
        recordOperationFailure(scope, "/api/v2/takeout/login", failure);
      }
      void owner.check();
    } catch {
      if (owner.active && lifecycle.current === owner) {
        const failure = takeoutLoginFailure("takeout_login_open_failed");
        setNotice({ ...failure, scope, feedbackAtOpen: feedback });
        recordOperationFailure(scope, "/api/v2/takeout/login", failure);
      }
    } finally {
      if (openingRequest.current === request) openingRequest.current = null;
      if (owner.active && lifecycle.current === owner) setOpening(null);
    }
  }

  const visible = state?.scope === scope ? state : null;
  const isOpening = Boolean(scope && opening === scope);
  const status = !available ? "unavailable" : !scope ? "idle" : visible?.status || "checking";
  const badge = status === "checking" ? "正在检测本机凭据…" : status === "error" ? "检测未完成" : status === "unavailable" ? "仅 Android App 可用" : status === "idle" ? "请先选择当前账号和伴侣" : visible?.loggedIn ? "检测到本机登录 Cookie" : visible?.hasCookie ? "有 Cookie，登录状态待确认" : "未检测到本机登录凭据";
  const localNotice = notice?.scope === scope && notice.feedbackAtOpen === feedback ? notice : null;
  const operationFeedback = feedback?.scope === scope ? feedback : null;
  const displayed = status === "error" ? visible : localNotice || operationFeedback;
  return <div className="notification-feature-panel device-activity-panel takeout-login-panel">
    <div className="device-activity-heading"><div><strong>登录外卖平台</strong><span>{available ? "Android · 本机执行" : "仅 Android App 可用"}</span></div>
      <div className="device-activity-actions"><em className={`takeout-login-state${status === "ready" && visible?.loggedIn ? " is-logged-in" : ""}`} role="status" aria-live="polite">{badge}</em></div></div>
    <p>登录后，AI 可以在聊天里帮你找吃的（例如“帮我找家附近的烧烤，预算 30”）。平台登录态只保存在本机 WebView，不会上传服务器。</p>
    {displayed?.message && <p className={`notification-feature-feedback ${displayed.status}`} role="status" aria-live="polite">{displayed.message}{displayed.code ? `（代码：${displayed.code}）` : ""}</p>}
    <div className="device-activity-actions">
      <button type="button" disabled={!available || !scope || isOpening} onClick={() => void openPlatform()}>{isOpening ? "等待平台页面返回…" : "扫码登录外卖"}</button>
      {available && scope && <button type="button" disabled={status === "checking"} onClick={() => void lifecycle.current?.check()}>{status === "checking" ? "检测中…" : "重新检测"}</button>}
    </div>
    <small>{available ? "本机 Cookie 仅用于初步检测；平台可能要求重新登录或验证。AI 只在你主动要求点单时派发命令。" : "外卖扫码登录与点单由手机本地执行，仅 Android App 可用；网页版请使用聊天里的其它玩法。"}</small>
  </div>;
}
