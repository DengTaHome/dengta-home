// 放映厅邀请深链处理：从 dengta://room/join?code=XXX 或 https://dengtahome.com/room/join?code=XXX
// 提取邀请码，暂存本地；App 加载完成后由 UI 弹出「某某邀请您和您的伴侣一起观影」确认框。
import { apiRequest } from "./api.js";

const PENDING_KEY = "dengta_pending_room_invite";

/** 解析邀请 URL 并暂存邀请码（幂等：重复打开同一码覆盖）。 */
export function acceptRoomInviteUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    // 兼容 dengta://room/join?code=XXX 与 https://...room/join?room_code=XXX
    const code = (url.searchParams.get("code") || url.searchParams.get("room_code") || "")
      .trim()
      .toUpperCase()
      .slice(0, 20);
    if (code.length >= 6) {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ code, at: Date.now() }));
      window.dispatchEvent(new CustomEvent("dengta:room-invite"));
    }
    return code;
  } catch {
    return "";
  }
}

/** 读取待处理的邀请（不消费）。 */
export function peekPendingInvite() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.code) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 清除待处理邀请。 */
export function clearPendingInvite() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 拉取邀请码对应的放映厅信息（发起人昵称、AI 名、片名、人数上限等），
 * 用于展示「某某邀请您和您的伴侣一起观影」。鉴权由调用方持有。
 */
export async function fetchRoomInviteInfo(code) {
  const data = await apiRequest(
    `/api/v2/co-watch/rooms/join-info?code=${encodeURIComponent(code)}`,
    { method: "GET", timeoutMs: 10_000 },
  );
  return data?.room || null;
}

export const ROOM_INVITE_EVENT = "dengta:room-invite";