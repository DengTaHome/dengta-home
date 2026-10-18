import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api.js";
import { browserLauncherAvailable, openBuiltInBrowser, readBrowserCookie } from "./browser-launcher.js";
import { logoutXhs, readXhsLoginStatus, readXhsMe, startXhsLogin } from "./xhs-login.js";
import { recordOperationFailure } from "./operation-diagnostics.js";
import "./xhs-login.css";

const MESSAGES = {
  xhs_service_unconfigured: "小红书服务尚未配置，暂时无法检测或搜索。",
  xhs_session_isolation_required: "小红书服务需要更新以支持独立账号会话，未使用共享登录态。",
  xhs_service_access_denied: "小红书服务连接未获授权，请联系维护者检查服务配置。",
  xhs_profile_busy: "独立浏览器暂时繁忙，请稍后重新检测。",
  xhs_browser_unavailable: "当前账号的独立浏览器暂时无法打开，请重试。",
  xhs_profile_storage_failed: "加密会话读写失败，原有资料未自动删除，请重试。",
  xhs_storage_read_failed: "登录资料读取失败，请重新检测。",
  xhs_storage_write_failed: "登录资料保存失败，请重新导入。",
  xhs_storage_receipt_invalid: "未收到保存确认，请重新检测，暂勿重复导入。",
  xhs_encryption_unconfigured: "服务尚未配置凭据加密，暂时不能保存登录态。",
  xhs_credentials_unavailable: "登录资料无法解密，请重新导入。",
  xhs_cookie_invalid: "登录资料格式无效，请重新提取。",
  xhs_cookie_missing: "没有提取到登录态，请在网页登录后点「提取登录态」再返回。",
  xhs_browser_required: "内置浏览器登录仅 Android App 可用，网页端可使用扫码登录。",
  xhs_login_open_failed: "内置浏览器未能打开，请重试。",
  cookie_expired: "小红书尚未登录或登录已过期，请重新登录。",
  verification_required: "小红书需要人工验证，请在自己的小红书页面完成验证后重试。",
  xhs_page_changed: "小红书页面结构变化，暂时无法确认结果，请重新检测或联系维护者。",
  xhs_qr_expired: "二维码已过期，请重新扫码登录。",
  xhs_response_invalid: "没有收到有效的登录状态，请重新检测。",
  xhs_timeout: "等待小红书响应超时，请重试。",
  request_timeout: "连接小红书服务超时，请重试。",
  xhs_unreachable: "小红书页面暂时无法访问，请检查网络后重试。",
  xhs_upstream_error: "小红书平台暂时无法完成操作，请稍后重试。",
};
function xhsFeedback(error) {
  const code = Object.hasOwn(MESSAGES, error?.code) ? error.code : "xhs_response_invalid";
  return { code, status: error?.status, message: `${MESSAGES[code]}（代码：${code}）` };
}
const fail = code => Object.assign(new Error("XHS operation failed"), { code });
const defaults = { me: readXhsMe, start: startXhsLogin, poll: readXhsLoginStatus, logout: logoutXhs,
  open: openBuiltInBrowser, cookie: readBrowserCookie, import: cookie => apiRequest("/api/v2/xhs/login/cookie", { method: "POST", timeoutMs: 20_000, body: JSON.stringify({ cookie }) }) };

export default function XhsLoginPanel(props) {
  return <ScopedXhsLoginPanel key={props.scope} {...props} />;
}
function ScopedXhsLoginPanel({ scope, operations = defaults, nativeAvailable = browserLauncherAvailable(), pollMs = 3000, qrTtlMs = 180000 }) {
  const [state, setState] = useState({ status: "idle", feedback: "", qr: "" });
  const lifecycle = useRef(null);
  useEffect(() => {
    const owner = { active: true, locked: false, version: 0, timer: null };
    lifecycle.current = owner;
    return () => { owner.active = false; clearTimeout(owner.timer); };
  }, [scope, operations]);
  const current = (owner, version) => owner?.active && lifecycle.current === owner && owner.version === version;
  async function run(action) {
    const owner = lifecycle.current;
    if (!scope || !owner?.active || owner.locked) return;
    owner.locked = true; const version = ++owner.version; clearTimeout(owner.timer);
    const valid = () => current(owner, version);
    setState({ status: "busy", qr: "", feedback: "正在处理当前账号的小红书连接…" });
    const report = error => {
      if (!valid()) return;
      const feedback = xhsFeedback(error);
      setState({ status: "error", qr: "", feedback: feedback.message });
      recordOperationFailure(scope, "/api/v2/xhs", feedback);
    };
    const check = async () => {
      const receipt = await operations.me();
      if (!valid()) return;
      if (!receipt?.me || !String(receipt.me.user_id || receipt.me.id || "").trim()) throw fail("xhs_response_invalid");
      setState({ status: "logged_in", qr: "", feedback: "当前账号与伴侣的小红书登录已验证。" });
    };
    try {
      if (action === "logout") {
        const receipt = await operations.logout();
        if (receipt?.ok !== true) throw fail("xhs_response_invalid");
        if (valid()) setState({ status: "idle", qr: "", feedback: "已退出当前账号与伴侣的小红书登录。" });
      } else if (action === "browser") {
        if (!nativeAvailable) throw fail("xhs_browser_required");
        const opened = await operations.open({ url: "https://www.xiaohongshu.com/", title: "小红书", site: "xhs" });
        if (!valid()) return;
        if (!opened?.ok) throw fail("xhs_login_open_failed");
        const saved = await operations.cookie("xhs");
        if (!valid()) return;
        if (!saved?.cookie) throw fail("xhs_cookie_missing");
        const receipt = await operations.import(saved.cookie);
        if (!valid()) return;
        if (receipt?.ok !== true) throw fail("xhs_response_invalid");
        if (receipt.mode === "local") setState({ status: "saved", qr: "", feedback: "登录资料已加密保存；独立服务尚未就绪，登录有效性与搜索仍待验证。" });
        else await check();
      } else if (action === "qr") {
        const receipt = await operations.start();
        if (!valid()) return;
        if (receipt?.login?.status === "done") { await check(); return; }
        const { session, qr } = receipt?.login || {};
        if (typeof session !== "string" || !/^[a-f0-9-]{36}$/i.test(session) || typeof qr !== "string" || qr.length > 900000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(qr)) throw fail("xhs_response_invalid");
        const expires = Date.now() + qrTtlMs;
        setState({ status: "pending", qr, feedback: "请用小红书 App 扫码并确认登录，可随时取消。" });
        let failures = 0;
        const poll = async () => {
          if (!valid()) return;
          if (Date.now() >= expires) { report(fail("xhs_qr_expired")); return; }
          try {
            const result = await operations.poll(session);
            if (!valid()) return;
            const status = result?.status?.status;
            if (status === "done") { await check(); return; }
            if (status === "expired") { report(fail("xhs_qr_expired")); return; }
            if (status !== "pending") throw fail("xhs_response_invalid");
            failures = 0;
          } catch (error) {
            if (!valid()) return;
            if (++failures >= 3 || !["request_timeout", "xhs_timeout", "xhs_unreachable"].includes(error?.code)) { report(error); return; }
            setState(previous => ({ ...previous, feedback: "网络暂未响应，正在重新检测扫码结果…" }));
          }
          if (valid()) owner.timer = setTimeout(poll, pollMs);
        };
        owner.timer = setTimeout(poll, pollMs);
      } else await check();
    } catch (error) { report(error); }
    finally { if (valid()) owner.locked = false; }
  }
  function cancel() {
    const owner = lifecycle.current;
    if (owner) { owner.version++; owner.locked = false; clearTimeout(owner.timer); }
    setState({ status: "idle", qr: "", feedback: "已取消扫码；已有的登录态不受影响。" });
  }
  const busy = state.status === "busy", pending = state.status === "pending";
  return <section className="notification-feature-panel device-activity-panel xhs-login-panel" aria-label="小红书连接">
    <div className="device-activity-heading"><div><strong>小红书</strong><span>{state.status === "logged_in" ? "当前账号登录已验证" : state.status === "saved" ? "资料已保存，待验证" : "按当前账号与伴侣独立连接"}</span></div></div>
    <p>连接自己的小红书后可搜索笔记。网页验证、服务连接和登录过期会分别提示；点赞、评论和关注仍需要你确认。</p>
    <div className="device-activity-actions">
      <button type="button" disabled={!scope || busy || pending || !nativeAvailable} onClick={() => void run("browser")}>内置浏览器登录</button>
      <button type="button" disabled={!scope || busy || pending} onClick={() => void run("qr")}>扫码登录</button>
      <button type="button" disabled={!scope || busy || pending} onClick={() => void run("check")}>重新检测</button>
      <button type="button" disabled={!scope || busy || pending} onClick={() => void run("logout")}>退出登录</button>
      {pending && <button type="button" onClick={cancel}>取消扫码</button>}
    </div>
    {state.feedback && <p className={`notification-feature-feedback ${state.status === "error" ? "error" : "busy"}`} role="status">{state.feedback}</p>}
    {state.qr && <div className="xhs-qr-wrap"><img src={state.qr} alt="当前账号小红书登录二维码" /><small>小红书 App → 扫一扫 → 确认登录</small></div>}
    <small>可重新检测连接；保存登录资料不代表已通过平台登录验证。</small>
  </section>;
}
