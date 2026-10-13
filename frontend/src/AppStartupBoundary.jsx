import { Component, useState } from "react";
import {
  clearUiPreferencesAndReload,
  reloadApplication,
  startupDiagnosticCode,
} from "./app-startup-recovery.js";

export function AppLoadingScreen() {
  return (
    <main className="app-startup-page" aria-busy="true" aria-live="polite">
      <div className="app-startup-mark" aria-hidden="true">灯</div>
      <strong>正在点亮你的家</strong>
      <span>载入聊天、记忆与伴侣空间…</span>
    </main>
  );
}

export function AppFailureScreen({
  diagnosticCode = "DT-START-UI-01",
  errorMessage = "",
  accountScope = "",
  sessionManager,
}) {
  const [signOutState, setSignOutState] = useState("");

  async function exitAccount() {
    setSignOutState("busy");
    try {
      await sessionManager?.signOut();
      reloadApplication();
    } catch {
      setSignOutState("error");
    }
  }

  return (
    <main className="app-startup-page app-startup-failure" role="alert">
      <div className="app-startup-mark" aria-hidden="true">灯</div>
      <strong>这次没有顺利点亮</strong>
      <span>应用内容载入失败，账号和聊天数据不会因此丢失。</span>
      <small>诊断码：{diagnosticCode}</small>
      {errorMessage ? (
        <small className="app-startup-error">
          错误详情：{errorMessage.slice(0, 300)}
        </small>
      ) : null}
      <button type="button" onClick={reloadApplication}>重新载入应用</button>
      <button
        type="button"
        onClick={() => clearUiPreferencesAndReload(accountScope)}
      >
        清理本机界面偏好后重试
      </button>
      <button type="button" disabled={signOutState === "busy"} onClick={exitAccount}>
        {signOutState === "busy" ? "正在退出…" : "退出当前账号"}
      </button>
      {signOutState === "error" && (
        <span role="status">退出失败，请检查网络后重试。</span>
      )}
    </main>
  );
}

export class AppStartupBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, diagnosticCode: "DT-START-UI-01", errorMessage: "" };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    const name = String(error?.name || "Error").slice(0, 80);
    const diagnosticCode = startupDiagnosticCode(error);
    this.setState({
      diagnosticCode,
      errorMessage: String(error?.message || error?.name || "").slice(0, 400),
    });
    console.error(
      "DengTa 应用界面载入失败",
      JSON.stringify({
        name,
        diagnosticCode,
        message: String(error?.message || ""),
      }),
    );
  }

  render() {
    return this.state.failed ? (
      <AppFailureScreen
        diagnosticCode={this.state.diagnosticCode}
        errorMessage={this.state.errorMessage}
        accountScope={this.props.accountScope}
        sessionManager={this.props.sessionManager}
      />
    ) : this.props.children;
  }
}
