import { validateNeteaseResource } from "./netease-playback.js";
import { musicErrorMessage } from "./music-operation-feedback.js";

export function externalMusicFeedback(result) {
  if (!result.opened) return "已取消打开网易云。";
  const opened = "已交给网易云打开，实际播放与歌曲可用性由网易云决定。";
  return result.metadataError ? `${opened} 服务器链接确认失败，不会自动重复打开。${musicErrorMessage(result.metadataError, "请检查连接后重试。")} ` : opened;
}

export async function launchExternalMusic({ scope, token, resourceType, resourceId, open, request }) {
  const resource = validateNeteaseResource(resourceType, resourceId);
  scope.assertCurrent(token);
  const outcome = await open(resource.resourceType, resource.resourceId);
  scope.assertCurrent(token);
  if (outcome?.opened === false) return { opened: false };
  if (outcome?.opened !== true) throw Object.assign(new Error("设备没有返回打开回执，请检查后重试。"), { code: "music_external_receipt_invalid" });
  try {
    await request(resource.resourceType, resource.resourceId, token.options);
    scope.assertCurrent(token);
    return { opened: true, target: outcome.target };
  } catch (error) {
    scope.assertCurrent(token);
    return { opened: true, target: outcome.target, metadataError: error };
  }
}
