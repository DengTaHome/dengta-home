import { Capacitor, registerPlugin } from "@capacitor/core";
import { apiRequest } from "./api.js";
import { recordOperationFailure } from "./operation-diagnostics.js";

export const OrderBrowser = registerPlugin("OrderBrowser");
export const TAKEOUT_POLL_MS = 12 * 1000;

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

export async function openTakeoutLogin({ plugin = OrderBrowser, url = "" } = {}) {
  if (!takeoutPluginAvailable()) {
    return { ok: false, error: "外卖执行器仅在 Android App 中可用。" };
  }
  try {
    const value = await plugin.openLogin({ url });
    return { ok: true, ...(value || {}) };
  } catch (error) {
    return { ok: false, error: String(error?.message || "打开登录页失败。") };
  }
}

// 外卖平台登录状态（读 WebView 持久化的登录 Cookie）。
export async function readTakeoutLoginState({ plugin = OrderBrowser } = {}) {
  if (!takeoutPluginAvailable()) {
    return { loggedIn: false, hasCookie: false };
  }
  try {
    const value = await plugin.getLoginState();
    return {
      loggedIn: value?.loggedIn === true,
      hasCookie: value?.hasCookie === true,
    };
  } catch {
    return { loggedIn: false, hasCookie: false };
  }
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
  over_limit: ["takeout_budget_exceeded", "购物车金额超过设置的预算，请核对商品数量和金额后再继续。"],
  error: ["takeout_page_execution_failed", "外卖页面未完成操作，请检查页面和购物车后再重试。"],
};

const NATIVE_PAGE_FAILURES = {
  takeout_page_init_failed: "外卖页面初始化失败，自动操作已停止。请核对页面后手动返回。",
  takeout_page_renderer_failed: "外卖页面渲染异常，自动操作已停止。请核对购物车后手动返回。",
  takeout_page_interrupted: "外卖页面因系统重建中断，未重复自动操作。请核对购物车后手动返回。",
};

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
      const value = await plugin.searchShops({ keyword: payload.requirement, scope });
      result = {
        ...nativeFeedback(value),
        status: value?.status || "done",
        action: "search",
        keyword: payload.requirement,
        shops: Array.isArray(value?.shops) ? value.shops : [],
      };
    } else {
      report("正在打开外卖页面选品加购…");
      const value = await plugin.orderProduct({
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
