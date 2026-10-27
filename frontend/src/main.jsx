import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./cozy-theme.css";
import "./auth.css";
import "./native-feel.css";
import "./apple-ui.css";
import "./sun-glass-ui.css";
import "./jelly-motion.css";
import "./sun-glass-chat.css";
import "./typography.css";
import "./apple-high.css";
import "./room-invite.css";
import "./settings-media-polish.css";
import "./interaction-polish.css";
import "./interface-polish.css";
import LoadedApp from "./LoadedApp.jsx";
import AuthGate from "./AuthGate.jsx";
import { authSession } from "./auth-session.js";
import DengTaPrelude from "./DengTaPrelude.jsx";
import { prewarmBackend } from "./backend-prewarm.js";
import { pwaInstallController } from "./pwa-install.js";
import ReceiverApp from "./ReceiverApp.jsx";
import {
  AppLoadingScreen,
  AppStartupBoundary,
} from "./AppStartupBoundary.jsx";
import {
  installChunkRecovery,
} from "./app-startup-recovery.js";

const isReceiverRoute = window.location.pathname === "/receive";

if (!isReceiverRoute) {
  installChunkRecovery();
  void prewarmBackend();
  pwaInstallController.start();
}

// 缺陷 1 修复：接收 dengta://auth... 深度链接回跳（邮箱验证 / 密码重置）。
// 原生 App 无法通过 WebView URL 感知 fragment，必须监听 @capacitor/app 事件。
// 放映厅邀请深链：dengta://room/join?code=XXXXXX 或 https://dengtahome.com/room/join?code=XXXXXX
if (!isReceiverRoute) {
  import("@capacitor/app")
    .then(({ App }) => {
      App.addListener("appUrlOpen", (data) => {
        const rawUrl = String(data?.url || "");
        if (rawUrl.startsWith("dengta://auth")) {
          void authSession
            .handleAuthCallbackUrl(rawUrl)
            .catch(() => {
              // 回跳失败会发布 error 快照，由 AuthGate 显示给用户
            });
        } else if (
          rawUrl.includes("room/join") ||
          /[?&]room_code=/.test(rawUrl)
        ) {
          // 放映厅邀请：把邀请码存入本地，App 加载完成后弹出接受/拒绝邀请
          import("./room-invite.js")
            .then((m) => m.acceptRoomInviteUrl(rawUrl))
            .catch(() => {});
        }
      });
    })
    .catch(() => {
      // @capacitor/app 在纯 Web 构建中不可用时静默跳过，邮箱验证走 Web URL 回跳
    });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {isReceiverRoute ? <ReceiverApp /> : <>
      <DengTaPrelude />
      <AuthGate>
        {({ accountControl, snapshot }) =>
          // 关键：解析出用户之前不要挂载 App。
          // 早先这里用空快照先挂一次，鉴权完成后 user.id 从 "" 变成真实值，
          // LoadedApp 的 key 随之改变 → 整个 App 卸载重挂 → 启动请求（bootstrap/
          // 成就/纪念日/推荐…）整波重复一遍。实测首屏 26 个请求里有近三分之一是这么来的。
          snapshot.user?.id ? (
            <AppStartupBoundary
              accountScope={snapshot.user.id}
              sessionManager={authSession}
            >
              <Suspense fallback={<AppLoadingScreen />}>
                <LoadedApp key={JSON.stringify([snapshot.user.id, snapshot.activeCompanionId])} accountControl={accountControl} accountScope={snapshot.user.id} userName={snapshot.user.displayName} companionScope={snapshot.activeCompanionId || ""} />
              </Suspense>
            </AppStartupBoundary>
          ) : (
            <AppLoadingScreen />
          )
        }
      </AuthGate>
    </>}
  </StrictMode>,
);

// 大字体（7.42 MB）不占关键路径：等浏览器空闲再挂载样式表。
// 实测这么做能让接口请求先拿到带宽，缩短「第一条消息渲染」的时间。
function scheduleLateFont() {
  const attach = () => {
    // 用户选了「系统字体」就不要下载这 7.42 MB：
    // 字体模式由 index.html 早早在 html[data-dengta-font-mode] 上标好。
    if (document.documentElement.dataset.dengtaFontMode === "system") return;
    if (globalThis.navigator?.connection?.saveData === true) return; // 省流量模式同样跳过
    if (document.querySelector('link[data-late-font="dengta-sans"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/font-late.css";
    link.dataset.lateFont = "dengta-sans";
    document.head.appendChild(link);
  };
  // 不能用 requestIdleCallback：实测它在 ~600 ms 就触发，等于还在关键路径上。
  // 首屏内容出现之后 8 秒再挂载，字体下载就不会和启动期的接口请求抢带宽。
  globalThis.setTimeout?.(attach, 8000);
}
scheduleLateFont();
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service Worker 注册失败：", error);
    });
  });
} else if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister())),
    )
    .catch(() => {
      // 开发环境清理失败不会影响页面调试。
    });
}
