/**
 * 网易云「内置浏览器登录态」的状态判定。
 *
 * 实机发现：cookie 早就失效了（后端 /api/v2/music/providers/netease/cookie/my-playlists
 * 返回 400 netease_cookie_invalid），但界面上仍显示「已连接：云村村民…」，
 * 用户会以为能播歌，点下去才发现没反应。
 *
 * 这里把判定和文案收敛成纯函数，组件只负责渲染。
 */

export const COOKIE_INVALID_CODE = "netease_cookie_invalid";

export function isNeteaseCookieInvalid(error) {
  if (!error) return false;
  const code = typeof error === "string" ? error : error.code;
  return code === COOKIE_INVALID_CODE;
}

/**
 * @param {{checking?: boolean, connected?: boolean, expired?: boolean, account_name?: string}} status
 * @returns {{state: "checking"|"connected"|"expired"|"disconnected", title: string, detail: string, actions: string[]}}
 */
export function neteaseCookieStatus(status) {
  const account = status?.account_name || "网易云账号";
  if (status?.checking) {
    return {
      state: "checking",
      title: "正在检查登录状态…",
      detail: "",
      actions: [],
    };
  }
  if (status?.connected) {
    return {
      state: "connected",
      title: `已连接：${account}`,
      detail: "",
      actions: ["disconnect"],
    };
  }
  if (status?.expired) {
    return {
      state: "expired",
      title: "登录已失效，请重新登录网易云",
      detail: "歌单、每日推荐和听歌记录读不出来了。重新用内置浏览器登录一次即可，已下载到本机的歌不受影响。",
      actions: ["login", "desktopLogin"],
    };
  }
  return {
    state: "disconnected",
    title: "内置浏览器登录网易云",
    detail: "用内置浏览器打开网易云网页，登录后点「提取登录态」再返回。手机版不方便操作时可用桌面版，双指放大二维码。",
    actions: ["login", "desktopLogin"],
  };
}
