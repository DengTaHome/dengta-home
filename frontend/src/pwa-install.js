function isIosDevice(navigatorLike) {
  const userAgent = String(navigatorLike?.userAgent || "");
  const platform = String(navigatorLike?.platform || "");
  return (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && Number(navigatorLike?.maxTouchPoints || 0) > 1)
  );
}

function isIosSafari(navigatorLike) {
  const userAgent = String(navigatorLike?.userAgent || "");
  return (
    isIosDevice(navigatorLike) &&
    /Safari/i.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent)
  );
}

export function createPwaInstallController({
  windowLike = globalThis.window,
  navigatorLike = globalThis.navigator,
} = {}) {
  let deferredPrompt = null;
  let started = false;
  const listeners = new Set();

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function isInstalled() {
    return Boolean(
      navigatorLike?.standalone === true ||
        windowLike?.matchMedia?.("(display-mode: standalone)")?.matches,
    );
  }

  function guidance() {
    if (isInstalled()) return "网页版本已经安装在这部设备上。";
    if (isIosSafari(navigatorLike)) {
      return "在 Safari 点“分享”→“添加到主屏幕”，再从新图标打开并登录。";
    }
    if (isIosDevice(navigatorLike)) {
      return "请先用 Safari 打开网页，点“分享”→“添加到主屏幕”，再从新图标打开并登录。";
    }
    if (/Android/i.test(String(navigatorLike?.userAgent || ""))) {
      return "点浏览器菜单，选择“安装应用”或“添加到主屏幕”。";
    }
    return "使用浏览器菜单里的“安装应用”或“添加到主屏幕”。";
  }

  function capturePrompt(event) {
    event.preventDefault?.();
    deferredPrompt = event;
    emit();
  }

  function clearPrompt() {
    deferredPrompt = null;
    emit();
  }

  function start() {
    if (started || !windowLike?.addEventListener) return;
    started = true;
    windowLike.addEventListener("beforeinstallprompt", capturePrompt);
    windowLike.addEventListener("appinstalled", clearPrompt);
  }

  function stop() {
    if (!started || !windowLike?.removeEventListener) return;
    started = false;
    windowLike.removeEventListener("beforeinstallprompt", capturePrompt);
    windowLike.removeEventListener("appinstalled", clearPrompt);
  }

  async function install() {
    if (!deferredPrompt) {
      return { outcome: isInstalled() ? "installed" : "instructions", message: guidance() };
    }
    const prompt = deferredPrompt;
    deferredPrompt = null;
    emit();
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return {
      outcome: choice?.outcome || "dismissed",
      message:
        choice?.outcome === "accepted"
          ? "正在把 DengTa Home 添加到这部设备。"
          : guidance(),
    };
  }

  return Object.freeze({
    start,
    stop,
    install,
    guidance,
    isInstalled,
    canPrompt: () => Boolean(deferredPrompt),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

export const pwaInstallController = createPwaInstallController();
