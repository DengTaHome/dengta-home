import { isPrivateMediaAssetId } from "./private-media.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";
import { createChatClientMessageId } from "./chat-idempotency.js";

export async function requestStickerImport(request, path, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  let timer, onAbort;
  const aborted = () => new DOMException("表情操作已取消", "AbortError");
  if (options.signal?.aborted) throw aborted();
  const interrupted = new Promise((_, reject) => {
    onAbort = () => { controller.abort(); reject(aborted()); };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("表情服务响应超时"), { code: "sticker_import_timeout" }));
    }, timeoutMs);
  });
  const auth = options.authSession;
  try {
    const guarded = auth ? createScopedSettingsSession(auth, settingsSaveScope(auth.getSnapshot()), controller.signal) : undefined;
    return await Promise.race([interrupted, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw aborted();
      return request(path, {
      ...options, retry: false, timeoutMs: 0, signal: controller.signal, ...(guarded ? { authSession: guarded } : {}),
      });
    })]);
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); controller.abort();
  }
}

export function bilibiliStickerId(value) {
  const text = String(value || "").trim();
  if (/^BV[0-9A-Za-z]{10}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["www.bilibili.com", "bilibili.com", "m.bilibili.com"].includes(url.hostname)) return "";
    return /^\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(url.pathname)?.[1] || "";
  } catch { return ""; }
}

export function stickerImportRequest(scope, bvid, storage, uuid = createChatClientMessageId) {
  const key = `dengta-sticker-import:${scope}`;
  let stored;
  try { storage ??= globalThis.localStorage; stored = JSON.parse(storage?.getItem(key) || "null"); } catch { /* Storage can be disabled. */ }
  if (stored?.bvid === bvid && isPrivateMediaAssetId(stored.client_request_id)) return stored;
  const request = { bvid, client_request_id: uuid() };
  try { storage?.setItem(key, JSON.stringify(request)); } catch { /* The view also keeps the receipt. */ }
  return request;
}

export function validateStickerImportReceipt(data) {
  if (data?.ok !== true || !isPrivateMediaAssetId(data?.asset?.id) || data.asset.purpose !== "custom_sticker" ||
    data.asset.status !== "active" || data.source?.provider !== "bilibili" || !/^BV[0-9A-Za-z]{10}$/.test(data.source.bvid || "")) {
    throw Object.assign(new Error("表情导入回执不完整，请使用原来的导入按钮重试。"), { code: "sticker_import_receipt_invalid" });
  }
  return { asset: data.asset, source: { ...data.source, page_url: `https://www.bilibili.com/video/${data.source.bvid}` }, replayed: data.replayed === true };
}

export function normalizeStickerSource(source) {
  if (source?.provider === "bilibili" && /^BV[0-9A-Za-z]{10}$/.test(source.bvid || "")) return { ...source, page_url: `https://www.bilibili.com/video/${source.bvid}` };
  if (source?.provider === "xiaohongshu" && /^[a-f0-9]{24}$/.test(source.note_id || "")) return { ...source, page_url: `https://www.xiaohongshu.com/explore/${source.note_id}` };
  throw Object.assign(new Error("图片来源回执不完整。"), { code: "sticker_import_receipt_invalid" });
}

export function stickerImportError(error) {
  const messages = {
    sticker_import_schema_required: "B站表情搜集尚待数据库更新，现有上传和发图仍可使用。",
    sticker_import_disabled: "请先允许伴侣从B站搜集表情，再重试。",
    sticker_import_request_invalid: "视频编号或导入参数不正确，请使用BV号或完整的视频链接。",
    sticker_import_request_conflict: "导入编号已被其他内容使用，请先核对表情包架，再更换视频导入。",
    sticker_import_source_unavailable: "B站视频信息暂时无法读取。请确认视频可打开，必要时重新登录B站后重试。",
    sticker_import_source_invalid: "该视频没有支持的静态封面，请换一个视频。",
    sticker_import_too_large: "封面超过12MB，请换一个视频。",
    sticker_import_timeout: "表情服务响应超时，可点击原来的操作按钮重试。",
    private_media_not_found: "这张图片不存在，或已从当前空间移除，请刷新表情包架。",
    authentication_required: "登录状态已失效，请重新登录后重试。",
    invalid_session: "登录状态已失效，请重新登录后重试。",
    sticker_import_asset_removed: "这次导入的表情已删除或归档，不会自动重新创建。",
    sticker_import_storage_failed: "未能确认保存结果，请点击原来的导入按钮重试。",
    sticker_import_download_failed: "封面暂时无法下载，请点击原来的导入按钮重试。",
    sticker_import_receipt_invalid: "导入回执不完整，请点击原来的导入按钮重试。",
  };
  const code = Object.hasOwn(messages, error?.code) ? error.code : "sticker_import_unavailable";
  return `${messages[code] || "表情搜集暂时不可用，请检查网络后重试。"}（Code: ${code}${Number.isInteger(error?.status) ? `；HTTP: ${error.status}` : ""}）`;
}
