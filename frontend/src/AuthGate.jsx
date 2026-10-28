import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { AUTH_STATUS, authSession } from "./auth-session.js";
import { startBackgroundNotificationIdentitySync } from "./background-notification-identity.js";
import { resolveEmailRedirectUrl } from "./auth-redirect.js";
import WebInstallButton from "./WebInstallButton.jsx";
import { flushSettingsBeforeAccountExit, releaseSettingsAccountExit, settingsSaveScope } from "./settings-save-scope.js";

function browserEmailRedirectUrl() {
  return resolveEmailRedirectUrl({
    nativePlatform: Capacitor.isNativePlatform(),
    location: globalThis.location,
  });
}

function ConfigurationScreen() {
  return (
    <main className="auth-page auth-configuration-page">
      <section className="auth-message-panel" role="alert">
        <img
          src="/app-icon-192.png"
          alt="DengTa"
        />
        <span className="auth-kicker">登录服务尚未接通</span>
        <h1>DengTa Home 暂时不能进入</h1>
        <p>
          当前构建缺少 Supabase 的公开登录配置。请先在部署平台配置下面两个环境变量，再重新构建前端。
        </p>
        <dl className="auth-config-list">
          <div>
            <dt>项目地址</dt>
            <dd>
              <code>VITE_SUPABASE_URL</code>
            </dd>
          </div>
          <div>
            <dt>公开密钥</dt>
            <dd>
              <code>VITE_SUPABASE_ANON_KEY</code>
            </dd>
          </div>
        </dl>
        <p className="auth-security-note">
          这里只能使用 Supabase 的 publishable/anon key，不能填写 service role
          密钥。配置值不会显示在这个页面中。
        </p>
      </section>
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="auth-page auth-loading-page" aria-busy="true">
      <div className="auth-loading-mark" aria-hidden="true">
        灯
      </div>
      <strong>正在找回你的家</strong>
      <span>恢复登录与伴侣空间...</span>
    </main>
  );
}

function PasswordInput({
  name,
  value,
  onChange,
  autoComplete,
  minLength,
  placeholder,
}) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="auth-password-field">
      <input
        required
        type={visible ? "text" : "password"}
        name={name}
        minLength={minLength}
        autoComplete={autoComplete}
        enterKeyHint="go"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
      <button
        type="button"
        className="auth-password-toggle"
        aria-label={visible ? "隐藏密码" : "显示密码"}
        aria-pressed={visible}
        title={visible ? "隐藏密码" : "显示密码"}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? "隐藏" : "显示"}
      </button>
    </span>
  );
}

export function AuthScreen({
  sessionManager,
  initialMessage = "",
  initialMode = "login",
}) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState(initialMessage);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationLink, setVerificationLink] = useState("");

  function changeMode(nextMode, preserveEmail) {
    setMode(nextMode);
    setPassword("");
    setPasswordConfirmation("");
    setFeedback("");
    setVerificationEmail("");
    setVerificationLink("");
    if (preserveEmail) setEmail(preserveEmail);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(mode);
    setFeedback("");
    try {
      if (mode === "forgot") {
        await sessionManager.requestPasswordReset({
          email,
          redirectTo: browserEmailRedirectUrl(),
        });
        setFeedback(
          "如果这个邮箱已经注册，重置链接会发送到邮箱。请检查收件箱和垃圾邮件。",
        );
      } else if (mode === "reset") {
        if (password.length < 8) {
          throw new Error("新密码至少需要 8 个字符。");
        }
        if (password !== passwordConfirmation) {
          throw new Error("两次输入的新密码不一致。");
        }
        await sessionManager.updatePassword({ password });
      } else if (mode === "register") {
        const result = await sessionManager.signUp({
          email,
          password,
          displayName,
          emailRedirectTo: browserEmailRedirectUrl(),
        });
        if (result.emailVerificationRequired) {
          setVerificationEmail(email.trim().toLowerCase());
          setPassword("");
          setFeedback("验证邮件已经发出。完成邮箱验证后，请回到这里登录。");
        }
      } else {
        await sessionManager.signIn({ email, password });
      }
    } catch (error) {
      setFeedback(error?.message || "账号操作失败，请稍后再试。");
    } finally {
      setBusy("");
    }
  }

  async function resendVerification() {
    if (!verificationEmail) return;
    setBusy("resend");
    setFeedback("");
    try {
      await sessionManager.resendVerification({
        email: verificationEmail,
        emailRedirectTo: browserEmailRedirectUrl(),
      });
      setFeedback("新的验证邮件已经发出，请检查收件箱和垃圾邮件。");
    } catch (error) {
      setFeedback(error?.message || "验证邮件发送失败，请稍后再试。");
    } finally {
      setBusy("");
    }
  }

  async function verifyLink(event) {
    event.preventDefault();
    setBusy("verify-link");
    setFeedback("");
    try {
      await sessionManager.verifyRegistrationLink(verificationLink);
    } catch (error) {
      setFeedback(error?.message || "邮箱验证失败，请重新发送验证邮件并使用最新链接。");
    } finally {
      setVerificationLink("");
      setBusy("");
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-scene" aria-hidden="true">
        <div className="auth-scene-copy">
          <span>DengTa Home</span>
          <strong>每个人，都有一盏只为自己亮着的灯。</strong>
        </div>
      </div>

      <section className="auth-panel" aria-label="DengTa Home 账号">
        <div className="auth-brand">
          <img
            src="/app-icon-192.png"
            alt=""
          />
          <div>
            <span className="auth-kicker">DengTa Home</span>
          <h1>
            {mode === "login"
              ? "欢迎回来"
              : mode === "register"
                ? "给伴侣一个家"
                : mode === "forgot"
                  ? "找回回家的钥匙"
                  : "设置新的密码"}
          </h1>
          </div>
        </div>

        {mode !== "reset" && (
          <div
            className="auth-mode-switch"
            role="tablist"
            aria-label="账号操作"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? "active" : ""}
              onClick={() => changeMode("login", email)}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              className={mode === "register" ? "active" : ""}
              onClick={() => changeMode("register")}
            >
              注册
            </button>
          </div>
        )}

        {verificationEmail ? (
          <div className="auth-verification" role="status">
            <span className="auth-mail-mark" aria-hidden="true">
              ✓
            </span>
            <h2>去邮箱确认一下</h2>
            <p>
              验证邮箱：<strong>{verificationEmail}</strong>。
              打开最新的验证邮件；验证完成后可用注册时的密码登录。
            </p>
            {feedback && <p className="auth-feedback">{feedback}</p>}
            <button
              type="button"
              className="auth-primary-button"
              disabled={Boolean(busy)}
              onClick={resendVerification}
            >
              {busy === "resend" ? "正在发送..." : "重新发送验证邮件"}
            </button>
            <button
              type="button"
              className="auth-text-button"
              onClick={() => changeMode("login", email)}
            >
              返回登录
            </button>
            <details>
              <summary>邮件链接打不开？在这里验证</summary>
              <p>在最新验证邮件里长按“Confirm email address”，复制链接并粘贴到下面。链接只发送给灯塔当前认证服务验证，不需要在邮件浏览器中跳转。不要把链接发给其他人。</p>
              <form className="auth-form" onSubmit={verifyLink}>
                <label>
                  <span>注册验证链接</span>
                  <input required type="password" autoComplete="off" spellCheck={false}
                    value={verificationLink} onChange={(event) => setVerificationLink(event.target.value)}
                    placeholder="粘贴邮件中确认按钮的原始链接" />
                </label>
                <button className="auth-primary-button" disabled={Boolean(busy)}>
                  {busy === "verify-link" ? "正在验证..." : "验证邮箱并进入灯塔"}
                </button>
              </form>
            </details>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            {mode === "register" && (
              <label>
                <span>怎么称呼你</span>
                <input
                  name="display-name"
                  enterKeyHint="next"
                  type="text"
                  autoComplete="name"
                  maxLength="80"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="你的名字或昵称"
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                <span>邮箱</span>
                <input
                  required
                  name="email"
                  enterKeyHint="next"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoComplete={mode === "login" ? "username" : "email"}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                />
              </label>
            )}
            {mode !== "forgot" && (
              <label>
                <span>{mode === "reset" ? "新密码" : "密码"}</span>
                <PasswordInput
                  name={mode === "login" ? "password" : "new-password"}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={
                    ["register", "reset"].includes(mode) ? 8 : undefined
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={
                    mode === "login" ? "输入密码" : "至少 8 个字符"
                  }
                />
              </label>
            )}
            {mode === "reset" && (
              <label>
                <span>再次输入新密码</span>
                <PasswordInput
                  name="confirm-password"
                  autoComplete="new-password"
                  minLength={8}
                  value={passwordConfirmation}
                  onChange={(event) =>
                    setPasswordConfirmation(event.target.value)
                  }
                  placeholder="再输入一次新密码"
                />
              </label>
            )}

            {feedback && (
              <p className="auth-feedback" role="alert">
                {feedback}
              </p>
            )}

            <button
              className="auth-primary-button"
              disabled={Boolean(busy)}
            >
              {busy
                ? mode === "login"
                  ? "正在登录..."
                  : mode === "register"
                    ? "正在创建..."
                    : mode === "forgot"
                      ? "正在发送..."
                      : "正在保存..."
                : mode === "login"
                  ? "回到我的伴侣身边"
                  : mode === "register"
                    ? "创建我的空间"
                    : mode === "forgot"
                      ? "发送重置邮件"
                      : "保存新密码"}
            </button>
            {mode === "login" && (
              <button
                type="button"
                className="auth-text-button"
                disabled={Boolean(busy)}
                onClick={(event) => {
                  if (!event.currentTarget.form?.querySelector('input[type="email"]')?.reportValidity()) return;
                  setVerificationEmail(email.trim().toLowerCase());
                  setFeedback("邮箱尚未验证时，在此重新发送验证邮件；已经验证的账号可直接返回登录。");
                }}
              >
                没收到验证邮件／验证链接失效？
              </button>
            )}
            {mode === "login" && (
              <button
                type="button"
                className="auth-text-button"
                onClick={() => changeMode("forgot")}
              >
                忘记密码
              </button>
            )}
            {mode === "forgot" && (
              <button
                type="button"
                className="auth-text-button"
                onClick={() => changeMode("login", email)}
              >
                返回登录
              </button>
            )}
          </form>
        )}

        <p className="auth-footnote">
          登录状态只保存在当前设备；退出账号后，其他用户无法通过本设备读取你的私人空间。
        </p>
        {!Capacitor.isNativePlatform() && <WebInstallButton />}
      </section>
    </main>
  );
}

export function AccountMenu({ sessionManager, snapshot }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const rootRef = useRef(null);
  const alive = useRef(false);
  const exiting = useRef(false);
  const email = snapshot.user?.email || "已登录";
  const initial = email.slice(0, 1).toUpperCase();

  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function closeWhenOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeWhenOutside);
    return () => document.removeEventListener("pointerdown", closeWhenOutside);
  }, [open]);

  async function signOut() {
    if (exiting.current) return;
    exiting.current = true;
    const scope = settingsSaveScope(snapshot);
    setBusy(true);
    setFeedback("");
    try {
      if (!await flushSettingsBeforeAccountExit(scope)) throw new Error("设置尚未保存，已保留当前页面。请重试保存，或复制未保存的原文后再退出。");
      if (!alive.current) return;
      if (settingsSaveScope(sessionManager.getSnapshot()) !== scope) throw new Error("账号或伴侣已切换，本次退出已取消。请在当前空间重新操作。");
      await sessionManager.signOut();
    } catch (error) {
      if (alive.current) {
        setFeedback(error?.message || "退出登录失败，请稍后再试。");
        setBusy(false);
      }
    } finally {
      releaseSettingsAccountExit(scope);
      exiting.current = false;
    }
  }

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className="account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title="账号"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">{initial}</span>
        <span className="account-menu-trigger-copy">
          <strong>{email}</strong>
          <small>账号与退出</small>
        </span>
      </button>
      {open && (
        <div className="account-menu-popover" role="menu">
          <span>当前账号</span>
          <strong>{email}</strong>
          {feedback && (
            <small className="account-menu-error" role="alert">
              {feedback}
            </small>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={signOut}
          >
            {busy ? "正在退出..." : "退出登录"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AuthGate({
  children,
  sessionManager = authSession,
}) {
  const [snapshot, setSnapshot] = useState(sessionManager.getSnapshot);

  useEffect(() => {
    const unsubscribe = sessionManager.subscribe(setSnapshot);
    sessionManager.initialize().catch(() => {});
    return unsubscribe;
  }, [sessionManager]);

  useEffect(
    () => startBackgroundNotificationIdentitySync(sessionManager),
    [sessionManager],
  );

  if (!sessionManager.isConfigured()) return <ConfigurationScreen />;
  if (snapshot.status === AUTH_STATUS.loading) return <LoadingScreen />;

  if (
    snapshot.status !== AUTH_STATUS.authenticated ||
    !snapshot.user?.id
  ) {
    return (
      <AuthScreen
        key={
          snapshot.status === AUTH_STATUS.recovery
            ? "password-recovery"
            : "account-access"
        }
        sessionManager={sessionManager}
        initialMode={
          snapshot.status === AUTH_STATUS.recovery ? "reset" : "login"
        }
        initialMessage={
          [AUTH_STATUS.expired, AUTH_STATUS.error].includes(snapshot.status)
            ? snapshot.error?.message || "登录状态已失效，请重新登录。"
            : ""
        }
      />
    );
  }

  const accountControl = (
    <AccountMenu sessionManager={sessionManager} snapshot={snapshot} />
  );
  return typeof children === "function"
    ? children({ accountControl, snapshot })
    : children;
}
