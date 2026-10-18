import { isPrivateMediaAssetId } from "./private-media.js";
import { createChatClientMessageId } from "./chat-idempotency.js";
import { stickerImportError } from "./sticker-import.js";
const NOTE = /^[a-f0-9]{24}$/;
const invalid = () => Object.assign(new Error("小红书表情回执不完整，请重新检测。"), { code: "sticker_import_receipt_invalid" });
export function validateXhsSearch(data) {
  if (data?.ok !== true || !Array.isArray(data.result?.items) || data.result.items.length > 20) throw invalid();
  return data.result.items.map(item => {
    if (!NOTE.test(item?.note_id || "") || typeof item.title !== "string" || typeof item.author !== "string") throw invalid();
    return { note_id: item.note_id, title: item.title.slice(0, 300), creator: item.author.slice(0, 120) };
  });
}
export function validateXhsImport(data) {
  if (data?.ok !== true || !isPrivateMediaAssetId(data.asset?.id) || data.asset.purpose !== "custom_sticker" || data.asset.status !== "active" || data.source?.provider !== "xiaohongshu" || !NOTE.test(data.source.note_id || "")) throw invalid();
  return { asset: data.asset, source: { provider: "xiaohongshu", note_id: data.source.note_id, title: String(data.source.title || "").slice(0, 300), creator: String(data.source.creator || "").slice(0, 120), page_url: `https://www.xiaohongshu.com/explore/${data.source.note_id}` }, replayed: data.replayed === true };
}
export function xhsStickerRequest(scope, noteId, storage, uuid = createChatClientMessageId) {
  const key = `dengta-xhs-sticker-import:${scope}`;
  let saved;
  try { storage ??= globalThis.localStorage; saved = JSON.parse(storage?.getItem(key) || "null"); } catch { /* Disabled storage keeps the current operation in memory. */ }
  if (saved?.note_id === noteId && isPrivateMediaAssetId(saved.client_request_id)) return { note_id: noteId, client_request_id: saved.client_request_id };
  const value = { note_id: noteId, client_request_id: uuid() };
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* The view retains this request for retries. */ }
  return value;
}
export function xhsStickerError(error) {
  const messages = {
    cookie_expired: "小红书登录未建立或已过期，请在设置的小红书连接中重新登录。",
    verification_required: "小红书要求人工验证，请在自己的小红书网页完成后重试。",
    xhs_note_lookup_required: "当前会话未保留这篇笔记，请重新搜索后再导入。",
    xhs_search_request_invalid: "请输入有效搜索词；当前支持第一页默认排序。",
    xhs_session_isolation_required: "小红书服务需要更新独立会话支持，未使用共享登录态。",
    xhs_service_unconfigured: "小红书独立服务尚未配置，暂时无法搜索。",
    xhs_scope_required: "请重新打开当前账号与伴侣的表情搜集页面。",
    xhs_service_access_denied: "小红书服务认证未通过，请联系维护者检查独立服务访问配置。",
    xhs_browser_unavailable: "当前账号的独立浏览器暂时无法打开，请稍后重试。",
    xhs_profile_storage_failed: "当前账号的加密会话读写失败，原有资料未删除，请稍后重试。",
    xhs_credentials_unavailable: "小红书登录资料无法解密，请重新导入当前账号的登录态。",
    xhs_storage_read_failed: "当前账号的小红书登录资料读取失败，请稍后重试。",
    xhs_action_not_supported: "小红书独立服务尚未支持表情来源接口，需要更新服务后再导入。",
    xhs_page_changed: "小红书页面结构变化，暂时无法读取，请重新检测或联系维护者。",
    xhs_profile_busy: "小红书独立浏览器暂时繁忙，请稍后重试。",
    xhs_timeout: "小红书读取超时，请点击原来的操作重试。",
    xhs_unreachable: "小红书网页暂时无法访问，请检查连接后重试。",
    xhs_response_invalid: "小红书服务返回了无效结果，请重新搜索。",
    xhs_upstream_error: "小红书平台暂时无法处理请求，请稍后重试。",
  };
  if (Object.hasOwn(messages, error?.code)) return `${messages[error.code]}（Code: ${error.code}）`;
  return stickerImportError(error).replaceAll("B站", "小红书").replaceAll("视频", "笔记");
}
