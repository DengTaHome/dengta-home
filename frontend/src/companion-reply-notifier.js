import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

// 伴侣后台回复通知：App 在后台（用户正在别的应用里）时，
// 新完成的 AI 回复会立即弹通知栏提醒（复用已有的主动消息通知渠道，自带震动与提示音）。
// 完全增量：不改动任何既有的屏幕共看/聊天流程。
export const COMPANION_REPLY_CHANNEL_ID = "dengta-home-reminders-v2";

const NOTIFIED_IDS_KEY = "dengta_companion_reply_notified_v1";
const BASELINE_KEY = "dengta_companion_reply_baseline_v1";
const MAX_REMEMBERED = 200;

function cleanText(value, maximum) {
  return Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
    .slice(0, maximum)
    .join("");
}

function scopedKey(key, scope) {
  return scope ? scope + "::" + key : key;
}

function readList(storage, key) {
  try {
    const parsed = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter(Boolean).slice(-MAX_REMEMBERED)
      : [];
  } catch {
    return [];
  }
}

export function readCompanionReplyBaseline(
  storage = globalThis.localStorage,
  scope = "",
) {
  try {
    const parsed = JSON.parse(
      storage.getItem(scopedKey(BASELINE_KEY, scope)) || "null",
    );
    if (parsed && typeof parsed.id === "string" && typeof parsed.at === "string") {
      return parsed;
    }
  } catch {
    // 基线读取失败时当作没有基线，下一轮重新建立。
  }
  return null;
}

export async function maybeNotifyNewCompanionReplies(
  messages,
  {
    aiName = "小灯",
    sessionId = "",
    scope = "",
    hidden = true,
    storage = globalThis.localStorage,
    capacitor = Capacitor,
    plugin = LocalNotifications,
    now = () => new Date(),
  } = {},
) {
  if (!hidden) return 0;
  if (
    !capacitor.isNativePlatform() ||
    !capacitor.isPluginAvailable("LocalNotifications")
  ) {
    return 0;
  }

  const assistant = (Array.isArray(messages) ? messages : [])
    .filter(
      (item) =>
        item &&
        item.role === "assistant" &&
        !item.isStreaming &&
        typeof item.content === "string" &&
        item.content.trim(),
    )
    .sort(
      (a, b) =>
        new Date(a.created_at || 0).getTime() -
        new Date(b.created_at || 0).getTime(),
    );
  if (assistant.length === 0) return 0;

  const baselineKey = scopedKey(BASELINE_KEY, scope);
  const baseline = readCompanionReplyBaseline(storage, scope);
  const latest = assistant[assistant.length - 1];
  if (!baseline) {
    storage.setItem(
      baselineKey,
      JSON.stringify({
        id: String(latest.id || ""),
        at: latest.created_at || now().toISOString(),
      }),
    );
    return 0;
  }

  const baselineAt = new Date(baseline.at || 0).getTime();
  const seen = new Set(readList(storage, scopedKey(NOTIFIED_IDS_KEY, scope)));
  const fresh = assistant.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    const at = new Date(item.created_at || 0).getTime();
    return Number.isFinite(at) && at > baselineAt;
  });

  let notified = 0;
  for (const message of fresh) {
    const notificationId = (Date.now() % 2147483000) + notified;
    try {
      await plugin.schedule({
        notifications: [
          {
            id: notificationId,
            title: (cleanText(aiName, 30) || "小灯") + " 想对你说",
            body:
              cleanText(message.content, 120) ||
              `${cleanText(aiName, 30) || "伴侣"}给你留了话，回 App 看看。`,
            largeBody: cleanText(message.content, 800),
            channelId: COMPANION_REPLY_CHANNEL_ID,
            extra: {
              sessionId: String(sessionId || ""),
              messageId: String(message.id || ""),
              source: "companion-reply",
            },
            schedule: {
              at: new Date(Date.now() + 60),
              allowWhileIdle: true,
            },
          },
        ],
      });
      seen.add(message.id);
      notified += 1;
    } catch {
      // 通知被系统拦截时静默跳过，不影响聊天。
    }
  }
  if (notified > 0) {
    storage.setItem(
      scopedKey(NOTIFIED_IDS_KEY, scope),
      JSON.stringify([...seen].slice(-MAX_REMEMBERED)),
    );
    try {
      navigator.vibrate?.([120, 60, 120]);
    } catch {
      // 后台 WebView 无法执行 JS 震动时，通知渠道自带的震动已生效。
    }
  }
  return notified;
}
