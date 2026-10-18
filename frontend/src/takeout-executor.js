import { Capacitor, registerPlugin } from "@capacitor/core";
import { apiRequest } from "./api.js";
import { recordOperationFailure } from "./operation-diagnostics.js";
import { withBrowserAccount } from "./browser-account-binding.js";

export const OrderBrowser = registerPlugin("OrderBrowser");
export const TAKEOUT_POLL_MS = 12 * 1000;

function callAccountBrowser(plugin, method, options = {}) {
  return plugin === OrderBrowser ? withBrowserAccount(account => plugin[method]({ ...options, ...account })) : plugin[method](options);
}

export function takeoutPluginAvailable(capacitor = Capacitor) {
  return (
    capacitor.isNativePlatform() &&
    capacitor.isPluginAvailable("OrderBrowser")
  );
}

export const TAKEOUT_PLATFORMS = [
  { id: "eleme", label: "饿了么", url: "https://h5.ele.me/msite/" },
  { id: "meituan", label: "美团", url: "https://i.meituan.com/" },
  { id: "jd", label: "京东到家", url: "https://daojia.jd.com/" },
];

export async function openTakeoutLogin({ plugin = OrderBrowser, url = "", capacitor = Capacitor } = {}) {
  if (!takeoutPluginAvailable(capacitor)) {
    return { ok: false, code: "takeout_native_unavailable", error: "外卖执行器仅在 Android App 中可用。" };
  }
  try {
    const value = await callAccountBrowser(plugin, "openLogin", { url: String(url || "").trim() || TAKEOUT_PLATFORMS[0].url });
    return { ok: true, ...(value || {}) };
  } catch (error) {
    const failure = nativePageFailure(error?.code);
    return { ok: false, code: failure?.[0] || "takeout_login_open_failed", error: failure?.[1] || "无法打开外卖平台页面，请返回后重试。" };
  }
}

// 外卖平台登录状态（读 WebView 持久化的登录 Cookie）。
export async function readTakeoutLoginState({ plugin = OrderBrowser, capacitor = Capacitor, timeoutMs = 10_000 } = {}) {
  if (!takeoutPluginAvailable(capacitor)) {
    return { status: "unavailable", loggedIn: false, hasCookie: false };
  }
  let timer;
  try {
    const value = await Promise.race([
      callAccountBrowser(plugin, "getLoginState"),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(), { code: "takeout_login_check_timeout" })), timeoutMs); }),
    ]);
    if (!value || typeof value.loggedIn !== "boolean" || typeof value.hasCookie !== "boolean") {
      return takeoutLoginFailure("takeout_login_state_invalid");
    }
    return {
      status: "ready",
      loggedIn: value?.loggedIn === true,
      hasCookie: value?.hasCookie === true,
    };
  } catch (error) { return takeoutLoginFailure(error?.code); }
  finally { clearTimeout(timer); }
}

export async function readPendingTakeoutCommands({ client = apiRequest } = {}) {
  try {
    const data = await client("/api/v2/takeout/pending", { timeoutMs: 12_000 });
    return Array.isArray(data?.commands) ? data.commands : [];
  } catch {
    return [];
  }
}

async function postTakeoutProgress(id, progress, { client = apiRequest } = {}) {
  try {
    await client(`/api/v2/takeout/${id}/progress`, {
      method: "POST",
      timeoutMs: 10_000,
      body: JSON.stringify({ progress }),
    });
  } catch {
    // 进度上报失败不阻塞主流程。
  }
}

const NATIVE_FAILURES = {
  logged_out: ["takeout_login_expired", "外卖登录已失效，请重新登录后重试。"],
  verification: ["takeout_verification_required", "外卖平台需要人机验证，请在页面中手动完成验证后再继续。"],
  shop_not_found: ["takeout_shop_not_found", "没有找到对应店铺，请换店名或搜索词后重试。"],
  product_not_found: ["takeout_product_not_found", "没有找到指定商品，未改选其他商品。请在店铺里确认名称后再试。"],
  over_limit: ["takeout_budget_exceeded", "购物车金额超过设置的预算，请核对商品数量和金额后再继续。"],
  error: ["takeout_page_execution_failed", "外卖页面未完成操作，请检查页面和购物车后再重试。"],
};

const NATIVE_PAGE_FAILURES = {
  browser_account_required: "请先登录灯塔，再从当前账号打开外卖页面。",
  browser_account_restore_required: "外卖网页被系统重建，页面会话未恢复。请返回灯塔重新打开；已保存的登录资料未被清除。",
  browser_account_changed: "灯塔账号已变化，本次外卖操作已停止。请从当前账号重新打开，先核对购物车。",
  browser_account_isolation_unavailable: "系统 WebView 暂不支持账号独立登录，请更新 Android System WebView，或到系统浏览器／外卖 App 手动操作。未使用旧账号登录态。",
  browser_account_binding_failed: "未能绑定当前灯塔账号，外卖操作未开始。请返回重新打开。",
  takeout_page_not_ready: "外卖页面尚未就绪，无法确认登录和店铺状态，已停止自动操作。请在当前页面检查或刷新后再试。",
  takeout_page_touch_unavailable: "无法确认按钮位置，未继续自动加购。请在当前页面手动选择并核对购物车。",
  takeout_page_init_failed: "外卖页面初始化失败，自动操作已停止。请核对页面后手动返回。",
  takeout_page_renderer_failed: "外卖页面渲染异常，自动操作已停止。请核对购物车后手动返回。",
  takeout_page_load_failed: "当前外卖网页未能加载，自动操作已停止。可点击“恢复网页，手动核对”检查网络、登录和购物车。",
  takeout_page_interrupted: "外卖页面因系统重建中断，未重复自动操作。请核对购物车后手动返回。",
  browser_page_init_failed: "外卖登录网页初始化失败，请重新打开；已保存的登录资料未被清除。",
  browser_page_renderer_failed: "外卖登录网页渲染进程已退出，请重新打开网页或更新系统 WebView。",
  browser_page_load_failed: "外卖登录网页加载失败，请检查网络后重新打开；未将它判定为未登录。",
};

export function takeoutLoginFailure(code) {
  const messages = {
    takeout_login_check_timeout: "本机登录状态检测超时，无法确认是否已登录。可以重新检测，或打开平台页面手动核对。",
    takeout_login_state_invalid: "本机浏览器返回了无效的登录状态，未将它判定为未登录。请重新检测或更新应用。",
    takeout_login_check_failed: "暂时无法读取本机登录状态，未将它判定为未登录。请重新检测或打开平台页面核对。",
    takeout_login_open_failed: "无法打开外卖平台页面，请返回后重试；未清除已保存的登录资料。",
  };
  const safeCode = Object.hasOwn(messages, code) || Object.hasOwn(NATIVE_PAGE_FAILURES, code) ? code : "takeout_login_check_failed";
  return { status: "error", loggedIn: false, hasCookie: false, code: safeCode, message: messages[safeCode] || NATIVE_PAGE_FAILURES[safeCode] };
}

function nativePageFailure(code) {
  return typeof code === "string" && Object.hasOwn(NATIVE_PAGE_FAILURES, code) ? [code, NATIVE_PAGE_FAILURES[code]] : null;
}

function nativeFeedback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("takeout_native_result_invalid");
  const failure = (value.status === "error" ? nativePageFailure(value.code) : null) || (Object.hasOwn(NATIVE_FAILURES, value.status) ? NATIVE_FAILURES[value.status] : null) || (value.loading === true
    ? ["takeout_search_incomplete", "外卖搜索页面尚未加载完整，请检查网络或登录状态后重试。"]
    : value.error ? NATIVE_FAILURES.error : null);
  return failure ? { ok: false, code: failure[0], message: failure[1], error: failure[1] } : { ok: true };
}

export async function executeTakeoutCommand(
  command,
  { client = apiRequest, plugin = OrderBrowser, onProgress = () => {}, shouldContinue = () => true, scope = "" } = {}
) {
  const id = command?.id;
  const payload = command?.command || {};
  if (!id || !shouldContinue()) return null;
  try {
    await client(`/api/v2/takeout/${id}/ack`, {
      method: "POST",
      timeoutMs: 12_000,
      body: JSON.stringify({}),
    });
  } catch {
    return null; // 已被处理或已过期。
  }
  if (!shouldContinue()) return null;
  const report = (text) => {
    if (!shouldContinue()) return;
    onProgress(text);
    void postTakeoutProgress(id, text, { client });
  };
  let result;
  try {
    if (!["search", "order"].includes(payload.action) || !String(payload.requirement || "").trim()) {
      throw new Error("takeout_command_invalid");
    }
    if (payload.action === "search") {
      report("正在打开外卖页面搜索…");
      const value = await callAccountBrowser(plugin, "searchShops", { keyword: payload.requirement, scope });
      result = {
        ...nativeFeedback(value),
        status: value?.status || "done",
        action: "search",
        keyword: payload.requirement,
        shops: Array.isArray(value?.shops) ? value.shops : [],
      };
    } else {
      report("正在打开外卖页面选品加购…");
      const value = await callAccountBrowser(plugin, "orderProduct", {
        shopName: payload.shop_name || payload.requirement,
        product: payload.requirement,
        quantity: Number(payload.quantity) || 1,
      });
      result = {
        ...(value || {}),
        ...nativeFeedback(value),
        action: "order",
        shop_name: payload.shop_name || "",
        product: payload.requirement,
        quantity: Number(payload.quantity) || 1,
      };
    }
  } catch (error) {
    if (!shouldContinue()) return null;
    const pageFailure = nativePageFailure(error?.code);
    const code = pageFailure?.[0] || (["takeout_command_invalid", "takeout_native_result_invalid"].includes(error?.message) ? error.message : "takeout_native_execution_failed");
    const message = pageFailure?.[1] || (code === "takeout_command_invalid" ? "点餐指令不完整，未打开外卖页面。" : code === "takeout_native_result_invalid" ? "外卖页面返回了无效结果，请先核对购物车，再决定是否重试。" : "外卖页面执行未完成，请先检查页面和购物车，再决定是否重试。");
    let receiptSynced = false;
    try {
      await client(`/api/v2/takeout/${id}/failure`, {
        method: "POST",
        timeoutMs: 15_000,
        body: JSON.stringify({ message }),
      });
      receiptSynced = true;
    } catch {
      // 结果上报失败不阻塞。
    }
    return { ok: false, code, message, receipt_synced: receiptSynced };
  }
  if (!shouldContinue()) return null;
  // 页面已经执行成功，回执网络错误不能改写为执行失败或重新加购。
  try {
    await client(`/api/v2/takeout/${id}/result`, {
      method: "POST", timeoutMs: 15_000, body: JSON.stringify({ result }),
    });
    return { ...result, receipt_synced: true };
  } catch {
    if (!shouldContinue()) return null;
    return { ...result, receipt_synced: false, code: "takeout_result_sync_failed",
      message: "外卖页面已返回，但结果未同步。请先核对购物车，避免重复加购；可在错误日志中检查网络请求。" };
  }
}

export function startTakeoutRunner({
  client = apiRequest,
  plugin = OrderBrowser,
  pollMs = TAKEOUT_POLL_MS,
  onCommandDone = () => {},
  scope = "",
  capacitor = Capacitor,
} = {}) {
  if (!scope || !takeoutPluginAvailable(capacitor)) {
    return () => {};
  }
  let stopped = false;
  let running = false;
  const controller = new AbortController();
  const scopedClient = (path, options) => client(path, { ...options, retry: false, signal: controller.signal });
  // 崩溃护栏:执行前写入本地标记。若上次执行时应用崩溃,
  // 下次启动会看到同一命令的标记,直接上报失败,不再触发原生页面。
  const markerKey = "dengta_takeout_attempted_v2:" + scope;
  const readMarker = () => {
    try {
      return JSON.parse(window.localStorage.getItem(markerKey) || "{}");
    } catch {
      return {};
    }
  };
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const commands = await readPendingTakeoutCommands({ client: scopedClient });
      if (stopped || commands.length === 0) return;
      const command = commands[0];
      const marker = readMarker();
      if (marker.id === command.id) {
        try {
          // 先独占领取，避免把另一台设备已开始的执行标成失败。
          await scopedClient(`/api/v2/takeout/${command.id}/ack`, {
            method: "POST", timeoutMs: 12_000, body: JSON.stringify({}),
          });
          if (stopped) return;
          await scopedClient(`/api/v2/takeout/${command.id}/failure`, {
            method: "POST",
            timeoutMs: 12_000,
            body: JSON.stringify({ message: "上次执行状态不明，未重复执行。请先核对购物车。" }),
          });
          window.localStorage.removeItem(markerKey);
        } catch {
          // 上报失败不阻塞。
        }
        if (!stopped) {
          const outcome = { ok: false, code: "takeout_previous_attempt_unknown", message: "上次操作状态不明，请先核对购物车，再决定是否重试。" };
          recordOperationFailure(scope, "/api/v2/takeout", outcome);
          onCommandDone(command, outcome);
        }
        return;
      }
      try {
        window.localStorage.setItem(markerKey, JSON.stringify({ id: command.id }));
      } catch {
        // 存储不可用时仍然继续,由服务端 pending 状态兜底。
      }
      const outcome = await executeTakeoutCommand(command, { client: scopedClient, plugin, scope, shouldContinue: () => !stopped });
      if (!stopped && outcome?.receipt_synced) {
        try {
          window.localStorage.removeItem(markerKey);
        } catch {
          // 忽略。
        }
      }
      if (!stopped && outcome) {
        if (!outcome.ok || !outcome.receipt_synced) recordOperationFailure(scope, "/api/v2/takeout", outcome);
        onCommandDone(command, outcome);
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, pollMs);
  // 延迟启动:避免 App 一打开就弹出外卖页面,留给启动流程喘息空间。
  const firstTimer = setTimeout(() => {
    void tick();
  }, 10_000);
  return () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    clearInterval(timer);
    clearTimeout(firstTimer);
    try { Promise.resolve(plugin.cancelSearch?.({ scope })).catch(() => {}); } catch { /* Older native builds have no independent search wait. */ }
  };
}
