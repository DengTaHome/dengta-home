export function mediaPlaybackFeedback(error) {
  const code = Number(error?.code);
  const details = {
    1: ["media_aborted", "本次视频加载已中止。点击重新载入后，再手动播放。"],
    2: ["media_network", "视频数据传输中断。检查网络后重新载入；若仍失败，可在原网站播放。"],
    3: ["media_decode", "播放器无法解码视频数据。可更换 MP4/H.264 视频，或在原网站播放。"],
    4: ["media_unsupported", "播放器未取得可用的视频源。可重新载入或换一个媒体链接；具体的平台原因尚未确认。"],
  };
  const [reason, message] = details[code] || ["media_unknown", "视频播放失败，播放器没有提供明确的错误类型。请重新载入或在原网站播放。"];
  return { status: "error", code: reason, message: `${message}（错误代码：${reason}）` };
}
